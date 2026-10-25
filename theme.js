// theme.js
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

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

    async load() {
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

        this._parseIndexTheme();
        await this._scanFiles();
        this.isLoaded = true;
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

                if (dirName.includes(' ')) {
                    let l = secLine >= 0 ? secLine : dirsLine;
                    this.problems.push({ type: 'error', line: l, dirName: dirName, msg: `Каталог "${dirName}" содержит пробелы.` });
                }
            }
        } catch (e) {
            this.problems.push({ type: 'error', line: 0, msg: 'Ошибка парсинга: ' + e.message });
        }
    }

    async _scanFiles() {
        for (let dirName of this.directories) {
            let absDir = GLib.build_filenamev([this.themeDir, dirName]);
            let dir = Gio.File.new_for_path(absDir);

            // Определяем строку для привязки ошибок этого каталога
            let l = this.dirLines.get(dirName);
            let lineNum = l ? (l.secLine >= 0 ? l.secLine : l.dirLine) : -1;

            if (!dir.query_exists(null)) {
                this.problems.push({ type: 'error', line: lineNum, dirName: dirName, msg: `Каталог "${dirName}" отсутствует на диске.` });
                continue;
            }

            let enumerator;
            try {
                enumerator = dir.enumerate_children('standard::name,standard::type,standard::is-symlink,standard::symlink-target', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            } catch (e) { continue; }

            let fileInfo;
            while ((fileInfo = enumerator.next_file(null)) !== null) {
                let fileName = fileInfo.get_name();
                let dotIdx = fileName.lastIndexOf('.');
                if (dotIdx <= 0) continue;

                let ext = fileName.substring(dotIdx).toLowerCase();
                if (ext !== '.png' && ext !== '.svg' && ext !== '.xpm') continue;

                let baseName = fileName.substring(0, dotIdx);
                if (baseName.includes(' ')) {
                    this.problems.push({ type: 'error', line: lineNum, dirName: dirName, msg: `Файл "${fileName}" содержит пробелы.` });
                }

                let isSymlink = fileInfo.get_is_symlink();
                let target = null;
                let resolvedTarget = null;

                if (isSymlink) {
                    target = fileInfo.get_symlink_target();
                    let baseDir = GLib.build_filenamev([this.themeDir, dirName]);
                    resolvedTarget = GLib.canonicalize_filename(target, baseDir);

                    if (!Gio.File.new_for_path(resolvedTarget).query_exists(null)) {
                        // Привязываем битый симлинк к строке его секции
                        this.problems.push({ 
                            type: 'error', 
                            line: lineNum, 
                            dirName: dirName, // <--- ДОБАВЛЕНО
                            msg: `Битый симлинк: ${dirName}/${fileName} -> ${target}`,
                            filePath: absDir + '/' + fileName,
                            targetName: GLib.path_get_basename(target)
                        });
                    }
                }

                if (!this.icons.has(baseName)) this.icons.set(baseName, []);
                this.icons.get(baseName).push({ 
                    dirName: dirName, 
                    fileName: fileName, 
                    fullPath: absDir + '/' + fileName, 
                    isSymlink: isSymlink,
                    size: this.dirInfo.get(dirName).size,
                    context: this.dirInfo.get(dirName).context
                });
            }
            enumerator.close(null);
        }
    }
};