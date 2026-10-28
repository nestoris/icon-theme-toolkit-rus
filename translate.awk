#!/usr/bin/awk -f
# translate.awk — построчная замена русских строк на английские
# Использование: awk -f translate.awk translations.txt file.js > file_en.js
#
# Формат translations.txt: блоки "русская строка\nанглийская строка\n\n"
# Пустые строки в конце блока — разделители.

BEGIN {
	# Загружаем пары переводов из файла (передаётся как первый аргумент)
	# ARGV[1] = translations.txt
	trans_file = ARGV[1]
	delete ARGV[1]
	
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
	
	# Сортируем по убыванию длины — длинные строки заменяем первыми,
	# чтобы избежать конфликтов (например, "Битые симлинки (" раньше "Битые симлинки")
	for (i = 1; i <= n; i++) {
		for (j = i + 1; j <= n; j++) {
			if (length(from[i]) < length(from[j])) {
				tmp = from[i]; from[i] = from[j]; from[j] = tmp
				tmp = to[i];   to[i]   = to[j];   to[j]   = tmp
			}
		}
	}
}

{
	line = $0
	for (i = 1; i <= n; i++) {
		if (index(line, from[i]) > 0) {
			# Заменяем ВСЕ вхождения from[i] на to[i] в строке
			out = ""
			rest = line
			while ((pos = index(rest, from[i])) > 0) {
				out = out substr(rest, 1, pos - 1) to[i]
				rest = substr(rest, pos + length(from[i]))
			}
			line = out rest
		}
	}
	print line
}