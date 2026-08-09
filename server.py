#!/usr/bin/env python3
"""Бэкенд MVP «КМВ Гид»: RAG по туристической коллекции Qdrant + DeepSeek.

Секреты читаются только из .env на сервере. Браузер получает лишь готовый ответ
и id найденных карточек, поэтому ключи API в него не попадают.
"""

import json
import os
from functools import lru_cache
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer


ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
COLLECTION = "kmv_guide_tourist"
EMBEDDING_MODEL = "intfloat/multilingual-e5-large"
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_MODEL = "deepseek-v4-flash"
MAX_QUERY_LENGTH = 800


def load_env(path: Path) -> None:
    """Минимальный .env-парсер, чтобы не тащить отдельную зависимость."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


load_env(ROOT / ".env")


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"В .env не задан {name}")
    return value


@lru_cache(maxsize=1)
def qdrant() -> QdrantClient:
    return QdrantClient(
        url=required_env("QDRANT_URL"),
        api_key=required_env("QDRANT_API_KEY"),
        port=443,
        timeout=30,
    )


@lru_cache(maxsize=1)
def embedder() -> SentenceTransformer:
    return SentenceTransformer(EMBEDDING_MODEL)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=MAX_QUERY_LENGTH)
    lang: str = Field(default="ru", pattern="^(ru|zh)$")


class ChatResponse(BaseModel):
    answer: str
    place_ids: list[str]


def search(question: str) -> list[dict]:
    vector = embedder().encode("query: " + question, normalize_embeddings=True).tolist()
    result = qdrant().query_points(
        collection_name=COLLECTION,
        query=vector,
        limit=6,
        with_payload=True,
    )
    return [dict(point.payload or {}) for point in result.points]


def context_from(hits: list[dict]) -> str:
    rows = []
    for hit in hits:
        fields = {
            "ID": hit.get("id", ""),
            "Название": hit.get("title", ""),
            "Категория": hit.get("category", ""),
            "Адрес": hit.get("address", ""),
            "Часы": hit.get("hours", ""),
            "Теги": ", ".join(hit.get("tags", []) or []),
        }
        rows.append("\n".join(f"{key}: {value}" for key, value in fields.items() if value))
    return "\n\n---\n\n".join(rows)


def ask_deepseek(question: str, lang: str, hits: list[dict]) -> str:
    language = "简体中文" if lang == "zh" else "русском"
    context = context_from(hits)
    system = f"""Ты — «КМВ Гид» по Пятигорску. Отвечай на {language} языке.
Отвечай только по контексту ниже. Не придумывай адреса, часы, цены, маршруты,
медицинские факты или сведения, которых в контексте нет. Если данных недостаточно,
скажи это прямо. Пиши коротко: 1–3 предложения. Не используй Markdown-списки.
Не заявляй, что проверял интернет или актуальность данных.

КОНТЕКСТ КУРИРУЕМЫХ КАРТОЧЕК:\n{context or 'Подходящих карточек нет.'}"""
    body = json.dumps({
        "model": DEEPSEEK_MODEL,
        "temperature": 0.2,
        "max_tokens": 380,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": question},
        ],
    }).encode("utf-8")
    request = Request(
        DEEPSEEK_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {required_env('DEEPSEEK_API_KEY')}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=45) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"DeepSeek вернул HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError("Не удалось подключиться к DeepSeek") from error

    answer = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    if not answer:
        raise RuntimeError("DeepSeek вернул пустой ответ")
    return answer


app = FastAPI(title="КМВ Гид API", docs_url=None, redoc_url=None)


@app.get("/api/health")
def health() -> dict:
    """Не раскрывает секреты; проверяет, что конфигурация для запуска полная."""
    return {"ok": all(os.getenv(name) for name in ("QDRANT_URL", "QDRANT_API_KEY", "DEEPSEEK_API_KEY"))}


@app.post("/api/chat", response_model=ChatResponse)
def chat(data: ChatRequest) -> ChatResponse:
    question = data.question.strip()
    try:
        hits = search(question)
        answer = ask_deepseek(question, data.lang, hits)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail="Сервис поиска временно недоступен") from error

    # Карточки отображает фронтенд из локально собранных проверенных данных.
    place_ids = [str(hit["id"]) for hit in hits[:3] if hit.get("id")]
    return ChatResponse(answer=answer, place_ids=place_ids)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
