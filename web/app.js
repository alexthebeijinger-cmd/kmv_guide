/* КМВ Гид — чат-гид, прототип интерфейса.
 *
 * ВАЖНО ПРО ЧЕСТНОСТЬ ДАННЫХ.
 * Все места, адреса, часы, телефоны и описания берутся из data/places.json, который
 * собирается из knowledge/ скриптом scripts/build-data.mjs. Здесь ничего не выдумывается:
 * чего нет в базе — то и показывается как «нет», а не подменяется правдоподобным.
 *
 * Сам гид пока не подключён к RAG (Qdrant + роутинг DeepSeek→Gemini→Claude) — ответы
 * собираются локально по правилам ниже. Это прототип интерфейса, о чём говорит метка
 * «Прототип» в шапке. Подключение бэкенда меняет функцию ask(), а не вёрстку.
 */

'use strict';

// ── Строки интерфейса ────────────────────────────────────────────────

const I18N = {
  ru: {
    wordmark: 'КМВ Гид · Пятигорск',
    proto: 'Прототип',
    askPlaceholder: 'Спросите гида',
    send: 'Отправить',
    honest: '<b>Гид отвечает только со связью.</b> Сохранённый маршрут, адреса и телефоны останутся с вами и без интернета.',
    offlineBanner: 'Связи нет. Гид отвечать не может, но адреса, телефоны и часы уже загруженных мест на экране остаются.',
    opening: 'Какие у нас планы на сегодня?',
    openingLabel: 'Сегодня · Пятигорск',
    orAtOnce: 'Или сразу',
    back: 'К гиду',
    thinking: 'Смотрю по базе…',
    hoursUnknown: 'часы не подтверждены',
    open: 'открыто',
    closing: 'скоро закроется',
    closed: 'закрыто',
    hours: 'Часы',
    address: 'Адрес',
    phone: 'Телефон',
    price: 'Цена',
    call: 'Позвонить',
    route: 'Маршрут',
    book: 'Забронировать столик',
    noPhoto: 'Фотографии пока нет',
    langNote: 'Интерфейс переведён, а описания мест — пока только на русском. Не подсовываю машинный перевод: китайская версия контента готовится отдельно.',
  },
  zh: {
    wordmark: '矿水城指南 · 皮亚季戈尔斯克',
    proto: '原型',
    askPlaceholder: '向导游提问',
    send: '发送',
    honest: '<b>导游需要联网才能回答。</b> 已保存的路线、地址和电话在离线时仍然可用。',
    offlineBanner: '当前无网络。导游无法回答，但屏幕上已加载地点的地址、电话和营业时间仍然有效。',
    opening: '今天我们有什么安排？',
    openingLabel: '今天 · 皮亚季戈尔斯克',
    orAtOnce: '或者直接',
    back: '返回导游',
    thinking: '正在查询…',
    hoursUnknown: '营业时间未确认',
    open: '营业中',
    closing: '即将打烊',
    closed: '已打烊',
    hours: '营业时间',
    address: '地址',
    phone: '电话',
    price: '价格',
    call: '拨打电话',
    route: '路线',
    book: '预订餐位',
    noPhoto: '暂无照片',
    langNote: '界面已翻译，但地点介绍目前仅有俄语。我们不提供机器翻译：中文内容正在单独准备。',
  },
};

const state = {
  lang: 'ru',
  places: [],
  landmarks: [],
  origin: null,      // {lat, lng, label} — откуда считаем расстояния
  bookings: new Map(),
};

const t = (key) => I18N[state.lang][key] ?? I18N.ru[key] ?? key;

// ── Мелкие утилиты ───────────────────────────────────────────────────

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

const feed = () => document.getElementById('feed');

// Всё, что подставляется в строку для innerHTML, проходит через это.
// Вопрос пользователя и названия из базы — не доверенный источник разметки.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

function haversine(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Расстояния приблизительные: координаты прототипные (см. web/data/coords.prototype.json),
// поэтому показываем со знаком «≈» и округляем — точнее, чем есть, притворяться нельзя.
function formatDistance(metres) {
  if (metres < 900) return `≈ ${Math.round(metres / 50) * 50} м`;
  return `≈ ${(metres / 1000).toFixed(1).replace('.', ',')} км`;
}

function walkMinutes(metres) {
  return Math.max(3, Math.round(metres / 75)); // ~4,5 км/ч, курортный шаг в горку
}

// ── Часы работы ──────────────────────────────────────────────────────
// knowledge/SCHEMA.md намеренно держит hours свободным текстом. Поэтому разбираем
// только однозначные случаи, а во всех остальных показываем строку как есть и не
// заявляем состояние, которого не знаем.

const DAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const DAY_FULL = {
  понедельник: 'пн', вторник: 'вт', среда: 'ср', среду: 'ср', четверг: 'чт',
  пятница: 'пт', пятницу: 'пт', суббота: 'сб', субботу: 'сб', воскресенье: 'вс',
};

function normalizeDays(text) {
  const found = new Set();
  for (const [full, short] of Object.entries(DAY_FULL)) {
    if (text.includes(full)) found.add(short);
  }
  // \b в JS считает словом только латиницу, поэтому границу слова для кириллицы
  // задаём вручную: сокращение не должно быть куском другого слова.
  for (const short of DAY_SHORT) {
    if (new RegExp(`(^|[^а-яё])${short}([^а-яё]|$)`, 'i').test(text)) found.add(short);
  }
  return found;
}

const TIME_RANGE = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/;
const hhmm = (v) => `${String(Math.floor((v % 1440) / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;

// Разбирает диапазон дней («пн–чт»), перечисление («пн, ср») и одиночные сокращения.
function daysInSegment(text) {
  const days = new Set();
  if (/ежедневн|круглосуточ|без выходн/i.test(text)) return new Set(DAY_SHORT);

  const spanRe = /(вс|пн|вт|ср|чт|пт|сб)\s*[–—-]\s*(вс|пн|вт|ср|чт|пт|сб)/gi;
  let m;
  let matchedSpan = false;
  while ((m = spanRe.exec(text))) {
    matchedSpan = true;
    const from = DAY_SHORT.indexOf(m[1].toLowerCase());
    const to = DAY_SHORT.indexOf(m[2].toLowerCase());
    for (let i = from; ; i = (i + 1) % 7) {
      days.add(DAY_SHORT[i]);
      if (i === to) break;
    }
  }
  if (!matchedSpan) for (const d of normalizeDays(text.toLowerCase())) days.add(d);
  return days;
}

// Читает реальные расписания КМВ: разные дни недели, перерывы, выходные.
// Что прочитать не удалось — показывается строкой, без выдуманного состояния.
function parseHours(raw, now = new Date()) {
  if (!raw) return { state: 'unknown', label: t('hoursUnknown'), raw: null, dayOff: false };

  const today = DAY_SHORT[now.getDay()];
  let text = raw;

  // 1. Выходные вынимаем первыми: они относятся ко всей строке.
  const closedDays = new Set();
  text = text.replace(/выходн[а-яё]*\s*[—–:-]?\s*([^;.()]+)/gi, (_, list) => {
    for (const d of normalizeDays(list.toLowerCase())) closedDays.add(d);
    return ' ';
  });

  // 2. Скобки — пояснения для человека («касса до 17:30»), не часть расписания.
  text = text.replace(/\([^)]*\)/g, ' ');

  // 3. Перерыв — отдельное окно внутри дня.
  let breakWindow = null;
  text = text.replace(/перерыв\w*\s*[—–:-]?\s*([^;,]+)/gi, (whole, chunk) => {
    const r = chunk.match(TIME_RANGE);
    if (r) breakWindow = [+r[1] * 60 + +r[2], +r[3] * 60 + +r[4]];
    return ' ';
  });

  if (closedDays.has(today)) return { state: 'closed', label: 'сегодня выходной', raw, dayOff: true };

  // 4. Каждый сегмент — своя группа дней со своим окном.
  const schedule = new Map();
  for (const segment of text.split(';')) {
    const r = segment.match(TIME_RANGE);
    if (!r) continue;
    const open = +r[1] * 60 + +r[2];
    let close = +r[3] * 60 + +r[4];
    if (close <= open) close += 24 * 60;

    const before = segment.slice(0, r.index);
    let days = daysInSegment(before);
    if (days.size === 0) days = new Set(DAY_SHORT); // дни не названы — значит, все
    for (const d of days) if (!closedDays.has(d)) schedule.set(d, [open, close]);
  }

  if (schedule.size === 0) return { state: 'unknown', label: t('hoursUnknown'), raw, dayOff: false };
  if (!schedule.has(today)) return { state: 'closed', label: 'сегодня выходной', raw, dayOff: true };

  const [open, close] = schedule.get(today);
  const mins = now.getHours() * 60 + now.getMinutes();

  // Состояние формулируется действием: успею / не успею / когда откроется.
  if (mins < open) return { state: 'closed', label: `откроется в ${hhmm(open)}`, raw, dayOff: false };
  if (mins >= close) return { state: 'closed', label: `уже закрылось · откроется в ${hhmm(open)}`, raw, dayOff: false };
  if (breakWindow && mins >= breakWindow[0] && mins < breakWindow[1]) {
    return { state: 'closing', label: `перерыв до ${hhmm(breakWindow[1])}`, raw, dayOff: false };
  }
  if (close - mins <= 60) return { state: 'closing', label: `закроется через ${close - mins} мин`, raw, dayOff: false };
  return { state: 'open', label: `${t('open')} до ${hhmm(close)}`, raw, dayOff: false };
}

// ── Табличка ─────────────────────────────────────────────────────────

function dataRow(pairs) {
  const dl = el('dl', { class: 'plate__data' });
  for (const [term, value] of pairs) {
    if (!value) continue;
    const pair = el('div', { class: 'pair' }, [el('dt', { text: term }), el('dd', { text: value })]);
    dl.append(pair);
  }
  return dl.children.length ? dl : null;
}

function placePlate(place, opts = {}) {
  const hours = parseHours(place.hours);
  const dist = state.origin && place.coords ? haversine([state.origin.lat, state.origin.lng], place.coords) : null;

  const node = el('div', {
    class: `plate plate--place is-${hours.state}`,
    dataset: { id: place.id },
  });

  if (opts.label) node.append(el('span', { class: 'plate__label', text: opts.label }));

  node.append(
    el('button', {
      class: 'plate__title',
      type: 'button',
      style: 'all:unset;display:block;cursor:pointer;font:inherit;',
      text: place.title,
      onclick: () => openSheet(place.id),
    })
  );

  if (place.address) node.append(el('p', { class: 'plate__meta', text: place.address }));

  const stateLine = el('span', { class: 'state', text: hours.label });

  const row = dataRow([
    [t('hours'), hours.raw],
    ['Идти пешком', dist !== null ? `${formatDistance(dist)} · ${walkMinutes(dist)} мин` : null],
  ]) || el('dl', { class: 'plate__data' });
  row.prepend(el('div', { class: 'pair' }, [stateLine]));
  node.append(row);

  // Телефона на карточке нет намеренно: столик в кофейне не бронируют звонком,
  // а человеку нужно знать не номер, а успеет ли он дойти до закрытия.
  const acts = el('div', { class: 'plate__acts' });
  acts.append(el('button', { class: 'act', type: 'button', text: 'Подробно', onclick: () => openSheet(place.id) }));
  if (place.partner === 'confirmed' && place.booking) {
    acts.append(el('button', { class: 'act act--primary', type: 'button', text: t('book'), onclick: () => startBooking(place.id) }));
  }
  node.append(acts);

  return node;
}

// ── Выдача: латунная ось с табличками ────────────────────────────────

function gallery(children) {
  const plates = el('div', { class: 'gallery__plates' });
  children.forEach((child, i) => {
    if (!child) return;
    child.style.setProperty('--i', i);
    plates.append(child);
  });
  return el('div', { class: 'gallery' }, [el('div', { class: 'gallery__rail', 'aria-hidden': 'true' }), plates]);
}

function turn(leadHtml, children, opts = {}) {
  const node = el('section', { class: 'turn turn--fresh' });
  if (opts.said) node.append(el('p', { class: 'said' }, [el('span', { text: opts.said })]));
  if (leadHtml) node.append(el('p', { class: 'turn__lead', html: leadHtml }));
  if (children && children.length) node.append(gallery(children));
  feed().append(node);
  requestAnimationFrame(() => node.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  return node;
}

function note(title, bodyHtml) {
  return el('div', { class: 'note' }, [
    title ? el('p', { class: 'rule', text: title }) : null,
    el('div', { html: bodyHtml }),
  ]);
}

// ── Первый экран ─────────────────────────────────────────────────────

const ANSWERS = [
  { id: 'open',    text: 'Ещё не решил — предложи',  hint: null },
  { id: 'half',    text: 'После процедур, с 14:00',  hint: 'полдня' },
  { id: 'full',    text: 'Гуляю весь день',          hint: '8 ч+' },
  { id: 'transit', text: 'Проездом, до вечера',      hint: '1 день' },
];

const SHORTCUTS = [
  { text: 'Где поесть рядом',        run: () => askFood() },
  { text: 'Как добраться от аэропорта', run: () => answerTransport() },
  { text: 'Санаторий по диагнозу',   run: () => answerMedical() },
  { text: 'Что посмотреть за день',  run: () => answerPlan('full') },
];

function renderStart() {
  const opening = el('section', { class: 'opening' }, [
    el('div', { class: 'opening__hooks', 'aria-hidden': 'true' }, [el('span'), el('span')]),
    el('div', { class: 'plate' }, [
      el('span', { class: 'plate__label', text: t('openingLabel') }),
      el('h1', { class: 'opening__q', text: t('opening') }),
      el(
        'div',
        { class: 'answers' },
        ANSWERS.map((a) =>
          el('button', { class: 'answer', type: 'button', onclick: () => { said(a.text); answerPlan(a.id); } }, [
            document.createTextNode(a.text),
            a.hint ? el('span', { text: a.hint }) : null,
          ])
        )
      ),
    ]),
  ]);

  const aside = el('section', { class: 'aside' }, [
    el('p', { class: 'rule', text: t('orAtOnce') }),
    el('div', { class: 'tags' }, SHORTCUTS.map((s) =>
      el('button', { class: 'tag', type: 'button', text: s.text, onclick: () => { said(s.text); s.run(); } })
    )),
  ]);

  feed().append(el('section', { class: 'turn' }, [el('hr', { class: 'rail-full' }), opening, aside]));
}

function said(text) {
  // Первый экран уступает место разговору, а реплика человека остаётся в ленте:
  // диалог должен читаться сверху вниз.
  document.querySelector('.opening')?.closest('.turn')?.remove();
  feed().append(el('section', { class: 'turn' }, [el('p', { class: 'said' }, [el('span', { text })])]));
}

// ── Гид думает ───────────────────────────────────────────────────────

function thinking() {
  const node = el('section', { class: 'turn' }, [
    el('p', { class: 'turn__lead', text: t('thinking') }),
    el('div', { class: 'gallery is-pouring' }, [
      el('div', { class: 'gallery__rail', 'aria-hidden': 'true', style: 'min-height:56px' }),
      el('div', { class: 'gallery__plates' }),
    ]),
  ]);
  feed().append(node);
  node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return node;
}

function respond(fn, delay = 480) {
  if (!navigator.onLine) return answerOffline();
  const pending = thinking();
  setTimeout(() => { pending.remove(); fn(); }, delay);
}

// ── План дня ─────────────────────────────────────────────────────────

// План строится из того, что реально есть в базе с подтверждённым адресом, а не по
// зашитому списку: добавили место в knowledge/ — оно само появляется в порядке дня.
const PLANS = {
  open:    { start: null,          stops: 2, food: true },
  half:    { start: 14 * 60 + 30,  stops: 2, food: true },
  full:    { start: 10 * 60,       stops: 4, food: true },
  transit: { start: null,          stops: 3, food: false },
};

// Оценка времени на объект. Это прикидка для порядка дня, а не расписание.
const DURATION = { museum: 60, landmark: 40, cemetery: 30, cafe: 60, 'summer-cafe': 45, 'street-food': 20 };

// Человеческое название вида места — оно и стоит на табличке рядом со временем.
const KIND = {
  museum: 'музей',
  landmark: 'достопримечательность',
  cemetery: 'историческое место',
  cafe: 'кофейня',
  'summer-cafe': 'летнее кафе',
  'street-food': 'уличная еда',
  dental: 'стоматология',
};

function answerPlan(kind) {
  respond(() => {
    const plan = PLANS[kind] || PLANS.open;
    const now = new Date();

    const sights = state.places.filter((p) => p.category === 'history');
    const eateries = state.places.filter((p) => p.category === 'restaurants');

    const dayOff = [];
    const alreadyShut = [];
    // В план идёт только то, что открыто прямо сейчас: вести человека к закрытым
    // дверям хуже, чем честно сказать, что день кончился.
    const openNow = (list) =>
      list.filter((p) => {
        const h = parseHours(p.hours, now);
        if (h.dayOff) { dayOff.push(p); return false; }
        if (h.state === 'closed') { alreadyShut.push(p); return false; }
        return true;
      });

    // Место с подтверждёнными часами предпочтительнее места с неизвестными:
    // вести человека туда, где точно открыто, честнее, чем туда, где «наверное».
    const confidence = (p) => (parseHours(p.hours, now).state === 'unknown' ? 1 : 0);
    const byConfidence = (list) => [...list].sort((a, b) => confidence(a) - confidence(b));

    const chosen = byConfidence(openNow(sights)).slice(0, plan.stops);
    const openEateries = byConfidence(openNow(eateries));
    if (plan.food && openEateries.length) chosen.push(openEateries[0]);

    // Время не может начаться в прошлом.
    const soonest = Math.ceil((now.getHours() * 60 + now.getMinutes() + 20) / 30) * 30;
    let clock = Math.max(plan.start ?? 0, soonest);
    const plates = [];

    chosen.forEach((place) => {
      const at = `${String(Math.floor((clock % 1440) / 60)).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}`;
      plates.push(placePlate(place, { label: `${at} · ${KIND[place.subcategory] || 'место'}` }));
      clock += (DURATION[place.subcategory] || 45) + 20; // плюс дорога между точками
    });

    if (dayOff.length) {
      plates.push(note('Сегодня выходной', `Не ставлю в порядок дня: <b>${esc(dayOff.map((p) => p.title).join(', '))}</b> — сегодня не работает.`));
    }
    if (alreadyShut.length) {
      plates.push(note('На сегодня закрылось', `<b>${esc(alreadyShut.map((p) => p.title).join(', '))}</b> — уже закрыто до завтра. Спросите утром, поставлю в план первыми.`));
    }

    plates.push(note('Что дальше', 'Порядок дня — прикидка по времени работы и дороге между точками, а не расписание. Скажите, если надо подвинуть время или убрать точку.'));

    const sightsInPlan = chosen.filter((p) => p.category === 'history').length;
    const lead = !chosen.length
      ? 'На сегодня всё уже закрылось. Спросите утром — соберу день целиком.'
      : sightsInPlan === 0
      ? 'Музеи на сегодня закрылись, но вот что работает прямо сейчас.'
      : `Собрал порядок на сегодня — <b>${chosen.length} ${plural(chosen.length, 'остановка', 'остановки', 'остановок')}</b>. Время примерное, с дорогой между ними.`;

    turn(lead, plates);
  });
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ── Ветка еды ────────────────────────────────────────────────────────

const FOOD_TYPES = ['завтрак', 'кофе', 'десерт', 'комплексный обед', 'ужин', 'шашлык', 'хинкали', 'пиво'];

// Как человек может назвать тот же тип в свободном вопросе.
const FOOD_ALIASES = {
  'комплексный обед': ['комплексный обед', 'бизнес-ланч', 'бизнес ланч', 'ланч', 'обед'],
  'десерт': ['десерт', 'сладк', 'торт', 'мороженое', 'выпечк', 'пирожн'],
  'завтрак': ['завтрак', 'позавтракать'],
  'кофе': ['кофе', 'капучино', 'чай'],
  'ужин': ['ужин', 'поужинать'],
  'шашлык': ['шашлык', 'мангал'],
  'хинкали': ['хинкали', 'хачапури', 'грузинск'],
  'пиво': ['пиво', 'бар', 'паб'],
};

function matchFoodType(query) {
  // Длинные названия проверяем раньше коротких: «комплексный обед» не должен
  // проиграть подстроке «обед» из другого типа.
  const entries = Object.entries(FOOD_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [type, words] of entries) {
    if (words.some((w) => query.includes(w))) return type;
  }
  return null;
}

// Гид знает время суток, поэтому уточнение подаётся уже отсортированным под текущий час.
function foodTypesByHour(hour) {
  let priority;
  if (hour < 11) priority = ['завтрак', 'кофе'];
  else if (hour < 16) priority = ['комплексный обед', 'кофе', 'хинкали'];
  else if (hour < 23) priority = ['ужин', 'шашлык', 'хинкали', 'пиво'];
  else priority = ['кофе', 'десерт'];
  const rest = FOOD_TYPES.filter((f) => !priority.includes(f));
  return { order: [...priority, ...rest], now: new Set(priority) };
}

function askFood() {
  respond(() => {
    const { order, now } = foodTypesByHour(new Date().getHours());
    const row = el('div', { class: 'type-row' },
      order.map((type) =>
        el('button', {
          class: `type${now.has(type) ? ' type--now' : ''}`,
          type: 'button',
          text: type[0].toUpperCase() + type.slice(1),
          onclick: () => { said(type); answerFood(type); },
        })
      )
    );
    turn('Что именно ищем? Подберу по этому, а не наугад.', [row]);
  });
}

function answerFood(type) {
  const matches = state.places.filter((p) => p.foodTypes.includes(type));

  if (!matches.length) {
    respond(() => {
      turn(
        `По запросу «${type}» в базе пока пусто.`,
        [note('Честно', `В базе по Пятигорску нет ни одного проверенного места с категорией «<b>${esc(type)}</b>». Подсовывать близкое вместо запрошенного не буду — это ровно тот случай, когда гид должен сказать «не знаю». Категория появится, как только места проверят на месте.`)]
      );
    });
    return;
  }

  if (!state.origin) { askLocation(type); return; }
  showFoodList(type, matches);
}

function showFoodList(type, matches) {
  respond(() => {
    const withDist = matches.map((p) => ({
      place: p,
      dist: p.coords ? haversine([state.origin.lat, state.origin.lng], p.coords) : Infinity,
    }));
    withDist.sort((a, b) => a.dist - b.dist);

    const top = withDist.slice(0, 5);
    const plates = top.map(({ place }) => placePlate(place));

    const noCoords = top.filter((x) => x.dist === Infinity).map((x) => x.place.title);
    if (noCoords.length) {
      plates.push(note('Адрес не подтверждён', `У <b>${esc(noCoords.join(', '))}</b> в базе нет проверенного адреса — значит, и расстояние считать не от чего. Показываю в конце списка, чтобы вы про это место знали, но не веду вас туда наугад.`));
    }

    turn(
      `Ближайшее к вам по запросу «${esc(type)}», считаю от точки «<b>${esc(state.origin.label)}</b>». Смотрите на часы работы — до закрытия надо успеть дойти.`,
      plates
    );
  });
}

// ── Где вы находитесь ────────────────────────────────────────────────

function askLocation(nextType) {
  // Ориентиры — точки прибытия: от вокзала или аэропорта человек отсчитается,
  // от музея, в котором он не был, — нет.
  const landmarks = state.landmarks;

  const body = el('div', { class: 'note' }, [
    el('p', { class: 'rule', text: 'Откуда считать' }),
    el('p', { html: 'Чтобы показать расстояние и сколько идти, а не просто список, нужно понять, откуда считать.' }),
    el('div', { class: 'plate__acts', style: 'margin-top:12px' }, [
      el('button', {
        class: 'act act--primary', type: 'button', style: 'border-color:var(--water-deep)',
        text: 'Определить по GPS',
        onclick: (e) => useGeolocation(e.target, nextType),
      }),
    ]),
    el('p', { class: 'rule', style: 'margin-top:20px', text: 'Или откуда вы приехали' }),
    el('div', { class: 'type-row' },
      landmarks.map((p) =>
        el('button', {
          class: 'type', type: 'button', text: p.title,
          onclick: () => { setOrigin(p.coords[0], p.coords[1], p.title); if (nextType) answerFood(nextType); },
        })
      )
    ),
    el('p', { style: 'margin-top:16px;font-size:.875rem', html: 'Если ни то ни другое — посмотрите на ближайшую табличку с адресом: улица и номер дома. Считать от произвольного адреса гид научится вместе с картой; пока точнее всего — кнопка выше или точка приезда.' }),
  ]);

  // Заметка живёт по камню, но всё равно висит на оси — это часть выдачи.
  turn('Сначала — где вы сейчас.', [body]);
}

function useGeolocation(button, nextType) {
  if (!navigator.geolocation) {
    button.replaceWith(el('span', { class: 'field-error', text: 'Браузер не умеет определять положение. Выберите ориентир ниже.' }));
    return;
  }
  button.textContent = 'Определяю…';
  button.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setOrigin(pos.coords.latitude, pos.coords.longitude, 'вы здесь');
      if (nextType) answerFood(nextType);
    },
    () => {
      button.replaceWith(
        el('p', { class: 'field-error', html: 'Не получилось определить положение — доступ закрыт или сигнал слабый. Выберите ориентир ниже или напишите ближайший адрес.' })
      );
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

function setOrigin(lat, lng, label) {
  state.origin = { lat, lng, label };
}

// ── Честные ответы там, где данных нет ───────────────────────────────

function answerTransport() {
  respond(() => {
    turn('Про дорогу отвечу не полностью — и скажу, почему.', [
      note('Что есть', 'В базе лежат черновики по электричкам линии Минводы–Пятигорск–Кисловодск, по трамваю и по городским маршруткам. Но расписания — это структурированные данные, а не текст для поиска: подключаются отдельным обновляемым источником, иначе гид будет уверенно называть неверное время отправления.'),
      note('Что это значит сейчас', 'Пока источник не подключён, я не назову вам время ближайшей электрички. Как только он появится, ответ на «как добраться от аэропорта» станет полноценным: маршрут, время в пути и стоимость.'),
    ]);
  });
}

function answerMedical() {
  respond(() => {
    turn('Подбор санатория по диагнозу — сильная часть продукта, но не этого прототипа.', [
      note('Почему', 'Подбор работает на отдельной базе журнала «Курортная медицина» из balneo_bot. Она держится в собственном индексе и намеренно не смешивается с туристическим контентом, иначе поиск начинает путать контексты и выдавать про музеи в ответ на вопрос про показания.'),
      note('Что будет', 'В рабочей версии здесь спрашивают назначение врача или диагноз и показывают санатории с подходящим профилем лечения — с оговоркой, что это справка, а не медицинская рекомендация.'),
    ]);
  });
}

function answerOffline() {
  turn('Связи нет — отвечать не могу.', [
    note('Что работает без интернета', 'Всё, что уже на экране: адреса, телефоны и часы. По телефону можно звонить прямо отсюда. Как появится сеть, продолжим.'),
  ]);
}

function answerUnknown(query) {
  turn(`Не нашёл ответа на «${esc(query)}» — и не буду придумывать.`, [
    note('Что я сейчас умею', 'Собрать порядок дня по Пятигорску · подобрать, где поесть, с уточнением типа · рассказать про музеи и достопримечательности из базы · принять заявку на столик там, где партнёр её принимает.'),
    note('Чего пока нет', 'Расписаний транспорта, подбора санатория по диагнозу и китайских описаний мест. Это не забытые кнопки, а честно ещё не подключённые источники.'),
  ]);
}

// ── Заявка на столик ─────────────────────────────────────────────────

function startBooking(id) {
  const place = state.places.find((p) => p.id === id);
  if (!place) return;

  const form = el('form', { class: 'form' });
  const err = el('p', { class: 'field-error', style: 'display:none' });

  const when = el('input', { type: 'date', required: true, value: new Date().toISOString().slice(0, 10) });
  const time = el('input', { type: 'time', required: true, value: '19:00' });
  const guests = el('input', { type: 'number', min: '1', max: '20', value: '2', required: true });
  const name = el('input', { type: 'text', placeholder: 'Как вас записать', required: true });
  const phone = el('input', { type: 'tel', placeholder: '+7 …', required: true });

  form.append(
    el('div', { class: 'form__row' }, [
      el('label', { class: 'field' }, [el('span', { text: 'Дата' }), when]),
      el('label', { class: 'field' }, [el('span', { text: 'Время' }), time]),
    ]),
    el('div', { class: 'form__row' }, [
      el('label', { class: 'field' }, [el('span', { text: 'Гостей' }), guests]),
      el('label', { class: 'field' }, [el('span', { text: 'Имя' }), name]),
    ]),
    el('label', { class: 'field' }, [el('span', { text: 'Телефон' }), phone]),
    err,
    el('div', { class: 'plate__acts' }, [
      el('button', { class: 'act act--primary', type: 'submit', text: 'Отправить заявку' }),
    ])
  );

  const plate = el('div', { class: 'plate' }, [
    el('span', { class: 'plate__label', text: 'Заявка на столик' }),
    el('h3', { class: 'plate__title', text: place.title }),
    el('p', { class: 'plate__body', text: 'Оплата на месте. Предоплату через сайт мы не берём.' }),
    form,
  ]);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!name.value.trim() || !phone.value.trim()) {
      err.style.display = 'block';
      err.textContent = 'Без имени и телефона партнёр не сможет подтвердить — заполните оба поля.';
      return;
    }
    const booking = {
      id: `${place.id}-${Date.now()}`,
      place,
      when: when.value, time: time.value, guests: guests.value,
      name: name.value.trim(), phone: phone.value.trim(),
      status: 'sent',
    };
    state.bookings.set(booking.id, booking);
    plate.closest('.turn')?.remove();
    showBookingStatus(booking);
  });

  turn(`Оформим столик в «${esc(place.title)}». Партнёр подтверждает вручную — обычно в течение 30–60 минут в рабочие часы.`, [plate]);
}

const BOOKING_COPY = {
  sent: {
    label: 'Ждём подтверждения',
    body: 'Заявка ушла партнёру в Telegram. Обычно отвечают за 30–60 минут в рабочие часы. Если ответа не будет — позвоним сами.',
    cls: 'is-open',
  },
  confirmed: {
    label: 'Подтверждено',
    body: 'Партнёр подтвердил бронь. Стол держат 20 минут после указанного времени. Оплата на месте.',
    cls: 'is-open',
  },
  declined: {
    label: 'Отказ',
    body: 'Партнёр не может принять на это время. Могу поискать соседние места или другое время в этом же заведении.',
    cls: 'is-closed',
  },
  waiting: {
    label: 'Партнёр молчит',
    body: 'Прошло больше часа без ответа. Мы уже звоним партнёру. Если так и не ответит — предложу замену поблизости.',
    cls: 'is-closing',
  },
};

function showBookingStatus(booking) {
  const copy = BOOKING_COPY[booking.status];
  const date = new Date(`${booking.when}T${booking.time}`);
  const human = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  const plate = el('div', { class: `plate ${copy.cls}` }, [
    el('span', { class: 'plate__label', text: copy.label }),
    el('h3', { class: 'plate__title', text: booking.place.title }),
    el('p', { class: 'plate__body', text: copy.body }),
    dataRow([
      ['Когда', `${human}, ${booking.time}`],
      ['Гостей', booking.guests],
      ['На имя', booking.name],
    ]),
    booking.status === 'declined'
      ? el('div', { class: 'plate__acts' }, [
          el('button', { class: 'act', type: 'button', text: 'Найти рядом', onclick: () => askFood() }),
        ])
      : null,
    // Прототип: настоящий ответ приходит от партнёра в Telegram. Здесь — переключатель,
    // чтобы можно было увидеть все состояния заявки. В рабочей версии этого блока нет.
    el('div', { class: 'plate__acts', style: 'border-top:1px dashed rgba(169,217,209,.3);padding-top:12px;margin-top:16px' }, [
      el('span', { class: 'plate__label', style: 'width:100%;margin:0', text: 'Прототип · показать ответ партнёра' }),
      ...['sent', 'confirmed', 'declined', 'waiting']
        .filter((s) => s !== booking.status)
        .map((s) =>
          el('button', {
            class: 'act', type: 'button', text: BOOKING_COPY[s].label,
            onclick: () => { plate.closest('.turn')?.remove(); showBookingStatus({ ...booking, status: s }); },
          })
        ),
    ]),
  ]);

  turn(null, [plate]);
}

// ── Страница места ───────────────────────────────────────────────────

function openSheet(id) {
  const place = state.places.find((p) => p.id === id);
  if (!place) return;

  const hours = parseHours(place.hours);
  const inner = document.getElementById('sheetInner');
  inner.replaceChildren();

  inner.append(
    el('div', { class: 'sheet__bar' }, [
      el('button', { class: 'back', type: 'button', onclick: closeSheet }, [
        el('span', { text: '←' }), el('span', { text: t('back') }),
      ]),
      el('span', { class: 'state', style: 'color:var(--ink-muted)', text: hours.label }),
    ]),
    place.photos.length
      ? el('img', { class: 'sheet__photo', src: place.photos[0], alt: place.title, loading: 'lazy' })
      : el('div', { class: 'sheet__nophoto', text: t('noPhoto') }),
    el('h1', { class: 'sheet__title', id: 'sheetTitle', text: place.title }),
    place.summary ? el('p', { class: 'sheet__summary', text: place.summary }) : null
  );

  const facts = el('div', { class: `plate is-${hours.state}` }, [
    dataRow([
      [t('hours'), hours.raw || t('hoursUnknown')],
      [t('address'), place.address],
      [t('price'), place.price],
    ]),
    el('div', { class: 'plate__acts' }, [
      place.address
        ? el('a', {
            class: 'act', target: '_blank', rel: 'noopener',
            href: `https://yandex.ru/maps/?text=${encodeURIComponent('Пятигорск, ' + place.address)}`,
            text: `${t('route')} · Яндекс.Карты`,
          })
        : null,
      place.partner === 'confirmed' && place.booking
        ? el('button', { class: 'act act--primary', type: 'button', text: t('book'), onclick: () => { closeSheet(); startBooking(place.id); } })
        : null,
    ]),
  ]);
  inner.append(facts);

  for (const section of place.sections) {
    inner.append(el('h3', { text: section.heading }), el('p', { text: section.text }));
  }

  if (place.photos.length > 1) {
    for (const src of place.photos.slice(1)) {
      inner.append(el('img', { class: 'sheet__photo', src, alt: place.title, loading: 'lazy' }));
    }
  }

  const bits = [];
  if (place.updated) bits.push(`Факты проверялись: ${place.updated}`);
  if (place.status !== 'ready') bits.push('Карточка в работе — часть данных ещё не подтверждена');
  if (place.partner === 'confirmed') bits.push('Партнёр пилота');
  else if (place.partner === 'candidate') bits.push('Кандидат в партнёры, договорённости нет');
  if (bits.length) inner.append(el('p', { class: 'sheet__src', text: bits.join(' · ') }));

  const sheet = document.getElementById('sheet');
  sheet.classList.add('is-open');
  sheet.scrollTop = 0;
  sheet.focus();
  document.body.style.overflow = 'hidden';
  history.pushState({ place: id }, '', `?place=${encodeURIComponent(id)}`);
}

function closeSheet(fromPop) {
  document.getElementById('sheet').classList.remove('is-open');
  document.body.style.overflow = '';
  if (!fromPop && location.search) history.pushState({}, '', location.pathname);
}

// ── Разбор свободного вопроса ────────────────────────────────────────

function ask(query) {
  const q = query.toLowerCase();

  const type = matchFoodType(q);
  if (type) return answerFood(type);
  if (/поесть|еда|покушать|ресторан|кафе|столов|перекус|голоден/.test(q)) return askFood();
  if (/добрать|электрич|автобус|трамвай|маршрутк|аэропорт|вокзал|такси|доехать/.test(q)) return answerTransport();
  if (/санатор|диагноз|лечен|путёвк|путевк|показан/.test(q)) return answerMedical();
  if (/план|маршрут|успе|день|посмотреть|погулять|куда сходить/.test(q)) return answerPlan('open');

  const hit = state.places.find((p) => {
    const title = p.title.toLowerCase().replace(/[«»]/g, '');
    return q.includes(title.split(/[\s/]/)[0]) && title.split(/[\s/]/)[0].length > 3;
  });
  if (hit) return respond(() => turn(`Вот что знаю про «${esc(hit.title)}».`, [placePlate(hit)]));

  respond(() => answerUnknown(query));
}

// ── Язык ─────────────────────────────────────────────────────────────

function applyLang() {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-Hans' : 'ru';
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-html]')) node.innerHTML = t(node.dataset.i18nHtml);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll('[data-i18n-label]')) node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  for (const btn of document.querySelectorAll('.lang button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === state.lang));
  }
}

function setLang(lang) {
  if (lang === state.lang) return;
  state.lang = lang;
  applyLang();
  feed().replaceChildren();
  renderStart();
  if (lang === 'zh') {
    turn(null, [note(null, t('langNote'))]);
  }
}

// ── Запуск ───────────────────────────────────────────────────────────

async function init() {
  document.getElementById('askForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('askInput');
    const value = input.value.trim();
    if (!value) return;
    said(value);
    input.value = '';
    ask(value);
  });

  for (const btn of document.querySelectorAll('.lang button')) {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  }

  const syncOnline = () => document.body.classList.toggle('is-offline', !navigator.onLine);
  addEventListener('online', syncOnline);
  addEventListener('offline', syncOnline);
  syncOnline();

  addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('place');
    if (id) openSheet(id); else closeSheet(true);
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('sheet').classList.contains('is-open')) closeSheet();
  });

  try {
    const res = await fetch('data/places.json', { cache: 'no-cache' });
    const data = await res.json();
    state.places = data.places;
    state.landmarks = data.landmarks || [];
  } catch (err) {
    feed().append(el('section', { class: 'turn' }, [
      note('Данные не загрузились', 'Не удалось прочитать <b>data/places.json</b>. Запустите «Обновить данные сайта.command» в папке проекта и обновите страницу.'),
    ]));
    return;
  }

  applyLang();
  renderStart();

  const id = new URLSearchParams(location.search).get('place');
  if (id) openSheet(id);
}

init();
