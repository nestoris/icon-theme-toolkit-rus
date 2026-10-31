#!/bin/bash
# paste_trans.sh — сливает untranslated.txt + translated.txt в translations.txt
# с проверками на отсутствие файлов, пустоту и рассинхронизацию строк.

set -euo pipefail

# ---------- 1. Проверка аргументов и файлов ----------
RU_FILE="untranslated.txt"
EN_FILE="translated.txt"
OUT_FILE="translations.txt"

missing=0
for f in "$RU_FILE" "$EN_FILE"; do
    if [[ ! -e "$f" ]]; then
        echo "Ошибка: файл '$f' не найден." >&2
        missing=1
    elif [[ ! -f "$f" ]]; then
        echo "Ошибка: '$f' существует, но это не обычный файл." >&2
        missing=1
    elif [[ ! -r "$f" ]]; then
        echo "Ошибка: '$f' недоступен для чтения." >&2
        missing=1
    fi
done
if (( missing )); then
    echo "Прерывание: не все входные файлы на месте." >&2
    exit 1
fi

# ---------- 2. Проверка непустоты (без учёта пустых строк) ----------
# Считаем только непустые строки, т.к. awk-скрипт игнорирует пустые.
count_nonempty() {
    # grep -c '' считает все строки; -v '^$' отбрасывает пустые.
    # Возвращает 0, если файл пуст или содержит только пустые строки.
    local n
    n=$(grep -c -v '^[[:space:]]*$' "$1" 2>/dev/null || true)
    # grep -c возвращает 1, если ничего не найдено — это не ошибка
    echo "${n:-0}"
}

RU_COUNT=$(count_nonempty "$RU_FILE")
EN_COUNT=$(count_nonempty "$EN_FILE")

if [[ "$RU_COUNT" -eq 0 ]]; then
    echo "Предупреждение: '$RU_FILE' пуст или содержит только пустые строки. Нечего сливать." >&2
    exit 0
fi

if [[ "$EN_COUNT" -eq 0 ]]; then
    echo "Ошибка: '$EN_FILE' пуст или содержит только пустые строки, а '$RU_FILE' содержит $RU_COUNT строк(и)." >&2
    echo "Заполните '$EN_FILE' переводами (по одной строке на каждую строку из '$RU_FILE')." >&2
    exit 1
fi

# ---------- 3. Проверка совпадения количества строк ----------
if [[ "$RU_COUNT" -ne "$EN_COUNT" ]]; then
    echo "Ошибка: количество непустых строк не совпадает." >&2
    echo "  $RU_FILE: $RU_COUNT" >&2
    echo "  $EN_FILE: $EN_COUNT" >&2
    echo "Пары 'русская-английская' съедут, translations.txt будет испорчен." >&2
    echo "Исправьте '$EN_FILE', чтобы строк было ровно $RU_COUNT." >&2
    exit 1
fi

# ---------- 4. Резервная копия translations.txt ----------
if [[ -f "$OUT_FILE" ]]; then
    if [[ ! -w "$OUT_FILE" ]]; then
        echo "Ошибка: '$OUT_FILE' недоступен для записи." >&2
        exit 1
    fi
    BACKUP="${OUT_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
    if ! cp -- "$OUT_FILE" "$BACKUP"; then
        echo "Ошибка: не удалось создать резервную копию '$BACKUP'." >&2
        exit 1
    fi
    echo "Резервная копия: $BACKUP"
else
    echo "Файл '$OUT_FILE' не существует — будет создан."
    # Создаём пустой файл, чтобы awk мог писать в него без сюрпризов
    : > "$OUT_FILE"
fi

# ---------- 5. Слияние ----------
# awk пишет во временный файл, чтобы при сбое не испортить translations.txt.
TMP_OUT=$(mktemp "${OUT_FILE}.tmp.XXXXXX")
trap 'rm -f "$TMP_OUT"' EXIT

if ! awk -f paste_translations.awk "$RU_FILE" "$EN_FILE" > "$TMP_OUT"; then
    echo "Ошибка: awk завершился с ошибкой. '$OUT_FILE' не изменён." >&2
    exit 1
fi

# Проверим, что во временный файл что-то записалось (защита от «тихих» сбоев awk)
if [[ ! -s "$TMP_OUT" ]]; then
    echo "Ошибка: результат слияния пуст. '$OUT_FILE' не изменён." >&2
    exit 1
fi

# ---------- 6. Атомарная замена ----------
# Сначала дописываем старое содержимое translations.txt, потом новый блок.
# (Скрипт paste_translations.awk выводит пары, мы их дописываем в конец.)
{
    cat -- "$OUT_FILE"
    # Гарантируем перевод строки между старым и новым содержимым
    if [[ -s "$OUT_FILE" ]] && [[ "$(tail -c1 -- "$OUT_FILE" | od -An -c | tr -d ' \n')" != '\n' ]]; then
        echo
    fi
    cat -- "$TMP_OUT"
} > "${TMP_OUT}.final"

if ! mv -- "${TMP_OUT}.final" "$OUT_FILE"; then
    echo "Ошибка: не удалось заменить '$OUT_FILE'." >&2
    exit 1
fi

# ---------- 7. Итог ----------
NEW_RU=$(count_nonempty "$RU_FILE")
ADDED=$(( NEW_RU * 2 ))  # каждая пара — 2 строки + пустая-разделитель
echo "Готово: добавлено пар: $NEW_RU (строк: ~$ADDED)."
echo "Текущий размер '$OUT_FILE': $(count_nonempty "$OUT_FILE") непустых строк."