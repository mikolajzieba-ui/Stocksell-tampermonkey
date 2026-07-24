// ==UserScript==
// @name         StockSell AI -> Google Sheets (Dynamiczne Kategorie)
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Ignoruje zapis, jeśli AI nie było uruchamiane. Dynamicznie wyłapuje pola.
// @match        https://stocksell.io/*
// @match        https://*.stocksell.io/*
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @downloadURL  https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/StockSell-AI-LOGS.user.js
// @updateURL    https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/StockSell-AI-LOGS.user.js
// ==/UserScript==

(function() {
    'use strict';

    const GOOGLE_MACRO_URL = 'https://script.google.com/macros/s/AKfycbw9m-nG6Jw4tM6y78ZOWZughJxS0jY-tuJR4UhftrhzObzQZcuTCdEF2yrSdZoqiaDP/exec';

    let lastKnownUser = 'Nieznany użytkownik';
    let currentSessionId = null;
    let aiFilledLabels = []; // Dynamiczna pamięć dla pól uzupełnionych przez AI

    function generateSessionId() {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    }

    document.body.addEventListener('click', function(event) {
        const currentUrl = window.location.href.toLowerCase();
        if (!currentUrl.includes('create')) {
            return;
        }

        // 1. WYKRYCIE "URUCHOM AI"
        const aiButton = event.target.closest('.stocksell-plus_ai-button');
        if (aiButton) {
            console.log('[StockSell Script] Wykryto kliknięcie Uruchom AI. Czekam na zakończenie procesu...');

            currentSessionId = generateSessionId();
            aiFilledLabels = []; // Resetujemy listę pól dla nowego produktu

            // Obserwator czekający na odblokowanie przycisku
            const observer = new MutationObserver((mutations, obs) => {
                if (!aiButton.classList.contains('loading') && !aiButton.hasAttribute('disabled')) {
                    console.log('[StockSell Script] AI zakończyło pracę! Pobieram dane...');
                    obs.disconnect();

                    setTimeout(() => extractAndSendData('ai_run'), 300);
                }
            });

            observer.observe(aiButton, { attributes: true, attributeFilter: ['class', 'disabled'] });
            return;
        }

        // 2. WYKRYCIE "ZAPISZ"
        const buttonElement = event.target.closest('button');
        if (buttonElement) {
            const btnText = buttonElement.innerText.trim().toLowerCase();
            if (btnText.includes('zapisz')) {

                // ZABEZPIECZENIE: Jeśli nie ma ID sesji (AI nie było kliknięte), przerywamy!
                if (!currentSessionId) {
                    console.log('[StockSell Script] Kliknięto Zapisz, ale AI nie było używane. Ignoruję wysyłkę do Arkusza.');
                    return;
                }

                buttonElement.style.border = "3px solid #4CAF50";
                console.log('[StockSell Script] Wykryto kliknięcie Zapisz po użyciu AI...');

                extractAndSendData('save');

                // Czyszczenie pamięci po zapisie produktu (przygotowanie pod kolejny ręczny lub z AI)
                setTimeout(() => {
                    currentSessionId = null;
                    aiFilledLabels = [];
                }, 1000);
            }
        }
    }, true);

    function extractAndSendData(actionType) {
        console.log(`[StockSell Script] Rozpoczynam pobieranie danych dla trybu: ${actionType}`);

        const userElement = document.querySelector('span[data-cy="username"] span.header');
        if (userElement && userElement.innerText.trim() !== '') {
            lastKnownUser = userElement.innerText.trim();
        }

        const allFields = document.querySelectorAll('mat-form-field');
        const rawData = {};
        const detectedAiLabels = [];

        // Najpierw pobieramy wartości ze wszystkich pól na stronie
        allFields.forEach(field => {
            const labelElement = field.querySelector('label, mat-label, .mat-form-field-label');
            let label = labelElement ? labelElement.innerText : '';
            label = label.replace(/\*/g, '').trim();

            if (!label) return;

            // Sprawdzamy, czy to pole zostało obsłużone przez AI (klasa lub tag span)
            const isAiField = field.classList.contains('stocksell-plus_ai-filled') || field.querySelector('.stocksell-plus_ai-tag');
            if (isAiField) {
                detectedAiLabels.push(label);
            }

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
        });

        // Decydujemy, których etykiet użyć
        let labelsToProcess = [];
        if (actionType === 'ai_run') {
            aiFilledLabels = detectedAiLabels;
            labelsToProcess = aiFilledLabels;
        } else if (actionType === 'save') {
            labelsToProcess = aiFilledLabels.length > 0 ? aiFilledLabels : detectedAiLabels;
        }

        // Tworzymy ostateczny obiekt z zachowaniem restrykcyjnej kolejności
        const orderedData = {};
        labelsToProcess.forEach(label => {
            orderedData[label] = rawData[label] !== undefined ? rawData[label] : "";
        });

        console.log(`[StockSell Script] Zebrane dane (${actionType}):`, {
            user: lastKnownUser,
            fields: orderedData,
            sessionId: currentSessionId
        });

        GM_xmlhttpRequest({
            method: "POST",
            url: GOOGLE_MACRO_URL,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({
                user: lastKnownUser,
                type: actionType,
                fields: orderedData,
                sessionId: currentSessionId
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
