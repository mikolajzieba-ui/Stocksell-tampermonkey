// ==UserScript==
// @name         Stocker Counter StockSell
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Zlicza zestockowane produkty. Licznik osadzony na stronie, resetowany o północy.
// @author       Twój Asystent AI
// @match        *://*.stocksell.io/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=stocksell.io
// @grant        none
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-podliczanie-stocków.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-podliczanie-stocków.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- USTAWIENIA ---
    const TARGET_URL = '/store/stocker';
    const SUCCESS_TEXT = 'dodano produkt';

    let lastAddedTime = 0;

    // --- FUNKCJE POMOCNICZE ---

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

    // --- INTERFEJS UŻYTKOWNIKA (OSADZONY NA STRONIE) ---

    function updateCounterUI() {
        if (!window.location.href.includes(TARGET_URL)) return;

        // Szukamy elementu z komunikatem "Nie wybrano segmentu magazynu." lub kontenera formularza
        const targetContainer = document.querySelector('mat-card-content h2, mat-card-content h2 b');
        
        if (targetContainer) {
            let parentCard = targetContainer.closest('mat-card-content');
            if (parentCard) {
                let counterBox = document.getElementById('stocker-inline-counter');

                // Jeśli licznik jeszcze nie istnieje w DOM, tworzymy go i wstawiamy przed komunikatem h2
                if (!counterBox) {
                    counterBox = document.createElement('div');
                    counterBox.id = 'stocker-inline-counter';
                    // Stylizacja: mniejszy, zgrabny element wklejony w strukturę strony
                    counterBox.style.margin = '10px 0 15px 0';
                    counterBox.style.padding = '8px 12px';
                    counterBox.style.backgroundColor = '#f44336';
                    counterBox.style.color = 'white';
                    counterBox.style.borderRadius = '6px';
                    counterBox.style.fontSize = '14px';
                    counterBox.style.fontWeight = 'bold';
                    counterBox.style.display = 'inline-block';
                    counterBox.style.boxShadow = '0 2px 4px rgba(0,0,0,0.15)';

                    // Wstawiamy przed nagłówkiem h2 (czyli między polem Kod a napisem o segmencie)
                    const h2Element = parentCard.querySelector('h2');
                    if (h2Element) {
                        parentCard.insertBefore(counterBox, h2Element);
                    }
                }

                counterBox.innerText = 'Zestockowano dzisiaj: ' + getCount();
            }
        }
    }

    // --- OBSERWATORZY ---

    // 1. Nasłuchiwanie na komunikaty sukcesu
    const popupObserver = new MutationObserver((mutations) => {
        if (!window.location.href.includes(TARGET_URL)) return;

        for (let mutation of mutations) {
            if (mutation.addedNodes.length) {
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
        }
    });

    popupObserver.observe(document.body, { childList: true, subtree: true });

    // 2. Nasłuchiwanie zmian URL oraz renderowania widoku w SPA
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
        }
        // Wywołujemy regularnie, ponieważ Angular dynamicznie przebudowuje DOM przy klikaniu
        updateCounterUI();
    });

    urlObserver.observe(document, { subtree: true, childList: true });

    // --- START ---
    initStorage();
    // Interwał sprawdzający, żeby upewnić się, że licznik wskoczy poprawnie po załadowaniu widoku
    setInterval(updateCounterUI, 1000);

})();
