// ==UserScript==
// @name         StockSell - Skaner OCR (Wersja 6.0 - Burst Mode)
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  Tryb seryjny (3 klatki w 0.5s), powiększone okno, auto-kontrast
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
        
        // POWIĘKSZONE OKIENKO (Wysokość 30%, szerokość 90%)
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: absolute; top: 35%; left: 5%; width: 90%; height: 30%; border: 2px solid #FFEB3B; box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.7); box-sizing: border-box; z-index: 10; pointer-events: none;';

        videoWrapper.appendChild(video);
        videoWrapper.appendChild(overlay);
        
        const captureBtn = document.createElement('button');
        captureBtn.innerText = '📸 Skanuj (0.5 sekundy)';
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
            statusText.innerText = 'Wyceluj zółtą ramkę w tekst i kliknij.';
        };

        captureBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            captureBtn.disabled = true;
            statusText.innerText = 'Przechwytywanie klatek...';
            
            const cropX = video.videoWidth * 0.05;
            const cropY = video.videoHeight * 0.35;
            const cropW = video.videoWidth * 0.90;
            const cropH = video.videoHeight * 0.30;
            const scale = 2; 

            const canvases = [];

            // Funkcja do zrobienia pojedynczej klatki
            const grabFrame = () => {
                const canvas = document.createElement('canvas');
                canvas.width = cropW * scale;
                canvas.height = cropH * scale;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
                
                // Zwiększenie kontrastu
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                for (let i = 0; i < imgData.data.length; i += 4) {
                    let brightness = (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
                    let color = brightness > 110 ? 255 : 0;
                    imgData.data[i] = imgData.data[i+1] = imgData.data[i+2] = color;
                }
                ctx.putImageData(imgData, 0, 0);
                canvases.push(canvas);
            };

            // Strzelamy 3 klatki w ciągu 0.5 sekundy
            grabFrame(); // 0ms
            
            setTimeout(grabFrame, 250); // 250ms
            
            setTimeout(async () => {
                grabFrame(); // 500ms
                
                // Zatrzymujemy wideo po 0.5s
                stream.getTracks().forEach(track => track.stop());
                videoWrapper.remove(); 
                captureBtn.remove();
                
                statusText.innerText = 'Analiza z 3 zdjęć (to zajmie kilka sekund)...';

                try {
                    let allFoundWords = new Set(); // Set zapobiega duplikatom

                    // Analizujemy każdą z 3 klatek
                    for (let i = 0; i < canvases.length; i++) {
                        const result = await Tesseract.recognize(canvases[i], 'eng', {
                            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'
                            // Usunięto pageseg_mode: '7', bo powiększyliśmy okno i może być w nim kilka linijek
                        });
                        
                        result.data.words.forEach(w => {
                            if (w.text.trim().length > 4) {
                                allFoundWords.add(w.text.trim());
                            }
                        });
                    }
                    
                    displayResults(Array.from(allFoundWords), container, inputElement);
                    statusText.innerText = 'Wybierz pozycję poniżej:';
                } catch (err) {
                    statusText.innerText = 'Błąd przetwarzania obrazu.';
                }
                btnElement.disabled = false;

            }, 500); 
        });
    }

    function displayResults(wordsArray, container, inputElement) {
        const resultsDiv = document.createElement('div');
        resultsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 10px;';

        if (wordsArray.length === 0) {
            const noRes = document.createElement('span');
            noRes.innerText = 'Nic nie znaleziono w żadnej z klatek.';
            resultsDiv.appendChild(noRes);
        }

        wordsArray.forEach(cleanText => {
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
