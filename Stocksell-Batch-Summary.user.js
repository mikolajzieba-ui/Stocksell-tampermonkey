// ==UserScript==
// @name         StockSell - Batch V1.1
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Batch only with P3 Summary
// @match        https://stocksell.io/*
// @match        https://*.stocksell.io/*
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/mikolajzieba-ui/stocksell-scripts/main/Stocksell-Batch-Summary.user.js
// @updateURL    https://raw.githubusercontent.com/mikolajzieba-ui/stocksell-scripts/main/Stocksell-Batch-Summary.user.js
// ==/UserScript==
(function() {
    'use strict';

    let wskaznik = document.createElement('div');
    wskaznik.style = 'position:fixed; bottom:10px; right:10px; width:15px; height:15px; border-radius:50%; background:#ffeb3b; z-index:999999;';
    wskaznik.title = 'StockSell - Analiza Batchy';
    document.body.appendChild(wskaznik);

    let globalCsvZostalo = null;

    const domyslneStrefy = [
        'DOK',
        'P0',
        'P1',
        'P2',
        'P3'
    ];

    function aktualizujNaglowekBatchy() {

        let domSuma = 0;

        let listContainer =
            document.querySelector('app-batch-list') ||
            document.querySelector('.main-container') ||
            document.body;

        if (listContainer.innerText) {

            let blokiTekstu =
                listContainer.innerText
                    .split(/[\n\t]+/)
                    .map(t => t.trim())
                    .filter(t => t !== '');

            for (let i = 0; i < blokiTekstu.length; i++) {

                if (/^Batch\s+\d+$/i.test(blokiTekstu[i])) {

                    if (i + 1 < blokiTekstu.length) {

                        let match =
                            blokiTekstu[i + 1]
                                .match(/^(\d+)/);

                        if (match) {
                            domSuma += parseInt(match[1], 10);
                        }
                    }
                }
            }
        }

        let naglowek =
            Array.from(
                document.querySelectorAll(
                    'div, h1, h2, h3, h4, h5, span, p, mat-card-title'
                )
            ).find(el => {
                return el.childNodes.length > 0 &&
                    el.childNodes[0].nodeType === 3 &&
                    el.childNodes[0].nodeValue.trim().startsWith('Lista utworzonych batchy:');
            });

        if (!naglowek) return;

        let span =
            document.getElementById(
                'stocksell-sumy-batchy'
            );

        if (!span) {

            span =
                document.createElement(
                    'span'
                );

            span.id =
                'stocksell-sumy-batchy';

            span.style =
                'margin-left:12px; padding:3px 8px; background:#fff3e0; border:1px solid #ffb74d; border-radius:5px; color:#e65100; font-weight:bold; font-size:15px; vertical-align: middle;';

            naglowek.appendChild(
                span
            );
        }

        let tekst =
            `Suma - ${domSuma}`;

        if (globalCsvZostalo !== null) {
            tekst += ` | Zostało do zebrania - ${globalCsvZostalo}`;
        }

        span.innerText = tekst;
    }

    function analizujCSV(csvText) {

        const czystyTekst =
            csvText.replace(
                /^\uFEFF/,
                ''
            );

        const separator =
            czystyTekst.includes(';')
                ? ';'
                : ',';

        const lines =
            czystyTekst.split(
                /\r?\n/
            );

        if (lines.length < 1) return;

        const headers =
            lines[0]
                .split(separator)
                .map(
                    h =>
                    h.trim()
                        .replace(/["']/g, '')
                        .toLowerCase()
                );

        const strefaIndex =
            headers.findIndex(
                h =>
                h.includes('strefy') ||
                h.includes('strefa')
            );

        const batchIndex =
            headers.findIndex(
                h =>
                h.includes('numer batcha') ||
                h.includes('batch')
            );

        const statusIndex =
            headers.findIndex(
                h =>
                h.includes('status')
            );

        const stanIndex =
            headers.findIndex(
                h =>
                h.includes('stan')
            );

        const emailIndex =
            headers.findIndex(
                h =>
                h.includes('email')
            );

        let pominieteZDom = new Set();

        let listContainer =
            document.querySelector('app-batch-list') ||
            document.querySelector('.main-container') ||
            document.body;

        if (listContainer.innerText) {

            let blokiTekstu =
                listContainer.innerText
                    .split(/[\n\t]+/)
                    .map(t => t.trim())
                    .filter(t => t !== '');

            for (let i = 0; i < blokiTekstu.length; i++) {

                let match =
                    blokiTekstu[i]
                        .match(/^Batch\s+(\d+)$/i);

                if (!match) continue;

                let numer =
                    match[1];

                for (
                    let j = 1;
                    j <= 6 &&
                    (i + j) < blokiTekstu.length;
                    j++
                ) {

                    let textCheck =
                        blokiTekstu[i + j]
                            .toLowerCase();

                    if (
                        textCheck === 'zakończony' ||
                        textCheck === 'pakowanie'
                    ) {

                        pominieteZDom.add(
                            numer
                        );

                        break;
                    }

                    if (
                        /^Batch\s+\d+$/i.test(
                            blokiTekstu[i + j]
                        )
                    ) {
                        break;
                    }
                }
            }
        }

        let daneZgrupowane = {};
        let zostaloWBatchachStrefy = {};
        let zostaloCounter = 0;

        let p3BatchesPerWorker = {}; // Zbieranie unikalnych batchy dla P3

        for (let i = 1; i < lines.length; i++) {

            if (!lines[i].trim()) continue;

            const cols =
                lines[i].split(
                    separator
                );

            let stan = '';

            if (
                stanIndex !== -1 &&
                cols.length > stanIndex
            ) {

                stan =
                    cols[stanIndex]
                        .trim()
                        .toLowerCase();

                if (
                    stan.includes(
                        'nie spickowany'
                    )
                ) {
                    zostaloCounter++;
                }
            }

            let batch =
                cols[batchIndex]
                    ?.trim();

            let strefa =
                cols[strefaIndex]
                    ?.trim();

            let status =
                statusIndex !== -1
                    ? cols[statusIndex].trim().toLowerCase()
                    : '';

            let email =
                emailIndex !== -1
                    ? cols[emailIndex]?.trim()
                    : '';

            // LOGIKA DLA PODSUMOWANIA P3
            if (strefa && strefa.toUpperCase() === 'P3' && email && batch) {

                // Używamy fragmentów słów bez polskich znaków (zako, rozpocz), aby uniknąć błędów kodowania.
                // Wykluczamy 'nie rozpocz', aby nie liczyć nierozpoczętych batchy!
                let czyZebrany =
                    status.includes('zako') ||
                    status.includes('pakowan') ||
                    status.includes('pickowan') ||
                    (status.includes('rozpocz') && !status.includes('nie rozpocz'));

                if (czyZebrany) {
                    if (!p3BatchesPerWorker[email]) {
                        p3BatchesPerWorker[email] = new Set();
                    }
                    p3BatchesPerWorker[email].add(batch);
                }
            }

            // Poprawione pomijanie w głównym zestawieniu (również usunięte polskie znaki z 'zako')
            if (
                status.includes('zako') ||
                status.includes('pakowan') ||
                pominieteZDom.has(batch)
            ) continue;

            if (!batch) continue;

            if (!daneZgrupowane[batch]) {

                daneZgrupowane[batch] = {};
                zostaloWBatchachStrefy[batch] = {};

                domyslneStrefy.forEach(s => {

                    daneZgrupowane[batch][s] = 0;
                    zostaloWBatchachStrefy[batch][s] = 0;
                });
            }

            if (strefa) {

                daneZgrupowane[batch][strefa]++;

                if (
                    stan.includes(
                        'nie spickowany'
                    )
                ) {

                    zostaloWBatchachStrefy[batch][strefa]++;
                }
            }
        }

        globalCsvZostalo =
            zostaloCounter;

        wyswietlPodsumowanieBatchy(
            daneZgrupowane,
            zostaloWBatchachStrefy,
            p3BatchesPerWorker
        );

        aktualizujNaglowekBatchy();
    }

    // Funkcja do polskiej odmiany słowa "batch"
    function getBatchWord(count) {
        if (count === 1) return 'batch';
        let lastDigit = count % 10;
        let lastTwoDigits = count % 100;
        if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
            return 'batche';
        }
        return 'batchy';
    }

    function wyswietlPodsumowanieBatchy(daneZgrupowane, zostaloWBatchachStrefy, p3BatchesPerWorker) {

        let kontener =
            document.getElementById(
                'stocksell-strefy-summary'
            );

        if (!kontener) {

            kontener =
                document.createElement(
                    'div'
                );

            kontener.id =
                'stocksell-strefy-summary';

            kontener.style.marginTop = '40px';
            kontener.style.padding = '15px 20px';
            kontener.style.backgroundColor = '#f8f9fa';
            kontener.style.border = '1px solid #dee2e6';
            kontener.style.borderTop = '3px solid #4CAF50';
            kontener.style.borderRadius = '8px';
            kontener.style.display = 'flex';
            kontener.style.flexDirection = 'column';
            kontener.style.gap = '20px';

            let karta =
                document.querySelector(
                    'app-batch-list mat-card'
                );

            if (karta) {
                karta.appendChild(
                    kontener
                );
            }
        }

        const posortowaneBatche =
            Object.keys(
                daneZgrupowane
            ).sort(
                (a, b) =>
                parseInt(a) -
                parseInt(b)
            );

        let html =
            `<div style="display:flex; gap:20px; font-size:16px; font-weight:bold; margin-bottom:-5px; border-bottom:2px solid #e0e0e0; padding-bottom:5px;">
                <div style="flex:1; color:#455a64;">📊 Rozbicie na strefy (wszystkie aktywne)</div>
                <div style="flex:1; color:#d32f2f;">⏳ Ilość do zebrania (Nie spickowane)</div>
            </div>

            <div style="display:flex; flex-direction:column; gap:15px;">`;

        for (const batch of posortowaneBatche) {

            let sumaOgolem =
                Object.values(
                    daneZgrupowane[batch]
                ).reduce(
                    (a, b) =>
                    a + b,
                    0
                );

            let sumaZostalo =
                Object.values(
                    zostaloWBatchachStrefy[batch]
                ).reduce(
                    (a, b) =>
                    a + b,
                    0
                );

            html += `
            <div style="display:flex; gap:20px; width:100%;">

                <div style="flex:1; background:#ffffff; padding:12px; border:1px solid #cfd8dc; border-radius:6px;">

                    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">

                        <div style="font-size:14px; font-weight:bold; color:#1976d2;">
                            📦 Batch ${batch}
                        </div>

                        <div style="font-size:13px; color:#1976d2; font-weight:bold;">
                            Łącznie produktów w batchu: ${sumaOgolem} szt.
                        </div>

                    </div>

                    <div style="display:flex; gap:10px;">`;

            for (const [strefa, count] of Object.entries(daneZgrupowane[batch])) {

                html += `
                <div style="background:#e3f2fd; padding:8px 16px; border-radius:6px; border:1px solid #2196f3; min-width:60px; text-align:center; flex:1;">
                    <div style="font-size:11px; font-weight:600;">${strefa}</div>
                    <div style="font-size:18px; font-weight:bold; color:#d32f2f;">${count}</div>
                </div>`;
            }

            html += `
                    </div>
                </div>

                <div style="flex:1; background:#ffebee; padding:12px; border:1px solid #f44336; border-radius:6px;">

                    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">

                        <div style="font-size:14px; font-weight:bold; color:#1976d2;">
                            📦 Batch ${batch}
                        </div>

                        <div style="font-size:13px; color:#d32f2f; font-weight:bold;">
                            Łącznie do zebrania zostało: ${sumaZostalo} szt.
                        </div>

                    </div>

                    <div style="display:flex; gap:10px;">`;

            for (const [strefa, count] of Object.entries(zostaloWBatchachStrefy[batch])) {

                html += `
                <div style="background:#ffcdd2; padding:8px 16px; border-radius:6px; border:1px solid #f44336; min-width:60px; text-align:center; flex:1;">
                    <div style="font-size:11px; font-weight:600;">${strefa}</div>
                    <div style="font-size:18px; font-weight:bold; color:#b71c1c;">${count}</div>
                </div>`;
            }

            html += `
                    </div>
                </div>

            </div>`;
        }

        html += `</div>`;

        // DODANA SEKCJA: Podsumowanie P3
        html += `
            <div style="margin-top:15px; border-top:2px solid #e0e0e0; padding-top:15px;">
                <div style="font-size:16px; font-weight:bold; color:#2e7d32; margin-bottom:10px;">
                    🎯 Zebrane batche na P3:
                </div>
                <div style="display:flex; flex-direction:column; gap:8px;">
        `;

        let p3WorkerKeys = Object.keys(p3BatchesPerWorker || {});
        if (p3WorkerKeys.length === 0) {
            html += `<div style="font-size:14px; color:#546e7a;">Brak zebranych batchy na P3.</div>`;
        } else {
            for (const email of p3WorkerKeys) {
                let count = p3BatchesPerWorker[email].size;
                let word = getBatchWord(count);

                html += `
                    <div style="background:#e8f5e9; padding:8px 12px; border-radius:6px; border:1px solid #81c784; font-size:14px; color:#1b5e20;">
                        <strong>${email}</strong> - ${count} ${word}
                    </div>
                `;
            }
        }

        html += `</div></div>`;
        // KONIEC NOWEJ SEKCJI

        kontener.innerHTML = html;
    }

    function budujInterfejsBatchy() {

        aktualizujNaglowekBatchy();

        if (
            document.getElementById(
                'btn-awaryjny-csv'
            )
        ) return;

        let btnCsv =
            Array.from(
                document.querySelectorAll(
                    'button'
                )
            ).find(
                b =>
                b.innerText.includes(
                    'CSV'
                )
            );

        if (!btnCsv) return;

        let input =
            document.createElement(
                'input'
            );

        input.type = 'file';
        input.accept = '.csv';
        input.style.display = 'none';

        input.onchange = e => {

            let reader =
                new FileReader();

            reader.onload =
                evt =>
                analizujCSV(
                    evt.target.result
                );

            reader.readAsText(
                e.target.files[0],
                'Windows-1250'
            );
        };

        let btn =
            document.createElement(
                'button'
            );

        btn.id =
            'btn-awaryjny-csv';

        btn.type =
            'button';

        btn.innerText =
            '📂 Przelicz pobrany plik';

        btn.style =
            'margin-left:15px; padding:0 16px; height:36px; background:#ff9800; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:bold; box-shadow: 0 3px 1px -2px rgba(0,0,0,.2), 0 2px 2px 0 rgba(0,0,0,.14), 0 1px 5px 0 rgba(0,0,0,.12);';

        btn.onclick =
            () =>
            input.click();

        btnCsv.parentNode.insertBefore(
            btn,
            btnCsv.nextSibling
        );
    }

    const origCreateObjectURL =
        URL.createObjectURL;

    URL.createObjectURL =
        function(obj) {

            if (
                obj instanceof Blob
            ) {

                const reader =
                    new FileReader();

                reader.onload =
                    () =>
                    analizujCSV(
                        reader.result
                    );

                reader.readAsText(
                    obj,
                    'Windows-1250'
                );
            }

            return origCreateObjectURL.apply(
                this,
                arguments
            );
        };

   let lastUrl = '';

function initBatchPage() {

    if (
        !location.pathname.includes(
            '/packing/batch'
        )
    ) {
        return;
    }

    const batchList =
        document.querySelector(
            'app-batch-list'
        );

    const csvButton =
        Array.from(
            document.querySelectorAll(
                'button'
            )
        ).find(
            b =>
                b.innerText.includes(
                    'CSV'
                )
        );

    if (
        !batchList ||
        !csvButton
    ) {
        return;
    }

    budujInterfejsBatchy();
    aktualizujNaglowekBatchy();
}

function watchSpaNavigation() {

    if (
        location.href !==
        lastUrl
    ) {

        lastUrl =
            location.href;

        setTimeout(
            initBatchPage,
            1200
        );
    }

    requestAnimationFrame(
        watchSpaNavigation
    );
}

lastUrl =
    location.href;

setTimeout(
    initBatchPage,
    1200
);

watchSpaNavigation();

})();
