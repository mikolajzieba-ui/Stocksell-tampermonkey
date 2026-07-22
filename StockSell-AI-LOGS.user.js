// ==UserScript==
// @name         StockSell AI -> Google Sheets (Faza przechwytywania + Dowolne Create)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Omija blokady Angulara, przechwytuje Zapisz, działa na każdym linku ze słowem "create".
// @match        https://stocksell.io/*
// @match        https://*.stocksell.io/*
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

(function() {
    'use strict';

    const GOOGLE_MACRO_URL = 'https://script.google.com/macros/s/AKfycbw9m-nG6Jw4tM6y78ZOWZughJxS0jY-tuJR4UhftrhzObzQZcuTCdEF2yrSdZoqiaDP/exec';

    const REQUIRED_FIELDS = [
        "Nazwa produktu", "Kolor", "Sezon", "Marka", "Rozmiar", 
        "Wzór dominujący", "Fason", "Dekolt", "Rękaw", "Długość", 
        "Zapięcie", "Materiał dominujący", "Cechy dodatkowe", "Linia", 
        "Odcień", "Kod taryfy celnej"
    ];

    let lastKnownUser = 'Nieznany użytkownik';

    document.body.addEventListener('click', function(event) {
        // SPRAWDZENIE URL - pobieramy cały link, zmniejszamy litery i szukamy "create"
        const currentUrl = window.location.href.toLowerCase();
        if (!currentUrl.includes('create')) {
            return; // Przerywa działanie, jeśli w linku nie ma słowa "create"
        }

        // 1. WYKRYCIE "URUCHOM AI"
        const aiButton = event.target.closest('.stocksell-plus_ai-button');
        if (aiButton) {
            console.log('[StockSell Script] Wykryto kliknięcie Uruchom AI...');
            setTimeout(() => extractAndSendData('ai_run'), 5500);
            return;
        }

        // 2. WYKRYCIE "ZAPISZ" i "ZAPISZ PRODUKT"
        const buttonElement = event.target.closest('button');
        if (buttonElement) {
            const btnText = buttonElement.innerText.trim().toLowerCase();
            if (btnText.includes('zapisz')) {
                // Wizualne potwierdzenie kliknięcia - zielona ramka
                buttonElement.style.border = "3px solid #4CAF50";
                
                console.log('[StockSell Script] Wykryto kliknięcie Zapisz...');
                extractAndSendData('save');
            }
        }
    }, true); // faza przechwytywania (true) zabezpiecza przed blokadami Angulara

    function extractAndSendData(actionType) {
        console.log(`[StockSell Script] Rozpoczynam pobieranie danych dla trybu: ${actionType}`);

        const userElement = document.querySelector('span[data-cy="username"] span.header');
        if (userElement && userElement.innerText.trim() !== '') {
            lastKnownUser = userElement.innerText.trim();
        }

        const allFields = document.querySelectorAll('mat-form-field');
        const rawData = {};

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

        const orderedData = {};
        REQUIRED_FIELDS.forEach(field => {
            orderedData[field] = rawData[field] !== undefined ? rawData[field] : "";
        });

        console.log(`[StockSell Script] Zebrane dane (${actionType}):`, { user: lastKnownUser, fields: orderedData });

        GM_xmlhttpRequest({
            method: "POST",
            url: GOOGLE_MACRO_URL,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({
                user: lastKnownUser,
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
