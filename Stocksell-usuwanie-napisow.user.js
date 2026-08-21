// ==UserScript==
// @name         StockSell - Usuwacz Napisów
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Usuwa napisy z tła i nakładki, chroniąc nadruki będące częścią produktu
// @author       Twój Nick
// @match        *://*.stocksell.io/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.openai.com
// @connect      *
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-usuwanie-napisow.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-usuwanie-napisow.user.js
// ==/UserScript==

(function() {
    'use strict';

    let OPENAI_API_KEY = GM_getValue('OPENAI_API_KEY', '');
    const OPENAI_URL = 'https://api.openai.com/v1/images/edits';
    const AI_MODEL = 'gpt-image-2';
    const LAST_ERROR_KEY = 'OPENAI_LAST_ERROR';
    const API_TIMEOUT_MS = 180000;
    const MAX_RETRIES = 2;

    // Najważniejsza zmiana: napisy należące fizycznie do produktu mają zostać zachowane.
    const AI_PROMPT = [
        'Edit this product photo conservatively.',
        'Remove ONLY text, captions, prices, promotional graphics, and watermarks that are floating overlays, located in the background, or placed over the product but are not physically part of it.',
        'PRESERVE every marking that belongs to the physical product, including brand logos, labels, model names or numbers, packaging text, prints, embroidery, engravings, decals, badges, care labels, and any writing printed or attached to the item.',
        'If it is uncertain whether text belongs to the product, DO NOT remove it.',
        'Inpaint only the pixels occupied by removable overlay or background text using the immediately surrounding texture.',
        'Keep the product, background, framing, lighting, shadows, colors, texture, geometry, and all other pixels unchanged. Do not add, redesign, move, crop, or transform anything.'
    ].join(' ');

    let requestInProgress = false;

    function setApiKey() {
        const newKey = prompt('Wprowadź klucz API OpenAI:', OPENAI_API_KEY);
        if (newKey !== null) {
            const trimmedKey = newKey.trim();
            GM_setValue('OPENAI_API_KEY', trimmedKey);
            OPENAI_API_KEY = trimmedKey;
            alert(trimmedKey ? 'Klucz API został zapisany.' : 'Klucz API został usunięty.');
        }
    }

    function showLastError() {
        const lastError = GM_getValue(LAST_ERROR_KEY, null);
        if (!lastError) {
            alert('Nie zapisano jeszcze żadnego błędu.');
            return;
        }

        alert([
            'Ostatni błąd StockSell / OpenAI',
            '',
            `Czas: ${lastError.time || 'brak'}`,
            `Etap: ${lastError.stage || 'brak'}`,
            `HTTP: ${lastError.status || 'brak'}`,
            `Kod: ${lastError.code || 'brak'}`,
            `Request ID: ${lastError.requestId || 'brak'}`,
            `Komunikat: ${lastError.message || 'brak'}`
        ].join('\n'));
    }

    GM_registerMenuCommand('⚙️ Ustaw klucz API OpenAI', setApiKey);
    GM_registerMenuCommand('🩺 Pokaż ostatni błąd', showLastError);

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

    function uploadAsNewImageToSystem(b64Data, btnElement) {
        const localContainer = btnElement.closest('.image-container');
        const fileInput =
            localContainer?.querySelector('input[type="file"].image-input') ||
            document.querySelector('input[type="file"].image-input');

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

            if (window.getComputedStyle(container).position === 'static') {
                container.style.position = 'relative';
            }
            container.style.marginTop = '32px';
            container.style.overflow = 'visible';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Usuń napisy';
            btn.style.cssText = `
                position: absolute;
                top: -32px;
                left: 0;
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

            btn.onmouseover = () => {
                if (!btn.disabled) btn.style.backgroundColor = '#0d8a6b';
            };
            btn.onmouseout = () => {
                if (!btn.disabled) btn.style.backgroundColor = '#10a37f';
            };

            btn.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                processImageOpenAI(img, btn);
            });

            container.appendChild(btn);
        });
    }

    function processImageOpenAI(imgElement, btnElement) {
        if (requestInProgress) {
            btnElement.textContent = '⏳ Inne zdjęcie w toku';
            setTimeout(() => resetBtn(btnElement), 2500);
            return;
        }

        if (!OPENAI_API_KEY) {
            setApiKey();
            if (!OPENAI_API_KEY) {
                showButtonError(btnElement, '❌ Brak klucza API', 'Nie ustawiono klucza API.', 3500, false);
                return;
            }
        }

        const imageSource = imgElement.src;
        if (!imageSource) {
            showButtonError(btnElement, '❌ Brak zdjęcia', 'Element nie zawiera adresu zdjęcia.', 4000, false);
            return;
        }

        requestInProgress = true;
        prepareBusyButton(btnElement, '⏳ Pobieranie...');

        if (imageSource.startsWith('data:image') || imageSource.startsWith('blob:')) {
            generateFromSafeSource(imageSource, btnElement, false);
            return;
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: imageSource,
            responseType: 'blob',
            timeout: 60000,
            onload: response => {
                if (response.status >= 200 && response.status < 300 && response.response) {
                    const blobUrl = URL.createObjectURL(response.response);
                    generateFromSafeSource(blobUrl, btnElement, true);
                } else {
                    finishWithError(
                        btnElement,
                        '❌ Błąd pobierania',
                        `Serwer zdjęcia zwrócił HTTP ${response.status || 'brak statusu'}.`,
                        { stage: 'pobieranie zdjęcia', status: response.status }
                    );
                }
            },
            onerror: () => finishWithError(
                btnElement,
                '❌ Błąd sieci zdjęcia',
                'Nie udało się pobrać zdjęcia źródłowego.',
                { stage: 'pobieranie zdjęcia' }
            ),
            ontimeout: () => finishWithError(
                btnElement,
                '❌ Timeout zdjęcia',
                'Pobieranie zdjęcia trwało dłużej niż 60 sekund.',
                { stage: 'pobieranie zdjęcia' }
            )
        });
    }

    // Dobiera najbliższy rozmiar spełniający wszystkie ograniczenia gpt-image-2.
    function chooseValidImageSize(rawWidth, rawHeight) {
        const MIN_PIXELS = 655360;
        const MAX_PIXELS = 8294400;
        const MAX_EDGE = 3840;
        const rawRatio = rawWidth / rawHeight;

        if (!Number.isFinite(rawRatio) || rawWidth <= 0 || rawHeight <= 0) {
            throw new Error('Zdjęcie ma nieprawidłowe wymiary.');
        }
        if (rawRatio > 3 || rawRatio < 1 / 3) {
            throw new Error('Proporcje zdjęcia przekraczają limit 3:1. Przytnij zdjęcie przed użyciem.');
        }

        const targetArea = Math.min(MAX_PIXELS, Math.max(MIN_PIXELS, rawWidth * rawHeight));
        let best = null;

        for (let width = 16; width <= MAX_EDGE; width += 16) {
            const idealHeight = width / rawRatio;
            const heightCandidates = new Set([
                Math.floor(idealHeight / 16) * 16,
                Math.round(idealHeight / 16) * 16,
                Math.ceil(idealHeight / 16) * 16
            ]);

            for (const height of heightCandidates) {
                if (height < 16 || height > MAX_EDGE) continue;

                const pixels = width * height;
                const ratio = width / height;
                if (pixels < MIN_PIXELS || pixels > MAX_PIXELS) continue;
                if (ratio > 3 || ratio < 1 / 3) continue;

                const aspectError = Math.abs(Math.log(ratio / rawRatio));
                const areaError = Math.abs(Math.log(pixels / targetArea));
                const score = aspectError * 100 + areaError;

                if (!best || score < best.score) {
                    best = { width, height, score };
                }
            }
        }

        if (!best) throw new Error('Nie udało się dobrać rozmiaru akceptowanego przez API.');
        return { width: best.width, height: best.height };
    }

    function generateFromSafeSource(safeSourceUrl, btnElement, revokeAfterLoad) {
        btnElement.textContent = '⏳ Przygotowanie...';

        const tempImg = new Image();
        tempImg.onload = () => {
            if (revokeAfterLoad) URL.revokeObjectURL(safeSourceUrl);

            try {
                const rawWidth = tempImg.naturalWidth;
                const rawHeight = tempImg.naturalHeight;
                const target = chooseValidImageSize(rawWidth, rawHeight);
                const canvas = document.createElement('canvas');
                canvas.width = target.width;
                canvas.height = target.height;

                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Przeglądarka nie udostępniła Canvas 2D.');

                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(tempImg, 0, 0, target.width, target.height);

                canvas.toBlob(imageBlob => {
                    if (!imageBlob) {
                        finishWithError(
                            btnElement,
                            '❌ Błąd obrazu',
                            'Przeglądarka nie utworzyła pliku PNG.',
                            { stage: 'przygotowanie obrazu' }
                        );
                        return;
                    }

                    sendEditRequest(imageBlob, `${target.width}x${target.height}`, btnElement, 0);
                }, 'image/png');
            } catch (error) {
                finishWithError(
                    btnElement,
                    '❌ Błąd obrazu',
                    error?.message || 'Nie udało się przygotować zdjęcia.',
                    { stage: 'przygotowanie obrazu' }
                );
            }
        };

        tempImg.onerror = () => {
            if (revokeAfterLoad) URL.revokeObjectURL(safeSourceUrl);
            finishWithError(
                btnElement,
                '❌ Nieczytelne zdjęcie',
                'Przeglądarka nie potrafi odczytać pobranego zdjęcia.',
                { stage: 'odczyt zdjęcia' }
            );
        };

        tempImg.src = safeSourceUrl;
    }

    function buildFormData(imageBlob, size) {
        const formData = new FormData();
        formData.append('image', imageBlob, 'image.png');
        formData.append('prompt', AI_PROMPT);
        formData.append('model', AI_MODEL);
        formData.append('n', '1');
        formData.append('size', size);
        formData.append('output_format', 'png');
        return formData;
    }

    function sendEditRequest(imageBlob, size, btnElement, attempt) {
        btnElement.textContent = attempt === 0
            ? '⏳ Generowanie...'
            : `⏳ Ponawiam ${attempt}/${MAX_RETRIES}...`;

        GM_xmlhttpRequest({
            method: 'POST',
            url: OPENAI_URL,
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
            data: buildFormData(imageBlob, size),
            timeout: API_TIMEOUT_MS,
            onload: response => handleApiResponse(response, imageBlob, size, btnElement, attempt),
            onerror: () => handleTransientFailure(
                imageBlob,
                size,
                btnElement,
                attempt,
                'Błąd połączenia z API OpenAI.'
            ),
            ontimeout: () => handleTransientFailure(
                imageBlob,
                size,
                btnElement,
                attempt,
                'API nie odpowiedziało w ciągu 180 sekund.'
            )
        });
    }

    function handleApiResponse(response, imageBlob, size, btnElement, attempt) {
        if (response.status >= 200 && response.status < 300) {
            try {
                const result = JSON.parse(response.responseText);
                const b64Data = result?.data?.[0]?.b64_json;
                if (!b64Data) throw new Error('Odpowiedź API nie zawiera obrazu b64_json.');

                if (!uploadAsNewImageToSystem(b64Data, btnElement)) {
                    finishWithError(
                        btnElement,
                        '❌ Błąd formularza',
                        'Nie znaleziono pola przesyłania zdjęcia w StockSell.',
                        { stage: 'dodawanie do StockSell', status: response.status }
                    );
                    return;
                }

                requestInProgress = false;
                btnElement.textContent = '✅ Zrobione';
                btnElement.style.backgroundColor = '#28a745';
                btnElement.title = '';
                setTimeout(() => resetBtn(btnElement), 3000);
            } catch (error) {
                finishWithError(
                    btnElement,
                    '❌ Błąd odpowiedzi',
                    error?.message || 'Nie można odczytać odpowiedzi API.',
                    {
                        stage: 'odczyt odpowiedzi API',
                        status: response.status,
                        requestId: getResponseHeader(response.responseHeaders, 'x-request-id')
                    }
                );
            }
            return;
        }

        const apiError = parseApiError(response);
        const retryable = isRetryableApiError(response.status, apiError.code);

        if (retryable && attempt < MAX_RETRIES) {
            const delayMs = getRetryDelayMs(response.responseHeaders, attempt);
            btnElement.textContent = `⏳ Limit/serwer — ponawiam...`;
            btnElement.title = apiError.fullMessage;
            setTimeout(
                () => sendEditRequest(imageBlob, size, btnElement, attempt + 1),
                delayMs
            );
            return;
        }

        finishWithError(btnElement, apiError.shortLabel, apiError.fullMessage, {
            stage: 'API OpenAI',
            status: response.status,
            code: apiError.code,
            requestId: apiError.requestId
        });
    }

    function handleTransientFailure(imageBlob, size, btnElement, attempt, message) {
        if (attempt < MAX_RETRIES) {
            btnElement.textContent = '⏳ Błąd sieci — ponawiam...';
            setTimeout(
                () => sendEditRequest(imageBlob, size, btnElement, attempt + 1),
                2000 * (attempt + 1)
            );
            return;
        }

        finishWithError(
            btnElement,
            '❌ Błąd połączenia',
            `${message} Niepowodzenie po ${MAX_RETRIES + 1} próbach.`,
            { stage: 'połączenie z API' }
        );
    }

    function parseApiError(response) {
        let payload = null;
        try {
            payload = JSON.parse(response.responseText || '{}');
        } catch (_) {
            // Odpowiedź może być tekstem lub pustą stroną błędu pośredniego serwera.
        }

        const error = payload?.error || {};
        const code = String(error.code || error.type || 'unknown_error');
        const message = String(
            error.message ||
            response.statusText ||
            (response.responseText || '').slice(0, 500) ||
            'API nie zwróciło szczegółów.'
        );
        const requestId = getResponseHeader(response.responseHeaders, 'x-request-id');

        let shortLabel = `❌ API HTTP ${response.status || '?'}`;
        if (response.status === 400) shortLabel = '❌ Błędne dane';
        if (response.status === 401) shortLabel = '❌ Zły klucz API';
        if (response.status === 403) shortLabel = '❌ Brak dostępu';
        if (response.status === 413) shortLabel = '❌ Za duże zdjęcie';
        if (response.status === 429) shortLabel = '❌ Limit API';
        if (response.status >= 500) shortLabel = '❌ Serwer OpenAI';
        if (code === 'insufficient_quota') shortLabel = '❌ Brak środków';
        if (code === 'moderation_blocked') shortLabel = '❌ Obraz odrzucony';

        return {
            code,
            requestId,
            shortLabel,
            fullMessage: [
                `HTTP ${response.status || 'brak'}`,
                `kod: ${code}`,
                message,
                requestId ? `Request ID: ${requestId}` : ''
            ].filter(Boolean).join(' | ')
        };
    }

    function isRetryableApiError(status, code) {
        if (code === 'insufficient_quota' || code === 'moderation_blocked') return false;
        return status === 429 || status >= 500;
    }

    function getResponseHeader(rawHeaders, wantedName) {
        if (!rawHeaders) return '';
        const wanted = wantedName.toLowerCase();
        const line = String(rawHeaders)
            .split(/\r?\n/)
            .find(headerLine => headerLine.toLowerCase().startsWith(`${wanted}:`));
        return line ? line.slice(line.indexOf(':') + 1).trim() : '';
    }

    function getRetryDelayMs(rawHeaders, attempt) {
        const retryAfter = Number(getResponseHeader(rawHeaders, 'retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
            return Math.min(retryAfter * 1000, 30000);
        }
        return 2000 * (attempt + 1);
    }

    function prepareBusyButton(btn, text) {
        btn.textContent = text;
        btn.disabled = true;
        btn.title = '';
        btn.style.backgroundColor = '#666';
    }

    function finishWithError(btn, label, message, metadata = {}) {
        requestInProgress = false;
        showButtonError(btn, label, message, 8000, true, metadata);
    }

    function showButtonError(btn, label, message, resetAfterMs, save, metadata = {}) {
        btn.textContent = label;
        btn.title = message;
        btn.style.backgroundColor = '#c62828';

        if (save) {
            const errorRecord = {
                time: new Date().toLocaleString('pl-PL'),
                stage: metadata.stage || '',
                status: metadata.status || '',
                code: metadata.code || '',
                requestId: metadata.requestId || '',
                message
            };
            GM_setValue(LAST_ERROR_KEY, errorRecord);
            console.error('[StockSell - Usuwacz Napisów]', errorRecord);
        }

        setTimeout(() => resetBtn(btn), resetAfterMs);
    }

    function resetBtn(btn) {
        btn.textContent = 'Usuń napisy';
        btn.disabled = false;
        btn.style.backgroundColor = '#10a37f';
    }

    const observer = new MutationObserver(addRemoveButtons);
    observer.observe(document.body, { childList: true, subtree: true });
    addRemoveButtons();
})();
