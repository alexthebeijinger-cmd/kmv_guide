#!/usr/bin/env python3
"""
Загрузчик контента knowledge/**/*.md в Qdrant Cloud (коллекция kmv_guide_tourist).

Что делает:
  1. Обходит knowledge/**/*.md (кроме SCHEMA.md/README.md — это не карточки объектов).
  2. Парсит YAML-фронтматтер (id, title, category, status, ...) + тело файла.
  3. Грузит ТОЛЬКО status: ready (см. SCHEMA.md, примечание 4) — черновики в боевую базу не попадают.
  4. Эмбеддит текст (frontmatter title/tags + тело файла) моделью multilingual-e5-large —
     она одинаково хорошо работает с русским и китайским текстом, что важно, т.к. в одном
     индексе в перспективе будут оба языка (см. открытый вопрос в PLAN.md/CLAUDE.md).
  5. Апсертит точку в Qdrant с payload = все поля фронтматтера + путь к файлу.

Модель эмбеддингов и размер вектора (1024) — рабочее допущение, см. PLAN.md,
раздел «Расходы и риски», п.3. Если решите другую модель — пересоздать коллекцию,
реального контента там пока нет.

Запуск:
    python3 scripts/load_qdrant.py            # грузит все status: ready
    python3 scripts/load_qdrant.py --dry-run  # только показывает, что было бы загружено
"""

import argparse
import os
import sys
from pathlib import Path

import frontmatter
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct
from sentence_transformers import SentenceTransformer

REPO_ROOT = Path(__file__).resolve().parent.parent
KNOWLEDGE_DIR = REPO_ROOT / "knowledge"
COLLECTION_NAME = "kmv_guide_tourist"
MODEL_NAME = "intfloat/multilingual-e5-large"  # 1024-dim, RU+ZH — см. docstring выше

# Файлы-справочники, не являющиеся карточками объектов — не грузим как точки.
SKIP_FILES = {
    "SCHEMA.md",
    "README.md",
    "OPEN-QUESTIONS.md",
    "CHECKLIST-24.md",
    "hmelnoy-voprosy-personalu.md",  # чек-лист вопросов персоналу для hmelnoy-restoran.md, не карточка объекта
}

# Обязательные поля фронтматтера для карточки, готовой к загрузке (см. knowledge/SCHEMA.md).
REQUIRED_FIELDS = ("id", "title", "category", "status")
VALID_CATEGORIES = {"history", "restaurants", "transport", "nature", "services", "auto"}


def load_env(env_path: Path) -> dict:
    """Простой парсер .env (KEY=VALUE построчно), без внешних зависимостей."""
    env = {}
    if not env_path.exists():
        return env
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env


def iter_markdown_files():
    for path in sorted(KNOWLEDGE_DIR.rglob("*.md")):
        if path.name in SKIP_FILES:
            continue
        yield path


def stable_point_id(slug: str) -> int:
    """Qdrant требует int или UUID как id точки. Делаем стабильный int из id-слага."""
    import hashlib

    digest = hashlib.sha256(slug.encode("utf-8")).hexdigest()
    # 63-битное положительное число из первых 16 hex-символов хэша
    return int(digest[:16], 16) % (2**63 - 1)


def build_embedding_text(post: frontmatter.Post) -> str:
    """multilingual-e5 требует префикс 'passage: ' для документов (не для запросов)."""
    title = post.get("title", "")
    tags = ", ".join(post.get("tags", []) or [])
    food_types = ", ".join(post.get("food_types", []) or [])
    body = post.content.strip()
    parts = [p for p in [title, tags, food_types, body] if p]
    return "passage: " + "\n\n".join(parts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="не грузить в Qdrant, только показать список")
    args = parser.parse_args()

    env = load_env(REPO_ROOT / ".env")
    qdrant_url = env.get("QDRANT_URL") or os.environ.get("QDRANT_URL")
    qdrant_key = env.get("QDRANT_API_KEY") or os.environ.get("QDRANT_API_KEY")

    if not args.dry_run and (not qdrant_url or not qdrant_key):
        print("Нет QDRANT_URL/QDRANT_API_KEY — проверь .env в корне репозитория.", file=sys.stderr)
        sys.exit(1)

    ready_posts = []
    skipped_not_ready = []
    invalid_posts = []
    id_to_paths = {}
    for path in iter_markdown_files():
        post = frontmatter.load(path)
        status = post.get("status")
        if status != "ready":
            skipped_not_ready.append((path.relative_to(REPO_ROOT), status))
            continue

        missing = [f for f in REQUIRED_FIELDS if not post.get(f)]
        if missing:
            invalid_posts.append((path.relative_to(REPO_ROOT), f"нет обязательных полей: {', '.join(missing)}"))
            continue

        category = post.get("category")
        if category not in VALID_CATEGORIES:
            invalid_posts.append((path.relative_to(REPO_ROOT), f"недопустимая category: {category!r}"))
            continue

        pid = post.get("id")
        if pid in id_to_paths:
            invalid_posts.append(
                (path.relative_to(REPO_ROOT), f"дубль id={pid!r} (уже используется в {id_to_paths[pid]})")
            )
            continue
        id_to_paths[pid] = path.relative_to(REPO_ROOT)

        ready_posts.append((path, post))

    print(f"Найдено файлов со status: ready — {len(ready_posts)}")
    print(f"Пропущено (не ready) — {len(skipped_not_ready)}")
    if invalid_posts:
        print(f"ОШИБКИ ВАЛИДАЦИИ (не грузятся, проверь перед публикацией) — {len(invalid_posts)}", file=sys.stderr)
        for path, reason in invalid_posts:
            print(f"  {path}: {reason}", file=sys.stderr)
    if args.dry_run:
        print("\n--- dry-run: будут загружены ---")
        for path, post in ready_posts:
            print(f"  {post.get('id')}  ({path.relative_to(REPO_ROOT)})")
        print("\n--- пропущены (status != ready) ---")
        for path, status in skipped_not_ready:
            print(f"  {path}  [{status}]")
        return

    if not ready_posts:
        print("Нечего грузить — нет файлов со status: ready.")
        return

    print(f"\nЗагружаю модель эмбеддингов {MODEL_NAME} (может занять пару минут при первом запуске)...")
    model = SentenceTransformer(MODEL_NAME)

    # Важно: без port=443 клиент по умолчанию бьёт в :6333 (grpc/rest порт self-hosted
    # Qdrant), которого нет у Qdrant Cloud за HTTPS — там открыт только 443.
    client = QdrantClient(url=qdrant_url, api_key=qdrant_key, port=443)

    points = []
    for path, post in ready_posts:
        text = build_embedding_text(post)
        vector = model.encode(text, normalize_embeddings=True).tolist()
        payload = dict(post.metadata)
        payload["file_path"] = str(path.relative_to(REPO_ROOT))
        points.append(
            PointStruct(
                id=stable_point_id(post.get("id")),
                vector=vector,
                payload=payload,
            )
        )
        print(f"  готово: {post.get('id')}")

    result = client.upsert(collection_name=COLLECTION_NAME, points=points)
    print(f"\nЗагружено точек: {len(points)}. Статус операции: {result.status}")


if __name__ == "__main__":
    main()
