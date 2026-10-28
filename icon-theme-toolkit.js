#!/usr/bin/gjs
// icon-theme-toolkit.js

imports.gi.versions.Gtk = '3.0';
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gdk = imports.gi.Gdk;
const GdkPixbuf = imports.gi.GdkPixbuf;

Gtk.init(null);

const here = GLib.path_get_dirname(imports.system.programInvocationName);
imports.searchPath.unshift(here);
const ThemeModule = imports.theme;
const SettingsModule = imports.settings;

function loadPixbufNoSmooth(path, size) {
    try {
        let raw = GdkPixbuf.Pixbuf.new_from_file(path);
        let w = raw.get_width();
        let h = raw.get_height();
        if (w === size && h === size) return raw;

        const scale = Math.min(size / w, size / h);
        const newW = Math.max(1, Math.round(w * scale));
        const newH = Math.max(1, Math.round(h * scale));
        const scaled = (newW === w && newH === h) ? raw : raw.scale_simple(newW, newH, GdkPixbuf.InterpType.NEAREST);

        if (newW === size && newH === size) return scaled;

        const canvas = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, size, size);
        canvas.fill(0x00000000);
        scaled.copy_area(0, 0, newW, newH, canvas, Math.floor((size - newW) / 2), Math.floor((size - newH) / 2));
        return canvas;
    } catch (e) {
        return null;
    }
}

let _transparentPixbuf = null;
function getTransparentPixbuf() {
    if (!_transparentPixbuf) {
        _transparentPixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 1, 1);
        _transparentPixbuf.fill(0x00000000);
    }
    return _transparentPixbuf;
}

const pixbufCache = new Map();
function pixbufFromFileCached(path, size) {
    const cacheKey = path + '::' + size;
    if (pixbufCache.has(cacheKey)) return pixbufCache.get(cacheKey);

    let result = null;
    try {
        let raw = GdkPixbuf.Pixbuf.new_from_file(path);
        let w = raw.get_width();
        let h = raw.get_height();

        if (w === size && h === size) {
            result = raw;
        } else {
            const scale = Math.min(size / w, size / h);
            const newW = Math.max(1, Math.round(w * scale));
            const newH = Math.max(1, Math.round(h * scale));
            const scaled = (newW === w && newH === h) ? raw : raw.scale_simple(newW, newH, GdkPixbuf.InterpType.NEAREST);

            if (newW === size && newH === size) {
                result = scaled;
            } else {
                const canvas = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, size, size);
                canvas.fill(0x00000000);
                scaled.copy_area(0, 0, newW, newH, canvas, Math.floor((size - newW) / 2), Math.floor((size - newH) / 2));
                result = canvas;
            }
        }
    } catch (e) {
        result = null;
    }

    pixbufCache.set(cacheKey, result);
    return result;
}

function openPathWithDefault(path) {
    try {
        const uri = Gio.File.new_for_path(path).get_uri();
        Gio.AppInfo.launch_default_for_uri(uri, null);
        return true;
    } catch (e) {
        print("Не удалось открыть путь: " + e.message);
        return false;
    }
}

function getIconSearchPaths() {
    const paths = [];
    paths.push(GLib.build_filenamev([GLib.get_home_dir(), '.icons']));
    paths.push(GLib.build_filenamev([GLib.get_user_data_dir(), 'icons']));
    for (const d of GLib.get_system_data_dirs()) {
        paths.push(GLib.build_filenamev([d, 'icons']));
    }
    paths.push('/usr/share/pixmaps');
    return paths;
}

class SystemThemesDialog {
    constructor(parent, app) {
        this.app = app;
        this.dialog = new Gtk.Dialog({
            title: 'Добавить системные темы',
            transient_for: parent,
            modal: true,
            default_width: 820,
            default_height: 520
        });
        this.dialog.add_button('Отмена', Gtk.ResponseType.CANCEL);
        this.dialog.add_button('Добавить выбранные', Gtk.ResponseType.OK);

        this.buildUI();
    }

    buildUI() {
        const content = this.dialog.get_content_area();
        content.set_spacing(6);
        content.set_margin_start(10); content.set_margin_end(10);
        content.set_margin_top(10); content.set_margin_bottom(10);

        const label = new Gtk.Label({
            label: 'Выберите одну или несколько системных тем для добавления:',
            halign: Gtk.Align.START
        });
        content.pack_start(label, false, false, 0);

        this.store = new Gtk.ListStore();
        this.store.set_column_types([
            GdkPixbuf.Pixbuf,    // 0 preview
            GObject.TYPE_STRING, // 1 name
            GObject.TYPE_STRING, // 2 path
            GObject.TYPE_STRING  // 3 example
        ]);

        this.view = new Gtk.TreeView({ model: this.store });
        this.view.get_selection().set_mode(Gtk.SelectionMode.MULTIPLE);

        const pixRenderer = new Gtk.CellRendererPixbuf();
        pixRenderer.set_property('xpad', 4);
        pixRenderer.set_property('ypad', 2);
        const pixCol = new Gtk.TreeViewColumn({ title: 'Превью' });
        pixCol.pack_start(pixRenderer, false);
        pixCol.add_attribute(pixRenderer, 'pixbuf', 0);
        pixCol.set_min_width(56);
        pixCol.set_resizable(true);
        this.view.append_column(pixCol);

        const nameRenderer = new Gtk.CellRendererText();
        nameRenderer.set_property('ellipsize', 3);
        const nameCol = new Gtk.TreeViewColumn({ title: 'Название' });
        nameCol.pack_start(nameRenderer, true);
        nameCol.add_attribute(nameRenderer, 'text', 1);
        nameCol.set_min_width(160);
        nameCol.set_resizable(true);
        nameCol.set_sort_column_id(1);
        nameCol.set_clickable(true);
        nameCol.set_expand(true);
        this.view.append_column(nameCol);

        const pathRenderer = new Gtk.CellRendererText();
        pathRenderer.set_property('ellipsize', 3);
        const pathCol = new Gtk.TreeViewColumn({ title: 'Путь' });
        pathCol.pack_start(pathRenderer, true);
        pathCol.add_attribute(pathRenderer, 'text', 2);
        pathCol.set_min_width(300);
        pathCol.set_resizable(true);
        pathCol.set_sort_column_id(2);
        pathCol.set_clickable(true);
        pathCol.set_expand(true);
        this.view.append_column(pathCol);

        this.store.set_sort_column_id(1, Gtk.SortType.ASCENDING);

        const scroll = new Gtk.ScrolledWindow();
        scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC);
        scroll.add(this.view);
        content.pack_start(scroll, true, true, 0);

        this.dialog.show_all();
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.scanSystemThemes();
            return false;
        });
    }

    scanSystemThemes() {
        const searchDirs = getIconSearchPaths();
        const seen = new Set();
        const themes = [];

        for (const baseDir of searchDirs) {
            const dir = Gio.File.new_for_path(baseDir);
            let enumerator;
            try {
                enumerator = dir.enumerate_children(
                    'standard::name,standard::type',
                    Gio.FileQueryInfoFlags.NONE, null);
            } catch (e) {
                continue;
            }

            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_file_type() !== Gio.FileType.DIRECTORY) continue;

                const themeName = info.get_name();
                const themeDir = GLib.build_filenamev([baseDir, themeName]);
                const indexPath = GLib.build_filenamev([themeDir, 'index.theme']);

                if (seen.has(indexPath)) continue;
                seen.add(indexPath);

                const indexFile = Gio.File.new_for_path(indexPath);
                if (!indexFile.query_exists(null)) continue;

                try {
                    const kf = new GLib.KeyFile();
                    kf.load_from_file(indexPath, GLib.KeyFileFlags.NONE);

                    // Фильтр тем курсоров
                    let dirsStr = '';
                    try { dirsStr = kf.get_string('Icon Theme', 'Directories') || ''; } catch (e) {}
                    if (!dirsStr.trim()) continue;

                    const cursorsDir = GLib.build_filenamev([themeDir, 'cursors']);
                    if (GLib.file_test(cursorsDir, GLib.FileTest.IS_DIR)) {
                        const listed = dirsStr.split(',').map(s => s.trim()).filter(Boolean);
                        let hasRealDir = false;
                        for (const d of listed) {
                            const sub = GLib.build_filenamev([themeDir, d]);
                            if (GLib.file_test(sub, GLib.FileTest.IS_DIR)) {
                                hasRealDir = true;
                                break;
                            }
                        }
                        if (!hasRealDir) continue;
                    }

                    let displayName = themeName;
                    try { displayName = kf.get_string('Icon Theme', 'Name') || themeName; } catch (e) {}
                    let example = '';
                    try { example = kf.get_string('Icon Theme', 'Example') || ''; } catch (e) {}

                    themes.push({
                        name: displayName,
                        dirName: themeName,
                        dir: themeDir,
                        indexPath: indexPath,
                        example: example
                    });
                } catch (e) {}
            }
            enumerator.close(null);
        }

        themes.sort((a, b) => a.name.localeCompare(b.name));

        for (const t of themes) {
            const iter = this.store.append();
            this.store.set(iter, [1, 2, 3], [t.name, t.dir, t.example]);
        }

        let idx = 0;
        const loadNextPreview = () => {
            if (idx >= themes.length) return false;
            const rowIdx = idx;
            const t = themes[rowIdx];
            idx++;

            const exampleName = t.example || 'folder';
            const pix = this.findExampleIcon(t, exampleName);
            if (pix) {
                const [ok, iter] = this.store.get_iter_from_string(String(rowIdx));
                if (ok && iter) {
                    this.store.set(iter, [0], [pix]);
                }
            }
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, loadNextPreview);
            return false;
        };

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, loadNextPreview);
    }

    findExampleIcon(themeInfo, exampleName) {
        if (!exampleName) exampleName = 'folder';

        try {
            const it = Gtk.IconTheme.new();
            const parent = GLib.path_get_dirname(themeInfo.dir);
            it.append_search_path(parent);
            it.set_custom_theme(themeInfo.dirName);

            if (it.has_icon(exampleName)) {
                const pix = it.load_icon(exampleName, 48, 0);
                if (pix) return pix;
            }
            if (exampleName !== 'folder' && it.has_icon('folder')) {
                const pix = it.load_icon('folder', 48, 0);
                if (pix) return pix;
            }
        } catch (e) {}

        const defTheme = (this.app && this.app.settings) ? this.app.settings.mainThemePath : '';
        if (defTheme) {
            try {
                const it = Gtk.IconTheme.new();
                for (const p of getIconSearchPaths()) it.append_search_path(p);
                const themeDir = GLib.path_get_dirname(defTheme);
                it.set_custom_theme(GLib.path_get_basename(themeDir));

                if (it.has_icon(exampleName)) {
                    const pix = it.load_icon(exampleName, 48, 0);
                    if (pix) return pix;
                }
                if (exampleName !== 'folder' && it.has_icon('folder')) {
                    const pix = it.load_icon('folder', 48, 0);
                    if (pix) return pix;
                }
            } catch (e) {}
        }

        try {
            const sys = Gtk.IconTheme.get_default();
            if (sys && sys.has_icon('folder')) {
                const pix = sys.load_icon('folder', 48, 0);
                if (pix) return pix;
            }
        } catch (e) {}

        return null;
    }

    run() {
        const response = this.dialog.run();
        const selectedPaths = [];

        if (response === Gtk.ResponseType.OK) {
            const selection = this.view.get_selection();
            const model = this.store;
            const n = model.iter_n_children(null);

            for (let i = 0; i < n; i++) {
                const [ok, iter] = model.get_iter_from_string(String(i));
                if (!ok || !iter) continue;

                if (!selection.iter_is_selected(iter)) continue;

                const dir = model.get_value(iter, 2);
                if (dir) {
                    selectedPaths.push(GLib.build_filenamev([dir, 'index.theme']));
                }
            }
        }

        this.dialog.destroy();
        return selectedPaths;
    }
}

class ProgressDialog {
    constructor(parent, title, text) {
        this.cancelled = false;
        this.destroyed = false; // <--- Флаг уничтожения
        this.dialog = new Gtk.Dialog({
            title: title || 'Пожалуйста, подождите',
            transient_for: parent,
            modal: true,
            default_width: 440
        });
        this.dialog.set_deletable(false);
        this.dialog.add_button('Отмена', Gtk.ResponseType.CANCEL);

        const content = this.dialog.get_content_area();
        content.set_spacing(8);
        content.set_margin_start(12); content.set_margin_end(12);
        content.set_margin_top(12); content.set_margin_bottom(12);

        this.label = new Gtk.Label({ label: text || '', halign: Gtk.Align.START, xalign: 0, wrap: true });
        content.pack_start(this.label, false, false, 0);

        this.progress = new Gtk.ProgressBar();
        this.progress.set_show_text(true);
        this.progress.set_text('Подготовка...');
        this.progress.set_fraction(0);
        content.pack_start(this.progress, false, false, 0);

        this.dialog.connect('response', (d, resp) => {
            if (resp === Gtk.ResponseType.CANCEL) {
                this.cancelled = true;
            }
        });

        this.dialog.show_all();
        while (Gtk.events_pending()) {
            Gtk.main_iteration_do(false);
        }
    }

    setStatus(fraction, text) {
        // Если диалог уже закрыт или отменен — ничего не делаем
        if (this.cancelled || this.destroyed) return; 
        if (typeof fraction === 'number' && fraction >= 0 && fraction <= 1) {
            this.progress.set_fraction(fraction);
        }
        if (text != null) this.progress.set_text(text);
        while (Gtk.events_pending()) {
            Gtk.main_iteration_do(false);
        }
    }

    isCancelled() {
        return this.cancelled;
    }

    close() {
        if (this.destroyed) return;
        this.destroyed = true;
        try { this.dialog.destroy(); } catch (e) {}
    }
}

class DeadlinksDialog {
    constructor(parent, app, dirName) {
        this.app = app;
        this.dirName = dirName;
        this.themeDir = app.theme.themeDir;
        
        this.dialog = new Gtk.Dialog({
            title: `Битые симлинки: ${dirName}`,
            transient_for: parent,
            modal: true,
            default_width: 850,
            default_height: 450
        });
        
        // Кнопки с иконками
        let actionArea = this.dialog.get_action_area();
        let btnFind = new Gtk.Button({ 
            label: "Найти цели", 
            image: Gtk.Image.new_from_icon_name("system-search-symbolic", Gtk.IconSize.BUTTON), 
            always_show_image: true 
        });
        btnFind.connect('clicked', () => this.findTargets());
        actionArea.pack_start(btnFind, false, false, 0);

        let btnSave = this.dialog.add_button("Сохранить выбранное", Gtk.ResponseType.OK);
        btnSave.set_image(Gtk.Image.new_from_icon_name("document-save-symbolic", Gtk.IconSize.BUTTON));
        btnSave.set_always_show_image(true);
        btnSave.get_style_context().add_class("suggested-action");

        let btnClose = this.dialog.add_button("Закрыть", Gtk.ResponseType.CLOSE);
        btnClose.set_image(Gtk.Image.new_from_icon_name("window-close-symbolic", Gtk.IconSize.BUTTON));
        btnClose.set_always_show_image(true);

        this.buildUI();
    }

    buildUI() {
        let content = this.dialog.get_content_area();
        content.set_spacing(5);
        content.set_margin_start(10); content.set_margin_end(10);
        content.set_margin_top(10); content.set_margin_bottom(10);

        let mainBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5 });

        // Модель: 0-Чекбокс, 1-Симлинк, 2-Цель, 3-Превью, 4-Оригинальная цель, 5-Жирность
        this.store = new Gtk.ListStore();
        this.store.set_column_types([
            GObject.TYPE_BOOLEAN, GObject.TYPE_STRING, GObject.TYPE_STRING, 
            GdkPixbuf.Pixbuf, GObject.TYPE_STRING, GObject.TYPE_INT
        ]);

        let problems = this.app.theme.problems.filter(p => p.dirName === this.dirName && p.msg.includes("Битый симлинк"));
        for (let p of problems) {
            let symlinkRel = p.filePath.substring(this.themeDir.length + 1);
            let target = p.targetName;
            
            let iter = this.store.append();
            // Изначально галочки сняты
            this.store.set(iter, [0, 1, 2, 3, 4, 5], [false, symlinkRel, target, this.loadPreviewIcon(null), target, 400]);
        }

        this.view = new Gtk.TreeView({ model: this.store });
        
        // Колонка 0: Чекбокс
        let rCheck = new Gtk.CellRendererToggle();
        rCheck.connect('toggled', (widget, pathStr) => {
            let [ok, iter] = this.store.get_iter_from_string(pathStr);
            if (ok) {
                let val = this.store.get_value(iter, 0);
                this.store.set_value(iter, 0, !val);
            }
        });
        let cCheck = new Gtk.TreeViewColumn({ title: "" });
        cCheck.pack_start(rCheck, false); cCheck.add_attribute(rCheck, 'active', 0);
        this.view.append_column(cCheck);

        // Колонка 1: Симлинк
        let rSym = new Gtk.CellRendererText();
        let cSym = new Gtk.TreeViewColumn({ title: "Симлинк", expand: true });
        cSym.pack_start(rSym, true); cSym.add_attribute(rSym, 'text', 1);
        this.view.append_column(cSym);

        // Колонка 2: Цель (Combo)
        let cTarget = new Gtk.TreeViewColumn({ title: "Цель (относительно симлинка)", expand: true });
        
        this.comboModel = new Gtk.ListStore();
        this.comboModel.set_column_types([GObject.TYPE_STRING]);

        let rCombo = new Gtk.CellRendererCombo({ editable: true, has_entry: true, text_column: 0 });
        rCombo.set_property('model', this.comboModel);
        cTarget.pack_start(rCombo, true);
        cTarget.add_attribute(rCombo, 'text', 2);
        cTarget.add_attribute(rCombo, 'weight', 5);
        cTarget.set_min_width(250);
        this.view.append_column(cTarget);

        rCombo.connect('edited', (widget, pathStr, newText) => {
            let [ok, iter] = this.store.get_iter_from_string(pathStr);
            if (ok && newText) this.updateRowTarget(iter, newText);
        });

        // Колонка 3: Превью
        let rPrev = new Gtk.CellRendererPixbuf();
        let cPrev = new Gtk.TreeViewColumn({ title: "Превью" });
        cPrev.pack_start(rPrev, false); cPrev.add_attribute(rPrev, 'pixbuf', 3);
        this.view.append_column(cPrev);

        // Обработка клика
        this.view.connect('button-press-event', (widget, event) => {
            let btn = event.get_button()[1];
            let clicks = event.get_click_count()[1];
            let [x, y] = [event.x, event.y];
            let pathInfo = this.view.get_path_at_pos(Math.floor(x), Math.floor(y));
            
            if (!pathInfo) return false;
            let [success, path, col, cellX, cellY] = pathInfo;
            if (!success || !path) return false;

            if (btn === 1) {
                if (col === cTarget) {
                    // Клик по колонке "Цель" — собираем список для этой строки
                    let [ok, iter] = this.store.get_iter(path);
                    if (ok && iter) {
                        let symlinkRel = this.store.get_value(iter, 1);
                        let brokenTarget = this.store.get_value(iter, 4);
                        let candidates = this.getCandidates(symlinkRel, brokenTarget);
                        
                        this.comboModel.clear();
                        for (let c of candidates) {
                            let cIter = this.comboModel.append();
                            this.comboModel.set(cIter, [0], [c]);
                        }
                    }
                } else if (clicks === 2) {
                    // Двойной клик по другим колонкам — открываем Обзор
                    this.openBrowseDialog(path);
                    return true;
                }
            }
            return false;
        });

        let scroll = new Gtk.ScrolledWindow({ vexpand: true });
        scroll.add(this.view);
        mainBox.pack_start(scroll, true, true, 0);

        content.pack_start(mainBox, true, true, 0);
        this.dialog.show_all();
    }

    updateRowTarget(iter, newTarget) {
        let symlinkRel = this.store.get_value(iter, 1);
        let originalTarget = this.store.get_value(iter, 4);
        
        let symlinkAbs = GLib.build_filenamev([this.themeDir, symlinkRel]);
        let symlinkDir = Gio.File.new_for_path(symlinkAbs).get_parent();
        let targetFile = symlinkDir.resolve_relative_path(newTarget);
        
        let weight = (newTarget !== originalTarget) ? 700 : 400;
        let preview = this.loadPreviewIcon(targetFile.query_exists(null) ? targetFile.get_path() : null);
        
        // Обновляем цель, превью, вес и ставим галочку (0 = true)
        this.store.set(iter, [0, 2, 3, 5], [true, newTarget, preview, weight]);
    }

    openBrowseDialog(path) {
        let [ok, iter] = this.store.get_iter(path);
        if (!ok || !iter) return;
        
        let symlinkRel = this.store.get_value(iter, 1);
        let symlinkAbs = GLib.build_filenamev([this.themeDir, symlinkRel]);
        
        let chooser = new Gtk.FileChooserDialog({
            title: "Выберите файл-цель",
            action: Gtk.FileChooserAction.OPEN,
            transient_for: this.dialog,
            modal: true
        });
        chooser.add_button("Отмена", Gtk.ResponseType.CANCEL);
        chooser.add_button("Выбрать", Gtk.ResponseType.OK);
        chooser.set_current_folder(GLib.path_get_dirname(symlinkAbs));
        
        if (chooser.run() === Gtk.ResponseType.OK) {
            let chosenAbs = chooser.get_filename();
            let symlinkDir = Gio.File.new_for_path(symlinkAbs).get_parent();
            let relFile = symlinkDir.get_relative_path(Gio.File.new_for_path(chosenAbs));
            
            let relPath = relFile ? relFile.get_path() : chosenAbs;
            this.updateRowTarget(iter, relPath);
        }
        chooser.destroy();
    }

    loadPreviewIcon(absPath) {
        if (absPath) {
            let pb = pixbufFromFileCached(absPath, 32);
            if (pb) return pb;
        }
        try {
            return Gtk.IconTheme.get_default().load_icon("image-missing", 32, 0);
        } catch (e) {
            return getTransparentPixbuf();
        }
    }

    relativePath(fromDir, toPath) {
        let from = fromDir.split('/').filter(Boolean);
        let to = toPath.split('/').filter(Boolean);
        let common = 0;
        while (common < from.length && common < to.length - 1
               && from[common] === to[common]) common++;
        let up = new Array(from.length - common).fill('..');
        return up.concat(to.slice(common)).join('/');
    }

    getCandidates(symlinkRel, brokenTarget) {
        let candidates = new Set();
        let symlinkDir = GLib.path_get_dirname(symlinkRel);
        let symlinkBase = GLib.path_get_basename(symlinkRel).replace(/\.[^.]+$/, '');
        let targetBase = GLib.path_get_basename(brokenTarget).replace(/\.[^.]+$/, '');

        let symlinkInfo = this.app.theme.dirInfo.get(symlinkDir) || {};
        let symlinkSize = symlinkInfo.size;

        let addCandidate = (dirName, fileName) => {
            let rel = this.relativePath(symlinkDir, dirName + '/' + fileName);
            if (rel) candidates.add(rel);
        };

        // 1. Физические файлы с именем цели
        let targetOccs = this.app.theme.icons.get(targetBase) || [];
        for (let o of targetOccs) {
            if (!o.isSymlink) {
                if (!symlinkSize || o.size === symlinkSize) {
                    addCandidate(o.dirName, o.fileName);
                }
            }
        }

        // 2. Симлинки с именем цели, ведущие на физический файл
        for (let o of targetOccs) {
            if (o.isSymlink && o.target) {
                let absPath = GLib.canonicalize_filename(o.target, GLib.build_filenamev([this.app.theme.themeDir, o.dirName]));
                if (Gio.File.new_for_path(absPath).query_exists(null)) {
                    let relToRoot = absPath.substring(this.app.theme.themeDir.length + 1);
                    let rel = this.relativePath(symlinkDir, relToRoot);
                    if (rel) candidates.add(rel);
                }
            }
        }

        // 3. Симлинки с именем самого дэдлинка, ведущие на физический файл
        let sameNameOccs = this.app.theme.icons.get(symlinkBase) || [];
        for (let o of sameNameOccs) {
            if (o.isSymlink && o.target && o.dirName !== symlinkDir) {
                let absPath = GLib.canonicalize_filename(o.target, GLib.build_filenamev([this.app.theme.themeDir, o.dirName]));
                if (Gio.File.new_for_path(absPath).query_exists(null)) {
                    let relToRoot = absPath.substring(this.app.theme.themeDir.length + 1);
                    let rel = this.relativePath(symlinkDir, relToRoot);
                    if (rel) candidates.add(rel);
                }
            }
        }

        return Array.from(candidates);
    }

    findTargets() {
        let replacedCount = 0;
        let checkedCount = 0;
        let count = this.store.iter_n_children(null);

        for (let i = 0; i < count; i++) {
            let [ok, iter] = this.store.get_iter_from_string(i.toString());
            if (!ok) continue;

            let symlinkRel = this.store.get_value(iter, 1);
            let brokenTarget = this.store.get_value(iter, 4);
            
            let candidates = this.getCandidates(symlinkRel, brokenTarget);
            
            if (candidates.length > 0) {
                // Если кандидаты есть, ставим галочку
                this.store.set_value(iter, 0, true);
                checkedCount++;
                
                // Если вариант ровно один — подставляем его
                if (candidates.length === 1) {
                    this.updateRowTarget(iter, candidates[0]);
                    replacedCount++;
                }
            }
        }

        if (checkedCount > 0) {
            let text = `Отмечено дэдлинков с найденными целями: ${checkedCount}`;
            if (replacedCount > 0) text += `\nАвтоматически исправлено (был 1 вариант): ${replacedCount}`;
            text += "\nКликните по ячейке «Цель», чтобы выбрать из нескольких вариантов.";
            
            let msg = new Gtk.MessageDialog({
                transient_for: this.dialog, modal: true, message_type: Gtk.MessageType.INFO,
                buttons: Gtk.ButtonsType.OK, text: text
            });
            msg.run(); msg.destroy();
        } else {
            let msg = new Gtk.MessageDialog({
                transient_for: this.dialog, modal: true, message_type: Gtk.MessageType.INFO,
                buttons: Gtk.ButtonsType.OK, text: "Подходящих целей не найдено."
            });
            msg.run(); msg.destroy();
        }
    }

    run() {
        let resp = this.dialog.run();
        if (resp === Gtk.ResponseType.OK) {
            let count = this.store.iter_n_children(null);
            let changed = 0;
            
            for (let i = 0; i < count; i++) {
                let [ok, iter] = this.store.get_iter_from_string(i.toString());
                if (ok) {
                    let checked = this.store.get_value(iter, 0);
                    // Сохраняем только отмеченные строки
                    if (checked) {
                        let symlinkRel = this.store.get_value(iter, 1);
                        let newTarget = this.store.get_value(iter, 2);
                        let symlinkAbs = GLib.build_filenamev([this.themeDir, symlinkRel]);
                        
                        try {
                            let f = Gio.File.new_for_path(symlinkAbs);
                            f.delete(null);
                            f.make_symbolic_link(newTarget, null);
                            changed++;
                        } catch (e) {
                            print("Ошибка записи симлинка " + symlinkRel + ": " + e.message);
                        }
                    }
                }
            }
            this.dialog.destroy();
            if (changed > 0) {
                this.app.loadThemeData(this.app.theme.themePath, true);
            }
        } else {
            this.dialog.destroy();
        }
    }
}

class MainWindow {
    constructor(themePath) {
        this.settings = new SettingsModule.Settings();
        this.loadedThemes = []; 
        this.isUpdatingVisual = false;
        this.visualPreviewSize = 48;
        this.currentSelectedIcon = null;
        
        // Если аргумент передан - используем его. Иначе грузим главную из настроек (но не открываем редактор)
        let initialPath = themePath || this.settings.mainThemePath;
        
        this.theme = new ThemeModule.Theme(initialPath || ""); 
        
        this.window = new Gtk.Window({
            title: "Icon Theme Toolkit",
            default_width: 1200,
            default_height: 800,
            window_position: Gtk.WindowPosition.CENTER
        });
        this.window.connect('destroy', () => Gtk.main_quit());

        this.buildUI();
        this.window.show_all();

        if (initialPath) {
            // Если тема передана в аргументах (или в настройках), загружаем её
            this.loadThemeData(initialPath).catch(e => {
                print("Ошибка загрузки: " + e.message);
            });
        }

        // Переключаем вкладку ТОЛЬКО если тема пришла из аргументов
        if (themePath) {
            this.notebook.set_current_page(1);
        } else {
            this.notebook.set_current_page(0);
        }
    }

    buildUI() {
        this.notebook = new Gtk.Notebook();
        this.notebook.set_scrollable(true);

        // Вкладка 1: Сравнение
        let compareTab = this.buildCompareTab();
        this.notebook.append_page(compareTab, new Gtk.Label({ label: 'Сравнение' }));
        
        // Вкладка 2: Редактор темы
        let editorTab = this.buildThemeEditorTab();
        this.notebook.append_page(editorTab, new Gtk.Label({ label: 'Редактор темы' }));

        // Вкладка 3: Инструменты
        let toolsTab = this.buildToolsTab();
        this.notebook.append_page(toolsTab, new Gtk.Label({ label: 'Инструменты' }));

        this.window.add(this.notebook);
    }

    async showSymlinkMatrixDialog(targetName, selectedNames) {
        let targetOccs = this.theme.icons.get(targetName) || [];
        let allSizes = new Set();
        for (let o of targetOccs) if (o.size) allSizes.add(o.size);
        
        let nameContexts = {};
        for (let sName of selectedNames) {
            let occs = this.theme.icons.get(sName) || [];
            let ctx = occs.length > 0 ? occs[0].context : '';
            nameContexts[sName] = ctx;
        }

        let sortedSizes = Array.from(allSizes).sort((a,b) => a-b);

        // ТЕПЕРЬ 5 КОЛОНОК НА КАЖДОЕ ИМЯ: Чекбокс, Превью, Текст, Активность, Скрытый путь
        let colTypes = [GObject.TYPE_STRING, GObject.TYPE_INT];
        for (let i = 0; i < selectedNames.length; i++) {
            colTypes.push(GObject.TYPE_BOOLEAN);
            colTypes.push(GdkPixbuf.Pixbuf);
            colTypes.push(GObject.TYPE_STRING);
            colTypes.push(GObject.TYPE_BOOLEAN);
            colTypes.push(GObject.TYPE_STRING); // <-- Скрытый реальный путь
        }

        let store = new Gtk.ListStore();
        store.set_column_types(colTypes);
        let view = new Gtk.TreeView({ model: store, headers_clickable: false });

        let rSize = new Gtk.CellRendererText();
        let cSize = new Gtk.TreeViewColumn({ title: "Размер" });
        cSize.pack_start(rSize, false); cSize.add_attribute(rSize, 'text', 0);
        cSize.set_resizable(true); cSize.set_min_width(60);
        view.append_column(cSize);

        for (let i = 0; i < selectedNames.length; i++) {
            let sName = selectedNames[i];
            let chkIdx = 2 + i * 5;
            let pixIdx = 3 + i * 5;
            let txtIdx = 4 + i * 5;
            let actIdx = 5 + i * 5;
            let pathIdx = 6 + i * 5;

            let c = new Gtk.TreeViewColumn({ title: sName, expand: true });
            c.set_resizable(true); c.set_min_width(120);
            
            let rChk = new Gtk.CellRendererToggle();
            rChk.connect('toggled', (w, path) => {
                let [ok, iter] = store.get_iter_from_string(path);
                if (ok) store.set_value(iter, chkIdx, !store.get_value(iter, chkIdx));
            });
            c.pack_start(rChk, false);
            c.add_attribute(rChk, 'active', chkIdx);
            c.add_attribute(rChk, 'activatable', actIdx);

            let rPix = new Gtk.CellRendererPixbuf();
            rPix.set_property('xpad', 4);
            c.pack_start(rPix, false);
            c.add_attribute(rPix, 'pixbuf', pixIdx);

            let rTxt = new Gtk.CellRendererText({ editable: true });
            rTxt.set_property('ellipsize', 3);
            c.pack_start(rTxt, true);
            c.add_attribute(rTxt, 'text', txtIdx);
            
            rTxt.connect('edited', (w, path, newText) => {
                let [ok, iter] = store.get_iter_from_string(path);
                if (ok) {
                    store.set_value(iter, txtIdx, newText);
                    store.set_value(iter, pathIdx, newText); // Сохраняем отредактированный текст как путь
                }
            });
            
            view.append_column(c);
        }

        for (let sz of sortedSizes) {
            let targetOcc = targetOccs.find(o => Number(o.size) === sz && !o.isSymlink);
            if (!targetOcc) continue; 

            let rowData = [sz.toString(), sz];
            let targetPreview = pixbufFromFileCached(targetOcc.fullPath, 24) || getTransparentPixbuf();
            
            for (let i = 0; i < selectedNames.length; i++) {
                let sName = selectedNames[i];
                let sCtx = nameContexts[sName];
                
                let hasDir = false;
                for (let [dirName, info] of this.theme.dirInfo) {
                    if (info.context === sCtx && Number(info.size) === sz) { hasDir = true; break; }
                }

                if (!hasDir) {
                    rowData.push(false, targetPreview, "", false, "");
                    continue;
                }

                let sOccs = this.theme.icons.get(sName) || [];
                let existingLink = sOccs.find(o => Number(o.size) === sz && o.isSymlink);
                let existingReal = sOccs.find(o => Number(o.size) === sz && !o.isSymlink);

                if (existingReal) {
                    let realPreview = pixbufFromFileCached(existingReal.fullPath, 24) || getTransparentPixbuf();
                    rowData.push(false, realPreview, "Файл (занято)", false, existingReal.fullPath);
                } else if (existingLink) {
                    let isChain = false;
                    try {
                        let absPath = GLib.canonicalize_filename(existingLink.target, GLib.build_filenamev([this.theme.themeDir, existingLink.dirName]));
                        let info = Gio.File.new_for_path(absPath).query_info('standard::is-symlink', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
                        if (info.get_is_symlink()) isChain = true;
                    } catch(e) {}
                    
                    let displayTarget = existingLink.target + (isChain ? " (цепочка)" : "");
                    // Сохраняем чистый путь без пометки (цепочка)
                    rowData.push(true, targetPreview, displayTarget, true, existingLink.target);
                } else {
                    let relPath = this.getRelativeTargetPath(sCtx, sz, targetName);
                    rowData.push(false, targetPreview, relPath, true, relPath);
                }
            }
            let iter = store.append();
            let idx = []; for (let k = 0; k < rowData.length; k++) idx.push(k);
            store.set(iter, idx, rowData);
        }

        let dialog = new Gtk.Dialog({ title: "Матрица симлинков", transient_for: this.window, modal: true, default_width: 850, default_height: 500 });
        
        let actionArea = dialog.get_action_area();
        let btnApply = new Gtk.Button({ label: "Применить", image: Gtk.Image.new_from_icon_name("document-save-as-symbolic", Gtk.IconSize.BUTTON), always_show_image: true });
        actionArea.pack_start(btnApply, false, false, 0);

        let btnCancel = dialog.add_button("Отмена", Gtk.ResponseType.CANCEL);
        btnCancel.set_image(Gtk.Image.new_from_icon_name("process-stop-symbolic", Gtk.IconSize.BUTTON));
        btnCancel.set_always_show_image(true);

        let btnSave = dialog.add_button("Сохранить", Gtk.ResponseType.OK);
        btnSave.set_image(Gtk.Image.new_from_icon_name("document-save-symbolic", Gtk.IconSize.BUTTON));
        btnSave.set_always_show_image(true);
        btnSave.get_style_context().add_class("suggested-action");

        let content = dialog.get_content_area();
        content.set_spacing(5);
        content.set_margin_start(10); content.set_margin_end(10); content.set_margin_top(10); content.set_margin_bottom(10);
        
        content.pack_start(new Gtk.Label({ label: `<b>Управление симлинками на "${targetName}"</b>`, use_markup: true, halign: Gtk.Align.START }), false, false, 0);

        let topControls = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
        let chkOverride = new Gtk.CheckButton({ label: "Перезаписывать файлы" });
        topControls.pack_start(chkOverride, false, false, 0);

        let btnSelectAll = new Gtk.Button({ label: "Выбрать все", image: Gtk.Image.new_from_icon_name("checkbox-checked-symbolic", Gtk.IconSize.BUTTON), always_show_image: true });
        topControls.pack_start(btnSelectAll, false, false, 0);
        content.pack_start(topControls, false, false, 0);

        btnSelectAll.connect('clicked', () => {
            let count = store.iter_n_children(null);
            for (let i = 0; i < count; i++) {
                let [ok, iter] = store.get_iter_from_string(i.toString());
                if (!ok) continue;
                for (let j = 0; j < selectedNames.length; j++) {
                    let actIdx = 5 + j * 5;
                    let chkIdx = 2 + j * 5;
                    if (store.get_value(iter, actIdx)) store.set_value(iter, chkIdx, true);
                }
            }
        });

        let scroll = new Gtk.ScrolledWindow({ vexpand: true });
        scroll.add(view);
        content.pack_start(scroll, true, true, 0);
        
        chkOverride.connect('toggled', () => {
            let isActive = chkOverride.get_active();
            let count = store.iter_n_children(null);
            for (let i = 0; i < count; i++) {
                let [ok, iter] = store.get_iter_from_string(i.toString());
                if (!ok) continue;
                for (let j = 0; j < selectedNames.length; j++) {
                    let actIdx = 5 + j * 5;
                    let chkIdx = 2 + j * 5;
                    let txtIdx = 4 + j * 5;
                    let txt = store.get_value(iter, txtIdx);
                    
                    if (txt === "Файл (занято)" || txt === "Будет перезаписан") {
                        if (isActive) {
                            store.set_value(iter, actIdx, true);
                            store.set_value(iter, txtIdx, "Будет перезаписан");
                        } else {
                            store.set_value(iter, actIdx, false);
                            store.set_value(iter, chkIdx, false);
                            store.set_value(iter, txtIdx, "Файл (занято)");
                        }
                    }
                }
            }
        });

        btnApply.connect('clicked', async () => {
            let changes = await this.applyMatrixChanges(store, selectedNames, nameContexts, targetName);
            if (changes) {
                this.updateThemeMemory(changes.toCreate, changes.toDelete);
                dialog.destroy();
                this.populateToolsMasterStore(() => {
                    this.selectToolsName(targetName);
                    this.rebuildComparisonAsync(null);
                    this.showSymlinkMatrixDialog(targetName, selectedNames);
                });
            }
        });

        dialog.connect('response', async (dlg, response) => {
            if (response === Gtk.ResponseType.OK) {
                dialog.hide();
                let changes = await this.applyMatrixChanges(store, selectedNames, nameContexts, targetName);
                if (changes) {
                    this.updateThemeMemory(changes.toCreate, changes.toDelete);
                    dialog.destroy();
                    this.populateToolsMasterStore(() => {
                        this.selectToolsName(targetName);
                        this.rebuildComparisonAsync(null);
                    });
                } else {
                    dialog.show();
                }
            } else if (response === Gtk.ResponseType.CANCEL) {
                dialog.destroy();
            }
        });

        dialog.show_all();
    }

    showCreateSymlinksDialog() {
        if (!this.toolsCurrentSelected) return;
        let sourceName = this.toolsCurrentSelected;
        
        let dialog = new Gtk.Dialog({ 
            title: `Симлинки/Оригиналы: ${sourceName}`, 
            transient_for: this.window, modal: true, 
            default_width: 900, default_height: 500 
        });
        
        let btnCancel = dialog.add_button("Отмена", Gtk.ResponseType.CANCEL);
        btnCancel.set_image(Gtk.Image.new_from_icon_name("process-stop-symbolic", Gtk.IconSize.BUTTON));
        btnCancel.set_always_show_image(true);

        let btnApply = dialog.add_button("Применить", Gtk.ResponseType.OK);
        btnApply.set_image(Gtk.Image.new_from_icon_name("document-save-symbolic", Gtk.IconSize.BUTTON));
        btnApply.set_always_show_image(true);
        btnApply.get_style_context().add_class("suggested-action");

        let content = dialog.get_content_area();
        content.set_spacing(5);
        content.set_margin_start(10); content.set_margin_end(10); content.set_margin_top(10); content.set_margin_bottom(10);

        // --- Верхняя панель ---
        let topBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
        topBox.pack_start(new Gtk.Label({ label: `<b>${sourceName}</b>`, use_markup: true }), false, false, 0);
        topBox.pack_start(new Gtk.Label({ label: "➔", use_markup: true }), false, false, 0);
        
        // Поле для шаблона пути (межконтекстные симлинки)
        let pathEntry = new Gtk.Entry({ text: "../%Context%/%Size%/%Name%.png", tooltip_text: "Переменные: %Context%, %Size%, %Scale%, %Type%, %Name%" });
        pathEntry.set_width_chars(25);
        topBox.pack_start(pathEntry, false, false, 0);

        // Классический ComboBox со скроллом
        let targetStore = new Gtk.ListStore();
        targetStore.set_column_types([GObject.TYPE_STRING]);
        let targetCombo = new Gtk.ComboBox({ model: targetStore });
        let renderer = new Gtk.CellRendererText();
        targetCombo.pack_start(renderer, true);
        targetCombo.add_attribute(renderer, 'text', 0);
        targetCombo.set_hexpand(true);
        topBox.pack_start(targetCombo, true, true, 0);
        
        let chkShowSymlinks = new Gtk.CheckButton({ label: "Показывать симлинки" });
        topBox.pack_start(chkShowSymlinks, false, false, 0);
        
        content.pack_start(topBox, false, false, 0);

        // --- Таблица ---
        let store = new Gtk.ListStore();
        // 0-Чекбокс, 1-ПревьюИсх, 2-КаталогИсх, 3-КонтекстИсх, 4-ПревьюЦели, 5-КаталогЦели, 6-КонтекстЦели, 7-Статус, 8-ИсхПуть, 9-ЦельПуть
        store.set_column_types([
            GObject.TYPE_BOOLEAN, GdkPixbuf.Pixbuf, GObject.TYPE_STRING, GObject.TYPE_STRING,
            GdkPixbuf.Pixbuf, GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_STRING,
            GObject.TYPE_STRING, GObject.TYPE_STRING
        ]);

        let view = new Gtk.TreeView({ model: store, headers_clickable: true });
        
        let cols = [
            ["", 0, false], ["Исходный файл", 1, false], ["Каталог", 2, true], ["Контекст", 3, false],
            ["Цель", 4, false], ["Каталог цели", 5, true], ["Контекст цели", 6, false], ["Действие", 7, true]
        ];
        
        let rChk = null;
        for (let [title, idx, expand] of cols) {
            let r;
            if (idx === 0) {
                r = new Gtk.CellRendererToggle();
                rChk = r; // Запоминаем рендерер для обработки кликов
            } else if (idx === 1 || idx === 4) {
                r = new Gtk.CellRendererPixbuf();
            } else {
                r = new Gtk.CellRendererText();
                r.set_property('ellipsize', 3); // Только для текста
            }
            
            let c = new Gtk.TreeViewColumn({ title: title, expand: expand });
            c.pack_start(r, true);
            c.add_attribute(r, (idx === 1 || idx === 4) ? 'pixbuf' : (idx === 0 ? 'active' : 'text'), idx);
            c.set_resizable(true);
            view.append_column(c);
            c.set_clickable(true);
        }
        
        rChk.connect('toggled', (w, path) => {
            let [ok, iter] = store.get_iter_from_string(path);
            if (ok) store.set_value(iter, 0, !store.get_value(iter, 0));
        });

        let scroll = new Gtk.ScrolledWindow({ vexpand: true });
        scroll.add(view);
        content.pack_start(scroll, true, true, 0);

        // --- Логика обновления таблицы ---
        let currentTargetName = "";

        targetCombo.connect('changed', () => {
            let [ok, iter] = targetCombo.get_active_iter();
            if (ok && iter) {
                currentTargetName = targetStore.get_value(iter, 0);
                updateTable();
            }
        });

        let updateTable = () => {
            store.clear();
            let showSymlinks = chkShowSymlinks.get_active();
            let sourceOccs = this.theme.icons.get(sourceName) || [];
            let targetOccs = currentTargetName ? (this.theme.icons.get(currentTargetName) || []) : [];
            
            let idx = 0;
            let loadChunk = () => {
                if (idx >= sourceOccs.length) return false;
                let end = Math.min(idx + 50, sourceOccs.length);
                
                for (let i = idx; i < end; i++) {
                    let sOcc = sourceOccs[i];
                    let sPb = pixbufFromFileCached(sOcc.fullPath, 24) || getTransparentPixbuf();
                    let actionText = sOcc.isSymlink ? "Оригинал (из копии)" : "Оригинал";
                    
                    let tPb = getTransparentPixbuf();
                    let tDir = "", tCtx = "", tPath = "", tInfo = "";
                    
                    if (currentTargetName) {
                        let match = targetOccs.find(o => o.size === sOcc.size && o.context === sOcc.context);
                        if (match && (!match.isSymlink || showSymlinks)) {
                            tPb = pixbufFromFileCached(match.fullPath, 24) || getTransparentPixbuf();
                            tDir = match.dirName;
                            tCtx = match.context || '';
                            tPath = match.fullPath;
                            
                            // Подтягиваем параметры каталога цели для подсказки
                            let dInfo = this.theme.dirInfo.get(match.dirName) || {};
                            tInfo = `Size: ${dInfo.size || '?'}\nScale: ${dInfo.scale || '1'}\nType: ${dInfo.type || 'Fixed'}`;

                            actionText = match.isSymlink ? "Симлинк (и материализовать цель)" : "Симлинк";
                        }
                    }
                    
                    let iter = store.append();
                    store.set(iter, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [
                        false, sPb, sOcc.dirName, sOcc.context || '', 
                        tPb, tDir, tCtx, actionText, sOcc.fullPath, tPath
                    ]);
                    
                    // Добавляем подсказку для строки (через tooltip)
                    if (tInfo) store.set(iter, [6], [tInfo]); // Используем 6-ю колонку для текста подсказки
                }
                idx = end;
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, loadChunk);
                return false;
            };
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, loadChunk);
        };

        // Заполняем комбобокс (без рекурсии)
        let populateCombo = () => {
            targetStore.clear();
            let showSymlinks = chkShowSymlinks.get_active();
            let firstIter = null;
            
            let names = [];
            for (let [name, occs] of this.theme.icons) {
                if (name === sourceName) continue;
                let hasOriginal = occs.some(o => !o.isSymlink);
                if (hasOriginal || showSymlinks) {
                    names.push(name);
                }
            }
            names.sort();
            
            for (let n of names) {
                let it = targetStore.append();
                targetStore.set(it, [0], [n]);
                if (!firstIter) firstIter = it;
            }
            
            if (firstIter) {
                targetCombo.set_active_iter(firstIter);
            }
        };

        populateCombo();
        chkShowSymlinks.connect('toggled', () => {
            populateCombo();
        });
        
        dialog.show_all();

        if (dialog.run() === Gtk.ResponseType.OK) {
            let count = store.iter_n_children(null);
            let toConvert = []; // Симлинки, которые станут оригиналами
            let toLink = [];    // Новые симлинки

            for (let i = 0; i < count; i++) {
                let [ok, iter] = store.get_iter_from_string(i.toString());
                if (!ok || !store.get_value(iter, 0)) continue;
                
                let status = store.get_value(iter, 7);
                let srcPath = store.get_value(iter, 8);
                let tgtPath = store.get_value(iter, 9);
                
                if (status === "Оригинал (из копии)") {
                    toConvert.push({ path: srcPath });
                } else if (status === "Симлинк" || status === "Симлинк (и материализовать цель)") {
                    // Если есть точная цель в другом контексте - используем ее путь.
                    // Если пути нет, используем шаблон, подставляя Size из исходного файла.
                    let finalTarget = tgtPath;
                    if (!finalTarget) {
                        let srcInfo = this.theme.dirInfo.get(GLib.path_get_dirname(srcPath).substring(this.theme.themeDir.length + 1)) || {};
                        let template = pathEntry.get_text();
                        finalTarget = template
                            .replace(/%Size%/g, srcInfo.size || '')
                            .replace(/%Scale%/g, srcInfo.scale || '1')
                            .replace(/%Type%/g, srcInfo.type || 'Fixed')
                            .replace(/%Context%/g, srcInfo.context || '')
                            .replace(/%Name%/g, currentTargetName);
                    }
                    toLink.push({ source: srcPath, target: finalTarget });
                    
                    if (status === "Симлинк (и материализовать цель)" && tgtPath) {
                        toConvert.push({ path: tgtPath });
                    }
                }
            }

            dialog.destroy();
            
            if (toConvert.length > 0 || toLink.length > 0) {
                let confirmText = "";
                if (toConvert.length > 0) confirmText += `Будет материализовано оригиналов: ${toConvert.length}\n`;
                if (toLink.length > 0) confirmText += `Будет создано симлинков: ${toLink.length}\n`;
                confirmText += "\nПродолжить?";
                
                let confirmDlg = new Gtk.MessageDialog({ transient_for: this.window, modal: true, message_type: Gtk.MessageType.QUESTION, buttons: Gtk.ButtonsType.YES_NO, text: confirmText });
                
                if (confirmDlg.run() === Gtk.ResponseType.YES) {
                    let errors = 0;
                    
                    // 1. Материализация (превращение симлинка в копию файла)
                    for (let item of toConvert) {
                        try {
                            let symlinkFile = Gio.File.new_for_path(item.path);
                            let targetInfo = symlinkFile.query_info('standard::symlink-target', Gio.FileQueryInfoFlags.NONE, null);
                            let target = targetInfo.get_symlink_target();
                            let resolved = Gio.File.new_for_path(item.path).get_parent().resolve_relative_path(target);
                            
                            if (resolved.query_exists(null)) {
                                resolved.copy(symlinkFile, Gio.FileCopyFlags.OVERWRITE, null, null);
                            }
                        } catch (e) { errors++; print("Ошибка конвертации: " + item.path); }
                    }
                    
                    // 2. Создание симлинков
                    for (let item of toLink) {
                        try {
                            let src = Gio.File.new_for_path(item.source);
                            let tgt = Gio.File.new_for_path(item.target);
                            if (src.query_exists(null)) src.delete(null);
                            
                            let relPath = src.get_parent().get_relative_path(tgt).get_path();
                            src.make_symbolic_link(relPath, null);
                        } catch (e) { errors++; print("Ошибка создания симлинка: " + item.source); }
                    }
                    
                    if (errors > 0) {
                        let errDlg = new Gtk.MessageDialog({ transient_for: this.window, modal: true, message_type: Gtk.MessageType.ERROR, buttons: Gtk.ButtonsType.OK, text: `Завершено с ошибками: ${errors}` });
                        errDlg.run(); errDlg.destroy();
                    }
                    
                    this.loadThemeData(this.theme.themePath, true);
                }
                confirmDlg.destroy();
            }
        } else {
            dialog.destroy();
        }
    }

    runIcoCompiler() {
        if (!this.toolsCurrentSelected) {
            let msg = new Gtk.MessageDialog({ transient_for: this.window, modal: true, message_type: Gtk.MessageType.WARNING, buttons: Gtk.ButtonsType.OK, text: "Сначала выберите имя значка в левой таблице." });
            msg.run(); msg.destroy(); return;
        }

        let name = this.toolsCurrentSelected;
        let occs = this.theme.icons.get(name) || [];
        
        let pngPaths = [];
        for (let o of occs) {
            if (!o.isSymlink) pngPaths.push(o.fullPath);
        }

        if (pngPaths.length === 0) {
            let msg = new Gtk.MessageDialog({ transient_for: this.window, modal: true, message_type: Gtk.MessageType.WARNING, buttons: Gtk.ButtonsType.OK, text: "У этого значка нет физических файлов (только симлинки)." });
            msg.run(); msg.destroy(); return;
        }

        let script = GLib.build_filenamev([here, 'icon-compiler.js']);
        if (!Gio.File.new_for_path(script).query_exists(null)) {
            let msg = new Gtk.MessageDialog({ transient_for: this.window, modal: true, message_type: Gtk.MessageType.ERROR, buttons: Gtk.ButtonsType.OK, text: "Скрипт icon-compiler.js не найден в папке программы." });
            msg.run(); msg.destroy(); return;
        }

        let cmd = ['gjs', script, '--name=' + name + '.ico', '--themefile=' + this.theme.indexPath];
        
        // Передаем контекст, если он один
        let contexts = new Set(occs.map(o => o.context).filter(Boolean));
        if (contexts.size === 1) cmd.push('--context=' + Array.from(contexts)[0]);

        for (let p of pngPaths) cmd.push(p);

        try {
            GLib.spawn_async(null, cmd, null, GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD, null);
        } catch (e) {
            let msg = new Gtk.MessageDialog({ transient_for: this.window, modal: true, message_type: Gtk.MessageType.ERROR, buttons: Gtk.ButtonsType.OK, text: "Ошибка запуска: " + e.message });
            msg.run(); msg.destroy();
        }
    }

    runIcoInstaller() {
        let script = GLib.build_filenamev([here, 'winico2linuxtheme.js']);
        if (!Gio.File.new_for_path(script).query_exists(null)) {
            let msg = new Gtk.MessageDialog({ transient_for: this.window, modal: true, message_type: Gtk.MessageType.ERROR, buttons: Gtk.ButtonsType.OK, text: "Скрипт winico2linuxtheme.js не найден в папке программы." });
            msg.run(); msg.destroy(); return;
        }

        let cmd = ['gjs', script, '-t', this.theme.indexPath];
        try {
            GLib.spawn_async(null, cmd, null, GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD, null);
        } catch (e) {
            let msg = new Gtk.MessageDialog({ transient_for: this.window, modal: true, message_type: Gtk.MessageType.ERROR, buttons: Gtk.ButtonsType.OK, text: "Ошибка запуска: " + e.message });
            msg.run(); msg.destroy();
        }
    }

    async applyMatrixChanges(store, selectedNames, nameContexts, targetName) {
        let toCreate = [];
        let toDelete = [];
        let count = store.iter_n_children(null);

        for (let i = 0; i < count; i++) {
            let [ok, iter] = store.get_iter_from_string(i.toString());
            if (!ok) continue;
            let sz = store.get_value(iter, 1);

            for (let j = 0; j < selectedNames.length; j++) {
                let sName = selectedNames[j];
                let chkIdx = 2 + j * 5;
                let actIdx = 5 + j * 5;
                let pathIdx = 6 + j * 5; // <--- Берем путь из скрытой колонки

                if (!store.get_value(iter, actIdx)) continue;

                let isChecked = store.get_value(iter, chkIdx);
                let targetValue = store.get_value(iter, pathIdx); // <--- Чистый путь, без "Будет перезаписан"
                
                let sCtx = nameContexts[sName];
                let sOccs = this.theme.icons.get(sName) || [];
                let existingLink = sOccs.find(o => Number(o.size) === sz && o.isSymlink);
                let existingReal = sOccs.find(o => Number(o.size) === sz && !o.isSymlink);

                if (isChecked && existingReal) {
                    toDelete.push({ path: existingReal.fullPath });
                    let dirName = this.getDirNameByContextAndSize(sCtx, sz);
                    if (dirName) {
                        let absPath = GLib.build_filenamev([this.theme.themeDir, dirName, sName + '.png']);
                        toCreate.push({ path: absPath, target: targetValue });
                    }
                } else if (isChecked && existingLink) {
                    if (existingLink.target !== targetValue) {
                        toDelete.push({ path: existingLink.fullPath });
                        toCreate.push({ path: existingLink.fullPath, target: targetValue });
                    }
                } else if (isChecked && !existingLink && !existingReal) {
                    let dirName = this.getDirNameByContextAndSize(sCtx, sz);
                    if (dirName) {
                        let absPath = GLib.build_filenamev([this.theme.themeDir, dirName, sName + '.png']);
                        toCreate.push({ path: absPath, target: targetValue });
                    }
                } else if (!isChecked && existingLink) {
                    toDelete.push({ path: existingLink.fullPath });
                }
            }
        }

        if (toCreate.length === 0 && toDelete.length === 0) return null;

        let confirmDlg = new Gtk.MessageDialog({ transient_for: this.window, modal: true, message_type: Gtk.MessageType.QUESTION, buttons: Gtk.ButtonsType.YES_NO, text: `Будет создано симлинков: ${toCreate.length}\nБудет удалено файлов/симлинков: ${toDelete.length}\n\nПродолжить?` });
        if (confirmDlg.run() !== Gtk.ResponseType.YES) {
            confirmDlg.destroy();
            return null;
        }
        confirmDlg.destroy();

        let total = toDelete.length + toCreate.length;
        let current = 0;
        let errors = 0;
        const progress = new ProgressDialog(this.window, "Сохранение изменений", "Обновление файлов...");

        for (let item of toDelete) {
            if (progress.isCancelled()) break;
            progress.setStatus(current / total, "Удаление: " + GLib.path_get_basename(item.path));
            try { Gio.File.new_for_path(item.path).delete(null); } catch (e) { errors++; }
            current++;
            await new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { r(); return false; }));
        }

        for (let item of toCreate) {
            if (progress.isCancelled()) break;
            progress.setStatus(current / total, "Создание: " + GLib.path_get_basename(item.path));
            try {
                let f = Gio.File.new_for_path(item.path);
                if (f.query_exists(null)) f.delete(null);
                f.make_symbolic_link(item.target, null);
            } catch (e) { errors++; }
            current++;
            await new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { r(); return false; }));
        }

        progress.close();

        if (errors > 0) {
            let errDlg = new Gtk.MessageDialog({ transient_for: this.window, modal: true, message_type: Gtk.MessageType.ERROR, buttons: Gtk.ButtonsType.OK, text: `Завершено с ошибками: ${errors}` });
            errDlg.run(); errDlg.destroy();
        }
        return { toCreate, toDelete };
    }

    showDeleteFilesDialog() {
        if (!this.toolsCurrentSelected) return;
        let name = this.toolsCurrentSelected;
        let occs = this.theme.icons.get(name) || [];
        
        let dialog = new Gtk.Dialog({ 
            title: "Удалить файлы", transient_for: this.window, modal: true, 
            default_width: 800, default_height: 450 
        });
        
        let btnCancel = dialog.add_button("Отмена", Gtk.ResponseType.CANCEL);
        btnCancel.set_image(Gtk.Image.new_from_icon_name("process-stop-symbolic", Gtk.IconSize.BUTTON));
        btnCancel.set_always_show_image(true);

        let btnDel = dialog.add_button("Удалить выбранное", Gtk.ResponseType.OK);
        btnDel.set_image(Gtk.Image.new_from_icon_name("edit-delete-symbolic", Gtk.IconSize.BUTTON));
        btnDel.set_always_show_image(true);
        btnDel.get_style_context().add_class("destructive-action");

        let content = dialog.get_content_area();
        content.set_spacing(5);
        content.set_margin_start(10); content.set_margin_end(10);
        content.set_margin_top(10); content.set_margin_bottom(10);

        content.pack_start(new Gtk.Label({ label: `<b>Файлы для имени: ${name}</b>`, use_markup: true, halign: Gtk.Align.START }), false, false, 0);

        let store = new Gtk.ListStore();
        // 0-Чекбокс, 1-Превью, 2-Контекст, 3-Каталог, 4-Размер, 5-Статус, 6-Цель, 7-ПолныйПуть
        store.set_column_types([
            GObject.TYPE_BOOLEAN, GdkPixbuf.Pixbuf, GObject.TYPE_STRING, 
            GObject.TYPE_STRING, GObject.TYPE_INT, GObject.TYPE_STRING, 
            GObject.TYPE_STRING, GObject.TYPE_STRING
        ]);
        
        for (let o of occs) {
            let pb = pixbufFromFileCached(o.fullPath, 24) || getTransparentPixbuf();
            let status = o.isSymlink ? "симлинк" : "файл";
            let target = o.target || "";
            let size = o.size || 0;
            
            let iter = store.append();
            store.set(iter, [0, 1, 2, 3, 4, 5, 6, 7], [
                false, pb, o.context || '', o.dirName, size, status, target, o.fullPath
            ]);
        }

        let view = new Gtk.TreeView({ model: store, headers_clickable: true });
        view.get_selection().set_mode(Gtk.SelectionMode.MULTIPLE); // Множественное выделение
        
        // Чекбокс
        let rChk = new Gtk.CellRendererToggle();
        rChk.connect('toggled', (w, path) => {
            let [ok, iter] = store.get_iter_from_string(path);
            if (ok) store.set_value(iter, 0, !store.get_value(iter, 0));
        });
        let cChk = new Gtk.TreeViewColumn({ title: "" }); cChk.pack_start(rChk, false); cChk.add_attribute(rChk, 'active', 0);
        view.append_column(cChk);

        // Колонки с сортировкой
        let cols = [
            ["Превью", 1, false, false],
            ["Контекст", 2, false, false],
            ["Каталог", 3, true, false],
            ["Размер", 4, false, true],
            ["Статус", 5, false, false],
            ["Цель", 6, true, false]
        ];

        for (let [title, idx, expand, isInt] of cols) {
            let r = (idx === 1) ? new Gtk.CellRendererPixbuf() : new Gtk.CellRendererText();
            if (idx === 6 || idx === 3) r.set_property('ellipsize', 3);
            let c = new Gtk.TreeViewColumn({ title: title, expand: expand });
            c.pack_start(r, true);
            c.add_attribute(r, idx === 1 ? 'pixbuf' : 'text', idx);
            c.set_sort_column_id(idx);
            c.set_resizable(true);
            view.append_column(c);
        }

        // Обработка нажатия Пробела для переключения чекбоксов
        view.connect('key-press-event', (w, event) => {
            let keyval = event.get_keyval()[1];
            if (keyval === 32) { // Пробел
                let selection = view.get_selection();
                let [rows, model] = selection.get_selected_rows();
                if (rows.length === 0) return false;

                // Проверяем, есть ли хоть одна неотмеченная строка среди выделенных
                let anyUnchecked = false;
                for (let path of rows) {
                    let [ok, iter] = model.get_iter(path);
                    if (ok && !model.get_value(iter, 0)) {
                        anyUnchecked = true;
                        break;
                    }
                }
                
                // Если есть хоть одна неотмеченная — отмечаем все, иначе снимаем все
                for (let path of rows) {
                    let [ok, iter] = model.get_iter(path);
                    if (ok) model.set_value(iter, 0, anyUnchecked);
                }
                return true;
            }
            return false;
        });

        let scroll = new Gtk.ScrolledWindow({ vexpand: true }); scroll.add(view);
        content.pack_start(scroll, true, true, 0);
        
        dialog.show_all();
        if (dialog.run() === Gtk.ResponseType.OK) {
            let count = store.iter_n_children(null);
            let toDelete = [];
            
            for (let i = 0; i < count; i++) {
                let [ok, iter] = store.get_iter_from_string(i.toString());
                if (ok && store.get_value(iter, 0)) {
                    let path = store.get_value(iter, 7);
                    try {
                        Gio.File.new_for_path(path).delete(null);
                        toDelete.push({ path: path });
                    } catch (e) { print("Ошибка удаления " + path + ": " + e.message); }
                }
            }
            dialog.destroy();
            
            if (toDelete.length > 0) {
                // Обновляем память и перерисовываем только вкладку инструментов
                this.updateThemeMemory([], toDelete);
                this.populateToolsMasterStore(() => {
                    this.selectToolsName(name); // Возвращаем курсор на имя
                    this.rebuildComparisonAsync(null); // Обновляем сравнение в фоне
                });
            }
        } else {
            dialog.destroy();
        }
    }

    // =====================================================================
    // ВКЛАДКА "СРАВНЕНИЕ" (Основано на compare-icon-themes.js)
    // =====================================================================

    buildCompareTab() {
        let mainBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 5 });

        // --- Верхняя панель: Чипсы тем ---
        let themeBar = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        let themeScroll = new Gtk.ScrolledWindow();
        themeScroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.NEVER);
        themeScroll.set_size_request(-1, 44);
        
        this.chipsBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        themeScroll.add(this.chipsBox);
        themeBar.pack_start(themeScroll, true, true, 0);
        
        let btnAddTheme = new Gtk.Button({ label: "Добавить тему...", image: Gtk.Image.new_from_icon_name("list-add-symbolic", Gtk.IconSize.BUTTON), always_show_image: true });
        btnAddTheme.connect('clicked', () => this.onAddTheme());
        themeBar.pack_start(btnAddTheme, false, false, 0);

        let btnAddSystem = new Gtk.Button({ label: "Системные темы...", image: Gtk.Image.new_from_icon_name("system-run-symbolic", Gtk.IconSize.BUTTON), always_show_image: true });
        btnAddSystem.connect('clicked', () => this.onAddSystemThemes());
        themeBar.pack_start(btnAddSystem, false, false, 0);

        let btnSettings = new Gtk.Button({ image: Gtk.Image.new_from_icon_name("preferences-system-symbolic", Gtk.IconSize.BUTTON), always_show_image: true, tooltip_text: "Настройки" });
        btnSettings.connect('clicked', () => this.showSettingsDialog());
        themeBar.pack_start(btnSettings, false, false, 0);
        
        mainBox.pack_start(themeBar, false, false, 0);

        // --- Разделяемая панель ---
        let paned = new Gtk.Paned({ orientation: Gtk.Orientation.HORIZONTAL, wide_handle: true });
        paned.set_position(450);

        // === ЛЕВАЯ ПАНЕЛЬ: Список иконок ===
        let leftBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5 });
        
        let filterBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        filterBox.pack_start(new Gtk.Label({ label: "Фильтр:" }), false, false, 0);
        this.filterEntry = new Gtk.Entry({ placeholder_text: "Поиск значка...", hexpand: true });
        this.filterEntry.connect('changed', () => this.onFilterChanged());
        filterBox.pack_start(this.filterEntry, true, true, 0);
        
        this.modeCombo = new Gtk.ComboBoxText();
        ["Все", "Только в главной", "Нет в главной", "Есть во всех, кроме главной"].forEach(m => this.modeCombo.append_text(m));
        this.modeCombo.set_active(0);
        this.modeCombo.connect('changed', () => this.onFilterChanged());
        filterBox.pack_start(this.modeCombo, false, false, 0);
        leftBox.pack_start(filterBox, false, false, 0);

        // Модель (masterStore) берем из compare-icon-themes
        this.masterStore = new Gtk.ListStore();
        this.masterStore.set_column_types([
            GObject.TYPE_STRING, // 0 name
            GObject.TYPE_STRING, // 1 color
            GObject.TYPE_STRING, // 2 coverage
            GObject.TYPE_STRING, // 3 contexts
            GObject.TYPE_STRING, // 4 status
            GObject.TYPE_STRING, // 5 baseName (для лукапа)
            GObject.TYPE_INT     // 6 bitmask (для фильтра)
        ]);

        this.filterModel = new Gtk.TreeModelFilter({ child_model: this.masterStore });
        this.filterModel.set_visible_func((model, iter) => {
            let filterText = this.currentFilterText || '';
            if (filterText) {
                let name = model.get_value(iter, 0).toLowerCase();
                if (name.indexOf(filterText) < 0) return false;
            }
            let modeBit = this.currentModeBit || 0;
            if (modeBit !== 0) {
                let flags = model.get_value(iter, 6);
                if (!(flags & modeBit)) return false;
            }
            return true;
        });

        this.sortModel = new Gtk.TreeModelSort({ model: this.filterModel });
        this.sortModel.set_sort_column_id(0, Gtk.SortType.ASCENDING);

        this.compareView = new Gtk.TreeView({ model: this.sortModel, headers_clickable: true });
        
        let nameR = new Gtk.CellRendererText();
        nameR.set_property('ellipsize', 3);
        let nameC = new Gtk.TreeViewColumn({ title: 'Имя значка' });
        nameC.pack_start(nameR, true);
        nameC.add_attribute(nameR, 'text', 0);
        nameC.add_attribute(nameR, 'foreground', 1);
        nameC.set_sort_column_id(0);
        nameC.set_expand(true);
        nameC.set_resizable(true);
        this.compareView.append_column(nameC);

        let covR = new Gtk.CellRendererText();
        let covC = new Gtk.TreeViewColumn({ title: 'Темы' });
        covC.pack_start(covR, false);
        covC.add_attribute(covR, 'text', 2);
        covC.set_sort_column_id(2);
        covC.set_resizable(true);
        covC.set_expand(false);
        this.compareView.append_column(covC);

        let ctxR = new Gtk.CellRendererText();
        ctxR.set_property('ellipsize', 3);
        let ctxC = new Gtk.TreeViewColumn({ title: 'Контексты' });
        ctxC.pack_start(ctxR, true);
        ctxC.add_attribute(ctxR, 'text', 3);
        ctxC.set_sort_column_id(3);
        ctxC.set_resizable(true);
        ctxC.set_expand(false);
        this.compareView.append_column(ctxC);

        let stR = new Gtk.CellRendererText();
        let stC = new Gtk.TreeViewColumn({ title: 'Статус' });
        stC.pack_start(stR, false);
        stC.add_attribute(stR, 'text', 4);
        stC.set_sort_column_id(4);
        stC.set_resizable(true);
        stC.set_expand(false);
        this.compareView.append_column(stC);

        this.compareView.connect('cursor-changed', () => {
            let [ok, model, iter] = this.compareView.get_selection().get_selected();
            if (ok && iter) {
                let name = model.get_value(iter, 5);
                if (name) {
                    this.currentSelectedIcon = name;
                    this.updateInspector(name);
                }
            }
        });

        let listScroll = new Gtk.ScrolledWindow({ vexpand: true });
        listScroll.add(this.compareView);
        leftBox.pack_start(listScroll, true, true, 0);
        paned.pack1(leftBox, true, false);

        // === ПРАВАЯ ПАНЕЛЬ: Инспектор ===
        let rightBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5 });
        
        let infoTop = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
        this.inspectorImg = new Gtk.Image();
        this.inspectorImg.set_size_request(64, 64);
        infoTop.pack_start(this.inspectorImg, false, false, 0);
        
        let titleBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
        this.inspectorTitle = new Gtk.Label({ label: "<b>Выберите значок</b>", use_markup: true, halign: Gtk.Align.START });
        this.inspectorContext = new Gtk.Label({ label: "", halign: Gtk.Align.START, wrap: true });
        titleBox.pack_start(this.inspectorTitle, false, false, 0);
        titleBox.pack_start(this.inspectorContext, false, false, 0);
        infoTop.pack_start(titleBox, true, true, 0);
        rightBox.pack_start(infoTop, false, false, 0);

        this.rightNotebook = new Gtk.Notebook();
        
        // Слушаем переключение вкладок в правой панели
        this.rightNotebook.connect('switch-page', (nb, page, pageNum) => {
            if (pageNum === 1 && this.currentSelectedIcon) {
                // Если открыли вкладку "Визуально", перестраиваем её под текущие темы
                this.populateVisualTab(this.iconIndex.get(this.currentSelectedIcon));
            }
        });
        
        // Вкладка 1: Файлы
        let filesTab = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 4 });
        this.infoStore = new Gtk.ListStore();
        this.infoStore.set_column_types([
            GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_STRING,
            GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_INT
        ]);
        this.infoView = new Gtk.TreeView({ model: this.infoStore, headers_clickable: true });
        
        let infoCols = [
            ['Theme',   0, false, 100, 0],
            ['Dir',     1, true,  120, 1],
            ['Context', 2, false, 80,  2],
            ['Size',    3, false, 50,  6],
            ['Type',    4, false, 70,  4],
            ['Target',  5, true,  120, 5]
        ];
        for (let i = 0; i < infoCols.length; i++) {
            let title = infoCols[i][0], idx = infoCols[i][1], expand = infoCols[i][2], minw = infoCols[i][3], sortIdx = infoCols[i][4];
            let r = new Gtk.CellRendererText();
            r.set_property('ellipsize', 3);
            let c = new Gtk.TreeViewColumn({ title: title });
            c.pack_start(r, true); c.add_attribute(r, 'text', idx);
            c.set_resizable(true); c.set_expand(expand); c.set_min_width(minw);
            c.set_sort_column_id(sortIdx); c.set_clickable(true);
            this.infoView.append_column(c);
        }
        this.infoStore.set_sort_column_id(0, Gtk.SortType.ASCENDING);
        let infoScroll = new Gtk.ScrolledWindow({ vexpand: true });
        infoScroll.add(this.infoView);
        filesTab.pack_start(infoScroll, true, true, 0);
        this.rightNotebook.append_page(filesTab, new Gtk.Label({ label: "Файлы" }));
        
        // Вкладка 2: Визуально
        let visualTab = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 4 });
        this.visualStore = new Gtk.ListStore();
        this.visualView = new Gtk.TreeView({ model: this.visualStore, headers_clickable: true });
        let scrollVisual = new Gtk.ScrolledWindow({ vexpand: true });
        scrollVisual.add(this.visualView);
        visualTab.pack_start(scrollVisual, true, true, 0);

        let visualBottom = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        visualBottom.pack_start(new Gtk.Label({ label: "Размер превью:" }), false, false, 0);
        
        this.visualSizeCombo = Gtk.ComboBoxText.new_with_entry();
        this.visualSizeCombo.get_child().set_width_chars(5);
        
        // При изменении значения вручную (или выборе из списка)
        this.visualSizeCombo.get_child().connect('changed', () => {
            if (this.isUpdatingVisual) return;
            let size = parseInt(this.visualSizeCombo.get_child().get_text());
            if (!isNaN(size) && size > 0 && size !== this.settings.visualPreviewSize) {
                this.settings.visualPreviewSize = size;
                this.settings.save();
                this.refreshVisualSizes();
                this.updateVisualPixbufs(); // Обновляем только картинки
            }
        });
        
        this.visualSizeCombo.get_child().set_text(this.settings.visualPreviewSize.toString());
        visualBottom.pack_start(this.visualSizeCombo, false, false, 0);
        visualBottom.pack_start(new Gtk.Label({ label: "" }), true, true, 0);
        visualTab.pack_start(visualBottom, false, false, 0);
        visualBottom.pack_start(this.visualSizeCombo, false, false, 0);
        visualBottom.pack_start(new Gtk.Label({ label: "" }), true, true, 0);
        visualTab.pack_start(visualBottom, false, false, 0);
        this.rightNotebook.append_page(visualTab, new Gtk.Label({ label: "Визуально" }));

        rightBox.pack_start(this.rightNotebook, true, true, 0);
        paned.pack2(rightBox, true, false);

        mainBox.pack_start(paned, true, true, 0);
        return mainBox;
    }

    buildToolsTab() {
        this.toolsCurrentSelected = null;
        
        let mainBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 5 });
        let paned = new Gtk.Paned({ orientation: Gtk.Orientation.HORIZONTAL, wide_handle: true });
        paned.set_position(600);

        // ================= ЛЕВАЯ ПАНЕЛЬ: Оригиналы и смешанные =================
        let leftBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5 });
        
        let filterBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        filterBox.pack_start(new Gtk.Label({ label: "Фильтр:" }), false, false, 0);
        
        this.toolsFilterEntry = new Gtk.Entry({ placeholder_text: "Поиск по имени...", hexpand: true });
        this.toolsFilterEntry.connect('changed', () => {
            if (this.toolsFilterModel) this.toolsFilterModel.refilter();
        });
        filterBox.pack_start(this.toolsFilterEntry, true, true, 0);

        this.toolsShowAllChk = new Gtk.CheckButton({ label: "Показать все" });
        this.toolsShowAllChk.set_tooltip_text("Показывать все имена в теме, включая те, которые состоят только из симлинков (без физических оригиналов).");
        this.toolsShowAllChk.connect('toggled', () => {
            this.populateToolsMasterStore(); // Пересобираем таблицу при переключении
        });
        filterBox.pack_start(this.toolsShowAllChk, false, false, 0);

        leftBox.pack_start(filterBox, false, false, 0);

        // Модель левой панели: [0-Превью, 1-Имя, 2-Контекст, 3-Кол-во симлинков, 4-Статус, 5-Цвет, 6-Имя(поиск)]
        this.toolsMasterStore = new Gtk.ListStore();
        this.toolsMasterStore.set_column_types([
            GdkPixbuf.Pixbuf, GObject.TYPE_STRING, GObject.TYPE_STRING, 
            GObject.TYPE_INT, GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_STRING
        ]);

        this.toolsFilterModel = new Gtk.TreeModelFilter({ child_model: this.toolsMasterStore });
        this.toolsFilterModel.set_visible_func((model, iter) => {
            let text = this.toolsFilterEntry.get_text().toLowerCase();
            if (text && model.get_value(iter, 6).indexOf(text) < 0) return false;
            return true;
        });

        this.toolsSortModel = new Gtk.TreeModelSort({ model: this.toolsFilterModel });
        this.toolsSortModel.set_sort_column_id(1, Gtk.SortType.ASCENDING);

        this.toolsLeftView = new Gtk.TreeView({ model: this.toolsSortModel, headers_clickable: true });
        
        let tCols = [
            ["", 0, false], // Убрали заголовок "Превью"
            ["Имя", 1, true], 
            ["Контекст", 2, false], 
            ["Симлинков", 3, false], 
            ["Статус", 4, false]
        ];
        for (let [title, idx, expand] of tCols) {
            let r = (idx === 0) ? new Gtk.CellRendererPixbuf() : new Gtk.CellRendererText();
            if (idx === 4) r.set_property('foreground', 5); // Для статуса используем цвет
            
            let c = new Gtk.TreeViewColumn({ title: title });
            c.pack_start(r, false);
            c.add_attribute(r, idx === 0 ? 'pixbuf' : 'text', idx);
            c.set_sort_column_id(idx);
            c.set_resizable(true);
            
            if (idx === 1) {
                c.set_expand(true);
                c.set_fixed_width(240); // Изначальная ширина не более 240px
            }
            
            this.toolsLeftView.append_column(c);
        }

        this.toolsLeftView.connect('cursor-changed', () => {
            if (this.isUpdatingTools) return; // Игнорируем во время заполнения
            let [ok, model, iter] = this.toolsLeftView.get_selection().get_selected();
            if (ok && iter) {
                let name = model.get_value(iter, 1);
                this.toolsCurrentSelected = name;
                this.populateToolsRightPanel(name);
            }
        });

        let scrollLeft = new Gtk.ScrolledWindow({ vexpand: true });
        scrollLeft.add(this.toolsLeftView);
        leftBox.pack_start(scrollLeft, true, true, 0);

        // Панель инструментов (только иконки)
        let toolbar = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        
        let btnDel = new Gtk.Button({ image: Gtk.Image.new_from_icon_name("edit-delete-symbolic", Gtk.IconSize.BUTTON), tooltip_text: "Удалить часть файлов" });
        btnDel.connect('clicked', () => this.showDeleteFilesDialog());
        toolbar.pack_start(btnDel, false, false, 0);

        let btnMove = new Gtk.Button({ image: Gtk.Image.new_from_icon_name("edit-copy-symbolic", Gtk.IconSize.BUTTON), tooltip_text: "Переместить/Копировать/Переименовать" });
        btnMove.connect('clicked', () => this.showMoveCopyDialog());
        toolbar.pack_start(btnMove, false, false, 0);

        let btnLink = new Gtk.Button({ image: Gtk.Image.new_from_icon_name("insert-link-symbolic", Gtk.IconSize.BUTTON), tooltip_text: "Сделать симлинком / Оригиналом" });
        btnLink.connect('clicked', () => this.showCreateSymlinksDialog());
        toolbar.pack_start(btnLink, false, false, 0);

        // НОВЫЕ КНОПКИ: Экспорт и Импорт ICO
        let btnIcoOut = new Gtk.Button({ image: Gtk.Image.new_from_icon_name("document-export-symbolic", Gtk.IconSize.BUTTON), tooltip_text: "Сохранить в ICO..." });
        btnIcoOut.connect('clicked', () => this.runIcoCompiler());
        toolbar.pack_start(btnIcoOut, false, false, 0);

        let btnIcoIn = new Gtk.Button({ image: Gtk.Image.new_from_icon_name("document-import-symbolic", Gtk.IconSize.BUTTON), tooltip_text: "Импортировать из ICO..." });
        btnIcoIn.connect('clicked', () => this.runIcoInstaller());
        toolbar.pack_start(btnIcoIn, false, false, 0);
        
        leftBox.pack_start(toolbar, false, false, 0);
        paned.pack1(leftBox, true, false);

        // ================= ПРАВАЯ ПАНЕЛЬ =================
        let rightPaned = new Gtk.Paned({ orientation: Gtk.Orientation.VERTICAL, wide_handle: true });
        
        // --- ВЕРХНЯЯ ЧАСТЬ: Файлы выбранного значка ---
        let rightTopBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 4 });
        rightTopBox.pack_start(new Gtk.Label({ label: "<b>Файлы выбранного имени</b>", use_markup: true, halign: Gtk.Align.START }), false, false, 0);

        this.toolsRightFilesStore = new Gtk.ListStore();
        this.toolsRightFilesStore.set_column_types([
            GdkPixbuf.Pixbuf, GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_INT, GObject.TYPE_STRING, GObject.TYPE_STRING
        ]);
        // 0-Превью, 1-Каталог, 2-Контекст, 3-Размер, 4-Тип, 5-Цель

        let viewRightFiles = new Gtk.TreeView({ model: this.toolsRightFilesStore, headers_clickable: true });
        
        let rfCols = [
            ["", 0, false], ["Каталог", 1, true], ["Контекст", 2, false], 
            ["Размер", 3, false], ["Тип", 4, false], ["Цель", 5, true]
        ];
        for (let [title, idx, expand] of rfCols) {
            let r = (idx === 0) ? new Gtk.CellRendererPixbuf() : new Gtk.CellRendererText();
            if (idx > 0) r.set_property('ellipsize', 3);
            let c = new Gtk.TreeViewColumn({ title: title, expand: expand });
            c.pack_start(r, true);
            c.add_attribute(r, idx === 0 ? 'pixbuf' : 'text', idx);
            c.set_sort_column_id(idx);
            c.set_resizable(true);
            viewRightFiles.append_column(c);
        }
        
        let scrollRightFiles = new Gtk.ScrolledWindow({ vexpand: true });
        scrollRightFiles.add(viewRightFiles);
        rightTopBox.pack_start(scrollRightFiles, true, true, 0);
        rightPaned.pack1(rightTopBox, true, false);

        // --- НИЖНЯЯ ЧАСТЬ: Notebook со ссылками ---
        let rightBottomBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 4 });
        rightBottomBox.pack_start(new Gtk.Label({ label: "<b>Симлинки на выбранное имя</b>", use_markup: true, halign: Gtk.Align.START }), false, false, 0);

        let rightNotebook = new Gtk.Notebook();
        
        // Вкладка 1: Списком
        let tabList = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 4 });
        this.toolsRightStore = new Gtk.ListStore();
        this.toolsRightStore.set_column_types([GdkPixbuf.Pixbuf, GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_STRING]);
        
        let viewList = new Gtk.TreeView({ model: this.toolsRightStore, headers_clickable: true });
        let rCols1 = [["", 0, false], ["Имя симлинка", 1, true], ["Адрес", 2, true], ["Контекст", 3, false]];
        for (let [title, idx, expand] of rCols1) {
            let r = (idx === 0) ? new Gtk.CellRendererPixbuf() : new Gtk.CellRendererText();
            if (idx > 0) r.set_property('ellipsize', 3);
            let c = new Gtk.TreeViewColumn({ title: title, expand: expand });
            c.pack_start(r, true);
            c.add_attribute(r, idx === 0 ? 'pixbuf' : 'text', idx);
            c.set_resizable(true);
            viewList.append_column(c);
        }
        let scrollList = new Gtk.ScrolledWindow({ vexpand: true });
        scrollList.add(viewList);
        tabList.pack_start(scrollList, true, true, 0);
        rightNotebook.append_page(tabList, new Gtk.Label({ label: "Списком" }));

        // Вкладка 2: Поимённо
        let tabByName = new Gtk.Paned({ orientation: Gtk.Orientation.VERTICAL, wide_handle: true });
        
        let topBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 4 });
        this.toolsRightTopStore = new Gtk.ListStore();
        this.toolsRightTopStore.set_column_types([GdkPixbuf.Pixbuf, GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_INT]);
        
        let viewTop = new Gtk.TreeView({ model: this.toolsRightTopStore, headers_clickable: true });
        viewTop.get_selection().set_mode(Gtk.SelectionMode.MULTIPLE);
        let rColsTop = [["", 0, false], ["Имя", 1, true], ["Контекст", 2, false], ["Кол-во", 3, false]];
        for (let [title, idx, expand] of rColsTop) {
            let r = (idx === 0) ? new Gtk.CellRendererPixbuf() : new Gtk.CellRendererText();
            let c = new Gtk.TreeViewColumn({ title: title, expand: expand });
            c.pack_start(r, true);
            c.add_attribute(r, idx === 0 ? 'pixbuf' : 'text', idx);
            c.set_sort_column_id(idx);
            c.set_resizable(true);
            viewTop.append_column(c);
        }
        let scrollTop = new Gtk.ScrolledWindow({ vexpand: true });
        scrollTop.add(viewTop);
        topBox.pack_start(scrollTop, true, true, 0);
        let syncBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5, margin_top: 5 });
        let btnSync = new Gtk.Button({
            label: "Матрица симлинков", 
            image: Gtk.Image.new_from_icon_name("emblem-synchronizing-symbolic", Gtk.IconSize.BUTTON), 
            always_show_image: true 
        });
        btnSync.connect('clicked', () => {
            let [rows, model] = viewTop.get_selection().get_selected_rows();
            if (rows.length === 0) {
                let msg = new Gtk.MessageDialog({ transient_for: this.window, modal: true, message_type: Gtk.MessageType.WARNING, buttons: Gtk.ButtonsType.OK, text: "Выберите хотя бы одно имя в верхней таблице." });
                msg.run(); msg.destroy(); return;
            }
            let selectedNames = [];
            for (let path of rows) {
                let [ok, iter] = model.get_iter(path);
                if (ok && iter) selectedNames.push(model.get_value(iter, 1));
            }
            if (selectedNames.length > 0) {
                this.showSymlinkMatrixDialog(this.toolsCurrentSelected, selectedNames);
            }
        });
        syncBox.pack_start(btnSync, false, false, 0);
        topBox.pack_start(syncBox, false, false, 0);
        tabByName.pack1(topBox, true, false);

        let bottomBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 4 });
        this.toolsRightBottomStore = new Gtk.ListStore();
        this.toolsRightBottomStore.set_column_types([GdkPixbuf.Pixbuf, GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_STRING]);
        
        let viewBottom = new Gtk.TreeView({ model: this.toolsRightBottomStore, headers_clickable: true });
        let rColsBot = [["", 0, false], ["Адрес", 1, true], ["Контекст", 2, false], ["Размер", 3, false]];
        for (let [title, idx, expand] of rColsBot) {
            let r = (idx === 0) ? new Gtk.CellRendererPixbuf() : new Gtk.CellRendererText();
            if (idx > 0) r.set_property('ellipsize', 3);
            let c = new Gtk.TreeViewColumn({ title: title, expand: expand });
            c.pack_start(r, true);
            c.add_attribute(r, idx === 0 ? 'pixbuf' : 'text', idx);
            c.set_resizable(true);
            viewBottom.append_column(c);
        }
        let scrollBottom = new Gtk.ScrolledWindow({ vexpand: true });
        scrollBottom.add(viewBottom);
        bottomBox.pack_start(scrollBottom, true, true, 0);
        tabByName.pack2(bottomBox, true, false);

        viewTop.get_selection().connect('changed', () => {
            let [rows, model] = viewTop.get_selection().get_selected_rows();
            this.toolsRightBottomStore.clear();
            if (rows.length > 0) {
                let [ok, iter] = model.get_iter(rows[0]); // <--- Распаковка массива
                if (ok && iter) {
                    let targetName = model.get_value(iter, 1);
                    let refs = this.toolsReverseIndex.get(this.toolsCurrentSelected) || [];
                    for (let ref of refs) {
                        if (ref.name === targetName) {
                            let o = ref.occ;
                            let pb = pixbufFromFileCached(o.fullPath, 24) || getTransparentPixbuf();
                            let bIter = this.toolsRightBottomStore.append();
                            this.toolsRightBottomStore.set(bIter, [0, 1, 2, 3], [pb, o.dirName, o.context || '', o.size ? o.size.toString() : '']);
                        }
                    }
                }
            }
        });

        rightNotebook.append_page(tabByName, new Gtk.Label({ label: "Поимённо" }));
        rightBottomBox.pack_start(rightNotebook, true, true, 0);
        rightPaned.pack2(rightBottomBox, true, false);

        // Задаем начальные пропорции (Верхняя часть - 40%, нижняя - 60%)
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            rightPaned.set_position(250);
            return false;
        });

        paned.pack2(rightPaned, true, false);
        mainBox.pack_start(paned, true, true, 0);

        return mainBox;
    }

    // --- Логика фильтрации и пересборки (как в compare-icon-themes) ---

    onFilterChanged() {
        this.currentFilterText = this.filterEntry.get_text().toLowerCase();
        let mode = this.modeCombo.get_active_text();
        if (mode === "Только в главной") this.currentModeBit = 1;
        else if (mode === "Нет в главной") this.currentModeBit = 2;
        else if (mode === "Есть во всех, кроме главной") this.currentModeBit = 4;
        else this.currentModeBit = 0;
        
        if (this.filterModel) this.filterModel.refilter();
    }

    async rebuildComparisonAsync(progress = null) {
        let prevSelected = this.currentSelectedIcon;
        if (progress) progress.setStatus(0.1, "Сбор данных о значках...");
        await new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { r(); return false; }));

        this.iconIndex = new Map();
        let checkedThemes = this.loadedThemes.filter(t => t.checked);

        for (let i = 0; i < checkedThemes.length; i++) {
            if (progress && progress.isCancelled()) return;
            if (progress) progress.setStatus(0.1 + (i / checkedThemes.length) * 0.4, `Обработка темы ${checkedThemes[i].name}...`);
            
            let theme = checkedThemes[i];
            for (let [name, occs] of theme.icons) {
                if (!this.iconIndex.has(name)) {
                    this.iconIndex.set(name, { name: name, occurrences: [], themes: new Set(), contexts: new Set() });
                }
                let entry = this.iconIndex.get(name);
                for (let occ of occs) {
                    entry.occurrences.push(Object.assign({ theme: theme }, occ));
                    entry.themes.add(theme);
                    if (occ.context) entry.contexts.add(occ.context);
                }
            }
            await new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { r(); return false; }));
        }

        if (progress) progress.setStatus(0.5, "Построение таблицы...");
        await new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { r(); return false; }));

        this.masterStore.clear();
        let mainTheme = this.loadedThemes.find(t => t.isMain);
        let totalChecked = checkedThemes.length;
        let keys = Array.from(this.iconIndex.keys());
        let chunkSize = 1000;

        for (let i = 0; i < keys.length; i += chunkSize) {
            if (progress && progress.isCancelled()) return;
            if (progress) progress.setStatus(0.5 + (i / keys.length) * 0.5, `Построение строк ${i} из ${keys.length}...`);

            let end = Math.min(i + chunkSize, keys.length);
            for (let j = i; j < end; j++) {
                let name = keys[j];
                let entry = this.iconIndex.get(name);
                
                let color = this.settings.colors.ok;
                let status = "OK";
                if (entry.themes.size < totalChecked) {
                    color = this.settings.colors.missing;
                    status = `Нет в ${totalChecked - entry.themes.size} темах`;
                } else {
                    let symlinkCount = entry.occurrences.filter(o => o.isSymlink).length;
                    if (symlinkCount === entry.occurrences.length) {
                        color = this.settings.colors.symlinksOnly;
                        status = "Только симлинки";
                    } else if (symlinkCount > 0) {
                        color = this.settings.colors.hasSymlinks;
                        status = "Есть симлинки";
                    }
                }
                let ctxArr = Array.from(entry.contexts).filter(Boolean).sort();
                let ctxStr = ctxArr.length > 1 ? "Multiple" : (ctxArr[0] || "");
                let hasInMain = mainTheme ? entry.themes.has(mainTheme) : false;
                let othersCount = entry.themes.size - (hasInMain ? 1 : 0);
                let flags = 0;
                if (hasInMain && othersCount === 0) flags |= 1;
                if (!hasInMain) flags |= 2;
                if (!hasInMain && othersCount === totalChecked - 1) flags |= 4;

                let iter = this.masterStore.append();
                this.masterStore.set(iter, [0, 1, 2, 3, 4, 5, 6], [
                    name, color, `${entry.themes.size}/${totalChecked}`, ctxStr, status, name, flags
                ]);
            }
            await new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { r(); return false; }));
        }

        this.onFilterChanged();
        
        // Восстанавливаем выбор
        if (prevSelected && this.iconIndex.has(prevSelected)) {
            let count = this.sortModel.iter_n_children(null);
            for (let i = 0; i < count; i++) {
                let [ok, iter] = this.sortModel.get_iter_from_string(i.toString());
                if (ok && iter && this.sortModel.get_value(iter, 5) === prevSelected) {
                    let path = this.sortModel.get_path(iter);
                    this.compareView.get_selection().select_path(path);
                    this.compareView.scroll_to_cell(path, null, false, 0, 0);
                    this.updateInspector(prevSelected);
                    break;
                }
            }
        } else {
            this.currentSelectedIcon = null;
        }
    }

    async updateMainThemeStatusAsync(progress = null) {
        if (progress) progress.setStatus(0.1, "Обновление статусов...");
        await new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { r(); return false; }));

        let mainTheme = this.loadedThemes.find(t => t.isMain);
        let totalChecked = this.loadedThemes.filter(t => t.checked).length;
        let count = this.masterStore.iter_n_children(null);
        let chunkSize = 2000;

        for (let i = 0; i < count; i += chunkSize) {
            if (progress && progress.isCancelled()) return;
            if (progress) progress.setStatus(0.1 + (i / count) * 0.9, `Обновление ${i}/${count}...`);

            let end = Math.min(i + chunkSize, count);
            for (let j = i; j < end; j++) {
                let [ok, iter] = this.masterStore.get_iter_from_string(j.toString());
                if (!ok || !iter) continue;

                let name = this.masterStore.get_value(iter, 5);
                let entry = this.iconIndex.get(name);
                if (!entry) continue;

                let color = this.settings.colors.ok;
                let status = "OK";
                if (entry.themes.size < totalChecked) {
                    color = this.settings.colors.missing;
                    status = `Нет в ${totalChecked - entry.themes.size} темах`;
                } else {
                    let symlinkCount = entry.occurrences.filter(o => o.isSymlink).length;
                    if (symlinkCount === entry.occurrences.length) {
                        color = this.settings.colors.symlinksOnly;
                        status = "Только симлинки";
                    } else if (symlinkCount > 0) {
                        color = this.settings.colors.hasSymlinks;
                        status = "Есть симлинки";
                    }
                }
                
                let hasInMain = mainTheme ? entry.themes.has(mainTheme) : false;
                let othersCount = entry.themes.size - (hasInMain ? 1 : 0);
                let flags = 0;
                if (hasInMain && othersCount === 0) flags |= 1;
                if (!hasInMain) flags |= 2;
                if (!hasInMain && othersCount === totalChecked - 1) flags |= 4;

                this.masterStore.set(iter, [1, 4, 6], [color, status, flags]);
            }
            await new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { r(); return false; }));
        }
        this.onFilterChanged();
    }

    populateMasterStore() {
        this.masterStore.clear();
        let mainTheme = this.loadedThemes.find(t => t.isMain);
        let totalChecked = this.loadedThemes.filter(t => t.checked).length;

        for (let [name, entry] of this.iconIndex) {
            let color = this.settings.colors.ok;
            let status = "OK";
            
            if (entry.themes.size < totalChecked) {
                color = this.settings.colors.missing;
                status = `Нет в ${totalChecked - entry.themes.size} темах`;
            } else {
                let symlinkCount = entry.occurrences.filter(o => o.isSymlink).length;
                if (symlinkCount === entry.occurrences.length) {
                    color = this.settings.colors.symlinksOnly;
                    status = "Только симлинки";
                } else if (symlinkCount > 0) {
                    color = this.settings.colors.hasSymlinks;
                    status = "Есть симлинки";
                }
            }

            let ctxArr = Array.from(entry.contexts).filter(Boolean).sort();
            let ctxStr = ctxArr.length > 1 ? "Multiple" : (ctxArr[0] || "");

            let hasInMain = mainTheme ? entry.themes.has(mainTheme) : false;
            let othersCount = entry.themes.size - (hasInMain ? 1 : 0);
            
            let flags = 0;
            if (hasInMain && othersCount === 0) flags |= 1; // Только в главной
            if (!hasInMain) flags |= 2; // Нет в главной
            if (!hasInMain && othersCount === totalChecked - 1) flags |= 4; // Есть во всех, кроме главной

            let iter = this.masterStore.append();
            this.masterStore.set(iter, [0, 1, 2, 3, 4, 5, 6], [
                name, color, `${entry.themes.size}/${totalChecked}`, ctxStr, status, name, flags
            ]);
        }
        this.onFilterChanged();
    }

    updateInspector(name) {
        let entry = this.iconIndex.get(name);
        if (!entry) return;

        this.inspectorTitle.set_markup(`<b>${name}</b>`);
        let themeNames = Array.from(entry.themes).map(t => t.name).sort();
        this.inspectorContext.set_text(`Темы: ${themeNames.join(', ')}\nКонтексты: ${Array.from(entry.contexts).filter(Boolean).join(', ')}`);
        
        let previewPb = null;
        for (let o of entry.occurrences) {
            if (!o.isSymlink) { previewPb = loadPixbufNoSmooth(o.fullPath, 64); if (previewPb) break; }
        }
        if (!previewPb) {
            for (let o of entry.occurrences) {
                previewPb = loadPixbufNoSmooth(o.fullPath, 64); if (previewPb) break;
            }
        }
        this.inspectorImg.set_from_pixbuf(previewPb);

        this.populateInfoStore(entry);
        this.populateVisualTab(entry); // <--- Всегда обновляем данные для визуальной вкладки
    }

    populateInfoStore(entry) {
        this.infoStore.clear();
        for (let occ of entry.occurrences) {
            let sizeText = occ.size != null ? String(occ.size) : '';
            let sizeKey = occ.size != null ? occ.size : 999999;
            let iter = this.infoStore.append();
            this.infoStore.set(iter, [0, 1, 2, 3, 4, 5, 6], [
                occ.theme.name,
                occ.relPath || occ.dirName,
                occ.context || '',
                sizeText,
                occ.isSymlink ? 'symlink' : 'file',
                occ.target || '',
                sizeKey
            ]);
        }
    }

    populateVisualTab(entry) {
        if (!entry) return;
        let activeThemes = this.loadedThemes.filter(t => t.checked);
        
        let colTypes = [GObject.TYPE_STRING, GObject.TYPE_INT];
        for (let i = 0; i < activeThemes.length; i++) {
            colTypes.push(GdkPixbuf.Pixbuf);
            colTypes.push(GObject.TYPE_STRING);
        }
        this.visualStore = new Gtk.ListStore();
        this.visualStore.set_column_types(colTypes);
        this.visualView.set_model(this.visualStore);

        let oldCols = this.visualView.get_columns();
        for (let c of oldCols) this.visualView.remove_column(c);

        let rSize = new Gtk.CellRendererText();
        let cSize = new Gtk.TreeViewColumn({ title: "Размер" });
        cSize.pack_start(rSize, false); cSize.add_attribute(rSize, 'text', 0);
        cSize.set_sort_column_id(1);
        cSize.set_expand(true); // <--- ЛЕВАЯ КОЛОНКА РАСТЯГИВАЕТСЯ
        cSize.set_resizable(true); // <--- РАЗРЕШАЕМ МЕНЯТЬ ШИРИНУ
        this.visualView.append_column(cSize);

        for (let ti = 0; ti < activeThemes.length; ti++) {
            let theme = activeThemes[ti];
            let pixIdx = 2 + ti * 2;
            let bgIdx = 3 + ti * 2;

            let rPix = new Gtk.CellRendererPixbuf();
            rPix.set_property('xpad', 4);
            rPix.set_property('ypad', 2);
            let cTheme = new Gtk.TreeViewColumn({ title: theme.name });
            cTheme.pack_start(rPix, false);
            cTheme.add_attribute(rPix, 'pixbuf', pixIdx);
            cTheme.add_attribute(rPix, 'cell-background', bgIdx);
            cTheme.set_min_width(50);
            cTheme.set_expand(false); // <--- ОСТАЛЬНЫЕ НЕ РАСТЯГИВАЮТСЯ
            cTheme.set_resizable(true); // <--- РАЗРЕШАЕМ МЕНЯТЬ ШИРИНУ
            this.visualView.append_column(cTheme);
        }
        this.visualStore.set_sort_column_id(1, Gtk.SortType.ASCENDING);

        let sizes = new Set();
        for (let occ of entry.occurrences) {
            if (occ.size) sizes.add(Number(occ.size));
        }
        let sortedSizes = Array.from(sizes).sort((a,b) => a-b);

        // Создаем строки (без картинок)
        for (let sz of sortedSizes) {
            let iter = this.visualStore.append();
            this.visualStore.set(iter, [0, 1], [sz.toString(), sz]);
        }
        
        // Загружаем картинки
        this.updateVisualPixbufs();
    }

    updateVisualPixbufs() {
        if (!this.currentSelectedIcon) return;
        let entry = this.iconIndex.get(this.currentSelectedIcon);
        if (!entry) return;
        
        let activeThemes = this.loadedThemes.filter(t => t.checked);
        let count = this.visualStore.iter_n_children(null);

        for (let i = 0; i < count; i++) {
            let [ok, iter] = this.visualStore.get_iter_from_string(i.toString());
            if (!ok || !iter) continue;

            let sz = this.visualStore.get_value(iter, 1); // 1 is integer size
            let rowData = [sz.toString(), sz];
            
            for (let theme of activeThemes) {
                let match = entry.occurrences.find(o => o.theme === theme && Number(o.size) === sz);
                if (match) {
                    let pb = pixbufFromFileCached(match.fullPath, this.settings.visualPreviewSize);
                    rowData.push(pb || getTransparentPixbuf());
                    rowData.push(match.isSymlink ? '#D9E6F2' : '#FFFFFF');
                } else {
                    rowData.push(getTransparentPixbuf());
                    rowData.push('#F0F0F0');
                }
            }
            
            let idx = [];
            for (let k = 0; k < rowData.length; k++) idx.push(k);
            this.visualStore.set(iter, idx, rowData);
        }
    }

    async onAddTheme() {
        let dialog = new Gtk.FileChooserDialog({
            title: 'Выберите каталог темы или index.theme',
            action: Gtk.FileChooserAction.SELECT_FOLDER,
            transient_for: this.window,
            modal: true
        });
        dialog.add_button('Отмена', Gtk.ResponseType.CANCEL);
        dialog.add_button('Добавить', Gtk.ResponseType.OK);
        
        if (dialog.run() === Gtk.ResponseType.OK) {
            let path = dialog.get_filename();
            dialog.destroy();
            
            let indexFile = GLib.build_filenamev([path, 'index.theme']);
            if (Gio.File.new_for_path(indexFile).query_exists(null)) {
                await this.loadAndAddTheme(indexFile);
            }
        } else {
            dialog.destroy();
        }
    }

    async onAddSystemThemes() {
        const dlg = new SystemThemesDialog(this.window, this);
        const selectedPaths = dlg.run();
        
        if (selectedPaths && selectedPaths.length > 0) {
            for (let path of selectedPaths) {
                await this.loadAndAddTheme(path);
            }
        }
    }

    async loadAndAddTheme(indexPath) {
        for (let t of this.loadedThemes) {
            if (t.indexPath === indexPath) return; // Уже загружена
        }
        
        let themeName = GLib.path_get_basename(GLib.path_get_dirname(indexPath));
        const progress = new ProgressDialog(this.window, 'Загрузка темы', 'Загрузка ' + themeName + '...');

        let theme = new ThemeModule.Theme(indexPath);
        let ok = false;
        try {
            ok = await theme.load(progress);
        } catch (e) {
            print("Ошибка загрузки: " + e.message);
        } // <-- Убрали finally, чтобы не закрывать окно раньше времени

        if (ok) {
            theme.checked = true;
            theme.isMain = false;
            this.loadedThemes.push(theme);
            this.renderChips();
            this.refreshVisualSizes();
            
            // Передаем прогресс в пересборку таблицы
            await this.rebuildComparisonAsync(progress);
        } else if (!progress.isCancelled()) {
            print("Не удалось загрузить тему (возможно, это тема курсоров): " + indexPath);
        }
        
        progress.close(); // <-- Закрываем окно только когда всё готово
    }

    async setMainTheme(theme) {
        let wasChecked = theme.checked; // Проверяем, участвовала ли тема в сравнении
        
        for (let t of this.loadedThemes) {
            t.isMain = (t === theme);
            if (t.isMain) t.checked = true;
        }
        
        this.settings.mainThemePath = theme.indexPath;
        this.settings.save();
        this.renderChips();
        
        const progress = new ProgressDialog(this.window, 'Смена главной темы', 'Перенастройка данных...');
        
        if (wasChecked) {
            // Если тема уже была в сравнении, делаем быструю перенастройку флагов
            await this.updateMainThemeStatusAsync(progress);
        } else {
            // Если тема была отключена, нужно пересобрать индекс заново
            await this.rebuildComparisonAsync(progress);
        }
        
        progress.close();

        // Переключаемся в редактор и загружаем данные (без прогресса, так как уже в памяти)
        this.notebook.set_current_page(1);
        this.loadThemeData(theme.indexPath).catch(e => print(e.message));
    }
    
    showSettingsDialog() {
        let dialog = new Gtk.Dialog({ title: "Настройки", transient_for: this.window, modal: true });
        dialog.add_button("Сохранить", Gtk.ResponseType.OK);
        
        let content = dialog.get_content_area();
        let grid = new Gtk.Grid({ row_spacing: 5, column_spacing: 5, margin: 10 });
        
        let colors = [
            ['ok', 'OK:'],
            ['missing', 'Отсутствует:'],
            ['hasSymlinks', 'Есть симлинки:'],
            ['symlinksOnly', 'Только симлинки:']
        ];
        
        let colorButtons = {};
        let row = 0;
        for (let [key, label] of colors) {
            grid.attach(new Gtk.Label({ label: label, halign: Gtk.Align.START }), 0, row, 1, 1);
            let btn = new Gtk.ColorButton();
            let rgba = new Gdk.RGBA();
            if (rgba.parse(this.settings.colors[key])) btn.set_rgba(rgba);
            colorButtons[key] = btn;
            grid.attach(btn, 1, row, 1, 1);
            row++;
        }
        
        // Настройка размера превью
        grid.attach(new Gtk.Label({ label: "Размер превью (Visual):", halign: Gtk.Align.START }), 0, row, 1, 1);
        let sizeSpin = Gtk.SpinButton.new_with_range(1, 1024, 1);
        sizeSpin.set_value(this.settings.visualPreviewSize);
        grid.attach(sizeSpin, 1, row, 1, 1);
        row++;
        
        content.pack_start(grid, false, false, 0);
        dialog.show_all();
        
        if (dialog.run() === Gtk.ResponseType.OK) {
            // 1. Сохраняем цвета
            for (let key in colorButtons) {
                let rgba = colorButtons[key].get_rgba();
                let r = Math.round(rgba.red * 255).toString(16).padStart(2, '0');
                let g = Math.round(rgba.green * 255).toString(16).padStart(2, '0');
                let b = Math.round(rgba.blue * 255).toString(16).padStart(2, '0');
                this.settings.colors[key] = '#' + r + g + b;
            }
            
            // 2. Сохраняем размер превью
            this.settings.visualPreviewSize = sizeSpin.get_value_as_int();
            
            // 3. Записываем настройки на диск
            this.settings.save();
            
            // 4. Обновляем интерфейс
            this.refreshVisualSizes();           // Обновляем список в ComboBox
            this.rebuildComparisonAsync(null);   // Перекрашиваем левую таблицу (из-за новых цветов)
            
            if (this.currentSelectedIcon) {
                this.updateVisualPixbufs();      // Если значок выбран, перерисовываем его превью
            }
        }
        dialog.destroy();
    }

    renderChips() {
        let children = this.chipsBox.get_children();
        for (let c of children) this.chipsBox.remove(c);

        for (let t of this.loadedThemes) {
            let chip = new Gtk.Frame();
            let chipBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 2, margin: 2 });
            
            // Чекбокс
            let chk = new Gtk.CheckButton({ active: t.checked });
            chk.connect('toggled', async () => { 
                t.checked = chk.get_active(); 
                await this.rebuildComparisonAsync(null); 
            });
            chipBox.pack_start(chk, false, false, 0);
            
            // Звездочка
            if (t.isMain) {
                let star = new Gtk.Label();
                star.set_markup("<span color='#E5A500'><b>★</b></span>");
                star.set_tooltip_text("Главная тема");
                chipBox.pack_start(star, false, false, 0);
            }
            
            // Название
            let lbl = new Gtk.Label({ label: t.name });
            chipBox.pack_start(lbl, false, false, 0);
            
            // Меню
            let menuBtn = new Gtk.MenuButton();
            menuBtn.set_relief(Gtk.ReliefStyle.NONE);
            try { menuBtn.set_image(Gtk.Image.new_from_icon_name('open-menu-symbolic', Gtk.IconSize.BUTTON)); } catch(e) { menuBtn.set_label('\u2630'); }

            let menu = new Gtk.Menu();
            let itDir = new Gtk.MenuItem({ label: 'Открыть каталог' });
            itDir.connect('activate', () => openPathWithDefault(t.themeDir));
            menu.append(itDir);

            // НОВЫЙ ПУНКТ: Перезагрузить
            let itReload = new Gtk.MenuItem({ label: 'Перезагрузить тему' });
            itReload.connect('activate', async () => {
                // Очищаем кэш в памяти, чтобы принудительно перечитать с диска
                t.isLoaded = false; 
                t.icons.clear();
                t.directories = [];
                t.dirInfo.clear();
                
                let progress = new ProgressDialog(this.window, 'Перезагрузка', `Перезагрузка ${t.name}...`);
                await t.load(progress);
                progress.close();
                
                this.rebuildComparisonAsync(null);
                this.populateToolsMasterStore();
                
                if (this.theme === t) {
                    await this.loadThemeData(t.indexPath, true);
                }
            });
            menu.append(itReload);
            
            let itMain = new Gtk.MenuItem({ label: 'Сделать главной' });
            itMain.set_sensitive(!t.isMain);
            itMain.connect('activate', () => this.setMainTheme(t));
            menu.append(itMain);

            menu.show_all();
            menuBtn.set_popup(menu);
            chipBox.pack_start(menuBtn, false, false, 0);

            // Кнопка удаления
            let btnX = new Gtk.Button({ label: "×", relief: Gtk.ReliefStyle.NONE });
            btnX.get_style_context().add_class("circular");
            btnX.connect('clicked', () => {
                this.loadedThemes = this.loadedThemes.filter(x => x !== t);
                this.renderChips();
                this.rebuildComparisonAsync();
            });
            chipBox.pack_start(btnX, false, false, 0);
            
            chip.add(chipBox);
            this.chipsBox.pack_start(chip, false, false, 0);
        }
        this.chipsBox.show_all();
        this.refreshVisualSizes();
    }

    refreshVisualSizes() {
        if (!this.visualSizeCombo) return;
        this.isUpdatingVisual = true;
        
        this.visualSizeCombo.remove_all();
        let sizes = new Set();
        
        // Собираем размеры из всех отмеченных тем
        for (let t of this.loadedThemes) {
            if (t.checked) {
                for (let [, info] of t.dirInfo) {
                    if (info.size) sizes.add(info.size);
                }
            }
        }
        
        let sorted = Array.from(sizes).sort((a,b) => a-b);
        for (let s of sorted) {
            this.visualSizeCombo.append_text(s.toString());
        }
        
        // Устанавливаем значение из настроек (даже если его нет в списке, оно применится)
        this.visualSizeCombo.get_child().set_text(this.settings.visualPreviewSize.toString());
        this.isUpdatingVisual = false;
    }

    setMainTheme(theme) {
        // Снимаем флаг "главной" со всех остальных в РЕАЛЬНОМ списке тем
        for (let t of this.loadedThemes) {
            t.isMain = (t === theme);
            if (t.isMain) t.checked = true; // Главная тема обязательно участвует в сравнении
        }
        
        // Сохраняем в настройки
        this.settings.mainThemePath = theme.indexPath;
        this.settings.save();
        
        // Перерисовываем чипсы (обновляем звездочку) и пересобираем сравнение
        this.renderChips();
        this.rebuildComparisonAsync();

        // Переключаемся на вкладку "Редактор темы" (индекс 1)
        this.notebook.set_current_page(1);
        
        // Загружаем данные темы в редактор
        this.loadThemeData(theme.indexPath).catch(e => {
            print("Ошибка загрузки темы в редактор: " + e.message);
        });
    }

    buildThemeEditorTab() {
        this.isUpdatingPreview = false;
        let paned = new Gtk.Paned({ orientation: Gtk.Orientation.HORIZONTAL, wide_handle: true });

        // ================= ЛЕВАЯ ПАНЕЛЬ =================
        let leftMainWindowBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 5 });

        // --- Блок 2: Метаданные (Рамка наверху) ---
        let frameMainParams = new Gtk.Frame({ label: "Основные параметры", margin_bottom: 5 });
        let mainParamsBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10, margin: 5 });
        
        let coreGrid = new Gtk.Grid({ row_spacing: 5, column_spacing: 5, hexpand: true });
        
        this.nameEntry = new Gtk.Entry();
        this.commentEntry = new Gtk.Entry();
        this.exampleEntry = new Gtk.Entry();
        
        this.nameEntry.connect('focus-out-event', () => { this.updateIconThemeKey("Name", this.nameEntry.get_text()); return false; });
        this.commentEntry.connect('focus-out-event', () => { this.updateIconThemeKey("Comment", this.commentEntry.get_text()); return false; });
        this.exampleEntry.connect('focus-out-event', () => { this.updateIconThemeKey("Example", this.exampleEntry.get_text()); return false; });
        this.exampleEntry.connect('changed', () => { this.updateExamplePreview(); });

        coreGrid.attach(new Gtk.Label({ label: "Name:", halign: Gtk.Align.START }), 0, 0, 1, 1); 
        coreGrid.attach(this.nameEntry, 1, 0, 1, 1);
        coreGrid.attach(new Gtk.Label({ label: "Comment:", halign: Gtk.Align.START }), 0, 1, 1, 1); 
        coreGrid.attach(this.commentEntry, 1, 1, 1, 1);
        coreGrid.attach(new Gtk.Label({ label: "Example:", halign: Gtk.Align.START }), 0, 2, 1, 1); 
        coreGrid.attach(this.exampleEntry, 1, 2, 1, 1);
        coreGrid.attach(new Gtk.Label({ label: "Предпросмотр:", halign: Gtk.Align.START }), 0, 3, 1, 1); 
        
        this.previewSizeCombo = new Gtk.ComboBoxText({ hexpand: true });
        this.previewSizeCombo.connect('changed', () => {
            if (this.isUpdatingPreview) return;
            let name = this.exampleEntry.get_text().trim();
            let dot = name.lastIndexOf('.');
            if (dot > 0) name = name.substring(0, dot);
            let size = parseInt(this.previewSizeCombo.get_active_text()) || 0;
            this.loadExampleImage(name, size);
        });
        coreGrid.attach(this.previewSizeCombo, 1, 3, 1, 1);

        this.btnLocalization = new Gtk.Button({ label: "Локализация...", image: Gtk.Image.new_from_icon_name("preferences-desktop-locale-symbolic", Gtk.IconSize.BUTTON), always_show_image: true });
        this.btnLocalization.connect('clicked', () => this.showLocalizationDialog());

        this.btnInherits = new Gtk.Button({ label: "Изменить Inherits...", tooltip_text: "Текущее: не задано" });
        this.btnDirectories = new Gtk.Button({ label: "Изменить Directories...", tooltip_text: "Текущее: не задано" });

        this.btnInherits.connect('clicked', () => {
            this.showListEditorDialog("Inherits", this.theme.inherits || "", (newVal) => {
                this.updateIconThemeKey("Inherits", newVal);
            });
        });
        this.btnDirectories.connect('clicked', () => {
            this.showListEditorDialog("Directories", (this.theme.directories || []).join(','), (newVal) => {
                this.updateIconThemeKey("Directories", newVal);
            });
        });

        coreGrid.attach(this.btnLocalization, 0, 4, 2, 1);
        coreGrid.attach(this.btnInherits, 0, 5, 2, 1);
        coreGrid.attach(this.btnDirectories, 0, 6, 2, 1);

        let previewBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, valign: Gtk.Align.CENTER });
        this.exampleImage = new Gtk.Image();
        this.exampleImage.set_size_request(128, 128);
        previewBox.pack_start(this.exampleImage, false, false, 0);

        mainParamsBox.pack_start(coreGrid, true, true, 0);
        mainParamsBox.pack_start(previewBox, false, false, 0);
        
        frameMainParams.add(mainParamsBox);
        leftMainWindowBox.pack_start(frameMainParams, false, false, 0);

        // --- Блок 1: Дерево каталогов и их свойства (в рамке) ---
        let frameDirs = new Gtk.Frame({ label: "Каталоги (index.theme)" });
        let dirsVBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 5 });
        
        let innerPaned = new Gtk.Paned({ orientation: Gtk.Orientation.VERTICAL, wide_handle: true });

        this.dirStore = new Gtk.ListStore();
        // Добавлен 4-й тип (Проблема)
        this.dirStore.set_column_types([GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_INT, GObject.TYPE_STRING]);
        this.dirView = new Gtk.TreeView({ model: this.dirStore, headers_visible: true });
        
        // Обработчик выбора каталога (одинарный клик)
        this.dirView.get_selection().connect('changed', () => {
            let [ok, model, iter] = this.dirView.get_selection().get_selected();
            if (ok && iter) {
                let dirName = model.get_value(iter, 0);
                this.showDirectoryParams(dirName);
            } else {
                this.currentSelectedDir = null;
                this.clearParamsUI();
                this.lblCurrentDir.set_markup("<i>Выберите каталог в списке выше</i>");
                this.addParamBtn.set_sensitive(false);
                this.btnDeleteDir.set_sensitive(false);
                this.btnFix.set_sensitive(false);
            }
        });

        // Обработчик двойного клика (выделение секции в тексте)
        this.dirView.connect('row-activated', (treeView, path, column) => {
            let model = treeView.get_model();
            let [success, iter] = model.get_iter(path); 
            if (success && iter) {
                let dirName = model.get_value(iter, 0);
                this.selectSectionInText(dirName);
            }
        });

        let r1 = new Gtk.CellRendererText();
        let c1 = new Gtk.TreeViewColumn({ title: "Путь" });
        c1.pack_start(r1, true); c1.add_attribute(r1, 'text', 0);
        c1.set_sort_column_id(0);
        c1.set_expand(true);      // Левая колонка растягивается
        c1.set_resizable(true);
        this.dirView.append_column(c1);

        let r2 = new Gtk.CellRendererText();
        let c2 = new Gtk.TreeViewColumn({ title: "Контекст" });
        c2.pack_start(r2, true); c2.add_attribute(r2, 'text', 1);
        c2.set_sort_column_id(1);
        c2.set_expand(false);
        c2.set_resizable(true);
        this.dirView.append_column(c2);

        let r3 = new Gtk.CellRendererText();
        let c3 = new Gtk.TreeViewColumn({ title: "Размер" });
        c3.pack_start(r3, true); c3.add_attribute(r3, 'text', 2);
        c3.set_sort_column_id(2);
        c3.set_expand(false);
        c3.set_resizable(true);
        this.dirView.append_column(c3);

        let r4 = new Gtk.CellRendererText();
        let c4 = new Gtk.TreeViewColumn({ title: "Проблемы" });
        c4.pack_start(r4, true); c4.add_attribute(r4, 'text', 3);
        c4.set_sort_column_id(3);
        c4.set_expand(false);
        c4.set_resizable(true);
        this.dirView.append_column(c4);

        let scrollDirs = new Gtk.ScrolledWindow({ vexpand: true });
        scrollDirs.add(this.dirView);
        innerPaned.pack1(scrollDirs, true, false);

        let formBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 5 });
        this.lblCurrentDir = new Gtk.Label({ label: "<i>Выберите каталог в списке выше</i>", use_markup: true, halign: Gtk.Align.START });
        formBox.pack_start(this.lblCurrentDir, false, false, 0);
        
        this.paramsBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5 });
        formBox.pack_start(this.paramsBox, false, false, 0);
        
        let paramActionsBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        this.addParamBtn = new Gtk.Button({ label: "+ Добавить параметр", sensitive: false, image: Gtk.Image.new_from_icon_name("list-add-symbolic", Gtk.IconSize.BUTTON), always_show_image: true });
        this.addMenu = new Gtk.Menu();
        this.stdKeys = ["Context", "Type", "Scale", "MinSize", "MaxSize", "Threshold"];
        paramActionsBox.pack_start(this.addParamBtn, true, true, 0);

        let btnSave = new Gtk.Button({ label: "Сохранить изменения", image: Gtk.Image.new_from_icon_name("document-save-symbolic", Gtk.IconSize.BUTTON), always_show_image: true });
        btnSave.get_style_context().add_class("suggested-action");
        btnSave.connect('clicked', () => this.saveChanges());
        paramActionsBox.pack_start(btnSave, true, true, 0);
        formBox.pack_start(paramActionsBox, false, false, 0);

        this.btnFix = new Gtk.Button({ label: "Исправить проблему", sensitive: false, image: Gtk.Image.new_from_icon_name("dialog-warning-symbolic", Gtk.IconSize.BUTTON), always_show_image: true });
        this.fixMenu = new Gtk.Menu();
        this.btnFix.connect('clicked', (btn) => {
            if (this.fixMenu.get_children().length > 0) {
                this.fixMenu.show_all();
                this.fixMenu.popup_at_widget(btn, Gdk.Gravity.SOUTH_WEST, Gdk.Gravity.NORTH_WEST, null);
            }
        });
        formBox.pack_start(this.btnFix, false, false, 0);

        let actionBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        let btnCreateDir = new Gtk.Button({ label: "Создать каталог", image: Gtk.Image.new_from_icon_name("folder-new-symbolic", Gtk.IconSize.BUTTON), always_show_image: true });
        btnCreateDir.connect('clicked', () => this.showCreateDirDialog());
        actionBox.pack_start(btnCreateDir, true, true, 0);

        this.btnDeleteDir = new Gtk.Button({ label: "Удалить каталог", sensitive: false, image: Gtk.Image.new_from_icon_name("user-trash-symbolic", Gtk.IconSize.BUTTON), always_show_image: true });
        this.btnDeleteDir.get_style_context().add_class("destructive-action");
        this.btnDeleteDir.connect('clicked', () => this.deleteDirectory(this.currentSelectedDir));
        actionBox.pack_start(this.btnDeleteDir, true, true, 0);
        formBox.pack_start(actionBox, false, false, 0);

        this.addParamBtn.connect('clicked', (btn) => {
            if (!this.currentSelectedDir) return;
            let children = this.addMenu.get_children();
            for (let c of children) this.addMenu.remove(c);
            let info = this.theme.dirInfo.get(this.currentSelectedDir);
            let existing = info.rawParams || {};
            let addedAny = false;
            for (let k of this.stdKeys) {
                if (existing[k] === undefined) {
                    let item = new Gtk.MenuItem({ label: k });
                    item.connect('activate', () => this.addParameterToUI(k));
                    this.addMenu.append(item);
                    addedAny = true;
                }
            }
            if (addedAny) {
                this.addMenu.show_all();
                this.addMenu.popup_at_widget(btn, Gdk.Gravity.SOUTH_WEST, Gdk.Gravity.NORTH_WEST, null);
            }
        });

        innerPaned.pack2(formBox, false, false);
        dirsVBox.pack_start(innerPaned, true, true, 0);
        frameDirs.add(dirsVBox);
        leftMainWindowBox.pack_start(frameDirs, true, true, 0);

        let expProblems = new Gtk.Expander({ label: "<b>Проблемы (0)</b>", use_markup: true, expanded: false });
        this.lblProblemsTitle = expProblems;
        let probScroll = new Gtk.ScrolledWindow({ vexpand: true });
        probScroll.set_size_request(-1, 250);
        this.problemsList = new Gtk.ListBox();
        
        this.problemsList.connect('button-press-event', (widget, event) => {
            if (event.get_button()[1] === 3) {
                let row = this.problemsList.get_row_at_y(event.y);
                if (row) {
                    this.problemsList.select_row(row);
                    this.showProblemContextMenu(row, event);
                    return true;
                }
            }
            return false;
        });

        probScroll.add(this.problemsList);
        expProblems.add(probScroll);
        leftMainWindowBox.pack_start(expProblems, false, false, 0);

        paned.pack1(leftMainWindowBox, true, false);

        // ================= ПРАВАЯ ПАНЕЛЬ (Текст) =================
        let rightBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 5 });

        let textToolbar = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        let btnApplyText = new Gtk.Button({ label: "Применить текст к таблице", image: Gtk.Image.new_from_icon_name("view-refresh-symbolic", Gtk.IconSize.BUTTON), always_show_image: true });
        btnApplyText.connect('clicked', () => this.applyTextToUI());
        textToolbar.pack_start(btnApplyText, false, false, 0);

        this.btnSaveFile = new Gtk.Button({ label: "Сохранить на диск", image: Gtk.Image.new_from_icon_name("document-save-symbolic", Gtk.IconSize.BUTTON), always_show_image: true, sensitive: false });
        this.btnSaveFile.connect('clicked', () => this.saveFileToDisk());
        textToolbar.pack_end(this.btnSaveFile, false, false, 0);

        this.btnResetFile = new Gtk.Button({ label: "Сбросить", image: Gtk.Image.new_from_icon_name("edit-undo-symbolic", Gtk.IconSize.BUTTON), always_show_image: true, sensitive: false });
        this.btnResetFile.connect('clicked', () => this.resetFileText());
        textToolbar.pack_end(this.btnResetFile, false, false, 0);
        
        rightBox.pack_start(textToolbar, false, false, 0);

        this.tagTable = new Gtk.TextTagTable();
        this.tagError = new Gtk.TextTag({ name: "error", background: "#ffcccc", foreground: "#990000" });
        this.tagWarn = new Gtk.TextTag({ name: "warn", background: "#ffe8cc", foreground: "#996600" });
        this.tagTable.add(this.tagError);
        this.tagTable.add(this.tagWarn);

        this.textBuffer = new Gtk.TextBuffer({ tag_table: this.tagTable });
        this.ignoreTextChange = false;
        
        this.textBuffer.connect('changed', () => {
            if (this.ignoreTextChange) return;
            this.checkTextModified();
        });

        this.textView = new Gtk.TextView({ monospace: true, wrap_mode: Gtk.WrapMode.NONE, buffer: this.textBuffer });

        let scrollText = new Gtk.ScrolledWindow({ vexpand: true });
        scrollText.add(this.textView);
        rightBox.pack_start(scrollText, true, true, 0);
        paned.pack2(rightBox, true, false);

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { paned.set_position(500); return false; });
        return paned;
    }

    applyTextToUI() {
        let text = this.textBuffer.get_text(this.textBuffer.get_start_iter(), this.textBuffer.get_end_iter(), false);
        
        let lines = text.split('\n');
        let currentSection = '';
        let iniData = {};
        let dirsLine = -1;

        // Парсим текст заново
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (line.startsWith('[') && line.endsWith(']')) {
                currentSection = line.substring(1, line.length - 1);
                if (!iniData[currentSection]) iniData[currentSection] = {};
            } else if (line.includes('=') && currentSection) {
                let eq = line.indexOf('=');
                let k = line.substring(0, eq).trim();
                let v = line.substring(eq + 1).trim();
                iniData[currentSection][k] = v;
                if (currentSection === 'Icon Theme' && k === 'Directories') {
                    dirsLine = i;
                }
            }
        }

        let iconTheme = iniData['Icon Theme'] || {};
        this.theme.iniData = iniData; // <--- СИНХРОНИЗИРУЕМ МОДЕЛЬ
        
        this.theme.name = iconTheme['Name'] || '';
        this.theme.comment = iconTheme['Comment'] || '';
        this.theme.inherits = iconTheme['Inherits'] || '';
        let dirsStr = iconTheme['Directories'] || '';
        this.theme.directories = dirsStr.split(',').map(s => s.trim()).filter(Boolean);

        // Обновляем dirInfo и dirLines
        this.theme.dirInfo.clear();
        this.theme.dirLines.clear();

        for (let dirName of this.theme.directories) {
            let params = iniData[dirName] || {};
            let secLine = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === '[' + dirName + ']') { secLine = i; break; }
            }
            this.theme.dirLines.set(dirName, { dirLine: dirsLine, secLine: secLine });

            this.theme.dirInfo.set(dirName, {
                rawParams: params,
                context: params['Context'] || '',
                size: parseInt(params['Size']) || null,
                scale: parseInt(params['Scale']) || null,
                type: params['Type'] || 'Fixed'
            });
        }

        // Пересчитываем строки для проблем на основе новых данных
        for (let p of this.theme.problems) {
            if (p.dirName && this.theme.dirLines.has(p.dirName)) {
                let l = this.theme.dirLines.get(p.dirName);
                p.line = l.secLine >= 0 ? l.secLine : l.dirLine;
            }
        }

        // Обновляем поля метаданных
        this.nameEntry.set_text(this.theme.name);
        this.commentEntry.set_text(this.theme.comment);
        
        this.exampleEntry.set_text(iconTheme['Example'] || ''); // <--- БЕЗ let
        this.updateExamplePreview();
        
        this.btnInherits.set_tooltip_text("Текущее: " + (this.theme.inherits || "не задано"));
        this.btnDirectories.set_tooltip_text("Текущее: " + (this.theme.directories.join(', ') || "не задано"));

        // Перерисовываем таблицу каталогов
        this.dirStore.clear();
        for (let [dirName, info] of this.theme.dirInfo) {
            let iter = this.dirStore.append();
            let probStr = this.getDirProblemString(dirName);
            this.dirStore.set(iter, [0, 1, 2, 3], [dirName, info.context || "", info.size || 0, probStr]);
        }

        // Если был выбран каталог, обновляем форму
        if (this.currentSelectedDir && this.theme.dirInfo.has(this.currentSelectedDir)) {
            this.showDirectoryParams(this.currentSelectedDir);
        } else {
            this.clearParamsUI();
            this.lblCurrentDir.set_markup("<i>Выберите каталог в списке выше</i>");
            this.addParamBtn.set_sensitive(false);
        }
        
        this.applyProblemTags(); // Перекрашиваем текст заново
        print("Текст успешно применен к левой панели.");
            // Обновляем подсказки для кнопок
        this.btnInherits.set_tooltip_text("Текущее: " + (this.theme.inherits || "не задано"));
        this.btnDirectories.set_tooltip_text("Текущее: " + (this.theme.directories.join(', ') || "не задано"));
        
        this.nameEntry.set_text(this.theme.name || "");
        this.commentEntry.set_text(this.theme.comment || "");
    }

    checkTextModified() {
        if (!this.originalFileText) {
            this.btnSaveFile.set_sensitive(false);
            this.btnResetFile.set_sensitive(false);
            return;
        }
        
        let currentText = this.textBuffer.get_text(this.textBuffer.get_start_iter(), this.textBuffer.get_end_iter(), false);
        // Нормализуем переводы строк для корректного сравнения
        let currentNorm = currentText.replace(/\r\n/g, '\n');
        let originalNorm = this.originalFileText.replace(/\r\n/g, '\n');
        
        let isModified = (currentNorm !== originalNorm);
        
        this.btnSaveFile.set_sensitive(isModified);
        this.btnResetFile.set_sensitive(isModified);
    }

    resetFileText() {
        if (!this.originalFileText) return;
        
        this.ignoreTextChange = true;
        this.textBuffer.set_text(this.originalFileText, -1);
        this.ignoreTextChange = false;
        
        this.applyTextToUI();
        this.checkTextModified();
    }

    saveFileToDisk() {
        let text = this.textBuffer.get_text(this.textBuffer.get_start_iter(), this.textBuffer.get_end_iter(), false);
        
        // Принудительно делаем LF (Unix-переводы строк), чтобы не ломать кэш
        text = text.replace(/\r\n/g, '\n');
        
        try {
            let file = Gio.File.new_for_path(this.theme.indexPath);
            file.replace_contents(
                text, 
                null, 
                false, 
                Gio.FileCreateFlags.REPLACE_DESTINATION, 
                null
            );
            
            // Обновляем эталонное значение
            this.originalFileText = text;
            this.checkTextModified();
            
            // Показываем сообщение об успехе
            let msg = new Gtk.MessageDialog({
                transient_for: this.window,
                modal: true,
                message_type: Gtk.MessageType.INFO,
                buttons: Gtk.ButtonsType.OK,
                text: "Файл index.theme успешно сохранен!"
            });
            msg.run();
            msg.destroy();
            
        } catch (e) {
            let err = new Gtk.MessageDialog({
                transient_for: this.window,
                modal: true,
                message_type: Gtk.MessageType.ERROR,
                buttons: Gtk.ButtonsType.OK,
                text: "Ошибка сохранения: " + e.message
            });
            err.run();
            err.destroy();
        }
    }

    saveFileToDiskSilent() {
        let text = this.textBuffer.get_text(this.textBuffer.get_start_iter(), this.textBuffer.get_end_iter(), false);
        text = text.replace(/\r\n/g, '\n');
        try {
            let file = Gio.File.new_for_path(this.theme.indexPath);
            file.replace_contents(text, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            this.originalFileText = text;
            this.checkTextModified();
            return true;
        } catch (e) { return false; }
    }

    showCreateDirDialog(dirToEdit = null) {
        let dialog = new Gtk.Dialog({
            title: dirToEdit ? "Добавить секцию" : "Создать каталог",
            transient_for: this.window, modal: true, default_width: 450
        });
        dialog.add_button("Отмена", Gtk.ResponseType.CANCEL);
        dialog.add_button("Создать", Gtk.ResponseType.OK);
        
        let content = dialog.get_content_area();
        content.set_spacing(10);
        content.set_margin_start(10); content.set_margin_end(10);
        content.set_margin_top(10); content.set_margin_bottom(10);
        
        let grid = new Gtk.Grid({ row_spacing: 5, column_spacing: 5 });
        let row = 0;
        
        grid.attach(new Gtk.Label({ label: "Контекст (Context):", halign: Gtk.Align.START }), 0, row, 1, 1);
        let ctxCombo = Gtk.ComboBoxText.new_with_entry();
        this.theme.standardContexts.forEach(c => ctxCombo.append_text(c));
        ctxCombo.set_active(0);
        grid.attach(ctxCombo, 1, row, 1, 1);
        row++;
        
        grid.attach(new Gtk.Label({ label: "Размер (Size):", halign: Gtk.Align.START }), 0, row, 1, 1);
        let sizeCombo = Gtk.ComboBoxText.new_with_entry();
        let sizes = new Set();
        for (let [dirName, info] of this.theme.dirInfo) {
            if (info.size) sizes.add(String(info.size));
            if (dirName.includes('scalable')) sizes.add('scalable');
        }
        let sortedSizes = Array.from(sizes).sort((a, b) => {
            if (a === 'scalable') return 1;
            if (b === 'scalable') return -1;
            return parseInt(a) - parseInt(b);
        });
        if (sortedSizes.length === 0) sortedSizes = ["16", "22", "24", "32", "48"];
        sortedSizes.forEach(s => sizeCombo.append_text(s));
        sizeCombo.set_active(0);
        grid.attach(sizeCombo, 1, row, 1, 1);
        row++;
        
        grid.attach(new Gtk.Label({ label: "Масштаб (Scale):", halign: Gtk.Align.START }), 0, row, 1, 1);
        let scaleCombo = Gtk.ComboBoxText.new_with_entry();
        ["1", "2", "3"].forEach(s => scaleCombo.append_text(s));
        scaleCombo.set_active(0);
        grid.attach(scaleCombo, 1, row, 1, 1);
        row++;
        
        grid.attach(new Gtk.Label({ label: "Вариант (папка):", halign: Gtk.Align.START }), 0, row, 1, 1);
        let variantEntry = new Gtk.Entry({ placeholder_text: "например, symbolic" });
        grid.attach(variantEntry, 1, row, 1, 1);
        row++;
        
        grid.attach(new Gtk.Label({ label: "Тип (Type):", halign: Gtk.Align.START }), 0, row, 1, 1);
        let typeCombo = new Gtk.ComboBoxText();
        ["", "Fixed", "Scalable", "Threshold"].forEach(t => typeCombo.append_text(t));
        typeCombo.set_active(0);
        grid.attach(typeCombo, 1, row, 1, 1);
        row++;
        
        grid.attach(new Gtk.Label({ label: "Итоговый путь:", halign: Gtk.Align.START }), 0, row, 1, 1);
        let pathEntry = new Gtk.Entry({ text: dirToEdit || "" });
        grid.attach(pathEntry, 1, row, 1, 1);
        row++;
        
        content.pack_start(grid, false, false, 0);
        
        let userEditedPath = (dirToEdit !== null);
        let isUpdatingPath = false;
        
        pathEntry.connect('changed', () => { if (!isUpdatingPath) userEditedPath = true; });
        
        let updatePath = () => {
            if (userEditedPath) return;
            isUpdatingPath = true;
            
            let ctx = ctxCombo.get_active_text() || "Actions";
            let folder = this.theme.contextMap.get(ctx) || ctx.toLowerCase();
            let size = sizeCombo.get_active_text() || "";
            let scale = scaleCombo.get_active_text() || "1";
            let variant = variantEntry.get_text().trim();
            
            let parts = [folder];
            if (scale !== "1" && scale !== "") parts.push("@" + scale);
            if (size) parts.push(size);
            if (variant) parts.push(variant);
            
            pathEntry.set_text(parts.join('/'));
            isUpdatingPath = false;
        };
        
        // Автоматическая подстановка параметров, если мы исправляем секцию
        if (dirToEdit) {
            let parts = dirToEdit.split('/');
            let sizeIdx = -1;
            for (let i = parts.length - 1; i >= 0; i--) {
                if (!isNaN(parseInt(parts[i])) || parts[i] === 'scalable') {
                    sizeIdx = i;
                    break;
                }
            }
            if (sizeIdx !== -1) {
                let sizeStr = parts[sizeIdx];
                let idx = sortedSizes.indexOf(sizeStr);
                if (idx >= 0) sizeCombo.set_active(idx);
                else sizeCombo.get_child().set_text(sizeStr);
                
                let ctxName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
                if (this.theme.standardContexts.includes(ctxName)) {
                    ctxCombo.get_child().set_text(ctxName);
                }
            }
        } else {
            ctxCombo.connect('changed', updatePath);
            sizeCombo.connect('changed', updatePath);
            scaleCombo.connect('changed', updatePath);
            variantEntry.connect('changed', updatePath);
            updatePath();
        }
        
        dialog.show_all();
        let resp = dialog.run();
        
        if (resp === Gtk.ResponseType.OK) {
            let dirName = pathEntry.get_text().trim();
            if (dirName) {
                this.createDirectory(dirName, ctxCombo.get_active_text(), sizeCombo.get_active_text(), scaleCombo.get_active_text(), typeCombo.get_active_text());
            }
        }
        dialog.destroy();
    }

    createDirectory(dirName, context, size, scale, type) {
        // 1. Физически создаем папку
        let absPath = GLib.build_filenamev([this.theme.themeDir, dirName]);
        try {
            Gio.File.new_for_path(absPath).make_directory_with_parents(null);
        } catch (e) {
            print("Ошибка создания папки: " + e.message);
        }

        // 2. Правим текст (добавляем в Directories и создаем секцию)
        let text = this.textBuffer.get_text(this.textBuffer.get_start_iter(), this.textBuffer.get_end_iter(), false);
        let lines = text.split('\n');
        let newLines = [];
        let dirsFound = false;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (line.startsWith('Directories=')) {
                let dirs = line.substring(12).split(',').map(s => s.trim()).filter(Boolean);
                if (!dirs.includes(dirName)) dirs.push(dirName);
                newLines.push('Directories=' + dirs.join(','));
                dirsFound = true;
            } else {
                newLines.push(lines[i]);
            }
        }
        
        if (!dirsFound) {
            newLines.unshift('Directories=' + dirName);
        }

        // Добавляем новую секцию в самый конец
        newLines.push('');
        newLines.push(`[${dirName}]`);
        newLines.push(`Context=${context}`);
        if (size && size !== "") newLines.push(`Size=${size}`);
        if (scale && scale !== "1") newLines.push(`Scale=${scale}`);
        if (type && type !== "") newLines.push(`Type=${type}`); // <-- Проверка на пустоту

        this.textBuffer.set_text(newLines.join('\n'), -1);
        this.applyTextToUI(); // Перечитываем и обновляем левую панель
        print(`Каталог ${dirName} создан и добавлен в index.theme.`);
    }

    // Заглушка для логики исправления
    fixProblem(problem) {
        if (problem.probType === 'missing_disk') {
            let dlg = new Gtk.MessageDialog({
                transient_for: this.window, modal: true, message_type: Gtk.MessageType.QUESTION, buttons: Gtk.ButtonsType.YES_NO,
                text: `Создать пустой каталог "${problem.dirName}" на диске?`
            });
            if (dlg.run() === Gtk.ResponseType.YES) {
                let absPath = GLib.build_filenamev([this.theme.themeDir, problem.dirName]);
                try {
                    Gio.File.new_for_path(absPath).make_directory_with_parents(null);
                    this.loadThemeData(this.theme.themePath, true);
                } catch (e) { print("Ошибка: " + e.message); }
            }
            dlg.destroy();
        } 
        else if (problem.probType === 'missing_directories') {
            let dlg = new Gtk.MessageDialog({
                transient_for: this.window, modal: true, message_type: Gtk.MessageType.QUESTION, buttons: Gtk.ButtonsType.YES_NO,
                text: `Внести каталог "${problem.dirName}" в список Directories?`
            });
            if (dlg.run() === Gtk.ResponseType.YES) {
                if (!this.theme.directories.includes(problem.dirName)) {
                    this.theme.directories.push(problem.dirName);
                    this.updateIconThemeKey("Directories", this.theme.directories.join(','));
                    this.saveFileToDiskSilent(); // Сохраняем изменения
                    this.loadThemeData(this.theme.themePath, true);
                }
            }
            dlg.destroy();
        }
        else if (problem.probType === 'missing_section') {
            this.showCreateDirDialog(problem.dirName);
        }
        else if (problem.probType === 'spaces') {
            let dlg = new Gtk.MessageDialog({
                transient_for: this.window, modal: true, message_type: Gtk.MessageType.INFO, buttons: Gtk.ButtonsType.OK,
                text: "Автоисправление пробелов пока не реализовано."
            });
            dlg.run(); dlg.destroy();
        }
        else if (problem.probType === 'deadlink') {
            this.showDeadlinksDialog(problem.dirName);
        }
    }

    // Удаление каталога с подтверждением
    deleteDirectory(dirName) {
        let dialog = new Gtk.MessageDialog({
            transient_for: this.window,
            modal: true,
            message_type: Gtk.MessageType.QUESTION,
            buttons: Gtk.ButtonsType.YES_NO,
            text: `Удалить каталог "${dirName}"?`,
            secondary_text: "Он будет удален из списка Directories и секций в тексте. Физическая папка на диске не удаляется."
        });

        if (dialog.run() === Gtk.ResponseType.YES) {
            let text = this.textBuffer.get_text(this.textBuffer.get_start_iter(), this.textBuffer.get_end_iter(), false);
            let lines = text.split('\n');
            let newLines = [];
            let inSection = false;
            let sectionName = '[' + dirName + ']';

            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                
                // Удаляем из списка Directories
                if (line.startsWith('Directories=')) {
                    let dirs = line.substring(12).split(',').map(s => s.trim()).filter(d => d !== dirName && d !== '');
                    newLines.push('Directories=' + dirs.join(','));
                    continue;
                }

                // Удаляем саму секцию
                if (line === sectionName) {
                    inSection = true;
                    continue;
                }
                if (inSection && line.startsWith('[') && line.endsWith(']')) {
                    inSection = false;
                }
                
                if (!inSection) {
                    newLines.push(lines[i]);
                }
            }

            this.textBuffer.set_text(newLines.join('\n'), -1);
            this.applyTextToUI(); // Обновляем левую панель
            print(`Каталог ${dirName} удален из текста.`);
        }
        dialog.destroy();
    }

    // Выделение проблем в тексте
    applyProblemTags() {
        let start = this.textBuffer.get_start_iter();
        let end = this.textBuffer.get_end_iter();
        this.textBuffer.remove_all_tags(start, end);

        for (let p of this.theme.problems) {
            if (p.line !== undefined && p.line >= 0) {
                try {
                    let iterStart = this.textBuffer.get_iter_at_line(p.line);
                    let iterEnd = this.textBuffer.get_iter_at_line(Math.min(p.line + 1, this.textBuffer.get_line_count()));
                    let tag = p.type === 'error' ? this.tagError : this.tagWarn;
                    this.textBuffer.apply_tag(tag, iterStart, iterEnd);
                } catch (e) {}
            }
        }
    }

    showProblemContextMenu(row, event) {
        let menu = new Gtk.Menu();
        
        // Пункт "Найти цель" показываем только для битых симлинков
        if (row._filePath && row._targetName) {
            let itemFind = new Gtk.MenuItem({ label: `Найти замену для "${row._targetName}"` });
            itemFind.connect('activate', () => {
                // Здесь будет логика поиска (Алгоритм приоритета: Цель -> Похожие на цель -> Имя симлинка)
                print(`Ищем файл для цели: ${row._targetName} (симлинк: ${row._filePath})`);
            });
            menu.append(itemFind);
            
            let itemDel = new Gtk.MenuItem({ label: "Удалить битый симлинк" });
            menu.append(itemDel);
        }
        
        let itemIgnore = new Gtk.MenuItem({ label: "Игнорировать (заглушка)" });
        menu.append(itemIgnore);

        menu.show_all();
        menu.popup_at_pointer(event);
    }

    clearParamsUI() {
        let children = this.paramsBox.get_children();
        for (let c of children) this.paramsBox.remove(c);
    }

    getDirProblemString(dirName) {
        let dirProblems = this.theme.problems.filter(p => p.dirName === dirName);
        if (dirProblems.length === 0) return "";
        
        let types = new Set();
        for (let p of dirProblems) {
            if (p.probType === 'deadlink') types.add("Битые симлинки");
            else if (p.probType === 'spaces' || p.probType === 'spaces_file') types.add("Пробелы");
            else if (p.probType === 'missing_disk') types.add("Нет на диске");
            else if (p.probType === 'missing_directories') types.add("Нет в Directories");
            else if (p.probType === 'missing_section') types.add("Нет секции");
            else types.add("Другое");
        }
        
        let arr = Array.from(types);
        if (arr.length === 1 && dirProblems.length === 1) {
            if (arr[0] === "Битые симлинки") return "Битый симлинк";
            return arr[0];
        }
        return arr.join(", ");
    }

    showDeadlinksDialog(dirName) {
        let dlg = new DeadlinksDialog(this.window, this, dirName);
        dlg.run();
    }

    showDirectoryParams(dirName) {
        this.currentSelectedDir = dirName;
        this.clearParamsUI();
        this.addParamBtn.set_sensitive(true);
        this.btnDeleteDir.set_sensitive(true); // Включаем сразу
        this.lblCurrentDir.set_markup(`<b>Параметры: ${dirName}</b>`);
        
        let info = this.theme.dirInfo.get(dirName);
        if (!info) return;

        let params = info.rawParams || {};
        if (!params['Size']) params['Size'] = info.size || '';

        for (let key in params) {
            this.createParamRow(key, params[key]);
        }
        
        this.paramsBox.show_all();

        // --- Проверяем проблемы каталога ---
        let dirProblems = this.theme.problems.filter(p => p.dirName === dirName);
        
        if (dirProblems.length > 0) {
            this.btnDeleteDir.set_sensitive(true);
            
            let children = this.fixMenu.get_children();
            for (let c of children) this.fixMenu.remove(c);

            // Группируем проблемы по типу
            let uniqueTypes = new Set();
            for (let p of dirProblems) {
                uniqueTypes.add(p.probType || 'unknown');
            }

            for (let type of uniqueTypes) {
                let probsOfType = dirProblems.filter(p => (p.probType || 'unknown') === type);
                let label = "";
                
                if (type === 'deadlink') label = `Битые симлинки (${probsOfType.length})`;
                else if (type === 'spaces' || type === 'spaces_file') label = `Пробелы в именах (${probsOfType.length})`;
                else label = probsOfType[0].msg; // Для одиночных проблем показываем текст ошибки

                let item = new Gtk.MenuItem({ label: label });
                item.connect('activate', () => {
                    if (type === 'deadlink') this.showDeadlinksDialog(dirName);
                    else this.fixProblem(probsOfType[0]); // Передаем первую проблему из группы
                });
                this.fixMenu.append(item);
            }
            
            this.fixMenu.show_all();
            this.btnFix.set_sensitive(true);
        } else {
            this.btnDeleteDir.set_sensitive(true);
            this.btnFix.set_sensitive(false);
        }
    }

    selectSectionInText(dirName) {
        let text = this.textBuffer.get_text(
            this.textBuffer.get_start_iter(), 
            this.textBuffer.get_end_iter(), 
            false
        );
        let lines = text.split('\n');
        let startLine = -1;
        let endLine = -1;
        let startMatch = '[' + dirName + ']';

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === startMatch) {
                startLine = i;
            } else if (startLine !== -1 && lines[i].trim().startsWith('[') && lines[i].trim().endsWith(']')) {
                endLine = i;
                break; // Нашли начало следующей секции, значит текущая закончилась
            }
        }

        if (startLine !== -1) {
            if (endLine === -1) endLine = lines.length; // Если это последняя секция в файле

            let iterStart = this.textBuffer.get_iter_at_line(startLine);
            let iterEnd = this.textBuffer.get_iter_at_line(endLine);
            
            // Выделяем текст
            this.textBuffer.select_range(iterStart, iterEnd);
            // Прокручиваем к началу
            this.textView.scroll_to_iter(iterStart, 0.2, false, 0, 0);
            // Даем фокус текстовому полю, чтобы выделение было видно
            this.textView.grab_focus();
        }
    }

    createParamRow(key, value) {
        let row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        
        let label = new Gtk.Label({ label: key + ":", width_chars: 10, halign: Gtk.Align.START });
        row.pack_start(label, false, false, 0);

        let input;
        if (key === 'Context') {
            input = Gtk.ComboBoxText.new_with_entry();
            ["Actions", "Applications", "Apps", "Categories", "Devices", "MimeTypes", "Places", "Status"].forEach(t => input.append_text(t));
            input.get_child().set_text(value);
            input.get_child().connect('changed', () => {
                this.theme.dirInfo.get(this.currentSelectedDir).rawParams[key] = input.get_child().get_text();
            });
        } else if (key === 'Type') {
            input = new Gtk.ComboBoxText();
            ["Fixed", "Scalable", "Threshold"].forEach(t => input.append_text(t));
            let idx = ["Fixed", "Scalable", "Threshold"].indexOf(value);
            input.set_active(idx >= 0 ? idx : 0);
            input.connect('changed', () => {
                this.theme.dirInfo.get(this.currentSelectedDir).rawParams[key] = input.get_active_text();
            });
        } else {
            input = new Gtk.Entry({ text: value });
            input.connect('changed', () => {
                this.theme.dirInfo.get(this.currentSelectedDir).rawParams[key] = input.get_text();
            });
        }
        input.set_hexpand(true);
        row.pack_start(input, true, true, 0);

        // Кнопка удаления (кроме Size)
        if (key !== 'Size') {
            let btnDel = new Gtk.Button({ label: "−", tooltip_text: "Удалить параметр" });
            btnDel.connect('clicked', () => {
                delete this.theme.dirInfo.get(this.currentSelectedDir).rawParams[key];
                this.showDirectoryParams(this.currentSelectedDir);
            });
            row.pack_start(btnDel, false, false, 0);
        } else {
            row.pack_start(new Gtk.Label({ label: "   " }), false, false, 0);
        }

        this.paramsBox.pack_start(row, false, false, 0);
    }

    addParameterToUI(key) {
        if (!this.currentSelectedDir) return;
        let info = this.theme.dirInfo.get(this.currentSelectedDir);
        if (info.rawParams[key] === undefined) {
            info.rawParams[key] = "";
            this.showDirectoryParams(this.currentSelectedDir);
        }
    }

    showLocalizationDialog() {
        let dialog = new Gtk.Dialog({
            title: "Локализация",
            transient_for: this.window,
            modal: true,
            default_width: 650,
            default_height: 450
        });
        
        let content = dialog.get_content_area();
        content.set_spacing(8);
        content.set_margin_start(10); content.set_margin_end(10);
        content.set_margin_top(10); content.set_margin_bottom(10);
        
        let store = new Gtk.ListStore();
        store.set_column_types([GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_STRING]);
        
        // Читаем актуальный текст из правой панели
        let text = this.textBuffer.get_text(this.textBuffer.get_start_iter(), this.textBuffer.get_end_iter(), false);
        let lines = text.split('\n');
        let iconTheme = {};
        let inIcon = false;
        for (let line of lines) {
            let l = line.trim();
            if (l === '[Icon Theme]') inIcon = true;
            else if (l.startsWith('[')) inIcon = false;
            else if (inIcon && l.includes('=')) {
                let eq = l.indexOf('=');
                let k = l.substring(0, eq).trim();
                let v = l.substring(eq + 1).trim();
                iconTheme[k] = v;
            }
        }

        let langs = new Set();
        for (let key in iconTheme) {
            let match = key.match(/^(Name|Comment)\[([^\]]+)\]$/);
            if (match) langs.add(match[2]);
        }
        
        for (let lang of langs) {
            let iter = store.append();
            let n = iconTheme['Name[' + lang + ']'] || "";
            let c = iconTheme['Comment[' + lang + ']'] || "";
            store.set(iter, [0, 1, 2], [lang, n, c]);
        }
        
        let view = new Gtk.TreeView({ model: store });
        view.set_grid_lines(Gtk.TreeViewGridLines.HORIZONTAL);
        
        // Колонки
        let rendererLang = new Gtk.CellRendererCombo();
        rendererLang.set_property('editable', true);
        rendererLang.set_property('text-column', 0);
        rendererLang.set_property('has-entry', true);
        let langModel = new Gtk.ListStore();
        langModel.set_column_types([GObject.TYPE_STRING]);
        ["ru", "en", "de", "fr", "es", "it", "uk", "be", "zh_CN", "ja", "pl", "pt", "pt_BR"].forEach(l => {
            let it = langModel.append(); langModel.set(it, [0], [l]);
        });
        rendererLang.set_property('model', langModel);
        rendererLang.connect('edited', (widget, path, newText) => {
            let [s, iter] = store.get_iter_from_string(path);
            if (s) store.set(iter, [0], [newText]);
        });
        let colLang = new Gtk.TreeViewColumn({ title: "Язык (Код)", expand: false, min_width: 100 });
        colLang.pack_start(rendererLang, true); colLang.add_attribute(rendererLang, 'text', 0);
        view.append_column(colLang);
        
        let rendererName = new Gtk.CellRendererText();
        rendererName.set_property('editable', true);
        rendererName.connect('edited', (widget, path, newText) => {
            let [s, iter] = store.get_iter_from_string(path);
            if (s) store.set(iter, [1], [newText]);
        });
        let colName = new Gtk.TreeViewColumn({ title: "Name", expand: true, min_width: 150 });
        colName.pack_start(rendererName, true); colName.add_attribute(rendererName, 'text', 1);
        view.append_column(colName);
        
        let rendererComment = new Gtk.CellRendererText();
        rendererComment.set_property('editable', true);
        rendererComment.connect('edited', (widget, path, newText) => {
            let [s, iter] = store.get_iter_from_string(path);
            if (s) store.set(iter, [2], [newText]);
        });
        let colComment = new Gtk.TreeViewColumn({ title: "Comment", expand: true, min_width: 200 });
        colComment.pack_start(rendererComment, true); colComment.add_attribute(rendererComment, 'text', 2);
        view.append_column(colComment);
        
        let scroll = new Gtk.ScrolledWindow({ vexpand: true });
        scroll.add(view);

        // --- Правая колонка с кнопками ---
        let sideBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5 });
        
        let btnUp = new Gtk.Button({ image: Gtk.Image.new_from_icon_name("go-up-symbolic", Gtk.IconSize.BUTTON), tooltip_text: "Переместить вверх", sensitive: false });
        let btnDown = new Gtk.Button({ image: Gtk.Image.new_from_icon_name("go-down-symbolic", Gtk.IconSize.BUTTON), tooltip_text: "Переместить вниз", sensitive: false });
        let btnAdd = new Gtk.Button({ image: Gtk.Image.new_from_icon_name("list-add-symbolic", Gtk.IconSize.BUTTON), tooltip_text: "Добавить язык" });
        let btnDel = new Gtk.Button({ image: Gtk.Image.new_from_icon_name("user-trash-symbolic", Gtk.IconSize.BUTTON), tooltip_text: "Удалить", sensitive: false });
        
        sideBox.pack_start(btnUp, false, false, 0);
        sideBox.pack_start(btnDown, false, false, 0);
        sideBox.pack_start(btnAdd, false, false, 0);
        sideBox.pack_start(btnDel, false, false, 0);

        let mainBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        mainBox.pack_start(scroll, true, true, 0);
        mainBox.pack_start(sideBox, false, false, 0);
        content.pack_start(mainBox, true, true, 0);

        // --- Логика обновления состояния кнопок ---
        let updateButtons = () => {
            let [ok, model, iter] = view.get_selection().get_selected();
            if (!ok) {
                btnUp.set_sensitive(false);
                btnDown.set_sensitive(false);
                btnDel.set_sensitive(false);
                return;
            }
            btnDel.set_sensitive(true);
            let idx = model.get_path(iter).get_indices()[0];
            let count = model.iter_n_children(null);
            btnUp.set_sensitive(idx > 0);
            btnDown.set_sensitive(idx < count - 1);
        };
        view.get_selection().connect('changed', updateButtons);

        // --- Обработчики кнопок ---
        btnUp.connect('clicked', () => {
            let [ok, model, iter] = view.get_selection().get_selected();
            if (ok) {
                let idx = model.get_path(iter).get_indices()[0];
                if (idx > 0) {
                    let [s, prevIter] = model.get_iter_from_string((idx - 1).toString());
                    if (s) {
                        model.swap(iter, prevIter);
                        updateButtons();
                    }
                }
            }
        });

        btnDown.connect('clicked', () => {
            let [ok, model, iter] = view.get_selection().get_selected();
            if (ok) {
                let idx = model.get_path(iter).get_indices()[0];
                if (idx < model.iter_n_children(null) - 1) {
                    let [s, nextIter] = model.get_iter_from_string((idx + 1).toString());
                    if (s) {
                        model.swap(iter, nextIter);
                        updateButtons();
                    }
                }
            }
        });

        btnAdd.connect('clicked', () => {
            let iter = store.append();
            store.set(iter, [0, 1, 2], ["ru", "", ""]);
            let path = store.get_path(iter);
            view.get_selection().select_path(path);
            updateButtons();
        });

        btnDel.connect('clicked', () => {
            let [ok, model, iter] = view.get_selection().get_selected();
            if (ok) {
                model.remove(iter);
                updateButtons();
            }
        });
        
        // Кнопки закрытия диалога
        dialog.add_button("Отмена", Gtk.ResponseType.CANCEL);
        dialog.add_button("Сохранить", Gtk.ResponseType.OK);
        
        dialog.show_all();
        let resp = dialog.run();
        
        if (resp === Gtk.ResponseType.OK) {
            let result = [];
            let count = store.iter_n_children(null);
            for (let i = 0; i < count; i++) {
                let [s, iter] = store.get_iter_from_string(i.toString());
                if (s) {
                    let lang = store.get_value(iter, 0);
                    let n = store.get_value(iter, 1);
                    let c = store.get_value(iter, 2);
                    if (lang) result.push({ lang, name: n, comment: c });
                }
            }
            dialog.destroy();
            this.updateLocalizationInText(result);
        } else {
            dialog.destroy();
        }
    }

    updateLocalizationInText(localizations) {
        let text = this.textBuffer.get_text(this.textBuffer.get_start_iter(), this.textBuffer.get_end_iter(), false);
        let lines = text.split('\n');
        let newLines = [];
        let inIconTheme = false;
        let nameFound = false;
        let commentFound = false;

        // Фильтруем пустые значения (если нет ни имени, ни комментария)
        let validLocs = localizations.filter(l => l.lang && (l.name || l.comment));

        let nameLocLines = [];
        let commentLocLines = [];

        // Готовим строки для вставки в нужном порядке
        for (let loc of validLocs) {
            if (loc.name) nameLocLines.push(`Name[${loc.lang}]=${loc.name}`);
            if (loc.comment) commentLocLines.push(`Comment[${loc.lang}]=${loc.comment}`);
        }

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            
            if (line === '[Icon Theme]') {
                inIconTheme = true;
                newLines.push(lines[i]);
                continue;
            }
            
            if (line.startsWith('[') && line.endsWith(']')) {
                // Если выходим из [Icon Theme] и не нашли Name/Comment, вставляем их
                if (inIconTheme) {
                    if (!nameFound && nameLocLines.length > 0) {
                        newLines.push('Name=');
                        newLines.push(...nameLocLines);
                    }
                    if (!commentFound && commentLocLines.length > 0) {
                        newLines.push('Comment=');
                        newLines.push(...commentLocLines);
                    }
                }
                inIconTheme = false;
                newLines.push(lines[i]);
                continue;
            }

            if (inIconTheme) {
                // Удаляем старые локализации
                if (line.startsWith('Name[') || line.startsWith('Comment[')) {
                    continue;
                }
                
                newLines.push(lines[i]);

                // Вставляем локализации строго под Name= и Comment=
                if (line.startsWith('Name=')) {
                    nameFound = true;
                    newLines.push(...nameLocLines);
                } else if (line.startsWith('Comment=')) {
                    commentFound = true;
                    newLines.push(...commentLocLines);
                }
            } else {
                newLines.push(lines[i]);
            }
        }

        // Если [Icon Theme] был последней секцией в файле
        if (inIconTheme) {
            if (!nameFound && nameLocLines.length > 0) {
                newLines.push('Name=');
                newLines.push(...nameLocLines);
            }
            if (!commentFound && commentLocLines.length > 0) {
                newLines.push('Comment=');
                newLines.push(...commentLocLines);
            }
        }

        this.textBuffer.set_text(newLines.join('\n'), -1);
        this.applyTextToUI(); // Обновляем левую панель и подсветку
        print("Локализация обновлена в тексте.");
    }

    showListEditorDialog(title, currentValue, callback) {
        let dialog = new Gtk.Dialog({
            title: title,
            transient_for: this.window,
            modal: true,
            default_width: 450,
            default_height: 400
        });
        
        let content = dialog.get_content_area();
        content.set_spacing(8);
        content.set_margin_start(10); content.set_margin_end(10);
        content.set_margin_top(10); content.set_margin_bottom(10);
        
        let store = new Gtk.ListStore();
        store.set_column_types([GObject.TYPE_STRING]);
        
        let items = currentValue ? currentValue.split(',').map(s => s.trim()).filter(Boolean) : [];
        for (let item of items) {
            let iter = store.append();
            store.set(iter, [0], [item]);
        }
        
        let view = new Gtk.TreeView({ model: store });
        let renderer = new Gtk.CellRendererText();
        let col = new Gtk.TreeViewColumn({ title: "Элементы (сверху вниз)", expand: true });
        col.pack_start(renderer, true);
        col.add_attribute(renderer, 'text', 0);
        view.append_column(col);
        
        let scroll = new Gtk.ScrolledWindow({ vexpand: true });
        scroll.add(view);

        // --- Правая колонка с кнопками (только иконки) ---
        let sideBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5 });
        
        let btnUp = new Gtk.Button({ 
            image: Gtk.Image.new_from_icon_name("go-up-symbolic", Gtk.IconSize.BUTTON),
            tooltip_text: "Переместить вверх",
            sensitive: false 
        });
        let btnDown = new Gtk.Button({ 
            image: Gtk.Image.new_from_icon_name("go-down-symbolic", Gtk.IconSize.BUTTON),
            tooltip_text: "Переместить вниз",
            sensitive: false
        });
        let btnDel = new Gtk.Button({ 
            image: Gtk.Image.new_from_icon_name("user-trash-symbolic", Gtk.IconSize.BUTTON),
            tooltip_text: "Удалить",
            sensitive: false
        });
        
        sideBox.pack_start(btnUp, false, false, 0);
        sideBox.pack_start(btnDown, false, false, 0);
        sideBox.pack_start(btnDel, false, false, 0);

        let mainBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        mainBox.pack_start(scroll, true, true, 0);
        mainBox.pack_start(sideBox, false, false, 0);
        content.pack_start(mainBox, true, true, 0);

        // --- Логика обновления состояния кнопок ---
        let updateButtons = () => {
            let [ok, model, iter] = view.get_selection().get_selected();
            if (!ok) {
                btnUp.set_sensitive(false);
                btnDown.set_sensitive(false);
                btnDel.set_sensitive(false);
                return;
            }
            btnDel.set_sensitive(true);
            let path = model.get_path(iter);
            let idx = path.get_indices()[0];
            let count = model.iter_n_children(null);
            btnUp.set_sensitive(idx > 0);
            btnDown.set_sensitive(idx < count - 1);
        };
        view.get_selection().connect('changed', updateButtons);
        
        // Обработчики кнопок (исправлена распаковка массивов)
        btnUp.connect('clicked', () => {
            let [ok, model, iter] = view.get_selection().get_selected();
            if (ok) {
                let idx = model.get_path(iter).get_indices()[0];
                if (idx > 0) {
                    let [s, prevIter] = model.get_iter_from_string((idx - 1).toString());
                    if (s) {
                        model.swap(iter, prevIter);
                        updateButtons();
                    }
                }
            }
        });
        
        btnDown.connect('clicked', () => {
            let [ok, model, iter] = view.get_selection().get_selected();
            if (ok) {
                let idx = model.get_path(iter).get_indices()[0];
                let count = model.iter_n_children(null);
                if (idx < count - 1) {
                    let [s, nextIter] = model.get_iter_from_string((idx + 1).toString());
                    if (s) {
                        model.swap(iter, nextIter);
                        updateButtons();
                    }
                }
            }
        });
        
        btnDel.connect('clicked', () => {
            let [ok, model, iter] = view.get_selection().get_selected();
            if (ok) {
                model.remove(iter);
                updateButtons();
            }
        });

        // --- Нижняя панель: Ввод и кнопки действий ---
        let bottomBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        
        let entry = new Gtk.Entry({ placeholder_text: "Добавить...", hexpand: true });
        
        let btnAdd = new Gtk.Button({ 
            label: "Добавить",
            image: Gtk.Image.new_from_icon_name("list-add-symbolic", Gtk.IconSize.BUTTON),
            always_show_image: true
        });
        
        let btnCancel = new Gtk.Button({ 
            label: "Отмена",
            image: Gtk.Image.new_from_icon_name("process-stop-symbolic", Gtk.IconSize.BUTTON),
            always_show_image: true
        });
        
        let btnSave = new Gtk.Button({ 
            label: "Сохранить",
            image: Gtk.Image.new_from_icon_name("document-save-symbolic", Gtk.IconSize.BUTTON),
            always_show_image: true
        });
        btnSave.get_style_context().add_class("suggested-action");
        
        let doAdd = () => {
            let text = entry.get_text().trim();
            if (text) {
                let iter = store.append();
                store.set(iter, [0], [text]);
                entry.set_text("");
                updateButtons();
            }
        };
        btnAdd.connect('clicked', doAdd);
        entry.connect('activate', doAdd);
        
        btnCancel.connect('clicked', () => dialog.response(Gtk.ResponseType.CANCEL));
        btnSave.connect('clicked', () => dialog.response(Gtk.ResponseType.OK));

        bottomBox.pack_start(entry, true, true, 0);
        bottomBox.pack_start(btnAdd, false, false, 0);
        bottomBox.pack_start(btnCancel, false, false, 0);
        bottomBox.pack_start(btnSave, false, false, 0);
        
        content.pack_start(bottomBox, false, false, 0);
        
        dialog.show_all();
        let resp = dialog.run();
        
        if (resp === Gtk.ResponseType.OK) {
            let result = [];
            let count = store.iter_n_children(null);
            // Безопасный перебор элементов по индексу (без iter_next)
            for (let i = 0; i < count; i++) {
                let [s, iter] = store.get_iter_from_string(i.toString());
                if (s) {
                    result.push(store.get_value(iter, 0));
                }
            }
            dialog.destroy(); // Закрываем диалог ДО вызова callback
            callback(result.join(','));
        } else {
            dialog.destroy();
        }
    }

    updateIconThemeKey(key, value) {
        let text = this.textBuffer.get_text(this.textBuffer.get_start_iter(), this.textBuffer.get_end_iter(), false);
        let lines = text.split('\n');
        let newLines = [];
        let found = false;
        let inIconTheme = false;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let trimmed = line.trim();
            
            if (trimmed === '[Icon Theme]') {
                inIconTheme = true;
                newLines.push(line);
                continue;
            }
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                inIconTheme = false;
            }
            
            if (inIconTheme) {
                // Ищем ключ с возможными пробелами/табуляциями вокруг "="
                let match = line.match(/^(\s*)([^=]+?)(\s*)=(\s*)(.*)$/);
                if (match && match[2].trim() === key) {
                    if (value) {
                        // Сохраняем оригинальные отступы (match[1] и match[4])
                        newLines.push(match[1] + key + match[3] + "=" + match[4] + value);
                    }
                    found = true;
                    continue;
                }
            }
            newLines.push(line);
        }
        
        if (!found && value) {
            // Если ключа не было, вставляем его в конец секции [Icon Theme]
            let finalLines = [];
            let inIcon = false;
            for (let i = 0; i < newLines.length; i++) {
                let line = newLines[i].trim();
                finalLines.push(newLines[i]);
                if (line === '[Icon Theme]') {
                    inIcon = true;
                } else if (inIcon && line.startsWith('[')) {
                    finalLines.splice(finalLines.length - 1, 0, key + '=' + value);
                    inIcon = false;
                }
            }
            if (inIcon) finalLines.push(key + '=' + value);
            newLines = finalLines;
        }
        
        this.textBuffer.set_text(newLines.join('\n'), -1);
        this.applyTextToUI();
    }

    updateExamplePreview() {
        if (this.isUpdatingPreview) return;
        this.isUpdatingPreview = true;

        let name = this.exampleEntry.get_text().trim();
        let dot = name.lastIndexOf('.');
        if (dot > 0) name = name.substring(0, dot);

        if (!name) {
            this.exampleImage.clear();
            this.previewSizeCombo.remove_all();
            this.isUpdatingPreview = false;
            return;
        }
        
        let occs = this.theme.icons.get(name);
        if (!occs || occs.length === 0) {
            this.exampleImage.clear();
            this.previewSizeCombo.remove_all();
            this.isUpdatingPreview = false;
            return;
        }

        // Собираем размеры, явно приводя их к числу
        let sizes = new Set();
        for (let o of occs) {
            if (o.size) sizes.add(Number(o.size));
        }
        let sortedSizes = Array.from(sizes).sort((a,b) => a-b);
        
        let currentSizeText = this.previewSizeCombo.get_active_text();
        let targetSize = currentSizeText ? parseInt(currentSizeText) : 0;

        // Пересоздаем элементы, только если набор размеров изменился
        let needsUpdate = true;
        let model = this.previewSizeCombo.get_model();
        if (model && model.iter_n_children(null) === sortedSizes.length) {
            needsUpdate = false;
            for (let i = 0; i < sortedSizes.length; i++) {
                let [ok, iter] = model.get_iter_from_string(i.toString());
                if (ok && model.get_value(iter, 0) !== sortedSizes[i].toString()) {
                    needsUpdate = true;
                    break;
                }
            }
        }

        if (needsUpdate) {
            this.previewSizeCombo.remove_all();
            for (let s of sortedSizes) {
                this.previewSizeCombo.append_text(s.toString());
            }
        }

        // Если текущий targetSize невалиден, берем максимальный <= 128
        if (!sortedSizes.includes(targetSize)) {
            targetSize = 0;
            for (let s of sortedSizes) {
                if (s <= 128) targetSize = s;
            }
            if (targetSize === 0 && sortedSizes.length > 0) targetSize = sortedSizes[0];
            
            let idx = sortedSizes.indexOf(targetSize);
            if (idx >= 0) {
                this.previewSizeCombo.set_active(idx);
            }
        }

        this.isUpdatingPreview = false;
        
        // Загружаем картинку для выбранного размера
        this.loadExampleImage(name, targetSize);
    }

    loadExampleImage(name, size) {
        if (!name) return;
        let occs = this.theme.icons.get(name);
        if (!occs || occs.length === 0) return;

        // Ищем файл нужного размера, если нет — берем первый попавшийся
        let bestOcc = null;
        for (let o of occs) {
            if (Number(o.size) === size) { bestOcc = o; break; }
        }
        if (!bestOcc) bestOcc = occs[0];

        try {
            let pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(bestOcc.fullPath, 128, 128, true);
            this.exampleImage.set_from_pixbuf(pb);
        } catch (e) {
            this.exampleImage.clear();
        }
    }

    saveChanges() {
        if (!this.currentSelectedDir) return;
        let dirName = this.currentSelectedDir;
        let info = this.theme.dirInfo.get(dirName);
        if (!info) return;

        let text = this.textBuffer.get_text(this.textBuffer.get_start_iter(), this.textBuffer.get_end_iter(), false);
        let lines = text.split('\n');
        
        let startLine = -1;
        let endLine = -1;
        let startMatch = '[' + dirName + ']';

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === startMatch) {
                startLine = i;
            } else if (startLine !== -1 && lines[i].trim().startsWith('[') && lines[i].trim().endsWith(']')) {
                endLine = i;
                break;
            }
        }

        if (startLine === -1) {
            print("Не удалось найти секцию " + dirName + " в тексте.");
            return;
        }
        if (endLine === -1) endLine = lines.length;

        let params = info.rawParams || {};
        let newSectionLines = [startMatch];
        let usedKeys = new Set();

        for (let i = startLine + 1; i < endLine; i++) {
            let line = lines[i].trim();
            if (line === '') {
                newSectionLines.push(lines[i]);
                continue;
            }
            if (line.startsWith('#') || line.startsWith(';')) {
                newSectionLines.push(lines[i]);
                continue;
            }
            
            if (line.includes('=')) {
                let eq = line.indexOf('=');
                let key = line.substring(0, eq).trim();
                
                if (params[key] !== undefined) {
                    newSectionLines.push(key + '=' + params[key]);
                    usedKeys.add(key);
                }
            } else {
                newSectionLines.push(lines[i]);
            }
        }

        for (let key in params) {
            if (!usedKeys.has(key)) {
                newSectionLines.push(key + '=' + params[key]);
            }
        }

        let beforeLines = lines.slice(0, startLine);
        let afterLines = lines.slice(endLine);
        let finalLines = beforeLines.concat(newSectionLines, afterLines);
        let finalText = finalLines.join('\n');

        // 1. Обновляем правую панель
        this.textBuffer.set_text(finalText, -1);

        // 2. Синхронизируем данные и ВОЗВРАЩАЕМ ПОДСВЕТКУ
        // (applyTextToUI пересчитает номера строк и вызовет applyProblemTags)
        this.applyTextToUI(); 
        
        print(`Секция [${dirName}] обновлена в тексте.`);
    }

    async loadThemeData(themePath, forceReload = false) {
        let existing = this.loadedThemes.find(t => t.indexPath === themePath);
        
        if (existing && !forceReload) {
            this.theme = existing;
        } else {
            this.theme = new ThemeModule.Theme(themePath);
            
            let themeName = GLib.path_get_basename(GLib.path_get_dirname(themePath));
            const progress = new ProgressDialog(this.window, 'Загрузка темы', 'Загрузка ' + themeName + '...');

            let success = false;
            try {
                success = await this.theme.load(progress); 
            } catch (e) {
                print("Ошибка загрузки: " + e.message);
            } // <-- Убрали finally

            if (!success) {
                if (!progress.isCancelled()) print("Не удалось загрузить тему.");
                progress.close();
                return;
            }

            if (themePath) {
                let idx = this.loadedThemes.findIndex(t => t.indexPath === themePath);
                if (idx !== -1) {
                    this.theme.checked = this.loadedThemes[idx].checked;
                    this.theme.isMain = this.loadedThemes[idx].isMain;
                    this.loadedThemes[idx] = this.theme;
                } else {
                    this.theme.checked = true;
                    this.theme.isMain = (themePath === this.settings.mainThemePath);
                    this.loadedThemes.push(this.theme);
                }
                this.renderChips();
                
                await this.rebuildComparisonAsync(progress); // Передаем прогресс
            }
            progress.close(); // <-- Закрываем в конце
        }

        // ==========================================
        // ДАЛЬШЕ ИДЕТ ОБНОВЛЕНИЕ ИНТЕРФЕЙСА (UI)
        // ==========================================
        
        this.nameEntry.set_text(this.theme.name || "");
        this.commentEntry.set_text(this.theme.comment || "");
        
        let iconTheme = this.theme.iniData['Icon Theme'] || {};
        this.exampleEntry.set_text(iconTheme['Example'] || '');
        this.updateExamplePreview();
        
        this.btnInherits.set_tooltip_text("Текущее: " + (this.theme.inherits || "не задано"));
        this.btnDirectories.set_tooltip_text("Текущее: " + (this.theme.directories.join(', ') || "не задано"));

        // Заполняем дерево каталогов
        this.dirStore.clear();
        for (let [dirName, info] of this.theme.dirInfo) {
            let iter = this.dirStore.append();
            let probStr = this.getDirProblemString(dirName); // Учитываем новую колонку
            this.dirStore.set(iter, [0, 1, 2, 3], [dirName, info.context || "", info.size || 0, probStr]);
        }

        // Загружаем текст в правую панель
        try {
            let file = Gio.File.new_for_path(this.theme.indexPath);
            let [ok, contents] = file.load_contents(null);
            if (ok) {
                let text = new TextDecoder('utf-8').decode(contents);
                text = text.replace(/\r\n/g, '\n');
                
                this.originalFileText = text;
                
                this.ignoreTextChange = true;
                this.textBuffer.set_text(text, -1);
                this.ignoreTextChange = false;
                
                this.checkTextModified();
            }
        } catch (e) { print("Ошибка чтения: " + e.message); }

        // Обновляем список проблем и подсветку
        this.lblProblemsTitle.set_label(`<b>Проблемы (${this.theme.problems.length})</b>`);
        let children = this.problemsList.get_children();
        for (let c of children) c.destroy();

        let getPriority = (msg) => {
            if (msg.includes('CRLF') || msg.includes('BOM') || msg.includes('содержит пробелы')) return 1;
            if (msg.includes('Битый симлинк')) return 2;
            if (msg.includes('отсутствует на диске')) return 3;
            return 4;
        };
        this.theme.problems.sort((a, b) => getPriority(a.msg) - getPriority(b.msg));

        let start = this.textBuffer.get_start_iter();
        let end = this.textBuffer.get_end_iter();
        this.textBuffer.remove_all_tags(start, end);

        for (let p of this.theme.problems) {
            let row = new Gtk.ListBoxRow();
            let label = new Gtk.Label({ label: p.msg, halign: Gtk.Align.START, wrap: true, xalign: 0, margin: 2 });
            row.add(label);
            
            row._line = p.line;
            row._filePath = p.filePath;
            row._targetName = p.targetName;

            if (p.line !== undefined && p.line >= 0) {
                try {
                    let iterStart = this.textBuffer.get_iter_at_line(p.line);
                    let iterEnd = this.textBuffer.get_iter_at_line(Math.min(p.line + 1, this.textBuffer.get_line_count()));
                    let tag = p.type === 'error' ? this.tagError : this.tagWarn;
                    this.textBuffer.apply_tag(tag, iterStart, iterEnd);
                } catch (e) {}
            }

            this.problemsList.add(row);
        }
        this.problemsList.show_all();
        this.populateToolsMasterStore();
    }

    populateToolsMasterStore(callback = null) {
        this.isUpdatingTools = true;
        if (!this.toolsMasterStore) return;
        this.toolsMasterStore.clear();
        
        // 1. Строим обратный индекс: "имя цели" -> [массив симлинков, которые на него ссылаются]
        this.toolsReverseIndex = new Map();
        for (let [otherName, otherOccs] of this.theme.icons) {
            for (let o of otherOccs) {
                if (o.isSymlink && o.target) {
                    let targetBase = GLib.path_get_basename(o.target).replace(/\.[^.]+$/, '');
                    if (!this.toolsReverseIndex.has(targetBase)) {
                        this.toolsReverseIndex.set(targetBase, []);
                    }
                    this.toolsReverseIndex.get(targetBase).push({
                        name: otherName,
                        occ: o
                    });
                }
            }
        }

        // 2. Собираем имена для левой таблицы
        let names = new Set();
        let showAll = this.toolsShowAllChk ? this.toolsShowAllChk.get_active() : false;
        
        for (let [name, occs] of this.theme.icons) {
            let hasOriginal = occs.some(o => !o.isSymlink);
            // Если включен "Показать все" ИЛИ у имени есть оригиналы — добавляем
            if (showAll || hasOriginal) {
                names.add(name);
            }
        }

        let sortedNames = Array.from(names).sort();
        let idx = 0;

        let loadChunk = () => {
            if (idx >= sortedNames.length) {
                this.isUpdatingTools = false;
                if (callback) callback(); // Вызываем коллбэк, когда все строки добавлены
                return false;
            }
            
            let name = sortedNames[idx];
            idx++;
            
            let occs = this.theme.icons.get(name);
            
            // Количество УНИКАЛЬНЫХ ИМЕН, ссылающихся на это имя
            let symlinkCount = 0;
            if (this.toolsReverseIndex.has(name)) {
                let uniqueNames = new Set();
                for (let ref of this.toolsReverseIndex.get(name)) {
                    uniqueNames.add(ref.name);
                }
                symlinkCount = uniqueNames.size;
            }
            
            let contexts = new Set(occs.map(o => o.context).filter(Boolean));
            let ctxStr = contexts.size > 1 ? "Multiple" : (Array.from(contexts)[0] || "");

            // Логика для колонки "Статус" (ОК только если все вхождения — оригиналы)
            let hasSymlinks = occs.some(o => o.isSymlink);
            let status = hasSymlinks ? "Есть симлинки" : "OK";
            let color = hasSymlinks ? this.settings.colors.hasSymlinks : this.settings.colors.ok;

            // Ищем превью (сначала оригинал)
            let previewPb = null;
            for (let o of occs) {
                if (!o.isSymlink) { previewPb = pixbufFromFileCached(o.fullPath, 24); if (previewPb) break; }
            }
            if (!previewPb) previewPb = getTransparentPixbuf();

            let iter = this.toolsMasterStore.append();
            this.toolsMasterStore.set(iter, [0, 1, 2, 3, 4, 5, 6], [
                previewPb, name, ctxStr, symlinkCount, status, color, name.toLowerCase()
            ]);

            if (idx % 50 === 0) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, loadChunk);
                return false;
            }
            return loadChunk();
        };
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, loadChunk);
    }

    populateToolsRightPanel(name) {
        // Очищаем все таблицы правой панели
        this.toolsRightFilesStore.clear();
        this.toolsRightStore.clear();
        this.toolsRightTopStore.clear();
        this.toolsRightBottomStore.clear();
        
        if (!name || !this.toolsReverseIndex) return;

        // 1. Заполняем ВЕРХНЮЮ таблицу (Файлы выбранного имени)
        let occs = this.theme.icons.get(name) || [];
        for (let o of occs) {
            let pb = pixbufFromFileCached(o.fullPath, 24) || getTransparentPixbuf();
            let iter = this.toolsRightFilesStore.append();
            this.toolsRightFilesStore.set(iter, [0, 1, 2, 3, 4, 5], [
                pb, 
                o.dirName, 
                o.context || '', 
                o.size || 0, 
                o.isSymlink ? 'симлинк' : 'файл', 
                o.target || ''
            ]);
        }

        // 2. Заполняем вкладку "Списком"
        let refs = this.toolsReverseIndex.get(name) || [];
        for (let ref of refs) {
            let o = ref.occ;
            let pb = pixbufFromFileCached(o.fullPath, 24) || getTransparentPixbuf();
            let iter = this.toolsRightStore.append();
            this.toolsRightStore.set(iter, [0, 1, 2, 3], [pb, ref.name, o.dirName, o.context || '']);
        }

        // 3. Заполняем вкладку "Поимённо" (группируем)
        let grouped = new Map(); 
        for (let ref of refs) {
            if (!grouped.has(ref.name)) grouped.set(ref.name, []);
            grouped.get(ref.name).push(ref);
        }

        for (let [gName, gRefs] of grouped) {
            let firstOcc = gRefs[0].occ;
            let pb = pixbufFromFileCached(firstOcc.fullPath, 24) || getTransparentPixbuf();
            let ctxStr = firstOcc.context || '';
            
            let iter = this.toolsRightTopStore.append();
            this.toolsRightTopStore.set(iter, [0, 1, 2, 3], [pb, gName, ctxStr, gRefs.length]);
        }
    }

    getDirNameByContextAndSize(context, size) {
        for (let [dirName, info] of this.theme.dirInfo) {
            if (info.context === context && Number(info.size) === size) {
                return dirName;
            }
        }
        return null;
    }

    updateThemeMemory(toCreate, toDelete) {
        // 1. Удаляем из памяти
        for (let item of toDelete) {
            let baseName = GLib.path_get_basename(item.path).replace(/\.[^.]+$/, '');
            let occs = this.theme.icons.get(baseName);
            if (occs) {
                let filtered = occs.filter(o => o.fullPath !== item.path);
                if (filtered.length > 0) {
                    this.theme.icons.set(baseName, filtered);
                } else {
                    this.theme.icons.delete(baseName);
                }
            }
        }

        // 2. Добавляем в память
        for (let item of toCreate) {
            let baseName = GLib.path_get_basename(item.path).replace(/\.[^.]+$/, '');
            let fileName = GLib.path_get_basename(item.path);
            let dirName = GLib.path_get_dirname(item.path).substring(this.theme.themeDir.length + 1);
            let info = this.theme.dirInfo.get(dirName) || {};
            
            if (!this.theme.icons.has(baseName)) {
                this.theme.icons.set(baseName, []);
            }
            
            let occs = this.theme.icons.get(baseName).filter(o => o.fullPath !== item.path);
            
            occs.push({
                dirName: dirName,
                fileName: fileName,
                fullPath: item.path,
                relPath: dirName + '/' + fileName,
                isSymlink: true,
                target: item.target,
                resolvedTarget: GLib.canonicalize_filename(item.target, GLib.path_get_dirname(item.path)),
                size: info.size || null,
                context: info.context || ''
            });
            this.theme.icons.set(baseName, occs);
        }
    }

    selectToolsName(name) {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            let count = this.toolsSortModel.iter_n_children(null);
            for (let i = 0; i < count; i++) {
                let [ok, iter] = this.toolsSortModel.get_iter_from_string(i.toString());
                if (ok && iter && this.toolsSortModel.get_value(iter, 1) === name) {
                    let path = this.toolsSortModel.get_path(iter);
                    this.toolsLeftView.get_selection().select_path(path);
                    this.toolsLeftView.scroll_to_cell(path, null, false, 0, 0);
                    
                    // Принудительно обновляем правую панель
                    this.toolsCurrentSelected = name;
                    this.populateToolsRightPanel(name);
                    return false;
                }
            }
            return false;
        });
    }

    getRelativeTargetPath(sourceContext, size, targetName) {
        // 1. Находим оригинал (цель) нужного размера
        let targetOccs = this.theme.icons.get(targetName) || [];
        let targetOcc = targetOccs.find(o => Number(o.size) === size && !o.isSymlink);
        if (!targetOcc) return targetName + '.png'; // Запасной вариант

        // 2. Находим каталог, где будет создаваться симлинк
        let sourceDirName = this.getDirNameByContextAndSize(sourceContext, size);
        if (!sourceDirName) return targetName + '.png';

        // 3. Вычисляем относительный путь от папки симлинка до папки оригинала
        let sourceDir = GLib.build_filenamev([this.theme.themeDir, sourceDirName]);
        let targetFile = GLib.build_filenamev([this.theme.themeDir, targetOcc.dirName, targetOcc.fileName]);
        
        let relPath = Gio.File.new_for_path(sourceDir).get_relative_path(Gio.File.new_for_path(targetFile));
        
        return relPath ? relPath : targetName + '.png';
    }
}

let themePath = null;
let showHelp = false;

for (let i = 0; i < ARGV.length; i++) {
    if (ARGV[i] === '-h' || ARGV[i] === '--help') {
        showHelp = true;
    } else if (!ARGV[i].startsWith('-')) {
        themePath = ARGV[i];
    }
}

if (showHelp) {
    print("Icon Theme Toolkit");
    print("Использование: gjs icon-theme-toolkit.js [опции] [путь_к_теме]");
    print("");
    print("Опции:");
    print("  -h, --help    Показать эту справку и выйти");
    print("");
    print("Аргументы:");
    print("  путь_к_теме   Путь к каталогу темы или файлу index.theme.");
    print("                Если не указан, открывается вкладка сравнения.");
    imports.system.exit(0);
}

let app = new MainWindow(themePath);
Gtk.main();
