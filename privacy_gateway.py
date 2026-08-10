#!/usr/bin/env python3
"""Шлюз обезличивания — препроцессор перед любым обращением к зарубежным LLM
(DeepSeek/Gemini/Claude), см. архитектурное решение в CLAUDE.md, раздел
«Архитектура обработки персональных и медицинских данных» (зафиксировано
Alex, 10.08.2026).

Что делает:
- Вырезает/маскирует ФИО, телефон, e-mail, адрес, координаты, номера документов
  (паспорт, СНИЛС, ИНН) регулярными правилами + NER (Natasha, PER/LOC).
- Оценивает риск повторной идентификации по количеству специфичных медицинских
  параметров в одном запросе (диагнозы, лабораторные показатели, возраст) —
  при превышении порога запрос БЛОКИРУЕТСЯ целиком, а не частично маскируется.
- Ничего не отправляет никуда сам — это чистая функция text -> ScrubResult,
  вызывающий код (server.py) решает, что делать с результатом.

ВАЖНО, честно: это MVP-эвристика, а не сертифицированное решение по методам
обезличивания из приказа Роскомнадзора №140 от 19.06.2025. Она снижает риск,
но не гарантирует необратимость обезличивания. Пока через сервис не проходят
реальные медицинские данные пользователей (текущий server.py — только
турконтент RAG, без сбора персональных данных), это — заготовка для модуля
подбора санатория по диагнозу, который ещё не написан. Перед тем как этот
модуль реально начнёт видеть персональные/медицинские данные — нужен
юридический ревью этого файла, не только технический.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache


@dataclass
class Finding:
    kind: str          # PHONE / EMAIL / PASSPORT / SNILS / INN / COORDS / ADDRESS / PERSON
    original: str       # сам найденный фрагмент (для лога на HandyHost, не для отправки вовне)
    replacement: str    # чем заменяется в очищенном тексте


@dataclass
class ScrubResult:
    clean_text: str
    findings: list[Finding] = field(default_factory=list)
    blocked: bool = False
    block_reason: str | None = None

    @property
    def has_pii(self) -> bool:
        return bool(self.findings)


# ---------------------------------------------------------------------------
# Регулярные детекторы — дешёвые, детерминированные, идут первыми.
# ---------------------------------------------------------------------------

PHONE_RE = re.compile(
    r"(?:\+7|8|7)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}"
)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-zA-Z]{2,}")
SNILS_RE = re.compile(r"\b\d{3}[\s\-]\d{3}[\s\-]\d{3}[\s\-]\d{2}\b")
INN_RE = re.compile(r"\bИНН\s*[:№]?\s*\d{10,12}\b", re.IGNORECASE)
PASSPORT_RE = re.compile(
    r"\bпаспорт[а-я]*\s*(?:серия|сери[ия])?\s*[:№]?\s*\d{2}\s?\d{2}\s*(?:номер|№)?\s*\d{6}\b",
    re.IGNORECASE,
)
# Координаты в формате [44.03, 43.07] или "44.03, 43.07" — характерный вид пары float рядом.
COORDS_RE = re.compile(r"[-+]?\d{1,3}\.\d{3,8}\s*,\s*[-+]?\d{1,3}\.\d{3,8}")
# Улица/проспект/переулок + номер дома — регулярка ловит то, что NER LOC часто пропускает.
ADDRESS_RE = re.compile(
    r"(?:ул\.|улица|просп\.|проспект|пер\.|переулок|бульвар|бул\.|шоссе|наб\.|набережная)"
    r"\s+[А-ЯЁа-яё\-\s]{2,30}?,?\s*\d{1,4}[а-яА-Я]?(?:\s*(?:ст|стр|корп)\.?\s*\d+)?",
    re.IGNORECASE,
)

_REGEX_DETECTORS: list[tuple[str, re.Pattern, str]] = [
    ("PASSPORT", PASSPORT_RE, "[НОМЕР ДОКУМЕНТА]"),
    ("SNILS", SNILS_RE, "[СНИЛС]"),
    ("INN", INN_RE, "[ИНН]"),
    ("EMAIL", EMAIL_RE, "[EMAIL]"),
    ("PHONE", PHONE_RE, "[ТЕЛЕФОН]"),
    ("COORDS", COORDS_RE, "[КООРДИНАТЫ]"),
    ("ADDRESS", ADDRESS_RE, "[АДРЕС]"),
]


# ---------------------------------------------------------------------------
# NER (Natasha) — имена людей. Города/локации намеренно не маскируем целиком:
# «Пятигорск» сам по себе не идентифицирует человека, в отличие от точного
# адреса (тот уже поймала ADDRESS_RE выше).
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _ner_pipeline():
    from natasha import Segmenter, NewsEmbedding, NewsNERTagger

    segmenter = Segmenter()
    embedding = NewsEmbedding()
    ner_tagger = NewsNERTagger(embedding)
    return segmenter, ner_tagger


def _find_person_names(text: str) -> list[tuple[int, int, str]]:
    from natasha import Doc

    segmenter, ner_tagger = _ner_pipeline()
    doc = Doc(text)
    doc.segment(segmenter)
    doc.tag_ner(ner_tagger)
    return [(span.start, span.stop, span.text) for span in doc.spans if span.type == "PER"]


# ---------------------------------------------------------------------------
# Оценка риска повторной идентификации по редким комбинациям медицинских
# показателей. Эвристика: считаем специфичные маркеры (числовые лабораторные
# значения с единицами, конкретные диагнозы из списка, точный возраст).
# Порог — 3 и больше одновременно в одном запросе = высокий риск, блокируем.
# ---------------------------------------------------------------------------

_LAB_VALUE_RE = re.compile(
    r"\d+[.,]?\d*\s*(?:ммоль/л|мг/дл|мм\s?рт\.?\s?ст\.?|уд/мин|°C|мкмоль/л|г/л)",
    re.IGNORECASE,
)
_AGE_RE = re.compile(r"\bмне\s+\d{1,3}\s+лет\b|\bвозраст\s*[:]?\s*\d{1,3}\b", re.IGNORECASE)
_DIAGNOSIS_MARKERS = [
    "диагноз", "гипертони", "диабет", "стади", "степен", "хроническ",
    "недостаточност", "аритми", "ишемическ", "остеохондроз", "артрит",
]


def _reidentification_risk_score(text: str) -> int:
    score = 0
    score += len(_LAB_VALUE_RE.findall(text))
    if _AGE_RE.search(text):
        score += 1
    lowered = text.lower()
    score += sum(1 for marker in _DIAGNOSIS_MARKERS if marker in lowered)
    return score


REIDENTIFICATION_RISK_THRESHOLD = 3


# ---------------------------------------------------------------------------
# Публичная функция
# ---------------------------------------------------------------------------

def scrub(text: str) -> ScrubResult:
    """Обезличивает текст перед отправкой во внешний LLM.

    Порядок: сначала оценка риска повторной идентификации (может заблокировать
    запрос целиком, до какой-либо маскировки), затем регулярные детекторы,
    затем NER на именах людей.
    """
    risk = _reidentification_risk_score(text)
    if risk >= REIDENTIFICATION_RISK_THRESHOLD:
        return ScrubResult(
            clean_text="",
            blocked=True,
            block_reason=(
                f"Риск повторной идентификации по комбинации медицинских показателей "
                f"слишком высок (оценка {risk} ≥ порога {REIDENTIFICATION_RISK_THRESHOLD}). "
                f"Запрос не отправлен во внешний API."
            ),
        )

    findings: list[Finding] = []
    working = text

    for kind, pattern, replacement in _REGEX_DETECTORS:
        def _sub(match: re.Match, kind=kind, replacement=replacement) -> str:
            findings.append(Finding(kind=kind, original=match.group(0), replacement=replacement))
            return replacement

        working = pattern.sub(_sub, working)

    # NER на именах — по уже частично очищенному тексту (после regex-замен индексы
    # всё равно пересчитывать бессмысленно, поэтому просто ищем имена в текущей
    # версии текста и заменяем по найденным фрагментам).
    try:
        for _, _, name in _find_person_names(working):
            if name in working:
                findings.append(Finding(kind="PERSON", original=name, replacement="[ИМЯ]"))
                working = working.replace(name, "[ИМЯ]")
    except Exception:
        # NER — best-effort. Если модель недоступна/упала, не роняем весь запрос:
        # хуже, если сервис откажет полностью, чем если одно имя не поймается regex-ом.
        # Регулярные детекторы (телефон/адрес/паспорт и т.п.) уже отработали выше.
        pass

    return ScrubResult(clean_text=working, findings=findings, blocked=False)


if __name__ == "__main__":
    import sys

    sample = sys.argv[1] if len(sys.argv) > 1 else (
        "Меня зовут Иван Петров, живу в Пятигорске на улице Козлова 21, "
        "телефон +7 928 338-08-33, email ivan@example.com, мне 45 лет. "
        "Диагноз: гипертония 2 степени, давление 160 мм рт ст, сахар 7.2 ммоль/л."
    )
    result = scrub(sample)
    print("blocked:", result.blocked, result.block_reason or "")
    print("clean_text:", result.clean_text)
    print("findings:")
    for f in result.findings:
        print(f"  {f.kind}: {f.original!r} -> {f.replacement}")
