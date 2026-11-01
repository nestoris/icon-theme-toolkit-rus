#!/bin/bash
# paste_trans.sh — сливает untranslated.txt + translated.txt в translations.txt
# с проверками на отсутствие файлов, пустоту, рассинхронизацию строк
# и защитой от повторного добавления уже существующих пар.
# Отчёт о конфликтах (русский ключ есть, но перевод другой) — conflict.txt.

set -euo pipefail

RU_FILE="untranslated.txt"
EN_FILE="translated.txt"
OUT_FILE="translations.txt"
CONFLICT_FILE="conflict.txt"

for f in "$RU_FILE" "$EN_FILE"; do
    if grep -q $'\r' "$f"; then
        echo "Приведение CRLF -> LF в '$f'" >&2
        sed -i 's/\r$//' "$f"
    fi
done

missing=0
for f in "$RU_FILE" "$EN_FILE"; do
    if [[ ! -e "$f" ]]; then
        echo "Ошибка: файл '$f' не найден." >&2; missing=1
    elif [[ ! -f "$f" ]]; then
        echo "Ошибка: '$f' существует, но это не обычный файл." >&2; missing=1
    elif [[ ! -r "$f" ]]; then
        echo "Ошибка: '$f' недоступен для чтения." >&2; missing=1
    fi
done
if (( missing )); then
    echo "Прерывание: не все входные файлы на месте." >&2
    exit 1
fi

count_nonempty() {
    local n
    n=$(grep -c -v '^[[:space:]]*$' "$1" 2>/dev/null || true)
    echo "${n:-0}"
}

RU_COUNT=$(count_nonempty "$RU_FILE")
EN_COUNT=$(count_nonempty "$EN_FILE")

if [[ "$RU_COUNT" -eq 0 ]]; then
    echo "Предупреждение: '$RU_FILE' пуст или содержит только пустые строки. Нечего сливать." >&2
    exit 0
fi

if [[ "$EN_COUNT" -eq 0 ]]; then
    echo "Ошибка: '$EN_FILE' пуст, а '$RU_FILE' содержит $RU_COUNT строк(и)." >&2
    echo "Заполните '$EN_FILE' переводами (по одной строке на каждую из '$RU_FILE')." >&2
    exit 1
fi

if [[ "$RU_COUNT" -ne "$EN_COUNT" ]]; then
    echo "Ошибка: количество непустых строк не совпадает." >&2
    echo "  $RU_FILE: $RU_COUNT" >&2
    echo "  $EN_FILE: $EN_COUNT" >&2
    exit 1
fi

# ---------- 4. Резервная копия ----------
BACKUP=""
if [[ -f "$OUT_FILE" ]]; then
    if [[ ! -w "$OUT_FILE" ]]; then
        echo "Ошибка: '$OUT_FILE' недоступен для записи." >&2
        exit 1
    fi
    BACKUP="${OUT_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
    cp -- "$OUT_FILE" "$BACKUP"
    echo "Резервная копия: $BACKUP"
else
    echo "Файл '$OUT_FILE' не существует — будет создан."
    : > "$OUT_FILE"
fi

# ---------- 5. Фильтрация: убираем пары, которые уже есть в translations.txt ----------
# Читаем текущий translations.txt в ассоциативный массив (bash 4+).
# Ключ: русская строка. Значение: английский перевод (первый встреченный).
#
# Если ключ уже есть с тем же переводом — пропускаем (дедупликация).
# Если ключ есть с другим переводом — пропускаем и пишем в conflict.txt.
# Если ключа нет — оставляем пару для добавления.

TMP_FILTERED=$(mktemp)
trap 'rm -f "$TMP_FILTERED" "${TMP_OUT:-}" "${TMP_OUT}.final" 2>/dev/null || true' EXIT

# Инициализируем conflict.txt
: > "$CONFLICT_FILE"
CONFLICT_COUNT=0
SKIP_SAME=0
SKIP_CONFLICT=0
KEEP=0

if [[ -s "$OUT_FILE" ]]; then
    # Строим ассоциативный массив «русский -> английский»
    declare -A existing_en=()
    # Читаем попарно: непустая строка + следующая непустая строка
    {
        ru=""
        while IFS= read -r line || [[ -n "$line" ]]; do
            if [[ -z "${line//[[:space:]]/}" ]]; then
                continue
            fi
            if [[ -z "$ru" ]]; then
                ru="$line"
            else
                if [[ -z "${existing_en[$ru]+x}" ]]; then
                    existing_en["$ru"]="$line"
                fi
                ru=""
            fi
        done < "$OUT_FILE"
    }

    # Читаем untranslated.txt и translated.txt попарно, фильтруем
    ru=""
    idx=0
    mapfile -t ru_lines < <(grep -v '^[[:space:]]*$' "$RU_FILE")
    mapfile -t en_lines < <(grep -v '^[[:space:]]*$' "$EN_FILE")

    for ((i = 0; i < ${#ru_lines[@]}; i++)); do
        r="${ru_lines[$i]}"
        e="${en_lines[$i]}"

        if [[ -n "${existing_en[$r]+x}" ]]; then
            if [[ "${existing_en[$r]}" == "$e" ]]; then
                SKIP_SAME=$((SKIP_SAME + 1))
            else
                SKIP_CONFLICT=$((SKIP_CONFLICT + 1))
                # Пишем в conflict.txt: русская + существующий + новый перевод
                {
                    echo "$r"
                    echo "${existing_en[$r]}"
                    echo ""
                    echo "$r"
                    echo "$e"
                    echo ""
                    echo ""
                } >> "$CONFLICT_FILE"
            fi
        else
            printf '%s\n%s\n\n' "$r" "$e" >> "$TMP_FILTERED"
            KEEP=$((KEEP + 1))
        fi
    done
else
    # translations.txt пуст — берём всё как есть
    cp -- /dev/null "$TMP_FILTERED"
    # Пересобираем пары из входных файлов
    mapfile -t ru_lines < <(grep -v '^[[:space:]]*$' "$RU_FILE")
    mapfile -t en_lines < <(grep -v '^[[:space:]]*$' "$EN_FILE")
    for ((i = 0; i < ${#ru_lines[@]}; i++)); do
        printf '%s\n%s\n\n' "${ru_lines[$i]}" "${en_lines[$i]}" >> "$TMP_FILTERED"
        KEEP=$((KEEP + 1))
    done
fi

echo "Пропущено (уже есть с тем же переводом): $SKIP_SAME"
echo "Пропущено (конфликт перевода, см. $CONFLICT_FILE): $SKIP_CONFLICT"
echo "Будет добавлено новых пар: $KEEP"

if [[ "$KEEP" -eq 0 ]]; then
    echo "Нечего добавлять — '$OUT_FILE' не изменён."
    # Если были конфликты, оставляем conflict.txt для разбора; иначе убираем пустой
    if [[ "$CONFLICT_COUNT" -eq 0 && ! -s "$CONFLICT_FILE" ]]; then
        rm -f "$CONFLICT_FILE"
    fi
    exit 0
fi

# ---------- 6. Атомарная замена ----------
TMP_OUT=$(mktemp "${OUT_FILE}.tmp.XXXXXX")
{
    cat -- "$OUT_FILE"
    # Гарантируем \n между старым и новым содержимым
    if [[ -s "$OUT_FILE" ]] && [[ "$(tail -c1 -- "$OUT_FILE" | od -An -c | tr -d ' \n')" != '\n' ]]; then
        echo
    fi
    cat -- "$TMP_FILTERED"
} > "$TMP_OUT"

if [[ ! -s "$TMP_OUT" ]]; then
    echo "Ошибка: результат слияния пуст. '$OUT_FILE' не изменён." >&2
    exit 1
fi

mv -- "$TMP_OUT" "$OUT_FILE"

# ---------- 7. Итог ----------
echo "Готово. Новых пар добавлено: $KEEP."
echo "Размер '$OUT_FILE': $(count_nonempty "$OUT_FILE") непустых строк."
if [[ -s "$CONFLICT_FILE" ]]; then
    echo "ВНИМАНИЕ: есть конфликты перевода — разберите '$CONFLICT_FILE' вручную."
else
    rm -f "$CONFLICT_FILE"
fi