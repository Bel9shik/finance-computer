"""Tiny, synthetic XLSX fixtures: no real bank data is stored in the repository."""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1] / "build" / "fixtures"
ROOT.mkdir(parents=True, exist_ok=True)


def sheet(rows):
    rendered = []
    for i, row in enumerate(rows, 1):
        cells = []
        for j, value in enumerate(row):
            if value is not None:
                cells.append(f'<c r="{chr(65+j)}{i}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>')
        rendered.append(f'<row r="{i}">{"".join(cells)}</row>')
    return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + ''.join(rendered) + '</sheetData></worksheet>'


BASE = [
    ["Выписка по счету", "АО «АЛЬФА-БАНК»"],
    ["Номер счета", "00000000000000000001"],
    ["Валюта счета", "RUR"],
    ["Клиент", "Тестов Т. Т."],
    ["Поступления", "1000 RUR"],
    ["Расходы", "135,50 RUR"],
    ["Неподтвержденные операции", "10 RUR"],
    ["Дата операции", "Дата проводки", "Код", "Категория", "Описание", "Сумма в валюте счета", "Статус"],
    ["01.10.2026", "02.10.2026", "a1", "Прочие операции", "Операция по карте: место совершения операции: RU/Test/SHOP, MCC: 5411", "-125,50", "Выполнен"],
    ["01.10.2026", "01.10.2026", "a2", "Прочие операции", "Зарплата", "1000", "Выполнен"],
    ["02.10.2026", "HOLD", None, "Прочие операции", "Оплата в cafe", "-10", None],
]


def write(name, rows, extra=None):
    with ZipFile(ROOT / name, "w", ZIP_DEFLATED) as archive:
        archive.writestr("xl/workbook.xml", '<workbook><workbookPr date1904="0"/></workbook>')
        archive.writestr("xl/worksheets/sheet1.xml", sheet(rows))
        for key, value in (extra or {}).items():
            archive.writestr(key, value)


write("valid.xlsx", BASE)
bad_total = [row[:] for row in BASE]
bad_total[5][1] = "999 RUR"
write("bad-total.xlsx", bad_total)
bad_status = [row[:] for row in BASE]
bad_status[8][-1] = "Неизвестно"
write("bad-status.xlsx", bad_status)
bad_money = [row[:] for row in BASE]
bad_money[8][-2] = "не сумма"
write("bad-money.xlsx", bad_money)
with ZipFile(ROOT / "bad-xml.xlsx", "w", ZIP_DEFLATED) as archive:
    archive.writestr("xl/worksheets/sheet1.xml", '<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///etc/passwd">]><worksheet>&ext;</worksheet>')
print("Synthetic XLSX fixtures ready")
