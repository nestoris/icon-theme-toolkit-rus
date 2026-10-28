#!/usr/bin/env gjs

imports.gi.versions.Gtk = '3.0';
imports.gi.versions.GLib = '2.0';
const Gtk = imports.gi.Gtk;
const GdkPixbuf = imports.gi.GdkPixbuf;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

Gtk.init(null);

// ==================== ОБРАБОТКА АРГУМЕНТА HELP ====================

let scriptName = GLib.path_get_basename(imports.system.programInvocationName);

if (ARGV.includes('-h') || ARGV.includes('--help')) {
    print("Использование: " + GLib.path_get_basename(ARGV[0]) + " [ОПЦИИ] [ICO_ФАЙЛ]\n");
    print("Просмотр иконок из ICO-файлов и установка в тему Linux.");
    print("");
    print("Опции:");
    print("  -t ФАЙЛ       Путь к файлу index.theme темы");
    print("  -c КОНТЕКСТ   Контекст для выбора (actions, devices, mimetypes, places и др.)");
    print("  -n ИМЯ        Имя значка без расширения");
    print("  -s РАЗМЕР     Размер отображения значков в пикселях (по умолчанию: оригинальный)");
    print("  -b            Включить сглаживание (библинейную интерполяцию) при масштабировании");
    print("  -h, --help    Показать эту справку и выйти");
    print("");
    print("Аргументы:");
    print("  ICO_ФАЙЛ      Путь к .ico файлу для открытия");
    print("");
    print("Примеры:");
    print("  " + scriptName + " icon.ico");
    print("  " + scriptName + " -t /path/to/index.theme -c devices icon.ico");
    print("  " + scriptName + " -t theme/index.theme -c actions -n my-icon icon.ico");
    print("  " + scriptName + " -s 64 icon.ico");
    print("  " + scriptName + " -s 128 -b icon.ico");
    print("  " + scriptName + " -h");
    print("");
    print("Формат INI-файла (создаётся рядом с ICO):");
    print("  [defaults]");
    print("  name=иконка");
    print("  context=devices");
    print("  themefile=/путь/к/index.theme");
    print("  scale=128        # размер отображения (опционально)");
    print("  blur=true        # сглаживание при масштабировании (опционально)");
    print("");
    print("  [bit-depth]");
    print("  16x16=8");
    print("  32x32=32");
    print("  48x48=8");
    print("");
    print("Доступные глубины цвета:");
    print("  1  - Mono");
    print("  4  - 16 colors");
    print("  8  - 256 colors");
    print("  16 - HiColor");
    print("  24 - TrueColor");
    print("  32 - XP");

    // Выходим с кодом 0 (успех)
    imports.system.exit(0);
}

// ==================== ОБРАБОТКА АРГУМЕНТОВ КОМАНДНОЙ СТРОКИ ====================

let cmdlineThemeFile = null;
let cmdlineContext = null;
let cmdlineIconName = null;
let cmdlineIcoFile = null;
let cmdlineScale = null;
let cmdlineBlur = false;

let args = ARGV.slice();
for (let i = 0; i < args.length; i++) {
    if (args[i] === '-t' && i + 1 < args.length) {
        cmdlineThemeFile = args[i + 1];
        i++;
    } else if (args[i] === '-c' && i + 1 < args.length) {
        cmdlineContext = args[i + 1];
        i++;
    } else if (args[i] === '-n' && i + 1 < args.length) {
        cmdlineIconName = args[i + 1];
        i++;
    } else if (args[i] === '-s' && i + 1 < args.length) {
        cmdlineScale = parseInt(args[i + 1]);
        if (isNaN(cmdlineScale) || cmdlineScale < 1) {
            log("Ошибка: размер должен быть положительным числом");
            imports.system.exit(1);
        }
        i++;
    } else if (args[i] === '-b') {
        cmdlineBlur = true;
    } else if (!args[i].startsWith('-')) {
        cmdlineIcoFile = args[i];
    }
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function getTempDir() {
    let tmpDir = GLib.getenv('TMPDIR');
    if (!tmpDir || tmpDir === '') {
        tmpDir = '/tmp';
    }
    return tmpDir;
}

function getBitDepthLabel(bitDepth) {
    let depth = parseInt(bitDepth);
    switch(depth) {
        case 1: return "Mono";
        case 4: return "16 colors";
        case 8: return "256 colors";
        case 16: return "HiColor";
        case 24: return "TrueColor";
        case 32: return "XP";
        default: return bitDepth + "bit";
    }
}

function getDefaultBitDepth(bitDepths) {
    // По умолчанию 8 бит, или самая большая из доступных
    if (bitDepths.includes(8)) {
        return 8;
    }
    return bitDepths[bitDepths.length - 1]; // самая большая
}

function getImageDimensions(filePath) {
    try {
        let pixbuf = GdkPixbuf.Pixbuf.new_from_file(filePath);
        return { width: pixbuf.get_width(), height: pixbuf.get_height() };
    } catch (e) {
        return null;
    }
}

function getImageInfo(tempPngPath) {
    if (!tempPngPath) return null;
    
    let dimensions = getImageDimensions(tempPngPath);
    if (!dimensions) return null;
    
    // Получаем время модификации файла
    let file = Gio.File.new_for_path(tempPngPath);
    try {
        let info = file.query_info("time::modified", Gio.FileQueryInfoFlags.NONE, null);
        let mtime = info.get_modification_date_time();
        return {
            width: dimensions.width,
            height: dimensions.height,
            mtime: mtime
        };
    } catch (e) {
        return {
            width: dimensions.width,
            height: dimensions.height,
            mtime: null
        };
    }
}

function compareImages(leftPngPath, rightPngPath) {
    // leftPngPath - временный PNG из ICO
    // rightPngPath - PNG из темы
    
    if (!leftPngPath) {
        return { status: "XXX", label: "XXX" };
    }
    
    let leftInfo = getImageInfo(leftPngPath);
    if (!leftInfo) {
        return { status: "XXX", label: "XXX" };
    }
    
    // Проверяем существование правого файла
    let rightFile = Gio.File.new_for_path(rightPngPath);
    if (!rightFile.query_exists(null)) {
        return { status: "==>", label: "==>" };
    }
    
    let rightInfo = getImageInfo(rightPngPath);
    if (!rightInfo) {
        return { status: "XXX", label: "XXX" };
    }
    
    // Сравниваем размеры
    let sizeMatch = (leftInfo.width === rightInfo.width && leftInfo.height === rightInfo.height);
    
    // Формируем строку сравнения размеров
    let sizeLabel = "";
    if (!sizeMatch) {
        let xChar = leftInfo.width > rightInfo.width ? 'X' : 'x';
        let yChar = leftInfo.height > rightInfo.height ? 'Y' : 'y';
        let rxChar = leftInfo.width < rightInfo.width ? 'X' : 'x';
        let ryChar = leftInfo.height < rightInfo.height ? 'Y' : 'y';
        sizeLabel = xChar + yChar + ':' + rxChar + ryChar;
    }
    
    // Сравниваем время
    if (leftInfo.mtime && rightInfo.mtime) {
        if (leftInfo.mtime.compare(rightInfo.mtime) > 0) {
            // Левый новее
            return { 
                status: "==>", 
                label: sizeMatch ? "==>" : sizeLabel 
            };
        } else if (leftInfo.mtime.compare(rightInfo.mtime) < 0) {
            // Левый старее
            return { 
                status: "<==", 
                label: sizeMatch ? "<==" : sizeLabel 
            };
        } else {
            // Ровесники
            return { 
                status: "<=>", 
                label: sizeMatch ? "<=>" : sizeLabel 
            };
        }
    }
    
    // Если не удалось сравнить время
    if (sizeMatch) {
        // Сравниваем содержимое
        try {
            let [success, stdout] = GLib.spawn_command_line_sync(
                'cmp -s ' + GLib.shell_quote(leftPngPath) + ' ' + GLib.shell_quote(rightPngPath)
            );
            // cmp возвращает 0 если файлы идентичны, 1 если различаются
            if (success) {
                return { status: "===", label: "===" };
            } else {
                return { status: "<=>", label: "<=>" };
            }
        } catch (e) {
            return { status: "???", label: "???" };
        }
    } else {
        return { status: "<=>", label: sizeLabel };
    }
}

function parseIniFile(iniFilePath) {
    let iniData = {
        name: '',
        themefile: '',
        context: '',
        scale: null,
        blur: false,
        bitDepths: {}
    };
    
    try {
        let file = Gio.File.new_for_path(iniFilePath);
        if (!file.query_exists(null)) {
            return iniData;
        }
        
        let [success, contents] = file.load_contents(null);
        if (!success) {
            return iniData;
        }
        
        let text = imports.byteArray.toString(contents);
        let lines = text.split('\n');
        let currentSection = '';
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            
            if (line === '' || line.startsWith('#') || line.startsWith(';')) {
                continue;
            }
            
            let sectionMatch = line.match(/^\[(.+)\]$/);
            if (sectionMatch) {
                currentSection = sectionMatch[1].toLowerCase();
                continue;
            }
            
            let keyValue = line.split('=');
            if (keyValue.length >= 2) {
                let key = keyValue[0].trim().toLowerCase();
                let value = keyValue.slice(1).join('=').trim();
                
                if (currentSection === 'defaults') {
                    if (key === 'name') iniData.name = value;
                    else if (key === 'themefile') iniData.themefile = value;
                    else if (key === 'context') iniData.context = value;
                    else if (key === 'scale') {
                        let scaleVal = parseInt(value);
                        if (!isNaN(scaleVal) && scaleVal > 0) {
                            iniData.scale = scaleVal;
                        }
                    }
                    else if (key === 'blur') {
                        iniData.blur = (value.toLowerCase() === 'true' || value === '1');
                    }
                } else if (currentSection === 'bit-depth') {
                    iniData.bitDepths[key] = parseInt(value) || 0;
                }
            }
        }
    } catch (e) {
        log("Ошибка парсинга INI: " + e.message);
    }
    
    return iniData;
}

function parseIndexTheme(filePath) {
    let dirArray = {};
    
    try {
        let file = Gio.File.new_for_path(filePath);
        let [success, contents] = file.load_contents(null);
        
        if (!success) {
            log("Не удалось прочитать файл: " + filePath);
            return dirArray;
        }
        
        let text = imports.byteArray.toString(contents);
        let lines = text.split('\n');
        
        let currentSection = '';
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            
            if (line === '' || line.startsWith('#')) {
                continue;
            }
            
            let sectionMatch = line.match(/^\[(.+)\]$/);
            if (sectionMatch) {
                currentSection = sectionMatch[1];
                continue;
            }
            
            let keyValue = line.split('=');
            if (keyValue.length === 2) {
                let key = keyValue[0].trim();
                let value = keyValue[1].trim();
                
                if (currentSection.match(/^[^\/]+\/\d+x\d+$/) || 
                    currentSection.match(/^[^\/]+\/\d+$/)) {
                    
                    if (key === 'Type' && value === 'Fixed') {
                        let parts = currentSection.split('/');
                        let context = parts[0];
                        let size = parts[1];
                        
                        if (!dirArray[context]) {
                            dirArray[context] = [];
                        }
                        
                        let sizeNum = parseInt(size);
                        if (!isNaN(sizeNum) && !dirArray[context].includes(sizeNum)) {
                            dirArray[context].push(sizeNum);
                            dirArray[context].sort((a, b) => a - b);
                        }
                    }
                }
            }
        }
    } catch (e) {
        log("Ошибка парсинга index.theme: " + e.message);
    }
    
    return dirArray;
}

function getThemeBasePath(indexThemePath) {
    let file = Gio.File.new_for_path(indexThemePath);
    let parent = file.get_parent();
    return parent.get_path();
}

function parseIcoFile(icoFilePath) {
    let formats = {};
    
    try {
        let [success, stdout, stderr, exitStatus] = GLib.spawn_command_line_sync(
            'icotool -l ' + GLib.shell_quote(icoFilePath)
        );
        
        if (!success || exitStatus !== 0) {
            log("Ошибка выполнения icotool: " + imports.byteArray.toString(stderr));
            return formats;
        }
        
        let output = imports.byteArray.toString(stdout);
        let lines = output.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (line === '') continue;
            
            let widthMatch = line.match(/--width=(\d+)/);
            let heightMatch = line.match(/--height=(\d+)/);
            let bitDepthMatch = line.match(/--bit-depth=(\d+)/);
            
            if (widthMatch && heightMatch && bitDepthMatch) {
                let width = parseInt(widthMatch[1]);
                let height = parseInt(heightMatch[1]);
                let bitDepth = parseInt(bitDepthMatch[1]);
                let format = width + 'x' + height;
                
                if (!formats[format]) {
                    formats[format] = [];
                }
                
                if (!formats[format].includes(bitDepth)) {
                    formats[format].push(bitDepth);
                }
            }
        }
        
        for (let format in formats) {
            formats[format].sort((a, b) => a - b);
        }
        
    } catch (e) {
        log("Ошибка парсинга ICO: " + e.message);
    }
    
    return formats;
}

// ==================== ФУНКЦИЯ МАСШТАБИРОВАНИЯ ИЗОБРАЖЕНИЙ ====================

function scaleImage(pixbuf, targetSize, useBlur) {
    if (!pixbuf) return null;
    
    let originalWidth = pixbuf.get_width();
    let originalHeight = pixbuf.get_height();
    
    // Если целевой размер не задан или равен оригинальному, возвращаем как есть
    if (!targetSize || (originalWidth === targetSize && originalHeight === targetSize)) {
        return pixbuf;
    }
    
    // Определяем тип интерполяции
    let interpType = useBlur ? GdkPixbuf.InterpType.BILINEAR : GdkPixbuf.InterpType.NEAREST;
    
    // Масштабируем с сохранением пропорций, вписывая в квадрат targetSize x targetSize
    let scale = Math.min(targetSize / originalWidth, targetSize / originalHeight);
    let newWidth = Math.round(originalWidth * scale);
    let newHeight = Math.round(originalHeight * scale);
    
    // Если новый размер совпадает с оригинальным, возвращаем как есть
    if (newWidth === originalWidth && newHeight === originalHeight) {
        return pixbuf;
    }
    
    // Масштабируем до новых размеров
    let scaled = pixbuf.scale_simple(newWidth, newHeight, interpType);
    
    // Если нужно вписать в квадрат targetSize x targetSize, создаём центрированное изображение
    if (newWidth !== targetSize || newHeight !== targetSize) {
        let centered = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, targetSize, targetSize);
        centered.fill(0x00000000); // Прозрачный фон
        scaled.copy_area(0, 0, newWidth, newHeight, centered, 
                         Math.floor((targetSize - newWidth) / 2), 
                         Math.floor((targetSize - newHeight) / 2));
        return centered;
    }
    
    return scaled;
}

// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================

let dirArray = {};
let currentContext = '';
let themeBasePath = '';
let icoFormats = {};
let icoFilePath = '';
let themeFilePath = '';
let pendingContext = null;
let iniData = null;
let bottomHboxes = [];
let displayScale = null;  // Размер отображения значков
let useBlur = false;     // Использовать ли сглаживание

let window = new Gtk.Window({
    title: "Установщик значков",
    default_width: 1000,
    default_height: 700,
    border_width: 10
});

let mainVbox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10
});

let scrollWindow = new Gtk.ScrolledWindow({
    expand: true,
    vexpand: true
});

let scrollVbox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 5
});

// ==================== ВЕРХНИЙ БЛОК ====================

let topHbox = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 10,
    valign: Gtk.Align.START
});

let openIcoButton = new Gtk.Button({
    valign: Gtk.Align.CENTER,
    tooltip_text: "Открыть ICO файл"
});
let icoIcon = new Gtk.Image({
    icon_name: "image-x-generic",
    icon_size: Gtk.IconSize.BUTTON
});
openIcoButton.set_image(icoIcon);

let openThemeButton = new Gtk.Button({
    valign: Gtk.Align.CENTER,
    tooltip_text: "Открыть файл index.theme"
});
let themeIcon = new Gtk.Image({
    icon_name: "document-open",
    icon_size: Gtk.IconSize.BUTTON
});
openThemeButton.set_image(themeIcon);

let saveIniButton = new Gtk.Button({
    valign: Gtk.Align.CENTER,
    tooltip_text: "Сохранить параметры в INI файл"
});
let saveIcon = new Gtk.Image({
    icon_name: "document-save",
    icon_size: Gtk.IconSize.BUTTON
});
saveIniButton.set_image(saveIcon);

let searchEntry = new Gtk.Entry({
    placeholder_text: "Имя значка (без расширения)...",
    valign: Gtk.Align.CENTER
});

let contextComboBox = new Gtk.ComboBoxText({
    valign: Gtk.Align.CENTER
});

topHbox.pack_start(openIcoButton, false, false, 0);
topHbox.pack_start(openThemeButton, false, false, 0);
topHbox.pack_start(saveIniButton, false, false, 0);
topHbox.pack_start(searchEntry, true, true, 0);
topHbox.pack_start(contextComboBox, false, false, 0);

// ==================== ФУНКЦИИ ВЫБОРА КОНТЕКСТА ====================

function selectContext(contextName) {
    if (!contextName || !dirArray[contextName]) {
        return false;
    }
    
    let model = contextComboBox.get_model();
    let found = false;
    model.foreach((model, path, iter) => {
        let value = model.get_value(iter, 0);
        if (value === contextName) {
            contextComboBox.set_active(parseInt(path));
            found = true;
            return true;
        }
        return false;
    });
    
    return found;
}

// ==================== ФУНКЦИИ СОЗДАНИЯ НИЖНИХ БЛОКОВ ====================

function createBottomHbox(format, bitDepths, defaultBitDepth) {
    let hbox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 10,
        valign: Gtk.Align.CENTER,
        margin_top: 2,
        margin_bottom: 2
    });
    
    let leftImage = new Gtk.Image();
    leftImage.set_from_icon_name("image-missing", Gtk.IconSize.DIALOG);
    leftImage.set_size_request(128, 128);
    
    let formatLabel = new Gtk.Label({
        label: format,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.START,
        width_chars: 10
    });
    
    // Комбо-бокс с человекочитаемыми метками
    let bitDepthComboBox = new Gtk.ComboBoxText({
        valign: Gtk.Align.CENTER
    });
    
    let defaultIndex = 0;
    bitDepths.forEach((depth, index) => {
        bitDepthComboBox.append_text(getBitDepthLabel(depth));
        if (depth === defaultBitDepth) {
            defaultIndex = index;
        }
    });
    bitDepthComboBox.set_active(defaultIndex);
    
    // Сохраняем числовые значения глубин
    bitDepthComboBox.bitDepths = bitDepths;
    
    let pathEntry = new Gtk.Entry({
        placeholder_text: "Путь к директории...",
        valign: Gtk.Align.CENTER,
        editable: false
    });
    
    // Динамическая метка сравнения
    let compareLabel = new Gtk.Label({
        label: "",
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
        width_chars: 6
    });
    
    // Кнопка копирования
    let copyButton = new Gtk.Button({
        valign: Gtk.Align.CENTER,
        tooltip_text: "Копировать в тему"
    });
    let arrowIcon = new Gtk.Image({
        icon_name: "go-next",
        icon_size: Gtk.IconSize.BUTTON
    });
    copyButton.set_image(arrowIcon);
    
    let rightImage = new Gtk.Image();
    rightImage.set_from_icon_name("image-missing", Gtk.IconSize.DIALOG);
    rightImage.set_size_request(128, 128);
    
    let blockData = {
        hbox: hbox,
        format: format,
        leftImage: leftImage,
        bitDepthComboBox: bitDepthComboBox,
        pathEntry: pathEntry,
        compareLabel: compareLabel,
        copyButton: copyButton,
        rightImage: rightImage,
        lastTempFile: null,
        hasThemeDir: false
    };
    
    bitDepthComboBox.connect("changed", () => {
        updateIcoImage(blockData);
        updateComparison(blockData);
    });
    
    copyButton.connect("clicked", () => {
        copyImageToTheme(blockData);
    });
    
    hbox.pack_start(leftImage, false, false, 0);
    hbox.pack_start(formatLabel, false, false, 0);
    hbox.pack_start(bitDepthComboBox, false, false, 0);
    hbox.pack_start(pathEntry, true, true, 0);
    hbox.pack_start(compareLabel, false, false, 0);
    hbox.pack_start(copyButton, false, false, 0);
    hbox.pack_start(rightImage, false, false, 0);
    
    return blockData;
}

function clearAllBottomBlocks() {
    bottomHboxes.forEach(block => {
        // Удаляем временные файлы
        if (block.lastTempFile) {
            GLib.unlink(block.lastTempFile);
        }
        scrollVbox.remove(block.hbox);
    });
    bottomHboxes = [];
}

function updateBlockImages(blockData) {
    updateIcoImage(blockData);
    updateThemeImage(blockData);
    updateComparison(blockData);
}

function getCurrentBitDepth(blockData) {
    let activeIndex = blockData.bitDepthComboBox.get_active();
    return blockData.bitDepthComboBox.bitDepths[activeIndex];
}

function updateIcoImage(blockData) {
    if (!icoFilePath) {
        blockData.leftImage.set_from_icon_name("image-missing", Gtk.IconSize.DIALOG);
        blockData.lastTempFile = null;
        return;
    }
    
    let format = blockData.format;
    let [width, height] = format.split('x');
    let bitDepth = getCurrentBitDepth(blockData);
    let tempDir = getTempDir();
    let tempFile = GLib.build_filenamev([tempDir, 'ico_extracted_' + GLib.get_real_time() + '_' + format + '_' + bitDepth + '.png']);
    
    try {
        let [success, stdout, stderr, exitStatus] = GLib.spawn_command_line_sync(
            'icotool -x -w ' + width + ' -h ' + height + 
            ' -b ' + bitDepth + ' -o ' + GLib.shell_quote(tempFile) + 
            ' ' + GLib.shell_quote(icoFilePath)
        );
        
        if (success && exitStatus === 0) {
            // Загружаем изображение
            let pixbuf = GdkPixbuf.Pixbuf.new_from_file(tempFile);
            
            // Масштабируем, если нужно
            let displaySize = displayScale || Math.max(parseInt(width), parseInt(height));
            let scaledPixbuf = scaleImage(pixbuf, displaySize, useBlur);
            
            if (scaledPixbuf) {
                blockData.leftImage.set_from_pixbuf(scaledPixbuf);
            } else {
                blockData.leftImage.set_from_pixbuf(pixbuf);
            }
            
            // Удаляем предыдущий временный файл
            if (blockData.lastTempFile) {
                GLib.unlink(blockData.lastTempFile);
            }
            blockData.lastTempFile = tempFile;
        } else {
            blockData.leftImage.set_from_icon_name("image-missing", Gtk.IconSize.DIALOG);
            if (blockData.lastTempFile) {
                GLib.unlink(blockData.lastTempFile);
                blockData.lastTempFile = null;
            }
            if (stderr.length > 0) {
                log("Ошибка icotool: " + imports.byteArray.toString(stderr));
            }
        }
    } catch (e) {
        blockData.leftImage.set_from_icon_name("image-missing", Gtk.IconSize.DIALOG);
        if (blockData.lastTempFile) {
            GLib.unlink(blockData.lastTempFile);
            blockData.lastTempFile = null;
        }
        log("Ошибка извлечения ICO: " + e.message);
    }
}

function updateThemeImage(blockData) {
    let iconName = searchEntry.get_text().trim();
    let dirPath = blockData.pathEntry.get_text();
    
    if (!iconName || !dirPath || !blockData.hasThemeDir) {
        blockData.rightImage.set_from_icon_name("image-missing", Gtk.IconSize.DIALOG);
        return;
    }
    
    let fileName = iconName + '.png';
    let filePath = GLib.build_filenamev([dirPath, fileName]);
    
    try {
        let pixbuf = GdkPixbuf.Pixbuf.new_from_file(filePath);
        
        // Определяем размер для отображения (используем тот же, что и для левого изображения)
        let format = blockData.format;
        let [width, height] = format.split('x');
        let displaySize = displayScale || Math.max(parseInt(width), parseInt(height));
        let scaledPixbuf = scaleImage(pixbuf, displaySize, useBlur);
        
        if (scaledPixbuf) {
            blockData.rightImage.set_from_pixbuf(scaledPixbuf);
        } else {
            blockData.rightImage.set_from_pixbuf(pixbuf);
        }
    } catch (e) {
        blockData.rightImage.set_from_icon_name("image-missing", Gtk.IconSize.DIALOG);
    }
}

function updateComparison(blockData) {
    if (!blockData.lastTempFile || !blockData.hasThemeDir) {
        blockData.compareLabel.set_text("");
        blockData.copyButton.set_sensitive(false);
        return;
    }
    
    let iconName = searchEntry.get_text().trim();
    let dirPath = blockData.pathEntry.get_text();
    
    if (!iconName || !dirPath) {
        blockData.compareLabel.set_text("");
        blockData.copyButton.set_sensitive(false);
        return;
    }
    
    let rightFilePath = GLib.build_filenamev([dirPath, iconName + '.png']);
    let result = compareImages(blockData.lastTempFile, rightFilePath);
    
    blockData.compareLabel.set_text(result.label);
    
    // Активируем кнопку только если есть что копировать (левый файл существует)
    blockData.copyButton.set_sensitive(blockData.lastTempFile !== null);
}

function copyImageToTheme(blockData) {
    if (!blockData.lastTempFile) {
        log("Нет извлечённого изображения для копирования");
        return;
    }
    
    let iconName = searchEntry.get_text().trim();
    let dirPath = blockData.pathEntry.get_text();
    
    if (!iconName || !dirPath) {
        log("Не указан путь назначения");
        return;
    }
    
    let destFilePath = GLib.build_filenamev([dirPath, iconName + '.png']);
    
    try {
        let srcFile = Gio.File.new_for_path(blockData.lastTempFile);
        let destFile = Gio.File.new_for_path(destFilePath);
        
        // Создаём директорию, если не существует
        let destDir = destFile.get_parent();
        if (!destDir.query_exists(null)) {
            destDir.make_directory_with_parents(null);
        }
        
        srcFile.copy(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
        print("Скопировано: " + blockData.lastTempFile + " -> " + destFilePath);
        
        // Обновляем изображения после копирования
        updateThemeImage(blockData);
        updateComparison(blockData);
    } catch (e) {
        log("Ошибка копирования: " + e.message);
    }
}

function updateAllPathEntries() {
    if (!currentContext || !dirArray[currentContext]) {
        bottomHboxes.forEach(block => {
            block.pathEntry.set_text('');
            block.hasThemeDir = false;
            block.rightImage.set_from_icon_name("image-missing", Gtk.IconSize.DIALOG);
            block.compareLabel.set_text("");
            block.copyButton.set_sensitive(false);
        });
        return;
    }
    
    let availableSizes = dirArray[currentContext];
    
    bottomHboxes.forEach(block => {
        let format = block.format;
        let [width, height] = format.split('x');
        let targetSize = parseInt(width);
        
        // Ищем точное совпадение размера
        if (availableSizes.includes(targetSize)) {
            let dirName = currentContext + '/' + targetSize;
            let fullPath = GLib.build_filenamev([themeBasePath, dirName]);
            block.pathEntry.set_text(fullPath);
            block.hasThemeDir = true;
        } else {
            // Нет подходящей директории
            block.pathEntry.set_text("Нет директории для " + format);
            block.hasThemeDir = false;
            block.rightImage.set_from_icon_name("image-missing", Gtk.IconSize.DIALOG);
            block.compareLabel.set_text("");
            block.copyButton.set_sensitive(false);
            return;
        }
        
        updateBlockImages(block);
    });
}

// ==================== ФУНКЦИЯ СОХРАНЕНИЯ INI ====================

function saveIniFile() {
    if (!icoFilePath) {
        log("Сначала откройте ICO файл");
        return;
    }
    
    let iconName = searchEntry.get_text().trim();
    if (!iconName) {
        log("Введите имя значка");
        return;
    }
    
    let icoDir = GLib.path_get_dirname(icoFilePath);
    let icoBasename = GLib.path_get_basename(icoFilePath);
    let icoNameWithoutExt = icoBasename.replace(/\.[^.]+$/, '');
    let iniFilePath = GLib.build_filenamev([icoDir, icoNameWithoutExt + '.ini']);
    
    let iniContent = '[defaults]\n';
    iniContent += 'name=' + iconName + '\n';
    iniContent += 'context=' + currentContext + '\n';
    
    if (themeFilePath) {
        iniContent += 'themefile=' + themeFilePath + '\n';
    } else {
        iniContent += 'themefile=\n';
    }
    
    if (displayScale) {
        iniContent += 'scale=' + displayScale + '\n';
    }
    
    if (useBlur) {
        iniContent += 'blur=true\n';
    }
    
    iniContent += '\n[bit-depth]\n';
    
    let sortedFormats = Object.keys(icoFormats).sort((a, b) => {
        let [aw, ah] = a.split('x').map(Number);
        let [bw, bh] = b.split('x').map(Number);
        return aw - bw || ah - bh;
    });
    
    sortedFormats.forEach(format => {
        let block = bottomHboxes.find(b => b.format === format);
        if (block) {
            let selectedBitDepth = getCurrentBitDepth(block);
            iniContent += format + '=' + selectedBitDepth + '\n';
        }
    });
    
    try {
        let file = Gio.File.new_for_path(iniFilePath);
        let [success] = file.replace_contents(
            iniContent,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null
        );
        
        if (success) {
            print("INI файл сохранён: " + iniFilePath);
        } else {
            log("Ошибка сохранения INI файла");
        }
    } catch (e) {
        log("Ошибка записи: " + e.message);
    }
}

// ==================== ФУНКЦИЯ ЗАГРУЗКИ ICO С INI ====================

function loadIcoWithIni(filePath) {
    icoFilePath = filePath;
    print("Открыт ICO: " + icoFilePath);
    
    icoFormats = parseIcoFile(icoFilePath);
    print("Найденные форматы и глубины цвета:");
    for (let format in icoFormats) {
        print("  " + format + ": " + icoFormats[format].map(d => getBitDepthLabel(d)).join(", "));
    }
    
    let icoDir = GLib.path_get_dirname(icoFilePath);
    let icoBasename = GLib.path_get_basename(icoFilePath);
    let icoNameWithoutExt = icoBasename.replace(/\.[^.]+$/, '');
    let iniFilePath = GLib.build_filenamev([icoDir, icoNameWithoutExt + '.ini']);
    
    iniData = parseIniFile(iniFilePath);
    let defaultBitDepths = {};
    
    // Устанавливаем параметры из INI
    if (iniData.scale) {
        displayScale = iniData.scale;
        print("Размер отображения из INI: " + displayScale);
    } else if (cmdlineScale) {
        displayScale = cmdlineScale;
        print("Размер отображения из аргументов: " + displayScale);
    }
    
    if (iniData.blur) {
        useBlur = true;
        print("Сглаживание включено из INI");
    } else if (cmdlineBlur) {
        useBlur = true;
        print("Сглаживание включено из аргументов");
    }
    
    if (iniData.name) {
        print("Загружен INI файл: " + iniFilePath);
        
        if (cmdlineIconName) {
            searchEntry.set_text(cmdlineIconName);
        } else {
            searchEntry.set_text(iniData.name);
        }
        
        let contextToSet = cmdlineContext || iniData.context;
        
        if (contextToSet) {
            if (Object.keys(dirArray).length > 0) {
                if (selectContext(contextToSet)) {
                    print("Контекст установлен: " + contextToSet);
                } else {
                    log("Контекст '" + contextToSet + "' не найден в теме");
                }
            } else {
                pendingContext = contextToSet;
                print("Контекст '" + contextToSet + "' будет установлен после загрузки темы");
            }
        }
        
        if (iniData.themefile) {
            let themeFile = Gio.File.new_for_path(iniData.themefile);
            if (themeFile.query_exists(null)) {
                loadThemeFile(iniData.themefile);
            }
        }
        
        defaultBitDepths = iniData.bitDepths;
    } else {
        if (cmdlineIconName) {
            searchEntry.set_text(cmdlineIconName);
        } else {
            searchEntry.set_text(icoNameWithoutExt);
        }
    }
    
    clearAllBottomBlocks();
    
    let sortedFormats = Object.keys(icoFormats).sort((a, b) => {
        let [aw, ah] = a.split('x').map(Number);
        let [bw, bh] = b.split('x').map(Number);
        return aw - bw || ah - bh;
    });
    
    sortedFormats.forEach(format => {
        let defaultDepth = defaultBitDepths[format] || getDefaultBitDepth(icoFormats[format]);
        let blockData = createBottomHbox(format, icoFormats[format], defaultDepth);
        bottomHboxes.push(blockData);
        scrollVbox.pack_start(blockData.hbox, false, false, 0);
    });
    
    if (currentContext) {
        updateAllPathEntries();
    }
    
    scrollVbox.show_all();
}

function loadThemeFile(filePath) {
    themeFilePath = filePath;
    print("Загружена тема: " + themeFilePath);
    
    themeBasePath = getThemeBasePath(themeFilePath);
    dirArray = parseIndexTheme(themeFilePath);
    
    print("Найдены контексты:");
    for (let context in dirArray) {
        print("  " + context + ": " + dirArray[context].join(", "));
    }
    
    updateContextComboBox();
}

// ==================== ОБРАБОТЧИКИ ====================

openIcoButton.connect("clicked", () => {
    let dialog = new Gtk.FileChooserDialog({
        title: "Выберите ICO файл",
        action: Gtk.FileChooserAction.OPEN,
        transient_for: window,
        modal: true
    });
    
    dialog.add_button("Отмена", Gtk.ResponseType.CANCEL);
    dialog.add_button("Открыть", Gtk.ResponseType.OK);
    
    let filter = new Gtk.FileFilter();
    filter.set_name("ICO файлы");
    filter.add_pattern("*.ico");
    dialog.add_filter(filter);
    
    dialog.connect("response", (dialog, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            loadIcoWithIni(dialog.get_filename());
        }
        dialog.destroy();
    });
    
    dialog.show();
});

openThemeButton.connect("clicked", () => {
    let dialog = new Gtk.FileChooserDialog({
        title: "Выберите файл index.theme",
        action: Gtk.FileChooserAction.OPEN,
        transient_for: window,
        modal: true
    });
    
    dialog.add_button("Отмена", Gtk.ResponseType.CANCEL);
    dialog.add_button("Открыть", Gtk.ResponseType.OK);
    
    let filter = new Gtk.FileFilter();
    filter.set_name("Файлы index.theme");
    filter.add_pattern("index.theme");
    dialog.add_filter(filter);
    
    dialog.connect("response", (dialog, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            loadThemeFile(dialog.get_filename());
        }
        dialog.destroy();
    });
    
    dialog.show();
});

saveIniButton.connect("clicked", () => {
    saveIniFile();
});

function updateContextComboBox() {
    let previousContext = currentContext;
    
    contextComboBox.remove_all();
    
    let contexts = Object.keys(dirArray).sort();
    
    if (contexts.length === 0) {
        contextComboBox.append_text("Нет контекстов");
        contextComboBox.set_active(0);
        currentContext = '';
        return;
    }
    
    contexts.forEach(context => {
        contextComboBox.append_text(context);
    });
    
    let targetContext = pendingContext || previousContext || contexts[0];
    
    if (targetContext && contexts.includes(targetContext)) {
        let index = contexts.indexOf(targetContext);
        contextComboBox.set_active(index);
        currentContext = targetContext;
        if (pendingContext && targetContext === pendingContext) {
            print("Установлен ожидающий контекст: " + pendingContext);
            pendingContext = null;
        }
    } else {
        contextComboBox.set_active(0);
        currentContext = contexts[0];
    }
    
    updateAllPathEntries();
}

contextComboBox.connect("changed", () => {
    let selected = contextComboBox.get_active_text();
    if (selected && selected !== "Нет контекстов") {
        currentContext = selected;
        updateAllPathEntries();
    }
});

let searchTimeout = 0;
searchEntry.connect("changed", () => {
    if (searchTimeout) {
        GLib.source_remove(searchTimeout);
    }
    searchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
        bottomHboxes.forEach(block => {
            updateBlockImages(block);
        });
        searchTimeout = 0;
        return false;
    });
});

// ==================== КОМПОНОВКА ====================

scrollWindow.add(scrollVbox);
mainVbox.pack_start(topHbox, false, false, 0);
mainVbox.pack_start(scrollWindow, true, true, 0);

window.add(mainVbox);

window.connect("destroy", () => {
    // Очистка временных файлов при выходе
    bottomHboxes.forEach(block => {
        if (block.lastTempFile) {
            GLib.unlink(block.lastTempFile);
        }
    });
    Gtk.main_quit();
});

window.show_all();

// ==================== АВТОЗАГРУЗКА ИЗ АРГУМЕНТОВ ====================

if (cmdlineThemeFile) {
    print("Загрузка темы из аргументов: " + cmdlineThemeFile);
    let file = Gio.File.new_for_path(cmdlineThemeFile);
    if (file.query_exists(null)) {
        loadThemeFile(cmdlineThemeFile);
    } else {
        log("Файл темы не найден: " + cmdlineThemeFile);
    }
}

if (cmdlineIcoFile) {
    print("Загрузка ICO из аргументов: " + cmdlineIcoFile);
    let file = Gio.File.new_for_path(cmdlineIcoFile);
    if (file.query_exists(null)) {
        loadIcoWithIni(cmdlineIcoFile);
    } else {
        log("ICO файл не найден: " + cmdlineIcoFile);
    }
}

Gtk.main();