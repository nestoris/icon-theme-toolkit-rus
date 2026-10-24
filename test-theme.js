#!/usr/bin/gjs
// test-theme.js
// Запуск: gjs test-theme.js /путь/к/теме

imports.gi.versions.Gtk = '3.0';
const GLib = imports.gi.GLib;

// Подключаем наш модуль
const here = GLib.path_get_dirname(imports.system.programInvocationName);
imports.searchPath.unshift(here);
const ThemeModule = imports.theme;

if (ARGV.length === 0) {
    print("Использование: gjs test-theme.js /путь/к/теме");
    imports.system.exit(1);
}

let themePath = ARGV[0];

// Создаем цикл событий (нужен для async/await)
const loop = new GLib.MainLoop(null, false);

async function run() {
    let theme = new ThemeModule.Theme(themePath);
    let success = await theme.load();
    
    if (success) {
        theme.printReport();
    } else {
        print("ОШИБКА ЗАГРУЗКИ:");
        theme.problems.forEach(p => print(" - " + p.msg));
    }
}

run().catch(e => {
    print("Критическая ошибка: " + e.message);
}).finally(() => {
    loop.quit();
});

loop.run();