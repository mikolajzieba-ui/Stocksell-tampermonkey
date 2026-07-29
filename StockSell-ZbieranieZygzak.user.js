// ==UserScript==
// @name         StockSell - Zygzak
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Sortuje zygzakiem. Regały 6-10 od tyłu (10->6). Obsługuje regały X. Nie działa w DOK. Koloruje litery (niebieski/zielony).
// @author       Twój Profil
// @match        *://*.stocksell.io/*
// @grant        none
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/StockSell-ZbieranieZygzak.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/StockSell-ZbieranieZygzak.user.js
// ==/UserScript==

(function() {
    'use strict';

    // 1. Zdefiniowanie par regałów
    const pairs = [
        ['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H'],
        ['J', 'K'], ['L', 'M'], ['O', 'P'], ['R', 'S'],
        ['T', 'U'], ['W', 'Z']
    ];

    const rackMap = {};
    pairs.forEach((pair, groupIndex) => {
        rackMap[pair[0]] = { group: groupIndex, side: 0 };
        rackMap[pair[1]] = { group: groupIndex, side: 1 };
    });

    // 2. Funkcja sprawdzająca czy jesteśmy w Strefie DOK
    function isStrefaDok() {
        const subtitle = document.querySelector('mat-card-subtitle');
        if (subtitle) {
            const text = subtitle.textContent.toUpperCase();
            if (text.includes('STREFA DOK')) {
                return true;
            }
        }
        return false;
    }

    // 3. NOWOŚĆ: Funkcja kolorująca pierwszą literę regału
    function colorizeElement(el) {
        // Zabezpieczenie przed ponownym kolorowaniem tego samego elementu (żeby nie tworzyć nieskończonych pętli)
        if (el.dataset.colorized) return;
        
        const text = el.textContent;
        const parts = text.split('/');
        
        const relevantPart = parts.length > 1 ? parts[parts.length - 1] : text;
        const prefix = parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
        
        // Szukamy spacji (jeśli są) oraz pierwszej dużej litery
        const match = relevantPart.match(/^(\s*)([A-Z])(.*)/);
        
        if (match) {
            const spaces = match[1];
            const rack = match[2];
            const restOfText = match[3];
            let color = '';
            
            // side 0 (A, C, E...) -> niebieski, side 1 (B, D, F...) -> zielony
            if (rackMap[rack]) {
                color = rackMap[rack].side === 0 ? '#2196F3' : '#4CAF50'; 
            }
            
            if (color) {
                // Wstawiamy samą literę w <span> z odpowiednim kolorem, reszta zostaje bez zmian
                el.innerHTML = prefix + spaces + `<span style="color: ${color}; font-weight: 900; font-size: 1.15em;">${rack}</span>` + restOfText;
            }
        }
        
        el.dataset.colorized = 'true';
    }

    // 4. Funkcja analizująca lokalizację i sprawdzająca status
    function getSortKey(locationString, element) {
        const isDone = element.classList.contains('product-missing') ||
                       element.classList.contains('product-picked') ||
                       element.classList.contains('completed');

        if (isDone) {
            return [9999, 9999, 9999]; // Wyrzucamy na sam dół listy
        }

        const parts = locationString.split('/');
        const relevantPart = parts.length > 1 ? parts[parts.length - 1].trim() : locationString.trim();

        // Szukamy regału (litery) i numeru LUB litery 'X'
        const match = relevantPart.match(/^([A-Z])(\d+|X)/);

        if (!match) return [999, 999, 999];

        const rack = match[1];
        const numberText = match[2];

        // Jeśli to regał X, w systemie traktujemy go jako numer 5.5
        const number = (numberText === 'X') ? 5.5 : parseInt(numberText, 10);

        if (!rackMap[rack]) return [999, 999, 999];

        const group = rackMap[rack].group;
        const side = rackMap[rack].side;

        // MATEMATYKA KROKÓW (STEPS): Mapujemy fizyczne numery regałów na kolejność odwiedzania
        let step = number;

        if (number === 5.5) {
            step = 6; // Regał X następuje zaraz po regale 5 (krok 6)
        } else if (number >= 6 && number <= 10) {
            // Odwracamy kolejność dla regałów 6-10.
            // 10 staje się krokiem 7, 9 to krok 8, ..., 6 to krok 11.
            step = 17 - number;
        } else if (number > 10) {
            // Od regału 11 idziemy znowu normalnie, przesuwając numerację o "oczko" z powodu regału X
            step = number + 1;
        }

        // Logika zygzaka oparta na "kroku" wyliczanym wyżej
        const sideOrder = (step % 2 === 0) ? side : (1 - side);

        // Zamiast zwracać fizyczny "number", zwracamy wyliczony "step", żeby wtyczka posortowała to tak jak idzie człowiek
        return [group, step, sideOrder];
    }

    // 5. Funkcja porównująca (Sortowanie)
    function compareKeys(key1, key2) {
        if (key1[0] !== key2[0]) return key1[0] - key2[0]; // Priorytet 1: Grupa (np. A/B)
        if (key1[1] !== key2[1]) return key1[1] - key2[1]; // Priorytet 2: Krok w głąb alejki (uwzględnia skok 10->6)
        return key1[2] - key2[2];                          // Priorytet 3: Strona (Lewa / Prawa)
    }

    // 6. Główny silnik sortujący
    function sortProducts() {
        const container = document.querySelector('.products');
        if (!container) return;

        const products = Array.from(container.querySelectorAll('.product'));
        if (products.length === 0) return;

        // --- BLOKADA DLA STREFY DOK ---
        if (isStrefaDok()) {
            container.style.display = '';
            container.style.flexDirection = '';
            products.forEach(p => p.style.order = '');
            return;
        }
        // -------------------------------

        container.style.display = 'flex';
        container.style.flexDirection = 'column';

        const itemsWithKeys = products.map(product => {
            const storeEl = product.querySelector('.store-element');
            
            // Odpalamy kolorowanie dla każdego z produktów
            if (storeEl) {
                colorizeElement(storeEl);
            }
            
            // 'textContent' czyta czysty tekst, więc nie przeszkadzają mu nasze dodane style (kolory)
            const locStr = storeEl ? storeEl.textContent.trim() : '';
            return {
                element: product,
                key: getSortKey(locStr, product)
            };
        });

        itemsWithKeys.sort((a, b) => compareKeys(a.key, b.key));

        itemsWithKeys.forEach((item, index) => {
            item.element.style.order = index + 1;
        });
    }

    // 7. Nasłuchiwanie na zmiany (MutationObserver)
    let sortTimeout;
    const observer = new MutationObserver((mutations) => {
        let shouldSort = false;
        for (let mutation of mutations) {
            if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0 || mutation.type === 'attributes') {
                shouldSort = true;
                break;
            }
        }
        if (shouldSort) {
            clearTimeout(sortTimeout);
            sortTimeout = setTimeout(sortProducts, 400);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    // 8. Siatka bezpieczeństwa (Fallback dla SPA)
    // Upewnia się, że wejście na widok przez menu bez przeładowania strony posortuje listę
    setInterval(() => {
        if (isStrefaDok()) return; 

        const products = document.querySelectorAll('.product');
        if (products.length === 0) return;

        // Szukamy czy jest jakiś produkt, który nie został jeszcze posortowany (nie ma stylu 'order')
        let needsSort = false;
        for(let p of products) {
            if(!p.style.order) {
                needsSort = true;
                break;
            }
        }

        if (needsSort) {
            sortProducts();
        }
    }, 1000);

})();
