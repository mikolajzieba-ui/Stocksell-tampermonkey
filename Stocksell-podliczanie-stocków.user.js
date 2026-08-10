// ==UserScript==
// @name         Stocker Counter StockSell
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Zlicza zestockowane produkty. Zoptymalizowany, lekki skrypt bez zacięć.
// @author       Twój Asystent AI
// @match        *://*.stocksell.io/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=stocksell.io
// @grant        none
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-podliczanie-stocków.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-podliczanie-stocków.user.js
// ==/UserScript==

(function() {
    'use strict';

    const TARGET_URL = '/store/stocker';
    const SUCCESS_TEXT = 'dodano produkt';

    let lastAddedTime = 0;
    let lastCheckedUrl = '';

    function getTodayString() {
        return new Date().toISOString().split('T')[0];
    }

    function initStorage() {
        const today = getTodayString();
        const savedDate = localStorage.getItem('stocker_last_date');

        if (savedDate !== today) {
            localStorage.setItem('stocker_last_date', today);
            localStorage.setItem('stocker_count', '0');
        }
    }

    function getCount() {
        return parseInt(localStorage.getItem('stocker_count') || '0', 10);
    }

    function incrementCount() {
        initStorage();
        let count = getCount() + 1;
        localStorage.setItem('stocker_count', count.toString());
        updateCounterUI();
    }

    // --- INTERFEJS UŻYTKOWNIKA ---

    function updateCounterUI() {
        if (!window.location.href.includes(TARGET_URL)) return;

        // Szukamy nagłówka h2 lub b wewnątrz karty, gdzie ma być licznik
        const targetContainer = document.querySelector('mat-card-content h2 b, mat-card-content h2');
        if (!targetContainer) return;

        let parentCard = targetContainer.closest('mat-card-content');
        if (!parentCard) return;

        let counterBox = document.getElementById('stocker-inline-counter');

        // Jeśli elementu jeszcze nie ma w DOM, tworzymy go raz
        if (!counterBox) {
            counterBox = document.createElement('div');
            counterBox.id = 'stocker-inline-counter';
            counterBox.style.margin = '8px 0 12px 0';
            counterBox.style.padding = '6px 12px';
            counterBox.style.backgroundColor = '#f44336';
            counterBox.style.color = 'white';
            counterBox.style.borderRadius = '6px';
            counterBox.style.fontSize = '13px';
            counterBox.style.fontWeight = 'bold';
            counterBox.style.display = 'inline-block';
            counterBox.style.boxShadow = '0 2px 4px rgba(0,0,0,0.15)';

            const h2Element = parentCard.querySelector('h2');
            if (h2Element) {
                parentCard.insertBefore(counterBox, h2Element);
            }
        }

        // Aktualizujemy tekst tylko wtedy, gdy się zmienił (oszczędność zasobów)
        const newText = 'Zestockowano dzisiaj: ' + getCount();
        if (counterBox.innerText !== newText) {
            counterBox.innerText = newText;
        }
    }

    // --- OBSERWATOR POWIADOMIEŃ (TYLKO DLA KOMUNIKATÓW) ---

    const popupObserver = new MutationObserver((mutations) => {
        if (!window.location.href.includes(TARGET_URL)) return;

        for (let mutation of mutations) {
            if (!mutation.addedNodes) continue;
            for (let node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const text = node.innerText || node.textContent || '';
                    if (text.toLowerCase().includes(SUCCESS_TEXT.toLowerCase())) {
                        const now = Date.now();
                        if (now - lastAddedTime > 1000) {
                            incrementCount();
                            lastAddedTime = now;
                        }
                    }
                }
            }
        }
    });

    // Nasłuchujemy tylko dodawania elementów w całym dokumencie, ale robimy to wydajnie
    popupObserver.observe(document.body, { childList: true, subtree: true });

    // --- LEKKI SPRAWDZACZ URL ORAZ WIDOKU (ZAMIAST CIĘŻKICH OBSERWATORÓW DOM) ---

    setInterval(() => {
        const currentUrl = location.href;
        if (currentUrl.includes(TARGET_URL)) {
            // Sprawdzamy UI tylko jeśli zmienił się URL lub licznik zniknął z widoku (np. przez odświeżenie widoku w Angularze)
            if (currentUrl !== lastCheckedUrl || !document.getElementById('stocker-inline-counter')) {
                lastCheckedUrl = currentUrl;
                updateCounterUI();
            }
        } else {
            lastCheckedUrl = currentUrl;
        }
    }, 500);

    // --- START ---
    initStorage();
    updateCounterUI();

})();
