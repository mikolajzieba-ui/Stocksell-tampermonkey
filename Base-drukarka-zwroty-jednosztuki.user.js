// ==UserScript==
// @name         BaseLinker Skaner Zwrotów (Zebra)
// @namespace    stocksell-returns
// @version      4.3.5
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

    // Transport Zebra Browser Print. Oficjalna biblioteka używa 127.0.0.1.
    const PRINT_BRIDGE_URL = "http://127.0.0.1:9100";
    const PRINT_SOFT_WARNING_MS = 4000;
    const PRINT_HARD_TIMEOUT_MS = 90000;
    const PRINT_KEEPALIVE_INTERVAL_MS = 120000;
    const PRINT_UNCERTAIN_STATE_KEY = "stocksell_print_uncertain_v1";
    const PRINTER_ROLES = Object.freeze({
        presort: { model: "ZD420", label: "ZD420 · skanowanie przesyłek" },
        multi: { model: "ZD411", label: "ZD411 · zwroty wielosztukowe" }
    });
    const printerDevices = { presort: null, multi: null };

    const returnsCache = new Map();
    const returnsById = new Map();
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
    let lastPrintedKind = "product";
    let lastPrintedPrinterRole = "presort";

    let recentScans = JSON.parse(GM_getValue("returns_recent_scans_v1", "[]"));
    let currentTheme = GM_getValue("stocksell_theme", "dark");
    let statusSyncInProgress = false;
    let returnsLoading = false;
    let printJobSequence = 0;
    let printerDiscoveryInProgress = false;
    let printerReconnectTimer = null;
    let printWorkerRunning = false;
    let activePrintTask = null;
    let printTransportBlocked = false;
    let keepAliveSweepRunning = false;
    const lastPrinterActivityAt = { presort: 0, multi: 0 };
    const printTransportQueue = [];

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
                --code-color: #fbbf24; --code-bg: rgba(245, 158, 11, 0.13);
            }
            #stocksell-returns-scanner-wrapper[data-theme="light"] {
                --bg-panel: #ffffff; --text-main: #111827; --text-muted: #6b7280;
                --text-sub: #4b5563; --border-color: #e5e7eb; --input-bg: #f9fafb;
                --input-border: #d1d5db; --btn-bg: #f3f4f6; --btn-hover: #e5e7eb;
                --scroll-thumb: #d1d5db; --scroll-thumb-hover: #9ca3af;
                --code-color: #b45309; --code-bg: rgba(245, 158, 11, 0.12);
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

            .stocksell-result:empty {
                display: none;
                min-height: 0 !important;
                margin-top: 0 !important;
            }
            
            /* Stylowanie paska przewijania dla historii */
            .stocksell-scroll::-webkit-scrollbar { width: 8px; }
            .stocksell-scroll::-webkit-scrollbar-track { background: transparent; }
            .stocksell-scroll::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 4px; }
            .stocksell-scroll::-webkit-scrollbar-thumb:hover { background: var(--scroll-thumb-hover); }

            .stocksell-multi-grid {
                display: grid;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 12px;
                align-items: stretch;
            }
            .stocksell-multi-card {
                min-width: 0;
                border: 1px solid var(--border-color);
                border-radius: 10px;
                padding: 10px;
                background: var(--input-bg);
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .stocksell-multi-card img {
                width: 100%; height: 100%; object-fit: contain;
                border-radius: 8px; background: #ffffff;
            }
            .stocksell-multi-card-top {
                display: flex; justify-content: space-between; align-items: center;
                gap: 10px; min-width: 0;
            }
            .stocksell-product-code-row {
                display: flex; align-items: center; gap: 7px; min-width: 0;
            }
            .stocksell-product-code {
                flex: 1; min-width: 0; padding: 5px 8px;
                border: 1px solid #f59e0b; border-radius: 7px;
                background: var(--code-bg); color: var(--code-color);
                font-family: monospace; font-size: 18px; line-height: 1.1;
                font-weight: 950; letter-spacing: 0.4px; overflow-wrap: anywhere;
            }
            .stocksell-card-reprint {
                width: 34px; height: 34px; flex: 0 0 34px;
                display: inline-flex; align-items: center; justify-content: center;
                border: 1px solid #3b82f6; border-radius: 7px;
                background: rgba(59, 130, 246, 0.15); color: #fff;
                font-size: 17px; cursor: pointer;
            }
            .stocksell-card-reprint:hover { background: rgba(59, 130, 246, 0.3); }
            .stocksell-card-reprint:disabled { opacity: 0.4; cursor: not-allowed; }
            .stocksell-multi-image {
                height: 270px; display: flex; align-items: center;
                justify-content: center; border-radius: 8px;
                background: #ffffff; overflow: hidden; min-height: 0;
            }
            .stocksell-multi-grid[data-layout="large"] .stocksell-multi-image {
                height: clamp(255px, 34vh, 340px);
            }
            .stocksell-multi-grid[data-layout="compact"] {
                gap: 10px;
            }
            .stocksell-multi-grid[data-layout="compact"] .stocksell-multi-card {
                padding: 8px; gap: 4px;
            }
            .stocksell-multi-grid[data-layout="compact"] .stocksell-multi-image {
                height: clamp(165px, 19vh, 205px);
            }
            .stocksell-multi-grid[data-layout="dense"] .stocksell-multi-image {
                height: 150px;
            }

            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-scanner-title {
                font-size: 20px !important; margin-bottom: 7px !important;
            }
            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-scanner-panel {
                top: 2vh !important;
                height: 96vh !important;
                padding: 14px 20px !important;
            }
            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-system-statuses {
                display: grid;
                grid-template-columns: repeat(5, minmax(0, 1fr));
                gap: 5px 12px;
                margin-bottom: 8px;
                padding: 7px 10px;
                border: 1px solid var(--border-color);
                border-radius: 8px;
                background: var(--input-bg);
            }
            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-system-statuses > div {
                margin: 0 !important;
                padding: 0 !important;
                border: 0 !important;
                font-size: 12.5px !important;
                line-height: 1.35;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-scan-controls {
                display: grid;
                grid-template-columns: minmax(240px, 24%) minmax(0, 1fr);
                gap: 10px;
                align-items: stretch;
            }
            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-mode-btn {
                margin: 0 !important;
                padding: 9px 12px !important;
                font-size: 15px !important;
            }
            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-input {
                padding: 11px 14px;
                font-size: 18px;
            }
            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-multi-workspace {
                margin-top: 8px !important;
                gap: 6px !important;
            }
            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-multi-grid-scroll {
                padding: 2px 6px 6px 0 !important;
            }
            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-multi-header > :first-child {
                font-size: 17px !important;
            }
            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-multi-header > :last-child {
                font-size: 13px !important;
            }
            #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-action-btn {
                padding: 10px 12px !important;
                font-size: 16px !important;
            }
            .stocksell-multi-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 16px;
                min-height: 25px;
                flex-shrink: 0;
            }
            .stocksell-card-verification {
                display: none; flex-direction: column; gap: 5px;
                padding: 7px; border: 2px solid var(--border-color);
                border-radius: 8px; background: var(--input-bg);
            }
            .stocksell-multi-grid.is-verification-mode .stocksell-card-verification {
                display: flex;
            }
            .stocksell-card-verification.is-selected {
                border-color: #f59e0b;
                background: color-mix(in srgb, #f59e0b 10%, var(--input-bg));
            }
            .stocksell-verification-option {
                display: flex; align-items: center; gap: 7px;
                color: var(--text-main); font-size: 12.5px; font-weight: 800;
                cursor: pointer;
            }
            .stocksell-verification-option input[type="checkbox"] {
                width: 18px; height: 18px; margin: 0;
                accent-color: #f59e0b; cursor: pointer; flex-shrink: 0;
            }
            .stocksell-verification-description {
                display: none; box-sizing: border-box; width: 100%; height: 38px;
                padding: 7px 8px;
                border: 2px solid var(--input-border);
                border-radius: 7px; background: var(--bg-panel); color: var(--text-main);
                font-size: 12.5px; line-height: 1.2;
            }
            .stocksell-card-verification.has-custom .stocksell-verification-description {
                display: block;
            }
            .stocksell-verification-description:focus { border-color: #f59e0b; outline: none; }
            .stocksell-verification-description:disabled { opacity: 0.45; cursor: not-allowed; }
            .stocksell-inline-verification-footer {
                display: none; flex-direction: column; gap: 6px; flex-shrink: 0;
                padding-top: 8px; border-top: 1px solid var(--border-color);
            }
            .stocksell-return-verification {
                display: flex; align-items: center; justify-content: center;
                flex-wrap: wrap; gap: 8px 22px; padding: 7px 10px;
                border: 2px solid #f59e0b; border-radius: 8px;
                background: var(--input-bg);
            }
            .stocksell-return-verification-title {
                color: #f59e0b; font-size: 14px; font-weight: 950;
            }
            .stocksell-return-verification label {
                display: flex; align-items: center; gap: 7px;
                color: var(--text-main); font-size: 14px; font-weight: 850;
                cursor: pointer;
            }
            .stocksell-return-verification input[type="checkbox"] {
                width: 19px; height: 19px; margin: 0;
                accent-color: #f59e0b; cursor: pointer;
            }
            .stocksell-return-verification-description {
                display: none; flex: 1 0 100%; box-sizing: border-box;
                width: 100%; max-width: 760px; height: 38px;
                padding: 7px 10px; margin: 0 auto;
                border: 2px solid var(--input-border); border-radius: 7px;
                background: var(--bg-panel); color: var(--text-main);
                font-size: 13px; line-height: 1.2;
            }
            .stocksell-return-verification.has-custom .stocksell-return-verification-description {
                display: block;
            }
            .stocksell-return-verification-description:focus {
                border-color: #f59e0b; outline: none;
            }
            .stocksell-verification-actions {
                display: flex; gap: 12px; flex-shrink: 0;
            }
            .stocksell-action-btn:disabled,
            .stocksell-mode-btn:disabled {
                opacity: 0.45; cursor: not-allowed; filter: grayscale(0.35);
            }
            @media (max-width: 1250px) {
                .stocksell-multi-grid { gap: 10px; }
                .stocksell-multi-grid[data-layout="large"] .stocksell-multi-image {
                    height: clamp(250px, 35vh, 330px);
                }
                #stocksell-returns-scanner-wrapper.stocksell-multi-mode .stocksell-system-statuses {
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                }
            }
            @media (max-width: 1000px) {
                .stocksell-multi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            }
            @media (max-height: 850px) {
                .stocksell-multi-grid[data-layout="large"] .stocksell-multi-image {
                    height: clamp(215px, 31vh, 275px);
                }
                .stocksell-multi-grid[data-layout="compact"] .stocksell-multi-image {
                    height: 115px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    //////////////////////////////////////////////////////
    // LOGOWANIE DO ARKUSZA (BEZ CIASTECZEK)
    //////////////////////////////////////////////////////
    function postReturnsApi(payload, timeout = STATUS_REQUEST_TIMEOUT) {
        return new Promise((resolve, reject) => {
            if (!RETURNS_API_URL) {
                reject(new Error("Brak adresu Google Apps Script"));
                return;
            }

            GM_xmlhttpRequest({
                method: "POST",
                url: RETURNS_API_URL,
                anonymous: true,
                timeout: timeout,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify(payload),
                onload: response => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`Google Apps Script zwrócił HTTP ${response.status}`));
                        return;
                    }

                    let result;
                    try {
                        result = JSON.parse(response.responseText);
                    } catch (error) {
                        reject(new Error("Google Apps Script zwrócił nieprawidłową odpowiedź"));
                        return;
                    }

                    if (!result || result.status !== "success") {
                        reject(new Error(
                            result && result.message
                                ? result.message
                                : "Google Apps Script nie potwierdził operacji"
                        ));
                        return;
                    }

                    resolve(result);
                },
                onerror: () => reject(new Error("Błąd połączenia z Google Apps Script")),
                ontimeout: () => reject(new Error("Przekroczono czas odpowiedzi Google Apps Script"))
            });
        });
    }

    function sendLogToSheet(returnNr, tracking, scanStatus) {
        return postReturnsApi({
            timestamp: new Date().toLocaleString('pl-PL'),
            return_nr: returnNr,
            tracking: tracking,
            status: scanStatus
        });
    }

    function sendMultiAction(action, retData, extraData = {}) {
        const secret = getWebhookSecret();
        if (!secret) {
            return Promise.reject(new Error("Ustaw WEBHOOK_SECRET w menu Tampermonkey"));
        }

        const returnId = String(
            retData && (retData.return_id || retData.return_nr) || ""
        ).trim();
        if (!/^\d+$/.test(returnId)) {
            return Promise.reject(new Error("Nieprawidłowy numer zwrotu"));
        }

        const expectedActions = {
            multi_label_printed: "multi_registered",
            multi_return_state: "multi_state",
            multi_resolve: "multi_resolved"
        };

        return postReturnsApi({
            action: action,
            secret: secret,
            return_id: Number(returnId),
            tracking: String(retData && retData.tracking || "").trim().toLowerCase(),
            ...extraData
        }).then(result => {
            if (result.action !== expectedActions[action]) {
                throw new Error(
                    "Backend nie obsługuje jeszcze wielosztuk. Wdróż nową wersję Google Apps Script."
                );
            }
            return result;
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
        // Zmiany Base nigdy nie współdzielą aktywnego okna pracy drukarki.
        // Zostaną podjęte przez następny cykl po zakończeniu /write.
        if (activePrintTask && activePrintTask.kind === "print") {
            if (showStatus && baseStatusEl) {
                baseStatusEl.innerText = "⏸️ Base poczeka na zakończenie drukowania";
            }
            return;
        }

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
                    returnsById.delete(String(item.return_id || "").trim());
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
            const color = scan.status === 'success'
                ? '#10b981'
                : (scan.status === 'multi' ? '#8b5cf6' : '#ef4444');
            const item = document.createElement("div");
            item.style.cssText = `
                padding: 10px 0; border-bottom: 1px solid var(--border-color);
                display: flex; flex-direction: column; gap: 4px;
            `;
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: bold; color: ${color}; font-family: monospace; font-size: 16px;">${escapeHtml(scan.printCode)}</span>
                    <span style="font-weight: bold; color: var(--text-sub); font-size: 14px;">${escapeHtml(scan.tracking)}</span>
                </div>
                <div style="color: var(--text-main); font-size: 15px;">${escapeHtml(scan.title)}</div>
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
    function indexReturnsData(returns) {
        if (!Array.isArray(returns)) {
            throw new Error("Baza zwrotów nie jest listą");
        }

        returnsCache.clear();
        returnsById.clear();

        returns.forEach(ret => {
            const tracking = String(ret.tracking || "").trim().toLowerCase();
            const returnId = String(ret.return_id || ret.return_nr || "").trim();

            if (tracking) returnsCache.set(tracking, ret);
            if (returnId) returnsById.set(returnId, ret);
        });
    }

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
                indexReturnsData(returns);
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
                    indexReturnsData(returns);
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
    // DRUKARKA — JEDEN NIEZALEŻNY WORKER FIFO
    //////////////////////////////////////////////////////
    function getBrowserPrintDevicePayload(device) {
        return {
            name: String(device && device.name || ""),
            uid: String(device && device.uid || ""),
            connection: String(device && device.connection || ""),
            deviceType: String(device && device.deviceType || "printer"),
            version: Number(device && device.version || 2),
            provider: String(device && device.provider || ""),
            manufacturer: String(device && device.manufacturer || "")
        };
    }

    function getAvailablePrinters(data) {
        if (data && Array.isArray(data.printer)) return data.printer;
        if (data && Array.isArray(data.printers)) return data.printers;
        return [];
    }

    function getPrinterDescription(printer) {
        return [
            printer && printer.name,
            printer && printer.uid,
            printer && printer.manufacturer,
            printer && printer.provider,
            printer && printer.deviceType
        ].join(" ").toLowerCase();
    }

    function choosePreferredPrinter(data, printerRole) {
        const profile = PRINTER_ROLES[printerRole];
        const printers = getAvailablePrinters(data);
        if (!profile || !printers.length) return null;

        const model = profile.model.toLowerCase();
        const matching = printers.filter(function (printer) {
            return getPrinterDescription(printer).includes(model);
        });
        if (!matching.length) return null;

        function score(printer) {
            const description = getPrinterDescription(printer);
            const connection = String(printer && printer.connection || "").toLowerCase();
            let result = 100;
            if (/zebra|zdesigner/.test(description)) result += 40;
            if (connection === "usb") result += 30;
            if (String(printer && printer.deviceType || "").toLowerCase() === "printer") {
                result += 10;
            }
            return result;
        }

        return matching
            .map(function (printer, index) {
                return { printer: printer, index: index, score: score(printer) };
            })
            .sort(function (left, right) {
                return right.score - left.score || left.index - right.index;
            })[0].printer;
    }

    function isPrinterReady(printerRole) {
        return Boolean(PRINTER_ROLES[printerRole] && printerDevices[printerRole]);
    }

    function areAllPrintersReady() {
        return isPrinterReady("presort") && isPrinterReady("multi");
    }

    function getPrinterRoleLabel(printerRole) {
        return PRINTER_ROLES[printerRole]
            ? PRINTER_ROLES[printerRole].label
            : "Nieznana drukarka";
    }

    function schedulePrinterReconnect(delayMs) {
        if (printerReconnectTimer) return;
        printerReconnectTimer = setTimeout(function () {
            printerReconnectTimer = null;
            initPrinter();
        }, delayMs);
    }

    function getUncertainPrintState() {
        const saved = GM_getValue(PRINT_UNCERTAIN_STATE_KEY, "");
        if (!saved) return null;
        try {
            const value = typeof saved === "string" ? JSON.parse(saved) : saved;
            return value && value.code ? value : null;
        } catch (error) {
            console.error("[ZEBRA QUEUE] Uszkodzony stan niepewnego wydruku:", error);
            return null;
        }
    }

    function saveUncertainPrintState(task, state, message) {
        if (!task || task.kind !== "print") return;
        GM_setValue(PRINT_UNCERTAIN_STATE_KEY, JSON.stringify({
            state: state,
            job_id: task.id,
            code: task.code,
            label_kind: task.labelKind,
            printer_role: task.printerRole,
            printer_name: String(task.device && task.device.name || ""),
            started_at: task.startedAt,
            message: String(message || "")
        }));
    }

    function clearUncertainPrintState(showMessage) {
        GM_setValue(PRINT_UNCERTAIN_STATE_KEY, "");
        printTransportBlocked = false;
        if (showMessage && printerStatusEl) {
            printerStatusEl.innerText = "✅ Stan sprawdzony — kolejka drukarki odblokowana";
        }
        if (showMessage && !areAllPrintersReady()) {
            initPrinter(true);
        }
        processPrintTransportQueue();
    }

    function restoreUncertainPrintState() {
        const uncertain = getUncertainPrintState();
        if (!uncertain) return;

        printTransportBlocked = true;
        console.warn(
            "[ZEBRA QUEUE] Poprzedni wydruk ma stan niepewny. Sprawdź fizyczną etykietę.",
            uncertain
        );
        if (printerStatusEl) {
            const uncertainRole = PRINTER_ROLES[uncertain.printer_role]
                ? uncertain.printer_role
                : "presort";
            printerStatusEl.innerText =
                "⚠️ Sprawdź, czy wyszła etykieta " + uncertain.code +
                " z " + getPrinterRoleLabel(uncertainRole) +
                " — kolejka wstrzymana";
        }
    }

    function updatePrintQueueStatus(customMessage) {
        if (!printerStatusEl) return;

        if (customMessage) {
            printerStatusEl.innerText = customMessage;
            return;
        }

        if (printTransportBlocked) {
            const uncertain = getUncertainPrintState();
            printerStatusEl.innerText = uncertain
                ? "⚠️ Niepewny wydruk " + uncertain.code + " — sprawdź etykietę"
                : "⚠️ Kolejka drukarki jest wstrzymana";
            return;
        }

        if (activePrintTask) {
            const activePrinter = getPrinterRoleLabel(activePrintTask.printerRole);
            if (activePrintTask.kind === "keepalive") {
                printerStatusEl.innerText =
                    "🔌 Sprawdzanie " + activePrinter + "…" +
                    (printTransportQueue.length
                        ? " · w kolejce " + printTransportQueue.length
                        : "");
            } else {
                printerStatusEl.innerText =
                    "🖨️ " + activePrinter + " · kod " + activePrintTask.code +
                    " · w kolejce " + printTransportQueue.length;
            }
            return;
        }

        printerStatusEl.innerText =
            "🖨️ ZD420 " + (isPrinterReady("presort") ? "✅" : "❌") +
            " · ZD411 " + (isPrinterReady("multi") ? "✅" : "❌") +
            " · kolejka " + printTransportQueue.length;
    }

    function initPrinter(forceRefresh) {
        if (printerDiscoveryInProgress) return;
        if (areAllPrintersReady() && !forceRefresh) {
            updatePrintQueueStatus();
            return;
        }

        printerDiscoveryInProgress = true;
        if (printerStatusEl) printerStatusEl.innerText = "⏳ Szukanie Zebry…";

        GM_xmlhttpRequest({
            method: "GET",
            url: PRINT_BRIDGE_URL + "/available",
            timeout: 5000,
            onload: function (response) {
                printerDiscoveryInProgress = false;
                try {
                    if (response.status < 200 || response.status >= 300) {
                        throw new Error("HTTP " + response.status);
                    }

                    const data = JSON.parse(response.responseText);
                    const presortPrinter = choosePreferredPrinter(data, "presort");
                    const multiPrinter = choosePreferredPrinter(data, "multi");

                    printerDevices.presort = presortPrinter
                        ? getBrowserPrintDevicePayload(presortPrinter)
                        : null;
                    printerDevices.multi = multiPrinter
                        ? getBrowserPrintDevicePayload(multiPrinter)
                        : null;

                    console.info("[ZEBRA QUEUE] Wykryte drukarki", {
                        presort_ZD420: printerDevices.presort,
                        multi_ZD411: printerDevices.multi
                    });
                    restoreUncertainPrintState();
                    updatePrintQueueStatus();

                    if (!areAllPrintersReady()) {
                        console.warn("[ZEBRA QUEUE] Brakuje wymaganej drukarki", {
                            ZD420: isPrinterReady("presort"),
                            ZD411: isPrinterReady("multi")
                        });
                        schedulePrinterReconnect(5000);
                    }

                    // Obie drukarki są sprawdzane kolejno, bez równoległych zapisów.
                    setTimeout(function () {
                        requestAllPrinterKeepAlives("startup");
                    }, 700);
                } catch (error) {
                    printerDevices.presort = null;
                    printerDevices.multi = null;
                    console.error("[ZEBRA QUEUE] Nie udało się rozpoznać drukarki:", error);
                    if (printerStatusEl) printerStatusEl.innerText = "❌ Nie wykryto ZD420/ZD411";
                    schedulePrinterReconnect(5000);
                }
            },
            onerror: function () {
                printerDiscoveryInProgress = false;
                printerDevices.presort = null;
                printerDevices.multi = null;
                console.error("[ZEBRA QUEUE] Brak połączenia z 127.0.0.1:9100/available");
                if (printerStatusEl) printerStatusEl.innerText = "❌ Brak usługi Zebra Browser Print";
                schedulePrinterReconnect(5000);
            },
            ontimeout: function () {
                printerDiscoveryInProgress = false;
                printerDevices.presort = null;
                printerDevices.multi = null;
                console.error("[ZEBRA QUEUE] Timeout 127.0.0.1:9100/available");
                if (printerStatusEl) printerStatusEl.innerText = "❌ Zebra Browser Print nie odpowiada";
                schedulePrinterReconnect(5000);
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
        if (value < 1000) return Math.round(value) + " ms";
        return (value / 1000).toFixed(2).replace(".", ",") + " s";
    }

    function printTimingHtml(timing) {
        if (!timing) return "";

        return (
            "<div style=\"margin-top:10px;color:var(--text-muted);font-size:14px;\">" +
                "⏱️ Przekazanie do usługi: <strong>" +
                formatPrintDuration(timing.total_ms) +
                "</strong> (kolejka: " +
                formatPrintDuration(timing.queue_ms) +
                ", ZPL: " +
                formatPrintDuration(timing.zpl_ms) +
                ", Browser Print: " +
                formatPrintDuration(timing.bridge_ms) +
                ")" +
            "</div>"
        );
    }

    function buildBridgeTiming(task, phase, httpStatus, requestStartedMs, finishedMs, responseText) {
        return {
            job_id: task.id,
            code: String(task.code || ""),
            label_kind: task.labelKind || task.kind,
            phase: phase,
            started_at: task.startedAt,
            finished_at: new Date().toISOString(),
            printer_role: String(task.printerRole || ""),
            printer: String(task.device && task.device.name || "nieznana"),
            connection: String(task.device && task.device.connection || "nieznane"),
            http_status: Number(httpStatus || 0),
            queue_ms: roundTiming(requestStartedMs - task.queuedMs),
            zpl_ms: roundTiming(task.zplMs || 0),
            bridge_ms: roundTiming(finishedMs - requestStartedMs),
            total_ms: roundTiming(finishedMs - task.queuedMs),
            response: String(responseText || "").substring(0, 300)
        };
    }

    function sendBridgeWrite(task) {
        return new Promise(function (resolve, reject) {
            const requestStartedMs = monotonicNow();
            let settled = false;
            let requestControl = null;
            let slowTicker = null;

            if (task.kind === "print") {
                saveUncertainPrintState(task, "sending", "Zadanie wysłane do Zebra Browser Print");
            }

            function clearTimers() {
                clearTimeout(softWarningTimer);
                clearTimeout(hardTimeoutTimer);
                if (slowTicker) clearInterval(slowTicker);
            }

            function finishSuccess(response) {
                if (settled) return;
                settled = true;
                clearTimers();

                const timing = buildBridgeTiming(
                    task,
                    "bridge_acknowledged",
                    response.status,
                    requestStartedMs,
                    monotonicNow(),
                    response.responseText
                );

                if (task.kind === "print") {
                    clearUncertainPrintState(false);
                    console.info(
                        "[ZEBRA QUEUE #" + task.id + "] Browser Print potwierdził zadanie po " +
                        formatPrintDuration(timing.bridge_ms),
                        timing
                    );
                }

                if (task.printerRole && lastPrinterActivityAt[task.printerRole] !== undefined) {
                    lastPrinterActivityAt[task.printerRole] = Date.now();
                }
                resolve(timing);
            }

            function finishError(message, phase, httpStatus, uncertain) {
                if (settled) return;
                settled = true;
                clearTimers();

                const timing = buildBridgeTiming(
                    task,
                    phase,
                    httpStatus,
                    requestStartedMs,
                    monotonicNow(),
                    ""
                );
                const error = new Error(message);
                error.printTiming = timing;
                error.uncertain = Boolean(uncertain);

                if (task.kind === "print" && uncertain) {
                    saveUncertainPrintState(task, "uncertain", message);
                } else if (task.kind === "print") {
                    clearUncertainPrintState(false);
                }

                console.error("[ZEBRA QUEUE #" + task.id + "] " + message, timing);
                reject(error);
            }

            const softWarningTimer = setTimeout(function () {
                const elapsed = monotonicNow() - requestStartedMs;
                console.warn(
                    "[ZEBRA QUEUE #" + task.id + "] Browser Print odpowiada wolno: " +
                    formatPrintDuration(elapsed)
                );
                updatePrintQueueStatus(
                    "⚠️ Drukarka odpowiada wolno (" +
                    formatPrintDuration(elapsed) +
                    ") — nie skanuj ponownie"
                );

                slowTicker = setInterval(function () {
                    const currentElapsed = monotonicNow() - requestStartedMs;
                    updatePrintQueueStatus(
                        "⚠️ Drukarka odpowiada wolno (" +
                        formatPrintDuration(currentElapsed) +
                        ") — nie skanuj ponownie"
                    );
                }, 1000);
            }, PRINT_SOFT_WARNING_MS);

            const hardTimeoutTimer = setTimeout(function () {
                try {
                    if (requestControl && typeof requestControl.abort === "function") {
                        requestControl.abort();
                    }
                } catch (error) {
                    console.warn("[ZEBRA QUEUE] Nie udało się przerwać zawieszonego żądania", error);
                }
                finishError(
                    "Brak odpowiedzi Zebra Browser Print przez 90 sekund. Stan wydruku jest niepewny.",
                    "bridge_hard_timeout",
                    0,
                    task.kind === "print"
                );
            }, PRINT_HARD_TIMEOUT_MS);

            requestControl = GM_xmlhttpRequest({
                method: "POST",
                url: PRINT_BRIDGE_URL + "/write",
                timeout: PRINT_HARD_TIMEOUT_MS,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify({
                    device: getBrowserPrintDevicePayload(task.device),
                    data: task.zpl
                }),
                onload: function (response) {
                    if (response.status >= 200 && response.status < 300) {
                        finishSuccess(response);
                    } else {
                        finishError(
                            "Zebra Browser Print zwrócił HTTP " + response.status,
                            "bridge_http_error",
                            response.status,
                            task.kind === "print"
                        );
                    }
                },
                onerror: function () {
                    finishError(
                        "Utracono połączenie z Zebra Browser Print. Stan wydruku jest niepewny.",
                        "bridge_connection_error",
                        0,
                        task.kind === "print"
                    );
                },
                ontimeout: function () {
                    finishError(
                        "Zebra Browser Print przekroczył limit czasu. Stan wydruku jest niepewny.",
                        "bridge_timeout",
                        0,
                        task.kind === "print"
                    );
                }
            });
        });
    }

    function readBridgeResponse(timeoutMs, device) {
        return new Promise(function (resolve, reject) {
            GM_xmlhttpRequest({
                method: "POST",
                url: PRINT_BRIDGE_URL + "/read",
                timeout: timeoutMs,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify({
                    device: getBrowserPrintDevicePayload(device)
                }),
                onload: function (response) {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(String(response.responseText || ""));
                    } else {
                        reject(new Error("Odczyt statusu drukarki: HTTP " + response.status));
                    }
                },
                onerror: function () {
                    reject(new Error("Nie udało się odczytać odpowiedzi drukarki"));
                },
                ontimeout: function () {
                    reject(new Error("Timeout odczytu statusu drukarki"));
                }
            });
        });
    }

    function rejectQueuedPrintTasks(message) {
        while (printTransportQueue.length) {
            const queuedTask = printTransportQueue.shift();
            if (queuedTask.kind === "print") {
                const error = new Error(message);
                error.uncertain = true;
                queuedTask.reject(error);
            } else {
                queuedTask.resolve(null);
            }
        }
    }

    async function processPrintTransportQueue() {
        if (printWorkerRunning || printTransportBlocked) {
            updatePrintQueueStatus();
            return;
        }

        printWorkerRunning = true;
        try {
            while (printTransportQueue.length && !printTransportBlocked) {
                const task = printTransportQueue.shift();
                activePrintTask = task;
                updatePrintQueueStatus();

                try {
                    const timing = await sendBridgeWrite(task);

                    if (task.kind === "keepalive") {
                        try {
                            const statusText = await readBridgeResponse(4000, task.device);
                            console.info("[ZEBRA KEEPALIVE] Drukarka odpowiedziała", {
                                printer: getPrinterRoleLabel(task.printerRole),
                                reason: task.reason,
                                response: statusText.substring(0, 160)
                            });
                        } catch (error) {
                            console.warn("[ZEBRA KEEPALIVE] Nie odczytano statusu:", error);
                        }
                    }

                    task.resolve(timing);
                } catch (error) {
                    if (task.kind === "print" && error.uncertain) {
                        printTransportBlocked = true;
                        if (task.printerRole && printerDevices[task.printerRole] !== undefined) {
                            printerDevices[task.printerRole] = null;
                        }
                        rejectQueuedPrintTasks(
                            "Kolejka zatrzymana po niepewnym wydruku " + task.code
                        );
                    }
                    task.reject(error);
                } finally {
                    activePrintTask = null;
                    updatePrintQueueStatus();
                }
            }
        } finally {
            printWorkerRunning = false;
            updatePrintQueueStatus();
        }
    }

    function enqueuePrintTransportTask(task) {
        return new Promise(function (resolve, reject) {
            task.resolve = resolve;
            task.reject = reject;

            // Prawdziwa etykieta ma zawsze pierwszeństwo przed oczekującym
            // technicznym podtrzymaniem połączenia. Nie ruszamy kolejności
            // etykiet, dzięki czemu skany nadal drukują się FIFO.
            if (task.kind === "print") {
                for (let index = printTransportQueue.length - 1; index >= 0; index--) {
                    if (printTransportQueue[index].kind === "keepalive") {
                        const skippedKeepAlive = printTransportQueue.splice(index, 1)[0];
                        skippedKeepAlive.resolve(null);
                        console.info(
                            "[ZEBRA QUEUE] Pominięto oczekujące podtrzymanie na rzecz etykiety",
                            { printer: getPrinterRoleLabel(skippedKeepAlive.printerRole) }
                        );
                    }
                }
            }

            printTransportQueue.push(task);
            updatePrintQueueStatus();
            processPrintTransportQueue();
        });
    }

    function printLabel(title, code, labelKind, printerRole) {
        const normalizedKind = labelKind || "product";
        const normalizedPrinterRole = PRINTER_ROLES[printerRole] ? printerRole : "presort";
        const jobId = ++printJobSequence;
        const queuedMs = monotonicNow();
        const startedAt = new Date().toISOString();

        if (printTransportBlocked) {
            const blockedError = new Error(
                "Najpierw sprawdź poprzednią etykietę o niepewnym stanie i odblokuj kolejkę."
            );
            blockedError.uncertain = true;
            return Promise.reject(blockedError);
        }

        if (!isPrinterReady(normalizedPrinterRole)) {
            return Promise.reject(new Error(
                "Brak połączenia z drukarką " + PRINTER_ROLES[normalizedPrinterRole].model
            ));
        }

        let zpl;
        const zplStartedMs = monotonicNow();
        try {
            if (normalizedKind === "multi-return") {
                zpl = createMultiReturnZPL(code);
            } else if (normalizedKind === "rejected-return") {
                zpl = createRejectedReturnZPL(code, title);
            } else {
                zpl = createZPL(title, code);
            }
        } catch (error) {
            return Promise.reject(error);
        }

        const task = {
            id: jobId,
            kind: "print",
            code: String(code || ""),
            title: String(title || ""),
            labelKind: normalizedKind,
            printerRole: normalizedPrinterRole,
            device: getBrowserPrintDevicePayload(printerDevices[normalizedPrinterRole]),
            zpl: zpl,
            zplMs: monotonicNow() - zplStartedMs,
            queuedMs: queuedMs,
            startedAt: startedAt
        };

        console.info("[ZEBRA QUEUE #" + jobId + "] Dodano zadanie", {
            code: task.code,
            label_kind: task.labelKind,
            printer_role: task.printerRole,
            printer: task.device.name,
            queue_length: printTransportQueue.length + 1,
            zpl_ms: roundTiming(task.zplMs)
        });

        return enqueuePrintTransportTask(task);
    }

    function requestPrinterKeepAlive(printerRole, reason) {
        const normalizedPrinterRole = PRINTER_ROLES[printerRole] ? printerRole : "presort";
        if (
            !isPrinterReady(normalizedPrinterRole) ||
            printTransportBlocked ||
            printWorkerRunning ||
            activePrintTask ||
            printTransportQueue.length
        ) {
            return Promise.resolve(null);
        }

        const task = {
            id: "K" + (++printJobSequence),
            kind: "keepalive",
            code: "KEEPALIVE-" + PRINTER_ROLES[normalizedPrinterRole].model,
            labelKind: "keepalive",
            printerRole: normalizedPrinterRole,
            device: getBrowserPrintDevicePayload(printerDevices[normalizedPrinterRole]),
            zpl: "~HI",
            zplMs: 0,
            queuedMs: monotonicNow(),
            startedAt: new Date().toISOString(),
            reason: String(reason || "timer")
        };

        return enqueuePrintTransportTask(task).catch(function (error) {
            console.warn(
                "[ZEBRA KEEPALIVE] Test " + getPrinterRoleLabel(normalizedPrinterRole) +
                " nie powiódł się:",
                error
            );
            printerDevices[normalizedPrinterRole] = null;
            schedulePrinterReconnect(3000);
            return null;
        });
    }

    async function requestAllPrinterKeepAlives(reason, onlyStale) {
        if (keepAliveSweepRunning || printTransportBlocked) return;
        keepAliveSweepRunning = true;

        try {
            const roles = ["presort", "multi"];
            for (const role of roles) {
                if (!isPrinterReady(role)) continue;
                if (
                    onlyStale &&
                    lastPrinterActivityAt[role] &&
                    Date.now() - lastPrinterActivityAt[role] < PRINT_KEEPALIVE_INTERVAL_MS
                ) {
                    continue;
                }
                await requestPrinterKeepAlive(role, reason);
            }
        } finally {
            keepAliveSweepRunning = false;
        }
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

    function createMultiReturnZPL(returnId) {
        const safeReturnId = String(returnId || "").trim();
        if (!/^\d+$/.test(safeReturnId)) {
            throw new Error("Numer zwrotu na etykiecie musi zawierać wyłącznie cyfry");
        }

        return `
^XA
^CI28
^PW456
^LL256
^LH0,0
^FO15,10
^GB426,44,4^FS
^FO25,18
^A0N,28,28
^FB406,1,0,C,0
^FDWIELOSZTUKA^FS
^FO20,62
^BY3,2,90
^BCN,82,N,N,N
^FD${safeReturnId}^FS
^FO20,153
^A0N,50,50
^FB416,1,0,C,0
^FD${safeReturnId}^FS
^FO15,219
^GB426,30,3^FS
^FO20,224
^A0N,21,21
^FB416,1,0,C,0
^FDODLOZ DO WIELOSZTUK^FS
^XZ`;
    }

    function createRejectedReturnZPL(returnId, headerText) {
        const safeReturnId = String(returnId || "").trim();
        if (!/^\d+$/.test(safeReturnId)) {
            throw new Error("Numer zwrotu na etykiecie musi zawierać wyłącznie cyfry");
        }

        const safeHeader = String(headerText || "NIE PRZYJMOWAC")
            .replace(/[\^~\r\n]/g, " ")
            .replace(/[^A-Za-z0-9 ._-]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .substring(0, 30) || "NIE PRZYJMOWAC";

        return `
^XA
^PW456
^LL256
^LH0,0
^FO8,5
^GB440,30,3^FS
^FO14,10
^A0N,20,20
^FB428,1,0,C,0
^FD${safeHeader}^FS
^FO0,38
^A0N,38,38
^FB456,1,0,C,0
^FD${safeReturnId}^FS
^FO60,74
^BY3,2,55
^BCN,55,N,N,N
^FD${safeReturnId}^FS
^FO22,137
^GD412,111,22,B,R^FS
^FO22,137
^GD412,111,22,B,L^FS
^XZ`;
    }

    function splitMultiValue(value) {
        const text = String(value == null ? "" : value).replace(/\u00a0/g, " ");
        if (!text.trim()) return [];
        // Nie filtrujemy pustych elementów: pozycje SKU, tytułu i zdjęcia
        // muszą pozostać dokładnie wyrównane.
        return text.split("|").map(part => part.trim());
    }

    function resolveProductCode(rawSku) {
        const sku = String(rawSku || "").trim();
        if (!sku) throw new Error("Puste SKU");
        if (/[\^~\r\n]/.test(sku)) {
            throw new Error(`Niedozwolony znak w SKU: ${sku}`);
        }

        if (sku.toLowerCase().startsWith("stocksell_")) {
            const code = sku.replace(/^stocksell_/i, "").trim();
            if (!code) throw new Error(`Brak kodu po prefiksie stocksell_: ${sku}`);
            return code;
        }

        const product = productCache.get(sku.toLowerCase());
        if (!product || !product.code) {
            throw new Error(`Brak SKU w bazie produktów: ${sku}`);
        }
        return String(product.code).trim();
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function safeImageUrl(value) {
        const text = String(value || "").trim();
        if (!text) return "";
        try {
            const parsed = new URL(text, window.location.href);
            return parsed.protocol === "https:" || parsed.protocol === "http:"
                ? parsed.href
                : "";
        } catch (error) {
            return "";
        }
    }

    function waitMilliseconds(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
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
        if (!window.location.href.includes("orders_returns")) wrapper.style.display = "none";

        const toggleBtn = document.createElement("button");
        toggleBtn.innerHTML = "📦 Skaner Zwrotów";
        toggleBtn.style.cssText = "position:fixed;bottom:30px;left:30px;z-index:9999999;background:#3b82f6;color:white;border:none;padding:12px 24px;border-radius:50px;font-size:15px;font-weight:bold;cursor:pointer;box-shadow:0 4px 15px rgba(0,0,0,.4);outline:none;";

        const panel = document.createElement("div");
        panel.className = "stocksell-scanner-panel";
        panel.style.cssText = "display:none;position:fixed;top:3vh;left:2vw;z-index:9999998;width:96vw;height:94vh;box-sizing:border-box;background:var(--bg-panel);color:var(--text-main);border:2px solid #3b82f6;border-radius:12px;padding:24px 32px;box-shadow:0 10px 45px rgba(0,0,0,.6);";

        const contentRow = document.createElement("div");
        contentRow.style.cssText = "display:flex;gap:42px;align-items:stretch;height:100%;box-sizing:border-box;";

        const leftCol = document.createElement("div");
        leftCol.className = "stocksell-left-column";
        leftCol.style.cssText = "flex:0 0 40%;display:flex;flex-direction:column;min-width:0;height:100%;";

        const title = document.createElement("div");
        title.className = "stocksell-scanner-title";
        title.innerHTML = "<strong>📦 Skaner Zwrotów (Zebra)</strong>";
        title.style.cssText = "font-size:22px;color:var(--text-main);margin-bottom:14px;flex-shrink:0;";

        returnsStatusEl = document.createElement("div");
        returnsStatusEl.style.cssText = "font-size:15px;color:var(--text-muted);margin-bottom:4px;flex-shrink:0;";

        productsStatusEl = document.createElement("div");
        productsStatusEl.style.cssText = "font-size:15px;color:var(--text-muted);margin-bottom:8px;flex-shrink:0;";

        printerStatusEl = document.createElement("div");
        printerStatusEl.style.cssText = "font-size:15px;color:var(--text-muted);margin-bottom:4px;flex-shrink:0;";

        baseStatusEl = document.createElement("div");
        baseStatusEl.style.cssText = "font-size:15px;color:var(--text-muted);margin-bottom:10px;flex-shrink:0;";
        baseStatusEl.innerText = getWebhookSecret()
            ? "✅ Integracja Base gotowa"
            : "⚠️ Ustaw WEBHOOK_SECRET w menu Tampermonkey";

        scanCounterEl = document.createElement("div");
        scanCounterEl.style.cssText = "font-size:15px;color:var(--text-sub);margin-bottom:14px;padding-bottom:12px;border-bottom:1px dashed var(--border-color);flex-shrink:0;";
        updateScanCounterUI();

        const systemStatuses = document.createElement("div");
        systemStatuses.className = "stocksell-system-statuses";
        systemStatuses.style.cssText = "flex-shrink:0;";
        systemStatuses.append(
            returnsStatusEl,
            productsStatusEl,
            printerStatusEl,
            baseStatusEl,
            scanCounterEl
        );

        const modeBtn = document.createElement("button");
        modeBtn.className = "stocksell-mode-btn";
        modeBtn.innerHTML = "🟣 Obsłuż zwroty wielosztukowe";
        modeBtn.style.cssText = "width:100%;padding:12px;margin-bottom:12px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:800;cursor:pointer;flex-shrink:0;";

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Zeskanuj numer przesyłki...";
        input.className = "stocksell-input";
        input.autocomplete = "off";

        const scanControls = document.createElement("div");
        scanControls.className = "stocksell-scan-controls";
        scanControls.style.cssText = "flex-shrink:0;";
        scanControls.append(modeBtn, input);

        const reprintBtn = document.createElement("button");
        reprintBtn.innerHTML = "🖨️ Wydrukuj ostatni kod";
        reprintBtn.style.cssText = "margin-top:12px;width:100%;padding:13px;font-size:16px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:bold;box-shadow:0 4px 6px rgba(0,0,0,.1);flex-shrink:0;";

        const retryRegistrationBtn = document.createElement("button");
        retryRegistrationBtn.innerHTML = "🔄 Ponów zapis wielosztuki bez drukowania";
        retryRegistrationBtn.style.cssText = "display:none;margin-top:10px;width:100%;padding:13px;font-size:15px;background:#d97706;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:bold;flex-shrink:0;";

        const resultEl = document.createElement("div");
        resultEl.className = "stocksell-result";
        resultEl.style.cssText = "margin-top:18px;font-size:18px;font-weight:bold;min-height:30px;text-align:center;flex-shrink:0;";

        const multiWorkspace = document.createElement("div");
        multiWorkspace.className = "stocksell-multi-workspace";
        multiWorkspace.style.cssText = "display:none;flex:1;min-height:0;margin-top:14px;flex-direction:column;gap:10px;";

        const multiSummaryEl = document.createElement("div");
        multiSummaryEl.style.cssText = "font-size:20px;font-weight:800;color:#7c3aed;text-align:center;flex-shrink:0;";

        const multiProgressEl = document.createElement("div");
        multiProgressEl.style.cssText = "font-size:15px;color:var(--text-muted);text-align:center;flex-shrink:0;";

        const multiHeader = document.createElement("div");
        multiHeader.className = "stocksell-multi-header";
        multiHeader.append(multiSummaryEl, multiProgressEl);

        const multiGridScroll = document.createElement("div");
        multiGridScroll.className = "stocksell-scroll stocksell-multi-grid-scroll";
        multiGridScroll.style.cssText = "flex:1;min-height:0;overflow-y:auto;padding:4px 10px 10px 0;";

        const multiGrid = document.createElement("div");
        multiGrid.className = "stocksell-multi-grid";
        multiGridScroll.appendChild(multiGrid);

        const multiActions = document.createElement("div");
        multiActions.style.cssText = "display:none;gap:12px;flex-shrink:0;padding-top:8px;border-top:1px solid var(--border-color);";

        const retryPrintBtn = document.createElement("button");
        retryPrintBtn.className = "stocksell-action-btn";
        retryPrintBtn.innerHTML = "🔄 Ponów niewydrukowane";
        retryPrintBtn.style.cssText = "display:none;flex:1;padding:14px;background:#d97706;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:800;cursor:pointer;";

        const acceptBtn = document.createElement("button");
        acceptBtn.className = "stocksell-action-btn";
        acceptBtn.innerHTML = "✅ Przyjmij";
        acceptBtn.disabled = true;
        acceptBtn.style.cssText = "flex:1;padding:14px;background:#059669;color:#fff;border:none;border-radius:8px;font-size:18px;font-weight:900;cursor:pointer;";

        const verifyBtn = document.createElement("button");
        verifyBtn.className = "stocksell-action-btn";
        verifyBtn.innerHTML = "🔎 Do weryfikacji";
        verifyBtn.disabled = true;
        verifyBtn.style.cssText = "flex:1;padding:14px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:18px;font-weight:900;cursor:pointer;";

        multiActions.append(retryPrintBtn, acceptBtn, verifyBtn);
        multiWorkspace.append(multiHeader, multiGridScroll, multiActions);

        const inlineVerificationFooter = document.createElement("div");
        inlineVerificationFooter.className = "stocksell-inline-verification-footer";

        const returnVerification = document.createElement("div");
        returnVerification.className = "stocksell-return-verification";

        const returnVerificationTitle = document.createElement("div");
        returnVerificationTitle.className = "stocksell-return-verification-title";
        returnVerificationTitle.textContent = "Problem dotyczący całego zwrotu:";

        function createReturnVerificationOption(text) {
            const label = document.createElement("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.setAttribute("aria-label", text);
            const caption = document.createElement("span");
            caption.textContent = text;
            label.append(checkbox, caption);
            return { label: label, checkbox: checkbox };
        }

        const extraItemReturnOption = createReturnVerificationOption(
            "dodatkowa rzecz w paczce"
        );
        const wrongContentsReturnOption = createReturnVerificationOption(
            "błędna zawartość"
        );
        const customReturnOption = createReturnVerificationOption("Wpisz własne");

        const customReturnDescription = document.createElement("input");
        customReturnDescription.type = "text";
        customReturnDescription.className = "stocksell-return-verification-description";
        customReturnDescription.placeholder = "Wpisz problem dotyczący całego zwrotu...";
        customReturnDescription.maxLength = 250;
        customReturnDescription.disabled = true;

        returnVerification.append(
            returnVerificationTitle,
            extraItemReturnOption.label,
            wrongContentsReturnOption.label,
            customReturnOption.label,
            customReturnDescription
        );

        const verificationMessage = document.createElement("div");
        verificationMessage.style.cssText =
            "min-height:20px;font-size:14px;font-weight:800;color:#ef4444;flex-shrink:0;";

        [
            extraItemReturnOption.checkbox,
            wrongContentsReturnOption.checkbox,
            customReturnOption.checkbox
        ].forEach(function (checkbox) {
            checkbox.addEventListener("change", function () {
                verificationMessage.textContent = "";
            });
        });

        customReturnOption.checkbox.addEventListener("change", function () {
            const customSelected = customReturnOption.checkbox.checked;
            returnVerification.classList.toggle("has-custom", customSelected);
            customReturnDescription.disabled = !customSelected;
            customReturnDescription.style.borderColor = "";
            if (!customSelected) {
                customReturnDescription.value = "";
            } else {
                setTimeout(function () {
                    customReturnDescription.focus();
                }, 0);
            }
        });

        customReturnDescription.addEventListener("input", function () {
            if (customReturnDescription.value.trim()) {
                customReturnDescription.style.borderColor = "";
                verificationMessage.textContent = "";
            }
        });

        const verificationActions = document.createElement("div");
        verificationActions.className = "stocksell-verification-actions";

        const cancelVerificationBtn = document.createElement("button");
        cancelVerificationBtn.textContent = "Anuluj";
        cancelVerificationBtn.style.cssText =
            "flex:1;padding:12px;background:#4b5563;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:800;cursor:pointer;";

        const saveVerificationBtn = document.createElement("button");
        saveVerificationBtn.textContent = "🔎 Zapisz do weryfikacji";
        saveVerificationBtn.style.cssText =
            "flex:2;padding:12px;background:#d97706;color:#fff;border:none;border-radius:8px;font-size:17px;font-weight:900;cursor:pointer;";

        verificationActions.append(cancelVerificationBtn, saveVerificationBtn);
        inlineVerificationFooter.append(
            returnVerification,
            verificationMessage,
            verificationActions
        );
        multiWorkspace.appendChild(inlineVerificationFooter);

        leftCol.append(
            title,
            systemStatuses,
            scanControls,
            reprintBtn,
            retryRegistrationBtn,
            resultEl,
            multiWorkspace
        );

        const rightCol = document.createElement("div");
        rightCol.style.cssText = "flex:1;border-left:1px solid var(--border-color);padding-left:36px;display:flex;flex-direction:column;height:100%;min-width:0;";

        const rightHeader = document.createElement("div");
        rightHeader.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;padding-bottom:15px;border-bottom:1px solid var(--border-color);flex-shrink:0;";

        const historyTitle = document.createElement("div");
        historyTitle.innerHTML = "<strong>Historia skanów:</strong>";
        historyTitle.style.cssText = "font-size:18px;color:var(--text-sub);";

        const buttonsContainer = document.createElement("div");
        buttonsContainer.style.cssText = "display:flex;gap:12px;";

        const themeBtn = document.createElement("button");
        themeBtn.innerHTML = currentTheme === "dark" ? "☀️ Jasny" : "🌙 Ciemny";
        themeBtn.className = "stocksell-btn";
        themeBtn.onclick = function () {
            currentTheme = currentTheme === "dark" ? "light" : "dark";
            wrapper.setAttribute("data-theme", currentTheme);
            themeBtn.innerHTML = currentTheme === "dark" ? "☀️ Jasny" : "🌙 Ciemny";
            GM_setValue("stocksell_theme", currentTheme);
        };

        refreshBtn = document.createElement("button");
        refreshBtn.innerHTML = "🔄 Odśwież Bazy";
        refreshBtn.className = "stocksell-btn";
        refreshBtn.onclick = function () {
            preloadReturns(true);
            preloadProducts(true);
        };

        buttonsContainer.append(themeBtn, refreshBtn);
        rightHeader.append(historyTitle, buttonsContainer);

        historyContainer = document.createElement("div");
        historyContainer.className = "stocksell-scroll";
        historyContainer.style.cssText = "display:flex;flex-direction:column;flex:1;overflow-y:auto;padding-right:15px;";
        updateRecentScansUI();

        rightCol.append(rightHeader, historyContainer);
        contentRow.append(leftCol, rightCol);
        panel.append(contentRow);
        wrapper.append(panel, toggleBtn);
        document.body.appendChild(wrapper);

        let multiMode = false;
        let scanBusy = false;
        let decisionBusy = false;
        let activeMultiSession = null;
        let verificationEditorRows = [];
        let pendingMultiRegistration = null;
        let lastAlertType = null;
        let lastAlertColor = null;

        function getDynamicColor(type) {
            if (type === "rejected") {
                lastAlertColor = lastAlertType === "rejected" && lastAlertColor === "#f59e0b"
                    ? "#ef4444"
                    : "#f59e0b";
                lastAlertType = "rejected";
                return lastAlertColor;
            }
            lastAlertColor = lastAlertType === "error" && lastAlertColor === "#ef4444"
                ? "#f59e0b"
                : "#ef4444";
            lastAlertType = "error";
            return lastAlertColor;
        }

        function resetDynamicColor() {
            lastAlertType = null;
            lastAlertColor = null;
        }

        function showResult(message, color, extraHtml) {
            resultEl.style.color = "";
            resultEl.innerHTML =
                "<div style=\"color:" + color + ";\">" + escapeHtml(message) + "</div>" +
                (extraHtml || "");
        }

        function logInBackground(returnNr, tracking, status) {
            sendLogToSheet(returnNr, tracking, status).catch(function (error) {
                console.error("[RETURNS LOG] Nie zapisano logu:", error);
            });
        }

        function closeVerificationEditor(restoreMainActions = true) {
            multiGrid.classList.remove("is-verification-mode");
            inlineVerificationFooter.style.display = "none";
            verificationMessage.textContent = "";
            verificationEditorRows.forEach(function (entry) {
                Object.values(entry.checkboxes).forEach(function (checkbox) {
                    checkbox.checked = false;
                });
                entry.customInput.value = "";
                entry.customInput.disabled = true;
                entry.customInput.style.borderColor = "";
                entry.row.classList.remove("is-selected", "has-custom");
            });
            extraItemReturnOption.checkbox.checked = false;
            wrongContentsReturnOption.checkbox.checked = false;
            customReturnOption.checkbox.checked = false;
            customReturnDescription.value = "";
            customReturnDescription.disabled = true;
            customReturnDescription.style.borderColor = "";
            returnVerification.classList.remove("has-custom");
            verificationEditorRows = [];
            saveVerificationBtn.disabled = false;
            cancelVerificationBtn.disabled = false;

            if (
                restoreMainActions &&
                activeMultiSession &&
                activeMultiSession.allPrinted &&
                !decisionBusy
            ) {
                multiActions.style.display = "flex";
                multiSummaryEl.textContent =
                    "Zwrot " + activeMultiSession.returnId +
                    " — wszystkie etykiety przekazane do drukarki";
                multiSummaryEl.style.color = "#7c3aed";
                multiProgressEl.textContent =
                    activeMultiSession.items.length + " z " +
                    activeMultiSession.items.length + " etykiet gotowych";
            }
        }

        function openVerificationEditor(session) {
            if (!session || !session.allPrinted || decisionBusy) return;

            closeVerificationEditor(false);
            session.items.forEach(function (item) {
                const row = item.verificationEl;
                const checkboxes = item.verificationCheckboxes;
                const customInput = item.verificationDescription;
                if (!row || !checkboxes || !customInput) return;

                Object.values(checkboxes).forEach(function (checkbox) {
                    checkbox.checked = false;
                });
                customInput.value = "";
                customInput.disabled = true;
                row.classList.remove("is-selected", "has-custom");
                verificationEditorRows.push({
                    item: item,
                    row: row,
                    checkboxes: checkboxes,
                    customInput: customInput
                });
            });

            multiGrid.classList.add("is-verification-mode");
            multiActions.style.display = "none";
            inlineVerificationFooter.style.display = "flex";
            multiSummaryEl.textContent =
                "🔎 Zwrot " + session.returnId +
                " — wybierz problemy pod odpowiednimi zdjęciami";
            multiSummaryEl.style.color = "#f59e0b";
            multiProgressEl.textContent =
                "Możesz też zaznaczyć problem dotyczący całego zwrotu";
        }

        function collectVerificationIssues() {
            const issues = [];
            let firstInvalid = null;

            verificationEditorRows.forEach(function (entry) {
                const code = String(entry.item.cleanCode || "").trim();

                if (entry.checkboxes.missing.checked) {
                    issues.push({
                        code: code,
                        description: "brakująca rzecz w paczce"
                    });
                }

                if (entry.checkboxes.damaged.checked) {
                    issues.push({
                        code: code,
                        description: "uszkodzony produkt"
                    });
                }

                if (entry.checkboxes.custom.checked) {
                    const customDescription = String(entry.customInput.value || "")
                        .replace(/\s+/g, " ")
                        .trim();
                    entry.customInput.style.borderColor = customDescription
                        ? ""
                        : "#ef4444";
                    if (!customDescription && !firstInvalid) {
                        firstInvalid = entry.customInput;
                    }
                    if (customDescription) {
                        issues.push({
                            code: code,
                            description: customDescription
                        });
                    }
                }
            });

            if (firstInvalid) {
                firstInvalid.focus();
                throw new Error("Wpisz własny opis przy zaznaczonej opcji „Wpisz własne”.");
            }

            if (extraItemReturnOption.checkbox.checked) {
                issues.push({
                    code: "ZWROT",
                    description: "dodatkowa rzecz w paczce"
                });
            }

            if (wrongContentsReturnOption.checkbox.checked) {
                issues.push({
                    code: "ZWROT",
                    description: "błędna zawartość"
                });
            }

            if (customReturnOption.checkbox.checked) {
                const customReturnText = String(customReturnDescription.value || "")
                    .replace(/\s+/g, " ")
                    .trim();
                customReturnDescription.style.borderColor = customReturnText
                    ? ""
                    : "#ef4444";
                if (!customReturnText) {
                    customReturnDescription.focus();
                    throw new Error(
                        "Wpisz własny opis problemu dotyczącego całego zwrotu."
                    );
                }
                issues.push({
                    code: "ZWROT",
                    description: customReturnText
                });
            }

            if (!issues.length) {
                throw new Error(
                    "Wybierz przynajmniej jeden problem produktu lub całego zwrotu."
                );
            }

            const baseComments = issues.map(function (issue) {
                const safeDescription = String(issue.description || "")
                    .replace(/[|\r\n]+/g, " / ")
                    .replace(/\s+/g, " ")
                    .trim();
                return issue.code + "-" + safeDescription;
            }).join("|");

            if (baseComments.length > 200) {
                throw new Error(
                    "Opisy mają łącznie " + baseComments.length +
                    " znaków, a pole Uwagi w Base mieści maksymalnie 200. Skróć opisy."
                );
            }

            return issues;
        }

        function resetMultiWorkspace() {
            multiGrid.innerHTML = "";
            multiGrid.dataset.layout = "large";
            multiSummaryEl.textContent = "Zeskanuj numer zwrotu wielosztukowego";
            multiProgressEl.textContent = "";
            multiActions.style.display = "none";
            retryPrintBtn.style.display = "none";
            acceptBtn.disabled = true;
            verifyBtn.disabled = true;
            closeVerificationEditor(false);
        }

        function setMode(enableMulti) {
            if (scanBusy || decisionBusy || activeMultiSession) {
                showResult(
                    "Najpierw dokończ rozpoczętą obsługę wielosztuki.",
                    "#f59e0b"
                );
                return;
            }

            multiMode = Boolean(enableMulti);
            wrapper.classList.toggle("stocksell-multi-mode", multiMode);
            input.value = "";
            input.placeholder = multiMode
                ? "Zeskanuj numer zwrotu..."
                : "Zeskanuj numer przesyłki...";
            modeBtn.innerHTML = multiMode
                ? "↩ Wróć do skanowania przesyłek"
                : "🟣 Obsłuż zwroty wielosztukowe";
            modeBtn.style.background = multiMode ? "#4b5563" : "#7c3aed";
            rightCol.style.display = multiMode ? "none" : "flex";
            leftCol.style.flex = multiMode ? "1 1 100%" : "0 0 40%";
            contentRow.style.gap = multiMode ? "0" : "42px";
            reprintBtn.style.display = multiMode ? "none" : "block";
            retryRegistrationBtn.style.display =
                !multiMode && pendingMultiRegistration ? "block" : "none";
            resultEl.innerHTML = "";
            multiWorkspace.style.display = multiMode ? "flex" : "none";
            if (multiMode) resetMultiWorkspace();
            setTimeout(function () { input.focus(); }, 100);
        }

        function createSingleImageHtml(imageUrl) {
            const safeUrl = safeImageUrl(imageUrl);
            if (!safeUrl) return "";
            return "<div style=\"margin-top:20px;text-align:center;\">" +
                "<img src=\"" + escapeHtml(safeUrl) + "\" onerror=\"this.style.display='none'\" " +
                "style=\"max-height:280px;max-width:100%;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,.2);object-fit:contain;\">" +
                "</div>";
        }

        function parseMultiItems(retData) {
            const skus = splitMultiValue(retData.print_code || retData.sku);
            let titles = splitMultiValue(retData.title);
            let images = splitMultiValue(retData.image_url);

            if (!skus.length) throw new Error("Brak listy SKU dla tej wielosztuki");
            if (!titles.length) titles = new Array(skus.length).fill("");
            if (!images.length) images = new Array(skus.length).fill("");

            if (titles.length !== skus.length || images.length !== skus.length) {
                throw new Error(
                    "Niezgodna liczba danych: " +
                    skus.length + " SKU, " +
                    titles.length + " tytułów, " +
                    images.length + " zdjęć"
                );
            }

            return skus.map(function (sku, index) {
                if (!sku) {
                    throw new Error("Puste SKU na pozycji " + (index + 1));
                }
                const cleanCode = resolveProductCode(sku);
                return {
                    index: index,
                    sku: sku,
                    cleanCode: cleanCode,
                    title: titles[index] || ("Produkt " + (index + 1) + " – " + sku),
                    imageUrl: safeImageUrl(images[index]),
                    statusEl: null,
                    cardEl: null,
                    reprintBtn: null,
                    verificationEl: null,
                    verificationCheckboxes: null,
                    verificationDescription: null
                };
            });
        }

        function renderMultiItems(session) {
            multiGrid.innerHTML = "";
            multiGrid.dataset.layout = session.items.length <= 4
                ? "large"
                : (session.items.length <= 8 ? "compact" : "dense");

            session.items.forEach(function (item) {
                const card = document.createElement("div");
                card.className = "stocksell-multi-card";

                const cardTop = document.createElement("div");
                cardTop.className = "stocksell-multi-card-top";

                const number = document.createElement("div");
                number.textContent = "Produkt " + (item.index + 1) + "/" + session.items.length;
                number.style.cssText = "font-size:13px;line-height:1.15;font-weight:900;color:#7c3aed;";

                const status = document.createElement("div");
                status.textContent = "Oczekuje na druk";
                status.style.cssText = "font-size:11.5px;line-height:1.15;font-weight:800;color:var(--text-muted);text-align:right;";

                cardTop.append(number, status);

                const cardTitle = document.createElement("div");
                cardTitle.textContent = item.title;
                cardTitle.style.cssText =
                    "font-size:12px;font-weight:800;line-height:1.15;min-height:28px;overflow-wrap:anywhere;";

                const productCodeRow = document.createElement("div");
                productCodeRow.className = "stocksell-product-code-row";

                const productCode = document.createElement("div");
                productCode.className = "stocksell-product-code";
                productCode.textContent = "KOD: " + item.cleanCode;

                const cardReprintBtn = document.createElement("button");
                cardReprintBtn.type = "button";
                cardReprintBtn.className = "stocksell-card-reprint";
                cardReprintBtn.innerHTML = "🖨️";
                cardReprintBtn.title = "Wydrukuj ponownie kod " + item.cleanCode + " na ZD411";
                cardReprintBtn.setAttribute(
                    "aria-label",
                    "Wydrukuj ponownie kod produktu " + item.cleanCode
                );
                cardReprintBtn.disabled = true;
                cardReprintBtn.addEventListener("click", function () {
                    reprintMultiItem(item);
                });

                productCodeRow.append(productCode, cardReprintBtn);

                const imageWrap = document.createElement("div");
                imageWrap.className = "stocksell-multi-image";

                const placeholder = document.createElement("div");
                placeholder.textContent = "Brak zdjęcia";
                placeholder.style.cssText = "color:#6b7280;font-size:16px;font-weight:700;";

                if (item.imageUrl) {
                    const image = document.createElement("img");
                    image.alt = "Produkt " + (item.index + 1);
                    image.loading = "eager";
                    image.decoding = "async";
                    if (item.index < 4) image.fetchPriority = "high";
                    image.src = item.imageUrl;
                    image.onerror = function () {
                        image.remove();
                        imageWrap.appendChild(placeholder);
                    };
                    imageWrap.appendChild(image);
                } else {
                    imageWrap.appendChild(placeholder);
                }

                const verificationControl = document.createElement("div");
                verificationControl.className = "stocksell-card-verification";

                function createProductVerificationOption(text) {
                    const label = document.createElement("label");
                    label.className = "stocksell-verification-option";
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.setAttribute(
                        "aria-label",
                        text + " — produkt " + item.cleanCode
                    );
                    const caption = document.createElement("span");
                    caption.textContent = text;
                    label.append(checkbox, caption);
                    return { label: label, checkbox: checkbox };
                }

                const missingOption = createProductVerificationOption(
                    "brakująca rzecz w paczce"
                );
                const damagedOption = createProductVerificationOption(
                    "uszkodzony produkt"
                );
                const customOption = createProductVerificationOption("Wpisz własne");

                const verificationDescription = document.createElement("input");
                verificationDescription.type = "text";
                verificationDescription.className = "stocksell-verification-description";
                verificationDescription.placeholder = "Wpisz własny problem...";
                verificationDescription.maxLength = 250;
                verificationDescription.disabled = true;

                const verificationCheckboxes = {
                    missing: missingOption.checkbox,
                    damaged: damagedOption.checkbox,
                    custom: customOption.checkbox
                };

                function updateProductVerification() {
                    const anySelected = Object.values(verificationCheckboxes).some(
                        function (checkbox) { return checkbox.checked; }
                    );
                    const customSelected = verificationCheckboxes.custom.checked;
                    verificationControl.classList.toggle(
                        "is-selected",
                        anySelected
                    );
                    verificationControl.classList.toggle("has-custom", customSelected);
                    verificationDescription.disabled = !customSelected;
                    if (!customSelected) {
                        verificationDescription.value = "";
                        verificationDescription.style.borderColor = "";
                    }
                    verificationMessage.textContent = "";
                }

                Object.values(verificationCheckboxes).forEach(function (checkbox) {
                    checkbox.addEventListener("change", function () {
                        updateProductVerification();
                        if (checkbox === verificationCheckboxes.custom && checkbox.checked) {
                            verificationDescription.style.borderColor = "";
                            verificationDescription.disabled = false;
                            verificationControl.classList.add("has-custom");
                            verificationMessage.textContent = "";
                            setTimeout(function () {
                                verificationDescription.focus();
                            }, 0);
                        }
                    });
                });

                verificationDescription.addEventListener("input", function () {
                    if (verificationDescription.value.trim()) {
                        verificationDescription.style.borderColor = "";
                        verificationMessage.textContent = "";
                    }
                });

                verificationControl.append(
                    missingOption.label,
                    damagedOption.label,
                    customOption.label,
                    verificationDescription
                );

                card.append(
                    cardTop,
                    cardTitle,
                    productCodeRow,
                    imageWrap,
                    verificationControl
                );
                multiGrid.appendChild(card);
                item.statusEl = status;
                item.cardEl = card;
                item.reprintBtn = cardReprintBtn;
                item.verificationEl = verificationControl;
                item.verificationCheckboxes = verificationCheckboxes;
                item.verificationDescription = verificationDescription;
            });
        }

        async function reprintMultiItem(item) {
            if (!item || scanBusy || decisionBusy || !activeMultiSession) return;
            if (!isPrinterReady("multi")) {
                playErrorSound();
                item.statusEl.textContent = "❌ Brak ZD411";
                item.statusEl.style.color = "#ef4444";
                return;
            }

            scanBusy = true;
            item.reprintBtn.disabled = true;
            acceptBtn.disabled = true;
            verifyBtn.disabled = true;
            item.statusEl.textContent = "🖨️ Ponowny wydruk...";
            item.statusEl.style.color = "#3b82f6";
            item.cardEl.style.borderColor = "#3b82f6";

            try {
                await printLabel(item.title, item.cleanCode, "product", "multi");
                item.statusEl.textContent = "✅ Przekazano ponownie";
                item.statusEl.style.color = "#10b981";
                item.cardEl.style.borderColor = "#10b981";
                lastPrintedCode = item.cleanCode;
                lastPrintedTitle = item.title;
                lastPrintedImage = item.imageUrl;
                lastPrintedKind = "product";
                lastPrintedPrinterRole = "multi";
            } catch (error) {
                playErrorSound();
                item.statusEl.textContent = "❌ " + (error.message || String(error));
                item.statusEl.style.color = "#ef4444";
                item.cardEl.style.borderColor = "#ef4444";
            } finally {
                scanBusy = false;
                item.reprintBtn.disabled = false;
                if (activeMultiSession && activeMultiSession.allPrinted && !decisionBusy) {
                    acceptBtn.disabled = false;
                    verifyBtn.disabled = false;
                }
            }
        }

        async function registerPrintedMulti(retData) {
            const result = await sendMultiAction("multi_label_printed", retData);
            pendingMultiRegistration = null;
            retryRegistrationBtn.style.display = "none";
            resetDynamicColor();

            if (result.already_resolved) {
                showResult(
                    "Etykieta wydrukowana ponownie — zwrot " +
                    (retData.return_id || retData.return_nr) +
                    " był już zakończony jako: " + result.log_status,
                    "#f59e0b"
                );
                addScanToHistory(
                    retData.tracking,
                    String(retData.return_id || retData.return_nr),
                    "Ponowna etykieta zakończonej wielosztuki (" + result.log_status + ")",
                    "multi"
                );
                return result;
            }

            showResult(
                "ODŁÓŻ DO WIELOSZTUK — zwrot " + (retData.return_id || retData.return_nr),
                "#7c3aed"
            );
            addScanToHistory(
                retData.tracking,
                String(retData.return_id || retData.return_nr),
                "Wielosztuka – odłożono do drugiego etapu",
                "multi"
            );
            return result;
        }

        async function handleFirstStageMulti(retData) {
            const returnId = String(retData.return_id || retData.return_nr || "").trim();
            if (!/^\d+$/.test(returnId)) {
                throw new Error("Nieprawidłowy numer zwrotu dla wielosztuki");
            }
            if (!getWebhookSecret()) {
                throw new Error("Ustaw WEBHOOK_SECRET w menu Tampermonkey przed drukiem");
            }
            if (!isPrinterReady("presort")) {
                throw new Error("Brak połączenia z drukarką ZD420");
            }

            showResult("Przekazywanie etykiety wielosztuki " + returnId + "...", "#7c3aed");
            let timing;
            try {
                timing = await printLabel("WIELOSZTUKA", returnId, "multi-return", "presort");
            } catch (error) {
                addScanToHistory(
                    retData.tracking,
                    returnId,
                    "Błąd wydruku etykiety wielosztuki: " + error.message,
                    "error"
                );
                error.extraHtml = printTimingHtml(error.printTiming);
                throw error;
            }

            lastPrintedCode = returnId;
            lastPrintedTitle = "WIELOSZTUKA – zwrot " + returnId;
            lastPrintedImage = null;
            lastPrintedKind = "multi-return";
            lastPrintedPrinterRole = "presort";

            showResult(
                "Etykieta przekazana do drukarki. Zapisuję wielosztukę w logach...",
                "#7c3aed",
                printTimingHtml(timing)
            );

            try {
                await registerPrintedMulti(retData);
            } catch (error) {
                pendingMultiRegistration = retData;
                retryRegistrationBtn.style.display = "block";
                showResult(
                    "Etykieta została przekazana do drukarki, ale nie zapisano logu: " + error.message,
                    "#ef4444",
                    "<div style=\"margin-top:8px;color:var(--text-muted);font-size:14px;\">Użyj przycisku ponowienia — bez kolejnego wydruku.</div>"
                );
            }
        }

        async function handlePresortScan(trackingInput) {
            incrementScanCounter();
            const retData = returnsCache.get(trackingInput);

            if (!retData) {
                playErrorSound();
                showResult("Nie znaleziono przesyłki w bazie.", getDynamicColor("error"));
                addScanToHistory(trackingInput, "-", "Brak przesyłki w 'zgłoszone'", "error");
                logInBackground("-", trackingInput, "nie znaleziono");
                return;
            }

            const accepted = String(retData.accepted || "").trim().toLowerCase();
            if (accepted === "wielosztuka") {
                await handleFirstStageMulti(retData);
                return;
            }

            if (accepted !== "tak") {
                playErrorSound();
                const rejectedReturnId = String(
                    retData.return_id || retData.return_nr || ""
                ).trim();

                if (!/^\d+$/.test(rejectedReturnId)) {
                    showResult(
                        "Odrzucono, ale brak prawidłowego numeru zwrotu do wydruku.",
                        getDynamicColor("rejected")
                    );
                    addScanToHistory(
                        trackingInput,
                        "-",
                        "Odrzucono – brak numeru zwrotu do etykiety",
                        "error"
                    );
                    logInBackground(retData.return_nr, trackingInput, "nie");
                    return;
                }

                if (!isPrinterReady("presort")) {
                    showResult(
                        "Odrzucono zwrot " + rejectedReturnId +
                        ", ale brak połączenia z drukarką ZD420.",
                        getDynamicColor("rejected")
                    );
                    addScanToHistory(
                        trackingInput,
                        rejectedReturnId,
                        "Odrzucono – brak drukarki ZD420",
                        "error"
                    );
                    logInBackground(retData.return_nr, trackingInput, "nie");
                    return;
                }

                showResult(
                    "Odrzucono zwrot " + rejectedReturnId +
                    " — przekazywanie etykiety z X...",
                    getDynamicColor("rejected")
                );

                let rejectedTiming;
                try {
                    rejectedTiming = await printLabel(
                        "NIE PRZYJMOWAC",
                        rejectedReturnId,
                        "rejected-return",
                        "presort"
                    );
                } catch (error) {
                    showResult(
                        "Odrzucono zwrot " + rejectedReturnId +
                        ", ale nie wydrukowano etykiety: " + error.message,
                        getDynamicColor("error"),
                        printTimingHtml(error.printTiming)
                    );
                    addScanToHistory(
                        trackingInput,
                        rejectedReturnId,
                        "Odrzucono – błąd etykiety X: " + error.message,
                        "error"
                    );
                    logInBackground(retData.return_nr, trackingInput, "nie");
                    return;
                }

                lastPrintedCode = rejectedReturnId;
                lastPrintedTitle = "NIE PRZYJMOWAC";
                lastPrintedImage = null;
                lastPrintedKind = "rejected-return";
                lastPrintedPrinterRole = "presort";

                showResult(
                    "Zwrot " + rejectedReturnId + " odrzucony — wydrukowano etykietę z X",
                    getDynamicColor("rejected"),
                    printTimingHtml(rejectedTiming)
                );
                addScanToHistory(
                    trackingInput,
                    rejectedReturnId,
                    "Odrzucono – etykieta numeru zwrotu z X",
                    "error"
                );
                logInBackground(retData.return_nr, trackingInput, "nie");
                return;
            }

            if (!retData.print_code) {
                playErrorSound();
                showResult(
                    "Zwrot: " + retData.return_nr + " | Brak kodu w 'zgłoszone'",
                    getDynamicColor("error")
                );
                addScanToHistory(
                    trackingInput,
                    "-",
                    "Brak SKU w zgłoszone (" + retData.return_nr + ")",
                    "error"
                );
                logInBackground(retData.return_nr, trackingInput, "tak");
                return;
            }

            let cleanCode;
            try {
                cleanCode = resolveProductCode(retData.print_code);
            } catch (error) {
                playErrorSound();
                showResult(
                    "Zwrot: " + retData.return_nr + " | " + error.message,
                    getDynamicColor("error")
                );
                addScanToHistory(trackingInput, "-", error.message, "error");
                logInBackground(retData.return_nr, trackingInput, "tak");
                return;
            }

            const finalTitle = retData.title || ("Zwrot " + retData.return_nr);
            const finalImage = safeImageUrl(retData.image_url);

            if (!isPrinterReady("presort")) {
                playErrorSound();
                showResult("Brak połączenia z drukarką ZD420!", getDynamicColor("error"));
                addScanToHistory(trackingInput, cleanCode, "Brak drukarki ZD420", "error");
                logInBackground(retData.return_nr, trackingInput, "tak");
                return;
            }

            resetDynamicColor();
            const imageHtml = createSingleImageHtml(finalImage);
            showResult(
                "Przekazywanie do drukarki: " + cleanCode,
                "#10b981",
                "<div style=\"color:var(--text-main);font-size:22px;line-height:1.4;padding:8px 10px;\">" +
                    escapeHtml(finalTitle) +
                "</div>" + imageHtml
            );

            let timing;
            try {
                timing = await printLabel(finalTitle, cleanCode, "product", "presort");
            } catch (error) {
                playErrorSound();
                showResult(
                    error.message,
                    getDynamicColor("error"),
                    printTimingHtml(error.printTiming)
                );
                addScanToHistory(
                    trackingInput,
                    cleanCode,
                    "Błąd wydruku: " + error.message,
                    "error"
                );
                logInBackground(retData.return_nr, trackingInput, "tak");
                return;
            }

            lastPrintedCode = cleanCode;
            lastPrintedTitle = finalTitle;
            lastPrintedImage = finalImage;
            lastPrintedKind = "product";
            lastPrintedPrinterRole = "presort";

            showResult(
                "Przekazano do drukarki: " + cleanCode,
                "#10b981",
                "<div style=\"color:var(--text-main);font-size:22px;line-height:1.4;padding:8px 10px;\">" +
                    escapeHtml(finalTitle) +
                "</div>" + printTimingHtml(timing) + imageHtml
            );

            addScanToHistory(trackingInput, cleanCode, finalTitle, "success");
            logInBackground(retData.return_nr, trackingInput, "tak");

            if (enqueueStatusUpdate(retData, trackingInput, cleanCode)) {
                flushPendingStatusUpdates(true);
            } else if (baseStatusEl) {
                baseStatusEl.innerText = "❌ Nie ustalono numeru zwrotu do aktualizacji Base";
            }
        }

        async function continueMultiPrinting() {
            const session = activeMultiSession;
            if (!session) return;

            retryPrintBtn.style.display = "none";
            retryPrintBtn.disabled = true;
            acceptBtn.disabled = true;
            verifyBtn.disabled = true;
            multiActions.style.display = "flex";

            for (let index = session.nextPrintIndex; index < session.items.length; index++) {
                const item = session.items[index];
                item.statusEl.textContent = "🖨️ Przekazywanie...";
                item.statusEl.style.color = "#3b82f6";
                item.cardEl.style.borderColor = "#3b82f6";
                multiProgressEl.textContent =
                    "Przekazywanie etykiety " + (index + 1) + " z " + session.items.length;

                try {
                    await printLabel(item.title, item.cleanCode, "product", "multi");
                } catch (error) {
                    item.statusEl.textContent = "❌ " + error.message;
                    item.statusEl.style.color = "#ef4444";
                    item.cardEl.style.borderColor = "#ef4444";
                    retryPrintBtn.style.display = "block";
                    retryPrintBtn.disabled = false;
                    multiSummaryEl.textContent =
                        "Błąd etykiety " + (index + 1) + ". Ponów tylko niewydrukowane.";
                    multiSummaryEl.style.color = "#ef4444";
                    multiProgressEl.textContent =
                        session.nextPrintIndex + " z " + session.items.length + " etykiet gotowych";
                    playErrorSound();
                    return;
                }

                item.statusEl.textContent = "✅ Przekazano do drukarki";
                item.statusEl.style.color = "#10b981";
                item.cardEl.style.borderColor = "#10b981";
                session.nextPrintIndex = index + 1;
                if (item.reprintBtn) item.reprintBtn.disabled = false;
                lastPrintedCode = item.cleanCode;
                lastPrintedTitle = item.title;
                lastPrintedImage = item.imageUrl;
                lastPrintedKind = "product";
                lastPrintedPrinterRole = "multi";
                await waitMilliseconds(120);
            }

            session.allPrinted = true;
            multiSummaryEl.textContent =
                "Zwrot " + session.returnId + " — wszystkie etykiety przekazane do drukarki";
            multiSummaryEl.style.color = "#7c3aed";
            multiProgressEl.textContent =
                session.items.length + " z " + session.items.length + " etykiet gotowych";
            acceptBtn.disabled = false;
            verifyBtn.disabled = false;
            session.items.forEach(function (item) {
                if (item.reprintBtn) item.reprintBtn.disabled = false;
            });
        }

        async function handleMultiReturnScan(returnInput) {
            const workflowStartedMs = monotonicNow();
            const retData = returnsById.get(returnInput);
            if (!retData) {
                playErrorSound();
                throw new Error("Nie znaleziono numeru zwrotu w 'zgłoszone'");
            }

            if (String(retData.accepted || "").trim().toLowerCase() !== "wielosztuka") {
                playErrorSound();
                throw new Error("Ten zwrot nie jest oznaczony jako wielosztuka");
            }

            const items = parseMultiItems(retData);
            if (!isPrinterReady("multi")) {
                throw new Error("Brak połączenia z drukarką ZD411");
            }

            // Dane produktów są już w pamięci przeglądarki. Pokazujemy je od razu,
            // a kontrolę otwartego logu wykonujemy równolegle z ładowaniem zdjęć.
            const statePromise = sendMultiAction("multi_return_state", retData);
            const previewSession = {
                retData: retData,
                returnId: String(retData.return_id || retData.return_nr),
                items: items,
                nextPrintIndex: 0,
                allPrinted: false,
                rejectionLabelPrinted: false
            };
            resetMultiWorkspace();
            modeBtn.disabled = true;
            input.disabled = true;
            resultEl.innerHTML = "";
            multiSummaryEl.textContent =
                "Zwrot " + previewSession.returnId + " — wczytano " + items.length +
                " produktów, sprawdzam log...";
            multiSummaryEl.style.color = "#7c3aed";
            renderMultiItems(previewSession);

            let state;
            try {
                state = await statePromise;
                if (!state.open) {
                    if (state.log_status === "tak") {
                        throw new Error("Ten zwrot wielosztukowy został już przyjęty");
                    }
                    if (state.log_status === "nie") {
                        throw new Error("Ten zwrot został już przekazany do weryfikacji");
                    }
                    throw new Error(
                        "Brak otwartego logu 'wielosztuka'. Najpierw zeskanuj numer przesyłki i wydrukuj etykietę zwrotu."
                    );
                }
            } catch (error) {
                resetMultiWorkspace();
                throw error;
            }

            activeMultiSession = previewSession;
            console.info("[MULTI SECOND STAGE] Zwrot gotowy do druku", {
                return_id: previewSession.returnId,
                products: items.length,
                state_ms: roundTiming(monotonicNow() - workflowStartedMs)
            });
            multiSummaryEl.textContent =
                "Zwrot " + activeMultiSession.returnId + " — " + items.length + " produktów";
            await continueMultiPrinting();
        }

        async function resolveMultiDecision(decision, verificationIssues) {
            const session = activeMultiSession;
            if (!session || !session.allPrinted || decisionBusy) return;

            decisionBusy = true;
            acceptBtn.disabled = true;
            verifyBtn.disabled = true;
            retryPrintBtn.disabled = true;
            session.items.forEach(function (item) {
                if (item.reprintBtn) item.reprintBtn.disabled = true;
            });
            try {
                if (decision === "verify" && !session.rejectionLabelPrinted) {
                    if (!isPrinterReady("presort")) {
                        throw new Error(
                            "Brak połączenia z drukarką ZD420 — nie wydrukowano etykiety z X."
                        );
                    }

                    multiSummaryEl.textContent =
                        "Drukowanie etykiety odrzuconego zwrotu " + session.returnId + " z X...";
                    multiSummaryEl.style.color = "#f59e0b";

                    const rejectionTiming = await printLabel(
                        "WIELOSZTUKA - NIE PRZYJMOWAC",
                        session.returnId,
                        "rejected-return",
                        "presort"
                    );
                    session.rejectionLabelPrinted = true;
                    lastPrintedCode = session.returnId;
                    lastPrintedTitle = "WIELOSZTUKA - NIE PRZYJMOWAC";
                    lastPrintedImage = null;
                    lastPrintedKind = "rejected-return";
                    lastPrintedPrinterRole = "presort";
                    multiProgressEl.textContent =
                        "Etykieta z X przekazana do ZD420 w " +
                        formatPrintDuration(rejectionTiming.total_ms);
                }

                multiSummaryEl.textContent = decision === "accept"
                    ? "Przenoszenie zwrotu w Base i zapisywanie decyzji..."
                    : "Etykieta z X gotowa — zapisuję decyzję „Do weryfikacji”...";
                multiSummaryEl.style.color = "#3b82f6";

                const extraData = { decision: decision };
                if (decision === "verify") {
                    extraData.issues = Array.isArray(verificationIssues)
                        ? verificationIssues
                        : [];
                }
                const result = await sendMultiAction(
                    "multi_resolve",
                    session.retData,
                    extraData
                );
                const accepted = decision === "accept";

                returnsCache.delete(String(session.retData.tracking || "").toLowerCase());
                returnsById.delete(session.returnId);
                GM_setValue("stocksell_returns_time", "0");

                multiSummaryEl.textContent = accepted
                    ? "✅ Przyjęto zwrot " + session.returnId + " i przeniesiono go w Base"
                    : "🔎 Zwrot " + session.returnId + " przekazano do weryfikacji";
                multiSummaryEl.style.color = accepted ? "#10b981" : "#f59e0b";
                multiProgressEl.textContent = "Log zmieniony na: " + result.log_status;
                multiActions.style.display = "none";
                closeVerificationEditor(false);

                addScanToHistory(
                    session.retData.tracking,
                    session.returnId,
                    accepted ? "Wielosztuka przyjęta" : "Wielosztuka do weryfikacji",
                    accepted ? "success" : "multi"
                );

                if (accepted && baseStatusEl) {
                    baseStatusEl.innerText =
                        "✅ Zwrot " + session.returnId + " przeniesiony w Base";
                }

                activeMultiSession = null;
                modeBtn.disabled = false;
                input.disabled = false;
                input.value = "";
                setTimeout(function () { input.focus(); }, 100);
            } catch (error) {
                playErrorSound();
                multiSummaryEl.textContent = "❌ Nie zapisano decyzji: " + error.message;
                multiSummaryEl.style.color = "#ef4444";
                multiProgressEl.textContent = "Możesz bezpiecznie nacisnąć ten sam przycisk ponownie.";
                if (decision === "verify") {
                    verificationMessage.textContent =
                        "Nie zapisano weryfikacji: " + (error.message || String(error));
                }
                acceptBtn.disabled = false;
                verifyBtn.disabled = false;
                session.items.forEach(function (item) {
                    if (item.reprintBtn) item.reprintBtn.disabled = false;
                });
            } finally {
                decisionBusy = false;
            }
        }

        toggleBtn.onclick = function () {
            const isHidden = panel.style.display === "none";
            panel.style.display = isHidden ? "block" : "none";
            toggleBtn.innerHTML = isHidden ? "✖ Zamknij Zwroty" : "📦 Skaner Zwrotów";
            toggleBtn.style.background = isHidden ? "#ef4444" : "#3b82f6";
            if (isHidden) {
                updateScanCounterUI();
                setTimeout(function () { if (!input.disabled) input.focus(); }, 100);
            }
        };

        modeBtn.onclick = function () {
            setMode(!multiMode);
        };

        retryRegistrationBtn.onclick = async function () {
            if (!pendingMultiRegistration || scanBusy) return;
            scanBusy = true;
            retryRegistrationBtn.disabled = true;
            modeBtn.disabled = true;
            try {
                await registerPrintedMulti(pendingMultiRegistration);
            } catch (error) {
                showResult("Nadal nie zapisano logu: " + error.message, "#ef4444");
            } finally {
                scanBusy = false;
                retryRegistrationBtn.disabled = false;
                modeBtn.disabled = false;
                if (!pendingMultiRegistration) retryRegistrationBtn.style.display = "none";
                setTimeout(function () { input.focus(); }, 100);
            }
        };

        retryPrintBtn.onclick = async function () {
            if (!activeMultiSession || scanBusy || decisionBusy) return;
            scanBusy = true;
            retryPrintBtn.disabled = true;
            try {
                await continueMultiPrinting();
            } finally {
                scanBusy = false;
            }
        };

        acceptBtn.onclick = function () {
            resolveMultiDecision("accept");
        };

        verifyBtn.onclick = function () {
            openVerificationEditor(activeMultiSession);
        };

        cancelVerificationBtn.onclick = function () {
            if (!decisionBusy) closeVerificationEditor();
        };

        saveVerificationBtn.onclick = async function () {
            if (decisionBusy || !activeMultiSession) return;

            try {
                const issues = collectVerificationIssues();
                verificationMessage.textContent = "";
                saveVerificationBtn.disabled = true;
                cancelVerificationBtn.disabled = true;
                await resolveMultiDecision("verify", issues);
            } catch (error) {
                verificationMessage.textContent = error.message || String(error);
                playErrorSound();
            } finally {
                if (activeMultiSession) {
                    saveVerificationBtn.disabled = false;
                    cancelVerificationBtn.disabled = false;
                }
            }
        };

        reprintBtn.onclick = async function () {
            if (!lastPrintedCode || !lastPrintedTitle || scanBusy || activeMultiSession) {
                playErrorSound();
                showResult("Brak kodu do ponownego wydruku albo trwa inne zadanie.", getDynamicColor("error"));
                return;
            }
            if (!isPrinterReady(lastPrintedPrinterRole)) {
                playErrorSound();
                showResult(
                    "Brak połączenia z drukarką " +
                    PRINTER_ROLES[lastPrintedPrinterRole].model + "!",
                    getDynamicColor("error")
                );
                return;
            }

            scanBusy = true;
            input.disabled = true;
            modeBtn.disabled = true;
            showResult("Ponowne przekazywanie " + lastPrintedCode + "...", "#3b82f6");
            try {
                const timing = await printLabel(
                    lastPrintedTitle,
                    lastPrintedCode,
                    lastPrintedKind,
                    lastPrintedPrinterRole
                );
                showResult(
                    "Przekazano ponownie do drukarki: " + lastPrintedCode,
                    "#10b981",
                    "<div style=\"color:var(--text-main);font-size:20px;padding-top:8px;\">" +
                        escapeHtml(lastPrintedTitle) +
                    "</div>" +
                    printTimingHtml(timing) +
                    createSingleImageHtml(lastPrintedImage)
                );
            } catch (error) {
                playErrorSound();
                showResult(error.message, getDynamicColor("error"), printTimingHtml(error.printTiming));
            } finally {
                scanBusy = false;
                input.disabled = false;
                modeBtn.disabled = false;
                setTimeout(function () { input.focus(); }, 100);
            }
        };

        input.addEventListener("keydown", async function (event) {
            if (event.key !== "Enter") return;
            event.preventDefault();

            const scannedValue = input.value.trim().toLowerCase();
            input.value = "";
            if (!scannedValue) return;

            if (scanBusy || decisionBusy || activeMultiSession) {
                playErrorSound();
                showResult("Dokończ bieżące drukowanie lub wybierz decyzję.", "#f59e0b");
                return;
            }

            scanBusy = true;
            input.disabled = true;
            modeBtn.disabled = true;

            try {
                if (multiMode) {
                    await handleMultiReturnScan(scannedValue);
                } else {
                    await handlePresortScan(scannedValue);
                }
            } catch (error) {
                playErrorSound();
                showResult(
                    error.message || String(error),
                    getDynamicColor("error"),
                    error.extraHtml || ""
                );
            } finally {
                scanBusy = false;
                if (!activeMultiSession && !decisionBusy) {
                    input.disabled = false;
                    modeBtn.disabled = false;
                    setTimeout(function () { input.focus(); }, 100);
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
    GM_registerMenuCommand("Drukarka: sprawdź / wybudź teraz", () => {
        if (!areAllPrintersReady()) {
            initPrinter(true);
        }
        requestAllPrinterKeepAlives("menu");
    });
    GM_registerMenuCommand("Drukarka: odblokuj po sprawdzeniu etykiety", () => {
        const uncertain = getUncertainPrintState();
        if (!uncertain) {
            window.alert("Nie ma niepewnego wydruku do odblokowania.");
            return;
        }

        const confirmed = window.confirm(
            "Najpierw sprawdź fizycznie, czy wyszła etykieta " + uncertain.code + ".\n\n" +
            "OK odblokuje kolejkę. Jeśli etykiety nie ma, po odblokowaniu użyj świadomie ponownego wydruku."
        );
        if (confirmed) clearUncertainPrintState(true);
    });

    setInterval(checkUrlVisibility, 500);
    setInterval(() => flushPendingStatusUpdates(false), STATUS_RETRY_INTERVAL);
    setInterval(() => preloadReturns(true), RETURNS_AUTO_REFRESH_INTERVAL);
    setInterval(() => {
        requestAllPrinterKeepAlives("timer", true);
    }, 30000);

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


