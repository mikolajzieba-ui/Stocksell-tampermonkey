// ==UserScript==
// @name         StockSell - Logs V4.6 (Manual Trigger)
// @namespace    http://tampermonkey.net/
// @version      4.7
// @match        https://stocksell.io/*
// @match        https://*.stocksell.io/*
// @grant        GM_addStyle
// @run-at       document-idle
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/stocksell-sprawdzanie-niespakowanych.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/stocksell-sprawdzanie-niespakowanych.user.js
// ==/UserScript==

(function () {
    'use strict';

    const produktyCache = {};
    const renderedLists = new Set();

    GM_addStyle(`
        #ss-unpacked-panel{
            background:#f8f9fa;
            border:1px solid #dee2e6;
            border-left:4px solid #f44336;
            border-radius:4px;
            padding:15px;
            margin-bottom:15px;
        }

        .ss-panel-title{
            font-weight:bold;
            margin-bottom:10px;
        }

        .ss-batch-buttons{
            display:flex;
            gap:10px;
            flex-wrap:wrap;
            margin-bottom:10px;
        }

        .ss-batch-btn{
            background:#1976d2;
            color:white;
            border:none;
            padding:8px 16px;
            border-radius:20px;
            cursor:pointer;
        }

        .ss-batch-btn:hover {
            opacity: 0.9;
        }

        .ss-batch-btn.active{
            background:#0d47a1;
        }

        .ss-batch-btn.disabled{
            background:#9e9e9e;
            cursor:default;
        }

        .ss-batch-content{
            display:none;
            border:1px solid #bbdefb;
            background:white;
            padding:10px;
            margin-bottom:10px;
            contain:layout;
        }

        .ss-item-row{
            padding:6px 0;
            border-bottom:1px solid #eee;
        }

        .ss-order{
            color:#d32f2f;
            font-weight:bold;
            cursor:pointer;
        }

        .ss-table-link{
            color:#1976d2;
            font-weight:bold;
            cursor:pointer;
        }

        #ss-manual-trigger {
            background: #4caf50;
            margin-bottom: 15px;
            display: block;
            font-weight: bold;
        }
    `);

    function openBL(order){
        window.open(
            `https://panel.baselinker.com/orders.php#order:${order}`,
            '_blank'
        );
    }

    function getLastNumber(text){
        const matches = text.match(/\d+/g);
        if (!matches) return '';
        return matches[matches.length - 1];
    }

    function analizujLogi(){
        const tabela = document.querySelector('mat-table') || document.querySelector('.logs-table');
        if (!tabela) return;

        const rows = tabela.querySelectorAll('mat-row.mat-row:not(.ss-scanned)');

        rows.forEach(row => {
            const colType = row.querySelector('.mat-column-type');
            const colProd = row.querySelector('.mat-column-product');
            const colBatch = row.querySelector('.batch-column, .mat-column-batch');
            const colUser = row.querySelector('.mat-column-user');
            const colElem = row.querySelector('.mat-column-element');

            if (!colType || !colProd || !colBatch){
                row.classList.add('ss-scanned');
                return;
            }

            const typ = colType.textContent.trim().toLowerCase();
            const fullText = colProd.textContent.trim();
            const order = getLastNumber(fullText);
            const kodMatch = fullText.match(/\((\d+)\)/);
            const kod = kodMatch ? kodMatch[1] : 'BRAK';

            // Bezpieczne pobranie batcha (nawet jeśli skrypt dodał już tam numer zamówienia)
            const batch = colBatch.textContent.trim().split('-')[0].trim();
            const id = order + "_" + kod;

            if (!produktyCache[id]) {
                produktyCache[id] = {
                    hasPick:false,
                    hasPack:false,
                    batch,
                    order,
                    kod,
                    user: colUser ? colUser.textContent.trim() : 'System',
                    segment: colElem ? colElem.textContent.split('(')[0].trim() : 'Brak'
                };
            }

            if (typ === 'pick'){
                produktyCache[id].hasPick = true;
            }

            if (typ.includes('start pack')){
                produktyCache[id].hasPack = true;
            }

            if (order && !colBatch.dataset.ssdone){
                colBatch.dataset.ssdone = '1';
                colBatch.textContent = `${batch} - ${order}`;
                colBatch.classList.add('ss-table-link');
                colBatch.onclick = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    openBL(order);
                };
            }

            row.classList.add('ss-scanned');
        });

        renderPanel();
    }

    function buildBatchContent(batch, items, content){
        if (renderedLists.has(batch)){
            return;
        }

        const frag = document.createDocumentFragment();

        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'ss-item-row';
            row.innerHTML = `
                ${item.user}
                | ${item.segment}
                | ${item.kod}
                | <span class="ss-order">${item.order}</span>
            `;
            row.querySelector('.ss-order').onclick = () => openBL(item.order);
            frag.appendChild(row);
        });

        content.appendChild(frag);
        renderedLists.add(batch);
    }

    function renderPanel(){
        const grouped = {};

        Object.values(produktyCache)
        .filter(x => x.hasPick && !x.hasPack)
        .forEach(item => {
            if (!grouped[item.batch]){
                grouped[item.batch] = [];
            }
            grouped[item.batch].push(item);
        });

        const tabela = document.querySelector('mat-table');
        if (!tabela) return;

        let panel = document.getElementById('ss-unpacked-panel');
        if (!panel){
            panel = document.createElement('div');
            panel.id = 'ss-unpacked-panel';
            tabela.parentNode.insertBefore(panel, tabela);
        }

        panel.replaceChildren();

        const title = document.createElement('div');
        title.className = 'ss-panel-title';
        title.textContent = 'Produkty oczekujące na spakowanie';
        panel.appendChild(title);

        const btnWrap = document.createElement('div');
        btnWrap.className = 'ss-batch-buttons';
        panel.appendChild(btnWrap);

        const contentWrap = document.createElement('div');
        panel.appendChild(contentWrap);

        Object.keys(grouped).forEach(batch => {
            const items = grouped[batch];
            const canExpand = items.length <= 20;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = canExpand ? 'ss-batch-btn' : 'ss-batch-btn disabled';
            btn.textContent = `${batch} (${items.length})`;
            btnWrap.appendChild(btn);

            if (!canExpand){
                return;
            }

            const content = document.createElement('div');
            content.className = 'ss-batch-content';
            contentWrap.appendChild(content);

            btn.addEventListener('pointerdown', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);

            btn.onclick = e => {
                e.preventDefault();
                e.stopPropagation();

                if (!renderedLists.has(batch)){
                    buildBatchContent(batch, items, content);
                }

                const isOpen = content.style.display === 'block';
                content.style.display = isOpen ? 'none' : 'block';
                btn.classList.toggle('active', !isOpen);
            };
        });
    }

    function resetLogsState(){
        Object.keys(produktyCache).forEach(k => delete produktyCache[k]);
        renderedLists.clear();

        const panel = document.getElementById('ss-unpacked-panel');
        if (panel){
            panel.remove();
        }

        // Pozwala na ponowne przeskanowanie wszystkich obecnych na ekranie wierszy
        document.querySelectorAll('.ss-scanned').forEach(el => {
            el.classList.remove('ss-scanned');
        });
    }

    // Funkcja injekująca nasz główny przycisk analizy nad tabelą
    function injectManualTrigger(table) {
        const btn = document.createElement('button');
        btn.id = 'ss-manual-trigger';
        btn.className = 'ss-batch-btn';
        btn.textContent = '📊 Analizuj załadowane logi';

        btn.onclick = (e) => {
            e.preventDefault();
            resetLogsState();
            analizujLogi();
        };

        table.parentNode.insertBefore(btn, table);
    }

    // Zamiast mutacji i podpinania się pod "Szukaj", sprawdzamy co 1 sekundę czy jesteśmy na dobrej stronie
    setInterval(() => {
        // Sprawdzanie czy aktualny adres URL to strona z logami (chroni przed SPA)
        if (!window.location.href.includes('/history/logs')) {
            return;
        }

        const tabela = document.querySelector('mat-table') || document.querySelector('.logs-table');

        // Jeżeli tabela istnieje, ale nasz przycisk ręcznej analizy jeszcze nie, dodajemy go
        if (tabela && !document.getElementById('ss-manual-trigger')) {
            injectManualTrigger(tabela);
        }
    }, 1000);

})();
