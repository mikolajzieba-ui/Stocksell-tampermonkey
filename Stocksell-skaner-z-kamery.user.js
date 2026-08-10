// ==UserScript==
// @name         StockSell - Skaner OCR z kamery (Wersja 3.0)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Dodaje skaner z kamery z ramką kadrowania i ręcznym robieniem zdjęcia
// @match        https://*.stocksell.io/*
// @require      https://unpkg.com/tesseract.js@4.0.1/dist/tesseract.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function tryInjectUI() {
        const targetInput = document.getElementById('searchSkuCode');
        if (!targetInput) return;

        const cardContainer = targetInput.closest('mat-card');
        if (!cardContainer) return;

        if (document.getElementById('btn-camera-ocr')) return;

        const camBtn = document.createElement('button');
        camBtn.id = 'btn-camera-ocr';
        camBtn.innerText = '📷 Szukaj kamerką';
        camBtn.style.cssText = 'margin-top: 15px; width: 100%; padding: 10px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
        
        const uiContainer = document.createElement('div');
        uiContainer.style.cssText = 'margin-top: 15px; text-align: center; display: flex; flex-direction: column; align-items: center; width: 100%;';
        
        cardContainer.appendChild(camBtn);
        cardContainer.appendChild(uiContainer);

        camBtn.addEventListener('click', (e) => {
            e.preventDefault();
            startCameraProcess(uiContainer, targetInput, camBtn);
        });
    }

    async function startCameraProcess(container, inputElement, btnElement) {
        container.innerHTML = ''; 
        btnElement.disabled = true;

        // Kontener na wideo i ramkę (celownik)
        const videoWrapper = document.createElement('div');
        videoWrapper.style.cssText = 'position: relative; width: 100%; max-width: 320px; overflow: hidden; border-radius: 8px; border: 2px solid #ccc;';

        const video = document.createElement('video');
        video.style.cssText = 'width: 100%; display: block;';
        video.setAttribute('autoplay', '');
        video.setAttribute('playsinline', ''); 
        
        // Zielony celownik na środku ekranu
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: absolute; top: 37.5%; left: 10%; width: 80%; height: 25%; border: 2px solid #4CAF50; box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.6); box-sizing: border-box; z-index: 10; pointer-events: none;';

        videoWrapper.appendChild(video);
        videoWrapper.appendChild(overlay);
        
        // Przycisk do robienia zdjęcia
        const captureBtn = document.createElement('button');
        captureBtn.innerText = '📸 Zrób zdjęcie';
        captureBtn.style.cssText = 'margin-top: 10px; width: 100%; max-width: 320px; padding: 10px; background-color: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 16px;';
        captureBtn.style.display = 'none'; // Ukryty, dopóki kamera się nie włączy

        const statusText = document.createElement('p');
        statusText.style.cssText = 'margin: 10px 0; font-weight: bold; color: #333;';
        statusText.innerText = 'Uruchamianie kamery...';

        container.appendChild(videoWrapper);
        container.appendChild(captureBtn);
        container.appendChild(statusText);

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            video.srcObject = stream;
        } catch (err) {
            statusText.innerText = 'Błąd dostępu do kamery!';
            btnElement.disabled = false;
            return;
        }

        // Gdy wideo zacznie się odtwarzać, pokazujemy przycisk
        video.onplaying = () => {
            captureBtn.style.display = 'block';
            statusText.innerText = 'Wyceluj w tekst i kliknij przycisk, aby zrobić zdjęcie.';
        };

        // Akcja po kliknięciu "Zrób zdjęcie"
        captureBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            captureBtn.disabled = true;
            statusText.innerText = 'Przetwarzanie obrazu...';
            
            // Obliczanie współrzędnych wycięcia
            const cropX = video.videoWidth * 0.10;
            const cropY = video.videoHeight * 0.375;
            const cropW = video.videoWidth * 0.80;
            const cropH = video.videoHeight * 0.25;

            const canvas = document.createElement('canvas');
            canvas.width = cropW;
            canvas.height = cropH;
            const ctx = canvas.getContext('2d');
            
            // Rysujemy na canvasie TYLKO to, co było w zielonej ramce
            ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            
            // Zatrzymujemy kamerę i sprzątamy UI
            stream.getTracks().forEach(track => track.stop());
            videoWrapper.remove(); 
            captureBtn.remove();

            // Uruchamiamy OCR
            try {
                const result = await Tesseract.recognize(canvas, 'eng');
                displayResults(result.data.words, container, inputElement);
                statusText.innerText = 'Wybierz tekst poniżej:';
            } catch (err) {
                statusText.innerText = 'Błąd rozpoznawania tekstu.';
            }
            btnElement.disabled = false;
        });
    }

    function displayResults(words, container, inputElement) {
        const resultsDiv = document.createElement('div');
        resultsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; margin-top: 10px;';

        const validWords = words.filter(w => w.text.trim().length > 3); 

        if (validWords.length === 0) {
            const noRes = document.createElement('span');
            noRes.innerText = 'Nie znaleziono czytelnego tekstu w ramce.';
            resultsDiv.appendChild(noRes);
        }

        validWords.forEach(word => {
            const cleanText = word.text.replace(/[^a-zA-Z0-9-]/g, '');
            
            if (cleanText.length > 3) {
                const wordBtn = document.createElement('button');
                wordBtn.innerText = cleanText;
                wordBtn.style.cssText = 'background: #e0e0e0; border: 1px solid #999; padding: 5px 10px; border-radius: 4px; cursor: pointer; color: #333; font-weight: bold;';
                
                wordBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(cleanText);
                    inputElement.value = cleanText;
                    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    wordBtn.style.background = '#4CAF50';
                    wordBtn.style.color = 'white';
                    setTimeout(() => {
                        wordBtn.style.background = '#e0e0e0';
                        wordBtn.style.color = '#333';
                    }, 1000);
                });
                
                resultsDiv.appendChild(wordBtn);
            }
        });
        container.appendChild(resultsDiv);
    }

    const observer = new MutationObserver(() => {
        tryInjectUI();
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
