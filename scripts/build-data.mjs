#!/usr/bin/env node
// Собирает knowledge/**/*.md в web/data/places.json для сайта.
// Запускать после каждого добавления точки: двойной клик по «Обновить данные сайта.command».
//
// Ничего не выдумывает: берёт только то, что написано во фронтматтере и в теле файла.
// Чего нет — то и не появится, а появится честная пометка «не подтверждено».

import { readdir, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KNOWLEDGE = join(ROOT, 'knowledge');
const OUT_DIR = join(ROOT, 'web', 'data');
const PHOTO_DIR = join(OUT_DIR, 'photos');

// Файлы-коллекции описывают несколько объектов сразу (knowledge/SCHEMA.md, примечание 3).
// Точками на карте они не являются — в places.json не попадают.
const COLLECTIONS = new Set([
  'byuvety-pyatigorska',
  'terrenkury-mashuk',
  'tramvay-pyatigorsk',
  'avtobusy-marshrutki',
  'elektrichki-kmv',
]);

const log = { warn: [], info: [] };

// ── Минимальный парсер YAML-фронтматтера ────────────────────────────
// Поддерживает ровно то, что описано в knowledge/SCHEMA.md: скаляры,
// null, кавычки и плоские списки. Ничего сверх — намеренно.

// Отрезает комментарий в конце строки. Внутри кавычек «#» — обычный символ,
// поэтому сначала пропускаем закавыченную часть целиком.
function stripComment(raw) {
  const v = raw.trim();
  const quote = v[0];
  if (quote === '"' || quote === "'") {
    const close = v.indexOf(quote, 1);
    if (close !== -1) return v.slice(0, close + 1);
    return v;
  }
  const hash = v.search(/\s#/);
  return hash === -1 ? v : v.slice(0, hash).trim();
}

function parseScalar(raw) {
  const v = stripComment(raw);
  if (v === '' || v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('[')) {
    const inner = v.slice(1, v.indexOf(']') === -1 ? v.length : v.indexOf(']'));
    if (!inner.trim()) return [];
    return inner
      .split(',')
      .map((s) => parseScalar(s))
      .filter((s) => s !== null);
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseFrontmatter(text, file) {
  if (!text.startsWith('---')) {
    log.warn.push(`${file}: нет фронтматтера — файл пропущен`);
    return null;
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    log.warn.push(`${file}: фронтматтер не закрыт строкой «---» — файл пропущен`);
    return null;
  }
  const head = text.slice(3, end);
  const body = text.slice(text.indexOf('\n', end + 1) + 1);

  const data = {};
  for (const line of head.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    data[line.slice(0, colon).trim()] = parseScalar(line.slice(colon + 1));
  }
  return { data, body };
}

// ── Вытаскиваем короткое описание из тела ───────────────────────────
// Приоритет: «## Кратко» → «## Описание» → первый абзац после заголовка.

function extractSummary(body) {
  const sections = body.split(/^##\s+/m);
  const preferred = ['Кратко', 'Описание'];
  for (const want of preferred) {
    const hit = sections.find((s) => s.startsWith(want));
    if (hit) {
      const text = hit.slice(want.length).trim();
      const para = text.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith('-'));
      if (para) return clean(para);
    }
  }
  const afterTitle = body.replace(/^#\s+.*$/m, '');
  const para = afterTitle
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('#') && !p.startsWith('**') && !p.startsWith('-'));
  return para ? clean(para) : null;
}

function clean(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // ссылки → текст
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Разделы тела, которые нужны читателю на странице места.
// Служебные («Для контента гида», «Открыто», «Источники») — внутренние заметки, наружу не идут.
const INTERNAL = /^(Для контента гида|Открыто|Источники|Статус|Примечание)/i;

function extractSections(body) {
  const out = [];
  const parts = body.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = part.slice(0, nl === -1 ? undefined : nl).trim();
    if (INTERNAL.test(heading)) continue;
    const text = part.slice(nl + 1).trim();
    if (!text) continue;
    out.push({ heading, text: clean(text) });
  }
  return out;
}

// ── Обход knowledge/ ─────────────────────────────────────────────────

async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'photos') continue;
      found.push(...(await walk(full)));
    } else if (entry.name.endsWith('.md') && !['README.md', 'SCHEMA.md'].includes(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

// ── Сборка ───────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(KNOWLEDGE)) {
    console.error('Не нашёл папку knowledge/. Запускайте скрипт из репозитория проекта.');
    process.exit(1);
  }

  // Приблизительные координаты на время прототипа. По knowledge/SCHEMA.md
  // (примечание 1) настоящие coords приходят из геокодера по address —
  // этот файл существует только чтобы прототип мог считать расстояния,
  // и должен быть заменён геокодированием.
  let coordsOverride = {};
  const coordsFile = join(OUT_DIR, 'coords.prototype.json');
  if (existsSync(coordsFile)) {
    coordsOverride = JSON.parse(await readFile(coordsFile, 'utf8'));
  }

  const files = (await walk(KNOWLEDGE)).sort();
  const places = [];
  const noAddress = [];
  let skippedCollections = 0;

  for (const file of files) {
    const rel = relative(ROOT, file);
    const parsed = parseFrontmatter(await readFile(file, 'utf8'), rel);
    if (!parsed) continue;

    const { data, body } = parsed;
    if (!data.id) {
      log.warn.push(`${rel}: нет поля id — файл пропущен`);
      continue;
    }
    if (COLLECTIONS.has(data.id)) {
      skippedCollections++;
      continue;
    }

    // Правило Alex (июль 2026): без подтверждённого адреса место в базу не идёт.
    // Иначе гид отправляет человека туда, где сам не уверен, что оно находится.
    if (!data.address) {
      noAddress.push(`${data.title || data.id} (${rel})`);
      continue;
    }

    const photos = [];
    for (const p of data.photos || []) {
      const src = join(dirname(file), p);
      if (!existsSync(src)) {
        log.warn.push(`${rel}: фото не найдено — ${p}`);
        continue;
      }
      const flat = `${data.id}-${basename(p)}`;
      photos.push(`data/photos/${flat}`);
      await copyFile(src, join(PHOTO_DIR, flat));
    }

    const coords = coordsOverride[data.id]?.coords || data.coords || null;

    const place = {
      id: data.id,
      title: data.title || data.id,
      category: data.category || null,
      subcategory: data.subcategory || null,
      status: data.status || 'draft',
      partner: data.partner_status || 'none',
      address: data.address || null,
      phone: data.phone || null,
      hours: data.hours || null,
      price: data.price || null,
      tags: data.tags || [],
      foodTypes: data.food_types || [],
      // Заявку на столик показываем только там, где она осмысленна и явно включена.
      booking: data.booking === true,
      photos,
      coords,
      coordsSource: coords ? (coordsOverride[data.id] ? 'prototype' : 'file') : null,
      summary: extractSummary(body),
      sections: extractSections(body),
      updated: data.updated || null,
      source: rel,
    };

    if (!place.hours) log.info.push(`${place.title}: часы не заполнены — покажу «часы не подтверждены»`);
    if (!place.coords) log.info.push(`${place.title}: нет координат — покажу без расстояния`);
    if (place.foodTypes.length === 0 && place.category === 'restaurants') {
      log.info.push(`${place.title}: не указан food_types — не попадёт в подбор по типу еды`);
    }

    places.push(place);
  }

  // Точки прибытия для ситуации «GPS не сработал»: аэропорт, вокзалы.
  const landmarks = coordsOverride.__landmarks || [];

  await writeFile(
    join(OUT_DIR, 'places.json'),
    JSON.stringify({ generated: new Date().toISOString().slice(0, 10), landmarks, places }, null, 2),
    'utf8'
  );

  console.log(`\nСобрано мест: ${places.length}`);
  console.log(`Пропущено файлов-коллекций (несколько объектов в одном файле): ${skippedCollections}`);
  console.log(`Фотографий скопировано: ${places.reduce((n, p) => n + p.photos.length, 0)}`);

  if (noAddress.length) {
    console.log(`\nНЕ ПОПАЛИ В БАЗУ — не заполнен адрес (${noAddress.length}):`);
    for (const n of noAddress) console.log(`  × ${n}`);
    console.log('  Впишите address в шапку файла, и место вернётся на сайт.');
  }

  if (log.warn.length) {
    console.log('\nПроблемы, которые стоит поправить:');
    for (const w of log.warn) console.log(`  ! ${w}`);
  }
  if (log.info.length) {
    console.log('\nНеполные данные (не ошибка, но сайт покажет пропуск честно):');
    for (const i of log.info) console.log(`  · ${i}`);
  }
  console.log('\nГотово. Обновите страницу в браузере.\n');
}

await mkdir(PHOTO_DIR, { recursive: true });
await rm(PHOTO_DIR, { recursive: true, force: true });
await mkdir(PHOTO_DIR, { recursive: true });
await main();
