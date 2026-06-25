// ==UserScript==
// @name         StockSell - lepsze batch boxy
// @namespace    http://tampermonkey.net/
// @version      9.3
// @description  Dynamiczne dopasowanie wielkości tekstu do ilości boxów
// @match        https://stocksell.io/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function stylizeBatches() {

        const labels = document.querySelectorAll('.order-name');

        labels.forEach(label => {

            // Zabezpieczenie przed ponowną modyfikacją
            if (label.querySelector('.batch-prefix')) return;

            // Zamieniamy wszelkie ukryte entery i podwójne spacje na pojedynczą spację
            const text = label.textContent.replace(/\s+/g, ' ').trim();
            const match = text.match(/^(Batch\s+\d+\s+)(.+)$/i);

            if (!match) return;

            const prefix = match[1].trim();
            const suffix = match[2].trim();

            // Liczymy ilość poszczególnych boxów w stringu (oddzielonych spacją)
            const itemsCount = suffix.split(' ').length;

            // Decydujemy o trybie wielkości na podstawie ilości elementów
            let mode = 'normal';
            if (itemsCount === 2 || (itemsCount === 1 && suffix.length >= 5)) {
                mode = 'medium'; // Podwójne boxy lub bardzo długi pojedynczy
            } else if (itemsCount >= 3) {
                mode = 'small';  // 3 lub więcej boxów
            }

            label.innerHTML = `
                <span class="batch-prefix batch-prefix-${mode}">
                    ${prefix}
                </span>

                <span class="batch-suffix batch-suffix-${mode}">
                    ${suffix}
                </span>
            `;
        });
    }

    // =========================
    // CSS
    // =========================

    const style = document.createElement('style');

    style.innerHTML = `

        /* =========================
           GRID
        ========================= */

        .grid {
            display: grid !important;
            grid-template-columns: repeat(auto-fill, 78px) !important;
            gap: 12px !important;
            justify-content: start !important;
        }

        /* =========================
           BOX STANDARDOWY
        ========================= */

        .box {
            width: 78px !important;
            height: 78px !important;

            min-width: 78px !important;
            min-height: 78px !important;

            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
            align-items: center !important;

            padding: 15px 4px 4px 4px !important;

            box-sizing: border-box !important;

            border-radius: 8px !important;

            position: relative !important;

            transition: transform 0.15s ease !important;
        }

        .box:hover {
            transform: scale(1.05);
        }

        /* =========================
           SZEROKIE BOXY (DLA 2 LUB WIECEJ NAZW)
        ========================= */

        .box:has(.batch-suffix-medium),
        .box:has(.batch-suffix-small) {
            grid-column: span 2 !important; /* Box zajmuje dwa miejsca w siatce */
            width: 168px !important;        /* 78px + 12px (odstęp) + 78px */
            min-width: 168px !important;
        }

        /* =========================
           GODZINA / BADGE
        ========================= */

        .courier-tag {
            position: absolute !important;

            top: 3px !important;
            right: 3px !important;

            font-size: 12px !important;
            font-weight: 900 !important;

            padding: 2px 6px !important;

            border-radius: 5px !important;

            background: rgba(0,0,0,0.30) !important;

            line-height: 1 !important;

            z-index: 5 !important;

            letter-spacing: 0.5px !important;

            text-transform: uppercase !important;

            min-width: 24px !important;

            text-align: center !important;
        }

        /* =========================
           NAPISY - KONTENER
        ========================= */

        .order-name {
            line-height: 1 !important;
            text-align: center !important;

            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;

            width: 100% !important;
            height: 100% !important;
        }

        /* =========================
           BATCH PREFIX (Góra)
        ========================= */

        .batch-prefix {
            font-weight: 900 !important;
            font-family: Arial Black, Arial, sans-serif !important;
            opacity: 1 !important;
            line-height: 1 !important;
            color: #ffffff !important;

            /* czarna obramówka */
            text-shadow:
                -1px -1px 0 #000,
                 1px -1px 0 #000,
                -1px  1px 0 #000,
                 1px  1px 0 #000 !important;
        }

        .batch-prefix-normal { font-size: 14px !important; margin-bottom: 5px !important; }
        .batch-prefix-medium { font-size: 14px !important; margin-bottom: 3px !important; }
        .batch-prefix-small  { font-size: 11px !important; margin-bottom: 2px !important; }

        /* =========================
           BATCH SUFFIX (Główny tekst)
        ========================= */

        .batch-suffix {
            display: block !important;
            font-weight: 900 !important;
            font-family: Arial Black, Arial, sans-serif !important;
            line-height: 1 !important;
            color: #111 !important;
            white-space: nowrap !important;

            /* biała obramówka dla czarnego tekstu */
            text-shadow:
                -1px -1px 0 #fff,
                 1px -1px 0 #fff,
                -1px  1px 0 #fff,
                 1px  1px 0 #fff !important;
        }

        .batch-suffix-normal { font-size: 34px !important; letter-spacing: 1px !important; }
        .batch-suffix-medium { font-size: 24px !important; letter-spacing: 0.5px !important; }
        .batch-suffix-small  { font-size: 16px !important; letter-spacing: 0px !important; }

        /* =========================
           SZARE / JASNE BOXY - ODWRÓCENIE KOLORÓW
        ========================= */

        .box:not([style*="rgb(255, 204, 0)"]) .batch-suffix {
            color: #ffffff !important;

            /* czarna obramówka dla białego tekstu */
            text-shadow:
                -1px -1px 0 #000,
                 1px -1px 0 #000,
                -1px  1px 0 #000,
                 1px  1px 0 #000 !important;
        }

    `;

    document.head.appendChild(style);

    // pierwsze uruchomienie
    stylizeBatches();

    // obserwacja zmian DOM
    const observer = new MutationObserver(() => {
        stylizeBatches();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
