// ==UserScript==
// @name         BaseLinker Skaner Zwrotów (Zebra)
// @namespace    stocksell-returns
// @version      1.7
// @match        https://panel.baselinker.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      localhost
// @connect      127.0.0.1
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Base-drukarka-zwroty-jednosztuki.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Base-drukarka-zwroty-jednosztuki.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.top !== window.self) return;

    // Link do arkusza zwrotów
    const RETURNS_API_URL = "https://script.google.com/macros/s/AKfycbyevRaH2OJgriFJTo_u4EC_IIxmSlXxQAKH_JMUNE8uPEuLzsODrNmSsrrsniDfZ8NXZA/exec";

    // Link do arkusza produktów (do mapowania SKU na kod kreskowy)
    const PRODUCTS_API_URL = "https://script.google.com/macros/s/AKfycbzQEqxAKjhMQS35zaUQHZ0aE6g9SAsiZyzPxUVnVmAb_U9tpGhjsP3vHZkBoapFhxEJ/exec";

    let printerReady = false;
    let zebraDeviceObj = null;

    const returnsCache = new Map();
    const productCache = new Map();

    let returnsStatusEl = null;
    let productsStatusEl = null;
    let printerStatusEl = null;
    let scanCounterEl = null;
    let refreshBtn = null;
    let historyContainer = null;

    let recentScans = JSON.parse(GM_getValue("returns_recent_scans_v1", "[]"));
    let currentTheme = GM_getValue("stocksell_theme", "dark");

    //////////////////////////////////////////////////////
    // STYLE CSS
    //////////////////////////////////////////////////////
    function injectStyles() {
        if (document.getElementById("stocksell-returns-styles")) return;

        const style = document.createElement("style");
        style.id = "stocksell-returns-styles";
        style.innerHTML = `
            #stocksell-returns-scanner-wrapper[data-theme="dark"] {
                --bg-panel: #2b3035; --text-main: #f9fafb; --text-muted: #9ca3af;
                --text-sub: #d1d5db; --border-color: #374151; --input-bg: #1f2937;
                --input-border: #4b5563; --btn-bg: #374151; --btn-hover: #4b5563;
            }
            #stocksell-returns-scanner-wrapper[data-theme="light"] {
                --bg-panel: #ffffff; --text-main: #111827; --text-muted: #6b7280;
                --text-sub: #4b5563; --border-color: #e5e7eb; --input-bg: #f9fafb;
                --input-border: #d1d5db; --btn-bg: #f3f4f6; --btn-hover: #e5e7eb;
            }
            .stocksell-btn {
                background: var(--btn-bg); color: var(--text-main);
                border: 1px solid var(--border-color); padding: 4px 10px;
                border-radius: 6px; font-size: 12px; cursor: pointer;
                font-weight: 600; transition: all 0.2s;
            }
            .stocksell-btn:hover { background: var(--btn-hover); }
            .stocksell-input {
                width: 100%; padding: 12px; box-sizing: border-box;
                border: 2px solid var(--input-border); border-radius: 8px;
                font-size: 16px; outline: none; transition: border-color 0.2s;
                color: var(--text-main); background: var(--input-bg);
            }
            .stocksell-input:focus { border-color: #3b82f6; }
        `;
        document.head.appendChild(style);
    }

    //////////////////////////////////////////////////////
    // LOGOWANIE DO ARKUSZA
    //////////////////////////////////////////////////////
    function sendLogToSheet(returnNr, tracking, scanStatus) {
        if (!RETURNS_API_URL) return;

        const timestamp = new Date().toLocaleString('pl-PL');

        GM_xmlhttpRequest({
            method: "POST",
            url: RETURNS_API_URL,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({
                timestamp: timestamp,
                return_nr: returnNr,
                tracking: tracking,
                status: scanStatus
            })
        });
    }

    //////////////////////////////////////////////////////
    // LICZNIK SKANÓW
    //////////////////////////////////////////////////////
    function updateScanCounterUI() {
        if (!scanCounterEl) return;
        const today = new Date().toLocaleDateString('pl-PL');
        const cacheKey = `return_scan_count_${today}`;
        const currentCount = GM_getValue(cacheKey, 0);
        scanCounterEl.innerHTML = `📊 Przetworzone zwroty dziś: <span style="font-size: 15px; font-weight: 800; color: #3b82f6;">${currentCount}</span>`;
    }

    function incrementScanCounter() {
        const today = new Date().toLocaleDateString('pl-PL');
        const cacheKey = `return_scan_count_${today}`;
        const currentCount = GM_getValue(cacheKey, 0);
        GM_setValue(cacheKey, currentCount + 1);
        updateScanCounterUI();
    }

    //////////////////////////////////////////////////////
    // HISTORIA SKANÓW
    //////////////////////////////////////////////////////
    function updateRecentScansUI() {
        if (!historyContainer) return;
        historyContainer.innerHTML = "";
        if (recentScans.length === 0) {
            historyContainer.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 10px 0; font-size: 13px;">Brak historii skanów</div>`;
            return;
        }

        recentScans.forEach(scan => {
            const color = scan.status === 'success' ? '#10b981' : '#ef4444';
            const item = document.createElement("div");
            item.style.cssText = `
                padding: 5px 0; border-bottom: 1px solid var(--border-color);
                display: flex; flex-direction: column; gap: 2px;
            `;
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: bold; color: ${color}; font-family: monospace; font-size: 13px;">${scan.printCode}</span>
                    <span style="font-weight: bold; color: var(--text-sub); font-size: 12px;">${scan.tracking}</span>
                </div>
                <div style="color: var(--text-main); font-size: 13px;">${scan.title}</div>
            `;
            historyContainer.appendChild(item);
        });
    }

    function addScanToHistory(tracking, printCode, title, status) {
        recentScans.unshift({ tracking, printCode, title, status });
        if (recentScans.length > 10) recentScans.pop();
        GM_setValue("returns_recent_scans_v1", JSON.stringify(recentScans));
        updateRecentScansUI();
    }

    //////////////////////////////////////////////////////
    // POBIERANIE BAZY ZWROTÓW
    //////////////////////////////////////////////////////
    function preloadReturns(forceRefresh = false) {
        if (!RETURNS_API_URL) return;

        const CACHE_KEY = "stocksell_returns_v1";
        const CACHE_TIME_KEY = "stocksell_returns_time";
        const CACHE_TTL = 5 * 60 * 60 * 1000;

        const cachedData = GM_getValue(CACHE_KEY, null);
        const cachedTime = Number(GM_getValue(CACHE_TIME_KEY, 0));
        const isValid = !forceRefresh && cachedData && cachedTime && (Date.now() - cachedTime < CACHE_TTL);

        if (isValid) {
            try {
                const returns = JSON.parse(cachedData);
                returnsCache.clear();
                returns.forEach(ret => {
                    returnsCache.set(ret.tracking, ret);
                });
                if(returnsStatusEl) returnsStatusEl.innerText = `✅ Baza zwrotów gotowa (${returnsCache.size} poz.)`;
                if (refreshBtn) refreshBtn.disabled = false;
                return;
            } catch (e) {}
        }

        if(returnsStatusEl) returnsStatusEl.innerText = "⏳ Pobieranie bazy zwrotów...";
        if (refreshBtn) refreshBtn.disabled = true;

        GM_xmlhttpRequest({
            method: "GET",
            url: RETURNS_API_URL,
            onload: function (res) {
                try {
                    const returns = JSON.parse(res.responseText);
                    returnsCache.clear();
                    returns.forEach(ret => {
                        returnsCache.set(ret.tracking, ret);
                    });
                    GM_setValue(CACHE_KEY, JSON.stringify(returns));
                    GM_setValue(CACHE_TIME_KEY, String(Date.now()));
                    if(returnsStatusEl) returnsStatusEl.innerText = `✅ Baza zwrotów gotowa (${returnsCache.size} poz.)`;
                } catch (e) {
                    if(returnsStatusEl) returnsStatusEl.innerText = "❌ Błąd pobierania zwrotów";
                } finally {
                    if (refreshBtn) refreshBtn.disabled = false;
                }
            }
        });
    }

    //////////////////////////////////////////////////////
    // POBIERANIE BAZY PRODUKTÓW
    //////////////////////////////////////////////////////
    function preloadProducts(forceRefresh = false) {
        if (!PRODUCTS_API_URL) return;

        const CACHE_KEY = "stocksell_products_v1";
        const CACHE_TIME_KEY = "stocksell_products_time";
        const CACHE_TTL = 10 * 60 * 60 * 1000;

        const cachedData = GM_getValue(CACHE_KEY, null);
        const cachedTime = Number(GM_getValue(CACHE_TIME_KEY, 0));
        const isValid = !forceRefresh && cachedData && cachedTime && (Date.now() - cachedTime < CACHE_TTL);

        if (isValid) {
            try {
                const products = JSON.parse(cachedData);
                productCache.clear();
                products.forEach(product => {
                    productCache.set(String(product.sku).toLowerCase(), product);
                });
                if(productsStatusEl) productsStatusEl.innerText = `✅ Baza produktów gotowa (${productCache.size} prod.)`;
                return;
            } catch (e) {}
        }

        if(productsStatusEl) productsStatusEl.innerText = "⏳ Pobieranie bazy produktów...";

        GM_xmlhttpRequest({
            method: "GET",
            url: PRODUCTS_API_URL + "?all=1",
            onload: function (res) {
                try {
                    const products = JSON.parse(res.responseText);
                    productCache.clear();
                    products.forEach(product => {
                        productCache.set(String(product.sku).toLowerCase(), product);
                    });
                    GM_setValue(CACHE_KEY, JSON.stringify(products));
                    GM_setValue(CACHE_TIME_KEY, String(Date.now()));
                    if(productsStatusEl) productsStatusEl.innerText = `✅ Baza produktów gotowa (${productCache.size} prod.)`;
                } catch (e) {
                    if(productsStatusEl) productsStatusEl.innerText = "❌ Błąd pobierania bazy produktów";
                }
            }
        });
    }

    //////////////////////////////////////////////////////
    // DRUKARKA
    //////////////////////////////////////////////////////
    function initPrinter() {
        if(printerStatusEl) printerStatusEl.innerText = "⏳ Szukanie Zebry...";
        GM_xmlhttpRequest({
            method: "GET", url: "http://localhost:9100/available", timeout: 2000,
            onload: function (res) {
                try {
                    const data = JSON.parse(res.responseText);
                    const printer = data.printer.find(p => p.name);
                    if (!printer) throw "Brak drukarki";
                    zebraDeviceObj = printer; printerReady = true;
                    if(printerStatusEl) printerStatusEl.innerText = `🖨️ Zebra połączona`;
                } catch (e) {
                    if(printerStatusEl) printerStatusEl.innerText = "❌ Brak drukarki";
                    setTimeout(initPrinter, 5000);
                }
            },
            onerror: () => { if(printerStatusEl) printerStatusEl.innerText = "❌ Błąd łączności"; setTimeout(initPrinter, 5000); },
            ontimeout: () => { if(printerStatusEl) printerStatusEl.innerText = "❌ Timeout"; setTimeout(initPrinter, 5000); }
        });
    }

    function printLabel(title, code) {
        if (!printerReady) return;
        const zpl = createZPL(title, code);
        GM_xmlhttpRequest({
            method: "POST", url: "http://localhost:9100/write",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ device: zebraDeviceObj, data: zpl })
        });
    }

    function createZPL(title, code) {
        const safeTitle = title.replace(/\^/g, "").substring(0, 80);
        const bytes = new TextEncoder().encode(safeTitle);
        const titleHex = Array.from(bytes).map(b => "_" + b.toString(16).padStart(2, "0").toUpperCase()).join("");
        const fCode = String(code).match(/.{1,3}/g).join(" ");
        return `
^XA
^CI28
^PW456
^LL256
^LH0,0
^FO20,70
^A@N,18,18,E:TT0003M_.FNT
^FB416,2,0,C,0
^FH^FD${titleHex}^FS
^FO20,130
^BY3.0,2,100
^BCN,85,N,N,N
^FD${code}^FS
^FO55,225
^A0N,72,72
^FD${fCode}^FS
^XZ`;
    }

    //////////////////////////////////////////////////////
    // INTERFEJS
    //////////////////////////////////////////////////////
    function createCollapsibleUI() {
        if (document.getElementById("stocksell-returns-scanner-wrapper")) return;
        injectStyles();

        const wrapper = document.createElement("div");
        wrapper.id = "stocksell-returns-scanner-wrapper";
        wrapper.setAttribute("data-theme", currentTheme);

        // Ukrywamy panel na start, jeśli to nie są zwroty
        if (!window.location.href.includes("orders_returns")) {
            wrapper.style.display = "none";
        }

        const toggleBtn = document.createElement("button");
        toggleBtn.innerHTML = "📦 Skaner Zwrotów";
        toggleBtn.style.cssText = `
            position: fixed; bottom: 30px; left: 30px; /* Zmieniono położenie na lewy dolny róg */
            z-index: 9999999; background: #3b82f6; color: white; border: none;
            padding: 12px 24px; border-radius: 50px; font-size: 15px; font-weight: bold;
            cursor: pointer; box-shadow: 0 4px 15px rgba(0,0,0,0.4); outline: none;
        `;

        const panel = document.createElement("div");
        panel.style.cssText = `
            display: none; position: fixed; bottom: 45px; left: 50%; transform: translateX(-50%);
            z-index: 9999998; width: 1050px; max-width: 95vw; max-height: 92vh; overflow-y: auto;
            background: var(--bg-panel); color: var(--text-main);
            border: 2px solid #3b82f6; border-radius: 12px;
            padding: 18px 25px; box-shadow: 0 5px 35px rgba(0,0,0,0.5);
        `;

        const contentRow = document.createElement("div");
        contentRow.style.cssText = `display: flex; gap: 30px; align-items: flex-start;`;

        // LEWA KOLUMNA
        const leftCol = document.createElement("div");
        leftCol.style.cssText = `flex: 0 0 38%; display: flex; flex-direction: column;`;

        const title = document.createElement("div");
        title.innerHTML = "<strong>📦 Skaner Zwrotów (Zebra)</strong>";
        title.style.fontSize = "16px"; title.style.color = "var(--text-main)"; title.style.marginBottom = "12px";

        returnsStatusEl = document.createElement("div");
        returnsStatusEl.style.cssText = `font-size: 13px; color: var(--text-muted); margin-bottom: 2px;`;

        productsStatusEl = document.createElement("div");
        productsStatusEl.style.cssText = `font-size: 13px; color: var(--text-muted); margin-bottom: 6px;`;

        printerStatusEl = document.createElement("div");
        printerStatusEl.style.cssText = `font-size: 13px; color: var(--text-muted); margin-bottom: 8px;`;

        scanCounterEl = document.createElement("div");
        scanCounterEl.style.cssText = `font-size: 13px; color: var(--text-sub); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px dashed var(--border-color);`;
        updateScanCounterUI();

        const input = document.createElement("input");
        input.type = "text"; input.placeholder = "Zeskanuj numer przesyłki..."; input.className = "stocksell-input";

        const resultEl = document.createElement("div");
        resultEl.style.cssText = `margin-top: 12px; font-size: 16px; font-weight: bold; min-height: 25px; text-align: center;`;

        leftCol.append(title, returnsStatusEl, productsStatusEl, printerStatusEl, scanCounterEl, input, resultEl);

        // PRAWA KOLUMNA
        const rightCol = document.createElement("div");
        rightCol.style.cssText = `flex: 1; border-left: 1px solid var(--border-color); padding-left: 30px; display: flex; flex-direction: column;`;

        const rightHeader = document.createElement("div");
        rightHeader.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color);`;

        const historyTitle = document.createElement("div");
        historyTitle.innerHTML = "<strong>Ostatnie 10 zwrotów:</strong>";
        historyTitle.style.cssText = `font-size: 14px; color: var(--text-sub);`;

        const buttonsContainer = document.createElement("div");
        buttonsContainer.style.cssText = `display: flex; gap: 8px;`;

        const themeBtn = document.createElement("button");
        themeBtn.innerHTML = currentTheme === "dark" ? "☀️ Jasny" : "🌙 Ciemny";
        themeBtn.className = "stocksell-btn";
        themeBtn.onclick = () => {
            currentTheme = currentTheme === "dark" ? "light" : "dark";
            wrapper.setAttribute("data-theme", currentTheme);
            themeBtn.innerHTML = currentTheme === "dark" ? "☀️ Jasny" : "🌙 Ciemny";
            GM_setValue("stocksell_theme", currentTheme);
        };

        refreshBtn = document.createElement("button");
        refreshBtn.innerHTML = "🔄 Odśwież Bazy";
        refreshBtn.className = "stocksell-btn";
        refreshBtn.onclick = () => {
            preloadReturns(true);
            preloadProducts(true);
        };

        buttonsContainer.append(themeBtn, refreshBtn);
        rightHeader.append(historyTitle, buttonsContainer);

        historyContainer = document.createElement("div");
        historyContainer.style.display = "flex"; historyContainer.style.flexDirection = "column";

        updateRecentScansUI();
        rightCol.append(rightHeader, historyContainer);

        contentRow.append(leftCol, rightCol);
        panel.appendChild(contentRow);
        wrapper.append(panel, toggleBtn);
        document.body.appendChild(wrapper);

        // LOGIKA SKANOWANIA
        toggleBtn.onclick = () => {
            const isHidden = panel.style.display === "none";
            panel.style.display = isHidden ? "block" : "none";
            toggleBtn.innerHTML = isHidden ? "✖ Zamknij Zwroty" : "📦 Skaner Zwrotów";
            toggleBtn.style.background = isHidden ? "#ef4444" : "#3b82f6";
            if (isHidden) { setTimeout(() => input.focus(), 100); updateScanCounterUI(); }
        };

        input.addEventListener("keydown", function(e) {
            if (e.key === "Enter") {
                const trackingInput = input.value.trim().toLowerCase();
                input.value = "";
                if (!trackingInput) return;

                incrementScanCounter();

                const retData = returnsCache.get(trackingInput);

                if (!retData) {
                    resultEl.style.color = "#ef4444";
                    resultEl.innerText = `❌ Nie znaleziono przesyłki w bazie.`;
                    addScanToHistory(trackingInput, "-", "Brak przesyłki w 'zgłoszone'", "error");
                    setTimeout(() => sendLogToSheet("-", trackingInput, "Brak w bazie"), 10);
                    return;
                }

                if (retData.accepted !== "tak") {
                    resultEl.style.color = "#f59e0b";
                    resultEl.innerText = `⚠️ Zwrot: ${retData.return_nr} | Odrzucono (nie do przyjęcia)`;
                    addScanToHistory(trackingInput, "-", `Odrzucono (Zwrot ${retData.return_nr})`, "error");
                    setTimeout(() => sendLogToSheet(retData.return_nr, trackingInput, "Odrzucono"), 10);
                    return;
                }

                if (!retData.print_code) {
                    resultEl.style.color = "#ef4444";
                    resultEl.innerText = `❌ Zwrot: ${retData.return_nr} | Brak kodu w 'zgłoszone'`;
                    addScanToHistory(trackingInput, "-", `Brak SKU w zgłoszone (${retData.return_nr})`, "error");
                    setTimeout(() => sendLogToSheet(retData.return_nr, trackingInput, "Brak SKU w zgłoszone"), 10);
                    return;
                }

                let rawCode = retData.print_code.trim();
                let cleanCode = "";
                let finalTitle = retData.title ? retData.title : `Zwrot ${retData.return_nr}`;

                if (rawCode.toLowerCase().startsWith("stocksell_")) {
                    cleanCode = rawCode.replace(/stocksell_/gi, '');
                } else {
                    const product = productCache.get(rawCode.toLowerCase());
                    if (product && product.code) {
                        cleanCode = product.code;
                        // Jeśli z jakiegoś powodu w 'zgłoszone' nie ma tytułu, dobieramy go z bazy produktów
                        if (!retData.title && product.title) finalTitle = product.title;
                    } else {
                        resultEl.style.color = "#ef4444";
                        resultEl.innerText = `❌ Zwrot: ${retData.return_nr} | Brak SKU w bazie produktów: ${rawCode}`;
                        addScanToHistory(trackingInput, "-", `Brak w bazie prod: ${rawCode}`, "error");
                        setTimeout(() => sendLogToSheet(retData.return_nr, trackingInput, "Brak SKU"), 10);
                        return;
                    }
                }

                if (!printerReady) {
                    resultEl.style.color = "#ef4444";
                    resultEl.innerText = "❌ Brak połączenia z drukarką!";
                    addScanToHistory(trackingInput, cleanCode, "Brak drukarki", "error");
                    setTimeout(() => sendLogToSheet(retData.return_nr, trackingInput, "Błąd drukarki"), 10);
                    return;
                }

                resultEl.style.color = "#10b981";
                resultEl.innerText = `✔️ Drukowanie: ${cleanCode}`;

                printLabel(finalTitle, cleanCode);
                addScanToHistory(trackingInput, cleanCode, finalTitle, "success");
                setTimeout(() => sendLogToSheet(retData.return_nr, trackingInput, "Wydrukowano"), 10);
            }
        });

        setInterval(updateScanCounterUI, 3000);
    }

    //////////////////////////////////////////////////////
    // MECHANIZM NASŁUCHIWANIA ZMIAN URL BEZ ODŚWIEŻANIA
    //////////////////////////////////////////////////////
    function checkUrlVisibility() {
        const wrapper = document.getElementById("stocksell-returns-scanner-wrapper");
        if (!wrapper) return;

        if (window.location.href.includes("orders_returns")) {
            if (wrapper.style.display === "none") {
                wrapper.style.display = "block";
            }
        } else {
            if (wrapper.style.display !== "none") {
                wrapper.style.display = "none";
            }
        }
    }

    setInterval(checkUrlVisibility, 500);

    setTimeout(() => {
        if (window.location.href.includes("panel.baselinker.com")) {
            createCollapsibleUI();
            preloadReturns(false);
            preloadProducts(false);
            initPrinter();
        }
    }, 500);

})();
