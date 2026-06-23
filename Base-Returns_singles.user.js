// ==UserScript==
// @name         Base Zwroty jednosztukowe
// @namespace    stocksell
// @version      1.0
// @match        https://panel.baselinker.com/orders_returns*
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      localhost
// @downloadURL  https://raw.githubusercontent.com/mikolajzieba-ui/stocksell-scripts/main/Base-returns-singles.user.js
// @updateURL    https://raw.githubusercontent.com/mikolajzieba-ui/stocksell-scripts/main/Base-returns-singles.user.js
// ==/UserScript==

(function () {
    'use strict';

    const API_URL =
        "https://script.google.com/macros/s/AKfycbzQEqxAKjhMQS35zaUQHZ0aE6g9SAsiZyzPxUVnVmAb_U9tpGhjsP3vHZkBoapFhxEJ/exec";

    const productCache = new Map();

    let zebraReady = false;
    let zebraDevice = null;
    let lastOrderId = null;

    //////////////////////////////////////////////////////
    // CACHE
    //////////////////////////////////////////////////////

    function preloadProducts() {

        const CACHE_KEY = "stocksell_products_v1";
        const CACHE_TIME_KEY = "stocksell_products_time";
        const CACHE_TTL = 10 * 60 * 60 * 1000;

        const cachedData = localStorage.getItem(CACHE_KEY);
        const cachedTime = Number(localStorage.getItem(CACHE_TIME_KEY));

        if (
            cachedData &&
            cachedTime &&
            (Date.now() - cachedTime < CACHE_TTL)
        ) {
            try {

                const products = JSON.parse(cachedData);

                products.forEach(product => {
                    productCache.set(
                        String(product.sku).trim(),
                        product
                    );
                });

                console.log(
                    "[ReturnsPrinter] Cache loaded:",
                    productCache.size
                );

                return;

            } catch (e) {
                console.error(e);
            }
        }

        console.log("[ReturnsPrinter] Downloading cache...");

        GM_xmlhttpRequest({

            method: "GET",

            url: `${API_URL}?all=1`,

            onload: function (res) {

                try {

                    const products =
                        JSON.parse(res.responseText);

                    products.forEach(product => {

                        productCache.set(
                            String(product.sku).trim(),
                            product
                        );

                    });

                    localStorage.setItem(
                        CACHE_KEY,
                        JSON.stringify(products)
                    );

                    localStorage.setItem(
                        CACHE_TIME_KEY,
                        String(Date.now())
                    );

                    console.log(
                        "[ReturnsPrinter] Cache downloaded:",
                        productCache.size
                    );

                } catch (e) {

                    console.error(e);

                }
            }
        });
    }

    //////////////////////////////////////////////////////
    // ZEBRA
    //////////////////////////////////////////////////////

    function initPrinter() {

        let attempts = 0;

        function tryConnect() {

            attempts++;

            GM_xmlhttpRequest({

                method: "GET",

                url: "http://localhost:9100/available",

                timeout: 2000,

                onload: function (res) {

                    try {

                        const data =
                            JSON.parse(res.responseText);

                        const printer =
                            data.printer.find(
                                p =>
                                    p.name &&
                                    (
                                        p.name.includes("ZD420") ||
                                        p.name.includes("ZD411") ||
                                        p.name.includes("GK420")
                                    )
                            );

                        if (!printer)
                            throw "No printer";

                        zebraDevice = printer;
                        zebraReady = true;

                        console.log(
                            "[ReturnsPrinter] Zebra connected:",
                            printer.name
                        );

                    } catch {

                        retry();

                    }

                },

                onerror: retry,
                ontimeout: retry

            });

        }

        function retry() {

            if (zebraReady)
                return;

            if (attempts >= 30) {

                console.error(
                    "[ReturnsPrinter] Zebra not found"
                );

                return;
            }

            setTimeout(
                tryConnect,
                1000
            );
        }

        tryConnect();
    }

    //////////////////////////////////////////////////////
    // PRINT
    //////////////////////////////////////////////////////

    function sendToZebra(zpl) {

    GM_xmlhttpRequest({

        method: "POST",

        url: "http://localhost:9100/write",

        headers: {
            "Content-Type": "application/json"
        },

        data: JSON.stringify({
            device: zebraDevice,
            data: zpl
        }),

        onload: function(res) {

            console.log(
                "[ReturnsPrinter] Zebra response:",
                res.status,
                res.responseText
            );

        },

        onerror: function(err) {

            console.error(
                "[ReturnsPrinter] Zebra error:",
                err
            );

        }

    });

}

    function formatCode(code) {

        return String(code)
            .match(/.{1,3}/g)
            .join(" ");
    }

    function toZplHexUtf8(text) {

        const bytes =
            new TextEncoder().encode(text);

        return Array
            .from(bytes)
            .map(
                b =>
                    "_" +
                    b.toString(16)
                        .padStart(2, "0")
                        .toUpperCase()
            )
            .join("");
    }

    function createZPL(title, code) {

        const safeTitle =
            title
                .replace(/\^/g, "")
                .substring(0, 80);

        const titleHex =
            toZplHexUtf8(safeTitle);

        return `
^XA
^CI28
^PW456
^LL256
^LH0,0

^FO20,70
^A@N,18,18,E:TT0003M_.FNT
^FB416,2,0,C,0
^FH^FD${titleHex}^FS

^FO20,130
^BY3.0,2,100
^BCN,85,N,N,N
^FD${code}^FS

^FO55,225
^A0N,72,72
^FD${formatCode(code)}^FS

^XZ
`;
    }

//////////////////////////////////////////////////////
// RETURN PROCESSING
//////////////////////////////////////////////////////

function processReturn() {

    if (!zebraReady){
        return;
    }
   //////////////////////////////////////////////////////
// POMIŃ ZWROTY DO WERYFIKACJI
//////////////////////////////////////////////////////

const modalText =
    document.body.innerText.toLowerCase();

if (
    modalText.includes('odłóż do weryfikacji')
    ||
    modalText.includes('zamówienie jest wielosztukowe')
) {
    console.log(
        '[ReturnsPrinter] Warning detected - skipped'
);

    return;
}

//////////////////////////////////////////////////////
// SKU
//////////////////////////////////////////////////////

const skuElements =
    [...document.querySelectorAll(".product-info-text")]
    .filter(
        el =>
            el.textContent.includes("SKU:")
    );

// drukuj tylko gdy jest dokładnie 1 SKU
if (skuElements.length !== 1) {

    console.log(
        "[ReturnsPrinter] Ignored. SKU count:",
        skuElements.length
    );

    return;
}

const skuText =
    skuElements[0].textContent;

// wyciągnij wszystko pomiędzy "SKU:" a "| Przyjmij do:"
const sku =
    skuText
        .replace(/^SKU:\s*/i, '')
        .split('|')[0]
        .trim();

if (!sku) {

    console.warn(
        "[ReturnsPrinter] Cannot parse SKU:",
        skuText
    );

    return;
}

console.log(
    "[ReturnsPrinter] SKU:",
    sku
);

    //////////////////////////////////////////////////////
    // POMIŃ STOCKSELL
    //////////////////////////////////////////////////////

    if (
        sku.toLowerCase()
            .includes("stocksell")
    ) {

        console.log(
            "[ReturnsPrinter] Stocksell SKU - skipped"
        );

        return;
    }

    //////////////////////////////////////////////////////
    // SZUKAJ W CACHE
    //////////////////////////////////////////////////////

    const product =
        productCache.get(sku);

    if (!product) {

        console.warn(
            "[ReturnsPrinter] SKU not found:",
            sku
        );

        return;
    }

    //////////////////////////////////////////////////////
    // DRUKUJ
    //////////////////////////////////////////////////////

    const zpl =
        createZPL(
            product.title,
            product.code
        );

    sendToZebra(zpl);

    console.log(
        "[ReturnsPrinter] Printed:",
        sku
    );
}

//////////////////////////////////////////////////////
// WATCHER
//////////////////////////////////////////////////////

function watchReturns() {

    setInterval(() => {

        const orderLink =
            document.querySelector(
                '.pick_pack_sale_detail_info a[href*="orders.php"]'
            );

        if (!orderLink) {
            return;
        }
        const orderId =
            orderLink.textContent.trim();

        if (!orderId) {
            return;
        }
        if (orderId === lastOrderId) {
            return;
        }
        lastOrderId = orderId;

        console.log(
            "[ReturnsPrinter] New return:",
            orderId
        );

        setTimeout(
            processReturn,
            1500
        );

    }, 500);

}

//////////////////////////////////////////////////////
// START
//////////////////////////////////////////////////////

preloadProducts();
initPrinter();
watchReturns();

})();
