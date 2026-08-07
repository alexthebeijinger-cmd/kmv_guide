#!/usr/bin/env python3
"""
Проверка YAML-фронтматтера карточек knowledge/*.md перед коммитом.
Правила — см. knowledge/SCHEMA.md.

Используется как git pre-commit hook (см. scripts/install-hooks.sh),
но можно запускать и вручную:
    python3 scripts/hooks/check_frontmatter.py [файл ...]
Без аргументов — проверяет staged-файлы (git diff --cached).
"""
import subprocess
import sys
import re
import yaml

REQUIRED_FIELDS = ["id", "title", "category", "subcategory", "status", "updated"]
ALLOWED_STATUS = {"draft", "needs_review", "ready"}
ALLOWED_CATEGORY = {
    "history", "restaurants", "transport", "nature", "services", "auto",
    "accommodation", "beauty", "degustatsii", "entertainment", "excursions",
    "infrastructure", "kids", "parks", "religion", "shopping", "sport",
}

# Файлы в knowledge/, которые не являются карточками объектов
SKIP_NAMES = {"SCHEMA.md", "OPEN-QUESTIONS.md", "README.md", "hmelnoy-voprosy-personalu.md"}
SKIP_PREFIXES = ("CHECKLIST",)


def get_staged_knowledge_files():
    out = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
        capture_output=True, text=True, check=True,
    ).stdout.splitlines()
    return [
        f for f in out
        if f.startswith("knowledge/") and f.endswith(".md")
        and f.split("/")[-1] not in SKIP_NAMES
        and not f.split("/")[-1].startswith(SKIP_PREFIXES)
    ]


def check_file(path: str) -> list[str]:
    errors = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        return [f"файл не найден: {path}"]

    m = re.match(r"^---\n(.*?\n)---\n", text, re.DOTALL)
    if not m:
        return [f"{path}: нет YAML-фронтматтера (---...---) в начале файла"]

    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError as e:
        return [f"{path}: YAML не парсится — {e}"]

    if not isinstance(data, dict):
        return [f"{path}: фронтматтер должен быть словарём полей"]

    for field in REQUIRED_FIELDS:
        if field not in data or data[field] in (None, ""):
            errors.append(f"{path}: отсутствует обязательное поле '{field}'")

    status = data.get("status")
    if status is not None and status not in ALLOWED_STATUS:
        errors.append(f"{path}: status='{status}' не входит в {sorted(ALLOWED_STATUS)}")

    category = data.get("category")
    if category is not None and category not in ALLOWED_CATEGORY:
        errors.append(f"{path}: category='{category}' не входит в разрешённый список (см. SCHEMA.md)")

    return errors


def main():
    files = sys.argv[1:] or get_staged_knowledge_files()
    if not files:
        return 0

    all_errors = []
    for f in files:
        all_errors.extend(check_file(f))

    if all_errors:
        print("Проверка фронтматтера knowledge/*.md — найдены проблемы:\n")
        for e in all_errors:
            print(f"  ✗ {e}")
        print("\nИсправь и попробуй закоммитить снова (или git commit --no-verify, если это осознанно).")
        return 1

    print(f"Фронтматтер OK ({len(files)} файл(ов) проверено).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
