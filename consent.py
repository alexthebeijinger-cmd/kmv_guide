#!/usr/bin/env python3
"""Учёт письменного согласия на обработку персональных данных, отдельно —
на данные о здоровье (специальная категория, ст. 10 152-ФЗ), см. решение
в CLAUDE.md, «Архитектура обработки персональных и медицинских данных»
(зафиксировано Alex, 10.08.2026).

Зачем отдельный модуль, а не просто чекбокс на фронтенде: закон требует,
чтобы согласие на данные о здоровье было оформлено в форме, которая
доказуемо фиксирует, КТО, КОГДА и С КАКИМ ИМЕННО ТЕКСТОМ согласился —
обычной галочки недостаточно. Модуль хранит версию и хэш текста согласия
вместе с фактом согласия, поэтому при изменении текста старые согласия
не подменяются задним числом.

ВАЖНО, честно (как и в privacy_gateway.py): это MVP-инфраструктура, не
готовый юридический продукт. Медицинского модуля, который реально
запрашивает согласие пользователя, в продукте ещё нет — это заготовка на
будущее, чтобы не откладывать закладку схемы данных до последнего момента.
Хранение сейчас — локальный SQLite-файл `consent.db` (в .gitignore, не
версионируется, не передаётся никуда). Как только куплен сервер HandyHost —
это должно переехать в PostgreSQL на HandyHost, а не остаться в песочнице
или тем более уехать на зарубежную инфраструктуру. Пока сервера нет — этот
файл живёт только там, где физически запущен сервис.

Идентификация пользователя (`user_id`) здесь не решена содержательно —
в продукте пока нет аутентификации/аккаунтов. Ожидается, что вызывающий
код (server.py или будущий медицинский модуль) передаёт какой-то стабильный
идентификатор сессии/устройства. Это отдельный нерешённый вопрос, не
подменяется этим модулем.
"""

from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "consent.db"

# Категории согласия. "health" — специальная категория по ст. 10 152-ФЗ,
# требует письменной формы отдельно от общего согласия на персональные данные.
VALID_CATEGORIES = {"general", "health"}


@dataclass
class ConsentRecord:
    user_id: str
    category: str
    text_version: str
    text_hash: str
    agreed: bool
    recorded_at: str  # ISO-строка, пишется вызывающим кодом (см. примечание про timestamp ниже)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS consent (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            category TEXT NOT NULL,
            text_version TEXT NOT NULL,
            text_hash TEXT NOT NULL,
            agreed INTEGER NOT NULL,
            recorded_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_consent_user_category ON consent(user_id, category)"
    )
    return conn


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def record_consent(
    user_id: str,
    category: str,
    consent_text: str,
    text_version: str,
    agreed: bool,
    recorded_at: str,
) -> ConsentRecord:
    """Фиксирует факт согласия (или отказа) с конкретным текстом.

    `recorded_at` передаётся вызывающим кодом в ISO-формате — модуль сам не
    берёт текущее время, чтобы не зависеть от системных часов процесса и
    оставаться тестируемым детерминированно.
    """
    if category not in VALID_CATEGORIES:
        raise ValueError(f"Неизвестная категория согласия: {category!r}")
    if not user_id.strip():
        raise ValueError("user_id не может быть пустым")
    if not consent_text.strip():
        raise ValueError("Текст согласия не может быть пустым")

    text_hash = _hash_text(consent_text)
    record = ConsentRecord(
        user_id=user_id,
        category=category,
        text_version=text_version,
        text_hash=text_hash,
        agreed=agreed,
        recorded_at=recorded_at,
    )

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO consent (user_id, category, text_version, text_hash, agreed, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (record.user_id, record.category, record.text_version, record.text_hash,
             int(record.agreed), record.recorded_at),
        )

    return record


def latest_consent(user_id: str, category: str) -> ConsentRecord | None:
    """Возвращает последнюю запись согласия пользователя по категории, если есть.

    Важно: возвращает именно последнюю запись, включая отказ (agreed=False),
    если пользователь отозвал согласие позже, чем дал его, — вызывающий код
    должен сам проверять поле `agreed`, а не сам факт наличия записи.
    """
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT user_id, category, text_version, text_hash, agreed, recorded_at
            FROM consent
            WHERE user_id = ? AND category = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id, category),
        ).fetchone()

    if row is None:
        return None

    return ConsentRecord(
        user_id=row[0],
        category=row[1],
        text_version=row[2],
        text_hash=row[3],
        agreed=bool(row[4]),
        recorded_at=row[5],
    )


def has_valid_consent(user_id: str, category: str) -> bool:
    """Удобный шорткат: есть ли действующее (последнее = agreed=True) согласие."""
    record = latest_consent(user_id, category)
    return record is not None and record.agreed


if __name__ == "__main__":
    import tempfile

    # Самотест на временной БД, чтобы не трогать рабочий consent.db.
    original_path = DB_PATH
    with tempfile.TemporaryDirectory() as tmp:
        globals()["DB_PATH"] = Path(tmp) / "consent_selftest.db"

        sample_text = "Я согласен(на) на обработку данных о состоянии здоровья в целях подбора рекомендаций..."
        rec = record_consent(
            user_id="test-user-1",
            category="health",
            consent_text=sample_text,
            text_version="2026-08-10-v1",
            agreed=True,
            recorded_at="2026-08-10T12:00:00+03:00",
        )
        print("recorded:", rec)

        latest = latest_consent("test-user-1", "health")
        print("latest:", latest)
        print("has_valid_consent:", has_valid_consent("test-user-1", "health"))

        # Отзыв согласия — новая запись, agreed=False, история не удаляется.
        record_consent(
            user_id="test-user-1",
            category="health",
            consent_text=sample_text,
            text_version="2026-08-10-v1",
            agreed=False,
            recorded_at="2026-08-11T09:00:00+03:00",
        )
        print("after revoke, has_valid_consent:", has_valid_consent("test-user-1", "health"))

        try:
            record_consent("", "health", sample_text, "v1", True, "2026-08-10T12:00:00+03:00")
        except ValueError as error:
            print("validation ok, rejected empty user_id:", error)

        globals()["DB_PATH"] = original_path
