// settings.js
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

var Settings = class Settings {
    constructor() {
        this.visualPreviewSize = 48; // Размер превью по умолчанию
        const configDir = GLib.build_filenamev([
            GLib.get_user_config_dir(), 'icon-theme-toolkit']);
        try { GLib.mkdir_with_parents(configDir, 0o755); } catch (e) {}
        this.path = GLib.build_filenamev([configDir, 'config.ini']);

        // Цвета по умолчанию (как в старом компараторе)
        this.colors = {
            missing: '#CC0000',
            symlinksOnly: '#800080',
            hasSymlinks: '#0000CC',
            ok: '#000000'
        };

        this.mainThemePath = ''; // Путь к index.theme главной темы

        this.load();
    }

    load() {
        try {
            const kf = new GLib.KeyFile();
            kf.load_from_file(this.path, GLib.KeyFileFlags.NONE);

            try { this.colors.missing      = kf.get_string('colors', 'missing'); } catch (e) {}
            try { this.colors.symlinksOnly = kf.get_string('colors', 'symlinks_only'); } catch (e) {}
            try { this.colors.hasSymlinks  = kf.get_string('colors', 'has_symlinks'); } catch (e) {}
            try { this.colors.ok           = kf.get_string('colors', 'ok'); } catch (e) {}
            try { this.visualPreviewSize = kf.get_integer('ui', 'visual_preview_size'); } catch (e) {}

            try { this.mainThemePath = kf.get_string('main', 'theme_path') || ''; } catch (e) {}
        } catch (e) {
            // Файла нет — используем значения по умолчанию
        }
    }

    save() {
        const kf = new GLib.KeyFile();
        kf.set_string('colors', 'missing', this.colors.missing);
        kf.set_string('colors', 'symlinks_only', this.colors.symlinksOnly);
        kf.set_string('colors', 'has_symlinks', this.colors.hasSymlinks);
        kf.set_string('colors', 'ok', this.colors.ok);
        kf.set_integer('ui', 'visual_preview_size', this.visualPreviewSize);

        kf.set_string('main', 'theme_path', this.mainThemePath || '');

        try { kf.save_to_file(this.path); } catch (e) { print("Ошибка сохранения настроек: " + e.message); }
    }
};