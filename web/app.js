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
 *
 * ПРО ЯЗЫК. Интерфейс и все реплики самого гида двуязычны. Описания мест, их названия
 * и адреса остаются на русском намеренно: машинный перевод курированного контента
 * запрещён продуктовым решением, китайские карточки готовятся отдельно.
 */

'use strict';

// ── Строки интерфейса и реплики гида ─────────────────────────────────

const I18N = {
  ru: {
    wordmark: 'КМВ Гид · Пятигорск',
    proto: 'Прототип',
    askPlaceholder: 'Спросите гида',
    send: 'Отправить',
    voice: 'Спросить голосом',
    listening: 'Слушаю. Скажите, что вам нужно.',
    voiceDenied: 'Доступ к микрофону закрыт. Разрешите его в настройках браузера или наберите вопрос.',
    voiceFailed: 'Не расслышал. Попробуйте ещё раз или наберите вопрос.',
    voiceSending: 'Распознаю…',
    howto: 'Напишите вопрос своими словами или нажмите микрофон и скажите. Гид знает места, часы работы, дорогу и столики в ресторанах.',
    honest: '<b>Гид отвечает только со связью.</b> Сохранённый маршрут, адреса и телефоны останутся с вами и без интернета.',
    offlineBanner: 'Связи нет. Гид отвечать не может, но адреса, телефоны и часы уже загруженных мест на экране остаются.',
    opening: 'Какие сегодня планы?',
    openingLabel: 'Сегодня · Пятигорск',
    back: 'К гиду',
    thinking: 'Смотрю по базе…',

    // Часы и состояние
    hoursUnknown: 'часы не подтверждены',
    dayOff: 'сегодня выходной',
    opensAt: 'откроется в {time}',
    closedOpensAt: 'уже закрылось · откроется в {time}',
    breakUntil: 'перерыв до {time}',
    closesIn: 'закроется через {n} мин',
    openUntil: 'открыто до {time}',
    tillClose: 'до закрытия {n}',
    closedByThen: 'к этому времени закрыто · откроется в {time}',
    opensLater: 'к этому времени ещё закрыто · откроется в {time}',

    // Подписи данных
    hours: 'Часы',
    address: 'Адрес',
    phone: 'Телефон',
    price: 'Цена',
    onFoot: 'Идти пешком',
    when: 'Когда',
    guests: 'Гостей',
    onName: 'На имя',
    fieldDate: 'Дата',
    fieldTime: 'Время',
    fieldGuests: 'Гостей',
    fieldName: 'Имя',
    fieldPhone: 'Телефон',
    namePlaceholder: 'Как вас записать',

    // Действия
    details: 'Подробно',
    call: 'Позвонить',
    route: 'Маршрут · Яндекс.Карты',
    book: 'Забронировать столик',
    submitBooking: 'Отправить заявку',
    findNearby: 'Найти рядом',
    useGps: 'Определить по GPS',
    gpsWorking: 'Определяю…',
    noPhoto: 'Фотографии пока нет',

    // Порядок дня
    planAsk: 'Сколько у вас сегодня времени? Соберу день под это, а не наугад.',
    planLead: 'Собрал порядок на сегодня — <b>{n} {word}</b>. Время примерное, с дорогой между точками.',
    planLeadNoSights: 'Музеи на сегодня закрылись, но вот что работает прямо сейчас.',
    planLeadLate: 'Для полного дня уже поздно, но кое-что сегодня ещё успеваете.',
    planNextTitle: 'Что дальше',
    planNext: 'Порядок дня — прикидка по времени работы и дороге между точками, а не расписание. Скажите, если надо подвинуть время или убрать точку.',
    planUnsureTitle: 'Часы не подтверждены',
    planUnsure: 'У <b>{list}</b> в базе нет подтверждённых часов работы. Ставлю в порядок дня, но не обещаю, что там открыто, — перед выходом лучше проверить.',
    planLaterTitle: 'На сегодня уже не встаёт',
    planLater: 'Эти точки в сегодняшний порядок по времени не помещаются. Не убираю их: адрес, часы и телефон здесь же — по ним видно, что успеть завтра.',
    planLeadAllClosed: 'На сегодня всё уже закрыто или закрывается. Точки оставляю на экране: по часам и адресам видно, с чего начать завтра.',
    stopOne: 'остановка',
    stopFew: 'остановки',
    stopMany: 'остановок',
    kindPlace: 'место',

    // Еда
    foodAsk: 'Что именно ищем? Подберу по этому, а не наугад.',
    foodEmptyLead: 'По запросу «{type}» в базе пока пусто.',
    foodEmptyTitle: 'Честно',
    foodEmpty: 'В базе по Пятигорску нет ни одного проверенного места с категорией «<b>{type}</b>». Подсовывать близкое вместо запрошенного не буду — это ровно тот случай, когда гид должен сказать «не знаю». Категория появится, как только места проверят на месте.',
    foodListLead: 'Ближайшее к вам по запросу «{type}», считаю от точки «<b>{from}</b>». Смотрите на часы работы — до закрытия надо успеть дойти.',
    foodOneLead: 'По запросу «{type}» в базе пока одно проверенное место. Показываю его, а не разбавляю список тем, чего не проверял.',
    foodNoCoordsTitle: 'Адрес не подтверждён',
    foodNoCoords: 'У <b>{list}</b> в базе нет проверенного адреса — значит, и расстояние считать не от чего. Показываю в конце списка, чтобы вы про это место знали, но не веду вас туда наугад.',

    // Откуда считать
    originLead: 'Сначала — где вы сейчас.',
    originTitle: 'Откуда считать',
    originBody: 'Чтобы показать расстояние и сколько идти, а не просто список, нужно понять, откуда считать.',
    originFrom: 'Или откуда вы приехали',
    originManual: 'Если ни то ни другое — посмотрите на ближайшую табличку с адресом: улица и номер дома. Считать от произвольного адреса гид научится вместе с картой; пока точнее всего — кнопка выше или точка приезда.',
    originHere: 'вы здесь',
    gpsNoSupport: 'Браузер не умеет определять положение. Выберите ориентир ниже.',
    gpsFailed: 'Не получилось определить положение — доступ закрыт или сигнал слабый. Выберите ориентир ниже или напишите ближайший адрес.',

    // Честные ответы там, где источника нет
    transportLead: 'Про дорогу отвечу не полностью — и скажу, почему.',
    transportHaveTitle: 'Что есть',
    transportHave: 'В базе лежат черновики по электричкам линии Минводы–Пятигорск–Кисловодск, по трамваю и по городским маршруткам. Но расписания — это структурированные данные, а не текст для поиска: подключаются отдельным обновляемым источником, иначе гид будет уверенно называть неверное время отправления.',
    transportNowTitle: 'Что это значит сейчас',
    transportNow: 'Пока источник не подключён, я не назову вам время ближайшей электрички. Как только он появится, ответ на «как доехать» станет полноценным: маршрут, время в пути и стоимость.',

    medicalLead: 'Подбор санатория по диагнозу — сильная часть продукта, но не этого прототипа.',
    medicalWhyTitle: 'Почему',
    medicalWhy: 'Подбор работает на отдельной базе журнала «Курортная медицина» из balneo_bot. Она держится в собственном индексе и намеренно не смешивается с туристическим контентом, иначе поиск начинает путать контексты и выдавать про музеи в ответ на вопрос про показания.',
    medicalNextTitle: 'Что будет',
    medicalNext: 'В рабочей версии здесь спрашивают назначение врача или диагноз и показывают санатории с подходящим профилем лечения — с оговоркой, что это справка, а не медицинская рекомендация.',

    offlineLead: 'Связи нет — отвечать не могу.',
    offlineTitle: 'Что работает без интернета',
    offlineBody: 'Всё, что уже на экране: адреса, телефоны и часы. По телефону можно звонить прямо отсюда. Как появится сеть, продолжим.',

    unknownLead: 'Не нашёл ответа на «{q}» — и не буду придумывать.',
    unknownCanTitle: 'Что я сейчас умею',
    unknownCan: 'Собрать порядок дня по Пятигорску · подобрать, где поесть, с уточнением типа · рассказать про музеи и достопримечательности из базы · принять заявку на столик там, где партнёр её принимает.',
    unknownCantTitle: 'Чего пока нет',
    unknownCant: 'Расписаний транспорта, подбора санатория по диагнозу и китайских описаний мест. Это не забытые кнопки, а честно ещё не подключённые источники.',

    placeLead: 'Вот что знаю про «{title}».',

    // Заявка
    bookingLead: 'Оформим столик — {title}. Партнёр подтверждает вручную, обычно в течение 30–60 минут в рабочие часы.',
    bookingLabel: 'Заявка на столик',
    bookingPay: 'Оплата на месте. Предоплату через сайт мы не берём.',
    bookingNeedName: 'Без имени партнёр не сможет вас записать — заполните поле.',
    bookingNeedPhone: 'Без телефона партнёр не сможет подтвердить бронь — заполните поле.',
    bookingProto: 'Прототип · показать ответ партнёра',
    bookingSentLabel: 'Ждём подтверждения',
    bookingSent: 'Заявка ушла партнёру в Telegram. Обычно отвечают за 30–60 минут в рабочие часы. Если ответа не будет — позвоним сами.',
    bookingConfirmedLabel: 'Подтверждено',
    bookingConfirmed: 'Партнёр подтвердил бронь. Стол держат 20 минут после указанного времени. Оплата на месте.',
    bookingDeclinedLabel: 'Отказ',
    bookingDeclined: 'Партнёр не может принять на это время. Могу поискать соседние места или другое время в этом же заведении.',
    bookingWaitingLabel: 'Партнёр молчит',
    bookingWaiting: 'Прошло больше часа без ответа. Мы уже звоним партнёру. Если так и не ответит — предложу замену поблизости.',

    // Страница места
    checkedOn: 'Факты проверялись: {date}',
    inProgress: 'Карточка в работе — часть данных ещё не подтверждена',
    partnerConfirmed: 'Партнёр пилота',
    partnerCandidate: 'Кандидат в партнёры, договорённости нет',

    dataFailTitle: 'Данные не загрузились',
    dataFail: 'Не удалось прочитать <b>data/places.json</b>. Запустите «Обновить данные сайта.command» в папке проекта и обновите страницу.',

    langNote: 'Интерфейс и мои ответы переведены. Названия мест, адреса и описания остаются на русском: машинный перевод курированного контента мы не подставляем, китайские карточки готовятся отдельно.',

    food: {
      'завтрак': 'Завтрак', 'кофе': 'Кофе', 'десерт': 'Десерт',
      'комплексный обед': 'Комплексный обед', 'ужин': 'Ужин',
      'шашлык': 'Шашлык', 'хинкали': 'Хинкали', 'пиво': 'Пиво',
    },
    kind: {
      museum: 'музей', landmark: 'достопримечательность', cemetery: 'историческое место',
      cafe: 'кофейня', 'summer-cafe': 'летнее кафе', 'street-food': 'уличная еда',
      dental: 'стоматология',
    },
    shape: {
      open: 'Ещё не решил — предложи',
      half: 'После процедур, с 14:00',
      full: 'Гуляю весь день',
      transit: 'Проездом, до вечера',
    },
  },

  zh: {
    wordmark: '矿水城指南 · 皮亚季戈尔斯克',
    proto: '原型',
    askPlaceholder: '向导游提问',
    send: '发送',
    voice: '语音提问',
    listening: '正在聆听，请说出您的需求。',
    voiceDenied: '麦克风权限被拒绝。请在浏览器设置中开启，或直接输入问题。',
    voiceFailed: '没有听清。请再试一次，或直接输入问题。',
    voiceSending: '正在识别…',
    howto: '用自己的话输入问题，或者按住麦克风说出来。导游知道地点、营业时间、怎么走，以及餐厅订位。',
    honest: '<b>导游需要联网才能回答。</b> 已保存的路线、地址和电话在离线时仍然可用。',
    offlineBanner: '当前无网络。导游无法回答，但屏幕上已加载地点的地址、电话和营业时间仍然有效。',
    opening: '今天有什么计划？',
    openingLabel: '今天 · 皮亚季戈尔斯克',
    back: '返回导游',
    thinking: '正在查询…',

    hoursUnknown: '营业时间未确认',
    dayOff: '今天休息',
    opensAt: '{time} 开门',
    closedOpensAt: '已打烊 · {time} 开门',
    breakUntil: '休息至 {time}',
    closesIn: '{n} 分钟后打烊',
    openUntil: '营业至 {time}',
    tillClose: '距打烊还有 {n}',
    closedByThen: '那个时间已打烊 · {time} 开门',
    opensLater: '那个时间还没开门 · {time} 开门',

    hours: '营业时间',
    address: '地址',
    phone: '电话',
    price: '价格',
    onFoot: '步行',
    when: '预订时间',
    guests: '人数',
    onName: '姓名',
    fieldDate: '日期',
    fieldTime: '时间',
    fieldGuests: '人数',
    fieldName: '姓名',
    fieldPhone: '电话',
    namePlaceholder: '您的称呼',

    details: '详情',
    call: '拨打电话',
    route: '路线 · Yandex 地图',
    book: '预订餐位',
    submitBooking: '提交预订',
    findNearby: '找附近的',
    useGps: '用 GPS 定位',
    gpsWorking: '正在定位…',
    noPhoto: '暂无照片',

    planAsk: '您今天有多少时间？我按这个来安排，而不是随便给。',
    planLead: '今天的顺序安排好了 — <b>{n} 站</b>。时间是估算的，含路上时间。',
    planLeadNoSights: '博物馆今天已经关门了，但下面这些现在还开着。',
    planLeadLate: '安排一整天已经太晚，但有些地方今天还赶得上。',
    planNextTitle: '接下来',
    planNext: '这是按营业时间和路上时间做的估算，不是时刻表。需要调整时间或去掉某一站，直接说。',
    planUnsureTitle: '营业时间未确认',
    planUnsure: '<b>{list}</b> 在库里没有确认过的营业时间。我放进了安排，但不敢保证开门 — 出发前最好先确认。',
    planLaterTitle: '今天排不进时间',
    planLater: '这些地点按时间放不进今天的安排。但我不删掉它们：地址、营业时间和电话都在这里 — 看得出明天该从哪里开始。',
    planLeadAllClosed: '今天该关的都关了。地点仍然留在屏幕上：按营业时间和地址，能看出明天从哪儿开始。',
    stopOne: '站',
    stopFew: '站',
    stopMany: '站',
    kindPlace: '地点',

    foodAsk: '具体想吃什么？我按这个挑，而不是随便推荐。',
    foodEmptyLead: '关于「{type}」，库里暂时是空的。',
    foodEmptyTitle: '实话',
    foodEmpty: '皮亚季戈尔斯克的库里没有任何一家核实过的「<b>{type}</b>」。我不会拿相近的顶替您要的 — 这正是导游该说「不知道」的时候。等实地核实之后，这个分类就会出现。',
    foodListLead: '按「{type}」为您找的最近的地方，从「<b>{from}</b>」起算。请留意营业时间 — 要赶在关门前走到。',
    foodOneLead: '关于「{type}」，库里目前只有一家核实过的店。我只给这一家，不拿没核实过的凑数。',
    foodNoCoordsTitle: '地址未确认',
    foodNoCoords: '<b>{list}</b> 在库里没有核实过的地址，也就无从计算距离。放在列表最后是让您知道有这家，但不会让您盲目跑过去。',

    originLead: '先确认一下您现在在哪。',
    originTitle: '从哪里起算',
    originBody: '要给出距离和步行时间，而不只是一份名单，需要知道从哪里起算。',
    originFrom: '或者您是从哪里来的',
    originManual: '如果都不是 — 看一下最近的门牌：街名和门牌号。从任意地址起算要等地图接入之后；目前最准的还是上面的按钮或到达地点。',
    originHere: '您的位置',
    gpsNoSupport: '浏览器不支持定位。请在下面选择一个地点。',
    gpsFailed: '定位失败 — 权限被拒或信号太弱。请在下面选择地点，或写下最近的地址。',

    transportLead: '关于交通我只能部分回答 — 并说明原因。',
    transportHaveTitle: '现有的',
    transportHave: '库里有矿水城–皮亚季戈尔斯克–基斯洛沃茨克线路的市郊列车、有轨电车和市内小巴的草稿。但时刻表属于结构化数据，不是用来检索的文本：要单独接入可更新的数据源，否则导游会一本正经地说错发车时间。',
    transportNowTitle: '这意味着什么',
    transportNow: '数据源接入之前，我不会告诉您下一班列车几点开。等它接上，「怎么去」会给出完整答案：路线、耗时和票价。',

    medicalLead: '按病症挑选疗养院是产品的强项，但不是这个原型的部分。',
    medicalWhyTitle: '原因',
    medicalWhy: '这项功能建立在 balneo_bot 的《疗养医学》期刊数据库上。它保存在独立索引里，刻意不与旅游内容混在一起，否则检索会串味 — 问适应症却答博物馆。',
    medicalNextTitle: '将来会怎样',
    medicalNext: '正式版会在这里询问医生处方或诊断，并给出治疗方向匹配的疗养院 — 同时说明这是资料参考，不是医疗建议。',

    offlineLead: '没有网络 — 我无法回答。',
    offlineTitle: '离线时仍然可用的',
    offlineBody: '屏幕上已有的一切：地址、电话和营业时间。电话可以直接从这里拨出。网络恢复后我们继续。',

    unknownLead: '关于「{q}」我没有找到答案 — 也不会编造。',
    unknownCanTitle: '我现在会做的',
    unknownCan: '安排皮亚季戈尔斯克一天的顺序 · 先问清类型再挑吃饭的地方 · 讲库里的博物馆和景点 · 在合作商家接受预订的地方帮您提交餐位申请。',
    unknownCantTitle: '暂时没有的',
    unknownCant: '交通时刻表、按病症挑疗养院，以及地点的中文介绍。这不是忘了做的按钮，而是老实说还没接入的数据源。',

    placeLead: '关于「{title}」我知道的是这些。',

    bookingLead: '来订餐位 — {title}。合作商家人工确认，工作时间内通常 30–60 分钟回复。',
    bookingLabel: '餐位预订',
    bookingPay: '到店付款。我们不通过网站收取预付款。',
    bookingNeedName: '没有称呼，商家无法为您登记 — 请填写。',
    bookingNeedPhone: '没有电话，商家无法确认预订 — 请填写。',
    bookingProto: '原型 · 查看商家的回复',
    bookingSentLabel: '等待确认',
    bookingSent: '申请已发送到商家的 Telegram。工作时间内通常 30–60 分钟回复。如果没有回复，我们会主动打电话。',
    bookingConfirmedLabel: '已确认',
    bookingConfirmed: '商家已确认预订。到点后为您保留 20 分钟。到店付款。',
    bookingDeclinedLabel: '已婉拒',
    bookingDeclined: '商家这个时间无法接待。我可以找附近的地方，或同一家的其他时间。',
    bookingWaitingLabel: '商家未回复',
    bookingWaiting: '已经超过一小时没有回复。我们正在给商家打电话。如果仍然联系不上，我会推荐附近的替代方案。',

    checkedOn: '资料核实日期：{date}',
    inProgress: '资料整理中 — 部分内容尚未确认',
    partnerConfirmed: '试点合作商家',
    partnerCandidate: '候选合作商家，尚未达成合作',

    dataFailTitle: '数据未能加载',
    dataFail: '无法读取 <b>data/places.json</b>。请在项目文件夹中运行「Обновить данные сайта.command」，然后刷新页面。',

    langNote: '界面和我的回答已翻译。地点名称、地址和介绍仍为俄语：我们不提供机器翻译的内容，中文资料正在单独准备。',

    food: {
      'завтрак': '早餐', 'кофе': '咖啡', 'десерт': '甜点',
      'комплексный обед': '商务套餐', 'ужин': '晚餐',
      'шашлык': '烤肉串', 'хинкали': '格鲁吉亚菜', 'пиво': '啤酒',
    },
    kind: {
      museum: '博物馆', landmark: '景点', cemetery: '历史遗址',
      cafe: '咖啡馆', 'summer-cafe': '露天咖啡座', 'street-food': '小吃',
      dental: '牙科诊所',
    },
    shape: {
      open: '还没想好，你来推荐',
      half: '理疗之后，14:00 起',
      full: '走一整天',
      transit: '路过，待到傍晚',
    },
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
const tf = (key, vars) => String(t(key)).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
const dict = (group, key, fallback) =>
  (I18N[state.lang][group] && I18N[state.lang][group][key]) || I18N.ru[group][key] || fallback;

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

// Название заведения в базе уже бывает в кавычках («Кофейня «1908»»), поэтому
// снаружи их не добавляем — иначе получаются вложенные ёлочки.
const named = (title) => (/[«»"]/.test(title) ? title : `«${title}»`);

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
  const zh = state.lang === 'zh';
  if (metres < 900) {
    const m = Math.max(50, Math.round(metres / 50) * 50);
    return `≈ ${m} ${zh ? '米' : 'м'}`;
  }
  const km = (metres / 1000).toFixed(1);
  return `≈ ${zh ? km : km.replace('.', ',')} ${zh ? '公里' : 'км'}`;
}

function walkMinutes(metres) {
  return Math.max(3, Math.round(metres / 75)); // ~4,5 км/ч, курортный шаг в горку
}

const walkLabel = (metres) =>
  `${formatDistance(metres)} · ${walkMinutes(metres)} ${state.lang === 'zh' ? '分钟' : 'мин'}`;

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
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
// Полночь как момент закрытия — это 24:00, а не 00:00: «работает до 00:00» человек
// читает как «уже закрыто».
const clockLabel = (v) => (v === 1440 ? '24:00' : hhmm(v));

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
// opensAt / closesAt — минуты от полуночи сегодня (закрытие может быть больше 1440 у
// ночных заведений); null означает «не знаем». На них опирается порядок дня: он должен
// уметь сказать не только «открыто сейчас», но и «сколько останется, когда вы дойдёте».
function parseHours(raw, now = new Date()) {
  const unknown = { state: 'unknown', label: t('hoursUnknown'), raw: raw || null, dayOff: false, opensAt: null, closesAt: null };
  if (!raw) return unknown;

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

  const off = { state: 'closed', label: t('dayOff'), raw, dayOff: true, opensAt: null, closesAt: null };
  if (closedDays.has(today)) return off;

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

  if (schedule.size === 0) return unknown;
  if (!schedule.has(today)) return off;

  const [open, close] = schedule.get(today);
  const mins = now.getHours() * 60 + now.getMinutes();

  const base = { raw, dayOff: false, opensAt: open, closesAt: close };

  // Состояние формулируется действием: успею / не успею / когда откроется.
  if (mins < open) return { ...base, state: 'closed', label: tf('opensAt', { time: clockLabel(open) }) };
  if (mins >= close) return { ...base, state: 'closed', label: tf('closedOpensAt', { time: clockLabel(open) }) };
  if (breakWindow && mins >= breakWindow[0] && mins < breakWindow[1]) {
    return { ...base, state: 'closing', label: tf('breakUntil', { time: clockLabel(breakWindow[1]) }) };
  }
  if (close - mins <= 60) return { ...base, state: 'closing', label: tf('closesIn', { n: close - mins }) };
  return { ...base, state: 'open', label: tf('openUntil', { time: clockLabel(close) }) };
}

// Сколько времени остаётся, если прийти в момент `at`. Именно это, а не состояние
// «сейчас», должно стоять на табличке внутри порядка дня: человек читает план,
// а не текущую минуту.
function hoursAtArrival(hours, at) {
  if (hours.dayOff) return { ...hours, state: 'closed', label: t('dayOff') };
  if (hours.closesAt === null) return { ...hours, state: 'unknown', label: t('hoursUnknown') };
  if (at < hours.opensAt) return { ...hours, state: 'closed', label: tf('opensLater', { time: clockLabel(hours.opensAt) }) };
  if (at >= hours.closesAt) return { ...hours, state: 'closed', label: tf('closedByThen', { time: clockLabel(hours.opensAt) }) };
  const left = hours.closesAt - at;
  return {
    ...hours,
    state: left <= 60 ? 'closing' : 'open',
    label: tf('tillClose', { n: durationLabel(left) }),
  };
}

function durationLabel(mins) {
  const zh = state.lang === 'zh';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return zh ? `${h} 小时 ${m} 分钟` : `${h} ч ${m} мин`;
  if (h) return zh ? `${h} 小时` : `${h} ч`;
  return zh ? `${m} 分钟` : `${m} мин`;
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
  const hours = opts.hours || parseHours(place.hours);
  const dist = state.origin && place.coords ? haversine([state.origin.lat, state.origin.lng], place.coords) : null;

  const node = el('div', {
    class: `plate plate--place is-${hours.state}`,
    dataset: { id: place.id },
  });

  if (opts.label) node.append(el('span', { class: 'plate__label', text: opts.label }));

  node.append(
    el('button', {
      class: 'plate__title plate__title--btn',
      type: 'button',
      text: place.title,
      onclick: () => openSheet(place.id),
    })
  );

  if (place.address) node.append(el('p', { class: 'plate__meta', text: place.address }));

  const stateLine = el('span', { class: 'state', text: hours.label });

  const row = dataRow([
    [t('hours'), hours.raw],
    [t('onFoot'), dist !== null ? walkLabel(dist) : null],
  ]) || el('dl', { class: 'plate__data' });
  row.prepend(el('div', { class: 'pair' }, [stateLine]));
  node.append(row);

  // Телефона на карточке нет намеренно: столик в кофейне не бронируют звонком,
  // а человеку нужно знать не номер, а успеет ли он дойти до закрытия.
  const acts = el('div', { class: 'plate__acts' });
  acts.append(el('button', { class: 'act', type: 'button', text: t('details'), onclick: () => openSheet(place.id) }));
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

const titles = (list) => esc(list.map((p) => p.title).join(', '));

// Уточняющий шаг остаётся в ленте как часть разговора, но перестаёт быть краном:
// повторно ответить на уже отвеченный вопрос нельзя.
function settle(row, chosen) {
  for (const btn of row.querySelectorAll('button')) {
    btn.disabled = true;
    if (btn === chosen) btn.classList.add('is-chosen');
  }
}

// ── Реплика человека ─────────────────────────────────────────────────

function said(text) {
  // Первый экран уступает место разговору: кран съезжает вниз и становится строкой.
  document.body.classList.remove('is-start');
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

// ── Порядок дня ──────────────────────────────────────────────────────

// План строится из того, что реально есть в базе с подтверждённым адресом, а не по
// зашитому списку: добавили место в knowledge/ — оно само появляется в порядке дня.
const PLANS = {
  open:    { start: null,          stops: 2, food: true },
  half:    { start: 14 * 60 + 30,  stops: 2, food: true },
  full:    { start: 10 * 60,       stops: 4, food: true },
  transit: { start: null,          stops: 3, food: false },
};

const DAY_SHAPES = ['open', 'half', 'full', 'transit'];

// Позже этого часа новую точку в расписанный день по времени не поставить: к вечеру
// закрывается всё, а достопримечательности под открытым небом ночью — темнота.
// Точка при этом не исчезает: она уходит в блок «на сегодня уже не встаёт» с адресом
// и часами. Прятать место от человека нельзя — можно только честно назвать время.
const LAST_SIGHT_START = 20 * 60;

// Оценка времени на объект. Это прикидка для порядка дня, а не расписание.
const DURATION = { museum: 60, landmark: 40, cemetery: 30, cafe: 60, 'summer-cafe': 45, 'street-food': 20 };

const kindName = (sub) => dict('kind', sub, t('kindPlace'));

function askPlan() {
  respond(() => {
    const row = el('div', { class: 'type-row' },
      DAY_SHAPES.map((id) => {
        const btn = el('button', {
          class: 'type', type: 'button', text: dict('shape', id, id),
          onclick: () => { settle(row, btn); said(dict('shape', id, id)); answerPlan(id); },
        });
        return btn;
      })
    );
    turn(t('planAsk'), [row]);
  });
}

function answerPlan(kind) {
  respond(() => {
    const plan = PLANS[kind] || PLANS.open;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const sights = state.places.filter((p) => p.category === 'history');
    const eateries = state.places.filter((p) => p.category === 'restaurants');

    // Место с подтверждёнными часами идёт раньше места с неизвестными, открытое —
    // раньше закрытого. Но ни одно не выбрасывается: закрытое место — это тоже ответ,
    // у него есть адрес, часы и телефон, по которым человек решает сам.
    const RANK = { open: 0, closing: 1, unknown: 2, closed: 3 };
    const candidates = sights
      .map((p) => ({ place: p, hours: parseHours(p.hours, now) }))
      .sort((a, b) => RANK[a.hours.state] - RANK[b.hours.state]);

    // Время не может начаться в прошлом.
    const soonest = Math.ceil((nowMin + 20) / 30) * 30;
    let clock = Math.max(plan.start ?? 0, soonest);

    // Единственная причина не поставить точку по времени — человек придёт к закрытой
    // двери. «До закрытия 5 минут» — это не причина: это решение, которое принимает он.
    const stops = [];
    const later = [];
    for (const item of candidates) {
      const arrival = hoursAtArrival(item.hours, clock);
      // Часы неизвестны и уже вечер — сказать про такую точку нечего, а темнота реальна.
      const blind = item.hours.state === 'unknown' && clock > LAST_SIGHT_START;
      if (stops.length >= plan.stops || arrival.state === 'closed' || blind) { later.push(item); continue; }
      stops.push({ ...item, at: clock, arrival });
      clock += (DURATION[item.place.subcategory] || 45) + 20; // плюс дорога между точками
    }

    if (plan.food) {
      const meals = eateries
        .map((p) => ({ place: p, hours: parseHours(p.hours, now) }))
        .sort((a, b) => RANK[a.hours.state] - RANK[b.hours.state]);
      const meal = meals.find((x) => hoursAtArrival(x.hours, clock).state !== 'closed');
      if (meal) stops.push({ ...meal, at: clock, arrival: hoursAtArrival(meal.hours, clock) });
      else if (meals.length) later.push(meals[0]);
    }

    // Внутри порядка дня на табличке стоит не «открыто сейчас», а сколько останется,
    // когда человек дойдёт: «до закрытия 25 мин» — это решение, а «открыто» — нет.
    const plates = stops.map((s) =>
      placePlate(s.place, {
        label: `${hhmm(s.at)} · ${kindName(s.place.subcategory)}`,
        hours: s.arrival,
      })
    );

    const unsure = stops.filter((s) => s.hours.state === 'unknown').map((s) => s.place);
    if (unsure.length) plates.push(note(t('planUnsureTitle'), tf('planUnsure', { list: titles(unsure) })));

    if (later.length) {
      plates.push(note(t('planLaterTitle'), t('planLater')));
      for (const item of later) {
        plates.push(placePlate(item.place, { label: kindName(item.place.subcategory), hours: item.hours }));
      }
    }

    const sightsInPlan = stops.filter((s) => s.place.category === 'history').length;
    let lead;
    if (!stops.length) lead = t('planLeadAllClosed');
    else if (later.length && sightsInPlan === 0) lead = t('planLeadNoSights');
    else if (later.some((x) => !x.hours.dayOff && x.hours.state !== 'closed')) lead = t('planLeadLate');
    else {
      const n = stops.length;
      const word = state.lang === 'zh' ? '' : plural(n, t('stopOne'), t('stopFew'), t('stopMany'));
      lead = tf('planLead', { n, word });
    }

    plates.push(note(t('planNextTitle'), t('planNext')));

    turn(lead, plates);
  });
}

// ── Ветка еды ────────────────────────────────────────────────────────

const FOOD_TYPES = ['завтрак', 'кофе', 'десерт', 'комплексный обед', 'ужин', 'шашлык', 'хинкали', 'пиво'];

// Как человек может назвать тот же тип в свободном вопросе.
const FOOD_ALIASES = {
  'комплексный обед': ['комплексный обед', 'бизнес-ланч', 'бизнес ланч', 'ланч', 'обед', '午餐', '套餐'],
  'десерт': ['десерт', 'сладк', 'торт', 'мороженое', 'выпечк', 'пирожн', '甜点', '蛋糕', '冰淇淋'],
  'завтрак': ['завтрак', 'позавтракать', '早餐', '早饭'],
  'кофе': ['кофе', 'капучино', 'чай', '咖啡', '喝茶'],
  'ужин': ['ужин', 'поужинать', '晚餐', '晚饭'],
  'шашлык': ['шашлык', 'мангал', '烤肉', '烧烤'],
  'хинкали': ['хинкали', 'хачапури', 'грузинск', '格鲁吉亚'],
  'пиво': ['пиво', 'бар', 'паб', '啤酒', '酒吧'],
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

const foodName = (type) => dict('food', type, type);

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
      order.map((type) => {
        const btn = el('button', {
          class: `type${now.has(type) ? ' type--now' : ''}`,
          type: 'button',
          text: foodName(type),
          onclick: () => { settle(row, btn); said(foodName(type)); answerFood(type); },
        });
        return btn;
      })
    );
    turn(t('foodAsk'), [row]);
  });
}

function answerFood(type) {
  const matches = state.places.filter((p) => p.foodTypes.includes(type));

  if (!matches.length) {
    respond(() => {
      turn(
        tf('foodEmptyLead', { type: esc(foodName(type)) }),
        [note(t('foodEmptyTitle'), tf('foodEmpty', { type: esc(foodName(type)) }))]
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

    const noCoords = top.filter((x) => x.dist === Infinity).map((x) => x.place);
    if (noCoords.length) {
      plates.push(note(t('foodNoCoordsTitle'), tf('foodNoCoords', { list: titles(noCoords) })));
    }

    // Одно место — это не список вариантов, и делать вид, что выбор был, нечестно.
    const lead = top.length === 1
      ? tf('foodOneLead', { type: esc(foodName(type)) })
      : tf('foodListLead', { type: esc(foodName(type)), from: esc(state.origin.label) });

    turn(lead, plates);
  });
}

// ── Где вы находитесь ────────────────────────────────────────────────

function askLocation(nextType) {
  // Ориентиры — точки прибытия: от вокзала или аэропорта человек отсчитается,
  // от музея, в котором он не был, — нет.
  const gps = el('button', {
    class: 'act act--primary', type: 'button',
    text: t('useGps'),
  });

  const row = el('div', { class: 'type-row' },
    state.landmarks.map((p) => {
      const btn = el('button', {
        class: 'type', type: 'button', text: p.title,
        onclick: () => {
          setOrigin(p.coords[0], p.coords[1], p.title);
          settle(row, btn);
          gps.disabled = true;
          if (nextType) answerFood(nextType);
        },
      });
      return btn;
    })
  );

  gps.addEventListener('click', () => useGeolocation(gps, row, nextType));

  const body = el('div', { class: 'note' }, [
    el('p', { class: 'rule', text: t('originTitle') }),
    el('p', { text: t('originBody') }),
    el('div', { class: 'plate__acts note__acts' }, [gps]),
    el('p', { class: 'rule note__rule', text: t('originFrom') }),
    row,
    el('p', { class: 'note__aside', text: t('originManual') }),
  ]);

  turn(t('originLead'), [body]);
}

function useGeolocation(button, row, nextType) {
  if (!navigator.geolocation) {
    button.replaceWith(el('p', { class: 'field-error', text: t('gpsNoSupport') }));
    return;
  }
  const label = button.textContent;
  button.textContent = t('gpsWorking');
  button.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setOrigin(pos.coords.latitude, pos.coords.longitude, t('originHere'));
      button.textContent = label;
      settle(row, null);
      if (nextType) answerFood(nextType);
    },
    () => {
      button.textContent = label;
      button.disabled = false;
      button.after(el('p', { class: 'field-error', role: 'alert', text: t('gpsFailed') }));
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
    turn(t('transportLead'), [
      note(t('transportHaveTitle'), t('transportHave')),
      note(t('transportNowTitle'), t('transportNow')),
    ]);
  });
}

function answerMedical() {
  respond(() => {
    turn(t('medicalLead'), [
      note(t('medicalWhyTitle'), t('medicalWhy')),
      note(t('medicalNextTitle'), t('medicalNext')),
    ]);
  });
}

function answerOffline() {
  turn(t('offlineLead'), [note(t('offlineTitle'), t('offlineBody'))]);
}

function answerUnknown(query) {
  turn(tf('unknownLead', { q: esc(query) }), [
    note(t('unknownCanTitle'), t('unknownCan')),
    note(t('unknownCantTitle'), t('unknownCant')),
  ]);
}

// ── Заявка на столик ─────────────────────────────────────────────────

const BOOKING_STATES = {
  sent:      { label: 'bookingSentLabel',      body: 'bookingSent',      cls: 'is-await' },
  confirmed: { label: 'bookingConfirmedLabel', body: 'bookingConfirmed', cls: 'is-live' },
  declined:  { label: 'bookingDeclinedLabel',  body: 'bookingDeclined',  cls: 'is-closed' },
  waiting:   { label: 'bookingWaitingLabel',   body: 'bookingWaiting',   cls: 'is-closing' },
};

let bookingSeq = 0;

function startBooking(id) {
  const place = state.places.find((p) => p.id === id);
  if (!place) return;

  // Заявок в ленте может лежать несколько, поэтому id ошибки уникален: иначе
  // aria-describedby у второй формы указывает на сообщение первой.
  const errId = `bookingError-${++bookingSeq}`;
  const form = el('form', { class: 'form', novalidate: true });
  const err = el('p', { class: 'field-error', id: errId, role: 'alert' });

  const when = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10), autocomplete: 'off' });
  const time = el('input', { type: 'time', value: '19:00', autocomplete: 'off' });
  const guests = el('input', { type: 'number', min: '1', max: '20', value: '2', inputmode: 'numeric' });
  const name = el('input', { type: 'text', placeholder: t('namePlaceholder'), autocomplete: 'name', 'aria-describedby': errId });
  const phone = el('input', { type: 'tel', placeholder: '+7 …', autocomplete: 'tel', inputmode: 'tel', 'aria-describedby': errId });

  form.append(
    el('div', { class: 'form__row' }, [
      el('label', { class: 'field' }, [el('span', { text: t('fieldDate') }), when]),
      el('label', { class: 'field' }, [el('span', { text: t('fieldTime') }), time]),
    ]),
    el('div', { class: 'form__row' }, [
      el('label', { class: 'field' }, [el('span', { text: t('fieldGuests') }), guests]),
      el('label', { class: 'field' }, [el('span', { text: t('fieldName') }), name]),
    ]),
    el('label', { class: 'field' }, [el('span', { text: t('fieldPhone') }), phone]),
    err,
    el('div', { class: 'plate__acts' }, [
      el('button', { class: 'act act--primary', type: 'submit', text: t('submitBooking') }),
    ])
  );

  const plate = el('div', { class: 'plate' }, [
    el('span', { class: 'plate__label', text: t('bookingLabel') }),
    el('h3', { class: 'plate__title', text: place.title }),
    el('p', { class: 'plate__body', text: t('bookingPay') }),
    form,
  ]);

  // Проверяем сами, а не через required: браузерная подсказка на эмали выглядит
  // чужой, а сообщение должно называть, что именно и зачем нужно партнёру.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    for (const field of [name, phone]) field.removeAttribute('aria-invalid');
    const missing = !name.value.trim() ? [name, 'bookingNeedName'] : !phone.value.trim() ? [phone, 'bookingNeedPhone'] : null;
    if (missing) {
      err.textContent = t(missing[1]);
      missing[0].setAttribute('aria-invalid', 'true');
      missing[0].focus();
      return;
    }
    err.textContent = '';
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

  turn(tf('bookingLead', { title: esc(named(place.title)) }), [plate]);
}

function showBookingStatus(booking) {
  const shape = BOOKING_STATES[booking.status];
  const date = new Date(`${booking.when}T${booking.time}`);
  const human = Number.isNaN(date.valueOf())
    ? booking.when
    : date.toLocaleDateString(state.lang === 'zh' ? 'zh-CN' : 'ru-RU', { day: 'numeric', month: 'long' });

  state.bookings.set(booking.id, booking);

  const plate = el('div', { class: `plate ${shape.cls}` }, [
    el('span', { class: 'plate__label', text: t(shape.label) }),
    el('h3', { class: 'plate__title', text: booking.place.title }),
    el('p', { class: 'plate__body', text: t(shape.body) }),
    dataRow([
      [t('when'), `${human}, ${booking.time}`],
      [t('guests'), booking.guests],
      [t('onName'), booking.name],
      // Телефон показываем обратно: по нему партнёр будет звонить, и человек
      // должен увидеть, что номер записан без опечатки.
      [t('phone'), booking.phone],
    ]),
    booking.status === 'declined'
      ? el('div', { class: 'plate__acts' }, [
          el('button', { class: 'act', type: 'button', text: t('findNearby'), onclick: () => askFood() }),
        ])
      : null,
    // Прототип: настоящий ответ приходит от партнёра в Telegram. Здесь — переключатель,
    // чтобы можно было увидеть все состояния заявки. В рабочей версии этого блока нет.
    el('div', { class: 'plate__acts plate__acts--proto' }, [
      el('span', { class: 'plate__label plate__label--wide', text: t('bookingProto') }),
      ...Object.keys(BOOKING_STATES)
        .filter((s) => s !== booking.status)
        .map((s) =>
          el('button', {
            class: 'act', type: 'button', text: t(BOOKING_STATES[s].label),
            onclick: () => { plate.closest('.turn')?.remove(); showBookingStatus({ ...booking, status: s }); },
          })
        ),
    ]),
  ]);

  turn(null, [plate]);
}

// ── Страница места ───────────────────────────────────────────────────

let lastFocused = null;
let pushedSheet = false; // мы ли завели запись в истории, или человек пришёл по ссылке

function openSheet(id, opts = {}) {
  const place = state.places.find((p) => p.id === id);
  if (!place) return;

  const hours = parseHours(place.hours);
  const inner = document.getElementById('sheetInner');
  inner.replaceChildren();

  const back = el('button', { class: 'back', type: 'button', onclick: () => closeSheet() }, [
    el('span', { 'aria-hidden': 'true', text: '←' }), el('span', { text: t('back') }),
  ]);

  inner.append(
    el('div', { class: 'sheet__bar' }, [
      back,
      el('span', { class: `state sheet__state sheet__state--${hours.state}`, text: hours.label }),
    ]),
    place.photos.length
      ? el('img', { class: 'sheet__photo', src: place.photos[0], alt: place.title, loading: 'lazy' })
      : el('div', { class: 'sheet__nophoto', text: t('noPhoto') }),
    el('h2', { class: 'sheet__title', id: 'sheetTitle', text: place.title }),
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
            text: t('route'),
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
  if (place.updated) bits.push(tf('checkedOn', { date: place.updated }));
  if (place.status !== 'ready') bits.push(t('inProgress'));
  if (place.partner === 'confirmed') bits.push(t('partnerConfirmed'));
  else if (place.partner === 'candidate') bits.push(t('partnerCandidate'));
  if (bits.length) inner.append(el('p', { class: 'sheet__src', text: bits.join(' · ') }));

  lastFocused = document.activeElement;
  const sheet = document.getElementById('sheet');
  sheet.classList.add('is-open');
  sheet.scrollTop = 0;
  // Страница места — модальная: под ней ничего не должно ловить фокус и жесты.
  document.querySelector('.stage').inert = true;
  document.body.style.overflow = 'hidden';
  back.focus();
  if (opts.push !== false) { history.pushState({ place: id }, '', `?place=${encodeURIComponent(id)}`); pushedSheet = true; }
}

function closeSheet(fromPop) {
  const sheet = document.getElementById('sheet');
  if (!sheet.classList.contains('is-open')) return;
  sheet.classList.remove('is-open');
  document.querySelector('.stage').inert = false;
  document.body.style.overflow = '';
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;

  if (fromPop) return;
  // Закрыть — это ровно отменить открытие, поэтому снимаем свою запись из истории,
  // а не кладём поверх новую: иначе «назад» ходит по мусору.
  if (pushedSheet) { pushedSheet = false; history.back(); }
  else if (location.search) history.replaceState({}, '', location.pathname);
}

// ── Разбор свободного вопроса ────────────────────────────────────────

function ask(query) {
  const q = query.toLowerCase();

  const type = matchFoodType(q);
  if (type) return answerFood(type);
  if (/поесть|еда|покушать|ресторан|кафе|столов|перекус|голоден|吃|餐厅|饿/.test(q)) return askFood();
  if (/добрать|электрич|автобус|трамвай|маршрутк|аэропорт|вокзал|такси|доехать|怎么去|交通|机场|火车/.test(q)) return answerTransport();
  if (/санатор|диагноз|лечен|путёвк|путевк|показан|疗养|诊断|治疗/.test(q)) return answerMedical();
  if (/план|маршрут|успе|день|посмотреть|погулять|куда сходить|安排|路线|逛|看什么/.test(q)) return askPlan();

  const hit = state.places.find((p) => {
    const title = p.title.toLowerCase().replace(/[«»]/g, '');
    return q.includes(title.split(/[\s/]/)[0]) && title.split(/[\s/]/)[0].length > 3;
  });
  if (hit) return respond(() => turn(tf('placeLead', { title: esc(hit.title) }), [placePlate(hit)]));

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
  // Перевести уже выданные ответы задним числом нельзя, поэтому разговор начинается
  // заново — а не остаётся наполовину на прежнем языке.
  feed().replaceChildren();
  document.body.classList.add('is-start');
  document.getElementById('askHint').textContent = '';
  document.getElementById('langNote').textContent = lang === 'zh' ? t('langNote') : '';
}

// ── Голосовой ввод ───────────────────────────────────────────────────
// Это ввод вопроса, а не платный голосовой переводчик из пропуска за 3900 ₽:
// он бесплатен для всех и в биллинге с переводчиком не пересекается.
//
// Два пути к одному результату, чтобы покрыть как можно больше устройств:
//   1. Web Speech API — там, где браузер распознаёт сам: Chrome и Edge (десктоп
//      и Android), Safari 14.1+ (iOS и macOS). Ни трафика, ни задержки на наш сервер.
//   2. Запись микрофона и отправка на свой STT — везде, где браузер не умеет:
//      Firefox, старые вебвью, встроенные браузеры мессенджеров. Включается одной
//      константой ниже, как только у бэкенда появится эндпоинт.
//
// Контракт эндпоинта: POST multipart/form-data, поля `audio` (webm/ogg/mp4, как отдал
// MediaRecorder) и `lang` (`ru` | `zh`); ответ JSON `{ "text": "…" }`.
// Пока константа пуста, на таких браузерах кнопки нет: мёртвых элементов не держим.
const VOICE_ENDPOINT = '';

function voiceUI() {
  const mic = document.getElementById('askMic');
  const input = document.getElementById('askInput');
  const hint = document.getElementById('askHint');
  return {
    mic, input, hint,
    listening(on) {
      mic.classList.toggle('is-listening', on);
      mic.setAttribute('aria-pressed', String(on));
    },
    fail(err) {
      hint.textContent = err === 'not-allowed' || err === 'service-not-allowed' || err === 'NotAllowedError'
        ? t('voiceDenied')
        : t('voiceFailed');
    },
  };
}

function setupVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

  if (Recognition) return voiceInBrowser(Recognition);
  if (VOICE_ENDPOINT && canRecord) return voiceOnServer();
}

// Путь 1: распознаёт сам браузер.
function voiceInBrowser(Recognition) {
  const ui = voiceUI();
  ui.mic.hidden = false;
  let rec = null;

  ui.mic.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }

    rec = new Recognition();
    rec.lang = state.lang === 'zh' ? 'zh-CN' : 'ru-RU';
    rec.interimResults = true;
    rec.continuous = false;
    let failed = false;

    rec.onstart = () => { ui.listening(true); ui.hint.textContent = t('listening'); };
    rec.onresult = (e) => {
      let text = '';
      for (const result of e.results) text += result[0].transcript;
      ui.input.value = text;
    };
    rec.onerror = (e) => { failed = true; ui.fail(e.error); };
    rec.onend = () => {
      ui.listening(false);
      rec = null;
      if (!failed) ui.hint.textContent = '';
      if (!failed && ui.input.value.trim()) submitAsk();
    };

    try { rec.start(); } catch { rec = null; ui.listening(false); ui.fail(); }
  });
}

// Путь 2: пишем звук и отдаём его своему распознаванию. Нужен там, где браузер
// собственного распознавания не даёт, — и он же станет единственным путём, когда
// понадобится одинаковое качество и независимость от вендора браузера.
function voiceOnServer() {
  const ui = voiceUI();
  ui.mic.hidden = false;
  let recorder = null;

  ui.mic.addEventListener('click', async () => {
    if (recorder) { recorder.stop(); return; }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      ui.fail(e.name);
      return;
    }

    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstart = () => { ui.listening(true); ui.hint.textContent = t('listening'); };
    recorder.onstop = async () => {
      ui.listening(false);
      recorder = null;
      for (const track of stream.getTracks()) track.stop();
      if (!chunks.length) { ui.hint.textContent = ''; return; }

      ui.hint.textContent = t('voiceSending');
      const body = new FormData();
      body.append('audio', new Blob(chunks, { type: chunks[0].type }), 'question');
      body.append('lang', state.lang);
      try {
        const res = await fetch(VOICE_ENDPOINT, { method: 'POST', body });
        if (!res.ok) throw new Error(res.status);
        const { text } = await res.json();
        ui.hint.textContent = '';
        if (!text || !text.trim()) { ui.fail(); return; }
        ui.input.value = text.trim();
        submitAsk();
      } catch {
        ui.fail();
      }
    };

    try { recorder.start(); } catch { recorder = null; ui.listening(false); ui.fail(); }
  });
}

// ── Запуск ───────────────────────────────────────────────────────────

function submitAsk() {
  const input = document.getElementById('askInput');
  const value = input.value.trim();
  if (!value) return;
  said(value);
  input.value = '';
  document.getElementById('askHint').textContent = '';
  ask(value);
}

async function init() {
  document.getElementById('askForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAsk();
  });

  for (const btn of document.querySelectorAll('.lang button')) {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  }

  setupVoice();

  const syncOnline = () => document.body.classList.toggle('is-offline', !navigator.onLine);
  addEventListener('online', syncOnline);
  addEventListener('offline', syncOnline);
  syncOnline();

  addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('place');
    if (id) openSheet(id, { push: false }); else closeSheet(true);
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('sheet').classList.contains('is-open')) closeSheet();
  });

  try {
    const res = await fetch('data/places.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    state.places = data.places;
    state.landmarks = data.landmarks || [];
  } catch (err) {
    document.body.classList.remove('is-start');
    feed().append(el('section', { class: 'turn' }, [
      note(t('dataFailTitle'), t('dataFail')),
    ]));
    return;
  }

  applyLang();

  const id = new URLSearchParams(location.search).get('place');
  if (id) openSheet(id, { push: false });
}

init();
