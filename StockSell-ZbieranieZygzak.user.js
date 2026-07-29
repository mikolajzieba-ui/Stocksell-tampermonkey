// ==UserScript==
// @name         StockSell - Zbieranie Zygzak
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Sortuje produkty A0->B0... Wyszarzone na dół. Obsługuje regały X. Nie działa w Strefie DOK.
// @author       Twój Profil
// @match        *://*.stocksell.io/*
// @grant        none
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

    // 3. Funkcja analizująca lokalizację i sprawdzająca status
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

        // Jeśli to regał X, dajemy mu wartość 5.5, żeby wpadł między 5 i 6
        const number = (numberText === 'X') ? 5.5 : parseInt(numberText, 10);

        if (!rackMap[rack]) return [999, 999, 999];

        const group = rackMap[rack].group;
        const side = rackMap[rack].side;

        // Przeliczenie numeru na "logiczny rząd", aby zachować płynny zygzak po dodaniu rzędu X
        let logicalRow = number;
        if (number === 5.5) {
            logicalRow = 6;
        } else if (number >= 6) {
            logicalRow = number + 1;
        }

        const sideOrder = (logicalRow % 2 === 0) ? side : (1 - side);

        return [group, number, sideOrder];
    }

    // 4. Funkcja porównująca (Sortowanie)
    function compareKeys(key1, key2) {
        if (key1[0] !== key2[0]) return key1[0] - key2[0];
        if (key1[1] !== key2[1]) return key1[1] - key2[1];
        return key1[2] - key2[2];
    }

    // 5. Główny silnik sortujący
    function sortProducts() {
        const container = document.querySelector('.products');
        if (!container) return;

        const products = Array.from(container.querySelectorAll('.product'));
        if (products.length === 0) return;

        // --- BLOKADA DLA STREFY DOK ---
        if (isStrefaDok()) {
            // Jeśli to strefa DOK, przywracamy domyślny wygląd (na wypadek przejścia z innej strefy)
            container.style.display = '';
            container.style.flexDirection = '';
            products.forEach(p => p.style.order = '');
            return; // Kończymy działanie funkcji
        }
        // -------------------------------

        container.style.display = 'flex';
        container.style.flexDirection = 'column';

        const itemsWithKeys = products.map(product => {
            const storeEl = product.querySelector('.store-element');
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

    // 6. Nasłuchiwanie na zmiany (MutationObserver)
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

})();
