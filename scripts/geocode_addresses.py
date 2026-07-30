#!/usr/bin/env python3
"""
Геокодирование адресов карточек знаний КМВ Гид через Nominatim (OpenStreetMap).

Логика:
- Проходит по всем .md файлам в knowledge/ (кроме служебных: OPEN-QUESTIONS.md, README.md, CHECKLIST-24.md).
- Парсит YAML frontmatter, берёт поле address.
- Пропускает объекты с явно "плохим" адресом (null, расплывчатый текст без улицы/дома,
  "точный адрес — уточнить" и т.п.) — они требуют ручной геопривязки через Яндекс.Карты.
- Для остальных — запрос к Nominatim, санити-чек результата (координаты должны попадать
  в широкий bounding box региона КМВ), запись [lat, lon] в поле coords.
- Уважает лимит Nominatim: не более 1 запроса в секунду, обязательный User-Agent.
- Ничего не перезаписывает, если coords уже не null (защита от повторного запуска).

Результат — отчёт в консоль + CSV с итогами (успех/пропуск/ошибка) для ручной проверки.
"""

import re
import sys
import time
import csv
import urllib.parse
import urllib.request
import json
from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge"
SKIP_FILES = {"OPEN-QUESTIONS.md", "README.md", "CHECKLIST-24.md"}

# Широкий bounding box региона КМВ (Пятигорск, Железноводск, Ессентуки, Кисловодск,
# Минеральные Воды, плюс запас на Эльбрус/Джилы-Су для дальних экскурсионных объектов)
LAT_MIN, LAT_MAX = 42.9, 44.3
LON_MIN, LON_MAX = 42.0, 44.3

# Явные маркеры "плохого" адреса — не отправляем в геокодер, сразу в ручную очередь
BAD_ADDRESS_MARKERS = [
    "null",
    "уточнить",
    "расходится между картами",
    "конкретные точки в теле карточки",
    "по всему",
]

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "kmv-guide-geocoding-script/1.0 (contact: alexthebeijinger@gmail.com)"


def parse_frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not m:
        return None, None, None
    fm_text = m.group(1)
    fm_end = m.end()
    address_m = re.search(r'^address:\s*(.*)$', fm_text, re.MULTILINE)
    coords_m = re.search(r'^coords:\s*(.*)$', fm_text, re.MULTILINE)
    address = address_m.group(1).strip() if address_m else None
    coords = coords_m.group(1).strip() if coords_m else None
    return address, coords, fm_end


def clean_address(raw):
    if raw is None:
        return None
    # снимаем кавычки
    v = raw.strip()
    if v.startswith('"') and v.endswith('"'):
        v = v[1:-1]
    # сначала убираем скобки-примечания, ПОТОМ режем по тире — иначе тире
    # внутри скобок ("точный номер дома — уточнить") обрубает адрес раньше времени
    v = re.sub(r"\([^)]*\)", "", v).strip()
    v = re.split(r"\s+—\s+", v)[0]
    v = re.sub(r"#.*$", "", v).strip()
    v = re.sub(r"\s{2,}", " ", v).strip(" ,;")
    return v


def simplify_address(v):
    """Второй, упрощённый вариант адреса — только улица+номер дома, без ТЦ/этажей/строений."""
    if v is None:
        return None
    s = v
    s = re.sub(r",?\s*(этаж|эт\.)\s*\d+", "", s, flags=re.IGNORECASE)
    s = re.sub(r",?\s*(корп\.?|корпус)\s*\d+", "", s, flags=re.IGNORECASE)
    s = re.sub(r",?\s*(стр\.?|строение)\s*\d+", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+ст\d+", "", s)
    s = re.sub(r",\s*ТЦ\s*«[^»]*»", "", s)
    s = re.sub(r",\s*ТЦ\s*[^,]*", "", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" ,;")
    return s


def is_bad_address(v):
    if v is None:
        return True
    low = v.lower()
    return any(marker in low for marker in BAD_ADDRESS_MARKERS)


def geocode(address):
    query = f"{address}"
    params = {
        "q": query,
        "format": "json",
        "limit": 1,
        "addressdetails": 0,
    }
    url = NOMINATIM_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return None, f"error: {e}"
    if not data:
        return None, "not_found"
    item = data[0]
    lat, lon = float(item["lat"]), float(item["lon"])
    if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
        return None, f"out_of_bbox ({lat},{lon})"
    return (lat, lon), "ok"


def main():
    dry_run = "--apply" not in sys.argv

    files = sorted(
        p for p in KNOWLEDGE_DIR.rglob("*.md")
        if p.name not in SKIP_FILES
    )

    results = []
    updated = 0
    skipped_bad_address = 0
    skipped_has_coords = 0
    failed = 0

    for path in files:
        text = path.read_text(encoding="utf-8")
        address, coords, fm_end = parse_frontmatter(text)
        rel = path.relative_to(KNOWLEDGE_DIR.parent)

        if coords is not None and coords != "null":
            skipped_has_coords += 1
            results.append([str(rel), address, "skip_has_coords", coords])
            continue

        clean = clean_address(address)
        if is_bad_address(clean):
            skipped_bad_address += 1
            results.append([str(rel), address, "skip_bad_address", ""])
            continue

        def with_city(q):
            return q if ("Пятигорск" in q or "Ставропольский" in q or "Кабардино" in q or "Черкес" in q) else f"{q}, Пятигорск"

        full_query = with_city(clean)
        latlon, status = geocode(full_query)
        time.sleep(1.1)  # уважаем rate limit Nominatim

        if latlon is None:
            simplified = simplify_address(clean)
            if simplified and simplified != clean:
                latlon2, status2 = geocode(with_city(simplified))
                time.sleep(1.1)
                if latlon2 is not None:
                    latlon, status = latlon2, f"ok_simplified({status})"

        if latlon is None:
            failed += 1
            results.append([str(rel), address, f"fail_{status}", ""])
            continue

        lat, lon = latlon
        results.append([str(rel), address, "ok", f"[{lat}, {lon}]"])
        updated += 1

        if not dry_run:
            new_coords_line = f"coords: [{lat}, {lon}]"
            new_text = re.sub(r"^coords:\s*.*$", new_coords_line, text, count=1, flags=re.MULTILINE)
            path.write_text(new_text, encoding="utf-8")

    # отчёт
    print(f"Всего файлов: {len(files)}")
    print(f"Уже с координатами (пропущено): {skipped_has_coords}")
    print(f"Плохой адрес (в ручную очередь): {skipped_bad_address}")
    print(f"Успешно геокодировано: {updated}")
    print(f"Не найдено / ошибка: {failed}")
    print(f"Режим: {'DRY RUN (файлы не изменены, добавь --apply чтобы записать)' if dry_run else 'ПРИМЕНЕНО — файлы обновлены'}")

    csv_path = Path(__file__).resolve().parent / "geocode_report.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "address", "status", "coords"])
        w.writerows(results)
    print(f"Подробный отчёт: {csv_path}")


if __name__ == "__main__":
    main()
