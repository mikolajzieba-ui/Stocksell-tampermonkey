// ==UserScript==
// @name         StockSell - Usuwacz Napisów
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Zapisuje klucz API na stałe, nowy prompt
// @author       Twój Nick
// @match        *://*.stocksell.io/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.openai.com
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-usuwanie-napisow.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-usuwanie-napisow.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Pobieranie klucza z pamięci Tampermonkey (puste, jeśli jeszcze nie podano)
    let OPENAI_API_KEY = GM_getValue('OPENAI_API_KEY', '');
    const OPENAI_URL = 'https://api.openai.com/v1/images/edits';

    const AI_PROMPT = "Remove ONLY the promotional overlay text, floating labels, diagrams, and watermarks from the background. CRITICAL INSTRUCTION: DO NOT remove, alter, or blur any text, logos, or writing that is physically printed, engraved, or attached to the actual product itself. Keep the main subject completely intact and original.";
    const AI_MODEL = "gpt-image-2";

    // Funkcja do ustawiania/zmiany klucza przez menu Tampermonkey
    function setApiKey() {
        const newKey = prompt('Wprowadź klucz API OpenAI:', OPENAI_API_KEY);
        if (newKey !== null) {
            const trimmedKey = newKey.trim();
            GM_setValue('OPENAI_API_KEY', trimmedKey);
            OPENAI_API_KEY = trimmedKey;
            alert('Klucz API został poprawnie zapisany!');
        }
    }

    // Dodanie opcji do menu Tampermonkey
    GM_registerMenuCommand('⚙️ Ustaw klucz API OpenAI', setApiKey);

    function dataURItoBlob(dataURI) {
        const byteString = atob(dataURI.split(',')[1]);
        const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        return new Blob([ab], {type: mimeString});
    }

    function b64ToFile(b64Data, filename) {
        const byteString = atob(b64Data);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: 'image/png' });
        return new File([blob], filename, { type: 'image/png' });
    }

    function uploadAsNewImageToSystem(b64Data) {
        const fileInput = document.querySelector('input[type="file"].image-input');

        if (!fileInput) return false;

        const newFile = b64ToFile(b64Data, `ai_generated_${Date.now()}.png`);
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(newFile);

        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));

        return true;
    }

    function addRemoveButtons() {
        const containers = document.querySelectorAll('.image-container:not(.has-openai-btn)');

        containers.forEach(container => {
            const img = container.querySelector('img.product-image');
            if (!img || !img.src) return;

            container.classList.add('has-openai-btn');

            const btn = document.createElement('button');
            btn.innerHTML = 'Usuń napisy';

            btn.style.cssText = `
                position: absolute;
                top: 8px;
                left: 8px;
                z-index: 1000;
                background-color: #10a37f;
                color: white;
                border: none;
                border-radius: 4px;
                padding: 6px 12px;
                cursor: pointer;
                font-family: sans-serif;
                font-size: 12px;
                font-weight: bold;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                transition: background 0.2s;
            `;

            btn.onmouseover = () => btn.style.backgroundColor = '#0d8a6b';
            btn.onmouseout = () => btn.style.backgroundColor = '#10a37f';

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                processImageOpenAI(img, btn);
            });

            container.appendChild(btn);
        });
    }

    function processImageOpenAI(imgElement, btnElement) {
        // Sprawdzenie, czy klucz API został podany
        if (!OPENAI_API_KEY) {
            setApiKey();
            // Jeśli użytkownik anulował wpisywanie klucza
            if (!OPENAI_API_KEY) {
                btnElement.innerHTML = '❌ Brak klucza API';
                setTimeout(() => resetBtn(btnElement), 3000);
                return;
            }
        }

        const imageSource = imgElement.src;

        if (!imageSource || imageSource.length < 500) {
            btnElement.innerHTML = '❌ Brak zdjęcia';
            setTimeout(() => resetBtn(btnElement), 4000);
            return;
        }

        btnElement.innerHTML = '⏳ Generowanie...';
        btnElement.disabled = true;
        btnElement.style.backgroundColor = '#666';

        try {
            const rawWidth = imgElement.naturalWidth || 1024;
            const rawHeight = imgElement.naturalHeight || 1024;

            const targetWidth = Math.round(rawWidth / 16) * 16;
            const targetHeight = Math.round(rawHeight / 16) * 16;
            const dynamicSize = `${targetWidth}x${targetHeight}`;

            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, targetWidth, targetHeight);
            ctx.drawImage(imgElement, 0, 0, targetWidth, targetHeight);

            const resizedBase64 = canvas.toDataURL('image/png');
            const imageBlob = dataURItoBlob(resizedBase64);

            const formData = new FormData();
            formData.append('image', imageBlob, 'image.png');
            formData.append('prompt', AI_PROMPT);
            formData.append('model', AI_MODEL);
            formData.append('n', 1);
            formData.append('size', dynamicSize);

            GM_xmlhttpRequest({
                method: 'POST',
                url: OPENAI_URL,
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                data: formData,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const result = JSON.parse(response.responseText);
                            if (result.data && result.data.length > 0 && result.data[0].b64_json) {

                                const uploadSuccess = uploadAsNewImageToSystem(result.data[0].b64_json);

                                if(uploadSuccess) {
                                    btnElement.innerHTML = '✅ Zrobione';
                                    btnElement.style.backgroundColor = '#28a745';

                                    setTimeout(() => resetBtn(btnElement), 3000);

                                } else {
                                    btnElement.innerHTML = '❌ Błąd formularza';
                                    setTimeout(() => resetBtn(btnElement), 5000);
                                }
                            } else {
                                throw new Error('Brak danych w odpowiedzi');
                            }
                        } catch (e) {
                            btnElement.innerHTML = '❌ Błąd danych';
                            setTimeout(() => resetBtn(btnElement), 5000);
                        }
                    } else {
                        btnElement.innerHTML = '❌ Błąd API';
                        console.error("Błąd z serwera API:", response.responseText);

                        // Opcjonalnie: Jeśli błąd to 401 (Nieautoryzowano), klucz jest błędny
                        if (response.status === 401) {
                            alert("Błąd autoryzacji! Sprawdź, czy wprowadzony klucz API jest poprawny.");
                            OPENAI_API_KEY = ""; // Reset klucza, żeby wymusić ponowne wpisanie
                            GM_setValue('OPENAI_API_KEY', '');
                        }

                        setTimeout(() => resetBtn(btnElement), 5000);
                    }
                },
                onerror: function(err) {
                    btnElement.innerHTML = '❌ Błąd sieci';
                    setTimeout(() => resetBtn(btnElement), 5000);
                }
            });
        } catch (error) {
            btnElement.innerHTML = '❌ Błąd konwersji';
            setTimeout(() => resetBtn(btnElement), 5000);
        }
    }

    function resetBtn(btn) {
        btn.innerHTML = 'Usuń napisy';
        btn.disabled = false;
        btn.style.backgroundColor = '#10a37f';
    }

    const observer = new MutationObserver(() => {
        addRemoveButtons();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    addRemoveButtons();

})();
