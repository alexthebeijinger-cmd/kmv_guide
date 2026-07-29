#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

if [ -z "$(git status --porcelain)" ]; then
  echo "Нет изменений — коммитить нечего."
  exit 0
fi

echo "Изменения:"
git status --short
echo ""

git add -A

MSG="${1:-Обновление $(date '+%Y-%m-%d %H:%M')}"
git commit -m "$MSG"
git push origin main
echo "Готово: изменения запушены в GitHub."
