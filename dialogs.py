#!/usr/bin/env python3
"""Хранение диалогов (вопрос/ответ) — заготовка схемы под архитектурное решение
в CLAUDE.md: «PostgreSQL, медицинские файлы, анкеты, диалоги, координаты,
история запросов — только на HandyHost (Россия)».

Сейчас сервер работал полностью stateless (ничего не сохранял). Это заготовка
на будущее, тем же способом, что privacy_gateway.py и consent.py: пишем схему
и логику заранее, чтобы миграция на HandyHost при покупке сервера была сменой
строки подключения (SQLite -> PostgreSQL), а не переделкой server.py заново.

ВАЖНО, честно:
- Пока это локальный SQLite-файл `dialogs.db` (в .gitignore, не версионируется,
  никуда не передаётся). Это НЕ production-хранилище и не заменяет требование
  архитектуры «диалоги — только на HandyHost» — как только сервер куплен, эти
  данные должны переехать в PostgreSQL на HandyHost, а не остаться в песочнице.
- Сохраняется УЖЕ ОБЕЗЛИЧЕННЫЙ вопрос (после privacy_gateway.scrub), а не
  исходный текст пользователя — так задумано: если в исходном тексте случайно
  оказались персональные данные, они не должны осесть даже во временном
  локальном логе. Сырой текст никогда не передаётся в этот модуль.
- Идентификация пользователя (`session_id`) — тот же нерешённый вопрос, что и
  в consent.py: в продукте пока нет аутентификации, ожидается какой-то
  стабильный идентификатор сессии/устройства от вызывающего кода.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "dialogs.db"


@dataclass
class DialogRecord:
    session_id: str
    lang: str
    clean_question: str
    answer: str
    place_ids: list[str]
    scrub_findings: str  # типы находок через запятую, напр. "PHONE,ADDRESS" — не сырые значения
    blocked: bool
    recorded_at: str


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dialogs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            lang TEXT NOT NULL,
            clean_question TEXT NOT NULL,
            answer TEXT NOT NULL,
            place_ids TEXT NOT NULL,      -- через запятую
            scrub_findings TEXT NOT NULL, -- через запятую, типы находок без сырых значений
            blocked INTEGER NOT NULL,
            recorded_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_dialogs_session ON dialogs(session_id)")
    return conn


def store_dialog(
    session_id: str,
    lang: str,
    clean_question: str,
    answer: str,
    place_ids: list[str],
    scrub_findings: list[str],
    blocked: bool,
    recorded_at: str,
) -> DialogRecord:
    record = DialogRecord(
        session_id=session_id,
        lang=lang,
        clean_question=clean_question,
        answer=answer,
        place_ids=place_ids,
        scrub_findings=",".join(scrub_findings),
        blocked=blocked,
        recorded_at=recorded_at,
    )
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO dialogs (session_id, lang, clean_question, answer, place_ids,
                                  scrub_findings, blocked, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record.session_id,
                record.lang,
                record.clean_question,
                record.answer,
                ",".join(record.place_ids),
                record.scrub_findings,
                int(record.blocked),
                record.recorded_at,
            ),
        )
    return record


def recent_dialogs(session_id: str, limit: int = 20) -> list[DialogRecord]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT session_id, lang, clean_question, answer, place_ids, scrub_findings, blocked, recorded_at
            FROM dialogs
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()
    return [
        DialogRecord(
            session_id=row[0],
            lang=row[1],
            clean_question=row[2],
            answer=row[3],
            place_ids=row[4].split(",") if row[4] else [],
            scrub_findings=row[5],
            blocked=bool(row[6]),
            recorded_at=row[7],
        )
        for row in rows
    ]


if __name__ == "__main__":
    import tempfile

    original_path = DB_PATH
    with tempfile.TemporaryDirectory() as tmp:
        globals()["DB_PATH"] = Path(tmp) / "dialogs_selftest.db"

        store_dialog(
            session_id="test-session-1",
            lang="ru",
            clean_question="Сколько стоит канатная дорога на Машук?",
            answer="220/380 руб. туда/обратно.",
            place_ids=["mashuk-kanatka"],
            scrub_findings=[],
            blocked=False,
            recorded_at="2026-08-10T12:00:00+03:00",
        )
        store_dialog(
            session_id="test-session-1",
            lang="ru",
            clean_question="Меня зовут [ИМЯ], живу на [АДРЕС]. Где кафе?",
            answer="Уточните местоположение.",
            place_ids=[],
            scrub_findings=["PERSON", "ADDRESS"],
            blocked=False,
            recorded_at="2026-08-10T12:05:00+03:00",
        )

        history = recent_dialogs("test-session-1")
        print(f"records: {len(history)}")
        for record in history:
            print(f"  [{record.recorded_at}] lang={record.lang} findings={record.scrub_findings!r} "
                  f"blocked={record.blocked} q={record.clean_question!r}")

        globals()["DB_PATH"] = original_path
