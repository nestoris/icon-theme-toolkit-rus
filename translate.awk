#!/usr/bin/awk -f
# translate.awk — построчная замена русских строк на английские
# и сбор непереведённых фрагментов в untranslated.txt.
#
# Использование:
#   awk -f translate.awk translations.txt file.js > file_en.js
#
# Второй выходной файл (untranslated.txt) создаётся рядом с текущим каталогом.
# Формат: одна строка на каждую найденную непереведённую русскую строку
# (без пустых строк-разделителей, чтобы потом можно было прогнать через
# paste_translations.awk).

BEGIN {
    trans_file = ARGV[1]
    delete ARGV[1]

    # Загружаем пары переводов
    n = 0
    rus = ""
    while ((getline line < trans_file) > 0) {
        if (line == "") {
            rus = ""
            continue
        }
        if (rus == "") {
            rus = line
        } else {
            n++
            from[n] = rus
            to[n] = line
            rus = ""
        }
    }
    close(trans_file)

    # Сортируем по убыванию длины — длинные строки заменяем первыми
    for (i = 1; i <= n; i++) {
        for (j = i + 1; j <= n; j++) {
            if (length(from[i]) < length(from[j])) {
                tmp = from[i]; from[i] = from[j]; from[j] = tmp
                tmp = to[i];   to[i]   = to[j];   to[j]   = tmp
            }
        }
    }

    # Выходной файл для непереведённых фрагментов
    untranslated_file = "untranslated.txt"
    # Очищаем файл при старте (иначе при повторных запусках он будет расти)
    printf "" > untranslated_file

    # Множество уже добавленных строк, чтобы не дублировать
    # (awk-массивы с индексами-строками работают как множества)
    delete seen_untranslated
}

# Функция: содержит ли строка кириллицу (UTF-8)
# Кириллица в UTF-8: старший байт 0xD0 или 0xD1 (основной блок U+0400–U+04FF)
# Дополнительные блоки (U+0500–U+052F и т.д.) начинаются с 0xD2/0xD3,
# но для ваших исходников достаточно D0/D1.
function has_cyrillic(s,    i, c) {
    for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        # В awk под gawk/mawk substr работает по байтам.
        # Сравниваем с байтовыми значениями через sprintf("%c", N).
        if (c == sprintf("%c", 208) || c == sprintf("%c", 209)) {
            return 1
        }
    }
    return 0
}

{
    line = $0

    # 1. Применяем известные переводы
    for (i = 1; i <= n; i++) {
        if (index(line, from[i]) > 0) {
            out = ""
            rest = line
            while ((pos = index(rest, from[i])) > 0) {
                out = out substr(rest, 1, pos - 1) to[i]
                rest = substr(rest, pos + length(from[i]))
            }
            line = out rest
        }
    }

    # 2. Если после замен в строке осталась кириллица — это непереведённый фрагмент
    if (has_cyrillic(line)) {
        # Обрезаем ведущие/замыкающие пробелы, чтобы не плодить мусор
        frag = line
        sub(/^[ \t]+/, "", frag)
        sub(/[ \t]+$/, "", frag)

        # Пропускаем пустые, чисто технические строки и строки-комментарии-разделители
        if (frag != "" && frag != "//" && frag !~ /^#!\/usr\/bin\/gjs$/) {
            if (!(frag in seen_untranslated)) {
                seen_untranslated[frag] = 1
                print frag >> untranslated_file
            }
        }
    }

    print line
}