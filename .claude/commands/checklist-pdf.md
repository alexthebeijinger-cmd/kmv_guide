---
description: Сгенерировать PDF из полевого чек-листа knowledge/CHECKLIST-VISIT.md
---

Сгенерируй актуальный PDF из `knowledge/CHECKLIST-VISIT.md`:

1. Убедись, что `knowledge/CHECKLIST-VISIT.md` содержит только актуальные (не закрытые) задачи — по конвенции CLAUDE.md для внешних чек-листов закрытые пункты в этом файле не упоминаются вообще.
2. Запусти: `python3 scripts/render_md_to_pdf.py knowledge/CHECKLIST-VISIT.md output/checklist-visit.pdf`
3. Отправь получившийся PDF пользователю (SendUserFile).
4. Если файла `knowledge/CHECKLIST-VISIT.md` больше нет актуальных задач — сообщи об этом явно, не генерируй пустой PDF молча.
