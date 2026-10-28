#!/usr/bin/gjs
// icon-compiler.js
// Компилятор ICO-файлов из PNG + создание совместимого .ini
// для winico2linuxtheme.en.js.
//
// Использование:
//   icon-compiler.js [--name=foo.ico] [--context=Applications] \
//                    [--themefile=/path/to/index.theme] \
//                    file1.png file2.png ...

imports.gi.versions.Gtk = '3.0';
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const GdkPixbuf = imports.gi.GdkPixbuf;

Gtk.init(null);

// ================= УТИЛИТЫ =================

function decodeContents(c) {
    if (typeof c === 'string') return c;
    if (typeof TextDecoder !== 'undefined') {
        try { return new TextDecoder('utf-8').decode(c); } catch (e) {}
    }
    try { return imports.byteArray.toString(c); } catch (e) {}
    return '';
}

function loadPixbufNearest(absPath, size) {
    try {
        let raw = GdkPixbuf.Pixbuf.new_from_file(absPath);
        let w = raw.get_width(), h = raw.get_height();
        if (w === size && h === size) return raw;
        let sc = Math.min(size / w, size / h);
        let nw = Math.max(1, Math.round(w * sc));
        let nh = Math.max(1, Math.round(h * sc));
        let scaled = raw.scale_simple(nw, nh, GdkPixbuf.InterpType.NEAREST);
        if (nw === size && nh === size) return scaled;
        let canvas = GdkPixbuf.Pixbuf.new(
            GdkPixbuf.Colorspace.RGB, true, 8, size, size);
        canvas.fill(0x00000000);
        scaled.copy_area(0, 0, nw, nh, canvas,
            Math.floor((size - nw) / 2),
            Math.floor((size - nh) / 2));
        return canvas;
    } catch (e) { return null; }
}

function basenameNoExt(path) {
    let b = GLib.path_get_basename(path);
    let d = b.lastIndexOf('.');
    return d > 0 ? b.substring(0, d) : b;
}

function haveIcotool() {
    try { return GLib.find_program_in_path('icotool') != null; }
    catch (e) { return false; }
}

// ================= ГЛУБИНА ЦВЕТА =================

const BIT_DEPTHS = [
    { value: 1,  label: 'Моно' },
    { value: 4,  label: '16' },
    { value: 8,  label: '256' },
    { value: 16, label: 'HiColor' },
    { value: 24, label: 'TrueColor' },
    { value: 32, label: 'XP' }
];

// ================= ОКНО КОМПИЛЯТОРА =================

class IconCompilerWindow {
    constructor(pngPaths, opts) {
        this.pngPaths = pngPaths || [];
        this.initialName = (opts && opts.name) || '';
        this.context = (opts && opts.context) || '';
        this.themefile = (opts && opts.themefile) || '';

        this.rows = [];
        for (let i = 0; i < this.pngPaths.length; i++) {
            let path = this.pngPaths[i];
            let width = 0, height = 0;
            try {
                let pb = GdkPixbuf.Pixbuf.new_from_file(path);
                width = pb.get_width();
                height = pb.get_height();
            } catch (e) { continue; }

            this.rows.push({
                path: path,
                baseName: basenameNoExt(path),
                width: width,
                height: height,
                bitDepth: 32,
                checked: true
            });
        }

        if (this.rows.length === 0) {
            this.showError('Не передано ни одного корректного PNG-файла.');
            return;
        }

        this.detectInitialName();

        let sizes = new Set([16, 22, 24, 32, 48, 64, 96, 128]);
        for (let i = 0; i < this.rows.length; i++) {
            if (this.rows[i].width > 0) sizes.add(this.rows[i].width);
        }
        this.previewSizes = Array.from(sizes).sort(function(a, b) { return a - b; });
        this.previewSize = 64;

        this.buildUI();
    }

    detectInitialName() {
        if (this.initialName) {
            if (!/\.ico$/i.test(this.initialName))
                this.initialName += '.ico';
            return;
        }
        let names = new Set();
        for (let i = 0; i < this.rows.length; i++) names.add(this.rows[i].baseName);
        if (names.size === 1) {
            this.initialName = Array.from(names)[0] + '.ico';
        } else {
            this.initialName = '';
        }
    }

    buildUI() {
        this.window = new Gtk.Window({
            title: 'Компилятор ICO',
            default_width: 900,
            default_height: 620,
            window_position: Gtk.WindowPosition.CENTER
        });
        this.window.connect('destroy', function () { Gtk.main_quit(); });

        let mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            margin: 8
        });

        // --- Верхняя строка ---
        let top = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });

        top.pack_start(new Gtk.Label({ label: 'Имя значка:' }), false, false, 0);
        this.nameEntry = new Gtk.Entry({
            hexpand: true,
            placeholder_text: 'имя.ico',
            text: this.initialName
        });
        top.pack_start(this.nameEntry, true, true, 0);

        top.pack_start(new Gtk.Label({ label: 'Просмотр:' }), false, false, 0);
        this.previewCombo = new Gtk.ComboBoxText();
        let activeIdx = 0;
        for (let i = 0; i < this.previewSizes.length; i++) {
            this.previewCombo.append_text(this.previewSizes[i] + ' px');
            if (this.previewSizes[i] === this.previewSize) activeIdx = i;
        }
        this.previewCombo.set_active(activeIdx);
        this.previewCombo.connect('changed', () => {
            let idx = this.previewCombo.get_active();
            if (idx < 0) return;
            this.previewSize = this.previewSizes[idx];
            this.repopulate();
        });
        top.pack_start(this.previewCombo, false, false, 0);

        this.onlyChecked = new Gtk.CheckButton({ label: 'Только отмеченные' });
        this.onlyChecked.set_tooltip_text('Показывать только отмеченные строки.');
        this.onlyChecked.connect('toggled', () => this.repopulate());
        top.pack_start(this.onlyChecked, false, false, 0);

        mainBox.pack_start(top, false, false, 0);

        // --- Таблица ---
        this.store = new Gtk.ListStore();
        this.store.set_column_types([
            GObject.TYPE_BOOLEAN,   // 0
            GdkPixbuf.Pixbuf,       // 1
            GObject.TYPE_STRING,    // 2 size
            GObject.TYPE_INT,       // 3 bit depth value
            GObject.TYPE_STRING,    // 4 bit depth label
            GObject.TYPE_STRING     // 5 path
        ]);

        let view = new Gtk.TreeView({ model: this.store, headers_clickable: true });

        let cbToggle = new Gtk.CellRendererToggle();
        cbToggle.connect('toggled', (r, pathStr) => {
            let iter = this.store.get_iter(new Gtk.TreePath.new_from_string(pathStr));
            if (!iter) return;
            let cur = this.store.get_value(iter, 0);
            this.store.set_value(iter, 0, !cur);
            let absPath = this.store.get_value(iter, 5);
            for (let i = 0; i < this.rows.length; i++) {
                if (this.rows[i].path === absPath) {
                    this.rows[i].checked = !cur;
                    break;
                }
            }
        });
        let cbCol = new Gtk.TreeViewColumn({ title: '' });
        cbCol.pack_start(cbToggle, false);
        cbCol.add_attribute(cbToggle, 'active', 0);
        view.append_column(cbCol);

        let pixR = new Gtk.CellRendererPixbuf();
        pixR.set_property('xpad', 4);
        pixR.set_property('ypad', 2);
        let pixCol = new Gtk.TreeViewColumn({ title: '' });
        pixCol.pack_start(pixR, false);
        pixCol.add_attribute(pixR, 'pixbuf', 1);
        view.append_column(pixCol);

        let szR = new Gtk.CellRendererText();
        let szCol = new Gtk.TreeViewColumn({ title: 'Размер' });
        szCol.pack_start(szR, false);
        szCol.add_attribute(szR, 'text', 2);
        szCol.set_min_width(70);
        szCol.set_resizable(true);
        view.append_column(szCol);

        let bdR = new Gtk.CellRendererCombo();
        bdR.set_property('editable', true);
        bdR.set_property('has-entry', false);
        let bdModel = new Gtk.ListStore();
        bdModel.set_column_types([GObject.TYPE_STRING, GObject.TYPE_INT]);
        for (let i = 0; i < BIT_DEPTHS.length; i++) {
            let it = bdModel.append();
            bdModel.set(it, [0, 1], [BIT_DEPTHS[i].label, BIT_DEPTHS[i].value]);
        }
        bdR.set_property('model', bdModel);
        bdR.set_property('text-column', 0);
        bdR.connect('edited', (r, pathStr, newText) => {
            let iter = this.store.get_iter(new Gtk.TreePath.new_from_string(pathStr));
            if (!iter) return;
            let tree = bdModel.get_iter_first();
            while (tree) {
                if (bdModel.get_value(tree, 0) === newText) {
                    let v = bdModel.get_value(tree, 1);
                    this.store.set_value(iter, 3, v);
                    this.store.set_value(iter, 4, newText);
                    let absPath = this.store.get_value(iter, 5);
                    for (let i = 0; i < this.rows.length; i++) {
                        if (this.rows[i].path === absPath) {
                            this.rows[i].bitDepth = v;
                            break;
                        }
                    }
                    break;
                }
                tree = bdModel.iter_next(tree);
            }
        });
        let bdCol = new Gtk.TreeViewColumn({ title: 'Глубина цвета' });
        bdCol.pack_start(bdR, true);
        bdCol.add_attribute(bdR, 'text', 4);
        bdCol.set_min_width(110);
        bdCol.set_resizable(true);
        view.append_column(bdCol);

        let pathR = new Gtk.CellRendererText();
        pathR.set_property('ellipsize', 3);
        let pathCol = new Gtk.TreeViewColumn({ title: 'Путь' });
        pathCol.pack_start(pathR, true);
        pathCol.add_attribute(pathR, 'text', 5);
        pathCol.set_expand(true);
        pathCol.set_resizable(true);
        pathCol.set_min_width(200);
        view.append_column(pathCol);

        let scroll = new Gtk.ScrolledWindow();
        scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC);
        scroll.add(view);
        mainBox.pack_start(scroll, true, true, 0);

        this.treeView = view;

        // --- Нижняя строка ---
        let bottom = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });

        this.makeIni = new Gtk.CheckButton({ label: 'Создать также .ini файл' });
        this.makeIni.set_tooltip_text(
            'Сохранить рядом с ICO .ini в формате winico2linuxtheme ' +
            '(секции [defaults] и [bit-depth]).');
        bottom.pack_start(this.makeIni, false, false, 0);

        bottom.pack_start(new Gtk.Label({ label: '' }), true, true, 0);

        this.statusLabel = new Gtk.Label({ label: '' });
        bottom.pack_start(this.statusLabel, false, false, 0);

        let saveBtn = new Gtk.Button({ label: 'Сохранить ICO...' });
        saveBtn.connect('clicked', () => this.onSave());
        bottom.pack_start(saveBtn, false, false, 0);

        let closeBtn = new Gtk.Button({ label: 'Закрыть' });
        closeBtn.connect('clicked', () => this.window.destroy());
        bottom.pack_start(closeBtn, false, false, 0);

        mainBox.pack_start(bottom, false, false, 0);

        this.window.add(mainBox);

        this.repopulate();
        this.window.show_all();
    }

    repopulate() {
        this.store.clear();
        let onlyChecked = this.onlyChecked.get_active();

        for (let i = 0; i < this.rows.length; i++) {
            let r = this.rows[i];
            if (onlyChecked && !r.checked) continue;
            let pix = loadPixbufNearest(r.path, this.previewSize);
            let iter = this.store.append();
            let bdLabel = 'XP';
            for (let k = 0; k < BIT_DEPTHS.length; k++) {
                if (BIT_DEPTHS[k].value === r.bitDepth) { bdLabel = BIT_DEPTHS[k].label; break; }
            }
            this.store.set(iter, [0, 1, 2, 3, 4, 5], [
                r.checked, pix, r.width + 'x' + r.height,
                r.bitDepth, bdLabel, r.path
            ]);
        }
    }

    onSave() {
        let name = this.nameEntry.get_text().trim();
        if (!name) {
            this.showError('Укажите имя будущего ICO-файла.');
            return;
        }
        if (!/\.ico$/i.test(name)) name += '.ico';

        let sel = [];
        for (let i = 0; i < this.rows.length; i++) {
            if (this.rows[i].checked) sel.push(this.rows[i]);
        }
        if (sel.length === 0) {
            this.showError('Не отмечено ни одного файла.');
            return;
        }

        let dialog = new Gtk.FileChooserDialog({
            title: 'Сохранить ICO',
            action: Gtk.FileChooserAction.SAVE,
            transient_for: this.window,
            modal: true,
            do_overwrite_confirmation: true
        });
        dialog.add_button('Отмена', Gtk.ResponseType.CANCEL);
        dialog.add_button('Сохранить', Gtk.ResponseType.OK);
        dialog.set_current_name(name);

        let response = dialog.run();
        let outPath = (response === Gtk.ResponseType.OK) ? dialog.get_filename() : null;
        dialog.destroy();

        if (!outPath) return;
        if (!/\.ico$/i.test(outPath)) outPath += '.ico';

        if (!this.runIcotoool(sel, outPath)) return;

        if (this.makeIni.get_active()) {
            this.writeIni(sel, outPath);
        }

        this.statusLabel.set_text('Сохранено: ' + outPath);
    }

    runIcotoool(sel, outPath) {
        let cmd = ['icotool', '-c', '-o', outPath];
        for (let i = 0; i < sel.length; i++) {
            cmd.push('--bit-depth=' + sel[i].bitDepth);
            cmd.push(sel[i].path);
        }

        let [success, _stdout, stderr, exitStatus] = GLib.spawn_sync(
            null, cmd, null, GLib.SpawnFlags.SEARCH_PATH, null);

        if (!success || exitStatus !== 0) {
            let err = stderr ? decodeContents(stderr) : '';
            this.showError('icotool завершился с ошибкой.\n' +
                (err || ('код выхода ' + exitStatus)));
            return false;
        }
        return true;
    }

    // ================= INI (формат winico2linuxtheme) =================
    writeIni(sel, icoPath) {
        let iniPath = icoPath.replace(/\.ico$/i, '.ini');

        let iconName = basenameNoExt(icoPath);

        let content = '[defaults]\n';
        content += 'name=' + iconName + '\n';
        content += 'context=' + (this.context || '') + '\n';
        content += 'themefile=' + (this.themefile || '') + '\n';

        content += '\n[bit-depth]\n';

        // Сортируем по размеру (WxH), как в winico2linuxtheme
        let sorted = sel.slice().sort(function(a, b) {
            if (a.width !== b.width) return a.width - b.width;
            return a.height - b.height;
        });
        for (let i = 0; i < sorted.length; i++) {
            content += sorted[i].width + 'x' + sorted[i].height +
                       '=' + sorted[i].bitDepth + '\n';
        }

        try {
            let file = Gio.File.new_for_path(iniPath);
            file.replace_contents(content, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            this.showError('Не удалось записать ini: ' + e.message);
        }
    }

    showError(msg) {
        let d = new Gtk.MessageDialog({
            transient_for: this.window,
            modal: true,
            message_type: Gtk.MessageType.ERROR,
            buttons: Gtk.ButtonsType.OK,
            text: msg
        });
        d.run();
        d.destroy();
    }
}

// ================= ЗАПУСК =================

if (!haveIcotool()) {
    print('icon-compiler.js: не найден icotool.');
    print('Установите: apt install icoutils   (Debian/Ubuntu)');
    print('            pkg install icoutils   (Termux)');
    imports.system.exit(1);
}

let args = ARGV.slice();
let nameArg = null, contextArg = '', themefileArg = '';
let files = [];

for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (a.indexOf('--name=') === 0) {
        nameArg = a.substring(7);
    } else if (a.indexOf('--context=') === 0) {
        contextArg = a.substring(10);
    } else if (a.indexOf('--themefile=') === 0) {
        themefileArg = a.substring(12);
    } else if (a === '--help' || a === '-h') {
        print('Использование: icon-compiler.js [--name=NAME.ico] [--context=CTX] ' +
              '[--themefile=PATH] file1.png file2.png ...');
        imports.system.exit(0);
    } else if (a.charAt(0) !== '-') {
        if (a.toLowerCase().endsWith('.png') &&
            Gio.File.new_for_path(a).query_exists(null)) {
            files.push(a);
        }
    }
}

if (files.length === 0) {
    print('icon-compiler.js: не передано ни одного PNG-файла.');
    imports.system.exit(1);
}

let win = new IconCompilerWindow(files, {
    name: nameArg,
    context: contextArg,
    themefile: themefileArg
});
if (win.window) Gtk.main();