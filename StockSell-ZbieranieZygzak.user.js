// ==UserScript==
// @name         StockSell - Zygzak
// @namespace    http://tampermonkey.net/
// @version      1.10
// @description  Sortuje zygzakiem. Regały 6-10 od tyłu (10->6). Obsługuje regały X. Nie działa w DOK. Koloruje litery. Wymusza focus skanera na Konsolidacji.
// @author       Twój Profil
// @match        *://*.stocksell.io/*
// @grant        none
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/StockSell-ZbieranieZygzak.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/StockSell-ZbieranieZygzak.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // CZĘŚĆ 1: ZYGZAK I SORTOWANIE (PICKOWANIE)
    // ==========================================

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

    function colorizeElement(el) {
        if (el.dataset.colorized) return;
        
        const text = el.textContent;
        const parts = text.split('/');
        
        const relevantPart = parts.length > 1 ? parts[parts.length - 1] : text;
        const prefix = parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
        
        const match = relevantPart.match(/^(\s*)([A-Z])(.*)/);
        
        if (match) {
            const spaces = match[1];
            const rack = match[2];
            const restOfText = match[3];
            let color = '';
            
            // side 0 -> ciemny pomarańczowy, side 1 -> ciemny zielony
            if (rackMap[rack]) {
                color = rackMap[rack].side === 0 ? '#d84315' : '#1b5e20'; 
            }
            
            if (color) {
                el.innerHTML = prefix + spaces + `<span style="color: ${color}; font-weight: 900; font-size: 1.15em;">${rack}</span>` + restOfText;
            }
        }
        
        el.dataset.colorized = 'true';
    }

    function getSortKey(locationString, element) {
        const isDone = element.classList.contains('product-missing') ||
                       element.classList.contains('product-picked') ||
                       element.classList.contains('completed');

        if (isDone) {
            return [9999, 9999, 9999];
        }

        const parts = locationString.split('/');
        const relevantPart = parts.length > 1 ? parts[parts.length - 1].trim() : locationString.trim();

        const match = relevantPart.match(/^([A-Z])(\d+|X)/);

        if (!match) return [999, 999, 999];

        const rack = match[1];
        const numberText = match[2];

        const number = (numberText === 'X') ? 5.5 : parseInt(numberText, 10);

        if (!rackMap[rack]) return [999, 999, 999];

        const group = rackMap[rack].group;
        const side = rackMap[rack].side;

        let step = number;

        if (number === 5.5) {
            step = 6; 
        } else if (number >= 6 && number <= 10) {
            step = 17 - number;
        } else if (number > 10) {
            step = number + 1;
        }

        const sideOrder = (step % 2 === 0) ? side : (1 - side);
        return [group, step, sideOrder];
    }

    function compareKeys(key1, key2) {
        if (key1[0] !== key2[0]) return key1[0] - key2[0]; 
        if (key1[1] !== key2[1]) return key1[1] - key2[1]; 
        return key1[2] - key2[2];                          
    }

    function sortProducts() {
        const container = document.querySelector('.products');
        if (!container) return;

        const products = Array.from(container.querySelectorAll('.product'));
        if (products.length === 0) return;

        if (isStrefaDok()) {
            container.style.display = '';
            container.style.flexDirection = '';
            products.forEach(p => p.style.order = '');
            return;
        }

        container.style.display = 'flex';
        container.style.flexDirection = 'column';

        const itemsWithKeys = products.map(product => {
            const storeEl = product.querySelector('.store-element');
            
            if (storeEl) {
                colorizeElement(storeEl);
            }
            
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

    // ==========================================
    // CZĘŚĆ 2: AUTO-FOCUS SKANERA (KONSOLIDACJA)
    // ==========================================

    function isKonsolidacja() {
        return window.location.href.toLowerCase().includes('consolidation') || 
               (document.querySelector('mat-card-title') && document.querySelector('mat-card-title').textContent.toLowerCase().includes('konsolidacja'));
    }

    function getScanInput() {
        return document.querySelector('input[placeholder*="Kod"], input[type="text"]');
    }

    function forceFocus() {
        if (!isKonsolidacja()) return;
        const input = getScanInput();
        if (input && document.activeElement !== input) {
            input.focus();
        }
    }

    // Reakcja na zeskanowanie (Enter z Zebry)
    document.addEventListener('keydown', function(e) {
        if (isKonsolidacja() && e.key === 'Enter') {
            // Ponawiamy próby wymuszenia focusu, aby wstrzelić się po przeładowaniu danych przez serwer
            setTimeout(forceFocus, 100);
            setTimeout(forceFocus, 300);
            setTimeout(forceFocus, 600); 
            setTimeout(forceFocus, 1000); 
        }
    });

    // ==========================================
    // CZĘŚĆ 3: WSPÓLNE NASŁUCHIWANIE I FALLBACK
    // ==========================================

    let mainTimeout;
    const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        for (let mutation of mutations) {
            if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0 || mutation.type === 'attributes') {
                shouldUpdate = true;
                break;
            }
        }
        if (shouldUpdate) {
            clearTimeout(mainTimeout);
            mainTimeout = setTimeout(() => {
                sortProducts();
                if (isKonsolidacja()) forceFocus();
            }, 400);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    // Siatka bezpieczeństwa (Fallback dla przełączania zakładek w SPA bez odświeżania)
    setInterval(() => {
        // Wymuszenie focusu jeśli weszliśmy na Konsolidację
        if (isKonsolidacja()) {
            forceFocus();
        }

        // Sprawdzenie i wymuszenie sortowania w Pickowaniu
        if (isStrefaDok()) return; 

        const products = document.querySelectorAll('.product');
        if (products.length === 0) return;

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
