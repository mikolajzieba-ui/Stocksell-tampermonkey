// ==UserScript==
// @name         StockSell - Przelicznik Wielopaków (SPA Autodetect)
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Automatycznie pokazuje/ukrywa panel przelicznika przy zmianie podstron bez przeładowania strony.
// @author       Twój Asystent AI
// @match        https://stocksell.io/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let container = null;

    // Funkcja sprawdzająca, czy aktualny adres URL to sekcja produktów
    function isProductPage() {
        return window.location.href.includes('/products');
    }

    // Tworzenie i montowanie panelu w DOM
    function createPanel() {
        if (document.getElementById('tm-wielopak-container')) return; // Jeśli już istnieje, nie twórz ponownie

        container = document.createElement('div');
        container.id = 'tm-wielopak-container';
        container.style.position = 'fixed';
        container.style.bottom = '20px';
        container.style.right = '20px';
        container.style.zIndex = '9999';
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.width = '220px';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'flex-end';

        const contentDiv = document.createElement('div');
        contentDiv.id = 'tm-content';
        contentDiv.style.display = 'none';
        contentDiv.style.backgroundColor = '#ffffff';
        contentDiv.style.padding = '15px';
        contentDiv.style.border = '2px solid #0052cc';
        contentDiv.style.borderRadius = '8px';
        contentDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        contentDiv.style.marginBottom = '10px';
        contentDiv.style.width = '100%';
        contentDiv.style.boxSizing = 'border-box';

        contentDiv.innerHTML = `
            <div style="margin-bottom: 12px; font-weight: bold; color: #333; font-size: 14px; text-align: center;">Przelicznik Wielopaków</div>

            <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #555;">Ile mam (fizycznie):</label>
            <input type="number" id="tm-has-items" style="width: 100%; margin-bottom: 12px; padding: 6px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" value="1">

            <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #555;">Ile powinno być:</label>
            <input type="number" id="tm-total-items" style="width: 100%; margin-bottom: 15px; padding: 6px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" value="2">

            <button id="tm-calculate-btn" style="width: 100%; padding: 8px; background-color: #0052cc; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; transition: background-color 0.2s;">Przelicz i wpisz</button>
        `;

        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'tm-toggle-btn';
        toggleBtn.innerText = '🛠️ Przelicznik (Rozwiń)';
        toggleBtn.style.padding = '10px 15px';
        toggleBtn.style.backgroundColor = '#333';
        toggleBtn.style.color = '#fff';
        toggleBtn.style.border = 'none';
        toggleBtn.style.borderRadius = '8px';
        toggleBtn.style.cursor = 'pointer';
        toggleBtn.style.fontWeight = 'bold';
        toggleBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        toggleBtn.style.transition = 'background-color 0.2s';

        toggleBtn.onmouseover = () => { toggleBtn.style.backgroundColor = '#555'; };
        toggleBtn.onmouseout = () => { toggleBtn.style.backgroundColor = '#333'; };

        container.appendChild(contentDiv);
        container.appendChild(toggleBtn);
        document.body.appendChild(container);

        // Akcja rozwijania/zwijania
        toggleBtn.addEventListener('click', () => {
            if (contentDiv.style.display === 'none') {
                contentDiv.style.display = 'block';
                toggleBtn.innerText = '🛠️ Przelicznik (Zwiń)';
            } else {
                contentDiv.style.display = 'none';
                toggleBtn.innerText = '🛠️ Przelicznik (Rozwiń)';
            }
        });

        // Logika kalkulatora
        document.getElementById('tm-calculate-btn').addEventListener('click', () => {
            const hasItems = parseFloat(document.getElementById('tm-has-items').value);
            const totalItems = parseFloat(document.getElementById('tm-total-items').value);

            if (isNaN(totalItems) || isNaN(hasItems) || totalItems <= 0 || hasItems < 0) {
                alert('Proszę podać prawidłowe ilości (liczby dodatnie).');
                return;
            }

            const startingPriceInput = document.getElementById('startingPrice');
            const buyNowPriceInput = document.getElementById('buyNowPrice');

            if (!startingPriceInput || !buyNowPriceInput) {
                alert('Nie znaleziono pól "Cena startowa" i "Cena Kup Teraz". Upewnij się, że jesteś w formularzu edycji/dodawania produktu.');
                return;
            }

            let startingPriceStr = startingPriceInput.value.replace(',', '.');
            let startingPrice = parseFloat(startingPriceStr);

            if (isNaN(startingPrice) || startingPrice <= 0) {
                alert('Nie można pobrać prawidłowej kwoty z pola "Cena startowa". Wpisz cenę przed kliknięciem.');
                return;
            }

            // Obliczenia
            const pricePerItem = startingPrice / totalItems;
            const priceWithMarkup = pricePerItem * 1.10;
            const totalCalculated = priceWithMarkup * hasItems;
            const finalPrice = Math.floor(totalCalculated) + 0.99;
            const finalPriceFormatted = finalPrice.toFixed(2);

            // Wpisanie wartości do Angulara
            startingPriceInput.value = finalPriceFormatted;
            buyNowPriceInput.value = finalPriceFormatted;

            startingPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
            buyNowPriceInput.dispatchEvent(new Event('input', { bubbles: true }));

            const btn = document.getElementById('tm-calculate-btn');
            btn.innerText = 'Przeliczono!';
            btn.style.backgroundColor = '#138a0b';

            setTimeout(() => {
                btn.innerText = 'Przelicz i wpisz';
                btn.style.backgroundColor = '#0052cc';
            }, 1500);
        });
    }

    // Usuwanie panelu z ekranu
    function removePanel() {
        const existingContainer = document.getElementById('tm-wielopak-container');
        if (existingContainer) {
            existingContainer.remove();
        }
    }

    // Główna funkcja zarządzająca widocznością panelu
    function handleRoutingChange() {
        if (isProductPage()) {
            createPanel();
        } else {
            removePanel();
        }
    }

    // --- MONITOROWANIE ZMIAN URL BEZ PRZEŁADOWYWANIA STRONY (SPA) ---

    // 1. Wykrywanie zdarzeń przeglądarki (np. kliknięcie "Wstecz/Dalej")
    window.addEventListener('popstate', handleRoutingChange);

    // 2. Nadpisanie pushState oraz replaceState (bo Angular zmienia URL cicho przy użyciu routera)
    const originalPushState = history.pushState;
    history.pushState = function() {
        originalPushState.apply(this, arguments);
        handleRoutingChange();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function() {
        originalReplaceState.apply(this, arguments);
        handleRoutingChange();
    };

    // 3. Zapasowy "strażnik" (interwał), sprawdzający zmianę adresu co 1 sekundę
    // Gwarantuje, że skrypt zareaguje, nawet jeśli Angular obejdzie standardowe zdarzenia historii.
    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            handleRoutingChange();
        }
    }, 1000);

    // Pierwsze sprawdzenie przy pełnym załadowaniu strony
    handleRoutingChange();
})();
