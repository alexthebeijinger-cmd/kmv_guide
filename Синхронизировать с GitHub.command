#!/bin/bash
REPO_DIR="/Users/alexey/Desktop/Balneo/code/kmv-guide"
cd "$REPO_DIR" || { echo "Не могу найти папку репозитория"; read -p "Нажми Enter..."; exit 1; }

echo "Синхронизирую: $REPO_DIR"
echo ""

echo "Подтягиваю изменения с GitHub..."
git pull origin main
echo ""

if [ -z "$(git status --porcelain)" ]; then
  echo "Локальных изменений нет — отправлять на GitHub нечего."
  read -p "Нажми Enter, чтобы закрыть окно..."
  exit 0
fi

echo "Локальные изменения:"
git status --short
echo ""

git add -A
git commit -m "Обновление $(date '+%Y-%m-%d %H:%M')"
git push origin main

echo ""
echo "Готово: изменения подтянуты и запушены в GitHub."
read -p "Нажми Enter, чтобы закрыть окно..."
