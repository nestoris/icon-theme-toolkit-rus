#!/bin/bash
# build-en.sh
set -e
for f in icon-theme-toolkit.js theme.js settings.js icon-compiler.js winico2linuxtheme.js; do
	awk -f translate.awk translations.txt "$f" > "../icon-theme-toolkit/${f}"
	echo "Translated: ${f}"
done