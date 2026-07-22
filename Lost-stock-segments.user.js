// ==UserScript==
// @name         StockSell - Zgubione przy stockowaniu - spisywanie segmentów
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Pobiera segmenty, działa tylko na /history/logs, domyślnie ukryty pod przyciskiem + Opcja drukowania lokacji alfabetycznie (tylko w /offers).
// @author       Twój Nick
// @match        *://*.stocksell.io/*
// @grant        none
// @downloadURL  https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Lost-stock-segments.user.js
// @updateURL    https://github.com/mikolajzieba-ui/Stocksell-tampermonkey/raw/refs/heads/main/Lost-stock-segments.user.js
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================================
    // 1. CZĘŚĆ ORYGINALNA (Nienaruszona - działa na /history/logs)
    // =========================================================================

    // 1. Główny kontener (wrapper)
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        font-family: sans-serif;
        display: none;
    `;
    // 2. Przycisk rozwijania/zwijania (Toggle)
    const toggleBtn = document.createElement('button');
    toggleBtn.innerText = 'Pokaż panel segmentów';
    toggleBtn.style.cssText = `
        padding: 10px 15px;
        background: #4caf50;
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        transition: background 0.3s;
    `;
    // 3. Właściwy panel
    const panel = document.createElement('div');
    panel.style.cssText = `
        display: none;
        background: #2b2d30;
        color: #fff;
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        border: 1px solid #444;
        width: 320px;
        margin-bottom: 10px;
    `;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Kod produktu (np. 857621211)';
    input.style.cssText = `
        width: 100%;
        padding: 8px;
        margin-bottom: 10px;
        border: 1px solid #555;
        border-radius: 4px;
        background: #1e1f22;
        color: #fff;
        box-sizing: border-box;
    `;
    const actionBtn = document.createElement('button');
    actionBtn.innerText = 'Szukaj i skopiuj segmenty';
    actionBtn.style.cssText = `
        width: 100%;
        padding: 8px;
        background: #007bff;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        margin-bottom: 10px;
        transition: background 0.3s;
    `;
    const resultArea = document.createElement('textarea');
    resultArea.style.cssText = `
        width: 100%;
        height: 80px;
        padding: 8px;
        border: 1px solid #555;
        border-radius: 4px;
        background: #1e1f22;
        color: #4caf50;
        box-sizing: border-box;
        resize: none;
        font-family: monospace;
    `;  
    resultArea.readOnly = true;
    resultArea.placeholder = 'Wynik pojawi się tutaj...';

    panel.appendChild(input);
    panel.appendChild(actionBtn);
    panel.appendChild(resultArea);

    wrapper.appendChild(panel);
    wrapper.appendChild(toggleBtn);
    document.body.appendChild(wrapper);

    // 4. Logika zwijania/rozwijania
    let isPanelOpen = false;
    toggleBtn.addEventListener('click', () => {
        isPanelOpen = !isPanelOpen;
        if (isPanelOpen) {
            panel.style.display = 'block';
            toggleBtn.innerText = 'Ukryj panel segmentów';
            toggleBtn.style.background = '#666';
        } else {
            panel.style.display = 'none';
            toggleBtn.innerText = 'Pokaż panel segmentów';
            toggleBtn.style.background = '#4caf50';
        }
    });

    // 5. Sprawdzanie URL co sekundę
    setInterval(() => {
        if (window.location.href.includes('/history/logs')) {
            wrapper.style.display = 'flex';
            wrapper.style.flexDirection = 'column';
            wrapper.style.alignItems = 'flex-end';
        } else {
            wrapper.style.display = 'none';
            isPanelOpen = false;
            panel.style.display = 'none';
            toggleBtn.innerText = 'Pokaż panel segmentów';
            toggleBtn.style.background = '#4caf50';
        }
    }, 1000);

    function getZone(segment) {
        if (!segment) return '';
        return segment.includes('/') ? segment.split('/')[0].trim() : segment;
    }

    // 6. Logika wyszukiwania
    actionBtn.addEventListener('click', () => {
        const targetCode = input.value.trim();
        if (!targetCode) {
            alert('Proszę wpisać kod produktu.');
            return;
        }

        const rows = Array.from(document.querySelectorAll('mat-row'));
        if (rows.length === 0) {
            alert('Nie znaleziono wierszy tabeli. Upewnij się, że dane są załadowane na ekranie.');
            return;
        }

        const rowData = rows.map((row, index) => {
            const productCell = row.querySelector('.cdk-column-product');
            const elementCell = row.querySelector('.cdk-column-element');

            const productText = productCell ? productCell.innerText : '';
            const elementText = elementCell ? elementCell.innerText : '';

            let baseSegment = '';
            if (elementText) {
                baseSegment = elementText.split('_')[0].split('(')[0].trim();
            }

            return { index, productText, baseSegment };
        });

        const targetIndex = rowData.findIndex(data => data.productText.includes(targetCode));

        if (targetIndex === -1) {
            alert('Nie znaleziono produktu o podanym kodzie na aktualnej stronie.');
            return;
        }

        const targetSegment = rowData[targetIndex].baseSegment;
        const targetZone = getZone(targetSegment);

        const collectedBefore = [];
        for (let i = targetIndex - 1; i >= 0; i--) {
            const seg = rowData[i].baseSegment;
            if (!seg) continue;

            const currentZone = getZone(seg);
            if (currentZone !== targetZone) break;

            if (seg !== targetSegment && !collectedBefore.includes(seg)) {
                collectedBefore.push(seg);
            }
        }

        const collectedAfter = [];
        for (let i = targetIndex + 1; i < rowData.length; i++) {
            const seg = rowData[i].baseSegment;
            if (!seg) continue;

            const currentZone = getZone(seg);
            if (currentZone !== targetZone) break;

            if (seg !== targetSegment && !collectedAfter.includes(seg)) {
                collectedAfter.push(seg);
            }
        }

        let availableBefore = collectedBefore.length;
        let availableAfter = collectedAfter.length;

        let takeBefore = Math.min(availableBefore, 10);
        let takeAfter = Math.min(availableAfter, 10);

        let remainingBeforeQuota = 10 - takeBefore;
        let remainingAfterQuota = 10 - takeAfter;

        if (remainingBeforeQuota > 0) {
            takeAfter = Math.min(availableAfter, takeAfter + remainingBeforeQuota);
        } else if (remainingAfterQuota > 0) {
            takeBefore = Math.min(availableBefore, takeBefore + remainingAfterQuota);
        }

        const finalBefore = collectedBefore.slice(0, takeBefore).reverse();
        const finalAfter = collectedAfter.slice(0, takeAfter);

        // Składanie pełnej listy segmentów do jednej tablicy
        const allSegments = [...finalBefore, targetSegment, ...finalAfter];

        let finalResult = '';
        if (allSegments.length > 0) {
            // Pierwszy element zostaje pełny (np. "P2 / A1A1")
            const firstSegment = allSegments[0];

            // Z kolejnych elementów usuwamy strefę (np. "P2 / A1A2" staje się "A1A2")
            const restSegments = allSegments.slice(1).map(seg => {
                return seg.includes('/') ? seg.split('/')[1].trim() : seg;
            });

            // Łączenie wszystkiego przecinkiem
            finalResult = [firstSegment, ...restSegments].join(', ');
        }

        resultArea.value = finalResult;

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(finalResult).then(() => {
                showSuccessState();
            });
        } else {
            resultArea.select();
            document.execCommand('copy');
            showSuccessState();
        }

        function showSuccessState() {
            const originalText = actionBtn.innerText;
            const originalBg = actionBtn.style.background;
            actionBtn.innerText = 'Skopiowano do schowka!';
            actionBtn.style.background = '#28a745';
            setTimeout(() => {
                actionBtn.innerText = originalText;
                actionBtn.style.background = originalBg;
            }, 2000);
        }
    });

    // =========================================================================
    // 2. NOWA CZĘŚĆ: DRUKOWANIE LISTY LOKACJI NA ZEBRZE (działa tylko na /offers)
    // =========================================================================

    // Funkcja tworząca ukrytą ramkę i wysyłająca dane do druku
    function printLocationsToZebra(locations) {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.write('<html><head><title>Drukuj Lokacje</title><style>');
        // Stylizacja przygotowana pod etykieciarkę (wyraźny, duży font bezszeryfowy)
        doc.write(`
            body { 
                font-family: Arial, sans-serif; 
                margin: 0; 
                padding: 10px; 
                font-size: 20px; 
                color: #000;
            }
            h3 { margin: 0 0 10px 0; font-size: 22px; text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 5px; }
            ul { list-style-type: none; padding: 0; margin: 0; }
            li { margin-bottom: 8px; font-weight: bold; }
        `);
        doc.write('</style></head><body>');
        doc.write('<h3>Lista Lokacji</h3><ul>');
        locations.forEach(loc => {
            doc.write('<li>' + loc + '</li>');
        });
        doc.write('</ul></body></html>');
        doc.close();

        // Focus i wywołanie drukowania po wyrenderowaniu
        iframe.contentWindow.focus();
        setTimeout(() => {
            iframe.contentWindow.print();
            // Sprzątanie po wydruku
            setTimeout(() => {
                document.body.removeChild(iframe);
            }, 1000);
        }, 200);
    }

    // Nasłuchiwanie na pojawienie się rozwijanego menu Material Design
    setInterval(() => {
        // Sprawdzenie, czy jesteśmy na podstronie /offers. Jeśli nie, przerywamy sprawdzanie.
        if (!window.location.href.includes('/offers')) {
            return;
        }

        // Szukamy otwartych paneli menu z klasą .mat-menu-panel
        const menuPanels = document.querySelectorAll('.mat-menu-panel');
        
        menuPanels.forEach(panel => {
            // Sprawdzamy, czy menu zawiera elementy lokacji (.store-menu-item) 
            // i czy nie dodaliśmy już do niego naszego przycisku
            if (panel.querySelector('.store-menu-item') && !panel.querySelector('.print-zebra-btn')) {
                
                const printBtn = document.createElement('button');
                printBtn.innerHTML = '🖨️ Drukuj listę (Zebra)';
                printBtn.className = 'print-zebra-btn';
                printBtn.style.cssText = `
                    width: calc(100% - 16px);
                    margin: 8px;
                    padding: 8px;
                    background: #2b2d30;
                    color: #fff;
                    border: 1px solid #555;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    transition: background 0.2s;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    gap: 8px;
                `;
                
                // Efekt hover na przycisku
                printBtn.onmouseover = () => printBtn.style.background = '#444';
                printBtn.onmouseout = () => printBtn.style.background = '#2b2d30';

                printBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Zapobiega natychmiastowemu zamknięciu menu po kliknięciu
                    
                    // Zbieramy teksty lokacji, pozbywając się tekstu ikon "content_copy" z Material Icons
                    const items = Array.from(panel.querySelectorAll('.store-menu-item')).map(item => {
                        let text = item.innerText || item.textContent;
                        return text.replace(/content_copy/g, '').trim();
                    }).filter(text => text !== '');

                    if (items.length > 0) {
                        // SORTOWANIE ALFABETYCZNE (z uwzględnieniem poprawności numerycznej, np. A2 przed A10)
                        items.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

                        printLocationsToZebra(items);
                    }
                });

                // Dodajemy przycisk na samą górę zawartości menu
                const menuContent = panel.querySelector('.mat-menu-content');
                if (menuContent) {
                    menuContent.insertBefore(printBtn, menuContent.firstChild);
                }
            }
        });
    }, 500); // Sprawdzamy co 0.5s czy menu się nie pojawiło
})();
