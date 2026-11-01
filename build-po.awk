#!/usr/bin/awk -f
# build-po.awk — генерирует icon-theme-toolkit.po из translations.txt
# Направление: msgid = английский, msgstr = русский.
#
# Использование:
#   awk -f build-po.awk translations.txt > locale/icon-theme-toolkit.po

BEGIN {
    trans_file = ARGV[1]
    delete ARGV[1]

    # Заголовок PO-файла
    print "# Icon Theme Toolkit — Russian translation"
    print "# Generated from translations.txt. Do not edit by hand."
    print "#"
    print "msgid \"\""
    print "msgstr \"\""
    print "\"Project-Id-Version: icon-theme-toolkit\\n\""
    print "\"Report-Msgid-Bugs-To: https://github.com/nestoris/icon-theme-toolkit/issues\\n\""
    print "\"POT-Creation-Date: " strftime("%Y-%m-%d %H:%M%z") "\\n\""
    print "\"PO-Revision-Date: " strftime("%Y-%m-%d %H:%M%z") "\\n\""
    print "\"Last-Translator: Nestoris <voltasar@gmail.com>\\n\""
    print "\"Language-Team: Russian\\n\""
    print "\"Language: ru\\n\""
    print "\"MIME-Version: 1.0\\n\""
    print "\"Content-Type: text/plain; charset=UTF-8\\n\""
    print "\"Content-Transfer-Encoding: 8bit\\n\""
    print "\"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n\""
    print ""

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
            en[n] = line
            ru[n] = rus
            rus = ""
        }
    }
    close(trans_file)

    for (i = 1; i <= n; i++) {
        print "#: translations.txt"
        print "msgid \"" esc(en[i]) "\""
        print "msgstr \"" esc(ru[i]) "\""
        print ""
    }
}

# Экранирование для PO: обратный слэш, двойная кавычка, перевод строки, табуляция
function esc(s,    out, i, c) {
    out = ""
    for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (c == "\\") out = out "\\\\"
        else if (c == "\"") out = out "\\\""
        else if (c == "\n") out = out "\\n"
        else if (c == "\t") out = out "\\t"
        else if (c == "\r") out = out "\\r"
        else out = out c
    }
    return out
}