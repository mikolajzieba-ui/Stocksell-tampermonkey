// ==UserScript==
// @name         StockSell - Skaner API (Wersja 9.0 - OCR.space)
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  Skaner z dużym oknem wysyłający obraz do zewnętrznego API OCR.space
// @match        https://*.stocksell.io/*
// @grant        GM_xmlhttpRequest
// @connect      api.ocr.space
// ==/UserScript==

(function() {
    'use strict';

    // === TUTAJ WKLEJ SWÓJ DARMOWY KLUCZ Z OCR.SPACE ===
    const API_KEY = 'K86420622288957'; 

    function tryInjectUI() {
        const targetInput = document.getElementById('searchSkuCode');
        if (!targetInput || document.getElementById('btn-camera-ocr')) return;

        const cardContainer = targetInput.closest('mat-card');
        if (!cardContainer) return;

        const camBtn = document.createElement('button');
        camBtn.id = 'btn-camera-ocr';
        camBtn.innerText = '📷 Skanuj bez celowania (API)';
        camBtn.style.cssText = 'margin-top: 15px; width: 100%; padding: 10px; background-color: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
        
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
        
        // DUŻE, WYGODNE OKNO - wystarczy objąć naklejkę z grubsza
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: absolute; top: 20%; left: 5%; width: 90%; height: 60%; border: 2px solid #4CAF50; box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.4); box-sizing: border-box; z-index: 10; pointer-events: none;';

        videoWrapper.appendChild(video);
        videoWrapper.appendChild(overlay);
        
        const captureBtn = document.createElement('button');
        captureBtn.innerText = '📸 Zrób zdjęcie';
        captureBtn.style.cssText = 'margin-top: 10px; width: 100%; max-width: 320px; padding: 10px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 16px;';
        captureBtn.style.display = 'none'; 

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

        video.onplaying = () => {
            captureBtn.style.display = 'block';
            statusText.innerText = 'Złap naklejkę w zielone okno i kliknij przycisk.';
        };

        captureBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            captureBtn.disabled = true;
            statusText.innerText = 'Wysyłanie do inteligentnego serwera OCR...';
            
            const cropX = video.videoWidth * 0.05;
            const cropY = video.videoHeight * 0.20;
            const cropW = video.videoWidth * 0.90;
            const cropH = video.videoHeight * 0.60;

            const canvas = document.createElement('canvas');
            canvas.width = cropW;
            canvas.height = cropH;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            
            stream.getTracks().forEach(track => track.stop());
            videoWrapper.remove(); 
            captureBtn.remove();

            const base64Image = canvas.toDataURL('image/jpeg');

            // Wysyłanie bezpiecznego zapytania przez Tampermonkey do zewnętrznego API
            GM_xmlhttpRequest({
                method: "POST",
                url: "https://api.ocr.space/parse/image",
                headers: {
                    "apikey": API_KEY,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                data: "base64Image=" + encodeURIComponent(base64Image) + "&language=eng&isOverlayRequired=false&filetype=JPG",
                onload: function(response) {
                    try {
                        const json = JSON.parse(response.responseText);
                        if (json.ParsedResults && json.ParsedResults[0]) {
                            const fullText = json.ParsedResults[0].ParsedText;
                            // Dzielimy tekst na pojedyncze linie/słowa
                            const words = fullText.split(/[\s\n]+/).filter(w => w.trim().length > 4);
                            displayResults(words, container, inputElement);
                            statusText.innerText = 'Kliknij odpowiedni kod, aby go wkleić:';
                        } else {
                            statusText.innerText = 'API nie zwróciło wyników. Spróbuj ponownie.';
                        }
                    } catch(e) {
                        statusText.innerText = 'Błąd odpowiedzi serwera.';
                    }
                    btnElement.disabled = false;
                },
                onerror: function() {
                    statusText.innerText = 'Błąd połączenia z serwerem OCR.';
                    btnElement.disabled = false;
                }
            });
        });
    }

    function displayResults(wordsArray, container, inputElement) {
        const resultsDiv = document.createElement('div');
        resultsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 10px;';

        if (wordsArray.length === 0) {
            const noRes = document.createElement('span');
            noRes.innerText = 'Nie rozpoznano tekstu.';
            resultsDiv.appendChild(noRes);
        }

        wordsArray.forEach(text => {
            // Czyszczenie drobnych śmieci interpunkcyjnych na końcach wyrazów
            const cleanText = text.replace(/[^a-zA-Z0-9-]/g, '');
            if (cleanText.length < 4) return;

            const wordBtn = document.createElement('button');
            wordBtn.innerText = cleanText;
            wordBtn.style.cssText = `background: #f0f0f0; border: 1px solid #aaa; padding: 10px 14px; border-radius: 6px; cursor: pointer; color: #333; font-weight: bold; font-size: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);`;
            
            wordBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(cleanText);
                inputElement.value = cleanText;
                inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                inputElement.dispatchEvent(new Event('change', { bubbles: true }));
                
                wordBtn.style.background = '#4CAF50';
                wordBtn.style.color = 'white';
                setTimeout(() => {
                    wordBtn.style.background = '#f0f0f0';
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
