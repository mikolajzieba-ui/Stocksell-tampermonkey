// ==UserScript==
// @name         StockTime - Kalendarz Świąt i Raport Urlopów
// @namespace    http://tampermonkey.net/
// @version      3.3.0
// @description  Święta (w tym Wigilia), dni okołoświąteczne i raport CSV zatwierdzonych wniosków urlopowych.
// @match        *://*.stocktime.pl/*
// @match        *://stocktime.pl/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const DAY = 86400000;
    const MIN_YEAR = 2011;
    const MAX_YEAR = 2099;
    const holidaysCache = new Map();
    const nearbyCache = new Map();
    const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    const normalize = value => clean(value).toLocaleLowerCase('pl').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
    const personKey = value => clean(value).normalize('NFC').toLocaleLowerCase('pl');
    const yearOf = day => new Date(day * DAY).getUTCFullYear();
    const dayNumber = (year, month, day) => Date.UTC(year, month - 1, day) / DAY;
    const isoDate = day => new Date(day * DAY).toISOString().slice(0, 10);
    const plDate = day => isoDate(day).split('-').reverse().join('.');

    function parseDate(value) {
        const str = clean(value);
        const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
        const pl = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(str);
        if (!iso && !pl) return null;
        const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(pl[3]), Number(pl[2]), Number(pl[1])];
        if (year < MIN_YEAR || year > MAX_YEAR) return null;
        const number = dayNumber(year, month, day);
        const date = new Date(number * DAY);
        return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
            ? number : null;
    }

    function easter(year) {
        const a = year % 19, b = Math.floor(year / 100), c = year % 100;
        const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const n = h + l - 7 * m + 114;
        return dayNumber(year, Math.floor(n / 31), n % 31 + 1);
    }

    function holidays(year) {
        if (holidaysCache.has(year)) return holidaysCache.get(year);
        const result = new Map();
        const add = (month, day, name) => result.set(dayNumber(year, month, day), name);
        add(1, 1, 'Nowy Rok');
        add(1, 6, 'Święto Trzech Króli');
        add(5, 1, 'Święto Pracy');
        add(5, 3, 'Święto Konstytucji 3 Maja');
        add(8, 15, 'Wniebowzięcie NMP');
        add(11, 1, 'Wszystkich Świętych');
        add(11, 11, 'Święto Niepodległości');
        // Wigilia jest ustawowo wolna od 2025 roku.
        if (year >= 2025) add(12, 24, 'Wigilia');
        add(12, 25, 'Boże Narodzenie — pierwszy dzień');
        add(12, 26, 'Boże Narodzenie — drugi dzień');
        const sunday = easter(year);
        result.set(sunday, 'Wielkanoc');
        result.set(sunday + 1, 'Poniedziałek Wielkanocny');
        result.set(sunday + 49, 'Zielone Świątki');
        result.set(sunday + 60, 'Boże Ciało');
        holidaysCache.set(year, result);
        return result;
    }

    function workingDay(day) {
        const weekday = new Date(day * DAY).getUTCDay();
        return weekday !== 0 && weekday !== 6 && !holidays(yearOf(day)).has(day);
    }

    function holidaySurroundings(holiday) {
        let before = holiday - 1, after = holiday + 1;
        while (!workingDay(before)) before--;
        while (!workingDay(after)) after++;
        return { before, after };
    }

    function holidayPeriods(from, to) {
        if (from === null || to === null || from > to) throw new Error('Podaj poprawny zakres dat: od nie później niż do.');
        const periods = new Map();
        for (let year = yearOf(from) - 1; year <= yearOf(to) + 1; year++) {
            for (const [holiday, name] of holidays(year)) {
                const weekday = new Date(holiday * DAY).getUTCDay();
                if (weekday === 0 || weekday === 6) continue;
                const { before, after } = holidaySurroundings(holiday);
                if (after < from || before > to) continue;
                // Kolejne święta rozdzielone wyłącznie dniami wolnymi mają te same
                // graniczne dni robocze, więc stanowią jeden okres (np. 24–26.12.2025).
                const key = `${before}:${after}`;
                if (!periods.has(key)) periods.set(key, { before, after, holidays: [] });
                periods.get(key).holidays.push({ day: holiday, name });
            }
        }
        return [...periods.values()].sort((a, b) => a.before - b.before).map(period => ({
            ...period, holidays: period.holidays.sort((a, b) => a.day - b.day)
        }));
    }

    function nearbyDays(year, weekdayHolidaysOnly = false) {
        const cacheKey = `${year}:${weekdayHolidaysOnly}`;
        if (nearbyCache.has(cacheKey)) return nearbyCache.get(cacheKey);
        const result = new Map();
        // Sąsiednie lata obejmują m.in. 31 grudnia przed Nowym Rokiem.
        for (let y = year - 1; y <= year + 1; y++) {
            for (const [holiday, name] of holidays(y)) {
                const weekday = new Date(holiday * DAY).getUTCDay();
                // Raport pomija święta weekendowe jako powód zaliczenia urlopu.
                // Nadal omijamy je przy szukaniu dni roboczych wokół pozostałych świąt.
                if (weekdayHolidaysOnly && (weekday === 0 || weekday === 6)) continue;
                const { before, after } = holidaySurroundings(holiday);
                for (const day of [before, after]) {
                    if (yearOf(day) !== year) continue;
                    if (!result.has(day)) result.set(day, new Set());
                    result.get(day).add(name);
                }
            }
        }
        nearbyCache.set(cacheKey, result);
        return result;
    }

    function touchesNearby(start, end, weekdayHolidaysOnly = false) {
        if (start === null || end === null || start > end) return false;
        for (let year = yearOf(start); year <= yearOf(end); year++) {
            for (const day of nearbyDays(year, weekdayHolidaysOnly).keys()) if (day >= start && day <= end) return true;
        }
        return false;
    }

    function parsePeriod(text) {
        const from = /\bOd\s+(\d{2}\.\d{2}\.\d{4})/i.exec(text);
        const to = /\bDo\s+(\d{2}\.\d{2}\.\d{4})/i.exec(text);
        if (!from || !to) return null;
        const start = parseDate(from[1]), end = parseDate(to[1]);
        return start !== null && end !== null && start <= end ? { start, end } : null;
    }

    function countRequests(records, extraPeople, from, to) {
        if (from === null || to === null || from > to) throw new Error('Podaj poprawny zakres dat: od nie później niż do.');
        const periods = holidayPeriods(from, to);
        const people = new Map();
        const addPerson = name => {
            name = clean(name);
            if (!name) throw new Error('Nie odczytano nazwiska pracownika. Raport nie został utworzony.');
            const key = personKey(name);
            if (!people.has(key)) people.set(key, { name, count: 0, leaveRanges: [] });
            return people.get(key);
        };
        for (const name of extraPeople) if (clean(name)) addPerson(name);
        const ids = new Map();
        for (const record of records) {
            const person = addPerson(record.name);
            // Tylko identyczne rekordy o tym samym ID są duplikatami.
            // Dwa odrębne wnioski na te same daty nadal liczymy osobno.
            if (record.id) {
                const signature = JSON.stringify([record.name, record.start, record.end, record.approved, record.leave]);
                if (ids.has(record.id)) {
                    if (ids.get(record.id) !== signature) throw new Error('Dane wniosków zmieniły się podczas odczytu. Spróbuj ponownie.');
                    continue;
                }
                ids.set(record.id, signature);
            }
            if (!record.leave) continue;
            if (record.start === null || record.end === null || record.start > record.end) {
                throw new Error(`Nie odczytano terminu urlopu: ${record.name}. Raport nie został utworzony.`);
            }
            const start = Math.max(from, record.start), end = Math.min(to, record.end);
            // Dzień okołoświąteczny musi leżeć także WEWNĄTRZ zakresu raportu.
            if (!periods.some(period => [period.before, period.after].some(day => day >= start && day <= end))) continue;
            if (record.approved === null) {
                throw new Error(`Nie rozpoznano statusu urlopu: ${record.name}. Oczekiwano ikony statusu albo tekstu „zaakceptowany”, „odrzucony” lub „oczekujący”.`);
            }
            if (record.approved) {
                person.count++;
                // Pełny termin zaliczonego wniosku; nie przycinamy go do zakresu raportu.
                person.leaveRanges.push({ start: record.start, end: record.end, id: record.id || '' });
            }
        }
        for (const person of people.values()) {
            person.leaveRanges.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id, 'pl', { numeric: true }));
        }
        return [...people.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl'));
    }

    function csvCell(value) {
        let text = String(value);
        if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }

    function reportData(people, from, to) {
        const periods = holidayPeriods(from, to);
        const periodList = periods.map(period => `${period.holidays.map(holiday => holiday.name).join(' + ')} [${plDate(period.before)} – ${plDate(period.after)}]`).join(' | ');
        const headers = [
            'Pracownik', 'Liczba zatwierdzonych urlopów w okolicach świąt', 'Współczynnik (%)', 'Od', 'Do',
            'Przedziały zaliczonych urlopów (pełne terminy wniosków)',
            'Liczba okresów świątecznych w zakresie', 'Współczynnik (urlopy / okresy świąteczne)',
            'Okresy świąteczne uwzględnione w mianowniku'
        ];
        const rows = people.map(person => [
            person.name, person.count, periods.length ? person.count / periods.length : 'nie dotyczy', isoDate(from), isoDate(to),
            person.leaveRanges.map(range => `${plDate(range.start)} – ${plDate(range.end)}${range.id ? ` (ID: ${range.id})` : ''}`).join(' | '),
            periods.length,
            periods.length ? person.count / periods.length : 'nie dotyczy',
            periodList
        ]);
        return { headers, rows };
    }

    function makeCsv(people, from, to) {
        const data = reportData(people, from, to);
        const rows = [data.headers, ...data.rows.map(row => row.map((value, index) => {
            if (typeof value === 'number' && index === 2) return (100 * value).toFixed(2).replace('.', ',') + '%';
            if (typeof value === 'number' && index === 7) return value.toFixed(4).replace('.', ',');
            return value;
        }))];
        return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
    }

    // Niewielki generator XLSX bez zewnętrznych bibliotek i połączeń z siecią.
    // XLSX to ZIP z dokumentami XML. Metoda STORE nie wymaga kompresora w przeglądarce.
    function zipFiles(files) {
        const encoder = new TextEncoder();
        const crcTable = Array.from({ length: 256 }, (_, index) => {
            let crc = index;
            for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
            return crc >>> 0;
        });
        const crc32 = bytes => {
            let crc = 0xffffffff;
            for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
            return (crc ^ 0xffffffff) >>> 0;
        };
        const localParts = [], directory = [];
        let offset = 0, directorySize = 0;
        for (const [path, xml] of files) {
            const name = encoder.encode(path), bytes = encoder.encode(xml), crc = crc32(bytes);
            const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(12, 33, true);
            lv.setUint32(14, crc, true); lv.setUint32(18, bytes.length, true); lv.setUint32(22, bytes.length, true);
            lv.setUint16(26, name.length, true); local.set(name, 30);
            localParts.push(local, bytes);
            const entry = new Uint8Array(46 + name.length), ev = new DataView(entry.buffer);
            ev.setUint32(0, 0x02014b50, true); ev.setUint16(4, 20, true); ev.setUint16(6, 20, true);
            ev.setUint16(14, 33, true); ev.setUint32(16, crc, true); ev.setUint32(20, bytes.length, true);
            ev.setUint32(24, bytes.length, true); ev.setUint16(28, name.length, true); ev.setUint32(42, offset, true);
            entry.set(name, 46); directory.push(entry); directorySize += entry.length;
            offset += local.length + bytes.length;
        }
        const end = new Uint8Array(22), view = new DataView(end.buffer);
        view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
        view.setUint32(12, directorySize, true); view.setUint32(16, offset, true);
        const output = new Uint8Array(offset + directorySize + end.length);
        let position = 0;
        for (const part of [...localParts, ...directory, end]) { output.set(part, position); position += part.length; }
        return output;
    }

    function makeXlsx(people, from, to) {
        const data = reportData(people, from, to);
        const xml = value => String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const widths = [28, 25, 20, 14, 14, 75, 23, 25, 120];
        const rows = [data.headers, ...data.rows].map((row, index) => {
            const cells = row.map((value, column) => {
                const reference = String.fromCharCode(65 + column) + (index + 1);
                if (index && typeof value === 'number') {
                    const style = column === 2 ? 2 : column === 7 ? 4 : 1;
                    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
                }
                if (String(value).length > 32767) throw new Error('Jedno z pól przekracza limit komórki Excela. Pobierz ten raport jako CSV.');
                return `<c r="${reference}" s="${index ? 0 : 3}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
            }).join('');
            const lines = index ? Math.max(...row.map((value, col) => typeof value === 'number' ? 1 : Math.ceil(String(value).length / (widths[col] - 3)))) : 4;
            return `<row r="${index + 1}" ht="${Math.max(24, lines * 16)}" customHeight="1">${cells}</row>`;
        }).join('');
        const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
        const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
        return zipFiles([
            ['[Content_Types].xml', declaration + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
            ['_rels/.rels', declaration + `<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
            ['xl/workbook.xml', declaration + `<workbook xmlns="${spreadsheet}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Urlopy przy świętach" sheetId="1" r:id="rId1"/></sheets></workbook>`],
            ['xl/_rels/workbook.xml.rels', declaration + `<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
            ['xl/styles.xml', declaration + `<styleSheet xmlns="${spreadsheet}"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF005B58"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
            ['xl/worksheets/sheet1.xml', declaration + `<worksheet xmlns="${spreadsheet}"><dimension ref="A1:I${data.rows.length + 1}"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="3" ySplit="1" topLeftCell="D2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${widths.map((width, col) => `<col min="${col + 1}" max="${col + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:I${data.rows.length + 1}"/></worksheet>`]
        ]);
    }

    // Pozwala testować ten sam kod obliczeń w Node, bez kopii implementacji.
    if (typeof module === 'object' && module.exports && typeof document === 'undefined') {
        module.exports = { parseDate, isoDate, holidays, nearbyDays, holidayPeriods, parsePeriod, countRequests, makeCsv, makeXlsx };
        return;
    }

    const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    const tableLoads = new WeakMap();
    let exportBusy = false;
    let scheduled = false;
    const css = `
        td.sth-holiday .fc-daygrid-day-frame { background: #e53935 !important; }
        td.sth-nearby .fc-daygrid-day-frame { background: #fb8c00 !important; }
        td.sth-holiday .fc-daygrid-day-number, td.sth-nearby .fc-daygrid-day-number {
            color: #fff !important; font-weight: bold; text-shadow: 1px 1px 2px #0006;
        }
        .sth-badge { color: #a63d00; font-weight: bold; font-size: 10px; padding: 3px 5px;
            background: #ffe0b2; border: 1px solid #ffcc80; border-radius: 4px;
            display: block; width: fit-content; margin: 5px auto 0; white-space: nowrap; }
        #sth-report { border: 1px solid #b7d5d3; border-radius: 8px; padding: 16px; margin: 16px 0;
            color: #173b3a; background: #f2f8f7; font: 14px/1.5 system-ui, sans-serif; text-align: left; }
        #sth-report * { box-sizing: border-box; }
        #sth-report h3 { margin: 0 0 8px; font-size: 18px; color: #005b58; }
        #sth-report p { margin: 6px 0; }
        #sth-report .sth-controls { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin: 14px 0; }
        #sth-report label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; }
        #sth-report input, #sth-report textarea { border: 1px solid #94b9b6; border-radius: 4px;
            padding: 8px; font: inherit; background: #fff; color: #173b3a; }
        #sth-report input { width: 165px; }
        #sth-report button { border: 0; border-radius: 4px; padding: 10px 16px; background: #005b58;
            color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
        #sth-report button:disabled { opacity: .6; cursor: wait; }
        #sth-report textarea { width: 100%; min-height: 100px; margin-top: 8px; }
        #sth-report summary { cursor: pointer; }
        #sth-result { white-space: pre-line; }
        #sth-result[data-error="true"] { color: #a21d24; }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function getApi(table) {
        const jq = pageWindow.jQuery;
        const api = jq?.fn?.dataTable?.isDataTable(table) ? jq(table).DataTable()
            : pageWindow.DataTable?.isDataTable(table) ? new pageWindow.DataTable.Api(table) : null;
        const settings = api?.settings()[0];
        if (settings && !tableLoads.has(settings)) {
            const state = { pending: 0, error: false };
            tableLoads.set(settings, state);
            api.on('preXhr.sthLoading', () => { state.pending++; state.error = false; });
            api.on('xhr.sthLoading', (_event, _settings, json) => {
                state.pending = Math.max(0, state.pending - 1);
                state.error = !json;
            });
        }
        return api;
    }

    function cellElement(value) {
        if (value?.nodeType) return value;
        // W szablonie obrazy, skrypty i obsługa kliknięć pozostają nieaktywne.
        const template = document.createElement('template');
        template.innerHTML = String(value ?? '');
        return template.content;
    }

    function cellText(cell) {
        const copy = cell.cloneNode(true);
        copy.querySelectorAll('script, style, input, select, button, .sth-badge').forEach(el => el.remove());
        copy.querySelectorAll('br').forEach(el => el.replaceWith(document.createTextNode(' ')));
        copy.querySelectorAll('div, p').forEach(el => { el.prepend(' '); el.append(' '); });
        return clean(copy.textContent);
    }

    function columns(table, api) {
        const headers = api ? api.columns().header().toArray()
            : Array.from(table.tHead?.rows || []).map(row => Array.from(row.cells))
                .sort((a, b) => b.length - a.length)[0] || [];
        const names = headers.map(header => normalize(cellText(header)));
        return {
            size: names.length,
            person: names.findIndex(name => /imie.*nazwisko|^pracownik$/.test(name)),
            period: names.findIndex(name => /termin urlopu|termin nieobecnosci/.test(name)),
            from: names.findIndex(name => /^(od|data od|data rozpoczecia)$/.test(name)),
            to: names.findIndex(name => /^(do|data do|data zakonczenia)$/.test(name)),
            id: names.findIndex(name => /^(id|id wniosku)$/.test(name)),
            type: names.findIndex(name => /rodzaj urlopu|typ urlopu|rodzaj nieobecnosci/.test(name)),
            status: names.findIndex(name => /status/.test(name))
        };
    }

    function validColumns(cols) {
        return cols.person >= 0 && cols.type >= 0 && cols.status >= 0
            && (cols.period >= 0 || (cols.from >= 0 && cols.to >= 0));
    }

    function findTable() {
        const candidates = [...document.querySelectorAll('table')];
        // Pomijamy kopie nagłówka tworzone przez przewijanie DataTables.
        return candidates.find(table => {
            const api = getApi(table);
            return api && validColumns(columns(table, api));
        }) || candidates.find(table => table.tBodies.length && validColumns(columns(table, null))) || null;
    }

    function tableScope(table) {
        return table.closest('main, [role="main"]') || document;
    }

    function tableWrapper(table) {
        return table.closest('.dataTables_wrapper, .dt-container') || table;
    }

    function periodFromCells(cells, cols) {
        if (cols.period >= 0) return cells[cols.period] ? parsePeriod(cellText(cells[cols.period])) : null;
        const start = cells[cols.from] ? parseDate(cellText(cells[cols.from])) : null;
        const end = cells[cols.to] ? parseDate(cellText(cells[cols.to])) : null;
        return start !== null && end !== null && start <= end ? { start, end } : null;
    }

    function approvedStatus(cell) {
        // title="Odrzuć" na ZIELONEJ ikonie to akcja, nie status!
        const images = [...cell.querySelectorAll('img, svg, i, .icon-green, .icon-red')];
        const green = images.some(el => el.classList.contains('icon-green') || /(?:^|\/)true\.svg(?:[?#]|$)/i.test(el.getAttribute('src') || ''));
        const red = images.some(el => el.classList.contains('icon-red') || /(?:^|\/)false\.svg(?:[?#]|$)/i.test(el.getAttribute('src') || ''));
        if (red) return false; // sama czerwona = odrzucony, obie = oczekujący
        if (green) return true;
        const text = normalize(cellText(cell));
        if (/odrzucon|oczekuj|anulowan|niezaakceptowan|niezatwierdzon/.test(text)) return false;
        if (/^(zaakceptowan[ay e]*|zatwierdzon[ay e]*|accepted|approved)$/.test(text)) return true;
        return null;
    }

    function parseRecord(cells, cols, rowIndex) {
        const name = cellText(cells[cols.person]);
        const kind = normalize(cellText(cells[cols.type]));
        if (!kind) throw new Error(`Brak rodzaju nieobecności w wierszu ${rowIndex + 1}.`);
        const period = periodFromCells(cells, cols);
        const statusCell = cells[cols.status];
        const id = cols.id >= 0 ? cellText(cells[cols.id])
            : statusCell.querySelector('.urlop_akceptuj[data-id], .urlop_odrzuc[data-id]')?.getAttribute('data-id') || '';
        return { id, name, start: period?.start ?? null, end: period?.end ?? null,
            leave: /\burlop\b/.test(kind), approved: approvedStatus(statusCell) };
    }

    function apiRecords(api, cols) {
        return api.rows({ search: 'none', page: 'all' }).indexes().toArray().map((index, rowIndex) => {
            // render('display') działa też dla ukrytych kolumn i deferRender.
            const cells = Array.from({ length: cols.size }, (_, col) => {
                const cell = api.cell(index, col);
                return cell.node() || cellElement(cell.render('display'));
            });
            return parseRecord(cells, cols, rowIndex);
        });
    }

    function drawPage(api, index) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(new Error('Przekroczono czas pobierania strony wniosków. Spróbuj ponownie.')), 20000);
            const onDraw = () => finish();
            const onError = () => finish(new Error('StockTime zgłosił błąd pobierania wniosków. CSV nie został utworzony.'));
            function finish(error) {
                clearTimeout(timer);
                api.off('draw.sthExport', onDraw);
                api.off('error.sthExport dt-error.sthExport', onError);
                error ? reject(error) : resolve();
            }
            api.on('draw.sthExport', onDraw);
            api.on('error.sthExport dt-error.sthExport', onError);
            try { api.page(index).draw('page'); } catch (error) { finish(error); }
        });
    }

    async function collectRecords(table, api, cols, progress) {
        if (!api) {
            // Bez API nie ma wiarygodnej informacji, czy DOM zawiera wszystkie strony.
            throw new Error('Nie ma dostępu do pełnej tabeli StockTime. Odśwież stronę po zapisaniu wtyczki i poczekaj na załadowanie tabeli.');
        }
        const settings = api.settings()[0];
        if (settings?._bInitComplete === false || settings?.bDrawing || (settings?.jqXHR && settings.jqXHR.readyState < 4)) {
            throw new Error('Trwa ładowanie tabeli StockTime. Zaczekaj na wyświetlenie wniosków i ponów pobieranie.');
        }
        const initial = api.page.info();
        if (!initial.serverSide) {
            const records = apiRecords(api, cols);
            if (records.length !== initial.recordsTotal) throw new Error('Nie odczytano wszystkich wniosków. Odśwież tabelę i spróbuj ponownie.');
            return records;
        }
        // Filtry dat są na czas odczytu zawieszane przez collectForReport.
        if (initial.recordsDisplay !== initial.recordsTotal || api.search() || api.columns().search().toArray().some(Boolean)) {
            throw new Error('Wyczyść pozostałe filtry StockTime (wyszukiwanie, status, typ urlopu, pracownik lub dział) i ponów pobieranie. Filtry dat obsługujemy automatycznie.');
        }
        const records = [];
        const seenIds = new Set();
        const order = JSON.stringify(api.order());
        let changedPage = false;
        let failure;
        try {
            for (let page = 0; page < initial.pages; page++) {
                progress(`Odczyt wniosków: strona ${page + 1} z ${initial.pages}. Poczekaj z obsługą tabeli do zakończenia.`);
                changedPage = true;
                await drawPage(api, page);
                const info = api.page.info();
                if (info.page !== page || info.recordsTotal !== initial.recordsTotal || info.recordsDisplay !== initial.recordsTotal
                    || info.length !== initial.length || JSON.stringify(api.order()) !== order) {
                    throw new Error('Tabela zmieniła się podczas odczytu. Spróbuj ponownie, nie zmieniając filtrów ani sortowania.');
                }
                const batch = apiRecords(api, cols);
                if (batch.length !== info.end - info.start) throw new Error('Niepełna strona wniosków. CSV nie został utworzony.');
                for (const record of batch) {
                    if (!record.id || seenIds.has(record.id)) throw new Error('Nie można potwierdzić kompletności stron wniosków. Odśwież stronę i spróbuj ponownie.');
                    seenIds.add(record.id);
                    records.push(record);
                }
            }
            if (records.length !== initial.recordsTotal) throw new Error('Nie odczytano wszystkich stron. CSV nie został utworzony.');
        } catch (error) { failure = error; }
        finally {
            if (changedPage) {
                try { await drawPage(api, initial.page); }
                catch { failure = failure || new Error('Nie udało się przywrócić strony tabeli. Odśwież StockTime i ponów eksport.'); }
            }
        }
        if (failure) throw failure;
        return records;
    }

    function controlDescription(control) {
        const labels = [...(control.labels || [])].map(label => label.textContent);
        const sibling = control.previousElementSibling;
        if (sibling?.tagName === 'LABEL') labels.push(sibling.textContent);
        return normalize([control.id, control.name, control.getAttribute('aria-label'), ...labels].join(' '));
    }

    function nativeDateFilters(table) {
        const inputs = [...tableScope(table).querySelectorAll('input[type="date"]')]
            .filter(input => !input.closest('#sth-report, dialog, .modal') && input.getClientRects().length);
        const from = inputs.filter(input => /(^|[\s_(-])od([\s_)-]|$)|from|start|min.*date|date.*min/.test(controlDescription(input)));
        const to = inputs.filter(input => /(^|[\s_(-])do([\s_)-]|$)|until|end|max.*date|date.*max/.test(controlDescription(input)));
        if (from.length === 1 && to.length === 1 && from[0] !== to[0]) return [from[0], to[0]];
        // W „Złożonych wnioskach” dwa pola mogą nie mieć etykiet.
        return inputs.length === 2 ? inputs : null;
    }

    function setNativeDates(filters, values, api) {
        const changed = filters.filter((input, index) => input.value !== values[index]);
        if (!changed.length) return;
        const drawBefore = api?.settings()[0]?.iDraw;
        // Oba pola ustawiamy przed pierwszym zdarzeniem, bez przejściowego zakresu.
        filters.forEach((input, index) => { input.value = values[index]; });
        changed.forEach(input => {
            input.dispatchEvent(new pageWindow.Event('input', { bubbles: true }));
            input.dispatchEvent(new pageWindow.Event('change', { bubbles: true }));
        });
        // Obsługa filtrów, których callback tylko aktualizuje warunek wyszukiwania.
        if (api && api.settings()[0]?.iDraw === drawBefore) api.draw();
    }

    function syncReportDates(table, panel) {
        const filters = nativeDateFilters(table);
        if (!filters) throw new Error('Nie rozpoznano pary filtrów dat w StockTime. Oczekiwano dwóch pól daty „Od” i „Do”.');
        setNativeDates(filters, [panel.querySelector('#sth-from').value, panel.querySelector('#sth-to').value], getApi(table));
        return filters;
    }

    async function waitForTable(api) {
        if (!api) return;
        const deadline = Date.now() + 20000;
        let settled = 0;
        while (Date.now() < deadline) {
            const settings = api.settings()[0];
            const loading = tableLoads.get(settings);
            if (loading?.error && !loading.pending) throw new Error('StockTime zgłosił błąd pobierania danych. CSV nie został utworzony.');
            const busy = settings?._bInitComplete === false || settings?.bDrawing
                || loading?.pending || (settings?.jqXHR && settings.jqXHR.readyState < 4);
            settled = busy ? 0 : settled + 1;
            if (settled >= 3) return;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Trwa ładowanie tabeli StockTime lub serwer nie odpowiedział. Zaczekaj na wnioski i ponów eksport.');
    }

    function hasOtherFilters(table) {
        const year = yearSelection(table);
        return [...tableScope(table).querySelectorAll('input, select')].some(control => {
            if (control === year || control.closest('#sth-report, .dataTables_length, .dt-length')
                || !control.getClientRects().length || control.disabled) return false;
            if (control.tagName === 'SELECT') {
                const label = normalize(control.selectedOptions[0]?.textContent);
                return !!control.value && !/^[\s\-–—]*(wszyst|wybierz)/.test(label);
            }
            return ['text', 'search'].includes(control.type) && !!clean(control.value);
        });
    }

    async function collectForReport(table, api, cols, filters, progress) {
        await waitForTable(api);
        const settings = api?.settings()[0];
        const fetchesData = api?.page.info().serverSide || settings?.ajax || settings?.sAjaxSource;
        if (fetchesData && hasOtherFilters(table)) {
            throw new Error('Wyczyść pozostałe filtry StockTime (wyszukiwanie, status, typ urlopu, pracownik lub dział) i ponów pobieranie. Filtry dat obsługujemy automatycznie.');
        }
        if (!fetchesData || filters.every(input => !input.value)) {
            return collectRecords(table, api, cols, progress);
        }
        // Pobieramy pełną historię, aby zachować zera i wnioski przecinające zakres.
        // Po odczycie (również przy błędzie) wracamy do dat wybranych przez użytkownika.
        const dates = filters.map(input => input.value);
        const page = api.page();
        let records;
        let failure;
        try {
            progress('Odczyt pełnej historii. Po pobraniu wrócimy do wybranych filtrów dat…');
            setNativeDates(filters, ['', ''], api);
            await waitForTable(api);
            records = await collectRecords(table, api, cols, progress);
        } catch (error) { failure = error; }
        finally {
            try {
                setNativeDates(filters, dates, api);
                await waitForTable(api);
                const targetPage = Math.max(0, Math.min(page, api.page.info().pages - 1));
                if (api.page() !== targetPage) await drawPage(api, targetPage);
            } catch (error) {
                failure = new Error(`Nie udało się odświeżyć tabeli po przywróceniu dat. ${error.message}`);
            }
        }
        if (failure) throw failure;
        return records;
    }

    function yearSelection(table) {
        // Selektor „Rok” jest poza wrapperem DataTables; rozpoznajemy go po opcjach.
        const scope = tableScope(table);
        return [...scope.querySelectorAll('select')].find(select => {
            if (select.closest('#sth-report') || tableWrapper(table).contains(select)) return false;
            const options = [...select.options].map(option => clean(option.textContent));
            return options.some(text => /^20\d{2}$/.test(text)) && options.every(text => /^20\d{2}$/.test(text) || /wszyst|wybierz/i.test(text));
        }) || null;
    }

    function selectedYear(table) {
        const select = yearSelection(table);
        const text = clean(select?.selectedOptions[0]?.textContent);
        return /^20\d{2}$/.test(text) ? Number(text) : null;
    }

    function rosterFromFilter(table, api, cols) {
        // Tylko opcje filtra kolumny pracownika; nigdy lista działów lub statusów.
        const header = api?.column(cols.person).header();
        const selects = new Set([...(header?.querySelectorAll('select') || []),
            ...[...tableScope(table).querySelectorAll('select')].filter(select =>
                !select.closest('#sth-report') && /pracownik|employee/.test(controlDescription(select)))]);
        return [...selects].flatMap(select => [...select.options])
            .filter(option => option.value && !/wybierz|wszyscy|wszystkie/i.test(option.textContent))
            .map(option => clean(option.textContent));
    }

    function download(content, filename, type = 'text/csv;charset=utf-8;') {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }

    function mountReport(table) {
        if (document.getElementById('sth-report')) return;
        const api = getApi(table);
        const cols = columns(table, api);
        if (!validColumns(cols)) return;
        const year = selectedYear(table) || new Date().getFullYear();
        const panel = document.createElement('section');
        panel.id = 'sth-report';
        panel.setAttribute('aria-label', 'Raport urlopów w okolicach świąt');
        panel.innerHTML = `
            <h3>Urlopy w okolicach świąt — raport CSV / Excel</h3>
            <p>Liczymy <strong>zatwierdzone wnioski</strong> (sama zielona ikona lub status „zaakceptowany”). Jeden wniosek = jeden raz, niezależnie od liczby dni i świąt.</p>
            <p>Okolice świąt to najbliższy dzień roboczy przed świętem i po nim. Dni robocze: poniedziałek–piątek, bez świąt.</p>
            <p>W raporcie pomijamy święta przypadające w sobotę lub niedzielę. Urlop jest liczony, jeśli obejmuje dzień w okolicach święta przypadającego od poniedziałku do piątku.</p>
            <details>
                <summary>Terminy urlopów i współczynnik w CSV</summary>
                <p>CSV zawiera pełne daty każdego zaliczonego wniosku. Współczynnik = liczba tych wniosków / liczba okresów świątecznych w zakresie, np. 2 / 4 = 50%.</p>
                <p>Kolejne święta, między którymi nie ma dnia roboczego, tworzą jeden okres. Okres obejmuje też najbliższy dzień roboczy przed świętami i po nich; liczymy go, jeśli przecina wybrane daty. Listę okresów znajdziesz w CSV.</p>
                <p>Kilka osobnych wniosków przy jednym okresie może dać wynik ponad 100%. Gdy w zakresie nie ma okresów świątecznych, współczynnik ma wartość „nie dotyczy”. Wigilia 24.12.2025 jest uwzględniona jako dzień wolny.</p>
            </details>
            <div class="sth-controls">
                <label>Od <input id="sth-from" type="date" value="${year}-01-01" min="2011-01-01" max="2099-12-31"></label>
                <label>Do <input id="sth-to" type="date" value="${year}-12-31" min="2011-01-01" max="2099-12-31"></label>
                <button id="sth-download" type="button">Pobierz raport CSV</button>
                <button id="sth-download-excel" type="button">Pobierz raport Excel</button>
            </div>
            <p>Excel (XLSX) automatycznie wyświetla trzecią kolumnę w procentach. CSV zapisuje wartości ze znakiem %.</p>
            <p>Wybrane daty automatycznie ustawiają filtry „Od” i „Do” w StockTime.</p>
            <p id="sth-scope"></p>
            <details>
                <summary>Lista pracowników — uwzględnij także osoby bez żadnego wniosku</summary>
                <p>Raport zawiera wszystkich pracowników znalezionych w odczytanej historii wniosków, także z wynikiem 0.
                    Uwzględniamy też osoby z listy filtra „Pracownik”. Pozostałe osoby dopisz poniżej — po jednej w wierszu, w kolejności imienia i nazwiska jak w danej tabeli StockTime.
                    Możesz też wkleić pełną listę pracowników; powtórzone nazwiska zostaną połączone.</p>
                <label>Dodatkowi pracownicy<textarea id="sth-roster" placeholder="Jan Kowalski&#10;Anna Nowak&#10;Roman Tyczny"></textarea></label>
                <p>Lista służy tylko temu eksportowi i nie jest zapisywana w przeglądarce. Osoby o identycznym imieniu i nazwisku zostaną zsumowane.</p>
            </details>
            <p id="sth-result" role="status" aria-live="polite"></p>`;
        const anchor = tableWrapper(table);
        anchor.before(panel);
        const initialDates = nativeDateFilters(table);
        if (initialDates) initialDates.forEach((input, index) => {
            if (parseDate(input.value) !== null) panel.querySelector(index === 0 ? '#sth-from' : '#sth-to').value = input.value;
        });
        const reportError = error => {
            const result = panel.querySelector('#sth-result');
            result.dataset.error = 'true';
            result.textContent = error.message || 'Nie udało się utworzyć raportu.';
        };
        panel.querySelectorAll('#sth-from, #sth-to').forEach(input => {
            const sync = () => {
                if (exportBusy) return;
                try {
                    const currentTable = findTable();
                    if (currentTable) syncReportDates(currentTable, panel);
                } catch (error) { reportError(error); }
            };
            input.addEventListener('input', sync);
            input.addEventListener('change', sync);
        });
        async function exportReport(format) {
            if (exportBusy) return;
            const result = panel.querySelector('#sth-result');
            const progress = message => { result.textContent = message; result.dataset.error = 'false'; };
            const inputs = [...panel.querySelectorAll('input, textarea, button')];
            const locked = new Map();
            const readOnlyFields = new Map();
            try {
                table = findTable();
                if (!table) throw new Error('Otwórz tabelę „Złożone wnioski” lub „Archiwum urlopów” i ponów eksport.');
                const from = parseDate(panel.querySelector('#sth-from').value);
                const to = parseDate(panel.querySelector('#sth-to').value);
                if (from === null || to === null || from > to) throw new Error('Podaj poprawny zakres dat: od nie później niż do.');
                const dataYear = selectedYear(table);
                if (dataYear && (yearOf(from) !== dataYear || yearOf(to) !== dataYear)) {
                    throw new Error(`StockTime udostępnia teraz dane za rok ${dataYear}. Wybierz ten sam rok w datach raportu albo zmień pole „Rok” w StockTime. Zakres wielu lat wymaga opcji „Wszystkie lata” w StockTime.`);
                }
                exportBusy = true;
                progress('Odczyt wszystkich dostępnych wniosków…');
                const currentApi = getApi(table);
                const currentCols = columns(table, currentApi);
                if (!validColumns(currentCols)) {
                    throw new Error('Nie rozpoznano kolumn tabeli urlopów. Odśwież stronę i spróbuj ponownie.');
                }
                const filters = syncReportDates(table, panel);
                // Nie blokujemy natywnych pól: disabled wykluczyłoby je z serializacji formularza.
                filters.forEach(input => { readOnlyFields.set(input, input.readOnly); input.readOnly = true; });
                inputs.forEach(input => { locked.set(input, input.disabled); input.disabled = true; });
                const records = await collectForReport(table, currentApi, currentCols, filters, progress);
                if (selectedYear(table) !== dataYear) throw new Error('Rok w StockTime zmienił się podczas odczytu. Ponów eksport.');
                const extraPeople = panel.querySelector('#sth-roster').value.split(/\r?\n/).map(clean).filter(Boolean);
                extraPeople.push(...rosterFromFilter(table, currentApi, currentCols));
                const people = countRequests(records, extraPeople, from, to);
                if (!people.length) throw new Error('Brak pracowników w odczytanych danych. Dodaj listę pracowników lub sprawdź wybrany rok.');
                const filename = `StockTime_urlopy_przy_swietach_${isoDate(from)}_${isoDate(to)}`;
                if (format === 'xlsx') download(makeXlsx(people, from, to), filename + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                else download(makeCsv(people, from, to), filename + '.csv');
                const total = people.reduce((sum, person) => sum + person.count, 0);
                progress(`Pobrano ${format.toUpperCase()} z terminami urlopów i współczynnikiem. Pracownicy: ${people.length}; pasujące zatwierdzone wnioski: ${total}; osoby z wynikiem 0: ${people.filter(person => person.count === 0).length}.\nOkresy świąteczne w mianowniku: ${holidayPeriods(from, to).length}. Odczytano ${records.length} wniosków ze wszystkich stron dostępnej historii. Zakres osób: historia, filtr „Pracownik” i dodatkowa lista.`);
            } catch (error) {
                reportError(error);
            } finally {
                exportBusy = false;
                locked.forEach((disabled, input) => { input.disabled = disabled; });
                readOnlyFields.forEach((readOnly, input) => { input.readOnly = readOnly; });
            }
        }
        panel.querySelector('#sth-download').addEventListener('click', () => exportReport('csv'));
        panel.querySelector('#sth-download-excel').addEventListener('click', () => exportReport('xlsx'));
    }

    function updateScope(table) {
        const label = document.getElementById('sth-scope');
        if (!label) return;
        const year = selectedYear(table);
        const text = year ? `Źródło: historia wniosków za rok ${year} wybrany w StockTime. Daty raportu dotyczą terminu urlopu.`
            : 'Źródło: pełna historia udostępniona w tabeli StockTime. Daty raportu dotyczą terminu urlopu.';
        if (label.textContent !== text) label.textContent = text;
    }

    function decorateCalendar() {
        document.querySelectorAll('td[data-date]').forEach(cell => {
            const day = parseDate(cell.dataset.date);
            if (day === null) return;
            const holiday = holidays(yearOf(day)).has(day);
            const near = !holiday && nearbyDays(yearOf(day)).has(day);
            if (cell.classList.contains('sth-holiday') !== holiday) cell.classList.toggle('sth-holiday', holiday);
            if (cell.classList.contains('sth-nearby') !== near) cell.classList.toggle('sth-nearby', near);
        });
    }

    function decorateRequests(table) {
        const api = getApi(table);
        const cols = columns(table, api);
        if (!validColumns(cols)) return;
        const index = cols.period >= 0 ? cols.period : cols.to;
        table.querySelectorAll('tbody tr').forEach(row => {
            const cells = api ? Array.from({ length: cols.size }, (_, col) => api.cell(row, col).node()) : [...row.cells];
            const cell = cells[index];
            if (!cell) return;
            const period = periodFromCells(cells, cols);
            const near = period && touchesNearby(period.start, period.end);
            const badge = cell.querySelector('.sth-badge');
            if (!near) { badge?.remove(); return; }
            if (!badge) {
                const warning = document.createElement('div');
                warning.className = 'sth-badge';
                warning.textContent = '⚠ DZIEŃ W OKOLICACH ŚWIĄT';
                cell.appendChild(warning);
            }
        });
    }

    function refresh() {
        scheduled = false;
        decorateCalendar();
        const table = findTable();
        if (table) {
            mountReport(table);
            updateScope(table);
            decorateRequests(table);
        } else document.getElementById('sth-report')?.remove();
    }

    function scheduleRefresh() {
        if (!scheduled) { scheduled = true; setTimeout(refresh, 200); }
    }

    new MutationObserver(mutations => {
        if (mutations.some(mutation => !mutation.target.closest?.('#sth-report'))) scheduleRefresh();
    }).observe(document.body, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['data-date'] });
    document.addEventListener('change', scheduleRefresh);
    // Rezerwa dla inicjalizacji DataTables bez zmiany DOM, np. późnego skryptu.
    setInterval(scheduleRefresh, 3000);
    refresh();
})();
