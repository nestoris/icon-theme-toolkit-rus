#!/bin/bash
# Порядок действий при релизе:
cd ~/git/icon-theme-toolkit-rus

# 1. Собрать новые русские строки и перевести их (этапы 1–4 из readme-translate.txt)
./build-en.sh
# ... перевести untranslated.txt в translated.txt ...
./paste_trans.sh
./build-en.sh

# 2. Сгенерировать мастер-PO (en→ru)
make po
# или: awk -f build-po.awk translations.txt > locale/ru.po

# 3. Скопировать PO в английский репозиторий (если он в другом каталоге)
cp locale/ru.po ../icon-theme-toolkit/locale/

# 4. Отдать PO нейросети, получить fr.po, de.po, ... и положить их в
#    ../icon-theme-toolkit/locale/<lang>/LC_MESSAGES/icon-theme-toolkit.po

# 5. Собрать .mo и проверить, что всё компилируется
cd ../icon-theme-toolkit
make mo

# 6. Установить и проверить вживую
sudo make install
LANG=fr_FR.UTF-8 gjs /opt/icon-theme-toolkit/icon-theme-toolkit.js