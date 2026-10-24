// theme.js
// Ядро комбайна. Читает тему, сканирует файлы, собирает ошибки.

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

var Theme = class Theme {
    constructor(themePath) {
        this.themePath = themePath;
        this.themeDir = '';
        this.name = '';
        this.comment = '';
        this.inherits = '';
        this.directories = [];       // Список имен каталогов из index.theme
        this.dirInfo = new Map();    // Имя каталога -> { context, size, scale, type }
        this.icons = new Map();      // Базовое имя -> массив объектов (occurrences)
        this.problems = [];          // Массив ошибок и предупреждений (freedesktop specs)
        this.isLoaded = false;
    }

    // Загрузка темы (async, чтобы не вешать интерфейс)
    async load() {
        if (this.isLoaded) return true;
        this.problems = [];

        // 1. Определяем, где находится index.theme
        let file = Gio.File.new_for_path(this.themePath);
        if (!file.query_exists(null)) {
            this.problems.push({ type: 'error', msg: 'Путь не существует: ' + this.themePath });
            return false;
        }

        let info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            this.themeDir = file.get_path();
            let indexFile = GLib.build_filenamev([this.themeDir, 'index.theme']);
            if (!Gio.File.new_for_path(indexFile).query_exists(null)) {
                this.problems.push({ type: 'error', msg: 'В каталоге нет index.theme: ' + this.themeDir });
                return false;
            }
            this.indexPath = indexFile;
        } else if (GLib.path_get_basename(file.get_path()) === 'index.theme') {
            this.indexPath = file.get_path();
            this.themeDir = GLib.path_get_dirname(this.indexPath);
        } else {
            this.problems.push({ type: 'error', msg: 'Неверный файл (ожидался index.theme): ' + this.themePath });
            return false;
        }

        // 2. Парсим index.theme (с защитой от Блокнота Windows)
        this._parseIndexTheme();

        // 3. Сканируем файлы
        await this._scanFiles();

        this.isLoaded = true;
        return true;
    }

    _parseIndexTheme() {
        try {
            let file = Gio.File.new_for_path(this.indexPath);
            let [success, contents] = file.load_contents(null);
            if (!success) throw new Error("Не удалось прочитать файл");

            let text = new TextDecoder('utf-8').decode(contents);

            // ФИКС ДЛЯ WINDOWS NOTEPAD: Удаляем BOM и заменяем \r\n на \n
            text = text.replace(/^\uFEFF/, ''); // Удаляем BOM
            text = text.replace(/\r\n/g, '\n'); // Убираем CR

            let kf = new GLib.KeyFile();
            kf.load_from_data(text, text.length, GLib.KeyFileFlags.NONE);

            // Читаем базовые параметры
            try { this.name = kf.get_string('Icon Theme', 'Name'); } catch (e) {}
            try { this.comment = kf.get_string('Icon Theme', 'Comment'); } catch (e) {}
            try { this.inherits = kf.get_string('Icon Theme', 'Inherits'); } catch (e) {}

            // Читаем список каталогов
            let dirsStr = '';
            try { dirsStr = kf.get_string('Icon Theme', 'Directories'); } catch (e) {}
            this.directories = dirsStr.split(',').map(s => s.trim()).filter(Boolean);

            // Читаем параметры каждого каталога
            for (let dirName of this.directories) {
                let dirData = { context: '', size: null, scale: null, type: 'Fixed' };
                try { dirData.context = kf.get_string(dirName, 'Context'); } catch (e) {}
                try { dirData.type = kf.get_string(dirName, 'Type'); } catch (e) {}
                try {
                    let s = kf.get_integer(dirName, 'Size');
                    if (s > 0) dirData.size = s;
                } catch (e) {}
                try {
                    let sc = kf.get_integer(dirName, 'Scale');
                    if (sc > 0) dirData.scale = sc;
                } catch (e) {}
                
                this.dirInfo.set(dirName, dirData);

                // ВАЛИДАЦИЯ: Пробелы в именах каталогов
                if (dirName.includes(' ')) {
                    this.problems.push({ 
                        type: 'error', 
                        msg: `Каталог "${dirName}" содержит пробелы (сломает gtk-update-icon-cache).` 
                    });
                }
            }

        } catch (e) {
            this.problems.push({ type: 'error', msg: 'Ошибка парсинга index.theme: ' + e.message });
        }
    }

    async _scanFiles() {
        for (let dirName of this.directories) {
            let absDir = GLib.build_filenamev([this.themeDir, dirName]);
            let dir = Gio.File.new_for_path(absDir);

            if (!dir.query_exists(null)) {
                this.problems.push({ 
                    type: 'error', 
                    msg: `Каталог "${dirName}" указан в index.theme, но отсутствует на диске.` 
                });
                continue;
            }

            let enumerator;
            try {
                enumerator = dir.enumerate_children(
                    'standard::name,standard::type,standard::is-symlink,standard::symlink-target',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            } catch (e) {
                this.problems.push({ type: 'error', msg: 'Нет доступа к каталогу: ' + dirName });
                continue;
            }

            let fileInfo;
            while ((fileInfo = enumerator.next_file(null)) !== null) {
                let fileName = fileInfo.get_name();
                let dotIdx = fileName.lastIndexOf('.');
                if (dotIdx <= 0) continue; // Файлы без расширения или скрытые

                let ext = fileName.substring(dotIdx).toLowerCase();
                if (ext !== '.png' && ext !== '.svg' && ext !== '.xpm') continue;

                let baseName = fileName.substring(0, dotIdx);

                // ВАЛИДАЦИЯ: Пробелы в именах файлов
                if (baseName.includes(' ')) {
                    this.problems.push({ 
                        type: 'error', 
                        msg: `Файл "${dirName}/${fileName}" содержит пробелы в имени.` 
                    });
                }

                // Собираем информацию о симлинках
                let isSymlink = fileInfo.get_is_symlink();
                let target = null;
                let resolvedTarget = null;

                if (isSymlink) {
                    target = fileInfo.get_symlink_target();
                    let baseDir = GLib.build_filenamev([this.themeDir, dirName]);
                    resolvedTarget = GLib.canonicalize_filename(target, baseDir);

                    // ВАЛИДАЦИЯ: Битые симлинки
                    if (!Gio.File.new_for_path(resolvedTarget).query_exists(null)) {
                        this.problems.push({ 
                            type: 'error', 
                            msg: `Битый симлинк: ${dirName}/${fileName} -> ${target}` 
                        });
                    }
                }

                // Сохраняем в общий индекс
                if (!this.icons.has(baseName)) {
                    this.icons.set(baseName, []);
                }

                this.icons.get(baseName).push({
                    dirName: dirName,
                    fileName: fileName,
                    fullPath: GLib.build_filenamev([absDir, fileName]),
                    relPath: dirName + '/' + fileName,
                    size: this.dirInfo.get(dirName).size,
                    context: this.dirInfo.get(dirName).context,
                    isSymlink: isSymlink,
                    target: target,
                    resolvedTarget: resolvedTarget
                });
            }
            enumerator.close(null);
        }
    }

    // Метод для вывода отчета в консоль (для теста)
    printReport() {
        print(`=== Тема: ${this.name || 'Без имени'} ===`);
        print(`Путь: ${this.themeDir}`);
        print(`Наследует: ${this.inherits || 'ничего'}`);
        print(`Каталогов в index.theme: ${this.directories.length}`);
        print(`Уникальных имен значков: ${this.icons.size}`);
        print(`Проблем найдено: ${this.problems.length}`);
        
        if (this.problems.length > 0) {
            print(`\n--- СПИСОК ПРОБЛЕМ ---`);
            this.problems.forEach((p, i) => {
                print(`[${i+1}] (${p.type.toUpperCase()}): ${p.msg}`);
            });
        }
    }
};