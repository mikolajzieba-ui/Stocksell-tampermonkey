// ==UserScript==
// @name         StockSell - pakiet usprawnień dla pakowaczy
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Opisy Allegro, podsumowanie batchy, lepsze boxy i analiza logów w jednym skrypcie.
// @match        https://stocksell.io/*
// @match        https://*.stocksell.io/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      allegro.pl
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-usprawnienia-pakowanie.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-usprawnienia-pakowanie.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SELECTORS = {
        scanInput: 'input.mat-input-element, input[autofocus]',
        batchList: 'app-batch-list',
        csvButton: 'button',
        logsTable: 'mat-table, .logs-table'
    };

    function isBatchPage() {
        return location.pathname.includes('/packing/batch');
    }

    function isPackingPage() {
        return location.href.includes('packing-singles') ||
            location.href.includes('packing/batch/packing');
    }

    function isLogsPage() {
        return location.href.includes('/history/logs');
    }

    function findButtonByText(text) {
        return Array.from(document.querySelectorAll('button'))
            .find(button => (button.innerText || '').includes(text));
    }

    // ---------------------------------------------------------------------
    // MODUL 1: pobieranie opisu i wad z Allegro + focus po wydruku etykiety
    // ---------------------------------------------------------------------
    (function allegroDescriptionsModule() {
        const indicator = document.createElement('div');
        indicator.id = 'ss-suite-allegro-indicator';
        indicator.style.cssText = [
            'position:fixed',
            'bottom:10px',
            'left:10px',
            'width:15px',
            'height:15px',
            'border-radius:50%',
            'z-index:999999',
            'box-shadow:0 0 5px rgba(0,0,0,.3)',
            'background:#9e9e9e'
        ].join(';');
        document.body.appendChild(indicator);

        function setIndicator(color, title) {
            indicator.style.backgroundColor = color;
            indicator.title = title;
        }

        function extractAllegroDescription(responseText) {
            const parsed = new DOMParser().parseFromString(responseText, 'text/html');
            let descriptionContainer = null;
            let defectContainer = null;

            for (const heading of parsed.querySelectorAll('h2')) {
                const text = heading.textContent.trim();
                if (text.includes('Opis Produktu')) {
                    descriptionContainer = heading.parentElement;
                } else if (text.includes('Opis Wady')) {
                    defectContainer = heading.parentElement;
                }
            }

            let result = '';
            if (descriptionContainer) {
                result += descriptionContainer.innerHTML;
            }
            if (defectContainer && defectContainer !== descriptionContainer) {
                if (result) {
                    result += "<hr style='margin:15px 0;border:0;border-top:2px dashed #856404;'>";
                }
                result += defectContainer.innerHTML;
            }

            return result || "❌ Nie znaleziono bloku 'Opis Produktu' ani 'Opis Wady' na stronie aukcji.";
        }

        function appendDescription(link, html) {
            const frame = document.createElement('div');
            frame.className = 'ss-suite-allegro-description';
            frame.style.cssText = [
                'margin-top:10px',
                'padding:12px',
                'background:#fff3cd',
                'border:1px solid #ffeeba',
                'border-left:5px solid #856404',
                'font-size:13px',
                'color:#333',
                'max-width:700px',
                'display:block',
                'white-space:normal',
                'border-radius:4px'
            ].join(';');
            frame.innerHTML = html;
            link.parentNode.appendChild(frame);
        }

        function fetchDescriptions() {
            if (!isPackingPage()) {
                setIndicator('#9e9e9e', 'Skrypt uśpiony - to nie jest strona pakowania.');
                return;
            }

            if (!document.body.innerText.includes('PACZKA ZA GRANICE!') &&
                !document.body.innerText.includes('PACZKA ZA GRANICĘ!')) {
                setIndicator('#ffeb3b', 'Brak dopisku PACZKA ZA GRANICĘ! - nie pobieram danych.');
                return;
            }

            setIndicator('#4caf50', 'Pobieranie aktywne (PACZKA ZA GRANICĘ!)');

            document.querySelectorAll('a[href*="allegro.pl/oferta/"]').forEach(link => {
                if (link.dataset.ssSuiteAllegroState) return;
                link.dataset.ssSuiteAllegroState = 'loading';

                const status = document.createElement('div');
                status.className = 'ss-suite-allegro-status';
                status.textContent = ' ✈️ Zagranica: Pobieram dane z Allegro...';
                status.style.cssText = 'color:#007bff;font-size:11px;font-weight:bold;margin-top:5px;';
                link.parentNode.appendChild(status);

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: link.href,
                    onload(response) {
                        if (response.status === 200 || response.status === 404) {
                            status.remove();
                            appendDescription(link, extractAllegroDescription(response.responseText));
                            link.dataset.ssSuiteAllegroState = 'done';
                            return;
                        }

                        status.textContent = ' ❌ Błąd Allegro - wejdź na Allegro, a następnie odśwież StockSell.';
                        status.style.color = 'red';
                        link.dataset.ssSuiteAllegroState = 'error';
                    },
                    onerror() {
                        status.textContent = ' ❌ Błąd Allegro - wejdź na Allegro, a następnie odśwież StockSell.';
                        status.style.color = 'red';
                        link.dataset.ssSuiteAllegroState = 'error';
                    }
                });
            });
        }

        document.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) return;

            const text = button.innerText?.trim() || '';
            if (!text.includes('Wydrukuj ostatnia etykiete') &&
                !text.includes('Wydrukuj ostatnią etykiete') &&
                !text.includes('Wydrukuj ostatnią etykietę')) return;

            const input = document.querySelector(SELECTORS.scanInput);
            if (input) {
                input.focus();
                input.click();
                input.select?.();
            }
            console.log('[StockSell Suite] Kliknięto drukowanie ostatniej etykiety.');
        });

        fetchDescriptions();
        setInterval(fetchDescriptions, 1500);
    })();

    // ---------------------------------------------------------------------
    // MODUL 2: analiza CSV i podsumowanie batchy
    // ---------------------------------------------------------------------
    (function batchSummaryModule() {
        const indicator = document.createElement('div');
        indicator.id = 'ss-suite-batch-indicator';
        indicator.style.cssText = [
            'position:fixed',
            'bottom:10px',
            'right:10px',
            'width:15px',
            'height:15px',
            'border-radius:50%',
            'background:#ffeb3b',
            'z-index:999999'
        ].join(';');
        indicator.title = 'StockSell - Analiza Batchy';
        document.body.appendChild(indicator);

        let globalCsvRemaining = null;
        const defaultZones = ['DOK', 'P0', 'P1', 'P2', 'P3'];

        function updateBatchHeading() {
            let domTotal = 0;
            const listContainer = document.querySelector(SELECTORS.batchList) ||
                document.querySelector('.main-container') || document.body;

            if (listContainer.innerText) {
                const blocks = listContainer.innerText
                    .split(/[\n\t]+/)
                    .map(text => text.trim())
                    .filter(Boolean);

                for (let index = 0; index < blocks.length; index++) {
                    if (!/^Batch\s+\d+$/i.test(blocks[index]) || index + 1 >= blocks.length) continue;
                    const match = blocks[index + 1].match(/^(\d+)/);
                    if (match) domTotal += Number.parseInt(match[1], 10);
                }
            }

            const heading = Array.from(document.querySelectorAll(
                'div, h1, h2, h3, h4, h5, span, p, mat-card-title'
            )).find(element => element.childNodes.length > 0 &&
                element.childNodes[0].nodeType === Node.TEXT_NODE &&
                element.childNodes[0].nodeValue.trim().startsWith('Lista utworzonych batchy:'));

            if (!heading) return;

            let summary = document.getElementById('stocksell-sumy-batchy');
            if (!summary) {
                summary = document.createElement('span');
                summary.id = 'stocksell-sumy-batchy';
                summary.style.cssText = [
                    'margin-left:12px',
                    'padding:3px 8px',
                    'background:#fff3e0',
                    'border:1px solid #ffb74d',
                    'border-radius:5px',
                    'color:#e65100',
                    'font-weight:bold',
                    'font-size:15px',
                    'vertical-align:middle'
                ].join(';');
                heading.appendChild(summary);
            }

            summary.textContent = `Suma - ${domTotal}` +
                (globalCsvRemaining === null ? '' : ` | Zostało do zebrania - ${globalCsvRemaining}`);
        }

        function getSkippedBatchesFromDom() {
            const skipped = new Set();
            const listContainer = document.querySelector(SELECTORS.batchList) ||
                document.querySelector('.main-container') || document.body;
            if (!listContainer.innerText) return skipped;

            const blocks = listContainer.innerText
                .split(/[\n\t]+/)
                .map(text => text.trim())
                .filter(Boolean);

            for (let index = 0; index < blocks.length; index++) {
                const match = blocks[index].match(/^Batch\s+(\d+)$/i);
                if (!match) continue;

                for (let offset = 1; offset <= 6 && index + offset < blocks.length; offset++) {
                    const next = blocks[index + offset].toLowerCase();
                    if (next === 'zakonczony' || next === 'zakończony' || next === 'pakowanie') {
                        skipped.add(match[1]);
                        break;
                    }
                    if (/^Batch\s+\d+$/i.test(blocks[index + offset])) break;
                }
            }
            return skipped;
        }

        function getBatchWord(count) {
            if (count === 1) return 'batch';
            const lastDigit = count % 10;
            const lastTwoDigits = count % 100;
            if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
                return 'batche';
            }
            return 'batchy';
        }

        function renderBatchSummary(grouped, remainingByBatchAndZone, p3BatchesPerWorker) {
            let container = document.getElementById('stocksell-strefy-summary');
            if (!container) {
                const card = document.querySelector('app-batch-list mat-card');
                if (!card) return;

                container = document.createElement('div');
                container.id = 'stocksell-strefy-summary';
                container.style.cssText = [
                    'margin-top:40px',
                    'padding:15px 20px',
                    'background:#f8f9fa',
                    'border:1px solid #dee2e6',
                    'border-top:3px solid #4caf50',
                    'border-radius:8px',
                    'display:flex',
                    'flex-direction:column',
                    'gap:20px'
                ].join(';');
                card.appendChild(container);
            }

            const sortedBatches = Object.keys(grouped)
                .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

            let html = `
                <div style="display:flex;gap:20px;font-size:16px;font-weight:bold;margin-bottom:-5px;border-bottom:2px solid #e0e0e0;padding-bottom:5px">
                    <div style="flex:1;color:#455a64">📊 Rozbicie na strefy (wszystkie aktywne)</div>
                    <div style="flex:1;color:#d32f2f">⏳ Ilość do zebrania (Nie spickowane)</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:15px">`;

            for (const batch of sortedBatches) {
                const total = Object.values(grouped[batch]).reduce((sum, value) => sum + value, 0);
                const remaining = Object.values(remainingByBatchAndZone[batch])
                    .reduce((sum, value) => sum + value, 0);

                html += `
                    <div style="display:flex;gap:20px;width:100%">
                        <div style="flex:1;background:#fff;padding:12px;border:1px solid #cfd8dc;border-radius:6px">
                            <div style="display:flex;justify-content:space-between;margin-bottom:10px">
                                <div style="font-size:14px;font-weight:bold;color:#1976d2">📦 Batch ${batch}</div>
                                <div style="font-size:13px;color:#1976d2;font-weight:bold">Łącznie produktów w batchu: ${total} szt.</div>
                            </div>
                            <div style="display:flex;gap:10px">`;

                for (const [zone, count] of Object.entries(grouped[batch])) {
                    html += `
                        <div style="background:#e3f2fd;padding:8px 16px;border-radius:6px;border:1px solid #2196f3;min-width:60px;text-align:center;flex:1">
                            <div style="font-size:11px;font-weight:600">${zone}</div>
                            <div style="font-size:18px;font-weight:bold;color:#d32f2f">${count}</div>
                        </div>`;
                }

                html += `
                            </div>
                        </div>
                        <div style="flex:1;background:#ffebee;padding:12px;border:1px solid #f44336;border-radius:6px">
                            <div style="display:flex;justify-content:space-between;margin-bottom:10px">
                                <div style="font-size:14px;font-weight:bold;color:#1976d2">📦 Batch ${batch}</div>
                                <div style="font-size:13px;color:#d32f2f;font-weight:bold">Łącznie do zebrania zostało: ${remaining} szt.</div>
                            </div>
                            <div style="display:flex;gap:10px">`;

                for (const [zone, count] of Object.entries(remainingByBatchAndZone[batch])) {
                    html += `
                        <div style="background:#ffcdd2;padding:8px 16px;border-radius:6px;border:1px solid #f44336;min-width:60px;text-align:center;flex:1">
                            <div style="font-size:11px;font-weight:600">${zone}</div>
                            <div style="font-size:18px;font-weight:bold;color:#b71c1c">${count}</div>
                        </div>`;
                }

                html += '</div></div></div>';
            }

            html += `
                </div>
                <div style="margin-top:15px;border-top:2px solid #e0e0e0;padding-top:15px">
                    <div style="font-size:16px;font-weight:bold;color:#2e7d32;margin-bottom:10px">🎯 Zebrane batche na P3:</div>
                    <div style="display:flex;flex-direction:column;gap:8px">`;

            const workers = Object.keys(p3BatchesPerWorker || {});
            if (!workers.length) {
                html += '<div style="font-size:14px;color:#546e7a">Brak zebranych batchy na P3.</div>';
            } else {
                for (const email of workers) {
                    const count = p3BatchesPerWorker[email].size;
                    html += `
                        <div style="background:#e8f5e9;padding:8px 12px;border-radius:6px;border:1px solid #81c784;font-size:14px;color:#1b5e20">
                            <strong>${email}</strong> - ${count} ${getBatchWord(count)}
                        </div>`;
                }
            }

            container.innerHTML = html + '</div></div>';
        }

        function analyzeCsv(csvText) {
            if (typeof csvText !== 'string') return false;

            const cleanText = csvText.replace(/^\uFEFF/, '');
            const lines = cleanText.split(/\r?\n/);
            if (!lines.length) return false;

            const separator = lines[0].includes(';') ? ';' : ',';
            const headers = lines[0].split(separator)
                .map(header => header.trim().replace(/["']/g, '').toLowerCase());

            const zoneIndex = headers.findIndex(header => header.includes('strefy') || header.includes('strefa'));
            const batchIndex = headers.findIndex(header => header.includes('numer batcha') || header.includes('batch'));
            const statusIndex = headers.findIndex(header => header.includes('status'));
            const stateIndex = headers.findIndex(header => header.includes('stan'));
            const emailIndex = headers.findIndex(header => header.includes('email'));

            if (zoneIndex === -1 || batchIndex === -1) return false;

            const skippedFromDom = getSkippedBatchesFromDom();
            const grouped = {};
            const remainingByBatchAndZone = {};
            const p3BatchesPerWorker = {};
            let remainingCounter = 0;

            for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
                if (!lines[rowIndex].trim()) continue;
                const columns = lines[rowIndex].split(separator);

                const state = stateIndex !== -1 && columns.length > stateIndex
                    ? columns[stateIndex].trim().toLowerCase()
                    : '';
                if (state.includes('nie spickowany')) remainingCounter++;

                const batch = columns[batchIndex]?.trim();
                const zone = columns[zoneIndex]?.trim();
                const status = statusIndex !== -1 ? (columns[statusIndex] || '').trim().toLowerCase() : '';
                const email = emailIndex !== -1 ? columns[emailIndex]?.trim() : '';

                if (zone?.toUpperCase() === 'P3' && email && batch) {
                    const collected = status.includes('zako') ||
                        status.includes('pakowan') ||
                        status.includes('pickowan') ||
                        (status.includes('rozpocz') && !status.includes('nie rozpocz'));
                    if (collected) {
                        if (!p3BatchesPerWorker[email]) p3BatchesPerWorker[email] = new Set();
                        p3BatchesPerWorker[email].add(batch);
                    }
                }

                if (status.includes('zako') || status.includes('pakowan') || skippedFromDom.has(batch)) continue;
                if (!batch) continue;

                if (!grouped[batch]) {
                    grouped[batch] = {};
                    remainingByBatchAndZone[batch] = {};
                    defaultZones.forEach(defaultZone => {
                        grouped[batch][defaultZone] = 0;
                        remainingByBatchAndZone[batch][defaultZone] = 0;
                    });
                }

                if (zone) {
                    if (!(zone in grouped[batch])) {
                        grouped[batch][zone] = 0;
                        remainingByBatchAndZone[batch][zone] = 0;
                    }
                    grouped[batch][zone]++;
                    if (state.includes('nie spickowany')) remainingByBatchAndZone[batch][zone]++;
                }
            }

            globalCsvRemaining = remainingCounter;
            renderBatchSummary(grouped, remainingByBatchAndZone, p3BatchesPerWorker);
            updateBatchHeading();
            return true;
        }

        function readCsvBlob(blob) {
            const reader = new FileReader();
            reader.onload = () => analyzeCsv(reader.result);
            reader.readAsText(blob, 'Windows-1250');
        }

        function installCsvDownloadHook() {
            const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const pageUrlApi = pageWindow.URL;
            if (!pageUrlApi?.createObjectURL || pageUrlApi.createObjectURL.__ssSuiteHooked) return;

            const originalCreateObjectURL = pageUrlApi.createObjectURL;
            const hookedCreateObjectURL = function (object) {
                if (isBatchPage() && Object.prototype.toString.call(object) === '[object Blob]') {
                    try {
                        readCsvBlob(object);
                    } catch (error) {
                        console.warn('[StockSell Suite] Nie udało się odczytać pobieranego CSV.', error);
                    }
                }
                return originalCreateObjectURL.apply(this, arguments);
            };

            Object.defineProperty(hookedCreateObjectURL, '__ssSuiteHooked', { value: true });
            pageUrlApi.createObjectURL = hookedCreateObjectURL;
        }

        function buildBatchInterface() {
            updateBatchHeading();
            if (document.getElementById('btn-awaryjny-csv')) return;

            const csvButton = findButtonByText('CSV');
            if (!csvButton) return;

            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv,text/csv';
            input.style.display = 'none';
            input.addEventListener('change', event => {
                const file = event.target.files?.[0];
                if (!file) return;
                readCsvBlob(file);
                event.target.value = '';
            });

            const button = document.createElement('button');
            button.id = 'btn-awaryjny-csv';
            button.type = 'button';
            button.textContent = '📂 Przelicz pobrany plik';
            button.style.cssText = [
                'margin-left:15px',
                'padding:0 16px',
                'height:36px',
                'background:#ff9800',
                'color:#fff',
                'border:none',
                'border-radius:4px',
                'cursor:pointer',
                'font-weight:bold',
                'box-shadow:0 3px 1px -2px rgba(0,0,0,.2),0 2px 2px 0 rgba(0,0,0,.14),0 1px 5px 0 rgba(0,0,0,.12)'
            ].join(';');
            button.addEventListener('click', () => input.click());

            csvButton.parentNode.insertBefore(button, csvButton.nextSibling);
            csvButton.parentNode.insertBefore(input, button.nextSibling);
        }

        function initBatchPage() {
            if (!isBatchPage()) {
                indicator.style.backgroundColor = '#9e9e9e';
                indicator.title = 'Analiza batchy uśpiona - inna podstrona.';
                return;
            }

            const batchList = document.querySelector(SELECTORS.batchList);
            const csvButton = findButtonByText('CSV');
            if (!batchList || !csvButton) {
                indicator.style.backgroundColor = '#ffeb3b';
                indicator.title = 'Oczekiwanie na widok batchy.';
                return;
            }

            indicator.style.backgroundColor = '#4caf50';
            indicator.title = 'Analiza batchy aktywna.';
            buildBatchInterface();
            updateBatchHeading();
        }

        installCsvDownloadHook();
        initBatchPage();
        setInterval(initBatchPage, 1000);
    })();

    // ---------------------------------------------------------------------
    // MODUL 3: lepsze boxy batchy
    // ---------------------------------------------------------------------
    (function betterBatchBoxesModule() {
        GM_addStyle(`
            html.ss-suite-boxes-active .grid {
                display:grid !important;
                grid-template-columns:repeat(auto-fill,78px) !important;
                gap:12px !important;
                justify-content:start !important;
            }
            html.ss-suite-boxes-active .box {
                width:78px !important;
                height:78px !important;
                min-width:78px !important;
                min-height:78px !important;
                display:flex !important;
                flex-direction:column !important;
                justify-content:center !important;
                align-items:center !important;
                padding:15px 4px 4px !important;
                box-sizing:border-box !important;
                border-radius:8px !important;
                position:relative !important;
                transition:transform .15s ease !important;
            }
            html.ss-suite-boxes-active .box:hover { transform:scale(1.05); }
            html.ss-suite-boxes-active .box.ss-suite-wide-box {
                grid-column:span 2 !important;
                width:168px !important;
                min-width:168px !important;
            }
            html.ss-suite-boxes-active .courier-tag {
                position:absolute !important;
                top:3px !important;
                right:3px !important;
                font-size:12px !important;
                font-weight:900 !important;
                padding:2px 6px !important;
                border-radius:5px !important;
                background:rgba(0,0,0,.30) !important;
                line-height:1 !important;
                z-index:5 !important;
                letter-spacing:.5px !important;
                text-transform:uppercase !important;
                min-width:24px !important;
                text-align:center !important;
            }
            html.ss-suite-boxes-active .order-name {
                line-height:1 !important;
                text-align:center !important;
                display:flex !important;
                flex-direction:column !important;
                align-items:center !important;
                justify-content:center !important;
                width:100% !important;
                height:100% !important;
            }
            html.ss-suite-boxes-active .batch-prefix {
                font-weight:900 !important;
                font-family:Arial Black,Arial,sans-serif !important;
                opacity:1 !important;
                line-height:1 !important;
                color:#fff !important;
                text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000 !important;
            }
            html.ss-suite-boxes-active .batch-prefix-normal { font-size:14px !important;margin-bottom:5px !important; }
            html.ss-suite-boxes-active .batch-prefix-medium { font-size:14px !important;margin-bottom:3px !important; }
            html.ss-suite-boxes-active .batch-prefix-small { font-size:11px !important;margin-bottom:2px !important; }
            html.ss-suite-boxes-active .batch-suffix {
                display:block !important;
                font-weight:900 !important;
                font-family:Arial Black,Arial,sans-serif !important;
                line-height:1 !important;
                color:#111 !important;
                white-space:nowrap !important;
                text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff !important;
            }
            html.ss-suite-boxes-active .batch-suffix-normal { font-size:34px !important;letter-spacing:1px !important; }
            html.ss-suite-boxes-active .batch-suffix-medium { font-size:24px !important;letter-spacing:.5px !important; }
            html.ss-suite-boxes-active .batch-suffix-small { font-size:16px !important;letter-spacing:0 !important; }
            html.ss-suite-boxes-active .box:not([style*="rgb(255, 204, 0)"]) .batch-suffix {
                color:#fff !important;
                text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000 !important;
            }
        `);

        function stylizeBatches() {
            const labels = document.querySelectorAll('.order-name');
            document.documentElement.classList.toggle('ss-suite-boxes-active', labels.length > 0);

            labels.forEach(label => {
                if (label.querySelector('.batch-prefix')) return;

                const text = label.textContent.replace(/\s+/g, ' ').trim();
                const match = text.match(/^(Batch\s+\d+\s+)(.+)$/i);
                if (!match) return;

                const prefixText = match[1].trim();
                const suffixText = match[2].trim();
                const itemCount = suffixText.split(' ').length;

                let mode = 'normal';
                if (itemCount === 2 || (itemCount === 1 && suffixText.length >= 5)) {
                    mode = 'medium';
                } else if (itemCount >= 3) {
                    mode = 'small';
                }

                const prefix = document.createElement('span');
                prefix.className = `batch-prefix batch-prefix-${mode}`;
                prefix.textContent = prefixText;

                const suffix = document.createElement('span');
                suffix.className = `batch-suffix batch-suffix-${mode}`;
                suffix.textContent = suffixText;

                label.replaceChildren(prefix, suffix);
                label.closest('.box')?.classList.toggle('ss-suite-wide-box', mode !== 'normal');
            });
        }

        let scheduled = false;
        const observer = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                stylizeBatches();
            });
        });

        stylizeBatches();
        observer.observe(document.body, { childList: true, subtree: true });
    })();

    // ---------------------------------------------------------------------
    // MODUL 4: reczna analiza zaladowanych logow
    // ---------------------------------------------------------------------
    (function logsModule() {
        const productCache = {};
        const renderedLists = new Set();

        GM_addStyle(`
            #ss-unpacked-panel{background:#f8f9fa;border:1px solid #dee2e6;border-left:4px solid #f44336;border-radius:4px;padding:15px;margin-bottom:15px}
            .ss-panel-title{font-weight:bold;margin-bottom:10px}
            .ss-batch-buttons{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
            .ss-batch-btn{background:#1976d2;color:#fff;border:none;padding:8px 16px;border-radius:20px;cursor:pointer}
            .ss-batch-btn:hover{opacity:.9}
            .ss-batch-btn.active{background:#0d47a1}
            .ss-batch-btn.disabled{background:#9e9e9e;cursor:default}
            .ss-batch-content{display:none;border:1px solid #bbdefb;background:#fff;padding:10px;margin-bottom:10px;contain:layout}
            .ss-item-row{padding:6px 0;border-bottom:1px solid #eee}
            .ss-order{color:#d32f2f;font-weight:bold;cursor:pointer}
            .ss-table-link{color:#1976d2;font-weight:bold;cursor:pointer}
            #ss-manual-trigger{background:#4caf50;margin-bottom:15px;display:block;font-weight:bold}
        `);

        function openBaseLinker(order) {
            window.open(`https://panel.baselinker.com/orders.php#order:${order}`, '_blank');
        }

        function getLastNumber(text) {
            const matches = text.match(/\d+/g);
            return matches ? matches[matches.length - 1] : '';
        }

        function buildBatchContent(batch, items, content) {
            if (renderedLists.has(batch)) return;
            const fragment = document.createDocumentFragment();

            items.forEach(item => {
                const row = document.createElement('div');
                row.className = 'ss-item-row';
                row.append(document.createTextNode(`${item.user} | ${item.segment} | ${item.code} | `));

                const order = document.createElement('span');
                order.className = 'ss-order';
                order.textContent = item.order;
                order.addEventListener('click', () => openBaseLinker(item.order));
                row.appendChild(order);
                fragment.appendChild(row);
            });

            content.appendChild(fragment);
            renderedLists.add(batch);
        }

        function renderLogsPanel() {
            const grouped = {};
            Object.values(productCache)
                .filter(item => item.hasPick && !item.hasPack)
                .forEach(item => {
                    if (!grouped[item.batch]) grouped[item.batch] = [];
                    grouped[item.batch].push(item);
                });

            const table = document.querySelector('mat-table');
            if (!table) return;

            let panel = document.getElementById('ss-unpacked-panel');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'ss-unpacked-panel';
                table.parentNode.insertBefore(panel, table);
            }
            panel.replaceChildren();

            const title = document.createElement('div');
            title.className = 'ss-panel-title';
            title.textContent = 'Produkty oczekujące na spakowanie';
            panel.appendChild(title);

            const buttonWrapper = document.createElement('div');
            buttonWrapper.className = 'ss-batch-buttons';
            panel.appendChild(buttonWrapper);

            const contentWrapper = document.createElement('div');
            panel.appendChild(contentWrapper);

            Object.keys(grouped).forEach(batch => {
                const items = grouped[batch];
                const canExpand = items.length <= 20;

                const button = document.createElement('button');
                button.type = 'button';
                button.className = canExpand ? 'ss-batch-btn' : 'ss-batch-btn disabled';
                button.textContent = `${batch} (${items.length})`;
                buttonWrapper.appendChild(button);
                if (!canExpand) return;

                const content = document.createElement('div');
                content.className = 'ss-batch-content';
                contentWrapper.appendChild(content);

                button.addEventListener('pointerdown', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                }, true);

                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!renderedLists.has(batch)) buildBatchContent(batch, items, content);

                    const isOpen = content.style.display === 'block';
                    content.style.display = isOpen ? 'none' : 'block';
                    button.classList.toggle('active', !isOpen);
                });
            });
        }

        function analyzeLogs() {
            const table = document.querySelector(SELECTORS.logsTable);
            if (!table) return;

            table.querySelectorAll('mat-row.mat-row:not(.ss-scanned)').forEach(row => {
                const typeColumn = row.querySelector('.mat-column-type');
                const productColumn = row.querySelector('.mat-column-product');
                const batchColumn = row.querySelector('.batch-column, .mat-column-batch');
                const userColumn = row.querySelector('.mat-column-user');
                const elementColumn = row.querySelector('.mat-column-element');

                if (!typeColumn || !productColumn || !batchColumn) {
                    row.classList.add('ss-scanned');
                    return;
                }

                const type = typeColumn.textContent.trim().toLowerCase();
                const productText = productColumn.textContent.trim();
                const order = getLastNumber(productText);
                const codeMatch = productText.match(/\((\d+)\)/);
                const code = codeMatch ? codeMatch[1] : 'BRAK';
                const batch = batchColumn.textContent.trim().split('-')[0].trim();
                const id = `${order}_${code}`;

                if (!productCache[id]) {
                    productCache[id] = {
                        hasPick: false,
                        hasPack: false,
                        batch,
                        order,
                        code,
                        user: userColumn ? userColumn.textContent.trim() : 'System',
                        segment: elementColumn ? elementColumn.textContent.split('(')[0].trim() : 'Brak'
                    };
                }

                if (type === 'pick') productCache[id].hasPick = true;
                if (type.includes('start pack')) productCache[id].hasPack = true;

                if (order && !batchColumn.dataset.ssdone) {
                    batchColumn.dataset.ssdone = '1';
                    batchColumn.textContent = `${batch} - ${order}`;
                    batchColumn.classList.add('ss-table-link');
                    batchColumn.addEventListener('click', event => {
                        event.preventDefault();
                        event.stopPropagation();
                        openBaseLinker(order);
                    });
                }

                row.classList.add('ss-scanned');
            });

            renderLogsPanel();
        }

        function resetLogsState() {
            Object.keys(productCache).forEach(key => delete productCache[key]);
            renderedLists.clear();
            document.getElementById('ss-unpacked-panel')?.remove();
            document.querySelectorAll('.ss-scanned').forEach(element => element.classList.remove('ss-scanned'));
        }

        function injectManualTrigger(table) {
            const button = document.createElement('button');
            button.id = 'ss-manual-trigger';
            button.className = 'ss-batch-btn';
            button.textContent = '📊 Analizuj załadowane logi';
            button.addEventListener('click', event => {
                event.preventDefault();
                resetLogsState();
                analyzeLogs();
            });
            table.parentNode.insertBefore(button, table);
        }

        function initLogsPage() {
            if (!isLogsPage()) return;
            const table = document.querySelector(SELECTORS.logsTable);
            if (table && !document.getElementById('ss-manual-trigger')) injectManualTrigger(table);
        }

        initLogsPage();
        setInterval(initLogsPage, 1000);
    })();
})();
