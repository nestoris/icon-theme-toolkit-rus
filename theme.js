// theme.js
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// Включаем асинхронные методы для Gio.File и Gio.FileEnumerator
Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');

var Theme = class Theme {
    constructor(themePath) {
        this.themePath = themePath;
        this.themeDir = '';
        this.name = '';
        this.comment = '';
        this.inherits = '';
        this.directories = [];       
        this.dirInfo = new Map();    
        this.dirLines = new Map();   // <--- ДОБАВЛЕНА ЭТА СТРОКА
        this.icons = new Map();      
        this.problems = [];          
        this.isLoaded = false;
        this.contextMap = new Map();     // "Applications" -> "apps"
        this.standardContexts = ["Actions", "Applications", "Apps", "Categories", "Devices", "FileSystems", "MimeTypes", "Mimes", "Places", "Status"];
    }

    async load(progress = null) {
        if (this.isLoaded) return true;
        this.problems = [];

        let file = Gio.File.new_for_path(this.themePath);
        if (!file.query_exists(null)) return false;

        let info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            this.themeDir = file.get_path();
            let indexFile = GLib.build_filenamev([this.themeDir, 'index.theme']);
            if (!Gio.File.new_for_path(indexFile).query_exists(null)) return false;
            this.indexPath = indexFile;
        } else if (GLib.path_get_basename(file.get_path()) === 'index.theme') {
            this.indexPath = file.get_path();
            this.themeDir = GLib.path_get_dirname(this.indexPath);
        } else {
            return false;
        }

        if (progress) progress.setStatus(0.1, 'Парсинг index.theme...');
        this._parseIndexTheme();
        
        // Проверка на тему курсоров (если нет секций каталогов, но есть cursors)
        let cursorsDir = GLib.build_filenamev([this.themeDir, 'cursors']);
        if (GLib.file_test(cursorsDir, GLib.FileTest.IS_DIR) && this.directories.length === 0) {
            this.problems.push({ type: 'error', line: 0, msg: 'Это тема курсоров. Редактор значков не поддерживает её.' });
            return false;
        }

        try {
            await this._scanFiles(progress);
        } catch (e) {
            if (e.message === 'Cancelled by user') {
                print("Загрузка отменена пользователем.");
                return false;
            }
            throw e;
        }
        
        this.isLoaded = true;
        if (progress) progress.setStatus(1.0, 'Готово');
        return true;
    }

    _parseIndexTheme(textOverride) {
        try {
            let text = textOverride;
            if (!text) {
                let file = Gio.File.new_for_path(this.indexPath);
                let [success, contents] = file.load_contents(null);
                if (!success) throw new Error("Не удалось прочитать файл");
                text = new TextDecoder('utf-8').decode(contents);
            }

            let lines = text.split('\n');

            if (text.indexOf('\r\n') !== -1) {
                this.problems.push({ type: 'warning', line: 0, msg: 'Файл содержит CRLF. Рекомендуется LF.' });
                text = text.replace(/\r\n/g, '\n');
                lines = text.split('\n');
            }
            if (text.indexOf('\uFEFF') === 0) {
                this.problems.push({ type: 'warning', line: 0, msg: 'Файл содержит BOM.' });
                text = text.substring(1);
                lines = text.split('\n');
            }

            let currentSection = '';
            this.iniData = {}; 
            let dirsLine = -1;

            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (line.startsWith('[') && line.endsWith(']')) {
                    currentSection = line.substring(1, line.length - 1);
                    if (!this.iniData[currentSection]) this.iniData[currentSection] = {};
                } else if (line.includes('=') && currentSection) {
                    let eq = line.indexOf('=');
                    let k = line.substring(0, eq).trim();
                    let v = line.substring(eq + 1).trim();
                    this.iniData[currentSection][k] = v;
                    
                    if (currentSection === 'Icon Theme' && k === 'Directories') {
                        dirsLine = i;
                    }
                }
            }

            let iconTheme = this.iniData['Icon Theme'] || {};
            this.name = iconTheme['Name'] || '';
            this.comment = iconTheme['Comment'] || '';
            this.inherits = iconTheme['Inherits'] || '';

            let dirsStr = iconTheme['Directories'] || '';
            this.directories = dirsStr.split(',').map(s => s.trim()).filter(Boolean);

            this.dirInfo.clear();
            this.dirLines.clear();

            for (let dirName of this.directories) {
                let params = this.iniData[dirName] || {};
                
                let secLine = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim() === '[' + dirName + ']') { secLine = i; break; }
                }
                this.dirLines.set(dirName, { dirLine: dirsLine, secLine: secLine });

                this.dirInfo.set(dirName, {
                    rawParams: params,
                    context: params['Context'] || '',
                    size: parseInt(params['Size']) || null,
                    scale: parseInt(params['Scale']) || null,
                    type: params['Type'] || 'Fixed'
                });

                let folderPart = dirName.split('/')[0];
                let ctxName = params['Context'] || (folderPart.charAt(0).toUpperCase() + folderPart.slice(1));
                
                // Запоминаем связь: Context=Applications -> папка apps
                if (!this.contextMap.has(ctxName)) {
                    this.contextMap.set(ctxName, folderPart);
                }
                
                if (!this.standardContexts.includes(ctxName)) {
                    this.standardContexts.push(ctxName);
                }

                if (!this.iniData[dirName]) {
                    this.problems.push({ 
                        type: 'error', 
                        line: dirsLine, 
                        dirName: dirName, 
                        probType: 'missing_section',
                        msg: `Отсутствует секция [${dirName}] в index.theme.` 
                    });
                }

                if (dirName.includes(' ')) {
                    let l = secLine >= 0 ? secLine : dirsLine;
                    this.problems.push({ 
                        type: 'error', line: l, dirName: dirName, probType: 'spaces',
                        msg: `Каталог "${dirName}" содержит пробелы.` 
                    });
                }
            }
        } catch (e) {
            this.problems.push({ type: 'error', line: 0, msg: 'Ошибка парсинга: ' + e.message });
        }
    }

    async _scanFiles(progress) {
        // 1. Ищем папки на диске, которых нет в Directories
        let themeDirFile = Gio.File.new_for_path(this.themeDir);
        try {
            let enumr = themeDirFile.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumr.next_file(null)) !== null) {
                if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                    let topDir = info.get_name();
                    if (topDir === 'cursors') continue;
                    let topDirPath = GLib.build_filenamev([this.themeDir, topDir]);
                    let subEnumr = Gio.File.new_for_path(topDirPath).enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                    let subInfo;
                    while ((subInfo = subEnumr.next_file(null)) !== null) {
                        if (subInfo.get_file_type() === Gio.FileType.DIRECTORY) {
                            let subDir = subInfo.get_name();
                            let fullRelPath = topDir + '/' + subDir;
                            if (!this.directories.includes(fullRelPath)) {
                                this.problems.push({
                                    type: 'error', line: 0, dirName: fullRelPath, probType: 'missing_directories',
                                    msg: `Каталог "${fullRelPath}" отсутствует в Directories.`
                                });
                                // Добавляем в dirInfo, чтобы он был виден в таблице
                                this.dirInfo.set(fullRelPath, { rawParams: {}, context: '', size: parseInt(subDir) || null, scale: null, type: 'Fixed' });
                            }
                        }
                    }
                    subEnumr.close(null);
                }
            }
            enumr.close(null);
        } catch (e) {}

        // 2. Обычное сканирование
        let totalDirs = this.directories.length;
        let processed = 0;

        for (let dirName of this.directories) {
            if (progress && progress.isCancelled()) throw new Error('Cancelled by user');
            if (progress) {
                progress.setStatus(processed / totalDirs, `Сканирование ${dirName}...`);
            }

            let absDir = GLib.build_filenamev([this.themeDir, dirName]);
            let dir = Gio.File.new_for_path(absDir);

            let l = this.dirLines.get(dirName);
            let lineNum = l ? (l.secLine >= 0 ? l.secLine : l.dirLine) : -1;

            if (!dir.query_exists(null)) {
                this.problems.push({ type: 'error', line: lineNum, dirName: dirName, probType: 'missing_disk', msg: `Каталог "${dirName}" отсутствует на диске.` });
                processed++;
                continue;
            }

            let enumerator = null;
            try {
                enumerator = await dir.enumerate_children_async(
                    'standard::name,standard::type,standard::is-symlink,standard::symlink-target',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                    GLib.PRIORITY_DEFAULT,
                    null
                );
            } catch (e) {
                processed++;
                continue;
            }

            let fileInfos;
            do {
                if (progress && progress.isCancelled()) {
                    if (enumerator) enumerator.close(null);
                    throw new Error('Cancelled by user');
                }

                try {
                    fileInfos = await enumerator.next_files_async(200, GLib.PRIORITY_DEFAULT, null);
                } catch (e) {
                    break;
                }

                for (let fileInfo of fileInfos) {
                    let fileName = fileInfo.get_name();
                    let dotIdx = fileName.lastIndexOf('.');
                    if (dotIdx <= 0) continue;

                    let ext = fileName.substring(dotIdx).toLowerCase();
                    if (ext !== '.png' && ext !== '.svg' && ext !== '.xpm') continue;

                    let baseName = fileName.substring(0, dotIdx);
                    if (baseName.includes(' ')) {
                        this.problems.push({ type: 'error', line: lineNum, dirName: dirName, probType: 'spaces_file', msg: `Файл "${fileName}" содержит пробелы.` });
                    }

                    let isSymlink = fileInfo.get_is_symlink();
                    let target = null;
                    let resolvedTarget = null;

                    if (isSymlink) {
                        target = fileInfo.get_symlink_target();
                        let baseDir = GLib.build_filenamev([this.themeDir, dirName]);
                        resolvedTarget = GLib.canonicalize_filename(target, baseDir);

                        if (!Gio.File.new_for_path(resolvedTarget).query_exists(null)) {
                            this.problems.push({ 
                                type: 'error', line: lineNum, dirName: dirName, probType: 'deadlink',
                                msg: `Битый симлинк: ${dirName}/${fileName} -> ${target}`,
                                filePath: absDir + '/' + fileName, targetName: GLib.path_get_basename(target)
                            });
                        }
                    }

                    if (!this.icons.has(baseName)) this.icons.set(baseName, []);
                    this.icons.get(baseName).push({ 
                        dirName: dirName, fileName: fileName, fullPath: absDir + '/' + fileName, 
                        isSymlink: isSymlink, 
                        size: this.dirInfo.get(dirName).size, 
                        context: this.dirInfo.get(dirName).context,
                        target: target,
                        resolvedTarget: resolvedTarget
                    });
                }
            } while (fileInfos.length > 0);

            if (enumerator) {
                try { enumerator.close(null); } catch (e) {}
            }
            processed++;
        }
    }
};