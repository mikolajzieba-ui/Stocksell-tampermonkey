// ==UserScript==
// @name         BaseLinker Stocksell Printer
// @namespace    stocksell
// @version      2.5
// @match        https://panel.baselinker.com/*
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      localhost
// @downloadURL  https://raw.githubusercontent.com/mikolajzieba-ui/stocksell-scripts/main/Base-Stocksell-Printer.user.js
// @updateURL    https://raw.githubusercontent.com/mikolajzieba-ui/stocksell-scripts/main/Base-Stocksell-Printer.user.js
// ==/UserScript==

(function () {
    'use strict';


    const API_URL =
        "https://script.google.com/macros/s/AKfycbzQEqxAKjhMQS35zaUQHZ0aE6g9SAsiZyzPxUVnVmAb_U9tpGhjsP3vHZkBoapFhxEJ/exec";


    let zebraReady = false;
    let zebraDevice = null;
    let printBtn = null;


    const productCache =
        new Map();



    //////////////////////////////////////////////////////
    // CACHE SHEETS
    //////////////////////////////////////////////////////
    function preloadProducts() {

        const CACHE_KEY =
            "stocksell_products_v1";


        const CACHE_TIME_KEY =
            "stocksell_products_time";


        const CACHE_TTL =
            10 * 60 * 60 * 1000;



        const cachedData =
            localStorage.getItem(
                CACHE_KEY
            );


        const cachedTime =
            Number(
                localStorage.getItem(
                    CACHE_TIME_KEY
                )
            );


        const isValid =
            cachedData &&
            cachedTime &&
            (
                Date.now()
                - cachedTime
                < CACHE_TTL
            );



        if (isValid) {

            try {

                const products =
                    JSON.parse(
                        cachedData
                    );


                products.forEach(
                    product => {

                        productCache.set(

                            String(
                                product.sku
                            ),

                            product

                        );

                    }
                );


                console.log(
                    "Cache from localStorage:",
                    productCache.size
                );


                return;

            } catch {}

        }



        console.log(
            "Downloading fresh cache..."
        );


        GM_xmlhttpRequest({

            method: "GET",

            url:
                `${API_URL}?all=1`,

            onload: function (res) {

                try {

                    const products =
                        JSON.parse(
                            res.responseText
                        );


                    products.forEach(
                        product => {

                            productCache.set(

                                String(
                                    product.sku
                                ),

                                product

                            );

                        }
                    );


                    localStorage.setItem(

                        CACHE_KEY,

                        JSON.stringify(
                            products
                        )

                    );


                    localStorage.setItem(

                        CACHE_TIME_KEY,

                        String(
                            Date.now()
                        )

                    );


                    console.log(
                        "Fresh cache saved:",
                        productCache.size
                    );

                } catch (e) {

                    console.error(
                        e
                    );

                }

            }

        });

    }



    //////////////////////////////////////////////////////
    // ZEBRA
    //////////////////////////////////////////////////////
    function initPrinter() {

        let attempts = 0;


        const maxAttempts = 30;



        function tryConnect() {

            attempts++;


            console.log(
                `Zebra connect attempt ${attempts}/${maxAttempts}`
            );


            GM_xmlhttpRequest({

                method: "GET",

                url:
                    "http://localhost:9100/available",

                timeout: 2000,


                onload: function (res) {

                    try {

                        const data =
                            JSON.parse(
                                res.responseText
                            );


                        const printer =
                            data.printer.find(
                                p =>
                                    p.name &&
                                    p.name.includes(
                                        "ZD411"
                                    )
                            );


                        if (!printer)
                            throw "No printer";


                        zebraDevice =
                            printer;


                        zebraReady =
                            true;


                        updateButtonReady();


                        console.log(
                            "Zebra connected"
                        );

                    } catch {

                        retry();

                    }

                },


                onerror:
                    retry,


                ontimeout:
                    retry

            });

        }



        function retry() {

            if (
                zebraReady
            )
                return;


            if (
                attempts >= maxAttempts
            ) {

                console.error(
                    "Zebra timeout"
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
    // SEND
    //////////////////////////////////////////////////////
    function sendToZebra(zpl) {

        GM_xmlhttpRequest({

            method: "POST",

            url:
                "http://localhost:9100/write",

            headers: {
                "Content-Type":
                    "application/json"
            },

            data:
                JSON.stringify({

                    device:
                        zebraDevice,

                    data:
                        zpl

                })

        });

    }



    //////////////////////////////////////////////////////
    // BUTTON
    //////////////////////////////////////////////////////
    function updateButtonReady() {

        if (!printBtn)
            return;


        printBtn.disabled =
            false;


        printBtn.innerHTML =
            "🖨 Drukuj brakujące kody stocksell";


        printBtn.style.background =
            "#10b981";

    }



    //////////////////////////////////////////////////////
    // HELPERS
    //////////////////////////////////////////////////////
    function extractSku(text) {

        const match =
            text.match(
                /\[SKU\s+(.*?)\]/i
            );


        if (!match)
            return null;


        return match[1]
            .trim();

    }



    function formatCode(code) {

        return String(code)
            .match(/.{1,3}/g)
            .join(" ");

    }



    //////////////////////////////////////////////////////
    // UTF8 -> HEX
    //////////////////////////////////////////////////////
 function toZplHexUtf8(text) {

    const bytes =
        new TextEncoder()
            .encode(
                text
            );


    return Array
        .from(
            bytes
        )
        .map(
            b =>
                "_" +
                b.toString(16)
                    .padStart(
                        2,
                        "0"
                    )
                    .toUpperCase()
        )
        .join("");

}



    //////////////////////////////////////////////////////
    // ZPL
    //////////////////////////////////////////////////////
    function createZPL(title, code) {

        const safeTitle =
            title
                .replace(/\^/g, "")
                .substring(0, 80);


        const titleHex =
            toZplHexUtf8(
                safeTitle
            );


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
    // PRINT
    //////////////////////////////////////////////////////
    async function printMissing() {

        if (!zebraReady)
            return;


        const rows =
            [
                ...document.querySelectorAll(
                    "td.td_product_name p"
                )
            ];


        for (const row of rows) {

            const sku =
                extractSku(
                    row.textContent
                );


            if (!sku)
                continue;


            if (
                sku.includes(
                    "stocksell_"
                )
            )
                continue;


            const product =
                productCache.get(
                    sku
                );


            if (!product)
                continue;


            const zpl =
                createZPL(

                    product.title,

                    product.code

                );


            sendToZebra(
                zpl
            );


            row.style.background =
                "rgba(16,185,129,.2)";

        }

    }



    //////////////////////////////////////////////////////
    // BUTTON
    //////////////////////////////////////////////////////
    function addButton() {

        if (
            document.getElementById(
                "stocksellPrint"
            )
        )
            return;


        const header =
            [
                ...document.querySelectorAll(
                    "th"
                )
            ].find(
                el =>
                    el.innerText.trim() ===
                    "NAZWA PRODUKTU"
            );


        if (!header)
            return;


        printBtn =
            document.createElement(
                "button"
            );


        printBtn.id =
            "stocksellPrint";


        printBtn.disabled =
            true;


        printBtn.innerHTML =
            "⏳ Łączenie z Zebra...";


        printBtn.style.cssText = `
            margin-left:14px;
            padding:10px 18px;
            background:#6b7280;
            color:white;
            border:none;
            border-radius:10px;
            font-size:13px;
            font-weight:700;
            cursor:pointer;
        `;


        printBtn.onclick =
            printMissing;


        header.appendChild(
            printBtn
        );

    }



    //////////////////////////////////////////////////////
    // START
    //////////////////////////////////////////////////////
    preloadProducts();


    initPrinter();


    setInterval(
        addButton,
        1000
    );

})();
