// ==UserScript==
// @name         BaseLinker Emergency Scanner (Zebra)
// @namespace    stocksell-emergency
// @version      2.5
// @match        https://panel.baselinker.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      localhost
// @connect      127.0.0.1
// @downloadURL  https://raw.githubusercontent.com/mikolajzieba-ui/stocksell-scripts/main/Trendyol_Printer.user.js
// @updateURL    https://raw.githubusercontent.com/mikolajzieba-ui/stocksell-scripts/main/Trendyol_Printer.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ZABEZPIECZENIE PRZED DUBLOWANIEM W RAMKACH (IFRAMES)
    if (window.top !== window.self) {
        return;
    }

    const API_URL = "https://script.google.com/macros/s/AKfycbzQEqxAKjhMQS35zaUQHZ0aE6g9SAsiZyzPxUVnVmAb_U9tpGhjsP3vHZkBoapFhxEJ/exec";
    const LOG_API_URL = "https://script.google.com/macros/s/AKfycbxDgXMxQPx_kowxr4_SC1IvjxqpYnuQnFpK9-traunzMxIjPoRcTMU5kQ2MECUJ8G1RSw/exec";

    let printerReady = false;
    let activeDeviceName = null;
    let zebraDeviceObj = null;

    const productCache = new Map();
    let statusEl = null;
    let printerStatusEl = null;
    let scanCounterEl = null;
    let refreshBtn = null;
    let historyContainer = null;

    // Pobieranie historii skanów z pamięci przeglądarki (max 10)
    let recentScans = JSON.parse(GM_getValue("recent_scans_v1", "[]"));

    //////////////////////////////////////////////////////
    // WYSZUKIWANIE STANOWISKA (RÓWNIEŻ W RAMKACH)
    //////////////////////////////////////////////////////
    function getWorkstationName() {
        let wsSelect = document.getElementById("ws_select");
        if (wsSelect && wsSelect.selectedIndex >= 0) {
            return wsSelect.options[wsSelect.selectedIndex].text;
        }

        const iframes = document.querySelectorAll("iframe");
        for (let i = 0; i < iframes.length; i++) {
            try {
                let iframeDoc = iframes[i].contentDocument || iframes[i].contentWindow.document;
                wsSelect = iframeDoc.getElementById("ws_select");
                if (wsSelect && wsSelect.selectedIndex >= 0) {
                    return wsSelect.options[wsSelect.selectedIndex].text;
                }
            } catch (e) {
                // Ignorujemy błędy CORS
            }
        }

        return "Brak / Inna strona";
    }

    //////////////////////////////////////////////////////
    // WYSYŁANIE LOGÓW DO ARKUSZA (W TLE)
    //////////////////////////////////////////////////////
    function sendLogToSheet(sku, scanStatus) {
        if (!LOG_API_URL) return;

        const workstationName = getWorkstationName();
        const now = new Date();
        const timestamp = now.toLocaleString('pl-PL');

        GM_xmlhttpRequest({
            method: "POST",
            url: LOG_API_URL,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({
                sku: sku,
                timestamp: timestamp,
                workstation: workstationName,
                status: scanStatus
            }),
            onload: function(res) {
                console.log("Log zapisany:", res.responseText);
            },
            onerror: function(err) {
                console.error("Błąd podczas zapisywania logu:", err);
            }
        });
    }

    //////////////////////////////////////////////////////
    // LICZNIK SKANÓW (LOKALNY)
    //////////////////////////////////////////////////////
    function updateScanCounterUI() {
        if (!scanCounterEl) return;

        const workstation = getWorkstationName();
        const today = new Date().toLocaleDateString('pl-PL');
        const cacheKey = `scan_count_${workstation}_${today}`;

        const currentCount = GM_getValue(cacheKey, 0);

        scanCounterEl.innerHTML = `📊 Wszystkie skany dziś (<strong>${workstation}</strong>): <span style="font-size: 15px; font-weight: 800; color: #10b981;">${currentCount}</span>`;
    }

    function incrementScanCounter() {
        const workstation = getWorkstationName();
        const today = new Date().toLocaleDateString('pl-PL');
        const cacheKey = `scan_count_${workstation}_${today}`;

        const currentCount = GM_getValue(cacheKey, 0);
        GM_setValue(cacheKey, currentCount + 1);

        updateScanCounterUI();
    }

    //////////////////////////////////////////////////////
    // HISTORIA OSTATNICH 10 SKANÓW
    //////////////////////////////////////////////////////
    function updateRecentScansUI() {
        if (!historyContainer) return;

        historyContainer.innerHTML = ""; // Czyszczenie

        if (recentScans.length === 0) {
            historyContainer.innerHTML = `<div style="color: #9ca3af; text-align: center; padding: 20px 0; font-size: 13px;">Brak historii skanów</div>`;
            return;
        }

        recentScans.forEach(scan => {
            const color = scan.status === 'success' ? '#10b981' : '#ef4444';
            const item = document.createElement("div");
            item.style.cssText = `
                padding: 8px 0;
                border-bottom: 1px solid #374151;
                display: flex;
                flex-direction: column;
                gap: 4px;
            `;
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: bold; color: ${color}; font-size: 13px;">${scan.sku}</span>
                    <span style="font-weight: bold; color: #d1d5db; font-family: monospace; font-size: 13px;">${scan.code}</span>
                </div>
                <div style="color: #9ca3af; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${scan.title}">${scan.title}</div>
            `;
            historyContainer.appendChild(item);
        });
    }

    function addScanToHistory(sku, code, title, status) {
        recentScans.unshift({ sku, code, title, status });

        if (recentScans.length > 10) {
            recentScans.pop();
        }

        GM_setValue("recent_scans_v1", JSON.stringify(recentScans));
        updateRecentScansUI();
    }

    //////////////////////////////////////////////////////
    // 1. POBIERANIE DANYCH (CACHE)
    //////////////////////////////////////////////////////
    function preloadProducts(forceRefresh = false) {
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
                updateStatus(`✅ Baza gotowa (${productCache.size} prod.)`);
                if (refreshBtn) {
                    refreshBtn.disabled = false;
                    refreshBtn.style.opacity = "1";
                }
                return;
            } catch (e) {
                console.error("Błąd odczytu cache", e);
            }
        }

        updateStatus("⏳ Pobieranie bazy...");
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.style.opacity = "0.5";
        }

        GM_xmlhttpRequest({
            method: "GET",
            url: `${API_URL}?all=1`,
            onload: function (res) {
                try {
                    const products = JSON.parse(res.responseText);
                    productCache.clear();
                    products.forEach(product => {
                        productCache.set(String(product.sku).toLowerCase(), product);
                    });

                    GM_setValue(CACHE_KEY, JSON.stringify(products));
                    GM_setValue(CACHE_TIME_KEY, String(Date.now()));

                    updateStatus(`✅ Baza gotowa (${productCache.size} prod.)`);
                } catch (e) {
                    updateStatus("❌ Błąd pobierania bazy");
                    console.error(e);
                } finally {
                    if (refreshBtn) {
                        refreshBtn.disabled = false;
                        refreshBtn.style.opacity = "1";
                    }
                }
            },
            onerror: function(err) {
                updateStatus("❌ Błąd sieci (baza)");
                if (refreshBtn) {
                    refreshBtn.disabled = false;
                    refreshBtn.style.opacity = "1";
                }
            }
        });
    }

    //////////////////////////////////////////////////////
    // 2. ŁĄCZENIE Z DRUKARKĄ ZEBRA
    //////////////////////////////////////////////////////
    function initPrinter() {
        updatePrinterStatus("⏳ Szukanie Zebry...");

        GM_xmlhttpRequest({
            method: "GET",
            url: "http://localhost:9100/available",
            timeout: 2000,
            onload: function (res) {
                try {
                    const data = JSON.parse(res.responseText);
                    const printer = data.printer.find(p => p.name);

                    if (!printer) throw "Brak drukarki w odpowiedzi";

                    zebraDeviceObj = printer;
                    activeDeviceName = printer.name;
                    printerReady = true;

                    updatePrinterStatus(`🖨️ Zebra połączona`);
                } catch (e) {
                    updatePrinterStatus("❌ Brak drukarki");
                    setTimeout(initPrinter, 5000);
                }
            },
            onerror: function(err) {
                updatePrinterStatus("❌ Błąd łączności (Zebra)");
                setTimeout(initPrinter, 5000);
            },
            ontimeout: function() {
                updatePrinterStatus("❌ Timeout (Zebra)");
                setTimeout(initPrinter, 5000);
            }
        });
    }

    //////////////////////////////////////////////////////
    // 3. WYSYŁANIE WYDRUKU (ZPL)
    //////////////////////////////////////////////////////
    function printLabel(title, code) {
        if (!printerReady) {
            alert("Drukarka nie jest jeszcze połączona!");
            return;
        }

        const zpl = createZPL(title, code);

        GM_xmlhttpRequest({
            method: "POST",
            url: "http://localhost:9100/write",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({
                device: zebraDeviceObj,
                data: zpl
            })
        });
    }

    function createZPL(title, code) {
        const safeTitle = title.replace(/\^/g, "").substring(0, 80);
        const titleHex = toZplHexUtf8(safeTitle);

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
^FD${formatCode(code)}^FS

^XZ
`;
    }

    function toZplHexUtf8(text) {
        const bytes = new TextEncoder().encode(text);
        return Array.from(bytes).map(b => "_" + b.toString(16).padStart(2, "0").toUpperCase()).join("");
    }

    function formatCode(code) {
        return String(code).match(/.{1,3}/g).join(" ");
    }

    //////////////////////////////////////////////////////
    // 4. INTERFEJS UŻYTKOWNIKA (ROZWIJANY PANEL)
    //////////////////////////////////////////////////////
    function createCollapsibleUI() {
        if (document.getElementById("stocksell-emergency-scanner-wrapper")) {
            return;
        }

        const wrapper = document.createElement("div");
        wrapper.id = "stocksell-emergency-scanner-wrapper";
        wrapper.style.cssText = `
            position: fixed;
            bottom: 40px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999999;
            font-family: 'Open Sans', Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
        `;

        const toggleBtn = document.createElement("button");
        toggleBtn.innerHTML = "🖨️ Awaryjny Skaner";
        toggleBtn.style.cssText = `
            background: #10b981;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 50px;
            font-size: 15px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(0,0,0,0.4);
            transition: background 0.2s;
            outline: none;
        `;
        toggleBtn.onmouseover = () => toggleBtn.style.background = "#059669";
        toggleBtn.onmouseout = () => toggleBtn.style.background = "#10b981";

        const panel = document.createElement("div");
        panel.style.cssText = `
            display: none;
            width: 1050px; /* Szerszy panel dla pomieszczenia historii */
            max-width: 95vw;
            background: #2b3035; /* Ciemnoszare, matowe tło */
            color: #e5e7eb; /* Jasny tekst na ciemnym tle */
            border: 2px solid #10b981;
            border-radius: 12px;
            padding: 25px;
            box-shadow: 0 15px 35px rgba(0,0,0,0.5);
            margin-bottom: 20px;
        `;

        // KONTENER NA 2 KOLUMNY
        const contentRow = document.createElement("div");
        contentRow.style.cssText = `
            display: flex;
            gap: 30px;
            align-items: flex-start;
        `;

        // LEWA KOLUMNA (Tytuł + Skaner - "Czerwony kwadrat")
        const leftCol = document.createElement("div");
        leftCol.style.cssText = `
            flex: 0 0 38%; /* Proporcja szerokości lewej kolumny */
            display: flex;
            flex-direction: column;
        `;

        const title = document.createElement("div");
        title.innerHTML = "<strong>⚡ Skaner niezależny (Zebra)</strong>";
        title.style.fontSize = "22px"; // Powiększona czcionka tytułu
        title.style.color = "#f9fafb";
        title.style.marginBottom = "20px";

        statusEl = document.createElement("div");
        statusEl.innerText = "⏳ Inicjalizacja bazy...";
        statusEl.style.fontSize = "13px";
        statusEl.style.color = "#9ca3af";
        statusEl.style.marginBottom = "8px";

        printerStatusEl = document.createElement("div");
        printerStatusEl.innerText = "⏳ Szukanie Zebry...";
        printerStatusEl.style.fontSize = "13px";
        printerStatusEl.style.color = "#9ca3af";
        printerStatusEl.style.marginBottom = "15px";

        scanCounterEl = document.createElement("div");
        scanCounterEl.style.cssText = `
            font-size: 13px;
            color: #d1d5db;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px dashed #4b5563;
        `;
        updateScanCounterUI();

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Zeskanuj SKU...";
        input.style.cssText = `
            width: 100%;
            padding: 15px;
            box-sizing: border-box;
            border: 2px solid #4b5563;
            border-radius: 8px;
            font-size: 18px;
            outline: none;
            transition: all 0.2s;
            color: #f9fafb;
            background: #1f2937; /* Ciemne tło pola */
        `;
        input.addEventListener("focus", () => {
            input.style.borderColor = "#10b981";
            input.style.background = "#374151";
        });
        input.addEventListener("blur", () => {
            input.style.borderColor = "#4b5563";
            input.style.background = "#1f2937";
        });

        const resultEl = document.createElement("div");
        resultEl.style.cssText = `
            margin-top: 20px;
            font-size: 16px;
            font-weight: bold;
            min-height: 25px;
            word-break: break-all;
            text-align: center;
        `;

        leftCol.appendChild(title);
        leftCol.appendChild(statusEl);
        leftCol.appendChild(printerStatusEl);
        leftCol.appendChild(scanCounterEl);
        leftCol.appendChild(input);
        leftCol.appendChild(resultEl);

        // PRAWA KOLUMNA (Historia + Odśwież - "Żółty kwadrat")
        const rightCol = document.createElement("div");
        rightCol.style.cssText = `
            flex: 1;
            border-left: 1px solid #4b5563;
            padding-left: 30px;
            display: flex;
            flex-direction: column;
        `;

        // Nagłówek prawej kolumny (Przycisk + Tekst)
        const rightHeader = document.createElement("div");
        rightHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid #374151;
        `;

        const historyTitle = document.createElement("div");
        historyTitle.innerHTML = "<strong>Ostatnie 10 skanów:</strong>";
        historyTitle.style.fontSize = "15px";
        historyTitle.style.color = "#d1d5db";

        refreshBtn = document.createElement("button");
        refreshBtn.innerHTML = "🔄 Odśwież Bazę";
        refreshBtn.title = "Wymuś pobranie świeżej bazy";
        refreshBtn.style.cssText = `
            background: #374151; /* Ciemniejszy przycisk */
            color: #e5e7eb;
            border: 1px solid #4b5563;
            padding: 6px 14px;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.2s;
        `;
        refreshBtn.onmouseover = () => refreshBtn.style.background = "#4b5563";
        refreshBtn.onmouseout = () => refreshBtn.style.background = "#374151";
        refreshBtn.onclick = () => preloadProducts(true);

        rightHeader.appendChild(historyTitle);
        rightHeader.appendChild(refreshBtn);

        historyContainer = document.createElement("div");
        historyContainer.style.cssText = `
            display: flex;
            flex-direction: column;
        `;

        updateRecentScansUI();
        rightCol.appendChild(rightHeader);
        rightCol.appendChild(historyContainer);

        // ZŁOŻENIE ELEMENTÓW
        contentRow.appendChild(leftCol);
        contentRow.appendChild(rightCol);

        panel.appendChild(contentRow);

        wrapper.appendChild(panel);
        wrapper.appendChild(toggleBtn);

        document.body.appendChild(wrapper);

        // OBSŁUGA ZDARZEŃ
        toggleBtn.onclick = () => {
            const isHidden = panel.style.display === "none";
            panel.style.display = isHidden ? "block" : "none";
            toggleBtn.innerHTML = isHidden ? "✖ Zamknij Skaner" : "🖨️ Awaryjny Skaner";
            toggleBtn.style.background = isHidden ? "#ef4444" : "#10b981";

            if (isHidden) {
                setTimeout(() => input.focus(), 100);
                updateScanCounterUI();
            }
        };

        input.addEventListener("keydown", function(e) {
            if (e.key === "Enter") {
                const sku = input.value.trim().toLowerCase();
                input.value = "";

                if (!sku) return;

                incrementScanCounter();

                if (!printerReady) {
                    resultEl.style.color = "#ef4444";
                    resultEl.innerText = "❌ Brak połączenia z drukarką!";
                    addScanToHistory(sku, "-", "Brak połączenia z drukarką", "error");
                    setTimeout(() => sendLogToSheet(sku, "Nie udane"), 10);
                    return;
                }

                const product = productCache.get(sku);

                if (product) {
                    resultEl.style.color = "#10b981";
                    resultEl.innerText = `✔️ Drukowanie: ${product.code}`;

                    addScanToHistory(sku, product.code, product.title, "success");
                    printLabel(product.title, product.code);

                    setTimeout(() => sendLogToSheet(sku, "Udane"), 10);
                } else {
                    resultEl.style.color = "#ef4444";
                    resultEl.innerText = `❌ Nie znaleziono: ${sku}`;

                    addScanToHistory(sku, "-", "Nie znaleziono produktu w bazie", "error");
                    setTimeout(() => sendLogToSheet(sku, "Nie udane"), 10);
                }
            }
        });

        setInterval(updateScanCounterUI, 3000);
    }

    function updateStatus(text) {
        if (statusEl) statusEl.innerText = text;
    }

    function updatePrinterStatus(text) {
        if (printerStatusEl) printerStatusEl.innerText = text;
    }

    //////////////////////////////////////////////////////
    // 5. START
    //////////////////////////////////////////////////////
    setTimeout(() => {
        if (window.location.href.includes("panel.baselinker.com")) {
            createCollapsibleUI();
            preloadProducts(false);
            initPrinter();
        }
    }, 500);

})();
