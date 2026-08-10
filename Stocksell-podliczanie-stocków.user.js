// ==UserScript==
// @name         Stocker Counter StockSell
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Zlicza zestockowane produkty na podstawie komunikatów o dodaniu. Zapisuje wynik i resetuje o północy.
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
    // Tekst, którego wtyczka ma szukać w wyskakujących powiadomieniach.
    const SUCCESS_TEXT = 'dodano produkt';

    let counterElement = null;
    let lastAddedTime = 0;

    // --- FUNKCJE POMOCNICZE ---

    // Pobiera dzisiejszą datę w formacie YYYY-MM-DD
    function getTodayString() {
        return new Date().toISOString().split('T')[0];
    }

    // Inicjalizuje pamięć (resetuje licznik, jeśli mamy nowy dzień)
    function initStorage() {
        const today = getTodayString();
        const savedDate = localStorage.getItem('stocker_last_date');

        if (savedDate !== today) {
            localStorage.setItem('stocker_last_date', today);
            localStorage.setItem('stocker_count', '0');
        }
    }

    // Pobiera aktualny wynik
    function getCount() {
        return parseInt(localStorage.getItem('stocker_count') || '0', 10);
    }

    // Zwiększa wynik i zapisuje w pamięci urządzenia (przetrwa restart telefonu)
    function incrementCount() {
        initStorage(); // Upewniamy się, że nie wybiła północ między skanowaniami
        let count = getCount() + 1;
        localStorage.setItem('stocker_count', count.toString());
        updateCounterUI();
    }

    // --- INTERFEJS UŻYTKOWNIKA (LICZNIK NA EKRANIE) ---

    function updateCounterUI() {
        // Sprawdza, czy pracownik jest na odpowiedniej zakładce
        if (!window.location.href.includes(TARGET_URL)) {
            if (counterElement) counterElement.style.display = 'none';
            return;
        }

        // Tworzy kółko/okienko z wynikiem, jeśli jeszcze nie istnieje
        if (!counterElement) {
            counterElement = document.createElement('div');
            counterElement.style.position = 'fixed';
            counterElement.style.bottom = '80px'; // Trochę wyżej, żeby nie zasłaniać przycisków systemowych na Zebrze
            counterElement.style.right = '20px';
            counterElement.style.backgroundColor = '#d32f2f'; // Czerwony kolor pasujący do motywu
            counterElement.style.color = 'white';
            counterElement.style.padding = '10px 20px';
            counterElement.style.borderRadius = '20px';
            counterElement.style.fontSize = '20px';
            counterElement.style.fontWeight = 'bold';
            counterElement.style.zIndex = '999999';
            counterElement.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
            counterElement.style.pointerEvents = 'none'; // Żeby nie blokowało klikania pod spodem
            document.body.appendChild(counterElement);
        }

        counterElement.style.display = 'block';
        counterElement.innerText = 'Zestockowano: ' + getCount();
    }

    // --- OBSERWATORZY (NASŁUCHIWANIE AKCJI) ---

    // 1. Nasłuchiwanie na pojawiające się komunikaty (Angular Snackbars/Toasts)
    const popupObserver = new MutationObserver((mutations) => {
        if (!window.location.href.includes(TARGET_URL)) return;

        for (let mutation of mutations) {
            if (mutation.addedNodes.length) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const text = node.innerText || node.textContent || '';
                        // Jeśli znaleziono tekst sukcesu
                        if (text.toLowerCase().includes(SUCCESS_TEXT.toLowerCase())) {
                            const now = Date.now();
                            // Zabezpieczenie (cooldown 1 sekunda) przed podwójnym zliczeniem
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

    // Uruchamiamy obserwatora powiadomień na całe 'body'
    popupObserver.observe(document.body, { childList: true, subtree: true });

    // 2. Nasłuchiwanie na zmianę zakładek w SPA (bez przeładowania strony)
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        updateCounterUI(); // Pokaż/Ukryj licznik w zależności od linku
      }
    });

    // Uruchamiamy obserwatora zmian URL
    urlObserver.observe(document, { subtree: true, childList: true });

    // --- START ---
    initStorage();
    updateCounterUI();

})();
