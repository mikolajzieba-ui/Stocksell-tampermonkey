// ==UserScript==
// @name         StockSell AI -> Google Sheets (z Zapisz - stałe pola + sztywna kolejność)
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Pobiera konkretne pola i zawsze układa je w tej samej kolejności. Działa tylko na create-new i create-new-v2.
// @match        https://stocksell.io/products/create-new
// @match        https://stocksell.io/products/create-new-v2
// @match        https://*.stocksell.io/products/create-new
// @match        https://*.stocksell.io/products/create-new-v2
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @downloadURL  https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/StockSell-AI-LOGS.user.js
// @updateURL    https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/StockSell-AI-LOGS.user.js
// ==/UserScript==

(function() {
    'use strict';

    const GOOGLE_MACRO_URL = 'https://script.google.com/macros/s/AKfycbzI3DzwU4nReAnV8D1v7GkAnC5dxg5W67NNgbtJm0k780JbBmnoqhhSGphDbFuGAW8Q-w/exec';

    const REQUIRED_FIELDS = [
        "Nazwa produktu",
        "Kolor",
        "Sezon",
        "Marka",
        "Rozmiar",
        "Wzór dominujący",
        "Fason",
        "Dekolt",
        "Rękaw",
        "Długość",
        "Zapięcie",
        "Materiał dominujący",
        "Cechy dodatkowe",
        "Linia",
        "Odcień",
        "Kod taryfy celnej"
    ];

    document.body.addEventListener('click', function(event) {
        // Sprawdzenie URL w czasie rzeczywistym (zabezpieczenie dla aplikacji SPA)
        const currentPath = window.location.pathname;
        if (currentPath !== '/products/create-new' && currentPath !== '/products/create-new-v2') {
            return; // Przerwij działanie, jeśli jesteśmy na innej podstronie
        }

        const aiButton = event.target.closest('.stocksell-plus_ai-button');
        if (aiButton) {
            console.log('[StockSell Script] Wykryto kliknięcie Uruchom AI...');
            setTimeout(() => extractAndSendData('ai_run'), 5500);
            return;
        }

        const buttonElement = event.target.closest('button');
        if (buttonElement && buttonElement.innerText.toLowerCase().includes('zapisz')) {
            console.log('[StockSell Script] Wykryto kliknięcie Zapisz...');
            setTimeout(() => extractAndSendData('save'), 0);
        }
    });

    function extractAndSendData(actionType) {
        console.log(`[StockSell Script] Rozpoczynam pobieranie danych dla trybu: ${actionType}`);

        const userElement = document.querySelector('span[data-cy="username"] span.header');
        const user = userElement ? userElement.innerText.trim() : 'Nieznany użytkownik';

        const allFields = document.querySelectorAll('mat-form-field');
        const rawData = {}; // Tutaj zbieramy to co znajdziemy na stronie

        allFields.forEach(field => {
            const labelElement = field.querySelector('label, mat-label, .mat-form-field-label');
            let label = labelElement ? labelElement.innerText : '';
            label = label.replace(/\*/g, '').trim();

            if (!label) return;

            if (REQUIRED_FIELDS.includes(label)) {
                let value = '';
                const selectedChip = field.querySelector('mat-chip.mat-chip-selected');
                const selectValueElement = field.querySelector('.mat-select-value-text span');
                const inputElement = field.querySelector('input, textarea');

                if (selectedChip) {
                    value = selectedChip.innerText;
                } else if (selectValueElement) {
                    value = selectValueElement.innerText;
                } else if (inputElement) {
                    value = inputElement.value;
                }

                rawData[label] = value.trim();
            }
        });

        // WYMUSZENIE KOLEJNOŚCI: Tworzymy ostateczny obiekt dokładnie w kolejności z REQUIRED_FIELDS
        const orderedData = {};
        REQUIRED_FIELDS.forEach(field => {
            // Jeśli pole zostało znalezione - wpisz je. Jeśli nie - zostaw puste "".
            orderedData[field] = rawData[field] !== undefined ? rawData[field] : "";
        });

        console.log(`[StockSell Script] Zebrane dane (${actionType}):`, { user, fields: orderedData });

        GM_xmlhttpRequest({
            method: "POST",
            url: GOOGLE_MACRO_URL,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({
                user: user,
                type: actionType,
                fields: orderedData
            }),
            onload: function(response) {
                console.log(`[StockSell Script] Sukces (${actionType})! Dane zapisane.`, response.responseText);
            },
            onerror: function(error) {
                console.error(`[StockSell Script] Błąd podczas wysyłania do Arkusza (${actionType}):`, error);
            }
        });
    }

})();
