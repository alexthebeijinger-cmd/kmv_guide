#!/usr/bin/env bash
# Устанавливает git-хуки проекта. Запускать один раз после клонирования репозитория:
#   bash scripts/install-hooks.sh
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$ROOT_DIR/.git/hooks"

cat > "$HOOKS_DIR/pre-commit" <<'EOF'
#!/usr/bin/env bash
# Автоматически установлен scripts/install-hooks.sh — проверяет фронтматтер
# staged-карточек knowledge/*.md перед каждым коммитом.
python3 "$(git rev-parse --show-toplevel)/scripts/hooks/check_frontmatter.py"
EOF

chmod +x "$HOOKS_DIR/pre-commit"
echo "Хук pre-commit установлен: проверка фронтматтера knowledge/*.md перед коммитом."
