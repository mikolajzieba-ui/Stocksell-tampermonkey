// ==UserScript==
// @name         BaseLinker Skaner Zwrotów (Zebra)
// @namespace    stocksell-returns
// @version      3.2.0
// @match        https://panel.baselinker.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      localhost
// @connect      127.0.0.1
// @downloadURL  https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/Base-drukarka-zwroty-jednosztuki.user.js
// @updateURL    https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/Base-drukarka-zwroty-jednosztuki.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.top !== window.self) return;

    // Link do arkusza zwrotów
    const RETURNS_API_URL = "https://script.google.com/macros/s/AKfycbyevRaH2OJgriFJTo_u4EC_IIxmSlXxQAKH_JMUNE8uPEuLzsODrNmSsrrsniDfZ8NXZA/exec";

    // Link do arkusza produktów (do mapowania SKU na kod kreskowy)
    const PRODUCTS_API_URL = "https://script.google.com/macros/s/AKfycbzQEqxAKjhMQS35zaUQHZ0aE6g9SAsiZyzPxUVnVmAb_U9tpGhjsP3vHZkBoapFhxEJ/exec";

    // Integracja ze zmianą statusu zwrotu w Base.
    // BL_TOKEN pozostaje wyłącznie we właściwościach Google Apps Script.
    const WEBHOOK_SECRET_KEY = "stocksell_returns_webhook_secret_v1";
    const STATUS_QUEUE_KEY = "stocksell_returns_status_queue_v2";
    const STATUS_REQUEST_TIMEOUT = 45000;
    const STATUS_RETRY_INTERVAL = 30000;
    const RETURNS_AUTO_REFRESH_INTERVAL = 5 * 60 * 1000;

    let printerReady = false;
    let zebraDeviceObj = null;

    const returnsCache = new Map();
    const productCache = new Map();

    let returnsStatusEl = null;
    let productsStatusEl = null;
    let printerStatusEl = null;
    let scanCounterEl = null;
    let baseStatusEl = null;
    let refreshBtn = null;
    let historyContainer = null;
    
    // Zmienne do ponownego wydruku
    let lastPrintedCode = null;
    let lastPrintedTitle = null;
    let lastPrintedImage = null;

    let recentScans = JSON.parse(GM_getValue("returns_recent_scans_v1", "[]"));
    let currentTheme = GM_getValue("stocksell_theme", "dark");
    let statusSyncInProgress = false;
    let returnsLoading = false;
    let printJobSequence = 0;

    //////////////////////////////////////////////////////
    // DŹWIĘK BŁĘDU (Generowany z przeglądarki)
    //////////////////////////////////////////////////////
    function playErrorSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            
            function playBeep(freq, startTime, duration) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square'; 
                osc.frequency.setValueAtTime(freq, startTime);
                gain.gain.setValueAtTime(0.1, startTime);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startTime);
                osc.stop(startTime + duration);
            }

            const now = ctx.currentTime;
            playBeep(300, now, 0.15);      
            playBeep(200, now + 0.15, 0.2); 
        } catch (e) {
            console.error("Web Audio API nie jest wspierane", e);
        }
    }

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
                --scroll-thumb: #4b5563; --scroll-thumb-hover: #6b7280;
            }
            #stocksell-returns-scanner-wrapper[data-theme="light"] {
                --bg-panel: #ffffff; --text-main: #111827; --text-muted: #6b7280;
                --text-sub: #4b5563; --border-color: #e5e7eb; --input-bg: #f9fafb;
                --input-border: #d1d5db; --btn-bg: #f3f4f6; --btn-hover: #e5e7eb;
                --scroll-thumb: #d1d5db; --scroll-thumb-hover: #9ca3af;
            }
            .stocksell-btn {
                background: var(--btn-bg); color: var(--text-main);
                border: 1px solid var(--border-color); padding: 6px 14px;
                border-radius: 6px; font-size: 14px; cursor: pointer;
                font-weight: 600; transition: all 0.2s;
            }
            .stocksell-btn:hover { background: var(--btn-hover); }
            .stocksell-input {
                width: 100%; padding: 16px; box-sizing: border-box;
                border: 2px solid var(--input-border); border-radius: 8px;
                font-size: 20px; outline: none; transition: border-color 0.2s;
                color: var(--text-main); background: var(--input-bg);
            }
            .stocksell-input:focus { border-color: #3b82f6; }
            
            /* Stylowanie paska przewijania dla historii */
            .stocksell-scroll::-webkit-scrollbar { width: 8px; }
            .stocksell-scroll::-webkit-scrollbar-track { background: transparent; }
            .stocksell-scroll::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 4px; }
            .stocksell-scroll::-webkit-scrollbar-thumb:hover { background: var(--scroll-thumb-hover); }
        `;
        document.head.appendChild(style);
    }

    //////////////////////////////////////////////////////
    // LOGOWANIE DO ARKUSZA (BEZ CIASTECZEK)
    //////////////////////////////////////////////////////
    function sendLogToSheet(returnNr, tracking, scanStatus) {
        if (!RETURNS_API_URL) return;

        const timestamp = new Date().toLocaleString('pl-PL');

        GM_xmlhttpRequest({
            method: "POST",
            url: RETURNS_API_URL,
            anonymous: true, // Zabezpieczenie przed błędem ciasteczek Google
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
    // ZMIANA STATUSU ZWROTU W BASE
    //////////////////////////////////////////////////////
    function getWebhookSecret() {
        return String(GM_getValue(WEBHOOK_SECRET_KEY, "") || "").trim();
    }

    function configureWebhookSecret() {
        const secret = window.prompt(
            "Wklej wartość WEBHOOK_SECRET z właściwości Google Apps Script:"
        );

        if (secret === null) return;

        const normalizedSecret = String(secret).trim();
        if (normalizedSecret.length < 16) {
            window.alert("WEBHOOK_SECRET jest zbyt krótki. Wklej co najmniej 16 znaków.");
            return;
        }

        GM_setValue(WEBHOOK_SECRET_KEY, normalizedSecret);
        if (baseStatusEl) baseStatusEl.innerText = "✅ Integracja Base gotowa";
        flushPendingStatusUpdates(true);
    }

    function getStatusQueue() {
        const saved = GM_getValue(STATUS_QUEUE_KEY, "[]");
        try {
            const queue = typeof saved === "string" ? JSON.parse(saved) : saved;
            return Array.isArray(queue) ? queue : [];
        } catch (error) {
            console.error("[RETURNS API] Uszkodzona kolejka statusów:", error);
            return [];
        }
    }

    function saveStatusQueue(queue) {
        GM_setValue(STATUS_QUEUE_KEY, JSON.stringify(queue));
    }

    function removeStatusUpdateFromLatestQueue(returnId) {
        // Zawsze czytamy najnowszą kolejkę z pamięci. Podczas oczekiwania na
        // odpowiedź API operator mógł już zeskanować kolejną paczkę.
        const latestQueue = getStatusQueue().filter(
            item => String(item.return_id) !== String(returnId)
        );
        saveStatusQueue(latestQueue);
    }

    function enqueueStatusUpdate(retData, tracking, cleanCode) {
        const returnId = String(retData && (retData.return_id || retData.return_nr) || "").trim();
        if (!/^\d+$/.test(returnId)) {
            console.error("[RETURNS API] Brak prawidłowego numeru zwrotu:", retData);
            return false;
        }

        const queue = getStatusQueue().filter(item => String(item.return_id) !== returnId);
        queue.push({
            return_id: returnId,
            tracking: String(tracking || "").trim(),
            print_code: String(cleanCode || "").trim(),
            created_at: new Date().toISOString()
        });
        saveStatusQueue(queue);
        return true;
    }

    function sendStatusUpdate(item, secret) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: RETURNS_API_URL,
                anonymous: true,
                timeout: STATUS_REQUEST_TIMEOUT,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify({
                    action: "label_printed",
                    secret: secret,
                    return_id: Number(item.return_id),
                    tracking: item.tracking,
                    print_code: item.print_code,
                    timestamp: new Date().toISOString()
                }),
                onload: response => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }

                    try {
                        const result = JSON.parse(response.responseText);
                        if (!result || result.status !== "success") {
                            reject(new Error(result && result.message
                                ? result.message
                                : "Backend nie potwierdził zmiany statusu"));
                            return;
                        }
                        resolve(result);
                    } catch (error) {
                        reject(new Error("Nieprawidłowa odpowiedź Google Apps Script"));
                    }
                },
                onerror: () => reject(new Error("Błąd połączenia z Google Apps Script")),
                ontimeout: () => reject(new Error("Przekroczono czas zmiany statusu w Base"))
            });
        });
    }

    async function flushPendingStatusUpdates(showStatus = false) {
        if (statusSyncInProgress) return;

        let queue = getStatusQueue();
        if (!queue.length) {
            if (showStatus && baseStatusEl) baseStatusEl.innerText = "✅ Brak oczekujących zmian statusu";
            return;
        }

        const secret = getWebhookSecret();
        if (!secret) {
            if (baseStatusEl) baseStatusEl.innerText = "⚠️ Ustaw WEBHOOK_SECRET w menu Tampermonkey";
            return;
        }

        statusSyncInProgress = true;
        if (showStatus && baseStatusEl) baseStatusEl.innerText = "🔄 Aktualizowanie statusu w Base...";

        try {
            for (const item of [...queue]) {
                try {
                    const result = await sendStatusUpdate(item, secret);
                    queue = queue.filter(queued => String(queued.return_id) !== String(item.return_id));
                    removeStatusUpdateFromLatestQueue(item.return_id);

                    // Usuń zwrot z bieżącej pamięci skanera i unieważnij cache.
                    // Kolejne odświeżenie pobierze już snapshot bez tego statusu.
                    returnsCache.delete(String(item.tracking || "").trim().toLowerCase());
                    GM_setValue("stocksell_returns_time", "0");

                    console.info(
                        `[RETURNS API] Zwrot ${result.return_id} przeniesiony do statusu ${result.status_id}`
                    );
                    if (baseStatusEl) {
                        baseStatusEl.innerText = `✅ Zwrot ${result.return_id} przeniesiony w Base`;
                    }
                } catch (error) {
                    console.error(`[RETURNS API] Zwrot ${item.return_id}:`, error);
                    if (baseStatusEl) {
                        baseStatusEl.innerText = `⚠️ Status zwrotu ${item.return_id} oczekuje na ponowienie`;
                    }
                }
            }
        } finally {
            statusSyncInProgress = false;
        }
    }

    function retryStatusUpdateByReturnId() {
        const enteredValue = window.prompt(
            "Podaj numer zwrotu, który ma zostać przeniesiony w Base bez ponownego drukowania etykiety:"
        );

        if (enteredValue === null) return;

        const returnId = String(enteredValue).trim();
        if (!/^\d+$/.test(returnId)) {
            window.alert("Nieprawidłowy numer zwrotu. Wpisz wyłącznie cyfry.");
            return;
        }

        const queue = getStatusQueue().filter(
            item => String(item.return_id) !== returnId
        );
        queue.push({
            return_id: returnId,
            tracking: "",
            print_code: "",
            created_at: new Date().toISOString(),
            manual_retry: true
        });
        saveStatusQueue(queue);

        if (baseStatusEl) {
            baseStatusEl.innerText = `🔄 Ponawianie statusu zwrotu ${returnId}...`;
        }
        flushPendingStatusUpdates(true);
    }

    //////////////////////////////////////////////////////
    // LICZNIK SKANÓW
    //////////////////////////////////////////////////////
    function updateScanCounterUI() {
        if (!scanCounterEl) return;
        const today = new Date().toLocaleDateString('pl-PL');
        const cacheKey = `return_scan_count_${today}`;
        const currentCount = GM_getValue(cacheKey, 0);
        scanCounterEl.innerHTML = `📊 Przetworzone zwroty dziś: <span style="font-size: 18px; font-weight: 800; color: #3b82f6;">${currentCount}</span>`;
    }

    function incrementScanCounter() {
        const today = new Date().toLocaleDateString('pl-PL');
        const cacheKey = `return_scan_count_${today}`;
        const currentCount = GM_getValue(cacheKey, 0);
        GM_setValue(cacheKey, currentCount + 1);
        updateScanCounterUI();
    }

    //////////////////////////////////////////////////////
    // HISTORIA SKANÓW (BEZPIECZNE ZARZĄDZANIE PAMIĘCIĄ)
    //////////////////////////////////////////////////////
    function updateRecentScansUI() {
        if (!historyContainer) return;
        historyContainer.innerHTML = "";
        if (recentScans.length === 0) {
            historyContainer.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 20px 0; font-size: 15px;">Brak historii skanów</div>`;
            return;
        }

        recentScans.forEach(scan => {
            const color = scan.status === 'success' ? '#10b981' : '#ef4444';
            const item = document.createElement("div");
            item.style.cssText = `
                padding: 10px 0; border-bottom: 1px solid var(--border-color);
                display: flex; flex-direction: column; gap: 4px;
            `;
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: bold; color: ${color}; font-family: monospace; font-size: 16px;">${scan.printCode}</span>
                    <span style="font-weight: bold; color: var(--text-sub); font-size: 14px;">${scan.tracking}</span>
                </div>
                <div style="color: var(--text-main); font-size: 15px;">${scan.title}</div>
            `;
            historyContainer.appendChild(item);
        });
    }

    function addScanToHistory(tracking, printCode, title, status) {
        recentScans.unshift({ tracking, printCode, title, status });
        // Twarde wymuszenie obcięcia bazy do 50 elementów (zabezpieczenie przed memory leakiem)
        recentScans = recentScans.slice(0, 50); 
        GM_setValue("returns_recent_scans_v1", JSON.stringify(recentScans));
        updateRecentScansUI();
    }

    //////////////////////////////////////////////////////
    // POBIERANIE BAZY ZWROTÓW (BEZ CIASTECZEK)
    //////////////////////////////////////////////////////
    function preloadReturns(forceRefresh = false) {
        if (!RETURNS_API_URL) return;
        if (returnsLoading) return;

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
                    const tracking = String(ret.tracking || "").trim().toLowerCase();
                    if (tracking) returnsCache.set(tracking, ret);
                });
                if(returnsStatusEl) returnsStatusEl.innerText = `✅ Baza zwrotów gotowa (${returnsCache.size} poz.)`;
                if (refreshBtn) refreshBtn.disabled = false;
                return;
            } catch (e) {}
        }

        if(returnsStatusEl) returnsStatusEl.innerText = "⏳ Pobieranie bazy zwrotów...";
        if (refreshBtn) refreshBtn.disabled = true;
        returnsLoading = true;

        GM_xmlhttpRequest({
            method: "GET",
            url: RETURNS_API_URL,
            anonymous: true, // Zabezpieczenie przed błędem ciasteczek Google
            timeout: 45000,
            onload: function (res) {
                try {
                    const returns = JSON.parse(res.responseText);
                    returnsCache.clear();
                    returns.forEach(ret => {
                        const tracking = String(ret.tracking || "").trim().toLowerCase();
                        if (tracking) returnsCache.set(tracking, ret);
                    });
                    GM_setValue(CACHE_KEY, JSON.stringify(returns));
                    GM_setValue(CACHE_TIME_KEY, String(Date.now()));
                    if(returnsStatusEl) returnsStatusEl.innerText = `✅ Baza zwrotów gotowa (${returnsCache.size} poz.)`;
                } catch (e) {
                    if(returnsStatusEl) returnsStatusEl.innerText = "❌ Błąd pobierania zwrotów";
                } finally {
                    returnsLoading = false;
                    if (refreshBtn) refreshBtn.disabled = false;
                }
            },
            onerror: function () {
                returnsLoading = false;
                if(returnsStatusEl) returnsStatusEl.innerText = "❌ Błąd połączenia z bazą zwrotów";
                if (refreshBtn) refreshBtn.disabled = false;
            },
            ontimeout: function () {
                returnsLoading = false;
                if(returnsStatusEl) returnsStatusEl.innerText = "❌ Timeout bazy zwrotów";
                if (refreshBtn) refreshBtn.disabled = false;
            }
        });
    }

    //////////////////////////////////////////////////////
    // POBIERANIE BAZY PRODUKTÓW (BEZ CIASTECZEK)
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
            anonymous: true, // Zabezpieczenie przed błędem ciasteczek Google
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
                    console.info("[ZEBRA TIMING] Wykryto drukarkę", {
                        name: String(printer.name || "nieznana"),
                        connection: String(printer.connection || "nieznane"),
                        deviceType: String(printer.deviceType || "nieznany")
                    });
                    if(printerStatusEl) printerStatusEl.innerText = `🖨️ Zebra połączona`;
                } catch (e) {
                    console.error("[ZEBRA TIMING] Nie udało się rozpoznać drukarki", e);
                    if(printerStatusEl) printerStatusEl.innerText = "❌ Brak drukarki";
                    setTimeout(initPrinter, 5000);
                }
            },
            onerror: () => {
                console.error("[ZEBRA TIMING] Błąd połączenia z localhost:9100/available");
                if(printerStatusEl) printerStatusEl.innerText = "❌ Błąd łączności";
                setTimeout(initPrinter, 5000);
            },
            ontimeout: () => {
                console.error("[ZEBRA TIMING] Timeout localhost:9100/available");
                if(printerStatusEl) printerStatusEl.innerText = "❌ Timeout";
                setTimeout(initPrinter, 5000);
            }
        });
    }

    function monotonicNow() {
        return window.performance && typeof window.performance.now === "function"
            ? window.performance.now()
            : Date.now();
    }

    function roundTiming(value) {
        return Math.round(Number(value || 0) * 10) / 10;
    }

    function formatPrintDuration(milliseconds) {
        const value = Number(milliseconds || 0);
        if (value < 1000) return `${Math.round(value)} ms`;
        return `${(value / 1000).toFixed(2).replace(".", ",")} s`;
    }

    function printTimingHtml(timing) {
        if (!timing) return "";

        return `
            <div style="margin-top: 10px; color: var(--text-muted); font-size: 14px;">
                ⏱️ Przekazanie zadania: <strong>${formatPrintDuration(timing.total_ms)}</strong>
                (ZPL: ${formatPrintDuration(timing.zpl_ms)},
                usługa: ${formatPrintDuration(timing.bridge_ms)})
            </div>
        `;
    }

    function printLabel(title, code) {
        return new Promise((resolve, reject) => {
            const jobId = ++printJobSequence;
            const startedMs = monotonicNow();
            const startedAt = new Date().toISOString();
            const printerName = String(zebraDeviceObj && zebraDeviceObj.name || "nieznana");
            const printerConnection = String(
                zebraDeviceObj && (zebraDeviceObj.connection || zebraDeviceObj.deviceType) || "nieznane"
            );
            let zplMs = 0;
            let requestStartedMs = null;

            function createTiming(phase, httpStatus) {
                const finishedMs = monotonicNow();
                return {
                    job_id: jobId,
                    code: String(code || ""),
                    phase: phase,
                    started_at: startedAt,
                    finished_at: new Date().toISOString(),
                    printer: printerName,
                    connection: printerConnection,
                    http_status: Number(httpStatus || 0),
                    zpl_ms: roundTiming(zplMs),
                    bridge_ms: requestStartedMs === null
                        ? 0
                        : roundTiming(finishedMs - requestStartedMs),
                    total_ms: roundTiming(finishedMs - startedMs)
                };
            }

            function failPrint(message, phase, httpStatus) {
                const timing = createTiming(phase, httpStatus);
                const error = new Error(message);
                error.printTiming = timing;
                console.error(`[ZEBRA TIMING #${jobId}] ${message}`, timing);
                reject(error);
            }

            console.info(`[ZEBRA TIMING #${jobId}] Start zadania`, {
                code: String(code || ""),
                started_at: startedAt,
                printer: printerName,
                connection: printerConnection
            });

            if (!printerReady || !zebraDeviceObj) {
                failPrint("Brak połączenia z drukarką Zebra", "printer_not_ready", 0);
                return;
            }

            let zpl;
            const zplStartedMs = monotonicNow();
            try {
                zpl = createZPL(title, code);
                zplMs = monotonicNow() - zplStartedMs;
            } catch (error) {
                zplMs = monotonicNow() - zplStartedMs;
                failPrint(error.message || String(error), "zpl_error", 0);
                return;
            }

            requestStartedMs = monotonicNow();
            console.info(`[ZEBRA TIMING #${jobId}] Wysyłanie do localhost:9100`, {
                zpl_ms: roundTiming(zplMs),
                zpl_characters: zpl.length
            });

            GM_xmlhttpRequest({
                method: "POST",
                url: "http://localhost:9100/write",
                timeout: 7000,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify({ device: zebraDeviceObj, data: zpl }),
                onload: response => {
                    if (response.status >= 200 && response.status < 300) {
                        const timing = createTiming("accepted_by_print_service", response.status);
                        console.info(
                            `[ZEBRA TIMING #${jobId}] Usługa przyjęła zadanie w ${formatPrintDuration(timing.total_ms)}`,
                            timing
                        );
                        resolve(timing);
                    } else {
                        failPrint(
                            `Drukarka zwróciła HTTP ${response.status}`,
                            "http_error",
                            response.status
                        );
                    }
                },
                onerror: () => {
                    printerReady = false;
                    failPrint("Błąd połączenia z drukarką", "connection_error", 0);
                    setTimeout(initPrinter, 1000);
                },
                ontimeout: () => {
                    printerReady = false;
                    failPrint("Przekroczono czas oczekiwania na drukarkę", "timeout", 0);
                    setTimeout(initPrinter, 1000);
                }
            });
        });
    }

    function createZPL(title, code) {
        const safeTitle = String(title || "")
            .replace(/[\^~\r\n]/g, " ")
            .replace(/\s+/g, " ")
            .substring(0, 80);
        const safeCode = String(code || "")
            .replace(/[\^~\r\n]/g, "")
            .trim();
        if (!safeCode) throw new Error("Brak kodu do wydrukowania");
        const bytes = new TextEncoder().encode(safeTitle);
        const titleHex = Array.from(bytes).map(b => "_" + b.toString(16).padStart(2, "0").toUpperCase()).join("");
        const fCodeParts = safeCode.match(/.{1,3}/g);
        const fCode = fCodeParts ? fCodeParts.join(" ") : safeCode;
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
^BY3,2,100
^BCN,85,N,N,N
^FD${safeCode}^FS
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

        if (!window.location.href.includes("orders_returns")) {
            wrapper.style.display = "none";
        }

        const toggleBtn = document.createElement("button");
        toggleBtn.innerHTML = "📦 Skaner Zwrotów";
        toggleBtn.style.cssText = `
            position: fixed; bottom: 30px; left: 30px;
            z-index: 9999999; background: #3b82f6; color: white; border: none;
            padding: 12px 24px; border-radius: 50px; font-size: 15px; font-weight: bold;
            cursor: pointer; box-shadow: 0 4px 15px rgba(0,0,0,0.4); outline: none;
        `;

        const panel = document.createElement("div");
        panel.style.cssText = `
            display: none; position: fixed; top: 3vh; left: 2vw;
            z-index: 9999998; width: 96vw; height: 94vh; box-sizing: border-box;
            background: var(--bg-panel); color: var(--text-main);
            border: 2px solid #3b82f6; border-radius: 12px;
            padding: 30px 40px; box-shadow: 0 10px 45px rgba(0,0,0,0.6);
        `;

        const contentRow = document.createElement("div");
        contentRow.style.cssText = `display: flex; gap: 50px; align-items: stretch; height: 100%; box-sizing: border-box;`;

        // LEWA KOLUMNA
        const leftCol = document.createElement("div");
        leftCol.style.cssText = `flex: 0 0 40%; display: flex; flex-direction: column;`;

        const title = document.createElement("div");
        title.innerHTML = "<strong>📦 Skaner Zwrotów (Zebra)</strong>";
        title.style.fontSize = "22px"; title.style.color = "var(--text-main)"; title.style.marginBottom = "20px";

        returnsStatusEl = document.createElement("div");
        returnsStatusEl.style.cssText = `font-size: 15px; color: var(--text-muted); margin-bottom: 4px;`;

        productsStatusEl = document.createElement("div");
        productsStatusEl.style.cssText = `font-size: 15px; color: var(--text-muted); margin-bottom: 8px;`;

        printerStatusEl = document.createElement("div");
        printerStatusEl.style.cssText = `font-size: 15px; color: var(--text-muted); margin-bottom: 4px;`;

        baseStatusEl = document.createElement("div");
        baseStatusEl.style.cssText = `font-size: 15px; color: var(--text-muted); margin-bottom: 12px;`;
        baseStatusEl.innerText = getWebhookSecret()
            ? "✅ Integracja Base gotowa"
            : "⚠️ Ustaw WEBHOOK_SECRET w menu Tampermonkey";

        scanCounterEl = document.createElement("div");
        scanCounterEl.style.cssText = `font-size: 15px; color: var(--text-sub); margin-bottom: 25px; padding-bottom: 15px; border-bottom: 1px dashed var(--border-color);`;
        updateScanCounterUI();

        const input = document.createElement("input");
        input.type = "text"; input.placeholder = "Zeskanuj numer przesyłki..."; input.className = "stocksell-input";

        const reprintBtn = document.createElement("button");
        reprintBtn.innerHTML = "🖨️ Wydrukuj ostatni kod";
        reprintBtn.style.cssText = `
            margin-top: 15px; width: 100%; padding: 14px; font-size: 16px; 
            background-color: #3b82f6; color: #ffffff; border: none; 
            border-radius: 8px; cursor: pointer; font-weight: bold; 
            transition: all 0.2s; box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;
        reprintBtn.onmouseover = () => reprintBtn.style.backgroundColor = "#2563eb";
        reprintBtn.onmouseout = () => reprintBtn.style.backgroundColor = "#3b82f6";
        
        const resultEl = document.createElement("div");
        resultEl.style.cssText = `margin-top: 25px; font-size: 18px; font-weight: bold; min-height: 30px; text-align: center;`;

        leftCol.append(title, returnsStatusEl, productsStatusEl, printerStatusEl, baseStatusEl, scanCounterEl, input, reprintBtn, resultEl);

        // PRAWA KOLUMNA 
        const rightCol = document.createElement("div");
        rightCol.style.cssText = `flex: 1; border-left: 1px solid var(--border-color); padding-left: 40px; display: flex; flex-direction: column; height: 100%;`;

        const rightHeader = document.createElement("div");
        rightHeader.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid var(--border-color); flex-shrink: 0;`;

        const historyTitle = document.createElement("div");
        historyTitle.innerHTML = "<strong>Historia skanów:</strong>";
        historyTitle.style.cssText = `font-size: 18px; color: var(--text-sub);`;

        const buttonsContainer = document.createElement("div");
        buttonsContainer.style.cssText = `display: flex; gap: 12px;`;

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

        // Historia przewijana
        historyContainer = document.createElement("div");
        historyContainer.className = "stocksell-scroll";
        historyContainer.style.cssText = `display: flex; flex-direction: column; flex: 1; overflow-y: auto; padding-right: 15px;`;

        updateRecentScansUI();
        rightCol.append(rightHeader, historyContainer);

        contentRow.append(leftCol, rightCol);
        panel.appendChild(contentRow);
        wrapper.append(panel, toggleBtn);
        document.body.appendChild(wrapper);

        // DYNAMICZNE KOLORY BŁĘDÓW
        let lastAlertType = null;
        let lastAlertColor = null;

        function getDynamicColor(type) {
            if (type === "rejected") {
                if (lastAlertType === "rejected") {
                    lastAlertColor = (lastAlertColor === "#f59e0b") ? "#ef4444" : "#f59e0b";
                } else {
                    lastAlertColor = "#f59e0b"; 
                }
                lastAlertType = "rejected";
                return lastAlertColor;
            } else if (type === "error") {
                if (lastAlertType === "error") {
                    lastAlertColor = (lastAlertColor === "#ef4444") ? "#f59e0b" : "#ef4444";
                } else {
                    lastAlertColor = "#ef4444"; 
                }
                lastAlertType = "error";
                return lastAlertColor;
            }
        }
        
        function resetDynamicColor() {
            lastAlertType = null;
            lastAlertColor = null;
        }

        // LOGIKA SKANOWANIA
        toggleBtn.onclick = () => {
            const isHidden = panel.style.display === "none";
            panel.style.display = isHidden ? "block" : "none";
            toggleBtn.innerHTML = isHidden ? "✖ Zamknij Zwroty" : "📦 Skaner Zwrotów";
            toggleBtn.style.background = isHidden ? "#ef4444" : "#3b82f6";
            if (isHidden) { setTimeout(() => input.focus(), 100); updateScanCounterUI(); }
        };

        // Ponowny wydruk
        reprintBtn.onclick = async () => {
            if (lastPrintedCode && lastPrintedTitle) {
                if (!printerReady) {
                    playErrorSound();
                    const color = getDynamicColor("error");
                    resultEl.style.color = "";
                    resultEl.innerHTML = `<div style="color: ${color};">❌ Brak połączenia z drukarką!</div>`;
                    return;
                }
                
                resetDynamicColor();
                resultEl.style.color = "";
                resultEl.innerHTML = `<div style="color: #3b82f6;">🖨️ Ponowne drukowanie ${lastPrintedCode}...</div>`;

                let reprintTiming = null;
                try {
                    reprintTiming = await printLabel(lastPrintedTitle, lastPrintedCode);
                } catch (error) {
                    playErrorSound();
                    const color = getDynamicColor("error");
                    resultEl.innerHTML = `
                        <div style="color: ${color};">❌ ${error.message}</div>
                        ${printTimingHtml(error.printTiming)}
                    `;
                    setTimeout(() => input.focus(), 100);
                    return;
                }
                
                let imgHtml = "";
                if (lastPrintedImage) {
                    imgHtml = `<div style="margin-top: 20px; text-align: center;">
                        <img src="${lastPrintedImage}" onerror="this.style.display='none'" style="max-height: 280px; max-width: 100%; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); object-fit: contain;">
                    </div>`;
                }

                resultEl.style.color = "";
                resultEl.innerHTML = `
                    <div style="color: #10b981; font-size: 18px; margin-bottom: 12px;">✔️ Wydrukowano ponownie: ${lastPrintedCode}</div>
                    <div style="color: var(--text-main); font-size: 22px; line-height: 1.4; padding: 0 10px;">${lastPrintedTitle}</div>
                    ${printTimingHtml(reprintTiming)}
                    ${imgHtml}
                `;
            } else {
                playErrorSound();
                const color = getDynamicColor("error");
                resultEl.style.color = "";
                resultEl.innerHTML = `<div style="color: ${color};">❌ Brak kodu do ponownego wydruku!</div>`;
            }
            setTimeout(() => input.focus(), 100);
        };

        input.addEventListener("keydown", async function(e) {
            if (e.key === "Enter") {
                const trackingInput = input.value.trim().toLowerCase();
                input.value = "";
                if (!trackingInput) return;

                incrementScanCounter();

                const retData = returnsCache.get(trackingInput);

                if (!retData) {
                    playErrorSound();
                    const color = getDynamicColor("error");
                    resultEl.style.color = "";
                    resultEl.innerHTML = `<div style="color: ${color};">❌ Nie znaleziono przesyłki w bazie.</div>`;
                    addScanToHistory(trackingInput, "-", "Brak przesyłki w 'zgłoszone'", "error");
                    setTimeout(() => sendLogToSheet("-", trackingInput, "nie znaleziono"), 10);
                    return;
                }

                if (retData.accepted !== "tak") {
                    playErrorSound();
                    const color = getDynamicColor("rejected");
                    resultEl.style.color = "";
                    resultEl.innerHTML = `<div style="color: ${color};">⚠️ Zwrot: ${retData.return_nr} | Odrzucono (nie do przyjęcia)</div>`;
                    addScanToHistory(trackingInput, "-", `Odrzucono (Zwrot ${retData.return_nr})`, "error");
                    setTimeout(() => sendLogToSheet(retData.return_nr, trackingInput, "nie"), 10);
                    return;
                }

                if (!retData.print_code) {
                    playErrorSound();
                    const color = getDynamicColor("error");
                    resultEl.style.color = "";
                    resultEl.innerHTML = `<div style="color: ${color};">❌ Zwrot: ${retData.return_nr} | Brak kodu w 'zgłoszone'</div>`;
                    addScanToHistory(trackingInput, "-", `Brak SKU w zgłoszone (${retData.return_nr})`, "error");
                    setTimeout(() => sendLogToSheet(retData.return_nr, trackingInput, "tak"), 10);
                    return;
                }

                let rawCode = retData.print_code.trim();
                let cleanCode = "";
                let finalTitle = retData.title ? retData.title : `Zwrot ${retData.return_nr}`;
                let finalImage = retData.image_url ? retData.image_url : null;

                if (rawCode.toLowerCase().startsWith("stocksell_")) {
                    cleanCode = rawCode.replace(/stocksell_/gi, '');
                } else {
                    const product = productCache.get(rawCode.toLowerCase());
                    if (product && product.code) {
                        cleanCode = product.code;
                        if (!retData.title && product.title) finalTitle = product.title;
                    } else {
                        playErrorSound();
                        const color = getDynamicColor("error");
                        resultEl.style.color = "";
                        resultEl.innerHTML = `<div style="color: ${color};">❌ Zwrot: ${retData.return_nr} | Brak SKU w bazie produktów: ${rawCode}</div>`;
                        addScanToHistory(trackingInput, "-", `Brak w bazie prod: ${rawCode}`, "error");
                        setTimeout(() => sendLogToSheet(retData.return_nr, trackingInput, "tak"), 10);
                        return;
                    }
                }

                if (!printerReady) {
                    playErrorSound();
                    const color = getDynamicColor("error");
                    resultEl.style.color = "";
                    resultEl.innerHTML = `<div style="color: ${color};">❌ Brak połączenia z drukarką!</div>`;
                    addScanToHistory(trackingInput, cleanCode, "Brak drukarki", "error");
                    setTimeout(() => sendLogToSheet(retData.return_nr, trackingInput, "tak"), 10);
                    return;
                }

                resetDynamicColor();
                
                let imgHtml = "";
                if (finalImage) {
                    imgHtml = `<div style="margin-top: 20px; text-align: center;">
                        <img src="${finalImage}" onerror="this.style.display='none'" style="max-height: 280px; max-width: 100%; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); object-fit: contain;">
                    </div>`;
                }

                resultEl.style.color = "";
                resultEl.innerHTML = `
                    <div style="color: #10b981; font-size: 18px; margin-bottom: 12px;">✔️ Drukowanie: ${cleanCode}</div>
                    <div style="color: var(--text-main); font-size: 22px; line-height: 1.4; padding: 0 10px;">${finalTitle}</div>
                    ${imgHtml}
                `;

                let printTiming = null;
                try {
                    // Dopiero HTTP 2xx z lokalnej usługi Zebra oznacza przyjęcie zadania druku.
                    printTiming = await printLabel(finalTitle, cleanCode);
                } catch (error) {
                    playErrorSound();
                    const color = getDynamicColor("error");
                    resultEl.style.color = "";
                    resultEl.innerHTML = `
                        <div style="color: ${color};">❌ ${error.message}</div>
                        ${printTimingHtml(error.printTiming)}
                    `;
                    addScanToHistory(trackingInput, cleanCode, `Błąd wydruku: ${error.message}`, "error");
                    setTimeout(() => sendLogToSheet(retData.return_nr, trackingInput, "tak"), 10);
                    setTimeout(() => input.focus(), 100);
                    return;
                }

                // Zapamiętanie do ponownego wydruku dopiero po przyjęciu zadania przez drukarkę.
                lastPrintedCode = cleanCode;
                lastPrintedTitle = finalTitle;
                lastPrintedImage = finalImage;

                resultEl.style.color = "";
                resultEl.innerHTML = `
                    <div style="color: #10b981; font-size: 18px; margin-bottom: 12px;">✅ Wydrukowano: ${cleanCode}</div>
                    <div style="color: var(--text-main); font-size: 22px; line-height: 1.4; padding: 0 10px;">${finalTitle}</div>
                    ${printTimingHtml(printTiming)}
                    ${imgHtml}
                `;

                addScanToHistory(trackingInput, cleanCode, finalTitle, "success");
                setTimeout(() => sendLogToSheet(retData.return_nr, trackingInput, "tak"), 10);

                // Zmiana statusu jest niezależną kolejką. Jej błąd nie drukuje etykiety ponownie.
                if (enqueueStatusUpdate(retData, trackingInput, cleanCode)) {
                    flushPendingStatusUpdates(true);
                } else if (baseStatusEl) {
                    baseStatusEl.innerText = "❌ Nie ustalono numeru zwrotu do aktualizacji Base";
                }
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

    GM_registerMenuCommand("Ustaw WEBHOOK_SECRET dla Base", configureWebhookSecret);
    GM_registerMenuCommand("Ponów oczekujące zmiany statusów", () => {
        flushPendingStatusUpdates(true);
    });
    GM_registerMenuCommand(
        "Przenieś zwrot po numerze — bez ponownego druku",
        retryStatusUpdateByReturnId
    );

    setInterval(checkUrlVisibility, 500);
    setInterval(() => flushPendingStatusUpdates(false), STATUS_RETRY_INTERVAL);
    setInterval(() => preloadReturns(true), RETURNS_AUTO_REFRESH_INTERVAL);

    setTimeout(() => {
        if (window.location.href.includes("panel.baselinker.com")) {
            createCollapsibleUI();
            preloadReturns(false);
            preloadProducts(false);
            initPrinter();
            flushPendingStatusUpdates(false);
        }
    }, 500);

})();
