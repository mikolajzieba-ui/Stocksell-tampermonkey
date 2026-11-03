// ==UserScript==
// @name         StockSell - Usuwacz Napisów
// @namespace    http://tampermonkey.net/
// @version      5.2
// @description  Usuwa napisy z tła i nakładki, chroniąc nadruki będące częścią produktu
// @author       Twój Nick
// @match        *://*.stocksell.io/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM.setClipboard
// @connect      api.openai.com
// @connect      dodatki.estila.com.pl
// @connect      *
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-usuwanie-napisow.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-usuwanie-napisow.user.js
// ==/UserScript==

(function() {
    'use strict';

    let OPENAI_API_KEY = GM_getValue('OPENAI_API_KEY', '');
    const OPENAI_URL = 'https://api.openai.com/v1/images/edits';
    const AI_MODEL = 'gpt-image-2.5-sunburst';
    const AI_MODERATION = 'low';
    const LAMA_HOME = 'https://dodatki.estila.com.pl/lama/';
    const LAMA_URL = LAMA_HOME + 'api.php';
    const LAMA_PROTOCOL = 'stocksell-lama/1';
    const LAMA_KEY_SETTING = 'LAMA_ACCESS_KEY';
    const LAMA_SIZE = 512;
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
    let localEditorActive = false;
    let lamaWorkerRunning = false;
    const lamaJobs = new Set();

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

        const title = 'Ostatni błąd StockSell / OpenAI';
        const text = [
            title,
            '',
            `Czas: ${lastError.time || 'brak'}`,
            `Etap: ${lastError.stage || 'brak'}`,
            `HTTP: ${lastError.status || 'brak'}`,
            `Kod: ${lastError.code || 'brak'}`,
            `Tryb moderacji: ${lastError.moderation || 'brak danych'}`,
            `Request ID: ${lastError.requestId || 'brak'}`,
            `Komunikat: ${lastError.message || 'brak'}`
        ].join('\n');

        const titleId = 'stocksell-openai-error-title';
        if (document.getElementById(titleId)) return;

        const dialog = document.createElement('dialog');
        dialog.setAttribute('aria-labelledby', titleId);
        dialog.style.cssText = 'width: min(640px, calc(100% - 32px)); box-sizing: border-box; padding: 20px; border: 1px solid GrayText; border-radius: 12px; background: Canvas; color: CanvasText; color-scheme: light dark;';

        const heading = document.createElement('h2');
        heading.id = titleId;
        heading.textContent = title;
        heading.style.cssText = 'margin: 0 0 12px; font: bold 18px system-ui;';

        const message = document.createElement('textarea');
        message.value = text;
        message.readOnly = true;
        message.setAttribute('aria-label', 'Pełny komunikat błędu');
        message.style.cssText = 'display: block; width: 100%; height: min(45vh, 300px); box-sizing: border-box; padding: 8px; font: 13px/1.5 monospace;';

        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px;';

        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.textContent = 'Kopiuj cały komunikat';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = 'Zamknij';
        closeButton.addEventListener('click', () => dialog.close());

        const status = document.createElement('span');
        status.setAttribute('role', 'status');
        copyButton.addEventListener('click', async () => {
            try {
                await GM.setClipboard(text, 'text');
                status.textContent = 'Skopiowano do schowka.';
            } catch (_) {
                message.focus();
                message.select();
                status.textContent = 'Tekst zaznaczony. Naciśnij Ctrl+C, aby go skopiować.';
            }
        });

        controls.append(copyButton, closeButton, status);
        dialog.append(heading, message, controls);
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        document.body.append(dialog);
        dialog.showModal();
    }

    GM_registerMenuCommand('⚙️ Ustaw klucz API OpenAI', setApiKey);
    GM_registerMenuCommand('🩺 Pokaż ostatni błąd', showLastError);
    GM_registerMenuCommand('🔑 Ustaw klucz LaMa', () => {
        const entered = prompt('Wklej klucz LaMa. Puste pole usuwa zapamiętany klucz.');
        if (entered === null) return;
        const key = entered.trim();
        if (key && !/^[a-f0-9]{64}$/.test(key)) {
            alert('Klucz LaMa powinien mieć 64 małe znaki szesnastkowe.');
            return;
        }
        GM_setValue(LAMA_KEY_SETTING, key);
    });
    GM_registerMenuCommand('🔐 Otwórz LaMa w panelu Estila', () => GM_openInTab(LAMA_HOME, { active: true }));

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

    function uploadAsNewImageToSystem(newFile, btnElement) {
        const localContainer = btnElement.closest('.image-container');
        const fileInput =
            localContainer?.querySelector('input[type="file"].image-input') ||
            document.querySelector('input[type="file"].image-input');

        if (!fileInput) return false;

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
            if (!img || !(img.currentSrc || img.src)) return;

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
                processImageOpenAI(container.querySelector('img.product-image'), btn);
            });

            const localButton = document.createElement('button');
            localButton.type = 'button';
            localButton.textContent = 'Retusz LaMa';
            localButton.style.cssText = btn.style.cssText;
            localButton.style.backgroundColor = '#23559a';
            localButton.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                processLocalImage(container, localButton);
            });

            const toolbar = document.createElement('div');
            toolbar.style.cssText = 'position: absolute; bottom: calc(100% + 4px); left: 0; right: 0; z-index: 1000; display: flex; gap: 4px; align-items: flex-end;';
            toolbar.append(btn, localButton);
            container.appendChild(toolbar);
        });
    }

    function processImageOpenAI(imgElement, btnElement) {
        if (requestInProgress) {
            btnElement.textContent = '⏳ Inne zdjęcie w toku';
            setTimeout(() => resetBtn(btnElement), 2500);
            return;
        }

        const imageSource = imgElement?.currentSrc || imgElement?.src;
        if (!imageSource) {
            showButtonError(btnElement, '❌ Brak zdjęcia', 'Element nie zawiera adresu zdjęcia.', 4000, false);
            return;
        }

        if (!OPENAI_API_KEY) {
            setApiKey();
            if (!OPENAI_API_KEY) {
                showButtonError(btnElement, '❌ Brak klucza API', 'Nie ustawiono klucza API.', 3500, false);
                return;
            }
        }

        requestInProgress = true;
        prepareBusyButton(btnElement, '⏳ Pobieranie...');

        loadProductImage(imageSource,
            image => generateFromImage(image, btnElement),
            (label, message, metadata) => finishWithError(btnElement, label, message, metadata)
        );
    }

    function loadProductImage(imageSource, onImage, onFailure) {
        function decode(url, revokeAfterLoad) {
            const image = new Image();
            image.onload = () => {
                if (revokeAfterLoad) URL.revokeObjectURL(url);
                onImage(image);
            };
            image.onerror = () => {
                if (revokeAfterLoad) URL.revokeObjectURL(url);
                onFailure('❌ Nieczytelne zdjęcie', 'Przeglądarka nie potrafi odczytać pobranego zdjęcia.', { stage: 'odczyt zdjęcia' });
            };
            image.src = url;
        }

        if (imageSource.startsWith('data:image') || imageSource.startsWith('blob:')) {
            decode(imageSource, false);
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
                    decode(blobUrl, true);
                } else {
                    onFailure(
                        '❌ Błąd pobierania',
                        `Serwer zdjęcia zwrócił HTTP ${response.status || 'brak statusu'}.`,
                        { stage: 'pobieranie zdjęcia', status: response.status }
                    );
                }
            },
            onerror: () => onFailure(
                '❌ Błąd sieci zdjęcia',
                'Nie udało się pobrać zdjęcia źródłowego.',
                { stage: 'pobieranie zdjęcia' }
            ),
            ontimeout: () => onFailure(
                '❌ Timeout zdjęcia',
                'Pobieranie zdjęcia trwało dłużej niż 60 sekund.',
                { stage: 'pobieranie zdjęcia' }
            )
        });
    }

    function productImageSource(container) {
        const image = container.querySelector('img.product-image');
        return image?.currentSrc || image?.src;
    }

    function productViewKey() {
        return location.origin + location.pathname + location.search + location.hash;
    }

    function showLamaNotice(message) {
        const notice = document.createElement('div');
        notice.setAttribute('role', 'status');
        notice.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 100000; max-width: min(420px, calc(100vw - 40px)); padding: 12px; border-radius: 8px; background: #17263b; color: white; font: 14px system-ui;';
        notice.textContent = message;
        document.body.append(notice);
        setTimeout(() => notice.remove(), 9000);
    }

    function finishLamaJob(job, message) {
        lamaJobs.delete(job);
        job.button.disabled = false;
        job.button.textContent = 'Retusz LaMa';
        job.button.title = message;
        showLamaNotice(message);
    }

    function addReadyLamaImages() {
        if (requestInProgress) return;
        for (const job of lamaJobs) {
            if (job.state !== 'ready' || job.view !== productViewKey()) continue;
            const container = job.container.isConnected && productImageSource(job.container) === job.source
                ? job.container
                : Array.from(document.querySelectorAll('.image-container')).find(item => productImageSource(item) === job.source);
            if (!container) continue;
            try {
                if (uploadAsNewImageToSystem(job.file, container)) {
                    finishLamaJob(job, 'LaMa dodała przerobione zdjęcie do formularza StockSell.');
                }
            } catch (error) {
                finishLamaJob(job, `Nie udało się dodać zdjęcia LaMa. ${error.message}`);
            }
        }
    }

    async function runLamaJobs() {
        if (lamaWorkerRunning) return;
        lamaWorkerRunning = true;
        try {
            for (const job of lamaJobs) {
                if (job.state !== 'queued') continue;
                job.state = 'working';
                job.button.textContent = '⏳ LaMa pracuje…';
                try {
                    await retouchTextWithLama(job.context, job.selections);
                    const blob = await new Promise(resolve => job.context.canvas.toBlob(resolve, 'image/png'));
                    if (!blob) throw new Error('Nie udało się utworzyć pliku PNG.');
                    job.file = new File([blob], `retusz_lama_${Date.now()}.png`, { type: 'image/png' });
                    job.context = job.selections = null;
                    job.state = 'ready';
                    addReadyLamaImages();
                    if (lamaJobs.has(job)) {
                        job.button.textContent = 'LaMa – oczekuje na formularz';
                        showLamaNotice('Retusz LaMa jest gotowy. Wróć do edycji tego produktu w tej samej karcie, aby dodać zdjęcie.');
                    }
                } catch (error) {
                    finishLamaJob(job, `LaMa: ${error.message}`);
                }
            }
        } finally {
            lamaWorkerRunning = false;
        }
    }

    function processLocalImage(container, button) {
        if (localEditorActive) {
            alert('Poczekaj na zakończenie bieżącej edycji zdjęcia.');
            return;
        }

        const source = productImageSource(container);
        const view = productViewKey();
        if (!source) {
            alert('Nie znaleziono zdjęcia do retuszu.');
            return;
        }
        if (Array.from(lamaJobs).some(job => job.view === view && job.source === source)) {
            showLamaNotice('To zdjęcie jest już w kolejce LaMa.');
            return;
        }

        localEditorActive = true;
        button.disabled = true;
        button.textContent = 'Pobieranie…';
        const done = (context, selections) => {
            localEditorActive = false;
            if (selections?.length) {
                lamaJobs.add({ context, selections, source, view, container, button, state: 'queued' });
                button.disabled = false;
                button.textContent = '⏳ LaMa w kolejce…';
                setTimeout(runLamaJobs, 0);
            } else {
                button.disabled = false;
                button.textContent = 'Retusz LaMa';
            }
        };
        const fail = message => {
            done();
            alert(message);
        };

        loadProductImage(source, image => {
            try {
                if (productViewKey() !== view || !container.isConnected || productImageSource(container) !== source) {
                    done();
                    return;
                }
                openRetouchEditor(image, done);
            } catch (error) {
                fail(error.message);
            }
        }, (_label, message) => fail(message));
    }

    function filterLocalExtrema(pixels, width, height, radius, maximum) {
        const horizontal = new Uint8Array(pixels.length);
        const result = new Uint8Array(pixels.length);

        // Kolejka przechowuje tylko kandydatów na minimum lub maksimum w przesuwanym oknie.
        function scan(source, target, lineCount, lineLength, step, lineStep) {
            const candidates = new Int32Array(lineLength);
            for (let line = 0; line < lineCount; line++) {
                const base = line * lineStep;
                let head = 0;
                let tail = 0;
                let next = 0;
                for (let position = 0; position < lineLength; position++) {
                    while (next < lineLength && next <= position + radius) {
                        const value = source[base + next * step];
                        while (tail > head) {
                            const previous = source[base + candidates[tail - 1] * step];
                            if (maximum ? previous > value : previous < value) break;
                            tail--;
                        }
                        candidates[tail++] = next++;
                    }
                    while (candidates[head] < position - radius) head++;
                    target[base + position * step] = source[base + candidates[head] * step];
                }
            }
        }

        scan(pixels, horizontal, height, width, 1, width);
        scan(horizontal, result, width, height, width, 1);
        return result;
    }

    function detectRetouchMask(context, { x, y, width, height, radius }) {
        if (width === context.canvas.width && height === context.canvas.height) {
            throw new Error('Zaznacz sam napis z małym marginesem wokół liter.');
        }
        const padding = radius * 3;
        const left = Math.max(0, x - padding);
        const top = Math.max(0, y - padding);
        const right = Math.min(context.canvas.width, x + width + padding);
        const bottom = Math.min(context.canvas.height, y + height + padding);
        const patch = context.getImageData(left, top, right - left, bottom - top);
        const brightness = new Uint8Array(patch.width * patch.height);
        for (let pixel = 0; pixel < brightness.length; pixel++) {
            const index = pixel * 4;
            brightness[pixel] = (54 * patch.data[index] + 183 * patch.data[index + 1] + 19 * patch.data[index + 2]) >> 8;
        }

        // Otwarcie i zamknięcie wygaszają cienkie jasne oraz ciemne kreski, zachowując szerokie krawędzie.
        const extrema = (pixels, maximum, size = radius) => filterLocalExtrema(pixels, patch.width, patch.height, size, maximum);
        const withoutLightStrokes = extrema(extrema(brightness, false), true);
        const withoutDarkStrokes = extrema(extrema(brightness, true), false);
        const candidates = new Uint8Array(brightness.length);
        for (let row = y - top; row < y - top + height; row++) {
            for (let column = x - left; column < x - left + width; column++) {
                const pixel = row * patch.width + column;
                const contrast = Math.max(brightness[pixel] - withoutLightStrokes[pixel], withoutDarkStrokes[pixel] - brightness[pixel]);
                candidates[pixel] = patch.data[pixel * 4 + 3] > 0 && contrast >= 18 ? 1 : 0;
            }
        }
        if (!candidates.includes(1)) throw new Error('Nie wykryto kontrastowych kresek. Zaznacz napis ciaśniej lub użyj pędzla.');

        const mask = extrema(candidates, true, Math.max(1, Math.round(radius / 3)));
        return { patch, mask, left, top };
    }


    function makeLetterSelection(context, area) {
        const { x, y, width, height } = area;
        const { patch, mask, left, top } = detectRetouchMask(context, area);
        const pixels = context.createImageData(width, height);
        for (let row = 0; row < height; row++) {
            const maskStart = (row + y - top) * patch.width + x - left;
            for (let column = 0; column < width; column++) {
                if (!mask[maskStart + column]) continue;
                const index = (row * width + column) * 4;
                pixels.data.fill(255, index, index + 4);
            }
        }
        return { x, y, pixels };
    }

    async function lamaApi(query, data, { csrf, key } = {}) {
        for (let attempt = 0; ; attempt++) {
            try {
                const response = await new Promise((resolve, reject) => {
                    const offline = () => {
                        clearTimeout(timer);
                        reject(Object.assign(new Error('Brak połączenia z serwerem LaMa Estila.'), { retryable: true }));
                    };
                    const headers = { Accept: 'application/json' };
                    if (data) headers['Content-Type'] = 'application/json';
                    if (csrf) headers['X-StockSell-LaMa-Csrf'] = csrf;
                    if (key) headers['X-StockSell-LaMa-Key'] = key;
                    let request;
                    const timer = setTimeout(() => {
                        request?.abort();
                        offline();
                    }, 20000);
                    request = GM_xmlhttpRequest({
                        method: data ? 'POST' : 'GET',
                        url: LAMA_URL + '?' + query,
                        headers,
                        ...(key ? { anonymous: true, redirect: 'error' } : {}),
                        data,
                        nocache: true,
                        responseType: 'json',
                        timeout: 20000,
                        onload: result => {
                            clearTimeout(timer);
                            resolve(result);
                        },
                        onerror: offline,
                        ontimeout: offline,
                        onabort: offline
                    });
                });
                const body = response.response;
                if (response.status === 401 || (response.status === 200 && body?.protocol !== LAMA_PROTOCOL)) {
                    throw new Error(key
                        ? 'Klucz LaMa jest nieprawidłowy lub został zmieniony. W menu Tampermonkey wybierz „Ustaw klucz LaMa”.'
                        : 'W menu Tampermonkey wybierz „Ustaw klucz LaMa” lub otwórz LaMa w panelu Estila i zaloguj się.');
                }
                if (body?.protocol !== LAMA_PROTOCOL || response.status < 200 || response.status >= 300) {
                    const error = new Error(body?.error || 'Serwer LaMa zwrócił HTTP ' + response.status + '.');
                    error.status = response.status;
                    error.retryable = [502, 504].includes(response.status);
                    throw error;
                }
                return body;
            } catch (error) {
                if (!error.retryable || attempt >= 2) throw error;
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
    }

    async function requestLama(image, mask) {
        const key = GM_getValue(LAMA_KEY_SETTING, '');
        const csrf = key ? null : (await lamaApi('action=session')).csrf;
        if (!key && (typeof csrf !== 'string' || !csrf)) throw new Error('Brak aktywnej sesji Estila.');
        const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
        const data = JSON.stringify({ id, image, mask });
        const queueDeadline = Date.now() + 90000;
        while (true) {
            try {
                const accepted = await lamaApi('action=submit', data, { csrf, key });
                if (accepted.id !== id) throw new Error('Serwer zwrócił inny identyfikator zadania.');
                break;
            } catch (error) {
                if (error.status !== 429 || Date.now() >= queueDeadline) throw error;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        const deadline = Date.now() + 15 * 60 * 1000;
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 3500));
            const job = await lamaApi('action=job&id=' + id, undefined, { key });
            if (job.state === 'done' && typeof job.result === 'string' && job.result.length > 0) {
                return b64ToFile(job.result, 'retusz_lama.png');
            }
            if (job.state === 'failed') throw new Error(job.error || 'Retusz LaMa się nie powiódł.');
            if (!['queued', 'running'].includes(job.state)) throw new Error('Nieznany stan zadania LaMa.');
        }
        throw new Error('Minął czas oczekiwania na wynik LaMa. Sprawdź stan usługi w Estila.');
    }

    async function retouchTextWithLama(context, selections) {
        const source = context.canvas;
        const x = Math.min(...selections.map(item => item.x));
        const y = Math.min(...selections.map(item => item.y));
        const width = Math.max(...selections.map(item => item.x + item.pixels.width)) - x;
        const height = Math.max(...selections.map(item => item.y + item.pixels.height)) - y;
        const extent = Math.max(width, height);
        const side = extent + 2 * Math.max(48, Math.round(extent * 0.35));
        const cropWidth = Math.min(source.width, side);
        const cropHeight = Math.min(source.height, side);
        const cropX = Math.min(Math.max(0, x + Math.floor((width - cropWidth) / 2)), source.width - cropWidth);
        const cropY = Math.min(Math.max(0, y + Math.floor((height - cropHeight) / 2)), source.height - cropHeight);
        const scale = LAMA_SIZE / side;

        const input = document.createElement('canvas');
        input.width = input.height = LAMA_SIZE;
        const inputContext = input.getContext('2d');
        const scratch = document.createElement('canvas');
        const scratchContext = scratch.getContext('2d');
        if (!inputContext || !scratchContext) throw new Error('Przeglądarka nie udostępniła Canvas 2D.');

        const scaledWidth = cropWidth * scale;
        const scaledHeight = cropHeight * scale;
        inputContext.drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, scaledWidth, scaledHeight);
        if (cropWidth < side) {
            inputContext.drawImage(source, cropX + cropWidth - 1, cropY, 1, cropHeight,
                scaledWidth, 0, LAMA_SIZE - scaledWidth, scaledHeight);
        }
        if (cropHeight < side) {
            inputContext.drawImage(input, 0, Math.max(0, Math.floor(scaledHeight) - 1), LAMA_SIZE, 1,
                0, scaledHeight, LAMA_SIZE, LAMA_SIZE - scaledHeight);
        }
        const image = input.toDataURL('image/png').split(',')[1];

        inputContext.fillStyle = '#000';
        inputContext.fillRect(0, 0, LAMA_SIZE, LAMA_SIZE);
        for (const item of selections) {
            scratch.width = item.pixels.width;
            scratch.height = item.pixels.height;
            scratchContext.putImageData(item.pixels, 0, 0);
            inputContext.drawImage(scratch, (item.x - cropX) * scale, (item.y - cropY) * scale,
                scratch.width * scale, scratch.height * scale);
        }
        const mask = input.toDataURL('image/png').split(',')[1];
        if (!image || !mask) throw new Error('Nie udało się przygotować wycinka i maski.');

        const result = await createImageBitmap(await requestLama(image, mask));
        try {
            if (result.width !== LAMA_SIZE || result.height !== LAMA_SIZE) {
                throw new Error('Model zwrócił wycinek o niewłaściwych wymiarach.');
            }
            for (const item of selections) {
                scratch.width = item.pixels.width;
                scratch.height = item.pixels.height;
                const w = scratch.width;
                const h = scratch.height;
                scratchContext.drawImage(result, (item.x - cropX) * scale, (item.y - cropY) * scale,
                    w * scale, h * scale, 0, 0, w, h);
                const replacement = scratchContext.getImageData(0, 0, w, h);
                const pixels = context.getImageData(item.x, item.y, w, h);
                for (let index = 0; index < pixels.data.length; index += 4) {
                    if (!item.pixels.data[index + 3]) continue;
                    pixels.data[index] = replacement.data[index];
                    pixels.data[index + 1] = replacement.data[index + 1];
                    pixels.data[index + 2] = replacement.data[index + 2];
                }
                context.putImageData(pixels, item.x, item.y);
            }
        } finally {
            result.close();
        }
    }

    function openRetouchEditor(image, onClose) {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.style.cssText = 'display: block; width: auto; height: auto; max-width: 100%; max-height: 62vh; touch-action: none; cursor: crosshair;';
        canvas.setAttribute('aria-label', 'Zdjęcie do zaznaczania napisów');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Przeglądarka nie udostępniła Canvas 2D.');
        context.drawImage(image, 0, 0);

        const dialog = document.createElement('dialog');
        dialog.setAttribute('aria-labelledby', 'stocksell-retouch-title');
        dialog.style.cssText = 'width: min(1080px, calc(100% - 24px)); max-height: 92vh; box-sizing: border-box; padding: 16px; overflow: auto; border: 1px solid GrayText; border-radius: 12px; background: Canvas; color: CanvasText; color-scheme: light dark;';
        const heading = document.createElement('h2');
        heading.id = 'stocksell-retouch-title';
        heading.style.cssText = 'margin: 0 0 8px; font: bold 18px system-ui;';
        heading.textContent = 'Retusz LaMa na serwerze Estila';

        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; flex-wrap: wrap; align-items: center; gap: 8px;';
        function addButton(text, action) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.addEventListener('click', action);
            controls.append(button);
            return button;
        }

        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        status.style.cssText = 'margin: 8px 0; font: 14px system-ui;';
        const stage = document.createElement('div');
        stage.style.cssText = 'position: relative; width: fit-content; max-width: 100%; margin: 0 auto;';
        const outlines = document.createElement('div');
        const selection = document.createElement('span');
        const outlineStyle = 'position: absolute; box-sizing: border-box; border: 1px dashed white; outline: 1px solid #23559a; background: #23559a33; pointer-events: none;';
        selection.style.cssText = outlineStyle;
        selection.hidden = true;
        stage.append(canvas, outlines, selection);

        const selections = [];
        let multi = false;
        let activePointer = null;
        let start = null;

        function setMode(several) {
            multi = several;
            singleButton.setAttribute('aria-pressed', String(!multi));
            multiButton.setAttribute('aria-pressed', String(multi));
            singleButton.style.fontWeight = multi ? 'normal' : 'bold';
            multiButton.style.fontWeight = multi ? 'bold' : 'normal';
            outlines.hidden = undoButton.hidden = submitButton.hidden = !multi;
            updateControls();
            status.textContent = multi
                ? 'Obrysuj kilka napisów, a potem kliknij „Usuń napisy”.'
                : 'Obrysuj jeden napis. Po puszczeniu przycisku LaMa zacznie retusz w tle.';
        }

        function updateControls() {
            const dragging = activePointer !== null;
            singleButton.disabled = multiButton.disabled = dragging;
            undoButton.disabled = submitButton.disabled = dragging || selections.length === 0;
        }

        function closeEditor(items) {
            dialog.close();
            dialog.remove();
            onClose(context, items);
        }

        const singleButton = addButton('LaMa - maska liter', () => setMode(false));
        const multiButton = addButton('LaMa - maska liter (kilka zaznaczeń)', () => setMode(true));
        const undoButton = addButton('Cofnij zaznaczenie', () => {
            selections.pop();
            outlines.lastElementChild?.remove();
            updateControls();
            status.textContent = 'Zaznaczenia: ' + selections.length + '.';
        });
        const submitButton = addButton('Usuń napisy', () => closeEditor(selections));
        addButton('Zamknij', () => closeEditor());
        setMode(false);

        function pointOnImage(event, bounds) {
            return {
                x: Math.min(canvas.width - 1, Math.max(0, Math.round((event.clientX - bounds.left) * canvas.width / bounds.width))),
                y: Math.min(canvas.height - 1, Math.max(0, Math.round((event.clientY - bounds.top) * canvas.height / bounds.height)))
            };
        }

        function rectangle(point) {
            return {
                x: Math.min(start.x, point.x),
                y: Math.min(start.y, point.y),
                width: Math.abs(start.x - point.x) + 1,
                height: Math.abs(start.y - point.y) + 1
            };
        }

        function drawOutline(element, area) {
            element.style.left = 100 * area.x / canvas.width + '%';
            element.style.top = 100 * area.y / canvas.height + '%';
            element.style.width = 100 * area.width / canvas.width + '%';
            element.style.height = 100 * area.height / canvas.height + '%';
            element.hidden = false;
        }

        canvas.addEventListener('pointerdown', event => {
            if (event.button !== 0 || activePointer !== null) return;
            event.preventDefault();
            canvas.setPointerCapture(event.pointerId);
            activePointer = event.pointerId;
            start = pointOnImage(event, canvas.getBoundingClientRect());
            updateControls();
        });

        canvas.addEventListener('pointermove', event => {
            if (event.pointerId !== activePointer) return;
            drawOutline(selection, rectangle(pointOnImage(event, canvas.getBoundingClientRect())));
        });

        for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
            canvas.addEventListener(eventName, event => {
                if (event.pointerId !== activePointer) return;
                activePointer = null;
                selection.hidden = true;
                if (event.type === 'pointerup') {
                    const bounds = canvas.getBoundingClientRect();
                    const area = rectangle(pointOnImage(event, bounds));
                    area.radius = Math.max(2, Math.min(18, Math.round(3 * canvas.width / bounds.width)));
                    if (area.width > 1 && area.height > 1) {
                        try {
                            const item = makeLetterSelection(context, area);
                            if (!multi) {
                                closeEditor([item]);
                                return;
                            }
                            selections.push(item);
                            const outline = document.createElement('span');
                            outline.style.cssText = outlineStyle;
                            drawOutline(outline, area);
                            outlines.append(outline);
                            status.textContent = 'Zaznaczenia: ' + selections.length + '. Dodaj kolejne lub kliknij „Usuń napisy”.';
                        } catch (error) {
                            status.textContent = error.message;
                        }
                    }
                }
                start = null;
                updateControls();
            });
        }

        dialog.append(heading, controls, status, stage);
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            closeEditor();
        });
        document.body.append(dialog);
        dialog.showModal();
    }

    // Dobiera najbliższy rozmiar zgodny z ograniczeniami modelu.
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

    function generateFromImage(image, btnElement) {
        btnElement.textContent = '⏳ Przygotowanie...';

        try {
            const target = chooseValidImageSize(image.naturalWidth, image.naturalHeight);
            const canvas = document.createElement('canvas');
            canvas.width = target.width;
            canvas.height = target.height;

            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Przeglądarka nie udostępniła Canvas 2D.');

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(image, 0, 0, target.width, target.height);

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

                sendEditRequest({ imageBlob, size: `${target.width}x${target.height}` }, btnElement, 0);
            }, 'image/png');
        } catch (error) {
            finishWithError(
                btnElement,
                '❌ Błąd obrazu',
                error?.message || 'Nie udało się przygotować zdjęcia.',
                { stage: 'przygotowanie obrazu' }
            );
        }
    }

    function buildFormData({ imageBlob, size }) {
        const formData = new FormData();
        formData.append('image', imageBlob, 'image.png');
        formData.append('prompt', AI_PROMPT);
        formData.append('model', AI_MODEL);
        formData.append('moderation', AI_MODERATION);
        formData.append('n', '1');
        formData.append('size', size);
        formData.append('output_format', 'png');
        return formData;
    }

    function sendEditRequest(edit, btnElement, attempt) {
        btnElement.textContent = attempt === 0
            ? '⏳ Generowanie...'
            : `⏳ Ponawiam ${attempt}/${MAX_RETRIES}...`;

        GM_xmlhttpRequest({
            method: 'POST',
            url: OPENAI_URL,
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
            data: buildFormData(edit),
            timeout: API_TIMEOUT_MS,
            onload: response => handleApiResponse(response, edit, btnElement, attempt),
            onerror: () => handleTransientFailure(
                edit,
                btnElement,
                attempt,
                'Błąd połączenia z API OpenAI.'
            ),
            ontimeout: () => handleTransientFailure(
                edit,
                btnElement,
                attempt,
                'API nie odpowiedziało w ciągu 180 sekund.'
            )
        });
    }

    function handleApiResponse(response, edit, btnElement, attempt) {
        if (response.status >= 200 && response.status < 300) {
            try {
                const result = JSON.parse(response.responseText);
                const b64Data = result?.data?.[0]?.b64_json;
                if (!b64Data) throw new Error('Odpowiedź API nie zawiera obrazu b64_json.');

                const file = b64ToFile(b64Data, `ai_generated_${Date.now()}.png`);
                if (!uploadAsNewImageToSystem(file, btnElement)) {
                    finishWithError(
                        btnElement,
                        '❌ Błąd formularza',
                        'Nie znaleziono pola przesyłania zdjęcia w StockSell.',
                        { stage: 'dodawanie do StockSell', status: response.status, moderation: AI_MODERATION }
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
                        moderation: AI_MODERATION,
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
                () => sendEditRequest(edit, btnElement, attempt + 1),
                delayMs
            );
            return;
        }

        finishWithError(btnElement, apiError.shortLabel, apiError.fullMessage, {
            stage: 'API OpenAI',
            status: response.status,
            code: apiError.code,
            moderation: AI_MODERATION,
            requestId: apiError.requestId
        });
    }

    function handleTransientFailure(edit, btnElement, attempt, message) {
        if (attempt < MAX_RETRIES) {
            btnElement.textContent = '⏳ Błąd sieci — ponawiam...';
            setTimeout(
                () => sendEditRequest(edit, btnElement, attempt + 1),
                2000 * (attempt + 1)
            );
            return;
        }

        finishWithError(
            btnElement,
            '❌ Błąd połączenia',
            `${message} Niepowodzenie po ${MAX_RETRIES + 1} próbach.`,
            { stage: 'połączenie z API', moderation: AI_MODERATION }
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
        const blockedByModeration = code === 'moderation_blocked';
        if (blockedByModeration) shortLabel = '❌ Blokada OpenAI';

        const details = [
            `HTTP ${response.status || 'brak'}`,
            `kod: ${code}`,
            message,
            requestId ? `Request ID: ${requestId}` : ''
        ].filter(Boolean).join(' | ');

        return {
            code,
            requestId,
            shortLabel,
            fullMessage: blockedByModeration
                ? 'Filtr OpenAI zablokował edycję. Jeśli blokada wydaje się błędna, zgłoś ją do pomocy OpenAI i dołącz Request ID.\n\n' + details
                : details
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
                moderation: metadata.moderation || '',
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

    const observer = new MutationObserver(() => {
        addRemoveButtons();
        addReadyLamaImages();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', addReadyLamaImages);
    window.addEventListener('hashchange', addReadyLamaImages);
    addRemoveButtons();
})();
