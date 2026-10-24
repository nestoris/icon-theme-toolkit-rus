#!/usr/bin/gjs
// icon-theme-toolkit.js

imports.gi.versions.Gtk = '3.0';
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gdk = imports.gi.Gdk;

Gtk.init(null);

const here = GLib.path_get_dirname(imports.system.programInvocationName);
imports.searchPath.unshift(here);
const ThemeModule = imports.theme;

class MainWindow {
    constructor(themePath) {
        this.theme = new ThemeModule.Theme(themePath);
        
        this.window = new Gtk.Window({
            title: "Icon Theme Toolkit",
            default_width: 1200,
            default_height: 800,
            window_position: Gtk.WindowPosition.CENTER
        });
        this.window.connect('destroy', () => Gtk.main_quit());

        this.buildUI();
        this.window.show_all();
        // Асинхронно загружаем тему и обновляем интерфейс
        this.loadThemeData(themePath).catch(e => {
            print("Критическая ошибка при загрузке: " + e.message);
            if (e.stack) print(e.stack);
        });
    }

    buildUI() {
        this.notebook = new Gtk.Notebook();
        this.notebook.set_scrollable(true);

        this.notebook.append_page(new Gtk.Label({ label: "Сравнение" }), new Gtk.Label({ label: 'Сравнение' }));
        
        let editorTab = this.buildThemeEditorTab();
        this.notebook.append_page(editorTab, new Gtk.Label({ label: 'Редактор темы' }));

        // ДОБАВИТЬ ЭТО:
        let toolsTab = new Gtk.Label({ label: "Здесь будут инструменты проверки..." });
        this.notebook.append_page(toolsTab, new Gtk.Label({ label: 'Инструменты' }));

        this.window.add(this.notebook);
    }

    buildThemeEditorTab() {
        let paned = new Gtk.Paned({ orientation: Gtk.Orientation.HORIZONTAL, wide_handle: true });

        // ================= ЛЕВАЯ ПАНЕЛЬ =================
        let leftMainWindowBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 5 });

        // --- Блок 1: Дерево каталогов и их свойства (в рамке) ---
        let frameDirs = new Gtk.Frame({ label: "Каталоги (index.theme)" });
        let dirsVBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 5 });
        
        let innerPaned = new Gtk.Paned({ orientation: Gtk.Orientation.VERTICAL, wide_handle: true });

        // Список каталогов
        this.dirStore = new Gtk.ListStore();
        this.dirStore.set_column_types([GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_INT]);
        this.dirView = new Gtk.TreeView({ model: this.dirStore, headers_visible: true });
        
        let r1 = new Gtk.CellRendererText();
        let c1 = new Gtk.TreeViewColumn({ title: "Путь", expand: true });
        c1.pack_start(r1, true); c1.add_attribute(r1, 'text', 0);
        this.dirView.append_column(c1);

        let r2 = new Gtk.CellRendererText();
        let c2 = new Gtk.TreeViewColumn({ title: "Контекст" });
        c2.pack_start(r2, true); c2.add_attribute(r2, 'text', 1);
        this.dirView.append_column(c2);

        let r3 = new Gtk.CellRendererText();
        let c3 = new Gtk.TreeViewColumn({ title: "Размер" });
        c3.pack_start(r3, true); c3.add_attribute(r3, 'text', 2);
        this.dirView.append_column(c3);

        let scrollDirs = new Gtk.ScrolledWindow({ vexpand: true });
        scrollDirs.add(this.dirView);
        innerPaned.pack1(scrollDirs, true, false);

        // Форма параметров выбранного каталога
        // --- Динамическая форма параметров выбранного каталога ---
        let formBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 5 });
        
        // Заголовок формы
        this.lblCurrentDir = new Gtk.Label({ label: "<i>Выберите каталог в списке выше</i>", use_markup: true, halign: Gtk.Align.START });
        formBox.pack_start(this.lblCurrentDir, false, false, 0);
        
        // Контейнер для строк параметров
        this.paramsBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5 });
        formBox.pack_start(this.paramsBox, false, false, 0);
        
        // --- Горизонтальный блок: Добавить параметр и Сохранить ---
        let paramActionsBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });

        this.addParamBtn = new Gtk.Button({ label: "+ Добавить параметр", sensitive: false });
        this.addMenu = new Gtk.Menu();
        this.stdKeys = ["Context", "Type", "Scale", "MinSize", "MaxSize", "Threshold"];
        
        paramActionsBox.pack_start(this.addParamBtn, true, true, 0);

        let btnSave = new Gtk.Button({ label: "Сохранить изменения" });
        btnSave.get_style_context().add_class("suggested-action");
        btnSave.connect('clicked', () => this.saveChanges());
        paramActionsBox.pack_start(btnSave, true, true, 0);

        formBox.pack_start(paramActionsBox, false, false, 0);

        // --- НОВЫЕ КНОПКИ ДЛЯ ПРОБЛЕМ ---
        let actionBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });

        this.btnFix = new Gtk.MenuButton({ label: "Исправить проблему", sensitive: false });
        this.fixMenu = new Gtk.Menu();
        this.btnFix.set_popup(this.fixMenu);
        actionBox.pack_start(this.btnFix, true, true, 0);

        this.btnDeleteDir = new Gtk.Button({ label: "Удалить каталог", sensitive: false });
        this.btnDeleteDir.get_style_context().add_class("destructive-action"); // Красная кнопка
        this.btnDeleteDir.connect('clicked', () => this.deleteDirectory(this.currentSelectedDir));
        actionBox.pack_start(this.btnDeleteDir, true, true, 0);

        formBox.pack_start(actionBox, false, false, 0);

        // Настройка меню "Добавить параметр"
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
        //formBox.pack_start(this.addParamBtn, false, false, 0);

        innerPaned.pack2(formBox, false, false);
        dirsVBox.pack_start(innerPaned, true, true, 0);
        frameDirs.add(dirsVBox);
        leftMainWindowBox.pack_start(frameDirs, true, true, 0);

        // --- Блок 2: Метаданные (Спойлеры) ---
        let expCore = new Gtk.Expander({ label: "<b>Основные параметры</b>", use_markup: true, expanded: true });
        let coreGrid = new Gtk.Grid({ row_spacing: 5, column_spacing: 5, margin: 5 });
        this.nameEntry = new Gtk.Entry();
        this.commentEntry = new Gtk.Entry();
        this.inheritsEntry = new Gtk.Entry();
        coreGrid.attach(new Gtk.Label({ label: "Name:", halign: Gtk.Align.START }), 0, 0, 1, 1); coreGrid.attach(this.nameEntry, 1, 0, 1, 1);
        coreGrid.attach(new Gtk.Label({ label: "Comment:", halign: Gtk.Align.START }), 0, 1, 1, 1); coreGrid.attach(this.commentEntry, 1, 1, 1, 1);
        coreGrid.attach(new Gtk.Label({ label: "Inherits:", halign: Gtk.Align.START }), 0, 2, 1, 1); coreGrid.attach(this.inheritsEntry, 1, 2, 1, 1);
        expCore.add(coreGrid);
        leftMainWindowBox.pack_start(expCore, false, false, 0);

        let expKde = new Gtk.Expander({ label: "<b>KDE / GNOME Специфичные</b>", use_markup: true, expanded: false });
        expKde.add(new Gtk.Label({ label: "Параметры вроде DisplayDepth или KDE Icon Theme" }));
        leftMainWindowBox.pack_start(expKde, false, false, 0);

        // --- Блок 3: Проблемы (Спойлер внизу) ---
        let expProblems = new Gtk.Expander({ label: "<b>Проблемы (0)</b>", use_markup: true, expanded: false });
        this.lblProblemsTitle = expProblems; // Сохраняем ссылку для обновления счетчика

        let probScroll = new Gtk.ScrolledWindow({ vexpand: true });
        probScroll.set_size_request(-1, 250); // Фиксированная высота, чтобы не съедало весь экран
        this.problemsList = new Gtk.ListBox();
        
        // Контекстное меню для проблем
        this.problemsList.connect('button-press-event', (widget, event) => {
            if (event.get_button()[1] === 3) { // Правая кнопка мыши
                let row = this.problemsList.get_row_at_y(event.y);
                if (row) {
                    this.problemsList.select_row(row);
                    this.showProblemContextMenu(row, event);
                    return true;
                }
            }
            return false;
        });

        // Двойной клик по проблеме
        this.problemsList.connect('row-activated', (box, row) => {
            let line = row._line;
            if (line !== undefined && line >= 0) {
                let iter = this.textBuffer.get_iter_at_line(line);
                this.textBuffer.place_cursor(iter);
                this.textView.scroll_to_iter(iter, 0.2, false, 0, 0);
                this.textView.grab_focus();
            }
        });

        probScroll.add(this.problemsList);
        expProblems.add(probScroll);
        leftMainWindowBox.pack_start(expProblems, false, false, 0);

        paned.pack1(leftMainWindowBox, true, false);

        // ================= ПРАВАЯ ПАНЕЛЬ (Текст) =================
        let rightBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5, margin: 5 });

        // Панель инструментов для текста
        let textToolbar = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 });
        let btnApplyText = new Gtk.Button({ label: "Применить текст к таблице" });
        btnApplyText.set_tooltip_text("Распарсить текущий текст и обновить левую панель");
        btnApplyText.connect('clicked', () => this.applyTextToUI());
        textToolbar.pack_start(btnApplyText, false, false, 0);
        rightBox.pack_start(textToolbar, false, false, 0);

        // Создаем таблицу тегов и сами теги
        this.tagTable = new Gtk.TextTagTable();
        this.tagError = new Gtk.TextTag({ name: "error", background: "#ffcccc", foreground: "#990000" });
        this.tagWarn = new Gtk.TextTag({ name: "warn", background: "#ffe8cc", foreground: "#996600" });
        this.tagTable.add(this.tagError);
        this.tagTable.add(this.tagWarn);

        // Создаем буфер с этой таблицей
        this.textBuffer = new Gtk.TextBuffer({ tag_table: this.tagTable });

        // Создаем TextView и передаем ему буфер
        this.textView = new Gtk.TextView({ 
            monospace: true, 
            wrap_mode: Gtk.WrapMode.NONE,
            buffer: this.textBuffer
        });

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
        this.inheritsEntry.set_text(this.theme.inherits);

        // Перерисовываем таблицу каталогов
        this.dirStore.clear();
        for (let [dirName, info] of this.theme.dirInfo) {
            let iter = this.dirStore.append();
            this.dirStore.set(iter, [0, 1, 2], [dirName, info.context || "", info.size || 0]);
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
    }

    // Заглушка для логики исправления
    fixProblem(problem) {
        print("Попытка исправить: " + problem.msg);
        if (problem.msg.includes("отсутствует на диске")) {
            let absPath = GLib.build_filenamev([this.theme.themeDir, problem.dirName]);
            try {
                Gio.File.new_for_path(absPath).make_directory(null);
                print("Каталог создан: " + absPath);
                // Обновляем данные (в реальности здесь нужно вызывать полную перезагрузку)
                this.loadThemeData(this.theme.themePath); 
            } catch (e) {
                print("Ошибка создания каталога: " + e.message);
            }
        } else {
            // Для остальных проблем пока выводим сообщение
            let dialog = new Gtk.MessageDialog({
                transient_for: this.window,
                modal: true,
                message_type: Gtk.MessageType.INFO,
                buttons: Gtk.ButtonsType.OK,
                text: "Автоматическое исправление этой проблемы пока в разработке."
            });
            dialog.run();
            dialog.destroy();
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

    showDirectoryParams(dirName) {
        this.currentSelectedDir = dirName;
        this.clearParamsUI();
        this.addParamBtn.set_sensitive(true);
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
            
            // Заполняем меню исправлений
            let children = this.fixMenu.get_children();
            for (let c of children) this.fixMenu.remove(c);

            for (let p of dirProblems) {
                let item = new Gtk.MenuItem({ label: p.msg });
                item.connect('activate', () => this.fixProblem(p));
                this.fixMenu.append(item);
            }
            this.fixMenu.show_all();
            this.btnFix.set_sensitive(true);
        } else {
            this.btnDeleteDir.set_sensitive(true); // Удалить можно любой каталог
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

    async loadThemeData(themePath) {
        let success = await this.theme.load();
        if (!success) return;

        this.nameEntry.set_text(this.theme.name || "");
        this.commentEntry.set_text(this.theme.comment || "");
        this.inheritsEntry.set_text(this.theme.inherits || "");

        // Заполняем дерево каталогов
        for (let [dirName, info] of this.theme.dirInfo) {
            let iter = this.dirStore.append();
            this.dirStore.set(iter, [0, 1, 2], [dirName, info.context || "", info.size || 0]);
        }

        // Обработчик выбора каталога (одинарный клик)
        this.dirView.get_selection().connect('changed', () => {
            let [ok, model, iter] = this.dirView.get_selection().get_selected();
            if (ok) {
                let dirName = model.get_value(iter, 0);
                this.showDirectoryParams(dirName);
            }
        });

        // ДОБАВЛЯЕМ: Обработчик двойного клика (выделение секции в тексте)
        this.dirView.connect('row-activated', (treeView, path, column) => {
            let model = treeView.get_model();
            // В GJS get_iter возвращает массив [success, iter]
            let [success, iter] = model.get_iter(path); 
            if (success && iter) {
                let dirName = model.get_value(iter, 0);
                this.selectSectionInText(dirName);
            }
        });

        // Загружаем текст в правую панель
        try {
            let file = Gio.File.new_for_path(this.theme.indexPath);
            let [ok, contents] = file.load_contents(null);
            if (ok) {
                let text = new TextDecoder('utf-8').decode(contents);
                this.textBuffer.set_text(text, -1);
            }
        } catch (e) { print("Ошибка чтения: " + e.message); }

        // Обновляем список проблем и подсветку
        this.lblProblemsTitle.set_label(`<b>Проблемы (${this.theme.problems.length})</b>`);
        let children = this.problemsList.get_children();
        for (let c of children) c.destroy();

        // Очищаем старые теги
        let start = this.textBuffer.get_start_iter();
        let end = this.textBuffer.get_end_iter();
        this.textBuffer.remove_all_tags(start, end);

        for (let p of this.theme.problems) {
            let row = new Gtk.ListBoxRow();
            let label = new Gtk.Label({ label: p.msg, halign: Gtk.Align.START, wrap: true, xalign: 0, margin: 2 });
            row.add(label);
            
            // Сохраняем метаданные в строку для двойного клика и контекстного меню
            row._line = p.line;
            row._filePath = p.filePath;
            row._targetName = p.targetName;

            // Подсветка текста
            if (p.line !== undefined && p.line >= 0) {
                try {
                    let iterStart = this.textBuffer.get_iter_at_line(p.line);
                    let iterEnd = this.textBuffer.get_iter_at_line(Math.min(p.line + 1, this.textBuffer.get_line_count()));
                    let tag = p.type === 'error' ? this.tagError : this.tagWarn;
                    this.textBuffer.apply_tag(tag, iterStart, iterEnd);
                } catch (e) {
                    print("Ошибка применения тега: " + e.message);
                }
            }

            this.problemsList.add(row);
        }
        this.problemsList.show_all();
    }
}

if (ARGV.length === 0) { print("Использование: gjs icon-theme-toolkit.js /путь/к/теме"); imports.system.exit(1); }
let app = new MainWindow(ARGV[0]);
Gtk.main();