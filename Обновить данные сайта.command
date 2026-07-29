#!/bin/bash
# Двойной клик — пересобрать данные сайта из knowledge/.
# Запускать каждый раз после добавления или правки точки.

cd "$(dirname "$0")" || exit 1

echo "Собираю данные сайта из knowledge/ ..."
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Не найден Node.js — без него сборку не запустить."
  echo "Поставьте его с https://nodejs.org (вариант LTS) и запустите этот файл снова."
  echo
  read -r -p "Нажмите Enter, чтобы закрыть окно."
  exit 1
fi

node scripts/build-data.mjs
status=$?

if [ $status -ne 0 ]; then
  echo
  echo "Сборка не прошла. Текст ошибки — выше."
fi

read -r -p "Нажмите Enter, чтобы закрыть окно."
