// ==UserScript==
// @name         StockSell - Skaner OCR z kamery
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Dodaje skaner z kamery do wyszukiwarki SKU/EAN
// @match        https://*.stocksell.io/*
// @require      https://unpkg.com/tesseract.js@4.0.1/dist/tesseract.min.js
// @grant        none
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-skaner-z-kamery.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-skaner-z-kamery.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Inicjalizacja skryptu - szukamy odpowiedniego miejsca na przycisk
    function tryInjectUI() {
        const targetInput = document.getElementById('searchSkuCode');
        if (!targetInput) return;

        const cardContainer = targetInput.closest('mat-card');
        if (!cardContainer) return;

        // Zapobiegamy dublowaniu przycisku
        if (document.getElementById('btn-camera-ocr')) return;

        // Tworzenie przycisku uruchamiającego kamerę
        const camBtn = document.createElement('button');
        camBtn.id = 'btn-camera-ocr';
        camBtn.innerText = '📷 Szukaj kamerką';
        camBtn.style.cssText = 'margin-top: 15px; width: 100%; padding: 10px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';

        // Kontener na interfejs kamery i wyniki
        const uiContainer = document.createElement('div');
        uiContainer.style.cssText = 'margin-top: 15px; text-align: center; display: flex; flex-direction: column; align-items: center;';

        cardContainer.appendChild(camBtn);
        cardContainer.appendChild(uiContainer);

        camBtn.addEventListener('click', (e) => {
            e.preventDefault();
            startCameraProcess(uiContainer, targetInput, camBtn);
        });
    }

    // Główna logika kamery i OCR
    async function startCameraProcess(container, inputElement, btnElement) {
        container.innerHTML = ''; // Czyszczenie kontenera
        btnElement.disabled = true;

        const video = document.createElement('video');
        video.style.cssText = 'width: 100%; max-width: 300px; border-radius: 8px; border: 2px solid #ccc;';
        video.setAttribute('autoplay', '');
        video.setAttribute('playsinline', ''); // Ważne dla iOS

        const statusText = document.createElement('p');
        statusText.style.cssText = 'margin: 10px 0; font-weight: bold; color: #333;';
        statusText.innerText = 'Uruchamianie kamery...';

        container.appendChild(video);
        container.appendChild(statusText);

        let stream;
        try {
            // Wymuszenie tylnej kamery w telefonach
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            video.srcObject = stream;
        } catch (err) {
            statusText.innerText = 'Błąd dostępu do kamery!';
            btnElement.disabled = false;
            return;
        }

        // Odliczanie 2 sekund po załadowaniu wideo
        video.onplaying = () => {
            let timeLeft = 2;
            statusText.innerText = `Robienie zdjęcia za: ${timeLeft}s`;

            const timer = setInterval(async () => {
                timeLeft -= 1;
                if (timeLeft > 0) {
                    statusText.innerText = `Robienie zdjęcia za: ${timeLeft}s`;
                } else {
                    clearInterval(timer);
                    statusText.innerText = 'Przetwarzanie obrazu (OCR)...';

                    // Zrobienie zdjęcia na wirtualne płótno (canvas)
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                    // Zatrzymanie kamery
                    stream.getTracks().forEach(track => track.stop());
                    video.remove();

                    // Wykonanie OCR
                    try {
                        const result = await Tesseract.recognize(canvas, 'eng+pol');
                        displayResults(result.data.words, container, inputElement);
                        statusText.innerText = 'Wybierz tekst poniżej:';
                    } catch (err) {
                        statusText.innerText = 'Błąd rozpoznawania tekstu.';
                    }
                    btnElement.disabled = false;
                }
            }, 1000);
        };
    }

    // Wyświetlanie wyników jako klikalne przyciski
    function displayResults(words, container, inputElement) {
        const resultsDiv = document.createElement('div');
        resultsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; margin-top: 10px;';

        // Filtrowanie krótkich lub pustych śmieciowych wyników
        const validWords = words.filter(w => w.text.trim().length > 2);

        if (validWords.length === 0) {
            const noRes = document.createElement('span');
            noRes.innerText = 'Nie znaleziono czytelnego tekstu.';
            resultsDiv.appendChild(noRes);
        }

        validWords.forEach(word => {
            const wordBtn = document.createElement('button');
            wordBtn.innerText = word.text;
            wordBtn.style.cssText = 'background: #e0e0e0; border: 1px solid #999; padding: 5px 10px; border-radius: 4px; cursor: pointer; color: #333;';

            wordBtn.addEventListener('click', () => {
                // Skopiowanie do schowka
                navigator.clipboard.writeText(word.text);

                // Wklejenie do inputa Angularowego
                inputElement.value = word.text;
                // Wyzwolenie eventów, by Angular zaktualizował stan formularza
                inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                inputElement.dispatchEvent(new Event('change', { bubbles: true }));

                // Wizualne potwierdzenie
                wordBtn.style.background = '#4CAF50';
                wordBtn.style.color = 'white';
                setTimeout(() => {
                    wordBtn.style.background = '#e0e0e0';
                    wordBtn.style.color = '#333';
                }, 1000);
            });

            resultsDiv.appendChild(wordBtn);
        });

        container.appendChild(resultsDiv);
    }

    // Obserwator zmian na stronie (dla aplikacji typu SPA / Angular)
    const observer = new MutationObserver(() => {
        tryInjectUI();
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
