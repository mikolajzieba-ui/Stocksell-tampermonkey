// ==UserScript==
// @name         BaseLinker Skaner Zwrotów (Zebra)
// @namespace    stocksell-returns
// @version      3.4.0
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

    // Lokalny most Zebra Browser Print. Wydruki muszą przechodzić pojedynczo:
    // równoległe POST-y /write potrafią zablokować usługę lub port USB.
    const PRINTER_BRIDGE_URL = "http://localhost:9100";
    const PRINTER_DISCOVERY_TIMEOUT = 5000;
    const PRINT_REQUEST_TIMEOUT = 25000;
    const PRINT_WATCHDOG_GRACE = 1000;
    const PRINT_QUEUE_GAP = 200;
    const PRINTER_RECONNECT_DELAY = 3000;
    const PREFERRED_PRINTER_KEY = "stocksell_zebra_preferred_printer_v1";
    const PRINT_RECOVERY_KEY = "stocksell_zebra_print_recovery_v1";
    const PROCESSED_TRACKINGS_KEY = "stocksell_zebra_processed_trackings_v1";
    const PROCESSED_TRACKING_TTL = 24 * 60 * 60 * 1000;
    const PRINT_RECOVERY_SENDING_TTL = PRINTER_RECONNECT_DELAY +
        PRINTER_DISCOVERY_TIMEOUT + PRINT_REQUEST_TIMEOUT + PRINT_WATCHDOG_GRACE + 10000;
    const TAB_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let printerReady = false;
    let zebraDeviceObj = null;
    let printerDiscoveryPromise = null;
    let printerReconnectTimer = null;
    let printerReconnectNotBefore = 0;
    let printQueueRunning = false;
    let activePrintJob = null;
    let lastPrintJobFinishedMs = -Infinity;
    const printQueue = [];
    let scannerOperationTail = Promise.resolve();
    let printCircuitPaused = false;
    let printCircuitResumePromise = Promise.resolve();
    let resolvePrintCircuit = null;
    let uncertainPrintContext = null;
    let recoveryActionInProgress = false;
    let reprintOperationPending = false;
    let preferredPrinterName = String(GM_getValue(PREFERRED_PRINTER_KEY, "") || "");

    const returnsCache = new Map();
    const productCache = new Map();
    const processedTrackings = new Set();
    const pendingTrackings = new Set();

    let returnsStatusEl = null;
    let productsStatusEl = null;
    let printerStatusEl = null;
    let scanCounterEl = null;
    let baseStatusEl = null;
    let refreshBtn = null;
    let historyContainer = null;
    let printRecoveryBox = null;
    let printRecoveryMessage = null;
    let confirmPrintedBtn = null;
    let retryUncertainBtn = null;
    let scannerInputEl = null;
    
    // Ostatnia wybrana etykieta (również gdy wynik transportu był niepewny).
    // Dzięki temu po timeoutcie przycisk nie wydrukuje omyłkowo wcześniejszego kodu.
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
        try {
            GM_setValue(STATUS_QUEUE_KEY, JSON.stringify(queue));
        } catch (error) {
            console.error("[RETURNS API] Nie udało się zapisać kolejki statusów", error);
        }
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
            let settled = false;
            let requestHandle = null;
            let watchdogTimer = null;

            function finishSuccess(result) {
                if (settled) return;
                settled = true;
                if (watchdogTimer !== null) clearTimeout(watchdogTimer);
                resolve(result);
            }

            function finishError(message, options = {}) {
                if (settled) return;
                settled = true;
                if (watchdogTimer !== null) clearTimeout(watchdogTimer);
                const error = new Error(message);
                error.httpStatus = Number(options.httpStatus || 0);
                error.permanent = Boolean(options.permanent);
                error.responsePreview = String(options.responsePreview || "").slice(0, 200);
                reject(error);
            }

            watchdogTimer = setTimeout(() => {
                if (settled) return;
                const handleToAbort = requestHandle;
                finishError("Brak odpowiedzi Google Apps Script — przerwano oczekiwanie");
                try {
                    if (handleToAbort && typeof handleToAbort.abort === "function") {
                        handleToAbort.abort();
                    }
                } catch (_) {}
            }, STATUS_REQUEST_TIMEOUT + PRINT_WATCHDOG_GRACE);

            try {
                requestHandle = GM_xmlhttpRequest({
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
                            const permanent = response.status >= 400 && response.status < 500 &&
                                response.status !== 408 && response.status !== 429;
                            finishError(`HTTP ${response.status}`, {
                                httpStatus: response.status,
                                permanent: permanent,
                                responsePreview: response.responseText
                            });
                            return;
                        }

                        try {
                            const result = JSON.parse(response.responseText);
                            if (!result || result.status !== "success") {
                                finishError(result && result.message
                                    ? result.message
                                    : "Backend nie potwierdził zmiany statusu");
                                return;
                            }
                            finishSuccess(result);
                        } catch (error) {
                            finishError("Nieprawidłowa odpowiedź Google Apps Script");
                        }
                    },
                    onerror: () => finishError("Błąd połączenia z Google Apps Script"),
                    ontimeout: () => {
                        const handleToAbort = requestHandle;
                        finishError("Przekroczono czas zmiany statusu w Base");
                        try {
                            if (handleToAbort && typeof handleToAbort.abort === "function") {
                                handleToAbort.abort();
                            }
                        } catch (_) {}
                    },
                    onabort: () => finishError("Przerwano zmianę statusu w Base")
                });
            } catch (error) {
                finishError(`Nie udało się wysłać zmiany statusu: ${error.message || error}`);
            }
        });
    }

    async function flushPendingStatusUpdates(showStatus = false) {
        if (statusSyncInProgress) return;

        let queue = getStatusQueue();
        const parkedItems = queue.filter(item => item && item.permanent_error);
        queue = queue.filter(item => item && !item.permanent_error);
        if (!queue.length) {
            if (baseStatusEl && parkedItems.length > 0) {
                baseStatusEl.innerText = `⚠️ ${parkedItems.length} zmiana statusu wymaga ręcznego ponowienia`;
            } else if (showStatus && baseStatusEl) {
                baseStatusEl.innerText = "✅ Brak oczekujących zmian statusu";
            }
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
                    try {
                        GM_setValue("stocksell_returns_time", "0");
                    } catch (storageError) {
                        console.error("[RETURNS API] Nie udało się unieważnić cache zwrotów", storageError);
                    }

                    console.info(
                        `[RETURNS API] Zwrot ${result.return_id} przeniesiony do statusu ${result.status_id}`
                    );
                    if (baseStatusEl) {
                        baseStatusEl.innerText = `✅ Zwrot ${result.return_id} przeniesiony w Base`;
                    }
                } catch (error) {
                    console.error(`[RETURNS API] Zwrot ${item.return_id}:`, error);
                    if (error.permanent) {
                        const latestQueue = getStatusQueue().map(queued =>
                            String(queued.return_id) === String(item.return_id)
                                ? {
                                    ...queued,
                                    permanent_error: true,
                                    last_http_status: error.httpStatus,
                                    last_error: error.message,
                                    failed_at: new Date().toISOString()
                                }
                                : queued
                        );
                        saveStatusQueue(latestQueue);
                    }
                    if (baseStatusEl) {
                        baseStatusEl.innerText = error.permanent
                            ? `⚠️ Status zwrotu ${item.return_id} zatrzymany (HTTP ${error.httpStatus})`
                            : `⚠️ Status zwrotu ${item.return_id} oczekuje na ponowienie`;
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
        try {
            GM_setValue("returns_recent_scans_v1", JSON.stringify(recentScans));
        } catch (error) {
            console.error("[ZEBRA HISTORY] Nie udało się zapisać historii", error);
        }
        updateRecentScansUI();
    }

    function finalizeSuccessfulScan(context) {
        if (!context || context.source !== "scan" || context.completed) return;

        const tracking = String(context.tracking || "").trim().toLowerCase();
        const code = String(context.code || "");
        const title = String(context.title || "");
        const retData = context.retData;

        markTrackingProcessed(tracking);
        pendingTrackings.delete(tracking);
        returnsCache.delete(tracking);
        addScanToHistory(tracking, code, title, "success");
        setTimeout(() => sendLogToSheet(retData.return_nr, tracking, "tak"), 10);

        // Zmiana statusu jest niezależną kolejką. Jej błąd nie drukuje etykiety ponownie.
        if (enqueueStatusUpdate(retData, tracking, code)) {
            flushPendingStatusUpdates(true);
        } else if (baseStatusEl) {
            baseStatusEl.innerText = "❌ Nie ustalono numeru zwrotu do aktualizacji Base";
        }
        context.completed = true;
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
    function clearPrinterReconnectTimer() {
        if (printerReconnectTimer !== null) {
            clearTimeout(printerReconnectTimer);
            printerReconnectTimer = null;
        }
    }

    function schedulePrinterReconnect(delay = PRINTER_RECONNECT_DELAY) {
        // Jeden timer wystarczy. Wcześniej każde nieudane żądanie mogło dodać
        // następny, co z czasem powodowało równoległe odpytywanie usługi Zebra.
        if (printerReconnectTimer !== null) return;

        const effectiveDelay = Math.max(delay, printerReconnectNotBefore - Date.now(), 0);
        printerReconnectTimer = setTimeout(() => {
            printerReconnectTimer = null;
            const remaining = printerReconnectNotBefore - Date.now();
            if (remaining > 0) {
                schedulePrinterReconnect(remaining);
                return;
            }
            initPrinter({ silent: true });
        }, effectiveDelay);
    }

    function markPrinterUnavailable(statusText) {
        printerReady = false;
        zebraDeviceObj = null;
        printerReconnectNotBefore = Math.max(
            printerReconnectNotBefore,
            Date.now() + PRINTER_RECONNECT_DELAY
        );
        if (printerStatusEl) printerStatusEl.innerText = statusText;
        schedulePrinterReconnect();
    }

    function initPrinter(options = {}) {
        // Single-flight: wszystkie równoczesne próby połączenia współdzielą
        // dokładnie jedno żądanie /available.
        if (printerDiscoveryPromise) return printerDiscoveryPromise;

        const silent = Boolean(options.silent);
        if (!silent && printerStatusEl) printerStatusEl.innerText = "⏳ Szukanie Zebry...";

        const previousPrinterName = String(
            zebraDeviceObj && zebraDeviceObj.name || preferredPrinterName || ""
        );
        const discovery = new Promise(resolve => {
            let settled = false;
            let requestHandle = null;
            let watchdogTimer = null;

            function finish(success, printer, message, error) {
                if (settled) return;
                settled = true;
                if (watchdogTimer !== null) clearTimeout(watchdogTimer);

                if (success) {
                    zebraDeviceObj = printer;
                    printerReady = true;
                    printerReconnectNotBefore = 0;
                    preferredPrinterName = String(printer.name || "");
                    if (preferredPrinterName) {
                        GM_setValue(PREFERRED_PRINTER_KEY, preferredPrinterName);
                    }
                    clearPrinterReconnectTimer();
                    console.info("[ZEBRA TIMING] Wykryto drukarkę", {
                        name: String(printer.name || "nieznana"),
                        connection: String(printer.connection || "nieznane"),
                        deviceType: String(printer.deviceType || "nieznany")
                    });
                    if (printerStatusEl && !activePrintJob && printQueue.length === 0 && !printCircuitPaused) {
                        printerStatusEl.innerText = "🖨️ Zebra połączona";
                    }
                    resolve(true);
                    return;
                }

                console.error(`[ZEBRA TIMING] ${message}`, error || "");
                markPrinterUnavailable(`❌ ${message}`);
                resolve(false);
            }

            watchdogTimer = setTimeout(() => {
                if (settled) return;
                // Najpierw zamykamy stan Promise, dopiero potem abortujemy.
                // Chroni to przed podwójnym callbackiem onabort/ontimeout.
                finish(false, null, "Brak odpowiedzi usługi Zebra");
                try {
                    if (requestHandle && typeof requestHandle.abort === "function") {
                        requestHandle.abort();
                    }
                } catch (_) {}
            }, PRINTER_DISCOVERY_TIMEOUT + PRINT_WATCHDOG_GRACE);

            try {
                requestHandle = GM_xmlhttpRequest({
                    method: "GET",
                    url: `${PRINTER_BRIDGE_URL}/available`,
                    timeout: PRINTER_DISCOVERY_TIMEOUT,
                    onload: function (res) {
                        if (res.status < 200 || res.status >= 300) {
                            finish(false, null, `Usługa Zebra zwróciła HTTP ${res.status}`);
                            return;
                        }

                        try {
                            const data = JSON.parse(res.responseText);
                            const printers = Array.isArray(data.printer)
                                ? data.printer
                                : (data.printer ? [data.printer] : []);
                            const printer = printers.find(p =>
                                p && p.name && previousPrinterName && p.name === previousPrinterName
                            ) || printers.find(p => p && p.name);
                            if (!printer) throw new Error("Nie znaleziono drukarki");
                            finish(true, printer, "");
                        } catch (error) {
                            finish(false, null, "Nie udało się rozpoznać drukarki", error);
                        }
                    },
                    onerror: () => finish(false, null, "Błąd połączenia z usługą Zebra"),
                    ontimeout: () => {
                        finish(false, null, "Timeout wykrywania drukarki");
                        try {
                            if (requestHandle && typeof requestHandle.abort === "function") {
                                requestHandle.abort();
                            }
                        } catch (_) {}
                    },
                    onabort: () => finish(false, null, "Przerwano wykrywanie drukarki")
                });
            } catch (error) {
                finish(false, null, "Nie udało się uruchomić połączenia z Zebrą", error);
            }
        });

        printerDiscoveryPromise = discovery;
        discovery.then(() => {
            if (printerDiscoveryPromise === discovery) printerDiscoveryPromise = null;
        });
        return discovery;
    }

    async function ensurePrinterReady() {
        if (printerReady && zebraDeviceObj) return;
        const reconnectWait = Math.max(0, printerReconnectNotBefore - Date.now());
        if (reconnectWait > 0) await wait(reconnectWait);
        const connected = await initPrinter();
        if (!connected || !printerReady || !zebraDeviceObj) {
            throw new Error("Brak połączenia z drukarką Zebra");
        }
    }

    function updatePrintRecoveryUI() {
        if (!printRecoveryBox) return;

        if (!printCircuitPaused || !uncertainPrintContext) {
            printRecoveryBox.style.display = "none";
            return;
        }

        const code = String(uncertainPrintContext.code || "-");
        const definitelyNotSent = uncertainPrintContext.recoveryMode === "not_sent";
        const waitingForOtherTab = uncertainPrintContext.recoveryMode === "waiting";
        printRecoveryBox.style.display = "block";
        if (printRecoveryMessage) {
            printRecoveryMessage.textContent = waitingForOtherTab
                ? `Zadanie ${code} jest obsługiwane w innej karcie. Ta kolejka czeka na jego zakończenie.`
                : (definitelyNotSent
                    ? `Etykieta ${code} nie została wysłana. Napraw połączenie i ponów albo pomiń zadanie — kolejka jest wstrzymana.`
                    : `Nie wiadomo, czy etykieta ${code} została wydrukowana. Sprawdź drukarkę — kolejka jest wstrzymana.`);
        }
        if (confirmPrintedBtn) {
            confirmPrintedBtn.textContent = waitingForOtherTab
                ? "⏳ Oczekiwanie na inną kartę"
                : (definitelyNotSent
                    ? "⏭️ Pomiń ten kod — wznów"
                    : "✅ Etykieta wyszła — wznów");
            confirmPrintedBtn.disabled = recoveryActionInProgress || waitingForOtherTab;
        }
        if (retryUncertainBtn) {
            retryUncertainBtn.textContent = waitingForOtherTab
                ? "⏳ Nie ponawiaj w tej karcie"
                : (definitelyNotSent
                    ? "🔄 Połącz i ponów"
                    : "🖨️ Nie wyszła — ponów");
            retryUncertainBtn.disabled = recoveryActionInProgress || waitingForOtherTab;
        }
    }

    function pausePrintCircuit(context) {
        uncertainPrintContext = context;
        if (!printCircuitPaused) {
            printCircuitPaused = true;
            printCircuitResumePromise = new Promise(resolve => {
                resolvePrintCircuit = resolve;
            });
        }

        if (printerStatusEl) {
            printerStatusEl.innerText = "⚠️ Kolejka wstrzymana — sprawdź ostatnią etykietę";
        }
        if (scannerInputEl) {
            scannerInputEl.disabled = true;
            scannerInputEl.placeholder = "Kolejka wstrzymana — rozstrzygnij ostatni wydruk";
            scannerInputEl.blur();
        }
        updatePrintRecoveryUI();
    }

    function resumePrintCircuit() {
        if (!printCircuitPaused) return;

        const resume = resolvePrintCircuit;
        const contextToRelease = uncertainPrintContext;
        printCircuitPaused = false;
        resolvePrintCircuit = null;
        printCircuitResumePromise = Promise.resolve();
        uncertainPrintContext = null;
        if (contextToRelease && contextToRelease.source === "scan" && contextToRelease.tracking) {
            pendingTrackings.delete(String(contextToRelease.tracking).trim().toLowerCase());
        }
        recoveryActionInProgress = false;
        updatePrintRecoveryUI();
        if (printerStatusEl) {
            printerStatusEl.innerText = printerReady
                ? "🖨️ Zebra połączona | kolejka wznowiona"
                : "⏳ Kolejka wznowiona — ponowne łączenie z Zebrą";
        }
        if (scannerInputEl) {
            scannerInputEl.disabled = false;
            scannerInputEl.placeholder = "Zeskanuj numer przesyłki...";
            setTimeout(() => scannerInputEl.focus(), 100);
        }
        if (typeof resume === "function") resume();
    }

    async function waitForPrintCircuit() {
        while (printCircuitPaused) {
            await printCircuitResumePromise;
        }
    }

    async function printLabelRespectingRecovery(title, code, context) {
        while (true) {
            try {
                return await printLabel(title, code, context);
            } catch (error) {
                if (!error.blockingRecoveryContext) throw error;

                // Zadanie z innej karty ma pierwszeństwo. Bieżący skan pozostaje
                // w swojej kolejce i zostanie ponowiony dopiero po rozstrzygnięciu tamtego.
                pausePrintCircuit(error.blockingRecoveryContext);
                await waitForPrintCircuit();
            }
        }
    }

    function createPrintAttemptId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function getProcessedTrackingTimes() {
        const saved = GM_getValue(PROCESSED_TRACKINGS_KEY, "{}");
        let parsed;
        try {
            parsed = typeof saved === "string" ? JSON.parse(saved) : saved;
        } catch (_) {
            parsed = {};
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};

        const cutoff = Date.now() - PROCESSED_TRACKING_TTL;
        let changed = false;
        Object.keys(parsed).forEach(tracking => {
            if (Number(parsed[tracking] || 0) < cutoff) {
                delete parsed[tracking];
                changed = true;
            }
        });
        if (changed) {
            try {
                GM_setValue(PROCESSED_TRACKINGS_KEY, JSON.stringify(parsed));
            } catch (error) {
                console.error("[ZEBRA RECOVERY] Nie udało się oczyścić starych trackingów", error);
            }
        }
        return parsed;
    }

    function isTrackingProcessed(tracking) {
        const normalized = String(tracking || "").trim().toLowerCase();
        if (!normalized) return false;
        if (processedTrackings.has(normalized)) return true;

        const saved = getProcessedTrackingTimes();
        if (Number(saved[normalized] || 0) > 0) {
            processedTrackings.add(normalized);
            return true;
        }
        return false;
    }

    function markTrackingProcessed(tracking) {
        const normalized = String(tracking || "").trim().toLowerCase();
        if (!normalized) return;
        processedTrackings.add(normalized);
        const saved = getProcessedTrackingTimes();
        saved[normalized] = Date.now();
        try {
            GM_setValue(PROCESSED_TRACKINGS_KEY, JSON.stringify(saved));
        } catch (error) {
            console.error("[ZEBRA RECOVERY] Nie udało się utrwalić trackingu", error);
        }
    }

    function loadPrintRecoveryRecord() {
        const saved = GM_getValue(PRINT_RECOVERY_KEY, "");
        if (!saved) return null;
        try {
            const record = typeof saved === "string" ? JSON.parse(saved) : saved;
            if (!record || !record.context || !record.context.code) return null;
            return record;
        } catch (error) {
            console.error("[ZEBRA RECOVERY] Uszkodzony zapis recovery", error);
            return null;
        }
    }

    function savePrintRecoveryContext(context, state, error) {
        if (!context || !context.code) return false;
        const serializableContext = {
            attemptId: String(context.attemptId || createPrintAttemptId()),
            source: context.source === "scan" ? "scan" : "reprint",
            tracking: String(context.tracking || ""),
            code: String(context.code || ""),
            title: String(context.title || ""),
            image: context.image ? String(context.image) : null,
            retData: context.source === "scan" ? context.retData : null,
            recoveryMode: state === "not_sent" ? "not_sent" : "uncertain"
        };
        context.attemptId = serializableContext.attemptId;
        try {
            GM_setValue(PRINT_RECOVERY_KEY, JSON.stringify({
                version: 1,
                state: state,
                owner_id: TAB_INSTANCE_ID,
                saved_at: new Date().toISOString(),
                error: error ? String(error.message || error) : "",
                context: serializableContext
            }));
            return true;
        } catch (storageError) {
            console.error("[ZEBRA RECOVERY] Nie udało się zapisać recovery", storageError);
            return false;
        }
    }

    function clearPrintRecoveryContext(context) {
        const current = loadPrintRecoveryRecord();
        if (
            context && current && current.context &&
            context.attemptId && current.context.attemptId &&
            String(context.attemptId) !== String(current.context.attemptId)
        ) {
            return;
        }
        try {
            GM_setValue(PRINT_RECOVERY_KEY, "");
        } catch (error) {
            console.error("[ZEBRA RECOVERY] Nie udało się wyczyścić recovery", error);
        }
    }

    function restorePrintRecoveryState(resultEl) {
        const record = loadPrintRecoveryRecord();
        if (!record || !["sending", "uncertain", "not_sent"].includes(record.state)) return;
        if (record.owner_id === TAB_INSTANCE_ID && activePrintJob) return;

        const context = record.context;
        context.completed = false;
        const savedAtMs = Date.parse(record.saved_at || "");
        const sendingIsFresh = record.state === "sending" && Number.isFinite(savedAtMs) &&
            Date.now() - savedAtMs < PRINT_RECOVERY_SENDING_TTL;
        context.recoveryMode = record.state === "not_sent"
            ? "not_sent"
            : (sendingIsFresh ? "waiting" : "uncertain");
        if (record.state === "sending" && !sendingIsFresh) {
            savePrintRecoveryContext(context, "uncertain", new Error("Niedokończone zadanie po zamknięciu karty"));
        }
        lastPrintedCode = context.code;
        lastPrintedTitle = context.title;
        lastPrintedImage = context.image;
        if (context.source === "scan" && context.tracking) {
            pendingTrackings.add(String(context.tracking).trim().toLowerCase());
        }
        pausePrintCircuit(context);
        if (resultEl) {
            resultEl.innerHTML = `
                <div style="color: #f59e0b;">⚠️ Odtworzono niedokończone zadanie ${context.code} po przeładowaniu strony.</div>
            `;
        }
    }

    function syncSharedPrintRecovery(resultEl) {
        if (!printCircuitPaused || !uncertainPrintContext) return;

        const record = loadPrintRecoveryRecord();
        if (!record || !["sending", "uncertain", "not_sent"].includes(record.state)) {
            // Inna karta zakończyła lub świadomie pominęła zadanie.
            resumePrintCircuit();
            return;
        }

        const currentAttemptId = String(uncertainPrintContext.attemptId || "");
        const storedAttemptId = String(record.context.attemptId || "");
        const savedAtMs = Date.parse(record.saved_at || "");
        const sendingIsFresh = record.state === "sending" && Number.isFinite(savedAtMs) &&
            Date.now() - savedAtMs < PRINT_RECOVERY_SENDING_TTL;
        const desiredMode = record.state === "not_sent"
            ? "not_sent"
            : (sendingIsFresh ? "waiting" : "uncertain");

        if (record.state === "sending" && !sendingIsFresh) {
            record.context.recoveryMode = "uncertain";
            savePrintRecoveryContext(
                record.context,
                "uncertain",
                new Error("Brak zakończenia zadania z innej karty")
            );
        }

        if (currentAttemptId !== storedAttemptId || uncertainPrintContext.recoveryMode !== desiredMode) {
            if (currentAttemptId !== storedAttemptId &&
                uncertainPrintContext.source === "scan" && uncertainPrintContext.tracking) {
                pendingTrackings.delete(String(uncertainPrintContext.tracking).trim().toLowerCase());
            }
            record.context.completed = false;
            record.context.recoveryMode = desiredMode;
            uncertainPrintContext = record.context;
            if (record.context.source === "scan" && record.context.tracking) {
                pendingTrackings.add(String(record.context.tracking).trim().toLowerCase());
            }
            updatePrintRecoveryUI();
            if (resultEl && desiredMode !== "waiting") {
                resultEl.innerHTML = `<div style="color: #f59e0b;">⚠️ Zadanie ${record.context.code} wymaga rozstrzygnięcia.</div>`;
            }
        }
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

        const queueInfo = Number(timing.queue_wait_ms || 0) > 0
            ? `, kolejka: ${formatPrintDuration(timing.queue_wait_ms)}`
            : "";

        return `
            <div style="margin-top: 10px; color: var(--text-muted); font-size: 14px;">
                ⏱️ Przekazanie zadania: <strong>${formatPrintDuration(timing.total_ms)}</strong>
                (ZPL: ${formatPrintDuration(timing.zpl_ms)},
                usługa: ${formatPrintDuration(timing.bridge_ms)}${queueInfo})
            </div>
        `;
    }

    function uncertainPrintHintHtml(error) {
        if (!error || !error.printOutcomeUncertain) return "";
        return `
            <div style="margin-top: 12px; color: #f59e0b; font-size: 15px; line-height: 1.4;">
                ⚠️ Nie ponawiam automatycznie, ponieważ etykieta mogła mimo wszystko wyjść.
                Sprawdź drukarkę; jeśli jej nie ma, wybierz w pomarańczowym polu „Nie wyszła — ponów”.
            </div>
        `;
    }

    function printLabel(title, code, recoveryContext = null) {
        const job = {
            id: ++printJobSequence,
            title: String(title || ""),
            code: String(code || ""),
            queuedAtMs: monotonicNow(),
            queuedAt: new Date().toISOString(),
            recoveryContext: recoveryContext
        };

        return new Promise((resolve, reject) => {
            job.resolve = resolve;
            job.reject = reject;
            printQueue.push(job);

            console.info(`[ZEBRA TIMING #${job.id}] Dodano do kolejki`, {
                code: job.code,
                jobs_ahead: printQueue.length - 1 + (activePrintJob ? 1 : 0)
            });

            if (printerStatusEl) {
                const waiting = printQueue.length;
                printerStatusEl.innerText = activePrintJob
                    ? `🖨️ Drukowanie | oczekuje: ${waiting}`
                    : `🖨️ Zadanie w kolejce (${waiting})`;
            }

            drainPrintQueue();
        });
    }

    function wait(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    function enqueueScannerOperation(operation) {
        // Serializujemy nie tylko sam POST /write, lecz także wynik w UI i historię.
        // Dzięki temu starszy skan nie nadpisze komunikatu nowszego skanu.
        const run = scannerOperationTail.catch(() => {}).then(operation);
        scannerOperationTail = run.catch(error => {
            console.error("[ZEBRA SCAN QUEUE] Błąd operacji skanera", error);
        });
        return run;
    }

    function runWithCrossTabPrinterLock(operation) {
        // Web Locks chroni również przed równoległym /write z drugiej karty
        // BaseLinkera. Starsze przeglądarki korzystają z lokalnej kolejki FIFO.
        if (navigator.locks && typeof navigator.locks.request === "function") {
            return navigator.locks.request(
                "stocksell-zebra-write-v1",
                { mode: "exclusive" },
                operation
            );
        }
        return operation();
    }

    function runWithRecoveryActionLock(context, operation) {
        const attemptId = String(context && context.attemptId || "unknown");
        if (navigator.locks && typeof navigator.locks.request === "function") {
            return navigator.locks.request(
                `stocksell-zebra-recovery-${attemptId}`,
                { mode: "exclusive" },
                operation
            );
        }
        return operation();
    }

    async function drainPrintQueue() {
        if (printQueueRunning) return;
        printQueueRunning = true;

        try {
            while (printQueue.length > 0) {
                const job = printQueue.shift();
                activePrintJob = job;

                if (printerStatusEl) {
                    const suffix = printQueue.length > 0 ? ` | oczekuje: ${printQueue.length}` : "";
                    printerStatusEl.innerText = `🖨️ Przekazywanie ${job.code}${suffix}`;
                }

                const gapRemaining = PRINT_QUEUE_GAP - (monotonicNow() - lastPrintJobFinishedMs);
                if (gapRemaining > 0) await wait(gapRemaining);

                try {
                    const timing = await runWithCrossTabPrinterLock(() => executePrintJob(job));
                    job.resolve(timing);
                } catch (error) {
                    job.reject(error);
                } finally {
                    activePrintJob = null;
                    lastPrintJobFinishedMs = monotonicNow();
                }
            }
        } finally {
            printQueueRunning = false;
            activePrintJob = null;
            if (printerStatusEl) {
                printerStatusEl.innerText = printCircuitPaused
                    ? "⚠️ Kolejka wstrzymana — sprawdź ostatnią etykietę"
                    : (printerReady
                        ? "🖨️ Zebra połączona | kolejka pusta"
                        : "❌ Zebra rozłączona — trwa ponowne łączenie");
            }
        }
    }

    async function executePrintJob(job) {
        const startedMs = monotonicNow();
        const startedAt = new Date().toISOString();
        const queueWaitMs = Math.max(0, startedMs - job.queuedAtMs);
        let printerName = "nieznana";
        let printerConnection = "nieznane";
        let zplMs = 0;
        let requestStartedMs = null;

        function createTiming(phase, httpStatus) {
            const finishedMs = monotonicNow();
            return {
                job_id: job.id,
                code: job.code,
                phase: phase,
                queued_at: job.queuedAt,
                started_at: startedAt,
                finished_at: new Date().toISOString(),
                printer: printerName,
                connection: printerConnection,
                http_status: Number(httpStatus || 0),
                queue_wait_ms: roundTiming(queueWaitMs),
                zpl_ms: roundTiming(zplMs),
                bridge_ms: requestStartedMs === null
                    ? 0
                    : roundTiming(finishedMs - requestStartedMs),
                total_ms: roundTiming(finishedMs - startedMs)
            };
        }

        function createPrintError(message, phase, httpStatus, outcomeUncertain = false) {
            const timing = createTiming(phase, httpStatus);
            const error = new Error(message);
            error.printTiming = timing;
            error.printOutcomeUncertain = outcomeUncertain;
            console.error(`[ZEBRA TIMING #${job.id}] ${message}`, timing);
            return error;
        }

        console.info(`[ZEBRA TIMING #${job.id}] Start zadania z kolejki`, {
            code: job.code,
            queue_wait_ms: roundTiming(queueWaitMs)
        });

        const recoveryContext = job.recoveryContext;
        if (recoveryContext) {
            if (
                recoveryContext.source === "scan" && recoveryContext.tracking &&
                isTrackingProcessed(recoveryContext.tracking)
            ) {
                const error = createPrintError(
                    "Ta przesyłka została już przetworzona w innej karcie",
                    "already_processed",
                    0,
                    false
                );
                error.alreadyProcessed = true;
                throw error;
            }

            const existingRecovery = loadPrintRecoveryRecord();
            const existingIsActive = existingRecovery &&
                ["sending", "uncertain", "not_sent"].includes(existingRecovery.state);
            const existingAttemptId = existingRecovery && existingRecovery.context
                ? String(existingRecovery.context.attemptId || "")
                : "";
            const currentAttemptId = String(recoveryContext.attemptId || "");

            if (recoveryContext.requireExistingClaim &&
                (!existingIsActive || existingAttemptId !== currentAttemptId)) {
                const error = createPrintError(
                    "Zadanie zostało już rozstrzygnięte w innej karcie",
                    "already_resolved",
                    0,
                    false
                );
                error.alreadyResolved = true;
                throw error;
            }

            if (existingIsActive && existingAttemptId && existingAttemptId !== currentAttemptId) {
                const error = createPrintError(
                    `Inne zadanie (${existingRecovery.context.code}) wymaga najpierw rozstrzygnięcia`,
                    "blocked_by_recovery",
                    0,
                    false
                );
                error.blockingRecoveryContext = existingRecovery.context;
                error.blockingRecoveryContext.recoveryMode = existingRecovery.state === "not_sent"
                    ? "not_sent"
                    : (existingRecovery.state === "sending" ? "waiting" : "uncertain");
                throw error;
            }

            // Rezerwacja jest wykonywana pod międzykartową blokadą Web Locks,
            // więc druga karta nie rozpocznie /write, dopóki ta próba nie zostanie rozstrzygnięta.
            if (!savePrintRecoveryContext(recoveryContext, "sending")) {
                throw createPrintError(
                    "Nie udało się zapisać bezpiecznej rezerwacji wydruku",
                    "recovery_storage_error",
                    0,
                    false
                );
            }
        }

        let zpl;
        const zplStartedMs = monotonicNow();
        try {
            zpl = createZPL(job.title, job.code);
            zplMs = monotonicNow() - zplStartedMs;
        } catch (error) {
            zplMs = monotonicNow() - zplStartedMs;
            if (recoveryContext) {
                recoveryContext.recoveryMode = "not_sent";
                savePrintRecoveryContext(recoveryContext, "not_sent", error);
            }
            throw createPrintError(error.message || String(error), "zpl_error", 0, false);
        }

        try {
            await ensurePrinterReady();
        } catch (error) {
            if (recoveryContext) {
                recoveryContext.recoveryMode = "not_sent";
                savePrintRecoveryContext(recoveryContext, "not_sent", error);
            }
            throw createPrintError(
                error.message || "Brak połączenia z drukarką Zebra",
                "printer_not_ready",
                0,
                false
            );
        }

        // Snapshot urządzenia dla tego zadania. Reconnect nie może podmienić
        // globalnego obiektu w trakcie serializacji żądania.
        const deviceForJob = zebraDeviceObj;
        printerName = String(deviceForJob && deviceForJob.name || "nieznana");
        printerConnection = String(
            deviceForJob && (deviceForJob.connection || deviceForJob.deviceType) || "nieznane"
        );
        if (recoveryContext && !savePrintRecoveryContext(recoveryContext, "sending")) {
            throw createPrintError(
                "Nie udało się odświeżyć bezpiecznej rezerwacji wydruku",
                "recovery_storage_error",
                0,
                false
            );
        }
        requestStartedMs = monotonicNow();

        console.info(`[ZEBRA TIMING #${job.id}] Wysyłanie do localhost:9100`, {
            zpl_ms: roundTiming(zplMs),
            zpl_characters: zpl.length,
            timeout_ms: PRINT_REQUEST_TIMEOUT
        });

        return new Promise((resolve, reject) => {
            let settled = false;
            let requestHandle = null;
            let watchdogTimer = null;

            function cleanup() {
                if (watchdogTimer !== null) {
                    clearTimeout(watchdogTimer);
                    watchdogTimer = null;
                }
            }

            function accept(httpStatus) {
                if (settled) return;
                settled = true;
                cleanup();
                const timing = createTiming("accepted_by_print_service", httpStatus);
                if (recoveryContext) {
                    try {
                        if (recoveryContext.source === "scan") {
                            finalizeSuccessfulScan(recoveryContext);
                        }
                    } catch (finalizeError) {
                        console.error("[ZEBRA RECOVERY] Błąd finalizacji przyjętego zadania", finalizeError);
                        if (recoveryContext.tracking) {
                            markTrackingProcessed(recoveryContext.tracking);
                        }
                    } finally {
                        clearPrintRecoveryContext(recoveryContext);
                    }
                }
                console.info(
                    `[ZEBRA TIMING #${job.id}] Usługa przyjęła zadanie w ${formatPrintDuration(timing.total_ms)}`,
                    timing
                );
                resolve(timing);
            }

            function fail(message, phase, httpStatus, outcomeUncertain, disconnectPrinter) {
                if (settled) return;
                settled = true;
                cleanup();
                if (disconnectPrinter) {
                    markPrinterUnavailable("❌ Utracono połączenie z Zebrą — ponowne łączenie...");
                }
                if (recoveryContext) {
                    recoveryContext.recoveryMode = outcomeUncertain ? "uncertain" : "not_sent";
                    savePrintRecoveryContext(
                        recoveryContext,
                        recoveryContext.recoveryMode,
                        new Error(message)
                    );
                }
                reject(createPrintError(message, phase, httpStatus, outcomeUncertain));
            }

            watchdogTimer = setTimeout(() => {
                if (settled) return;
                const handleToAbort = requestHandle;
                fail(
                    "Brak odpowiedzi usługi Zebra. Wynik wydruku jest nieznany — sprawdź drukarkę przed ponowieniem.",
                    "watchdog_timeout",
                    0,
                    true,
                    true
                );
                try {
                    if (handleToAbort && typeof handleToAbort.abort === "function") {
                        handleToAbort.abort();
                    }
                } catch (_) {}
            }, PRINT_REQUEST_TIMEOUT + PRINT_WATCHDOG_GRACE);

            try {
                requestHandle = GM_xmlhttpRequest({
                    method: "POST",
                    url: `${PRINTER_BRIDGE_URL}/write`,
                    timeout: PRINT_REQUEST_TIMEOUT,
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify({ device: deviceForJob, data: zpl }),
                    onload: response => {
                        if (response.status >= 200 && response.status < 300) {
                            accept(response.status);
                        } else {
                            const outcomeUncertain = response.status >= 500;
                            fail(
                                outcomeUncertain
                                    ? `Usługa Zebra zwróciła HTTP ${response.status}. Wynik wydruku jest nieznany.`
                                    : `Usługa Zebra odrzuciła zadanie (HTTP ${response.status})`,
                                "http_error",
                                response.status,
                                outcomeUncertain,
                                true
                            );
                        }
                    },
                    onerror: () => fail(
                        "Błąd połączenia z Zebrą. Wynik wydruku jest nieznany — sprawdź drukarkę przed ponowieniem.",
                        "connection_error",
                        0,
                        true,
                        true
                    ),
                    ontimeout: () => {
                        const handleToAbort = requestHandle;
                        fail(
                            "Przekroczono czas odpowiedzi Zebry. Wynik wydruku jest nieznany — sprawdź drukarkę przed ponowieniem.",
                            "timeout",
                            0,
                            true,
                            true
                        );
                        try {
                            if (handleToAbort && typeof handleToAbort.abort === "function") {
                                handleToAbort.abort();
                            }
                        } catch (_) {}
                    },
                    onabort: () => fail(
                        "Połączenie z Zebrą zostało przerwane. Wynik wydruku jest nieznany.",
                        "aborted",
                        0,
                        true,
                        true
                    )
                });
            } catch (error) {
                fail(
                    `Nie udało się wysłać zadania do Zebry: ${error.message || error}`,
                    "request_error",
                    0,
                    false,
                    true
                );
            }
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
        scannerInputEl = input;

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

        printRecoveryBox = document.createElement("div");
        printRecoveryBox.style.cssText = `
            display: none; margin-top: 15px; padding: 14px;
            border: 2px solid #f59e0b; border-radius: 8px;
            background: rgba(245, 158, 11, 0.12);
        `;

        printRecoveryMessage = document.createElement("div");
        printRecoveryMessage.style.cssText = `color: var(--text-main); font-size: 15px; line-height: 1.4; margin-bottom: 12px;`;

        const recoveryButtons = document.createElement("div");
        recoveryButtons.style.cssText = `display: flex; gap: 10px;`;

        confirmPrintedBtn = document.createElement("button");
        confirmPrintedBtn.type = "button";
        confirmPrintedBtn.textContent = "✅ Etykieta wyszła — wznów";
        confirmPrintedBtn.className = "stocksell-btn";
        confirmPrintedBtn.style.flex = "1";

        retryUncertainBtn = document.createElement("button");
        retryUncertainBtn.type = "button";
        retryUncertainBtn.textContent = "🖨️ Nie wyszła — ponów";
        retryUncertainBtn.className = "stocksell-btn";
        retryUncertainBtn.style.cssText = `flex: 1; background: #f59e0b; color: #111827;`;

        recoveryButtons.append(confirmPrintedBtn, retryUncertainBtn);
        printRecoveryBox.append(printRecoveryMessage, recoveryButtons);
        
        const resultEl = document.createElement("div");
        resultEl.style.cssText = `margin-top: 25px; font-size: 18px; font-weight: bold; min-height: 30px; text-align: center;`;

        leftCol.append(title, returnsStatusEl, productsStatusEl, printerStatusEl, baseStatusEl, scanCounterEl, input, reprintBtn, printRecoveryBox, resultEl);

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

        confirmPrintedBtn.onclick = async () => {
            if (recoveryActionInProgress || !uncertainPrintContext) return;
            const context = uncertainPrintContext;
            const clickedRecord = loadPrintRecoveryRecord();
            const expectedRevision = clickedRecord ? String(clickedRecord.saved_at || "") : "";
            recoveryActionInProgress = true;
            updatePrintRecoveryUI();

            try {
                const decision = await runWithRecoveryActionLock(context, async () => {
                    const current = loadPrintRecoveryRecord();
                    const currentAttemptId = current && current.context
                        ? String(current.context.attemptId || "")
                        : "";
                    if (!current || currentAttemptId !== String(context.attemptId || "") ||
                        String(current.saved_at || "") !== expectedRevision) {
                        return { resolvedElsewhere: true, skipped: false };
                    }

                    const skipped = context.recoveryMode === "not_sent";
                    if (!skipped && context.source === "scan") finalizeSuccessfulScan(context);
                    if (skipped && context.source === "scan" && context.tracking) {
                        pendingTrackings.delete(String(context.tracking).trim().toLowerCase());
                    }
                    clearPrintRecoveryContext(context);
                    return { resolvedElsewhere: false, skipped: skipped };
                });
                resultEl.style.color = "";
                resultEl.innerHTML = decision.resolvedElsewhere
                    ? `<div style="color: #10b981;">✅ Zadanie rozstrzygnięto już w innej karcie. Kolejka wznowiona.</div>`
                    : (decision.skipped
                        ? `<div style="color: #f59e0b;">⏭️ Pominięto ${context.code}. Kolejka wznowiona.</div>`
                        : `<div style="color: #10b981;">✅ Potwierdzono etykietę ${context.code}. Kolejka wznowiona.</div>`);
                resumePrintCircuit();
            } catch (error) {
                recoveryActionInProgress = false;
                updatePrintRecoveryUI();
                console.error("[ZEBRA RECOVERY] Nie udało się zakończyć recovery", error);
                resultEl.innerHTML = `<div style="color: #ef4444;">❌ Nie udało się zapisać decyzji. Spróbuj ponownie.</div>`;
            } finally {
                setTimeout(() => input.focus(), 100);
            }
        };

        retryUncertainBtn.onclick = async () => {
            if (recoveryActionInProgress || !uncertainPrintContext) return;
            const context = uncertainPrintContext;
            const clickedRecord = loadPrintRecoveryRecord();
            const expectedRevision = clickedRecord ? String(clickedRecord.saved_at || "") : "";
            recoveryActionInProgress = true;
            updatePrintRecoveryUI();
            resultEl.style.color = "";
            resultEl.innerHTML = `<div style="color: #3b82f6;">🖨️ Ręczne ponowienie ${context.code}...</div>`;

            try {
                const retryResult = await runWithRecoveryActionLock(context, async () => {
                    const current = loadPrintRecoveryRecord();
                    const currentAttemptId = current && current.context
                        ? String(current.context.attemptId || "")
                        : "";
                    if (!current || currentAttemptId !== String(context.attemptId || "") ||
                        String(current.saved_at || "") !== expectedRevision) {
                        return { resolvedElsewhere: true, timing: null };
                    }

                    context.requireExistingClaim = true;
                    let timing;
                    try {
                        timing = await printLabelRespectingRecovery(
                            context.title,
                            context.code,
                            context
                        );
                    } finally {
                        delete context.requireExistingClaim;
                    }
                    return { resolvedElsewhere: false, timing: timing };
                });
                resultEl.innerHTML = retryResult.resolvedElsewhere
                    ? `<div style="color: #10b981;">✅ Zadanie rozstrzygnięto już w innej karcie. Kolejka wznowiona.</div>`
                    : `
                        <div style="color: #10b981;">✅ Usługa Zebra przyjęła ponowienie: ${context.code}</div>
                        ${printTimingHtml(retryResult.timing)}
                    `;
                resumePrintCircuit();
            } catch (error) {
                if (error.alreadyResolved || error.alreadyProcessed) {
                    resultEl.innerHTML = `<div style="color: #10b981;">✅ Zadanie rozstrzygnięto już w innej karcie. Kolejka wznowiona.</div>`;
                    resumePrintCircuit();
                    return;
                }
                recoveryActionInProgress = false;
                context.recoveryMode = error.printOutcomeUncertain ? "uncertain" : "not_sent";
                savePrintRecoveryContext(context, context.recoveryMode, error);
                playErrorSound();
                const color = getDynamicColor("error");
                resultEl.innerHTML = `
                    <div style="color: ${color};">❌ ${error.message}</div>
                    ${printTimingHtml(error.printTiming)}
                    ${uncertainPrintHintHtml(error)}
                `;
                // Bez względu na typ błędu kolejka pozostaje wstrzymana,
                // dopóki operator jawnie nie rozstrzygnie bieżącej etykiety.
                pausePrintCircuit(context);
            } finally {
                setTimeout(() => input.focus(), 100);
            }
        };

        // Ponowny wydruk trafia do tej samej kolejki co skany.
        reprintBtn.onclick = () => {
            if (!printCircuitPaused) restorePrintRecoveryState(resultEl);
            if (reprintOperationPending) {
                resultEl.innerHTML = `<div style="color: #f59e0b;">⚠️ Ponowny wydruk już oczekuje.</div>`;
                return;
            }

            if (printCircuitPaused) {
                updatePrintRecoveryUI();
                resultEl.innerHTML = `<div style="color: #f59e0b;">⚠️ Najpierw rozstrzygnij niepewny wydruk w pomarańczowym polu.</div>`;
                return;
            }

            if (pendingTrackings.size > 0 || activePrintJob) {
                resultEl.innerHTML = `<div style="color: #f59e0b;">⚠️ Poczekaj na zakończenie bieżących skanów.</div>`;
                setTimeout(() => input.focus(), 100);
                return;
            }

            // Snapshot w chwili kliknięcia zapobiega wydrukowaniu innego kodu,
            // jeśli stan ostatniej etykiety zmieni się przed wykonaniem operacji.
            const reprintContext = {
                attemptId: createPrintAttemptId(),
                source: "reprint",
                code: lastPrintedCode,
                title: lastPrintedTitle,
                image: lastPrintedImage
            };

            reprintOperationPending = true;
            enqueueScannerOperation(async () => {
                if (!printCircuitPaused) restorePrintRecoveryState(resultEl);
                await waitForPrintCircuit();
                if (reprintContext.code && reprintContext.title) {
                    resetDynamicColor();
                    resultEl.style.color = "";
                    resultEl.innerHTML = `<div style="color: #3b82f6;">🖨️ Ponowne drukowanie ${reprintContext.code}...</div>`;

                    let reprintTiming = null;
                    try {
                        reprintTiming = await printLabelRespectingRecovery(
                            reprintContext.title,
                            reprintContext.code,
                            reprintContext
                        );
                    } catch (error) {
                        playErrorSound();
                        const color = getDynamicColor("error");
                        resultEl.innerHTML = `
                            <div style="color: ${color};">❌ ${error.message}</div>
                            ${printTimingHtml(error.printTiming)}
                            ${uncertainPrintHintHtml(error)}
                        `;
                        reprintContext.recoveryMode = error.printOutcomeUncertain
                            ? "uncertain"
                            : "not_sent";
                        savePrintRecoveryContext(reprintContext, reprintContext.recoveryMode, error);
                        pausePrintCircuit(reprintContext);
                        return;
                    }

                    let imgHtml = "";
                    if (reprintContext.image) {
                        imgHtml = `<div style="margin-top: 20px; text-align: center;">
                            <img src="${reprintContext.image}" onerror="this.style.display='none'" style="max-height: 280px; max-width: 100%; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); object-fit: contain;">
                        </div>`;
                    }

                    resultEl.style.color = "";
                    resultEl.innerHTML = `
                        <div style="color: #10b981; font-size: 18px; margin-bottom: 12px;">✔️ Usługa Zebra przyjęła ponowny wydruk: ${reprintContext.code}</div>
                        <div style="color: var(--text-main); font-size: 22px; line-height: 1.4; padding: 0 10px;">${reprintContext.title}</div>
                        ${printTimingHtml(reprintTiming)}
                        ${imgHtml}
                    `;
                } else {
                    playErrorSound();
                    const color = getDynamicColor("error");
                    resultEl.style.color = "";
                    resultEl.innerHTML = `<div style="color: ${color};">❌ Brak kodu do ponownego wydruku!</div>`;
                }
            }).catch(error => {
                console.error("[ZEBRA REPRINT] Nieoczekiwany błąd", error);
                playErrorSound();
                resultEl.innerHTML = `<div style="color: #ef4444;">❌ Nieoczekiwany błąd ponownego wydruku</div>`;
            }).finally(() => {
                reprintOperationPending = false;
                setTimeout(() => input.focus(), 100);
            });
        };

        input.addEventListener("keydown", function(e) {
            if (e.key !== "Enter" || e.repeat) return;
            e.preventDefault();

            // Wartość przechwytujemy i czyścimy od razu, aby skaner mógł wpisać
            // kolejny numer, podczas gdy poprzedni czeka w kolejce.
            const trackingInput = String(input.value || "").trim().toLowerCase();
            input.value = "";
            if (!trackingInput) return;

            if (pendingTrackings.has(trackingInput)) {
                playErrorSound();
                console.warn(`[ZEBRA SCAN] Pominięto powtórny skan oczekującej przesyłki: ${trackingInput}`);
                if (!printCircuitPaused) {
                    resultEl.innerHTML = `<div style="color: #f59e0b;">⚠️ Ta przesyłka już oczekuje w kolejce.</div>`;
                }
                return;
            }

            pendingTrackings.add(trackingInput);
            let keepPendingForRecovery = false;

            enqueueScannerOperation(async () => {
                if (!printCircuitPaused) restorePrintRecoveryState(resultEl);
                await waitForPrintCircuit();
                incrementScanCounter();

                if (isTrackingProcessed(trackingInput)) {
                    playErrorSound();
                    const color = getDynamicColor("rejected");
                    resultEl.style.color = "";
                    resultEl.innerHTML = `
                        <div style="color: ${color};">⚠️ Ta przesyłka została już przetworzona w tej sesji.</div>
                        <div style="margin-top: 8px; color: var(--text-muted); font-size: 14px;">Jeśli potrzebujesz duplikatu, użyj przycisku ponownego wydruku.</div>
                    `;
                    return;
                }

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

                if (String(retData.accepted || "").trim().toLowerCase() !== "tak") {
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

                let rawCode = String(retData.print_code || "").trim();
                let cleanCode = "";
                let finalTitle = retData.title ? String(retData.title) : `Zwrot ${retData.return_nr}`;
                let finalImage = retData.image_url ? String(retData.image_url) : null;

                if (rawCode.toLowerCase().startsWith("stocksell_")) {
                    cleanCode = rawCode.replace(/stocksell_/gi, '');
                } else {
                    const product = productCache.get(rawCode.toLowerCase());
                    if (product && product.code) {
                        cleanCode = String(product.code).trim();
                        if (!retData.title && product.title) finalTitle = String(product.title);
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

                resetDynamicColor();
                
                let imgHtml = "";
                if (finalImage) {
                    imgHtml = `<div style="margin-top: 20px; text-align: center;">
                        <img src="${finalImage}" onerror="this.style.display='none'" style="max-height: 280px; max-width: 100%; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); object-fit: contain;">
                    </div>`;
                }

                resultEl.style.color = "";
                resultEl.innerHTML = `
                    <div style="color: #3b82f6; font-size: 18px; margin-bottom: 12px;">🖨️ Kolejkowanie wydruku: ${cleanCode}</div>
                    <div style="color: var(--text-main); font-size: 22px; line-height: 1.4; padding: 0 10px;">${finalTitle}</div>
                    ${imgHtml}
                `;

                // Kandydat do ręcznego ponowienia jest ustawiany przed transportem.
                // Po timeoutcie wynik jest nieznany, więc przycisk musi wskazywać
                // bieżący kod, a nie wcześniejszą poprawnie przyjętą etykietę.
                const scanContext = {
                    attemptId: createPrintAttemptId(),
                    source: "scan",
                    tracking: trackingInput,
                    code: cleanCode,
                    title: finalTitle,
                    image: finalImage,
                    retData: retData,
                    completed: false
                };
                lastPrintedCode = cleanCode;
                lastPrintedTitle = finalTitle;
                lastPrintedImage = finalImage;

                let printTiming = null;
                try {
                    // Dopiero HTTP 2xx z lokalnej usługi Zebra oznacza przyjęcie zadania druku.
                    printTiming = await printLabelRespectingRecovery(
                        finalTitle,
                        cleanCode,
                        scanContext
                    );
                } catch (error) {
                    if (error.alreadyProcessed) {
                        clearPrintRecoveryContext(scanContext);
                        resultEl.style.color = "";
                        resultEl.innerHTML = `
                            <div style="color: #f59e0b;">⚠️ Ta przesyłka została już przetworzona w innej karcie.</div>
                        `;
                        return;
                    }
                    playErrorSound();
                    const color = getDynamicColor("error");
                    resultEl.style.color = "";
                    resultEl.innerHTML = `
                        <div style="color: ${color};">❌ ${error.message}</div>
                        ${printTimingHtml(error.printTiming)}
                        ${uncertainPrintHintHtml(error)}
                    `;
                    addScanToHistory(trackingInput, cleanCode, `Błąd wydruku: ${error.message}`, "error");
                    keepPendingForRecovery = true;
                    scanContext.recoveryMode = error.printOutcomeUncertain
                        ? "uncertain"
                        : "not_sent";
                    savePrintRecoveryContext(scanContext, scanContext.recoveryMode, error);
                    pausePrintCircuit(scanContext);
                    return;
                }

                resultEl.style.color = "";
                resultEl.innerHTML = `
                    <div style="color: #10b981; font-size: 18px; margin-bottom: 12px;">✅ Usługa Zebra przyjęła zadanie: ${cleanCode}</div>
                    <div style="color: var(--text-main); font-size: 22px; line-height: 1.4; padding: 0 10px;">${finalTitle}</div>
                    ${printTimingHtml(printTiming)}
                    ${imgHtml}
                `;

                finalizeSuccessfulScan(scanContext);
            }).catch(error => {
                console.error("[ZEBRA SCAN] Nieoczekiwany błąd obsługi skanu", error);
                playErrorSound();
                const color = getDynamicColor("error");
                resultEl.style.color = "";
                resultEl.innerHTML = `<div style="color: ${color};">❌ Błąd obsługi skanu: ${error.message || error}</div>`;
                addScanToHistory(trackingInput, "-", "Nieoczekiwany błąd obsługi skanu", "error");
            }).finally(() => {
                if (!keepPendingForRecovery) pendingTrackings.delete(trackingInput);
                setTimeout(() => input.focus(), 100);
            });
        });

        restorePrintRecoveryState(resultEl);
        setInterval(() => syncSharedPrintRecovery(resultEl), 1000);
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

    window.addEventListener("beforeunload", event => {
        if (!printCircuitPaused && !activePrintJob && pendingTrackings.size === 0) return;
        // Przeglądarka pokaże własny standardowy komunikat ostrzegawczy.
        event.preventDefault();
        event.returnValue = "";
    });

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
