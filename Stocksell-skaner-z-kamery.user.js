// ==UserScript==
// @name         StockSell - Skaner (Wersja 4.0 - Barcode + OCR)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Hybryda: Skaner kodów kreskowych + OCR z kamery
// @match        https://*.stocksell.io/*
// @require      https://unpkg.com/tesseract.js@4.0.1/dist/tesseract.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function tryInjectUI() {
        const targetInput = document.getElementById('searchSkuCode');
        if (!targetInput || document.getElementById('btn-camera-ocr')) return;

        const cardContainer = targetInput.closest('mat-card');
        if (!cardContainer) return;

        const camBtn = document.createElement('button');
        camBtn.id = 'btn-camera-ocr';
        camBtn.innerText = '📷 Skanuj naklejkę';
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

        const videoWrapper = document.createElement('div');
        videoWrapper.style.cssText = 'position: relative; width: 100%; max-width: 320px; overflow: hidden; border-radius: 8px; border: 2px solid #ccc;';

        const video = document.createElement('video');
        video.style.cssText = 'width: 100%; display: block;';
        video.setAttribute('autoplay', '');
        video.setAttribute('playsinline', ''); 
        
        // Zwiększony celownik (40% wysokości), by pomieścił kod kreskowy i tekst
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: absolute; top: 30%; left: 10%; width: 80%; height: 40%; border: 2px solid #4CAF50; box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.6); box-sizing: border-box; z-index: 10; pointer-events: none;';

        videoWrapper.appendChild(video);
        videoWrapper.appendChild(overlay);
        
        const captureBtn = document.createElement('button');
        captureBtn.innerText = '📸 Zrób zdjęcie';
        captureBtn.style.cssText = 'margin-top: 10px; width: 100%; max-width: 320px; padding: 10px; background-color: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 16px;';
        captureBtn.style.display = 'none'; 

        const statusText = document.createElement('p');
        statusText.style.cssText = 'margin: 10px 0; font-weight: bold; color: #333;';
        statusText.innerText = 'Uruchamianie kamery...';

        container.appendChild(videoWrapper);
        container.appendChild(captureBtn);
        container.appendChild(statusText);

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', advanced: [{ focusMode: "continuous" }] } });
            video.srcObject = stream;
        } catch (err) {
            statusText.innerText = 'Błąd dostępu do kamery!';
            btnElement.disabled = false;
            return;
        }

        video.onplaying = () => {
            captureBtn.style.display = 'block';
            statusText.innerText = 'Obejmij ramką kod kreskowy i tekst.';
        };

        captureBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            captureBtn.disabled = true;
            statusText.innerText = 'Skanowanie...';
            
            const cropX = video.videoWidth * 0.10;
            const cropY = video.videoHeight * 0.30;
            const cropW = video.videoWidth * 0.80;
            const cropH = video.videoHeight * 0.40;

            const canvas = document.createElement('canvas');
            canvas.width = cropW;
            canvas.height = cropH;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            
            stream.getTracks().forEach(track => track.stop());
            videoWrapper.remove(); 
            captureBtn.remove();

            let foundResults = [];

            // 1. NATYWNE SKANOWANIE KODÓW KRESKOWYCH (Bez pudła)
            if ('BarcodeDetector' in window) {
                try {
                    const barcodeDetector = new BarcodeDetector();
                    const barcodes = await barcodeDetector.detect(canvas);
                    barcodes.forEach(bc => {
                        if (!foundResults.includes(bc.rawValue)) {
                            // Oznaczamy w interfejsie że to kod z kreski
                            foundResults.push({ text: bc.rawValue, type: 'barcode' }); 
                        }
                    });
                } catch (err) {
                    console.log('Barcode API error', err);
                }
            }

            statusText.innerText = 'Trwa czytanie tekstu (OCR)...';

            // 2. OCR TESSERACT (Jako wsparcie dla zwykłego tekstu np. P-S23010-T)
            try {
                const result = await Tesseract.recognize(canvas, 'eng');
                const words = result.data.words.filter(w => w.text.trim().length > 3);
                
                words.forEach(w => {
                    const cleanText = w.text.replace(/[^a-zA-Z0-9-]/g, '');
                    // Dodajemy tylko jeśli nie zduplikowano z kodem kreskowym
                    if (cleanText.length > 3 && !foundResults.some(r => r.text === cleanText)) {
                        foundResults.push({ text: cleanText, type: 'ocr' });
                    }
                });
                
                displayResults(foundResults, container, inputElement);
                statusText.innerText = 'Wybierz pozycję poniżej:';
            } catch (err) {
                statusText.innerText = 'Błąd przetwarzania obrazu.';
            }
            btnElement.disabled = false;
        });
    }

    function displayResults(resultsArray, container, inputElement) {
        const resultsDiv = document.createElement('div');
        resultsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 10px;';

        if (resultsArray.length === 0) {
            const noRes = document.createElement('span');
            noRes.innerText = 'Nic nie znaleziono. Spróbuj złapać ostrość.';
            resultsDiv.appendChild(noRes);
        }

        resultsArray.forEach(item => {
            const wordBtn = document.createElement('button');
            // Jeśli to kod kreskowy, dodajemy ikonkę gwiazdki, żebyś wiedział, że to na 100% poprawne
            wordBtn.innerText = item.type === 'barcode' ? `⭐ ${item.text}` : item.text;
            
            // Kolorujemy kody z kreski na złoto, a zwykły tekst (z błędami) na szaro
            const bgDefault = item.type === 'barcode' ? '#FFD700' : '#e0e0e0';
            const colorDefault = '#333';
            
            wordBtn.style.cssText = `background: ${bgDefault}; border: 1px solid #999; padding: 8px 12px; border-radius: 6px; cursor: pointer; color: ${colorDefault}; font-weight: bold; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);`;
            
            wordBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(item.text);
                inputElement.value = item.text;
                inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                inputElement.dispatchEvent(new Event('change', { bubbles: true }));
                
                wordBtn.style.background = '#4CAF50';
                wordBtn.style.color = 'white';
                setTimeout(() => {
                    wordBtn.style.background = bgDefault;
                    wordBtn.style.color = colorDefault;
                }, 1000);
            });
            
            resultsDiv.appendChild(wordBtn);
        });
        
        container.appendChild(resultsDiv);
    }

    const observer = new MutationObserver(() => tryInjectUI());
    observer.observe(document.body, { childList: true, subtree: true });

})();
