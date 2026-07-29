#!/usr/bin/env python3
"""
Тестовый поиск по коллекции kmv_guide_tourist — проверить, что RAG вообще находит
релевантные карточки на живой вопрос, до того как это подключат к боту.

Запуск:
    python3 scripts/query_qdrant.py "как подняться на Машук"
"""

import sys
from pathlib import Path

from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer

REPO_ROOT = Path(__file__).resolve().parent.parent
COLLECTION_NAME = "kmv_guide_tourist"
MODEL_NAME = "intfloat/multilingual-e5-large"


def load_env(env_path: Path) -> dict:
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


def main():
    if len(sys.argv) < 2:
        print('Использование: python3 scripts/query_qdrant.py "текст вопроса"')
        sys.exit(1)
    query_text = sys.argv[1]

    env = load_env(REPO_ROOT / ".env")
    model = SentenceTransformer(MODEL_NAME)
    client = QdrantClient(url=env["QDRANT_URL"], api_key=env["QDRANT_API_KEY"], port=443, timeout=30)

    vec = model.encode("query: " + query_text, normalize_embeddings=True).tolist()
    hits = client.query_points(collection_name=COLLECTION_NAME, query=vec, limit=5).points

    print(f"\nВопрос: {query_text}\n")
    for h in hits:
        print(f"  {h.score:.3f}  {h.payload.get('id')}  — {h.payload.get('title')}")


if __name__ == "__main__":
    main()
