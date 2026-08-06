// ==UserScript==
// @name         BaseLinker Emergency Scanner (Zebra)
// @namespace    stocksell-emergency
// @version      2.1
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

        scanCounterEl.innerHTML = `📊 Wszystkie skany dziś (<strong>${workstation}</strong>): <span style="font-size: 14px; font-weight: 800; color: #10b981;">${currentCount}</span>`;
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
            bottom: 30px;
            right: 30px;
            z-index: 9999999;
            font-family: 'Open Sans', Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        `;

        const toggleBtn = document.createElement("button");
        toggleBtn.innerHTML = "🖨️ Awaryjny Skaner";
        toggleBtn.style.cssText = `
            background: #10b981;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 50px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 10px rgba(0,0,0,0.2);
            transition: background 0.2s;
            outline: none;
        `;
        toggleBtn.onmouseover = () => toggleBtn.style.background = "#059669";
        toggleBtn.onmouseout = () => toggleBtn.style.background = "#10b981";

        const panel = document.createElement("div");
        panel.style.cssText = `
            display: none;
            width: 320px;
            background: #ffffff;
            border: 2px solid #10b981;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            margin-bottom: 15px;
        `;

        const headerRow = document.createElement("div");
        headerRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        `;

        const title = document.createElement("div");
        title.innerHTML = "<strong>⚡ Skaner niezależny</strong>";
        title.style.fontSize = "15px";
        title.style.color = "#333";

        refreshBtn = document.createElement("button");
        refreshBtn.innerHTML = "🔄 Odśwież";
        refreshBtn.title = "Wymuś pobranie świeżej bazy";
        refreshBtn.style.cssText = `
            background: #f3f4f6;
            color: #374151;
            border: 1px solid #d1d5db;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 11px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.2s;
        `;
        refreshBtn.onmouseover = () => refreshBtn.style.background = "#e5e7eb";
        refreshBtn.onmouseout = () => refreshBtn.style.background = "#f3f4f6";
        refreshBtn.onclick = () => preloadProducts(true);

        headerRow.appendChild(title);
        headerRow.appendChild(refreshBtn);

        statusEl = document.createElement("div");
        statusEl.innerText = "⏳ Inicjalizacja bazy...";
        statusEl.style.fontSize = "12px";
        statusEl.style.color = "#555";
        statusEl.style.marginBottom = "5px";

        printerStatusEl = document.createElement("div");
        printerStatusEl.innerText = "⏳ Szukanie Zebry...";
        printerStatusEl.style.fontSize = "12px";
        printerStatusEl.style.color = "#555";
        printerStatusEl.style.marginBottom = "10px";

        // Dodanie elementu licznika
        scanCounterEl = document.createElement("div");
        scanCounterEl.style.cssText = `
            font-size: 12px;
            color: #4b5563;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #e5e7eb;
        `;
        updateScanCounterUI();

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Zeskanuj SKU...";
        input.style.cssText = `
            width: 100%;
            padding: 12px;
            box-sizing: border-box;
            border: 2px solid #ccc;
            border-radius: 6px;
            font-size: 16px;
            outline: none;
            transition: border-color 0.2s;
            color: #333;
        `;
        input.addEventListener("focus", () => input.style.borderColor = "#10b981");
        input.addEventListener("blur", () => input.style.borderColor = "#ccc");

        const resultEl = document.createElement("div");
        resultEl.style.cssText = `
            margin-top: 15px;
            font-size: 14px;
            font-weight: bold;
            min-height: 20px;
            word-break: break-all;
            text-align: center;
        `;

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

                // Zwiększamy licznik dla KAŻDEGO zeskanowanego kodu
                incrementScanCounter();

                if (!printerReady) {
                    resultEl.style.color = "#ef4444";
                    resultEl.innerText = "❌ Brak połączenia z drukarką!";
                    setTimeout(() => sendLogToSheet(sku, "Nie udane"), 10);
                    return;
                }

                const product = productCache.get(sku);

                if (product) {
                    resultEl.style.color = "#10b981";
                    resultEl.innerText = `✔️ Drukowanie: ${product.code}`;

                    // Drukowanie natychmiast
                    printLabel(product.title, product.code);

                    // Logi w tle ze statusem "Udane"
                    setTimeout(() => sendLogToSheet(sku, "Udane"), 10);
                } else {
                    resultEl.style.color = "#ef4444";
                    resultEl.innerText = `❌ Nie znaleziono: ${sku}`;

                    // Logi błędnego skanu w tle ze statusem "Nie udane"
                    setTimeout(() => sendLogToSheet(sku, "Nie udane"), 10);
                }
            }
        });

        panel.appendChild(headerRow);
        panel.appendChild(statusEl);
        panel.appendChild(printerStatusEl);
        panel.appendChild(scanCounterEl);
        panel.appendChild(input);
        panel.appendChild(resultEl);

        wrapper.appendChild(panel);
        wrapper.appendChild(toggleBtn);

        document.body.appendChild(wrapper);

        // Odświeżaj licznik co 3 sekundy na wypadek zmiany stanowiska z listy
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
