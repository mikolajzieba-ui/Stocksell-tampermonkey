// ==UserScript==
// @name         StockSell - Skaner OCR (Wersja 5.0 PRO)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Wysokowydajny skaner długich ciągów alfanumerycznych
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
        camBtn.innerText = '📷 Skanuj tekst (OCR)';
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
        
        // BARDZO WĄSKA RAMKA - idealna tylko na jeden rząd tekstu
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: absolute; top: 42.5%; left: 10%; width: 80%; height: 15%; border: 2px solid #FFEB3B; box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.7); box-sizing: border-box; z-index: 10; pointer-events: none;';

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
            statusText.innerText = 'Wyceluj zółtą ramkę TYLKO w tekst.';
        };

        captureBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            captureBtn.disabled = true;
            statusText.innerText = 'Analiza tekstu (to może chwilę potrwać)...';
            
            const cropX = video.videoWidth * 0.10;
            const cropY = video.videoHeight * 0.425;
            const cropW = video.videoWidth * 0.80;
            const cropH = video.videoHeight * 0.15;

            // Tworzymy canvas 2x większy, aby powiększyć tekst dla lepszego odczytu
            const scale = 2; 
            const canvas = document.createElement('canvas');
            canvas.width = cropW * scale;
            canvas.height = cropH * scale;
            const ctx = canvas.getContext('2d');
            
            // Poprawiamy wygładzanie obrazu
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            // Rysujemy powiększony wycinek
            ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
            
            // Konwersja obrazu na czarno-biały (lepszy kontrast)
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < imgData.data.length; i += 4) {
                let brightness = (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
                let color = brightness > 110 ? 255 : 0; // Podstawowy Threshold
                imgData.data[i] = imgData.data[i+1] = imgData.data[i+2] = color;
            }
            ctx.putImageData(imgData, 0, 0);

            stream.getTracks().forEach(track => track.stop());
            videoWrapper.remove(); 
            captureBtn.remove();

            try {
                // Tesseract z wymuszoną białą listą znaków (tylko litery, cyfry i myślnik)
                const result = await Tesseract.recognize(canvas, 'eng', {
                    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-',
                    tessedit_pageseg_mode: '7' // Tryb: Pojedyncza linia tekstu
                });
                
                displayResults(result.data.words, container, inputElement);
                statusText.innerText = 'Wybierz pozycję poniżej:';
            } catch (err) {
                statusText.innerText = 'Błąd przetwarzania obrazu.';
            }
            btnElement.disabled = false;
        });
    }

    function displayResults(words, container, inputElement) {
        const resultsDiv = document.createElement('div');
        resultsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 10px;';

        const validWords = words.filter(w => w.text.trim().length > 4); 

        if (validWords.length === 0) {
            const noRes = document.createElement('span');
            noRes.innerText = 'Nic nie znaleziono. Spróbuj poprawić oświetlenie.';
            resultsDiv.appendChild(noRes);
        }

        validWords.forEach(word => {
            const cleanText = word.text; // Tekst jest już czysty dzięki białej liście
            
            const wordBtn = document.createElement('button');
            wordBtn.innerText = cleanText;
            wordBtn.style.cssText = `background: #e0e0e0; border: 1px solid #999; padding: 8px 12px; border-radius: 6px; cursor: pointer; color: #333; font-weight: bold; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);`;
            
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
        });
        
        container.appendChild(resultsDiv);
    }

    const observer = new MutationObserver(() => tryInjectUI());
    observer.observe(document.body, { childList: true, subtree: true });

})();
