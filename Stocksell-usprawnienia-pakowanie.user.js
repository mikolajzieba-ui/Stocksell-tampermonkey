// ==UserScript==
// @name         StockSell - pakiet usprawnień
// @namespace    http://tampermonkey.net/
// @version      1.6.4
// @description  Opisy Allegro, podsumowanie batchy, lepsze boxy, analiza Pick bez Pack/Match, etykiety błędów i druk pełnych miejsc magazynowych z ofert. Obsługa OLX tymczasowo wyłączona.
// @match        https://stocksell.io/*
// @match        https://*.stocksell.io/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      allegro.pl
// @connect      estila.com.pl
// @connect      olx.estila.com.pl
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-usprawnienia-pakowanie.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Stocksell-usprawnienia-pakowanie.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ESTILA PACKING ASSIGNMENTS BEGIN
    (function packingAssignmentsModule() {
        const panelUrl = 'https://estila.com.pl/packing-assignments.php';
        const tokenKey = 'ss-packing-reader-v1';
        const storageAvailable = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
        // Panel uzupełnia ten klucz w jednej kopii skryptu przeznaczonej na wszystkie stanowiska.
        // Zapis GM zachowuje dostęp także po późniejszej aktualizacji zwykłego pliku wtyczki.
        const sharedReaderToken = 'c853f916a24dbff4b12ed8a655f8bd94d665f87d29b48a8eb8f81427798a9139';
        if (storageAvailable && /^[a-f0-9]{64}$/.test(sharedReaderToken)) GM_setValue(tokenKey, sharedReaderToken);
        const configured = () => storageAvailable && /^[a-f0-9]{64}$/.test(GM_getValue(tokenKey, ''));
        const pageStarted = Date.now(), sessionKey = 'ss-packing-login-v1', clientKey = 'ss-packing-client-v1', stationKey = 'ss-packing-station-v1';
        const workDay = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const localStation = () => { const value = Number(GM_getValue(stationKey, 0)); return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 0; };
        let observedEmail = null, missingSince = null, lastPresence = -Infinity, lastSignature = '', presenceBusy = false, presenceMessage = '';
        const onPackingPage = () => location.pathname.replace(/\/$/, '') === '/packing/batch/packing';
        let snapshot = null, expires = 0, lastPoll = -Infinity, busy = false, message = '', generation = 0;
        const startsKey = 'ss-packing-starts-v1';
        let startCandidate = null, startsBusy = false, lastStartReport = -Infinity, startsMessage = '';
        if (storageAvailable && typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('⚙ Ustaw stanowisko pakowania', () => {
                const value = window.prompt('Stanowisko pakowania tego komputera (1–5).\n0 = Bez stanowiska. Numer zapisuje się na stałe w Tampermonkey.', String(localStation()));
                if (value === null) return;
                if (!/^[0-5]$/.test(value.trim())) { window.alert('Wpisz numer od 1 do 5 albo 0 (Bez stanowiska).'); return; }
                const station = Number(value.trim());
                if (station === localStation()) return;
                GM_setValue(stationKey, station);
                const state = GM_getValue(sessionKey, null);
                if (state) GM_setValue(sessionKey, { ...state, station, day: workDay(), changedAt: Math.max(Date.now(), state.changedAt + 1) });
                lastPresence = -Infinity; tick();
            });
            GM_registerMenuCommand('ℹ Status przydziału paczek', () => {
                const usable = snapshot && performance.now() < expires;
                const info = !configured() ? 'Przydział nie jest połączony. Zainstaluj wspólną wtyczkę z panelu Duże paczki.' :
                    (message || (usable ? (Object.keys(snapshot.owners).length ? 'Przydział jest aktualny.' : 'Brak aktywnych stanowisk w tej chwili.') : 'Otwórz Pakowanie wielosztuk, aby odczytać przydział.'));
                const conflicts = usable && snapshot.conflicts?.length ? '\nKonflikt obsady stanowisk: ' + snapshot.conflicts.join(', ') + '.' : '';
                const mode = usable && snapshot.assignmentMode ? '\nTryb: ' + (snapshot.assignmentMode.value === 'balanced' ? 'Strefy z wyrównywaniem' : 'Według stref') + '.' : '';
                window.alert((localStation() ? 'Stanowisko ' + localStation() : 'Bez stanowiska') + '\n' + info + presenceMessage + startsMessage + mode + conflicts);
            });
        }
        GM_addStyle(`
            .courier-tag:has(.ss-packing-assignee) { max-width:calc(100% - 6px); box-sizing:border-box; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .courier-tag .ss-packing-assignee { text-transform:none !important; }
        `);
        function currentEmail() {
            // Celowo tylko pole Użytkownik, nigdy mail konta Allegro z tego samego paska.
            const field = document.querySelector('[data-cy="username"]');
            if (!field) return '';
            const value = (field.querySelector('.header')?.textContent || field.textContent.replace(/^\s*Użytkownik:\s*/i, '')).trim().toLowerCase();
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : '';
        }
        function reportPresence() {
            if (!configured()) return;
            const mail = currentEmail(), station = localStation();
            let state = GM_getValue(sessionKey, null);
            if (!station && !state) return;
            const change = email => {
                state = { email, station, day: workDay(), changedAt: Math.max(Date.now(), (state?.changedAt || 0) + 1) };
                GM_setValue(sessionKey, state);
            };
            if (mail) {
                missingSince = null;
                if (observedEmail !== mail) {
                    // Nowe logowanie/otwarcie strony zapisuje dzisiejszą obsadę.
                    // Niezmieniona karta pozostawiona przez noc nie odnawia wczorajszego dnia.
                    if (observedEmail !== null || !state || state.email === mail || state.changedAt < pageStarted) {
                        if (!state || state.email !== mail || state.day !== workDay() || state.station !== station) change(mail);
                    }
                    observedEmail = mail;
                }
            } else if (observedEmail) {
                missingSince ??= performance.now();
                if (performance.now() - missingSince < 3000) return;
                if (state?.email === observedEmail) change('');
                observedEmail = '';
            }
            if (!state || observedEmail === null || state.email !== mail || presenceBusy || performance.now() - lastPresence < 5000) return;
            const signature = state.changedAt + ':' + state.email + ':' + station;
            if (signature === lastSignature) return;
            let client = GM_getValue(clientKey, '');
            if (!/^[a-f0-9]{32}$/.test(client)) {
                client = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
                GM_setValue(clientKey, client);
            }
            const changed = signature !== lastSignature;
            lastPresence = performance.now(); lastSignature = signature; presenceBusy = true;
            const token = GM_getValue(tokenKey, '');
            const finish = ok => { presenceBusy = false; if (!ok) { lastSignature = ''; lastPresence = performance.now(); } };
            try {
                GM_xmlhttpRequest({
                    method: 'POST', url: panelUrl + '?api=presence', anonymous: true, timeout: 10000,
                    headers: { Authorization: 'Bearer ' + token, 'X-Estila-Packing-Key': token, 'Content-Type': 'application/json' },
                    data: JSON.stringify({ client, email: station ? state.email : '', station, generation: state.changedAt, day: state.day }),
                    onload(response) {
                        finish(response.status === 200);
                        if (response.status === 200) {
                            try { presenceMessage = station && mail && JSON.parse(response.responseText).recognized === false ? ' Twój mail StockSell nie jest jeszcze przypisany w panelu.' : ''; } catch {}
                            if (changed) lastPoll = -Infinity;
                        }
                    },
                    onerror() { finish(false); }, ontimeout() { finish(false); }
                });
            } catch { finish(false); }
        }
        function boxNames(label) {
            const suffix = label.querySelector('.batch-suffix')?.textContent || label.textContent.replace(/^\s*Batch\s+\d+\s*/i, '');
            const parts = suffix.trim().split(/[\s,;/+]+/).map(value => value.toUpperCase().replace('_', ''));
            if (!parts.length || parts.some(value => !/^[A-T][1-3]$/.test(value))) return [];
            return [...new Set(parts)];
        }
        function startStore() {
            const value = GM_getValue(startsKey, null), day = workDay();
            return { queue: (Array.isArray(value?.queue) ? value.queue : []).filter(event => event.day === day),
                seen: value?.seen && value.day === day && typeof value.seen === 'object' ? value.seen : {}, day };
        }
        function captureStart() {
            if (!configured() || !onPackingPage() || !localStation()) return;
            const summary = document.querySelector('app-packing-order-summary .packing-order-summary');
            const heading = summary && [...summary.querySelectorAll('h2')].map(el => el.textContent.trim()).find(text => /^Zamówienie numer:\s*[1-9]\d*\s*$/.test(text));
            const text = summary?.querySelector('.boxes')?.textContent.trim() || '';
            const match = text.match(/^Multibox:\s*zeskanuj produkt z boxów:\s*((?:[A-T]_?[1-3]\s*)+)$/);
            const boxes = match ? [...new Set(match[1].trim().split(/\s+/).map(box => box.replace('_', '')))] : [];
            const mail = currentEmail();
            const company = (document.querySelector('.company-name .header')?.textContent || document.querySelector('.company-name')?.textContent || '').replace(/^\s*Firma:\s*/i, '').trim();
            if (!summary || !summary.getClientRects().length || !heading || boxes.length < 2 || !mail || !company) { startCandidate = null; return; }
            const order = heading.match(/[1-9]\d*\s*$/)[0].trim();
            const source = [...summary.querySelectorAll('h2')].some(el => /Zamówienie pochodzące z Outleya!/i.test(el.textContent)) ? 'sylius' : 'baselinker';
            const identity = JSON.stringify([company.toLowerCase(), source, order]);
            const signature = JSON.stringify([identity, mail, localStation(), boxes]);
            if (startCandidate?.signature !== signature) {
                startCandidate = { signature, identity, day: workDay(), since: performance.now() };
                // Angular dodaje numer i boxy w jednym odświeżeniu. Krótkie potwierdzenie
                // zapobiega połączeniu starego numeru z dopiero zmienianą listą boxów.
                setTimeout(reportStarts, 300); return;
            }
            if (startCandidate.day !== workDay() || performance.now() - startCandidate.since < 250) return;
            const store = startStore();
            if (Object.hasOwn(store.seen, identity) || store.queue.some(event => event.identity === identity)) return;
            store.queue.push({ identity, day: startCandidate.day, company, source, order, boxes, email: mail, station: localStation() });
            GM_setValue(startsKey, store);
        }
        function reportStarts() {
            if (!configured()) return;
            captureStart();
            if (startsBusy || performance.now() - lastStartReport < 10000) return;
            const event = startStore().queue[0]; if (!event) return;
            startsBusy = true; lastStartReport = performance.now();
            const token = GM_getValue(tokenKey, '');
            const failed = () => { startsBusy = false; startsMessage = '\nRozpoczęcie dużej paczki czeka na wysłanie do panelu.'; };
            try {
                const { identity, ...input } = event;
                GM_xmlhttpRequest({
                    method: 'POST', url: panelUrl + '?api=started', anonymous: true, timeout: 10000,
                    headers: { Authorization: 'Bearer ' + token, 'X-Estila-Packing-Key': token, 'Content-Type': 'application/json' }, data: JSON.stringify(input),
                    onload(response) {
                        try {
                            if (response.status !== 200 || (response.finalUrl && new URL(response.finalUrl).origin !== new URL(panelUrl).origin)) throw new Error('Response');
                            const result = JSON.parse(response.responseText);
                            if (!['recorded', 'duplicate', 'stale', 'unrecognized'].includes(result.status)) throw new Error('Status');
                            if (result.status === 'unrecognized') {
                                // Nie blokuj kolejnych osób na tym komputerze, jeśli
                                // jeden dawny mail nadal wymaga poprawienia w panelu.
                                const store = startStore(), index = store.queue.findIndex(queued => queued.identity === identity);
                                if (index >= 0) store.queue.push(...store.queue.splice(index, 1));
                                GM_setValue(startsKey, store);
                                failed(); startsMessage = '\nMail pakowacza nie jest powiązany z jedną osobą w panelu. Rozpoczęcie czeka na wysłanie.'; return;
                            }
                            const store = startStore();
                            store.queue = store.queue.filter(queued => queued.identity !== identity);
                            if (event.day === store.day) store.seen[identity] = true;
                            GM_setValue(startsKey, store); startsBusy = false; startsMessage = ''; lastPoll = -Infinity;
                            lastStartReport = -Infinity;
                        } catch { failed(); }
                    }, onerror: failed, ontimeout: failed
                });
            } catch { failed(); }
        }
        function removeAssignment(box) {
            box.querySelectorAll('.ss-packing-assignee, .ss-packing-own-tag').forEach(element => element.remove());
        }
        function render() {
            const usable = onPackingPage() && snapshot && performance.now() < expires;
            document.querySelectorAll('app-consolidated-orders .box').forEach(box => {
                const label = box.querySelector('.order-name');
                const names = label ? boxNames(label) : [];
                const owner = usable && names.length > 1 ? (snapshot.packingOwners || snapshot.owners)[names[0]] : null;
                if (!owner) { removeAssignment(box); return; }
                let tag = box.querySelector('.courier-tag');
                if (!tag) {
                    tag = document.createElement('span');
                    tag.className = 'courier-tag ss-packing-own-tag';
                    box.appendChild(tag);
                }
                let annotation = tag.querySelector('.ss-packing-assignee');
                if (!annotation) {
                    annotation = document.createElement('span');
                    annotation.className = 'ss-packing-assignee';
                    tag.appendChild(annotation);
                }
                const courier = Array.from(tag.childNodes).filter(node => node !== annotation).map(node => node.textContent).join('').trim();
                const name = (courier ? ' - ' : '') + owner.name;
                if (annotation.textContent !== name) annotation.textContent = name;
                annotation.title = `Stanowisko ${owner.station} · pierwszy box ${names[0]}` + (snapshot.assignmentMode?.value === 'balanced' && snapshot.owners[names[0]]?.station !== owner.station ? ' · wyrównywanie dużych paczek' : '');
            });
        }
        function poll() {
            if (!onPackingPage() || busy || performance.now() - lastPoll < 15000) return;
            lastPoll = performance.now();
            const token = storageAvailable ? GM_getValue(tokenKey, '') : '';
            if (!/^[a-f0-9]{64}$/.test(token)) { snapshot = null; message = ''; render(); return; }
            busy = true;
            const requestGeneration = ++generation, started = performance.now();
            const failed = reason => {
                if (requestGeneration !== generation) return;
                busy = false; message = reason; render();
            };
            try {
                GM_xmlhttpRequest({
                    method: 'GET', url: panelUrl + '?api=today', anonymous: true,
                    headers: { Authorization: 'Bearer ' + token, 'X-Estila-Packing-Key': token, Accept: 'application/json' }, timeout: 12000,
                    onload(response) {
                        if (requestGeneration !== generation) return;
                        if (response.status === 401 || response.status === 403) {
                            snapshot = null; expires = 0;
                            failed('Duże paczki: brak dostępu. Zainstaluj aktualną wspólną wtyczkę z panelu.'); return;
                        }
                        try {
                            if (response.status !== 200) throw new Error('HTTP');
                            if (response.finalUrl && new URL(response.finalUrl).origin !== new URL(panelUrl).origin) throw new Error('Origin');
                            const data = JSON.parse(response.responseText);
                            if (data.format !== 'estila-packing-v1' || !data.owners || typeof data.owners !== 'object' || Array.isArray(data.owners) || !Number.isFinite(data.serverTime) || !Number.isFinite(data.validUntil) || data.validUntil <= data.serverTime) throw new Error('Format');
                            const entries = Object.entries(data.owners);
                            if (entries.length !== 0 && entries.length !== 60) throw new Error('Incomplete');
                            if (entries.some(([key, owner]) => !/^[A-T][1-3]$/.test(key) || !owner || !Number.isInteger(owner.station) || owner.station < 1 || owner.station > 5 || typeof owner.name !== 'string' || !owner.name.trim() || owner.name.length > 120)) throw new Error('Owners');
                            if (data.packingOwners !== undefined) {
                                const routed = data.packingOwners;
                                if (!routed || Array.isArray(routed) || typeof routed !== 'object' || Object.keys(routed).length !== entries.length || Object.entries(routed).some(([key, owner]) => !Object.hasOwn(data.owners, key) || !owner || !Number.isInteger(owner.station) || owner.station < 1 || owner.station > 5 || typeof owner.name !== 'string' || !owner.name.trim() || owner.name.length > 120)) throw new Error('Packing owners');
                            }
                            snapshot = data;
                            // Ograniczamy ważność również przy utracie sieci i zmianie zegara komputera.
                            expires = started + Math.min(90000, (data.validUntil - data.serverTime) * 1000);
                            busy = false; message = ''; render();
                        } catch { failed('Duże paczki: nie udało się odczytać planu. Sprawdź połączenie z panelem.'); }
                    },
                    onerror() { failed('Duże paczki: panel jest niedostępny. Próbuję ponownie.'); },
                    ontimeout() { failed('Duże paczki: panel nie odpowiedział. Próbuję ponownie.'); }
                });
            } catch { failed('Duże paczki: nie udało się połączyć z panelem.'); }
        }
        function tick() {
            if (snapshot && performance.now() >= expires) {
                snapshot = null; expires = 0; lastPoll = -Infinity;
                message = 'Duże paczki: odświeżam przydział stanowisk.';
            }
            reportPresence(); reportStarts(); render(); poll();
        }
        window.addEventListener('focus', () => { lastPoll = -Infinity; tick(); });
        tick(); setInterval(tick, 1000);
    })();
    // ESTILA PACKING ASSIGNMENTS END

    const SELECTORS = {
        scanInput: 'input.mat-input-element, input[autofocus]',
        batchList: 'app-batch-list',
        csvButton: 'button',
        logsTable: 'mat-table, .logs-table'
    };

    function isBatchPage() {
        return /^\/packing\/batch\/?$/.test(location.pathname);
    }

    function isPackingPage() {
        return location.href.includes('packing-singles') ||
            location.href.includes('packing/batch/packing');
    }

    function isLogsPage() {
        return location.href.includes('/history/logs');
    }

    function findButtonByText(text) {
        return Array.from(document.querySelectorAll('button'))
            .find(button => (button.innerText || '').includes(text));
    }

    // ---------------------------------------------------------------------
    // MODUL 1: pobieranie opisu i wad z Allegro + focus po wydruku etykiety
    // ---------------------------------------------------------------------
    (function allegroDescriptionsModule() {
        const indicator = document.createElement('div');
        indicator.id = 'ss-suite-allegro-indicator';
        indicator.style.cssText = [
            'position:fixed',
            'bottom:10px',
            'left:10px',
            'width:15px',
            'height:15px',
            'border-radius:50%',
            'z-index:999999',
            'box-shadow:0 0 5px rgba(0,0,0,.3)',
            'background:#9e9e9e'
        ].join(';');
        document.body.appendChild(indicator);

        function setIndicator(color, title) {
            indicator.style.backgroundColor = color;
            indicator.title = title;
        }

        function extractAllegroDescription(responseText) {
            const parsed = new DOMParser().parseFromString(responseText, 'text/html');
            let descriptionContainer = null;
            let defectContainer = null;

            for (const heading of parsed.querySelectorAll('h2')) {
                const text = heading.textContent.trim();
                if (text.includes('Opis Produktu')) {
                    descriptionContainer = heading.parentElement;
                } else if (text.includes('Opis Wady')) {
                    defectContainer = heading.parentElement;
                }
            }

            let result = '';
            if (descriptionContainer) {
                result += descriptionContainer.innerHTML;
            }
            if (defectContainer && defectContainer !== descriptionContainer) {
                if (result) {
                    result += "<hr style='margin:15px 0;border:0;border-top:2px dashed #856404;'>";
                }
                result += defectContainer.innerHTML;
            }

            return result || "❌ Nie znaleziono bloku 'Opis Produktu' ani 'Opis Wady' na stronie aukcji.";
        }

        function appendDescription(link, html) {
            const frame = document.createElement('div');
            frame.className = 'ss-suite-allegro-description';
            frame.style.cssText = [
                'margin-top:10px',
                'padding:12px',
                'background:#fff3cd',
                'border:1px solid #ffeeba',
                'border-left:5px solid #856404',
                'font-size:13px',
                'color:#333',
                'max-width:700px',
                'display:block',
                'white-space:normal',
                'border-radius:4px'
            ].join(';');
            frame.innerHTML = html;
            link.parentNode.appendChild(frame);
        }

        function fetchDescriptions() {
            if (!isPackingPage()) {
                setIndicator('#9e9e9e', 'Skrypt uśpiony - to nie jest strona pakowania.');
                return;
            }

            if (!document.body.innerText.includes('PACZKA ZA GRANICE!') &&
                !document.body.innerText.includes('PACZKA ZA GRANICĘ!')) {
                setIndicator('#ffeb3b', 'Brak dopisku PACZKA ZA GRANICĘ! - nie pobieram danych.');
                return;
            }

            setIndicator('#4caf50', 'Pobieranie aktywne (PACZKA ZA GRANICĘ!)');

            document.querySelectorAll('a[href*="allegro.pl/oferta/"]').forEach(link => {
                if (link.dataset.ssSuiteAllegroState) return;
                link.dataset.ssSuiteAllegroState = 'loading';

                const status = document.createElement('div');
                status.className = 'ss-suite-allegro-status';
                status.textContent = ' ✈️ Zagranica: Pobieram dane z Allegro...';
                status.style.cssText = 'color:#007bff;font-size:11px;font-weight:bold;margin-top:5px;';
                link.parentNode.appendChild(status);

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: link.href,
                    onload(response) {
                        if (response.status === 200 || response.status === 404) {
                            status.remove();
                            appendDescription(link, extractAllegroDescription(response.responseText));
                            link.dataset.ssSuiteAllegroState = 'done';
                            return;
                        }

                        status.textContent = ' ❌ Błąd Allegro - wejdź na Allegro, a następnie odśwież StockSell.';
                        status.style.color = 'red';
                        link.dataset.ssSuiteAllegroState = 'error';
                    },
                    onerror() {
                        status.textContent = ' ❌ Błąd Allegro - wejdź na Allegro, a następnie odśwież StockSell.';
                        status.style.color = 'red';
                        link.dataset.ssSuiteAllegroState = 'error';
                    }
                });
            });
        }

        document.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) return;

            const text = button.innerText?.trim() || '';
            if (!text.includes('Wydrukuj ostatnia etykiete') &&
                !text.includes('Wydrukuj ostatnią etykiete') &&
                !text.includes('Wydrukuj ostatnią etykietę')) return;

            const input = document.querySelector(SELECTORS.scanInput);
            if (input) {
                input.focus();
                input.click();
                input.select?.();
            }
            console.log('[StockSell Suite] Kliknięto drukowanie ostatniej etykiety.');
        });

        fetchDescriptions();
        setInterval(fetchDescriptions, 1500);
    })();

    // ---------------------------------------------------------------------
    // MODUL 2: analiza CSV i podsumowanie batchy
    // ---------------------------------------------------------------------
    (function batchSummaryModule() {
        const indicator = document.createElement('div');
        indicator.id = 'ss-suite-batch-indicator';
        indicator.style.cssText = [
            'position:fixed',
            'bottom:10px',
            'right:10px',
            'width:15px',
            'height:15px',
            'border-radius:50%',
            'background:#ffeb3b',
            'z-index:999999'
        ].join(';');
        indicator.title = 'StockSell - Analiza Batchy';
        document.body.appendChild(indicator);

        let globalCsvRemaining = null;
        const defaultZones = ['DOK', 'P0', 'P1', 'P2', 'P3'];

        function updateBatchHeading() {
            let domTotal = 0;
            const listContainer = document.querySelector(SELECTORS.batchList) ||
                document.querySelector('.main-container') || document.body;

            if (listContainer.innerText) {
                const blocks = listContainer.innerText
                    .split(/[\n\t]+/)
                    .map(text => text.trim())
                    .filter(Boolean);

                for (let index = 0; index < blocks.length; index++) {
                    if (!/^Batch\s+\d+$/i.test(blocks[index]) || index + 1 >= blocks.length) continue;
                    const match = blocks[index + 1].match(/^(\d+)/);
                    if (match) domTotal += Number.parseInt(match[1], 10);
                }
            }

            const heading = Array.from(document.querySelectorAll(
                'div, h1, h2, h3, h4, h5, span, p, mat-card-title'
            )).find(element => element.childNodes.length > 0 &&
                element.childNodes[0].nodeType === Node.TEXT_NODE &&
                element.childNodes[0].nodeValue.trim().startsWith('Lista utworzonych batchy:'));

            if (!heading) return;

            let summary = document.getElementById('stocksell-sumy-batchy');
            if (!summary) {
                summary = document.createElement('span');
                summary.id = 'stocksell-sumy-batchy';
                summary.style.cssText = [
                    'margin-left:12px',
                    'padding:3px 8px',
                    'background:#fff3e0',
                    'border:1px solid #ffb74d',
                    'border-radius:5px',
                    'color:#e65100',
                    'font-weight:bold',
                    'font-size:15px',
                    'vertical-align:middle'
                ].join(';');
                heading.appendChild(summary);
            }

            summary.textContent = `Suma - ${domTotal}` +
                (globalCsvRemaining === null ? '' : ` | Zostało do zebrania - ${globalCsvRemaining}`);
        }

        function getSkippedBatchesFromDom() {
            const skipped = new Set();
            const listContainer = document.querySelector(SELECTORS.batchList) ||
                document.querySelector('.main-container') || document.body;
            if (!listContainer.innerText) return skipped;

            const blocks = listContainer.innerText
                .split(/[\n\t]+/)
                .map(text => text.trim())
                .filter(Boolean);

            for (let index = 0; index < blocks.length; index++) {
                const match = blocks[index].match(/^Batch\s+(\d+)$/i);
                if (!match) continue;

                for (let offset = 1; offset <= 6 && index + offset < blocks.length; offset++) {
                    const next = blocks[index + offset].toLowerCase();
                    if (next === 'zakonczony' || next === 'zakończony' || next === 'pakowanie') {
                        skipped.add(match[1]);
                        break;
                    }
                    if (/^Batch\s+\d+$/i.test(blocks[index + offset])) break;
                }
            }
            return skipped;
        }

        function getBatchWord(count) {
            if (count === 1) return 'batch';
            const lastDigit = count % 10;
            const lastTwoDigits = count % 100;
            if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
                return 'batche';
            }
            return 'batchy';
        }

        function appendWorkerTotals(container, totals) {
            const section = document.createElement('section');
            section.id = 'stocksell-worker-totals';
            section.style.cssText = 'border-top:2px solid #e0e0e0;padding-top:15px;';
            const heading = document.createElement('div');
            heading.textContent = '👥 Zebrane łącznie — wszystkie piętra:';
            heading.style.cssText = 'font-size:16px;font-weight:bold;color:#1565c0;margin-bottom:10px;';
            section.appendChild(heading);

            const hint = document.createElement('p');
            hint.style.cssText = 'font-size:13px;color:#546e7a;margin:0 0 12px;';
            hint.textContent = 'Na podstawie pobranego CSV, bez batchy nierozpoczętych. Batch liczony raz na osobę, jeśli zebrała w nim produkty, również gdy zbierała na kilku piętrach. Produkty: liczba pozycji oznaczonych jako spickowane.';
            section.appendChild(hint);

            if (totals.missingColumns.length) {
                const warning = document.createElement('div');
                warning.textContent = `Nie można obliczyć podsumowania: w CSV brakuje kolumn: ${totals.missingColumns.join(', ')}.`;
                warning.style.color = '#9a5300';
                section.appendChild(warning);
            } else {
                const workers = Array.from(totals.workers.values()).sort((a, b) =>
                    a.products - b.products || a.email.localeCompare(b.email, 'pl'));
                if (!workers.length) {
                    const empty = document.createElement('div');
                    empty.textContent = 'Brak spickowanych produktów z przypisaną osobą i batchem w tym CSV.';
                    empty.style.color = '#546e7a';
                    section.appendChild(empty);
                } else {
                    const list = document.createElement('div');
                    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
                    for (const worker of workers) {
                        const row = document.createElement('div');
                        row.className = 'ss-worker-total';
                        row.style.cssText = 'background:#e3f2fd;padding:8px 12px;border-radius:6px;border:1px solid #90caf9;font-size:14px;color:#0d47a1;overflow-wrap:anywhere;';
                        const name = document.createElement('strong');
                        name.className = 'ss-worker-email';
                        name.textContent = worker.email;
                        const batches = document.createElement('span');
                        batches.className = 'ss-worker-batches';
                        batches.textContent = `${worker.batches.size} ${getBatchWord(worker.batches.size)}`;
                        const products = document.createElement('strong');
                        products.className = 'ss-worker-products';
                        products.textContent = `${worker.products} szt.`;
                        row.append(name, document.createTextNode(' — '), batches, document.createTextNode(' | Łącznie produktów: '), products);
                        list.appendChild(row);
                    }
                    section.appendChild(list);
                }
                if (totals.unassigned || totals.unknownStates) {
                    const warning = document.createElement('p');
                    warning.className = 'ss-worker-totals-warning';
                    warning.style.cssText = 'font-size:13px;color:#9a5300;margin:10px 0 0;';
                    warning.textContent = `Nie doliczono: ${totals.unassigned} spickowanych pozycji bez osoby lub batcha; ${totals.unknownStates} pozycji z nierozpoznanym lub pustym stanem.`;
                    section.appendChild(warning);
                }
            }
            container.appendChild(section);
        }

        function renderBatchSummary(grouped, remainingByBatchAndZone, p3BatchesPerWorker, workerTotals) {
            let container = document.getElementById('stocksell-strefy-summary');
            if (!container) {
                const card = document.querySelector('app-batch-list mat-card');
                if (!card) return;

                container = document.createElement('div');
                container.id = 'stocksell-strefy-summary';
                container.style.cssText = [
                    'margin-top:40px',
                    'padding:15px 20px',
                    'background:#f8f9fa',
                    'border:1px solid #dee2e6',
                    'border-top:3px solid #4caf50',
                    'border-radius:8px',
                    'display:flex',
                    'flex-direction:column',
                    'gap:20px'
                ].join(';');
                card.appendChild(container);
            }

            const sortedBatches = Object.keys(grouped)
                .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

            let html = `
                <div style="display:flex;gap:20px;font-size:16px;font-weight:bold;margin-bottom:-5px;border-bottom:2px solid #e0e0e0;padding-bottom:5px">
                    <div style="flex:1;color:#455a64">📊 Rozbicie na strefy (wszystkie aktywne)</div>
                    <div style="flex:1;color:#d32f2f">⏳ Ilość do zebrania (Nie spickowane)</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:15px">`;

            for (const batch of sortedBatches) {
                const total = Object.values(grouped[batch]).reduce((sum, value) => sum + value, 0);
                const remaining = Object.values(remainingByBatchAndZone[batch])
                    .reduce((sum, value) => sum + value, 0);

                html += `
                    <div style="display:flex;gap:20px;width:100%">
                        <div style="flex:1;background:#fff;padding:12px;border:1px solid #cfd8dc;border-radius:6px">
                            <div style="display:flex;justify-content:space-between;margin-bottom:10px">
                                <div style="font-size:14px;font-weight:bold;color:#1976d2">📦 Batch ${batch}</div>
                                <div style="font-size:13px;color:#1976d2;font-weight:bold">Łącznie produktów w batchu: ${total} szt.</div>
                            </div>
                            <div style="display:flex;gap:10px">`;

                for (const [zone, count] of Object.entries(grouped[batch])) {
                    html += `
                        <div style="background:#e3f2fd;padding:8px 16px;border-radius:6px;border:1px solid #2196f3;min-width:60px;text-align:center;flex:1">
                            <div style="font-size:11px;font-weight:600">${zone}</div>
                            <div style="font-size:18px;font-weight:bold;color:#d32f2f">${count}</div>
                        </div>`;
                }

                html += `
                            </div>
                        </div>
                        <div style="flex:1;background:#ffebee;padding:12px;border:1px solid #f44336;border-radius:6px">
                            <div style="display:flex;justify-content:space-between;margin-bottom:10px">
                                <div style="font-size:14px;font-weight:bold;color:#1976d2">📦 Batch ${batch}</div>
                                <div style="font-size:13px;color:#d32f2f;font-weight:bold">Łącznie do zebrania zostało: ${remaining} szt.</div>
                            </div>
                            <div style="display:flex;gap:10px">`;

                for (const [zone, count] of Object.entries(remainingByBatchAndZone[batch])) {
                    html += `
                        <div style="background:#ffcdd2;padding:8px 16px;border-radius:6px;border:1px solid #f44336;min-width:60px;text-align:center;flex:1">
                            <div style="font-size:11px;font-weight:600">${zone}</div>
                            <div style="font-size:18px;font-weight:bold;color:#b71c1c">${count}</div>
                        </div>`;
                }

                html += '</div></div></div>';
            }

            html += `
                </div>
                <div style="margin-top:15px;border-top:2px solid #e0e0e0;padding-top:15px">
                    <div style="font-size:16px;font-weight:bold;color:#2e7d32;margin-bottom:10px">🎯 Zebrane batche na P3:</div>
                    <div style="display:flex;flex-direction:column;gap:8px">`;

            const workers = Object.keys(p3BatchesPerWorker || {});
            if (!workers.length) {
                html += '<div style="font-size:14px;color:#546e7a">Brak zebranych batchy na P3.</div>';
            } else {
                for (const email of workers) {
                    const count = p3BatchesPerWorker[email].size;
                    html += `
                        <div style="background:#e8f5e9;padding:8px 12px;border-radius:6px;border:1px solid #81c784;font-size:14px;color:#1b5e20">
                            <strong>${email}</strong> - ${count} ${getBatchWord(count)}
                        </div>`;
                }
            }

            container.innerHTML = html + '</div></div>';
            appendWorkerTotals(container, workerTotals);
        }

        function parseBatchCsv(text, separator) {
            const rows = [];
            let row = [], cell = '', quoted = false;
            const finishRow = () => {
                row.push(cell.trim());
                if (row.some(value => value !== '')) rows.push(row);
                row = [];
                cell = '';
            };
            for (let index = 0; index < text.length; index++) {
                const char = text[index];
                if (char === '"') {
                    if (quoted && text[index + 1] === '"') {
                        cell += '"';
                        index++;
                    } else if (quoted) {
                        quoted = false;
                    } else if (cell.trim() === '') {
                        // Cudzysłów otwiera cytowane pole tylko na jego początku.
                        quoted = true;
                        cell = '';
                    } else {
                        // Eksport StockSell może zawierać np. 14" w niecytowanym tytule.
                        cell += char;
                    }
                } else if (!quoted && char === separator) {
                    row.push(cell.trim());
                    cell = '';
                } else if (!quoted && (char === '\r' || char === '\n')) {
                    finishRow();
                    if (char === '\r' && text[index + 1] === '\n') index++;
                } else {
                    cell += char;
                }
            }
            if (quoted) return [];
            finishRow();
            return rows;
        }

        function analyzeCsv(csvText) {
            if (typeof csvText !== 'string') return false;

            const cleanText = csvText.replace(/^\uFEFF/, '');
            const separator = cleanText.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
            const rows = parseBatchCsv(cleanText, separator);
            if (!rows.length) return false;
            const headers = rows[0]
                .map(header => header.trim().replace(/["']/g, '').toLowerCase());

            const zoneIndex = headers.findIndex(header => header.includes('strefy') || header.includes('strefa'));
            const batchIndex = headers.findIndex(header => header.includes('numer batcha') || header.includes('batch'));
            const statusIndex = headers.findIndex(header => header.includes('status'));
            const stateIndex = headers.findIndex(header => header.includes('stan'));
            const emailIndex = headers.findIndex(header => header.includes('email'));

            if (zoneIndex === -1 || batchIndex === -1) return false;

            const skippedFromDom = getSkippedBatchesFromDom();
            const grouped = {};
            const remainingByBatchAndZone = {};
            const p3BatchesPerWorker = {};
            const workerTotals = {
                workers: new Map(), unassigned: 0, unknownStates: 0,
                missingColumns: [emailIndex === -1 ? 'Email' : '', stateIndex === -1 ? 'Stan' : '', statusIndex === -1 ? 'Status' : ''].filter(Boolean)
            };
            let remainingCounter = 0;

            for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
                const columns = rows[rowIndex];

                const state = stateIndex !== -1 && columns.length > stateIndex
                    ? columns[stateIndex].trim().toLowerCase()
                    : '';
                if (state.includes('nie spickowany')) remainingCounter++;

                const batch = columns[batchIndex]?.trim();
                const zone = columns[zoneIndex]?.trim();
                const status = statusIndex !== -1 ? (columns[statusIndex] || '').trim().toLowerCase() : '';
                const email = emailIndex !== -1 ? columns[emailIndex]?.trim() : '';
                const notStarted = /\bnie\s*rozpocz/.test(status.replace(/\s+/g, ' '));

                // Sumujemy zebrane pozycje przed filtrowaniem zakonczonych/pakowanych batchy.
                // Brak stanu nie jest potwierdzeniem zebrania produktu.
                if (!workerTotals.missingColumns.length && !notStarted) {
                    const normalizedState = state.replace(/\s+/g, ' ').trim();
                    const picked = /^spickowan[yae](?:$|\s|\()/i.test(normalizedState);
                    const notPicked = /^nie\s*spickowan[yae](?:$|\s|\()/i.test(normalizedState);
                    if (picked) {
                        if (email && batch) {
                            const workerKey = email.toLowerCase();
                            if (!workerTotals.workers.has(workerKey)) {
                                workerTotals.workers.set(workerKey, { email, batches: new Set(), products: 0 });
                            }
                            const worker = workerTotals.workers.get(workerKey);
                            worker.batches.add(batch);
                            worker.products++;
                        } else {
                            workerTotals.unassigned++;
                        }
                    } else if (!notPicked) {
                        workerTotals.unknownStates++;
                    }
                }

                if (zone?.toUpperCase() === 'P3' && email && batch) {
                    const collected = status.includes('zako') ||
                        status.includes('pakowan') ||
                        status.includes('pickowan') ||
                        (status.includes('rozpocz') && !status.includes('nie rozpocz'));
                    if (collected) {
                        if (!p3BatchesPerWorker[email]) p3BatchesPerWorker[email] = new Set();
                        p3BatchesPerWorker[email].add(batch);
                    }
                }

                if (status.includes('zako') || status.includes('pakowan') || skippedFromDom.has(batch)) continue;
                if (!batch) continue;

                if (!grouped[batch]) {
                    grouped[batch] = {};
                    remainingByBatchAndZone[batch] = {};
                    defaultZones.forEach(defaultZone => {
                        grouped[batch][defaultZone] = 0;
                        remainingByBatchAndZone[batch][defaultZone] = 0;
                    });
                }

                if (zone) {
                    if (!(zone in grouped[batch])) {
                        grouped[batch][zone] = 0;
                        remainingByBatchAndZone[batch][zone] = 0;
                    }
                    grouped[batch][zone]++;
                    if (state.includes('nie spickowany')) remainingByBatchAndZone[batch][zone]++;
                }
            }

            globalCsvRemaining = remainingCounter;
            renderBatchSummary(grouped, remainingByBatchAndZone, p3BatchesPerWorker, workerTotals);
            updateBatchHeading();
            return true;
        }

        function showCsvImportStatus(message, failed = false) {
            const button = document.getElementById('btn-awaryjny-csv');
            if (!button) return;
            let status = document.getElementById('ss-batch-csv-status');
            if (!status) {
                status = document.createElement('div');
                status.id = 'ss-batch-csv-status';
                status.setAttribute('role', 'status');
                status.style.cssText = 'font-size:13px;margin-top:8px;';
                button.parentNode.appendChild(status);
            }
            status.textContent = message;
            status.style.color = failed ? '#b71c1c' : '#2e7d32';
        }

        const csvReaders = new Set();
        let csvDownloadHook = null;

        function isCsvCandidate(blob) {
            if (!['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(blob))) return false;
            const type = String(blob.type || '').split(';', 1)[0].trim().toLowerCase();
            if (type === 'application/pdf' || type === 'application/x-pdf' || /\.pdf$/i.test(blob.name || '')) return false;
            // StockSell/browser exports can omit MIME or use a generic download type.
            return ['', 'text/csv', 'application/csv', 'text/plain', 'application/octet-stream',
                'application/vnd.ms-excel', 'text/comma-separated-values'].includes(type);
        }

        function readCsvBlob(blob, manual = false) {
            if (!isBatchPage()) return;
            if (!isCsvCandidate(blob)) {
                if (manual) showCsvImportStatus('Wybierz plik CSV z zawartością batchy. Pliki PDF nie są analizowane.', true);
                return;
            }
            const reader = new FileReader();
            csvReaders.add(reader);
            reader.onloadend = () => csvReaders.delete(reader);
            const reportFailure = () => {
                if (!manual || !isBatchPage()) return;
                globalCsvRemaining = null;
                document.getElementById('stocksell-strefy-summary')?.remove();
                updateBatchHeading();
                showCsvImportStatus('Nie udało się przeliczyć CSV. Sprawdź, czy wybrano plik z zawartością batchy, z kolumnami strefy i numeru batcha, i czy nie jest uszkodzony.', true);
            };
            reader.onload = () => {
                if (!isBatchPage()) return;
                try {
                    if (analyzeCsv(reader.result)) {
                        showCsvImportStatus('CSV przeliczony. Podsumowanie znajduje się pod listą batchy.');
                    } else {
                        reportFailure();
                    }
                } catch (error) {
                    console.warn('[StockSell Suite] Nie udało się przeliczyć CSV.', error);
                    reportFailure();
                }
            };
            reader.onerror = reportFailure;
            reader.readAsText(blob, 'Windows-1250');
        }

        function installCsvDownloadHook() {
            if (!isBatchPage() || csvDownloadHook) return;
            const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const pageUrlApi = pageWindow.URL;
            if (!pageUrlApi?.createObjectURL || pageUrlApi.createObjectURL.__ssSuiteHooked) return;

            const originalCreateObjectURL = pageUrlApi.createObjectURL;
            const hookedCreateObjectURL = function (object) {
                if (isBatchPage() && isCsvCandidate(object)) {
                    try {
                        readCsvBlob(object);
                    } catch (error) {
                        console.warn('[StockSell Suite] Nie udało się odczytać pobieranego CSV.', error);
                    }
                }
                return originalCreateObjectURL.apply(this, arguments);
            };

            Object.defineProperty(hookedCreateObjectURL, '__ssSuiteHooked', { value: true });
            pageUrlApi.createObjectURL = hookedCreateObjectURL;
            csvDownloadHook = { api: pageUrlApi, original: originalCreateObjectURL, hooked: hookedCreateObjectURL };
        }

        function removeCsvDownloadHook() {
            // Do not overwrite a wrapper installed later by another script.
            if (csvDownloadHook && csvDownloadHook.api.createObjectURL === csvDownloadHook.hooked) {
                csvDownloadHook.api.createObjectURL = csvDownloadHook.original;
                csvDownloadHook = null;
            }
            for (const reader of csvReaders) if (reader.readyState === FileReader.LOADING) reader.abort();
            csvReaders.clear();
        }

        function buildBatchInterface() {
            updateBatchHeading();
            if (document.getElementById('btn-awaryjny-csv')) return;

            const csvButton = findButtonByText('CSV');
            if (!csvButton) return;

            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv,text/csv';
            input.style.display = 'none';
            input.addEventListener('change', event => {
                const file = event.target.files?.[0];
                if (!file) return;
                readCsvBlob(file, true);
                event.target.value = '';
            });

            const button = document.createElement('button');
            button.id = 'btn-awaryjny-csv';
            button.type = 'button';
            button.textContent = '📂 Przelicz pobrany plik';
            button.style.cssText = [
                'margin-left:15px',
                'padding:0 16px',
                'height:36px',
                'background:#ff9800',
                'color:#fff',
                'border:none',
                'border-radius:4px',
                'cursor:pointer',
                'font-weight:bold',
                'box-shadow:0 3px 1px -2px rgba(0,0,0,.2),0 2px 2px 0 rgba(0,0,0,.14),0 1px 5px 0 rgba(0,0,0,.12)'
            ].join(';');
            button.addEventListener('click', () => input.click());

            csvButton.parentNode.insertBefore(button, csvButton.nextSibling);
            csvButton.parentNode.insertBefore(input, button.nextSibling);
        }

        function initBatchPage() {
            if (!isBatchPage()) {
                removeCsvDownloadHook();
                indicator.style.backgroundColor = '#9e9e9e';
                indicator.title = 'Analiza batchy uśpiona - inna podstrona.';
                return;
            }

            installCsvDownloadHook();

            const batchList = document.querySelector(SELECTORS.batchList);
            const csvButton = findButtonByText('CSV');
            if (!batchList || !csvButton) {
                indicator.style.backgroundColor = '#ffeb3b';
                indicator.title = 'Oczekiwanie na widok batchy.';
                return;
            }

            indicator.style.backgroundColor = '#4caf50';
            indicator.title = 'Analiza batchy aktywna.';
            buildBatchInterface();
            updateBatchHeading();
        }

        initBatchPage();
        setInterval(initBatchPage, 1000);
    })();

    // ---------------------------------------------------------------------
    // MODUL 3: lepsze boxy batchy
    // ---------------------------------------------------------------------
    (function betterBatchBoxesModule() {
        GM_addStyle(`
            html.ss-suite-boxes-active .grid {
                display:grid !important;
                grid-template-columns:repeat(auto-fill,78px) !important;
                gap:12px !important;
                justify-content:start !important;
            }
            html.ss-suite-boxes-active .box {
                width:78px !important;
                height:78px !important;
                min-width:78px !important;
                min-height:78px !important;
                display:flex !important;
                flex-direction:column !important;
                justify-content:center !important;
                align-items:center !important;
                padding:15px 4px 4px !important;
                box-sizing:border-box !important;
                border-radius:8px !important;
                position:relative !important;
                transition:transform .15s ease !important;
            }
            html.ss-suite-boxes-active .box:hover { transform:scale(1.05); }
            html.ss-suite-boxes-active .box.ss-suite-wide-box {
                grid-column:span 2 !important;
                width:168px !important;
                min-width:168px !important;
            }
            html.ss-suite-boxes-active .courier-tag {
                position:absolute !important;
                top:3px !important;
                right:3px !important;
                font-size:12px !important;
                font-weight:900 !important;
                padding:2px 6px !important;
                border-radius:5px !important;
                background:rgba(0,0,0,.30) !important;
                line-height:1 !important;
                z-index:5 !important;
                letter-spacing:.5px !important;
                text-transform:uppercase !important;
                min-width:24px !important;
                text-align:center !important;
            }
            html.ss-suite-boxes-active .order-name {
                line-height:1 !important;
                text-align:center !important;
                display:flex !important;
                flex-direction:column !important;
                align-items:center !important;
                justify-content:center !important;
                width:100% !important;
                height:100% !important;
            }
            html.ss-suite-boxes-active .batch-prefix {
                font-weight:900 !important;
                font-family:Arial Black,Arial,sans-serif !important;
                opacity:1 !important;
                line-height:1 !important;
                color:#fff !important;
                text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000 !important;
            }
            html.ss-suite-boxes-active .batch-prefix-normal { font-size:14px !important;margin-bottom:5px !important; }
            html.ss-suite-boxes-active .batch-prefix-medium { font-size:14px !important;margin-bottom:3px !important; }
            html.ss-suite-boxes-active .batch-prefix-small { font-size:11px !important;margin-bottom:2px !important; }
            html.ss-suite-boxes-active .batch-suffix {
                display:block !important;
                font-weight:900 !important;
                font-family:Arial Black,Arial,sans-serif !important;
                line-height:1 !important;
                color:#111 !important;
                white-space:nowrap !important;
                text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff !important;
            }
            html.ss-suite-boxes-active .batch-suffix-normal { font-size:34px !important;letter-spacing:1px !important; }
            html.ss-suite-boxes-active .batch-suffix-medium { font-size:24px !important;letter-spacing:.5px !important; }
            html.ss-suite-boxes-active .batch-suffix-small { font-size:16px !important;letter-spacing:0 !important; }
            html.ss-suite-boxes-active .box:not([style*="rgb(255, 204, 0)"]) .batch-suffix {
                color:#fff !important;
                text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000 !important;
            }
        `);

        function stylizeBatches() {
            const labels = document.querySelectorAll('.order-name');
            document.documentElement.classList.toggle('ss-suite-boxes-active', labels.length > 0);

            labels.forEach(label => {
                if (label.querySelector('.batch-prefix')) return;

                const text = label.textContent.replace(/\s+/g, ' ').trim();
                const match = text.match(/^(Batch\s+\d+\s+)(.+)$/i);
                if (!match) return;

                const prefixText = match[1].trim();
                const suffixText = match[2].trim();
                const itemCount = suffixText.split(' ').length;

                let mode = 'normal';
                if (itemCount === 2 || (itemCount === 1 && suffixText.length >= 5)) {
                    mode = 'medium';
                } else if (itemCount >= 3) {
                    mode = 'small';
                }

                const prefix = document.createElement('span');
                prefix.className = `batch-prefix batch-prefix-${mode}`;
                prefix.textContent = prefixText;

                const suffix = document.createElement('span');
                suffix.className = `batch-suffix batch-suffix-${mode}`;
                suffix.textContent = suffixText;

                label.replaceChildren(prefix, suffix);
                label.closest('.box')?.classList.toggle('ss-suite-wide-box', mode !== 'normal');
            });
        }

        let scheduled = false;
        const observer = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                stylizeBatches();
            });
        });

        stylizeBatches();
        observer.observe(document.body, { childList: true, subtree: true });
    })();

    // ---------------------------------------------------------------------
    // MODUL 4: drukowanie pelnych miejsc magazynowych z ofert
    // ---------------------------------------------------------------------
    (function offerLocationsPrintModule() {
        const buttonSelector = '[data-ss-offer-locations-print]';
        const menuSelector = '.mat-menu-panel, .mat-mdc-menu-panel';
        const ignoredTextSelector = `${buttonSelector}, .inline-print-btn, .print-zebra-btn, mat-icon, .mat-icon, .material-icons, .material-icons-outlined, svg, script, style`;
        const locationCollator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });

        function isOffersPage() {
            return /^\/offers(?:\/|$)/.test(location.pathname);
        }

        // Odczyt samych nazw: bez ikon kopiowania i bez sklejania osobnych wierszy.
        function locationText(node) {
            if (node.nodeType === Node.TEXT_NODE) return node.textContent;
            if (node.nodeType !== Node.ELEMENT_NODE || node.matches(ignoredTextSelector)) return ' ';
            const display = getComputedStyle(node).display;
            if (display === 'none' || node.hidden) return ' ';
            if (node.tagName === 'BR') return '\n';
            const text = Array.from(node.childNodes, locationText).join('');
            return /^(block|flex|grid|table-row|table-cell|list-item)$/.test(display) ? `\n${text}\n` : text;
        }

        function readLocations(container) {
            const text = locationText(container).replace(/\bcontent_copy\b/g, ' ');
            // Podkreslenia, kolejne czlony i myslniki sa czescia segmentu.
            const matches = text.match(/[\p{L}\p{N}_.-]+\s*\/\s*[\p{L}\p{N}_.-]+/gu) || [];
            return matches.filter(value => /\p{L}/u.test(value))
                .map(value => value.replace(/\s*\/\s*/, ' / '));
        }

        function readMenuLocations(panel) {
            return Array.from(panel.querySelectorAll('.store-menu-item')).flatMap(readLocations);
        }

        function printLocations(locations) {
            if (!locations.length) return;
            const iframe = document.createElement('iframe');
            iframe.title = 'Lista miejsc magazynowych do wydruku';
            iframe.className = 'ss-offer-locations-print-frame';
            // Ramka musi byc renderowana, aby przegladarka mogla ja wydrukowac.
            iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:100mm;height:150mm;border:0;';
            document.body.appendChild(iframe);
            const printWindow = iframe.contentWindow;
            const doc = printWindow.document;
            doc.open();
            doc.write(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Drukuj miejsca magazynowe</title><style>
                @page { size:100mm 150mm; margin:4mm; }
                * { box-sizing:border-box; }
                body { font-family:Arial,sans-serif; margin:0; color:#000; background:#fff; }
                h1 { margin:0 0 3mm; padding-bottom:2mm; border-bottom:2px solid #000; font-size:22px; text-transform:uppercase; }
                ul { list-style:none; padding:0; margin:0; }
                li { margin-bottom:2mm; font-size:20px; line-height:1.25; font-weight:bold; overflow-wrap:anywhere; break-inside:avoid; }
            </style></head><body><h1>Lista lokacji</h1><ul></ul></body></html>`);
            doc.close();
            const list = doc.querySelector('ul');
            // Sortujemy pelne nazwy tylko na wydruku, z naturalna kolejnoscia liczb.
            for (const location of [...locations].sort(locationCollator.compare)) {
                const item = doc.createElement('li');
                item.textContent = location;
                list.appendChild(item);
            }

            const cleanup = () => iframe.remove();
            // Nie usuwamy ramki po sekundzie: okno druku moze pozostawac otwarte.
            printWindow.addEventListener('afterprint', () => setTimeout(cleanup, 0), { once: true });
            setTimeout(() => {
                try {
                    printWindow.focus();
                    printWindow.print();
                } catch (error) {
                    cleanup();
                    console.error('[StockSell] Nie udalo sie otworzyc wydruku miejsc magazynowych.', error);
                    alert('Nie udało się otworzyć okna drukowania miejsc magazynowych. Spróbuj ponownie.');
                }
            }, 200);
        }

        function addPrintButton(container, menu) {
            const existing = container.querySelector(buttonSelector);
            const locations = menu ? readMenuLocations(container) : readLocations(container);
            if (!locations.length) {
                existing?.remove();
                return;
            }
            // Zastepuje tylko przyciski druku z zalaczonego starego skryptu.
            // Jego osobny panel spisywania segmentow w logach pozostaje niezalezny.
            const legacyClass = menu ? 'print-zebra-btn' : 'inline-print-btn';
            container.querySelectorAll(`.${legacyClass}`).forEach(button => {
                if (!button.matches(buttonSelector)) button.remove();
            });
            if (existing) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = legacyClass;
            button.dataset.ssOfferLocationsPrint = menu ? 'menu' : 'inline';
            button.textContent = menu ? '🖨️ Drukuj listę miejsc' : '🖨️';
            button.title = 'Drukuj pełne miejsca magazynowe';
            button.setAttribute('aria-label', menu ? 'Drukuj listę miejsc magazynowych' : 'Drukuj miejsca magazynowe');
            button.style.cssText = menu
                ? 'display:block;width:calc(100% - 16px);margin:8px;padding:8px;background:#2b2d30;color:#fff;border:1px solid #555;border-radius:4px;cursor:pointer;font-weight:bold;'
                : 'display:inline-block;margin-left:8px;padding:2px 4px;background:#e0e0e0;color:#222;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:16px;';
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (!isOffersPage()) return;
                // Angular moze podmienic dane wewnatrz tej samej komorki.
                printLocations(menu ? readMenuLocations(container) : readLocations(container));
            });
            if (menu) {
                const content = container.querySelector('.mat-menu-content, .mat-mdc-menu-content') || container;
                content.prepend(button);
            } else {
                container.appendChild(button);
            }
        }

        function updatePrintButtons() {
            if (!isOffersPage()) {
                document.querySelectorAll(buttonSelector).forEach(button => button.remove());
                return;
            }
            document.querySelectorAll(menuSelector).forEach(panel => addPrintButton(panel, true));
            document.querySelectorAll('mat-cell, td, .mat-mdc-cell').forEach(cell => {
                if (!cell.closest(menuSelector)) addPrintButton(cell, false);
            });
        }

        updatePrintButtons();
        // Obejmuje wymiane tabeli, stronicowanie i przejscia SPA do/z /offers.
        setInterval(updatePrintButtons, 750);
    })();

    // ---------------------------------------------------------------------
    // MODUL 5: reczna analiza zaladowanych logow
    // ---------------------------------------------------------------------
    (function logsModule() {
        const productCache = {};
        const renderedLists = new Set();

        GM_addStyle(`
            #ss-unpacked-panel{background:#f8f9fa;border:1px solid #dee2e6;border-left:4px solid #f44336;border-radius:4px;padding:15px;margin-bottom:15px}
            .ss-panel-title{font-weight:bold;margin-bottom:10px}
            .ss-batch-buttons{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
            .ss-batch-btn{background:#1976d2;color:#fff;border:none;padding:8px 16px;border-radius:20px;cursor:pointer}
            .ss-batch-btn:hover{opacity:.9}
            .ss-batch-btn.active{background:#0d47a1}
            .ss-batch-btn.disabled{background:#9e9e9e;cursor:default}
            .ss-batch-content{display:none;border:1px solid #bbdefb;background:#fff;padding:10px;margin-bottom:10px;contain:layout}
            .ss-item-row{padding:6px 0;border-bottom:1px solid #eee}
            .ss-order{color:#d32f2f;font-weight:bold;cursor:pointer}
            .ss-table-link{color:#1976d2;font-weight:bold;cursor:pointer}
            #ss-manual-trigger{background:#4caf50;margin:0;display:block;font-weight:bold}
            #ss-unmatched-trigger{background:#7b1fa2;margin:0;display:block;font-weight:bold}
            .ss-log-trigger-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin-bottom:15px}
            .ss-log-trigger-hint{color:#555;font-size:13px;line-height:1.4}
            #ss-unmatched-panel{background:#faf5ff;border:1px solid #e1bee7;border-left:4px solid #7b1fa2;border-radius:4px;padding:15px;margin-bottom:15px}
            #ss-unmatched-panel .ss-unmatched-hint{font-size:13px;color:#555;margin:0 0 12px}
            #ss-unmatched-panel .ss-unmatched-warning{color:#9a5300;font-weight:bold}
            #ss-unpacked-panel .ss-unpacked-product,#ss-unmatched-panel .ss-unmatched-product{display:inline;font-weight:bold;overflow-wrap:anywhere}
            #ss-unmatched-panel .ss-unmatched-box{margin-top:4px;font-weight:bold;color:#4a148c}
            #ss-unmatched-panel .ss-unmatched-more{margin-top:10px}
            #ss-unmatched-panel .ss-order{background:none;border:0;padding:0;text-decoration:underline;font:inherit;font-weight:bold}
        `);

        function openBaseLinker(order) {
            window.open(`https://panel.baselinker.com/orders.php#order:${order}`, '_blank');
        }

        function getLastNumber(text) {
            const matches = text.match(/\d+/g);
            return matches ? matches[matches.length - 1] : '';
        }

        function getLogProductIdentity(text) {
            // Ostatni nawias przed numerem zamowienia; nawiasy w tytule pozostaja czescia nazwy.
            return text.match(/\((\d+)\)\s*(?:zamówienie(?:\s+numer)?\s*:?\s*)?(\d+)\s*$/i);
        }

        function buildBatchContent(batch, items, content) {
            if (renderedLists.has(batch)) return;
            const fragment = document.createDocumentFragment();

            items.forEach(item => {
                const row = document.createElement('div');
                row.className = 'ss-item-row';
                row.append(document.createTextNode(`${item.user} | ${item.segment} | ${item.code} | `));

                const order = document.createElement('span');
                order.className = 'ss-order';
                order.textContent = item.order;
                order.addEventListener('click', () => openBaseLinker(item.order));
                row.appendChild(order);
                const title = document.createElement('span');
                title.className = 'ss-unpacked-product';
                title.textContent = item.name || 'Brak tytułu produktu';
                row.append(document.createTextNode(' | '), title);
                fragment.appendChild(row);
            });

            content.appendChild(fragment);
            renderedLists.add(batch);
        }

        function renderLogsPanel() {
            const grouped = {};
            Object.values(productCache)
                .filter(item => item.hasPick && !item.hasPack)
                .forEach(item => {
                    if (!grouped[item.batch]) grouped[item.batch] = [];
                    grouped[item.batch].push(item);
                });

            const table = document.querySelector('mat-table');
            if (!table) return;

            let panel = document.getElementById('ss-unpacked-panel');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'ss-unpacked-panel';
                table.parentNode.insertBefore(panel, table);
            }
            panel.replaceChildren();

            const title = document.createElement('div');
            title.className = 'ss-panel-title';
            title.textContent = 'Produkty oczekujące na spakowanie';
            panel.appendChild(title);

            const buttonWrapper = document.createElement('div');
            buttonWrapper.className = 'ss-batch-buttons';
            panel.appendChild(buttonWrapper);

            const contentWrapper = document.createElement('div');
            panel.appendChild(contentWrapper);

            Object.keys(grouped).forEach(batch => {
                const items = grouped[batch];
                const canExpand = items.length <= 20;

                const button = document.createElement('button');
                button.type = 'button';
                button.className = canExpand ? 'ss-batch-btn' : 'ss-batch-btn disabled';
                button.textContent = `${batch} (${items.length})`;
                buttonWrapper.appendChild(button);
                if (!canExpand) return;

                const content = document.createElement('div');
                content.className = 'ss-batch-content';
                contentWrapper.appendChild(content);

                button.addEventListener('pointerdown', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                }, true);

                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!renderedLists.has(batch)) buildBatchContent(batch, items, content);

                    const isOpen = content.style.display === 'block';
                    content.style.display = isOpen ? 'none' : 'block';
                    button.classList.toggle('active', !isOpen);
                });
            });
        }

        function analyzeLogs() {
            const table = document.querySelector(SELECTORS.logsTable);
            if (!table) return;

            table.querySelectorAll('mat-row.mat-row:not(.ss-scanned)').forEach(row => {
                const typeColumn = row.querySelector('.mat-column-type');
                const productColumn = row.querySelector('.mat-column-product');
                const batchColumn = row.querySelector('.batch-column, .mat-column-batch');
                const userColumn = row.querySelector('.mat-column-user');
                const elementColumn = row.querySelector('.mat-column-element');

                if (!typeColumn || !productColumn || !batchColumn) {
                    row.classList.add('ss-scanned');
                    return;
                }

                const type = typeColumn.textContent.trim().toLowerCase();
                const productText = productColumn.textContent.replace(/\s+/g, ' ').trim();
                const identity = getLogProductIdentity(productText);
                const order = identity ? identity[2] : getLastNumber(productText);
                const codeMatch = identity || productText.match(/\((\d+)\)/);
                const code = codeMatch ? codeMatch[1] : 'BRAK';
                const name = codeMatch ? productText.slice(0, codeMatch.index).trim() : '';
                const batch = batchColumn.textContent.trim().split('-')[0].trim();
                const id = `${order}_${code}`;

                if (!productCache[id]) {
                    productCache[id] = {
                        hasPick: false,
                        hasPack: false,
                        batch,
                        order,
                        code,
                        name,
                        user: userColumn ? userColumn.textContent.trim() : 'System',
                        segment: elementColumn ? elementColumn.textContent.split('(')[0].trim() : 'Brak'
                    };
                }

                if (!productCache[id].name && name) productCache[id].name = name;
                if (type === 'pick') productCache[id].hasPick = true;
                if (type.includes('start pack')) productCache[id].hasPack = true;

                if (order && !batchColumn.dataset.ssdone) {
                    batchColumn.dataset.ssdone = '1';
                    batchColumn.textContent = `${batch} - ${order}`;
                    batchColumn.classList.add('ss-table-link');
                    batchColumn.addEventListener('click', event => {
                        event.preventDefault();
                        event.stopPropagation();
                        openBaseLinker(order);
                    });
                }

                row.classList.add('ss-scanned');
            });

            renderLogsPanel();
        }

        function resetLogsState() {
            Object.keys(productCache).forEach(key => delete productCache[key]);
            renderedLists.clear();
            document.getElementById('ss-unpacked-panel')?.remove();
            document.querySelectorAll('.ss-scanned').forEach(element => element.classList.remove('ss-scanned'));
        }

        function insertLogTrigger(table, button, hintText) {
            const wrapper = document.createElement('div');
            wrapper.className = 'ss-log-trigger-row';
            const hint = document.createElement('span');
            hint.id = `${button.id}-hint`;
            hint.className = 'ss-log-trigger-hint';
            hint.textContent = hintText;
            button.setAttribute('aria-describedby', hint.id);
            wrapper.append(button, hint);
            table.parentNode.insertBefore(wrapper, table);
        }

        function injectManualTrigger(table) {
            const button = document.createElement('button');
            button.id = 'ss-manual-trigger';
            button.type = 'button';
            button.className = 'ss-batch-btn';
            button.textContent = '📊 Analizuj załadowane logi';
            button.addEventListener('click', event => {
                event.preventDefault();
                resetLogsState();
                analyzeLogs();
            });
            insertLogTrigger(table, button, '- wybierz najpierw logi pick, start pack W i start pack J oraz dzisiejszą datę');
        }

        function readUnmatchedLogs(table) {
            const products = new Map();
            const orderBoxes = new Map();
            const picksPerOrder = new Map();
            let loadedRows = 0;
            let skippedRows = 0;
            let pickRows = 0;
            let matchRows = 0;
            const clean = value => (value || '').replace(/\s+/g, ' ').trim();

            // Czytamy pełną aktualną tabelę przy każdym kliknięciu, także wiersze
            // wcześniej oznaczone przez analizę niespakowanych (.ss-scanned).
            for (const row of table.querySelectorAll('mat-row, tr, .mat-row, .mat-mdc-row')) {
                const type = clean(row.querySelector('.mat-column-type')?.textContent).toLowerCase();
                if (type !== 'pick' && type !== 'match') continue;
                loadedRows++;
                const productText = clean(row.querySelector('.mat-column-product')?.textContent);
                // Kod produktu w ostatnim nawiasie i numer zamówienia za nim.
                // Brak numeru zamówienia nie może zostać pomylony z kodem produktu.
                const identity = getLogProductIdentity(productText);
                // Liczymy wpisy Pick całego zamówienia przed odfiltrowaniem Match.
                // Dwie sztuki tego samego produktu mogą mieć dwa wpisy Pick.
                if (type === 'pick' && identity) {
                    const order = identity[2];
                    picksPerOrder.set(order, (picksPerOrder.get(order) || 0) + 1);
                }
                const batchText = clean(row.querySelector('.batch-column, .mat-column-batch')?.textContent);
                // Stara analiza dodaje " - numer zamówienia" do kolumny Batch.
                const batch = batchText.replace(/\s+-\s+\d+\s*$/, '').trim();
                if (!identity || !batch || /^(?:-|brak)$/i.test(batch)) {
                    skippedRows++;
                    continue;
                }

                const [, code, order] = identity;
                const batchKey = batch.toLowerCase();
                const orderKey = JSON.stringify([batchKey, order]);
                const productKey = JSON.stringify([batchKey, order, code]);
                const element = clean(row.querySelector('.mat-column-element')?.textContent);
                const user = clean(row.querySelector('.mat-column-user')?.textContent) || 'Brak danych';
                if (!products.has(productKey)) {
                    products.set(productKey, {
                        batch, batchKey, order, orderKey, code,
                        name: productText.slice(0, identity.index).trim() || `Produkt ${code}`,
                        hasPick: false, hasMatch: false,
                        pickUsers: new Set(), pickSegments: new Set()
                    });
                }
                const product = products.get(productKey);
                if (type === 'pick') {
                    pickRows++;
                    product.hasPick = true;
                    product.pickUsers.add(user);
                    if (element) product.pickSegments.add(element);
                } else {
                    matchRows++;
                    product.hasMatch = true;
                    const boxName = element.split('(')[0].trim();
                    if (!boxName || /^(?:-|brak)$/i.test(boxName)) continue;
                    if (!orderBoxes.has(orderKey)) orderBoxes.set(orderKey, new Map());
                    const boxes = orderBoxes.get(orderKey);
                    const boxKey = boxName.toLowerCase();
                    if (!boxes.has(boxKey)) boxes.set(boxKey, new Set());
                    // Zachowujemy również zapis w nawiasie dokładnie z kolumny.
                    boxes.get(boxKey).add(element);
                }
            }

            const groups = new Map();
            const excludedSingleOrders = new Set();
            let missingCount = 0;
            for (const product of products.values()) {
                if (!product.hasPick || product.hasMatch) continue;
                if ((picksPerOrder.get(product.order) || 0) <= 1) {
                    excludedSingleOrders.add(product.order);
                    continue;
                }
                product.boxes = orderBoxes.get(product.orderKey) || new Map();
                if (!groups.has(product.batchKey)) groups.set(product.batchKey, { batch: product.batch, items: [] });
                groups.get(product.batchKey).items.push(product);
                missingCount++;
            }
            return { groups, missingCount, loadedRows, skippedRows, pickRows, matchRows, excludedSingleCount: excludedSingleOrders.size };
        }

        function buildUnmatchedProduct(item) {
            const row = document.createElement('div');
            row.className = 'ss-item-row';
            const orderLine = document.createElement('div');
            orderLine.append(document.createTextNode('Zamówienie: '));
            const orderButton = document.createElement('button');
            orderButton.type = 'button';
            orderButton.className = 'ss-order';
            orderButton.textContent = item.order;
            orderButton.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                openBaseLinker(item.order);
            });
            orderLine.appendChild(orderButton);
            row.appendChild(orderLine);

            const pickInfo = document.createElement('div');
            pickInfo.textContent = `Pick: ${Array.from(item.pickUsers).join(', ')} | Segment Pick: ${Array.from(item.pickSegments).join('; ') || 'Brak danych'} | `;
            const title = document.createElement('span');
            title.className = 'ss-unmatched-product';
            title.textContent = `${item.name} (${item.code})`;
            pickInfo.appendChild(title);
            row.appendChild(pickInfo);
            const boxInfo = document.createElement('div');
            boxInfo.className = 'ss-unmatched-box';
            if (item.boxes.size === 0) {
                boxInfo.textContent = 'Box docelowy: Brak danych o boxie — brak wskazania w logach Match tego zamówienia i batcha.';
            } else {
                const labels = Array.from(item.boxes.values(), values => Array.from(values).join(' / '));
                if (item.boxes.size === 1) {
                    boxInfo.textContent = `Box docelowy: ${labels[0]} — na podstawie Match innego produktu z tego zamówienia.`;
                } else {
                    boxInfo.classList.add('ss-unmatched-warning');
                    boxInfo.textContent = `Różne boxy w logach Match: ${labels.join('; ')} — sprawdź ręcznie.`;
                }
            }
            row.appendChild(boxInfo);
            return row;
        }

        function renderUnmatchedPanel(table, result) {
            let panel = document.getElementById('ss-unmatched-panel');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'ss-unmatched-panel';
            }
            table.parentNode.insertBefore(panel, table);
            panel.replaceChildren();
            const title = document.createElement('div');
            title.className = 'ss-panel-title';
            title.textContent = `Produkty niezmatchowane — Pick bez Match (${result.missingCount})`;
            panel.appendChild(title);
            const hint = document.createElement('p');
            hint.className = 'ss-unmatched-hint';
            hint.textContent = 'Analiza obejmuje tylko załadowane logi. Pomijane są zamówienia z jednym wpisem Pick. Box ustalany jest z Match tego samego zamówienia i batcha.';
            panel.appendChild(hint);
            if (result.excludedSingleCount) {
                const excluded = document.createElement('p');
                excluded.className = 'ss-unmatched-hint';
                excluded.textContent = `Pominięte zamówienia z jednym wpisem Pick: ${result.excludedSingleCount}.`;
                panel.appendChild(excluded);
            }
            if (result.skippedRows) {
                const warning = document.createElement('p');
                warning.className = 'ss-unmatched-warning';
                warning.textContent = `Pominięto ${result.skippedRows} wpisów Pick/Match: brak pełnego kodu produktu, numeru zamówienia lub batcha.`;
                panel.appendChild(warning);
            }
            if (result.pickRows && !result.matchRows) {
                const warning = document.createElement('p');
                warning.className = 'ss-unmatched-warning';
                warning.textContent = 'W załadowanej tabeli nie znaleziono odczytywalnych wpisów Match. Sprawdź filtry zdarzeń i zakres dat.';
                panel.appendChild(warning);
            }
            if (!result.groups.size) {
                const empty = document.createElement('p');
                empty.textContent = result.pickRows
                    ? 'W załadowanych logach nie znaleziono produktów Pick bez Match w zamówieniach z co najmniej dwoma wpisami Pick.'
                    : 'Brak odczytywalnych logów Pick. Załaduj właściwe logi i uruchom analizę ponownie.';
                panel.appendChild(empty);
                return;
            }

            const buttonWrapper = document.createElement('div');
            buttonWrapper.className = 'ss-batch-buttons';
            panel.appendChild(buttonWrapper);
            const groups = Array.from(result.groups.values()).sort((a, b) =>
                a.batch.localeCompare(b.batch, 'pl', { numeric: true }));
            for (const group of groups) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'ss-batch-btn';
                button.textContent = `${group.batch} (${group.items.length})`;
                button.setAttribute('aria-expanded', 'false');
                buttonWrapper.appendChild(button);
                const content = document.createElement('div');
                content.className = 'ss-batch-content';
                content.id = `ss-unmatched-list-${buttonWrapper.children.length}`;
                button.setAttribute('aria-controls', content.id);
                panel.appendChild(content);

                // Każdy batch można rozwinąć. Długie listy dokładamy po 100 pozycji.
                let renderedCount = 0;
                const more = document.createElement('button');
                more.type = 'button';
                more.className = 'ss-batch-btn ss-unmatched-more';
                const appendNextPage = () => {
                    more.remove();
                    const fragment = document.createDocumentFragment();
                    const end = Math.min(renderedCount + 100, group.items.length);
                    for (; renderedCount < end; renderedCount++) fragment.appendChild(buildUnmatchedProduct(group.items[renderedCount]));
                    content.appendChild(fragment);
                    if (renderedCount < group.items.length) {
                        more.textContent = `Pokaż kolejne ${Math.min(100, group.items.length - renderedCount)} (pozostało ${group.items.length - renderedCount})`;
                        content.appendChild(more);
                    }
                };
                more.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    appendNextPage();
                });
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!renderedCount) appendNextPage();
                    const isOpen = content.style.display === 'block';
                    content.style.display = isOpen ? 'none' : 'block';
                    button.classList.toggle('active', !isOpen);
                    button.setAttribute('aria-expanded', String(!isOpen));
                });
            }
        }

        function injectUnmatchedTrigger(table) {
            const button = document.createElement('button');
            button.id = 'ss-unmatched-trigger';
            button.type = 'button';
            button.className = 'ss-batch-btn';
            button.textContent = '🔎 Analizuj niezmatchowane';
            button.addEventListener('click', event => {
                event.preventDefault();
                const currentTable = document.querySelector(SELECTORS.logsTable);
                if (currentTable) renderUnmatchedPanel(currentTable, readUnmatchedLogs(currentTable));
            });
            insertLogTrigger(table, button, '- wybierz najpierw logi pick, match, start pack W i start pack J oraz dzisiejszą datę');
        }

        function initLogsPage() {
            if (!isLogsPage()) return;
            const table = document.querySelector(SELECTORS.logsTable);
            if (table && !document.getElementById('ss-manual-trigger')) injectManualTrigger(table);
            if (table && !document.getElementById('ss-unmatched-trigger')) injectUnmatchedTrigger(table);
        }

        initLogsPage();
        setInterval(initLogsPage, 1000);
    })();

    // ---------------------------------------------------------------------
    // MODUŁ 6: etykieta błędu zamówienia 100 x 150 mm z kodem Code 128
    // ---------------------------------------------------------------------
    (function orderErrorLabelModule() {
        const LABEL_VERSION = '1.6.4';
        const CODE_128_PATTERNS = [
            '212222', '222122', '222221', '121223', '121322', '131222',
            '122213', '122312', '132212', '221213', '221312', '231212',
            '112232', '122132', '122231', '113222', '123122', '123221',
            '223211', '221132', '221231', '213212', '223112', '312131',
            '311222', '321122', '321221', '312212', '322112', '322211',
            '212123', '212321', '232121', '111323', '131123', '131321',
            '112313', '132113', '132311', '211313', '231113', '231311',
            '112133', '112331', '132131', '113123', '113321', '133121',
            '313121', '211331', '231131', '213113', '213311', '213131',
            '311123', '311321', '331121', '312113', '312311', '332111',
            '314111', '221411', '431111', '111224', '111422', '121124',
            '121421', '141122', '141221', '112214', '112412', '122114',
            '122411', '142112', '142211', '241211', '221114', '413111',
            '241112', '134111', '111242', '121142', '121241', '114212',
            '124112', '124211', '411212', '421112', '421211', '212141',
            '214121', '412121', '111143', '111341', '131141', '114113',
            '114311', '411113', '411311', '113141', '114131', '311141',
            '411131', '211412', '211214', '211232', '2331112'
        ];

        // Jeden wydruk na okno potwierdzenia; nowe zgłoszenie może mieć ten sam numer.
        const handledConfirmations = new WeakSet();
        const earlyReads = new WeakMap();

        function normalizeText(text) {
            return (text || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[łŁ]/g, 'l')
                .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
        }

        function confirmationScope(component) {
            return component.closest('mat-dialog-container, mat-mdc-dialog-container, [role="dialog"]') || component;
        }

        function readConfirmation(confirmation) {
            // Typ okna jest sprawdzany przez selektor komponentu przy kliknięciu.
            // Odczyt numeru nie zależy od dosłownego brzmienia polskiego komunikatu.
            const copy = confirmation.cloneNode(true);
            copy.querySelectorAll('[data-ss-label-ui], script, style').forEach(element => element.remove());
            const rawText = copy.textContent || '';
            const fields = Array.from(copy.querySelectorAll('.order-number'), field => field.textContent || '');
            const details = { version: LABEL_VERSION, fields, text: rawText.slice(0, 1600), source: '', orderNumber: '', conflict: false };
            const fieldNumbers = new Set();

            for (const field of fields) {
                const value = normalizeText(field).replace(
                    /^(?:nr\.?|numer(?: zamowienia)?|zamowienie(?: numer)?)\s*:?\s*/, ''
                ).replace(/^[#(]\s*|\s*\)$/g, '').replace(/\s/g, '');
                if (/^\d+$/.test(value)) fieldNumbers.add(value);
            }
            if (fieldNumbers.size > 1) return { ...details, conflict: true };
            if (fieldNumbers.size === 1) {
                return { ...details, orderNumber: fieldNumbers.values().next().value, source: 'pole numeru w potwierdzeniu' };
            }

            const text = normalizeText(rawText);
            const matches = [
                ...text.matchAll(/blad\s+w\s+zamowieniu\s*(?:nr\.?\s*)?:?\s*(\d+)/g),
                ...text.matchAll(/zamowienie\s+(?:numer|nr\.?)\s*:?\s*(\d+)/g),
                ...text.matchAll(/zapisz numer zamowienia[^()]{0,200}\(\s*(\d+)\s*\)/g)
            ];
            const labeledNumbers = new Set(matches.map(match => match[1]));
            if (labeledNumbers.size > 1) return { ...details, conflict: true };
            if (labeledNumbers.size === 1) {
                return { ...details, orderNumber: labeledNumbers.values().next().value, source: 'treść potwierdzenia' };
            }

            // W oknie ze zrzutu numer występuje dwa razy. Akceptujemy jeden unikalny
            // numer z tego okna, nigdy kod produktu ani numer z tła strony.
            const numbers = new Set(text.match(/\d+/g) || []);
            if (numbers.size === 1 && /^\d{4,18}$/.test(numbers.values().next().value)) {
                return { ...details, orderNumber: numbers.values().next().value, source: 'jedyny numer w potwierdzeniu' };
            }
            return { ...details, conflict: numbers.size > 1 };
        }

        function showReadFailure(details) {
            const notice = showNotice(
                `Etykieta v${LABEL_VERSION}: ${details.conflict ? 'odczytano różne numery zamówień' : 'nie odczytano numeru zamówienia'}. Rozwiń szczegóły poniżej.`, true
            );
            const disclosure = document.createElement('details');
            disclosure.style.cssText = 'margin-top:10px;font-weight:normal;';
            const summary = document.createElement('summary');
            summary.textContent = 'Pokaż szczegóły odczytu';
            summary.style.cursor = 'pointer';
            const output = document.createElement('pre');
            output.style.cssText = 'white-space:pre-wrap;overflow:auto;max-height:240px;user-select:text;font-size:12px;';
            output.textContent = `Wersja: ${LABEL_VERSION}\nPola numeru: ${JSON.stringify(details.fields)}\nTekst okna:\n${details.text}`;
            disclosure.append(summary, output);
            notice.appendChild(disclosure);
        }

        function updateConfirmationPreviews() {
            const scopes = new Set(Array.from(document.querySelectorAll(
                'app-not-correct-confirmation-box, .not-correct-confirmation-box'
            ), confirmationScope));
            for (const scope of scopes) {
                const details = readConfirmation(scope);
                let preview = scope.querySelector('[data-ss-label-ui="preview"]');
                if (!preview) {
                    preview = document.createElement('div');
                    preview.dataset.ssLabelUi = 'preview';
                    preview.style.cssText = 'margin:10px 0 0;font:12px Arial,sans-serif;';
                    const component = scope.querySelector('app-not-correct-confirmation-box, .not-correct-confirmation-box') || scope;
                    component.appendChild(preview);
                }
                const label = `Etykieta v${LABEL_VERSION}: ${details.orderNumber ? `zamówienie ${details.orderNumber}` : 'numer nieodczytany'}`;
                if (preview.textContent !== label) preview.textContent = label;
                preview.style.color = details.orderNumber ? '#2e7d32' : '#b71c1c';
            }
        }

        function buildCode128Svg(value) {
            const text = String(value).replace(/[^\x20-\x7E]/g, '');
            if (!text) return '';

            const values = Array.from(text, character => character.charCodeAt(0) - 32);
            let checksum = 104;
            values.forEach((code, index) => {
                checksum += code * (index + 1);
            });

            const symbols = [104, ...values, checksum % 103, 106];
            const quietZone = 10;
            let x = quietZone;
            let rectangles = '';

            symbols.forEach(symbol => {
                const pattern = CODE_128_PATTERNS[symbol];
                Array.from(pattern, Number).forEach((width, index) => {
                    if (index % 2 === 0) {
                        rectangles += `<rect x="${x}" y="0" width="${width}" height="64" fill="#000"/>`;
                    }
                    x += width;
                });
            });

            const totalWidth = x + quietZone;
            return `
                <svg class="barcode" viewBox="0 0 ${totalWidth} 64"
                     preserveAspectRatio="none" role="img"
                     aria-label="Kod kreskowy zamówienia ${text}"
                     xmlns="http://www.w3.org/2000/svg">
                    <rect width="100%" height="100%" fill="#fff"/>
                    ${rectangles}
                </svg>`;
        }

        function showNotice(message, isError = false, retry = null) {
            document.getElementById('ss-error-label-notice')?.remove();

            const notice = document.createElement('div');
            notice.id = 'ss-error-label-notice';
            notice.dataset.ssLabelUi = 'notice';
            notice.textContent = message;
            notice.style.cssText = [
                'position:fixed',
                'right:20px',
                'bottom:40px',
                'z-index:1000000',
                'max-width:420px',
                'padding:12px 16px',
                'border-radius:6px',
                'color:#fff',
                `background:${isError ? '#c62828' : '#2e7d32'}`,
                'font:600 14px Arial,sans-serif',
                'box-shadow:0 4px 16px rgba(0,0,0,.3)'
            ].join(';');
            if (retry) {
                const retryButton = document.createElement('button');
                retryButton.type = 'button';
                retryButton.textContent = 'Otwórz etykietę';
                retryButton.style.cssText = 'display:block;margin-top:10px;padding:8px 12px;cursor:pointer;color:#111;background:#fff;border:0;border-radius:4px;font-weight:bold;';
                retryButton.addEventListener('click', () => {
                    notice.remove();
                    retry();
                });
                notice.appendChild(retryButton);
            }
            document.body.appendChild(notice);
            setTimeout(() => notice.remove(), retry || isError ? 60000 : 6000);
            return notice;
        }

        function preparePrintWindow(orderNumber) {
            const printWindow = window.open('', '_blank', 'popup=yes,width=700,height=900');
            if (!printWindow) return null;

            printWindow.document.open();
            printWindow.document.write(`<!doctype html>
                <html lang="pl">
                <head>
                    <meta charset="utf-8">
                    <title>Błąd w zamówieniu ${orderNumber}</title>
                    <style>
                        @page { size: 100mm 150mm; margin: 0; }
                        * { box-sizing: border-box; }
                        html, body {
                            width: 100mm;
                            height: 150mm;
                            margin: 0;
                            padding: 0;
                            background: #fff;
                            color: #000;
                            font-family: Arial, Helvetica, sans-serif;
                        }
                        .label {
                            width: 100mm;
                            height: 150mm;
                            padding: 9mm 7mm;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            overflow: hidden;
                        }
                        .title {
                            width: 100%;
                            margin: 0 0 8mm;
                            padding: 4mm 2mm;
                            border: 1.2mm solid #000;
                            text-align: center;
                            font-size: 8mm;
                            font-weight: 900;
                            line-height: 1.05;
                            letter-spacing: .2mm;
                        }
                        .caption {
                            margin: 0 0 2mm;
                            font-size: 5mm;
                            font-weight: 700;
                            text-transform: uppercase;
                        }
                        .order-number {
                            max-width: 100%;
                            margin: 0 0 7mm;
                            font-size: 13mm;
                            line-height: 1;
                            font-weight: 900;
                            letter-spacing: .4mm;
                            white-space: nowrap;
                        }
                        .barcode {
                            display: block;
                            width: 86mm;
                            height: 42mm;
                            shape-rendering: crispEdges;
                        }
                        .barcode-text {
                            margin-top: 3mm;
                            font-family: Consolas, 'Courier New', monospace;
                            font-size: 6mm;
                            font-weight: 700;
                            letter-spacing: 1mm;
                            white-space: nowrap;
                        }
                        .waiting {
                            position: fixed;
                            inset: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 20mm;
                            text-align: center;
                            font-size: 7mm;
                            font-weight: 700;
                        }
                        @media print {
                            .waiting { display: none !important; }
                        }
                    </style>
                </head>
                <body>
                    <div class="waiting">Przygotowywanie etykiety zamówienia ${orderNumber}…</div>
                </body>
                </html>`);
            printWindow.document.close();
            return printWindow;
        }

        function renderAndPrint(job) {
            const printWindow = job.printWindow;
            if (!printWindow || printWindow.closed) {
                showNotice('Nie można otworzyć wydruku. Zezwól StockSell na wyskakujące okna.', true);
                return;
            }

            printWindow.document.body.innerHTML = `
                <main class="label">
                    <h1 class="title">BŁĄD W ZAMÓWIENIU</h1>
                    <div class="caption">Numer zamówienia</div>
                    <div class="order-number">${job.orderNumber}</div>
                    ${buildCode128Svg(job.orderNumber)}
                    <div class="barcode-text">${job.orderNumber}</div>
                </main>`;

            const closeAfterPrint = () => {
                try {
                    printWindow.close();
                } catch (_error) {
                    // Okno mogło zostać zamknięte ręcznie.
                }
            };
            printWindow.addEventListener('afterprint', closeAfterPrint, { once: true });

            setTimeout(() => {
                if (printWindow.closed) return;
                printWindow.focus();
                printWindow.print();
            }, 300);
        }

        function printConfirmedOrder(orderNumber) {
            try {
                const printWindow = preparePrintWindow(orderNumber);
                if (!printWindow) {
                    showNotice(
                        `Przeglądarka zablokowała etykietę ${orderNumber}. Zezwól StockSell na wyskakujące okna i kliknij poniżej.`,
                        true,
                        () => printConfirmedOrder(orderNumber)
                    );
                    return;
                }

                renderAndPrint({ orderNumber, printWindow });
            } catch (error) {
                console.warn('[StockSell Suite] Nie udało się przygotować etykiety zgłoszenia.', error);
                showNotice(
                    `Nie udało się otworzyć etykiety zamówienia ${orderNumber}.`,
                    true,
                    () => printConfirmedOrder(orderNumber)
                );
            }
        }

        // Faza przechwytywania: odczytujemy okno, zanim StockSell usunie je po OK.
        // Nie blokujemy kliknięcia ani zamknięcia potwierdzenia przez aplikację.
        document.addEventListener('click', event => {
            const button = event.target?.closest?.('button');
            if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
            if (normalizeText(button.textContent) !== 'ok') return;

            const component = button.closest('app-not-correct-confirmation-box') ||
                button.closest('.not-correct-confirmation-box');
            if (!component) return;
            const confirmation = confirmationScope(component);
            if (handledConfirmations.has(confirmation)) return;

            const details = readConfirmation(confirmation);
            const earlier = earlyReads.get(confirmation);
            earlyReads.delete(confirmation);
            const orderNumber = details.orderNumber || (!details.conflict &&
                earlier && Date.now() - earlier.time < 3000 ? earlier.orderNumber : '');
            if (!orderNumber) {
                showReadFailure(details);
                return;
            }

            handledConfirmations.add(confirmation);
            // Otwarcie bezpośrednio podczas kliknięcia OK zachowuje gest użytkownika.
            printConfirmedOrder(orderNumber);
        }, true);

        // Odczyt także na początku kliknięcia, przed ewentualną zmianą treści okna.
        document.addEventListener('pointerdown', event => {
            const button = event.target?.closest?.('button');
            if (!button || normalizeText(button.textContent) !== 'ok') return;
            const component = button.closest('app-not-correct-confirmation-box') || button.closest('.not-correct-confirmation-box');
            if (!component) return;
            const scope = confirmationScope(component);
            const details = readConfirmation(scope);
            earlyReads.delete(scope);
            if (details.orderNumber) earlyReads.set(scope, { orderNumber: details.orderNumber, time: Date.now() });
        }, true);

        let previewScheduled = false;
        new MutationObserver(() => {
            if (previewScheduled) return;
            previewScheduled = true;
            setTimeout(() => {
                previewScheduled = false;
                updateConfirmationPreviews();
            }, 100);
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
        updateConfirmationPreviews();
    })();
})();


// ESTILA OLX LABEL BEGIN
// Independent, read-only addition. No native packing/printing handlers are replaced.
(function estilaOlxLabelModule() {
    'use strict';
    // Tymczasowo wyłączone na prośbę użytkownika; kod zachowany do ponownego włączenia.
    const OLX_LABEL_ENABLED = false;
    if (!OLX_LABEL_ENABLED) return;
    if (window.top !== window.self || document.getElementById('ss-suite-olx-label')) return;
    const origin = 'https://olx.estila.com.pl';
    const paths = new Set(['/packing/batch/packing-singles', '/packing/batch/packing']);
    const panel = document.createElement('section');
    panel.id = 'ss-suite-olx-label';
    panel.setAttribute('aria-label', 'Etykieta OLX bieżącego zamówienia');
    const title = document.createElement('strong');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const print = document.createElement('a');
    print.textContent = 'Drukuj etykietę OLX';
    print.target = '_blank'; print.rel = 'noopener noreferrer'; print.hidden = true;
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = 'Sprawdź ponownie';
    const login = document.createElement('a');
    login.textContent = 'Otwórz aplikację OLX'; login.href = origin + '/';
    login.target = '_blank'; login.rel = 'noopener noreferrer'; login.hidden = true;
    panel.append(title, status, print, retry, login);
    GM_addStyle(`
      #ss-suite-olx-label { position:fixed;right:18px;top:135px;width:258px;max-height:calc(100vh - 160px);overflow:auto;box-sizing:border-box;z-index:10000;padding:15px;border:2px solid #ac285b;border-radius:9px;background:#fff;color:#222;font:14px/1.4 Arial,sans-serif;box-shadow:0 3px 14px #0002; }
      #ss-suite-olx-label strong {display:block;font-size:15px;overflow-wrap:anywhere;}
      #ss-suite-olx-label p {margin:10px 0;}
      #ss-suite-olx-label a,#ss-suite-olx-label button {display:block;box-sizing:border-box;width:100%;margin-top:9px;padding:10px;border-radius:5px;font:600 13px/1.35 Arial,sans-serif;text-align:center;cursor:pointer;text-decoration:none;}
      #ss-suite-olx-label a {background:#ac285b;color:#fff;}
      #ss-suite-olx-label button {border:1px solid #bbb;background:#fff;color:#333;}
      #ss-suite-olx-label [hidden] {display:none!important;}
      @media(max-width:900px) { #ss-suite-olx-label {top:auto;bottom:16px;max-height:45vh;width:230px;} }
      @media print { #ss-suite-olx-label {display:none!important;} }
    `);
    const ignored = 'script,style,noscript,header,nav,aside,app-header,app-sidenav,[role="dialog"],.cdk-overlay-container,app-not-correct-confirmation-box,.not-correct-confirmation-box,[data-ss-label-ui],#ss-error-label-notice,.ss-suite-allegro-description';
    const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/gi, 'l').toUpperCase();
    const basePattern = /^[1-9]\d{5,14}$/;
    const olxPattern = /^[A-Z0-9-]{4,50}$/i;
    function identity() {
        if (!paths.has(location.pathname.replace(/\/$/, ''))) return null;
        const texts = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode, parent = node.parentElement;
            if (!parent || panel.contains(parent) || parent.closest(ignored) || !visible(parent)) continue;
            if (node.textContent.trim()) texts.push(node.textContent.trim());
        }
        const text = normalize(texts.join('\n'));
        const marked = /\b(?:PRZESYLKA|ZAMOWIENIE)\s+OLX\b|\bID\s+OLX\s*:/.test(text);
        const olxIds = [...new Set(Array.from(text.matchAll(/\bID\s+OLX\s*:\s*([A-Z0-9-]{4,50})\b/g), m => m[1]))];
        const baseIds = new Set();
        for (const link of document.querySelectorAll('a[href]')) {
            if (panel.contains(link) || link.closest(ignored) || !visible(link)) continue;
            try {
                const url = new URL(link.href);
                if (url.protocol === 'https:' && url.hostname === 'panel.baselinker.com' && url.pathname === '/orders.php') {
                    const id = url.hash.match(/^#order:([1-9]\d{5,14})$/)?.[1];
                    if (id) baseIds.add(id);
                }
            } catch { /* Not a Base order link. */ }
        }
        const labels = /\b(?:(?:NUMER|NR\.?|ID)\s+ZAMOWIENIA(?:\s+(?:BASE|BASELINKER))?|ZAMOWIENIE(?:\s+(?:NR\.?|BASE|BASELINKER))?|BASE(?:LINKER)?(?:\s*(?:ID|NR\.?))?)\s*[:#]?\s*([1-9]\d{5,14})\b/g;
        for (const match of text.matchAll(labels)) baseIds.add(match[1]);
        for (const el of document.querySelectorAll('.order-number,[data-cy="order-number"],[data-cy="base-order-id"]')) {
            if (!panel.contains(el) && !el.closest(ignored) && visible(el) && basePattern.test(el.textContent.trim())) baseIds.add(el.textContent.trim());
        }
        if (olxIds.length > 1 || baseIds.size > 1) return marked ? {error:'Widoczne są różne numery zamówień. Nie wybrano etykiety.',key:'ambiguous:' + olxIds.join(',') + ':' + [...baseIds].join(',')} : null;
        const olxId = olxIds[0] || '', baseId = [...baseIds][0] || '';
        if (!olxId && !baseId) return marked ? {error:'Nie odczytano numeru Base ani ID OLX bieżącego zamówienia.',key:'missing'} : null;
        return {olxId,baseId,marked,key:olxId + ':' + baseId + ':' + marked};
    }
    let currentKey = '', generation = 0, objectUrl = null, indexCache = null;
    const requests = new Set();
    const current = (g,key) => generation === g && identity()?.key === key;
    function clearFile() {
        print.hidden = true; print.removeAttribute('href');
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
    }
    function abortRequests() { for (const req of requests) req.abort?.(); requests.clear(); }
    function request(url,binary=false) {
        return new Promise((resolve,reject) => {
            let handle;
            const finish = fn => value => { requests.delete(handle); fn(value); };
            handle = GM_xmlhttpRequest({method:'GET',url,timeout:15000,anonymous:false,
                responseType:binary?'arraybuffer':'text',
                onload:finish(response=>{
                    let final;
                    try {final=new URL(response.finalUrl||url);}catch{}
                    if (response.status===401 || response.status===403 || final?.origin!==origin || !final.pathname.startsWith('/api/')) return reject(Error('Zaloguj się do aplikacji OLX na tym stanowisku, a potem sprawdź ponownie.'));
                    if (response.status!==200) return reject(Error('Nie udało się pobrać etykiety z aplikacji OLX. Spróbuj ponownie.'));
                    resolve(response);
                }),
                onerror:finish(()=>reject(Error('Brak połączenia z aplikacją OLX.'))),
                ontimeout:finish(()=>reject(Error('Aplikacja OLX nie odpowiedziała. Spróbuj ponownie.'))),
                onabort:finish(()=>reject(Error('Zmieniono zamówienie.')))
            });
            requests.add(handle);
        });
    }
    function json(response) {
        try {return JSON.parse(response.responseText);}catch{throw Error('Zaloguj się do aplikacji OLX na tym stanowisku, a potem sprawdź ponownie.');}
    }
    async function resolveJob(selected,g) {
        if (selected.olxId) return json(await request(origin+'/api/job?id='+encodeURIComponent(selected.olxId)));
        if (!indexCache || Date.now()-indexCache.time > 30000) {
            const rows = json(await request(origin+'/api/jobs'));
            if (!current(g,selected.key)) return null;
            if (!Array.isArray(rows) || rows.length>200) throw Error('Aplikacja zwróciła niepoprawne powiązania zamówień.');
            // Retain only linkage, never buyer contacts or the raw order list.
            indexCache={time:Date.now(),rows:rows.map(row=>({id:row.id,base_id:row.base_id,state:row.state,has_label:row.has_label}))};
        }
        const matches = indexCache.rows.filter(row=>String(row.base_id)===selected.baseId);
        if (!matches.length) return null;
        if (matches.length!==1 || !olxPattern.test(matches[0].id)) throw Error('Numer Base nie wskazuje jednoznacznie jednego zamówienia OLX.');
        // Read fresh metadata before exposing any file, even with a cached index.
        return json(await request(origin+'/api/job?id='+encodeURIComponent(matches[0].id)));
    }
    async function load(selected,g) {
        retry.disabled=true; login.hidden=true;
        status.textContent='Sprawdzam zamówienie i etykietę…';
        try {
            const job = await resolveJob(selected,g);
            if (!current(g,selected.key)) return;
            if (!job) {
                if (!selected.marked) {panel.remove();return;}
                throw Error('Nie znaleziono tego numeru Base w ostatnich zamówieniach aplikacji OLX. Sprawdź powiązanie w aplikacji.');
            }
            if (!olxPattern.test(job.id) || !basePattern.test(String(job.base_id)) || (selected.olxId && job.id!==selected.olxId) || (selected.baseId && String(job.base_id)!==selected.baseId) || job.state!=='done' || !job.has_label) throw Error('Nie potwierdzono powiązania OLX ↔ Base i gotowej etykiety. Plik nie został wybrany.');
            const response = await request(origin+'/api/job?id='+encodeURIComponent(job.id)+'&action=label',true);
            if (!current(g,selected.key)) return;
            const bytes = new Uint8Array(response.response);
            if (bytes.length<5 || bytes.length>3*1024*1024 || String.fromCharCode(...bytes.slice(0,5))!=='%PDF-') throw Error('Odpowiedź nie zawiera poprawnej etykiety PDF.');
            objectUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
            title.textContent=`Etykieta OLX · Base ${job.base_id}`;
            status.textContent=`ID OLX: ${job.id}. Otwórz PDF i wybierz drukowanie.`;
            print.href=objectUrl; print.hidden=false;
        }catch(error){
            if (current(g,selected.key)) {clearFile();status.textContent=error.message;login.hidden=false;}
        }finally{if(g===generation)retry.disabled=false;}
    }
    function update(force=false) {
        const selected=identity(),key=selected?.key||'';
        if (!force && currentKey===key) return;
        currentKey=key; generation++; abortRequests(); clearFile();
        if (!selected) {panel.remove();return;}
        if (force) indexCache=null;
        if (!panel.isConnected) document.body.append(panel);
        title.textContent=selected.baseId?`Etykieta OLX · Base ${selected.baseId}`:'Etykieta Przesyłki OLX';
        retry.disabled=false;login.hidden=true;
        if(selected.error){status.textContent=selected.error;return;}
        load(selected,generation);
    }
    retry.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();update(true);});
    print.addEventListener('click',event=>{if(identity()?.key!==currentKey || !objectUrl){event.preventDefault();update();}});
    let queued=false;
    new MutationObserver(records=>{
        if(records.every(record=>panel.contains(record.target)))return;
        if((identity()?.key||'')!==currentKey){generation++;abortRequests();currentKey=null;clearFile();panel.remove();}
        if(!queued){queued=true;setTimeout(()=>{queued=false;update();},100);}
    }).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','style','class','href']});
    window.addEventListener('popstate',()=>update());
    setInterval(()=>update(),1000);
    update();
})();
// ESTILA OLX LABEL END

