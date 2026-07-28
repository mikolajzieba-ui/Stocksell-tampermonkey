// ==UserScript==
// @name         BaseLinker Stocksell Printer
// @namespace    stocksell
// @version      2.46
// @match        https://panel.baselinker.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      localhost
// @connect      127.0.0.1
// @connect      allegro.pl
// @connect      a.allegroimg.com
// @downloadURL  https://raw.githubusercontent.com/mikolajzieba-ui/stocksell-scripts/main/Base-Stocksell-Printer.user.js
// @updateURL    https://raw.githubusercontent.com/mikolajzieba-ui/stocksell-scripts/main/Base-Stocksell-Printer.user.js
// ==/UserScript==

(function () {
    'use strict';

    const API_URL = "https://script.google.com/macros/s/AKfycbzQEqxAKjhMQS35zaUQHZ0aE6g9SAsiZyzPxUVnVmAb_U9tpGhjsP3vHZkBoapFhxEJ/exec";

    let printerReady = false;
    let printerType = null; // "zebra" lub "dymo"
    let activeDeviceName = null;
    let zebraDeviceObj = null;
    let printBtn = null;

    const productCache = new Map();
    const marketplaceImageCache = new Map();

    //////////////////////////////////////////////////////
    // CACHE SHEETS
    //////////////////////////////////////////////////////
    function preloadProducts() {
        const CACHE_KEY = "stocksell_products_v1";
        const CACHE_TIME_KEY = "stocksell_products_time";
        const CACHE_TTL = 10 * 60 * 60 * 1000;

        const cachedData = GM_getValue(CACHE_KEY, null);
        const cachedTime = Number(GM_getValue(CACHE_TIME_KEY, 0));

        const isValid = cachedData && cachedTime && (Date.now() - cachedTime < CACHE_TTL);

        if (isValid) {
            try {
                const products = JSON.parse(cachedData);
                products.forEach(product => {
                    productCache.set(String(product.sku), product);
                });
                console.log("Cache from GM_getValue:", productCache.size);
                return;
            } catch {}
        }

        console.log("Downloading fresh cache...");

        GM_xmlhttpRequest({
            method: "GET",
            url: `${API_URL}?all=1`,
            onload: function (res) {
                try {
                    const products = JSON.parse(res.responseText);
                    products.forEach(product => {
                        productCache.set(String(product.sku), product);
                    });

                    GM_setValue(CACHE_KEY, JSON.stringify(products));
                    GM_setValue(CACHE_TIME_KEY, String(Date.now()));

                    console.log("Fresh cache saved to GM storage:", productCache.size);
                } catch (e) {
                    console.error(e);
                }
            }
        });
    }

    //////////////////////////////////////////////////////
    // WYKRYWANIE DRUKARKI (ZEBRA -> FALLBACK DO HTTPS DYMO)
    //////////////////////////////////////////////////////
    function initPrinter() {
        let zebraAttempts = 0;
        const maxZebraAttempts = 1;

        let dymoAttempts = 0;
        const maxDymoAttempts = 10;

        function tryConnectZebra() {
            zebraAttempts++;
            console.log(`[ZEBRA DEBUG] Próba połączenia ${zebraAttempts}/${maxZebraAttempts}`);

            GM_xmlhttpRequest({
                method: "GET",
                url: "http://localhost:9100/available",
                timeout: 2000,
                onload: function (res) {
                    try {
                        const data = JSON.parse(res.responseText);
                        console.log("[ZEBRA DEBUG] Odpowiedź z portu 9100:", data);

                        const printer = data.printer.find(p => p.name && (p.name.includes("ZD411") || p.name.includes("asdasd")));

                        if (!printer) {
                            console.log("[ZEBRA DEBUG] Brak pasującej drukarki Zebra w zwróconym JSON.");
                            throw "No compatible Zebra found";
                        }

                        zebraDeviceObj = printer;
                        activeDeviceName = printer.name;
                        printerType = "zebra";
                        printerReady = true;

                        let shortName = activeDeviceName.split("-")[0].trim();
                        updateButtonReady(shortName);
                        console.log(`[ZEBRA DEBUG] SUKCES! Połączono z Zebrą: ${activeDeviceName}`);
                    } catch (e) {
                        console.log("[ZEBRA DEBUG] Błąd w odczycie lub brak drukarki:", e);
                        tryConnectZebraRetry();
                    }
                },
                onerror: function(err) {
                    console.log("[ZEBRA DEBUG] Błąd sieciowy:", err);
                    tryConnectZebraRetry();
                },
                ontimeout: function() {
                    console.log("[ZEBRA DEBUG] Timeout!");
                    tryConnectZebraRetry();
                }
            });
        }

        function tryConnectZebraRetry() {
            if (printerReady) return;
            if (zebraAttempts >= maxZebraAttempts) {
                console.log("Nie znaleziono Zebry. Sprawdzam DYMO DLS Web Service...");
                tryConnectDymo();
                return;
            }
            setTimeout(tryConnectZebra, 800);
        }

        function tryConnectDymo() {
            dymoAttempts++;
            console.log(`Próba połączenia z DYMO (HTTPS) ${dymoAttempts}/${maxDymoAttempts}`);

            GM_xmlhttpRequest({
                method: "GET",
                url: "https://localhost:41951/DYMO/DLS/Printing/StatusConnected",
                timeout: 1500,
                onload: function (res) {
                    try {
                        if (res.status === 200 && res.responseText.includes("true")) {
                            console.log("Usługa DYMO działa. Pobieram listę podłączonych drukarek...");
                            fetchDymoPrinters();
                        } else {
                            throw "Not ready";
                        }
                    } catch {
                        tryConnectDymoRetry();
                    }
                },
                onerror: function(err) {
                    tryConnectDymoRetry();
                },
                ontimeout: tryConnectDymoRetry
            });
        }

        function fetchDymoPrinters() {
            GM_xmlhttpRequest({
                method: "GET",
                url: "https://localhost:41951/DYMO/DLS/Printing/GetPrinters",
                onload: function(res) {
                    if (res.status === 200) {
                        console.log("[DYMO DEBUG] Lista drukarek od usługi:", res.responseText);
                        let dymoName = null;

                        let cleanText = res.responseText.replace(/^"|"$/g, '');
                        cleanText = cleanText.replace(/\\/g, '');
                        cleanText = cleanText.replace(/&lt;/g, '<').replace(/&gt;/g, '>');

                        const xmlMatch = cleanText.match(/<Name>(.*?)<\/Name>/i);

                        if (xmlMatch && xmlMatch[1]) {
                            dymoName = xmlMatch[1].trim();
                        } else {
                            try {
                                const jsonResponse = JSON.parse(res.responseText);
                                if (jsonResponse && jsonResponse.length > 0 && jsonResponse[0].name) {
                                    dymoName = jsonResponse[0].name.trim();
                                }
                            } catch (e) {}
                        }

                        if (dymoName) {
                            activeDeviceName = dymoName;
                            printerType = "dymo";
                            printerReady = true;
                            updateButtonReady("DYMO " + activeDeviceName);
                            console.log(`[DYMO DEBUG] SUKCES! Połączono z drukarką: ${activeDeviceName}`);
                        } else {
                            console.error("[DYMO DEBUG] Usługa DYMO działa, ale nie wykryto tagu <Name> w odpowiedzi!");
                            tryConnectDymoRetry();
                        }
                    }
                },
                onerror: function() {
                    tryConnectDymoRetry();
                }
            });
        }

        function tryConnectDymoRetry() {
            if (printerReady) return;
            if (dymoAttempts >= maxDymoAttempts) {
                console.error("Nie znaleziono ani Zebry, ani podłączonej drukarki DYMO.");
                if (printBtn) printBtn.innerHTML = "❌ Brak drukarki (Zebra/DYMO)";
                return;
            }
            setTimeout(tryConnectDymo, 1000);
        }

        tryConnectZebra();
    }

    //////////////////////////////////////////////////////
    // WYSYŁANIE WYDRUKU (ZEBRA LUB DYMO)
    //////////////////////////////////////////////////////
    function printLabel(title, code) {
        if (!printerReady) return;

        if (printerType === "zebra") {
            const zpl = createZPL(title, code);
            GM_xmlhttpRequest({
                method: "POST",
                url: "http://localhost:9100/write",
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify({
                    device: zebraDeviceObj,
                    data: zpl
                })
            });
        } else if (printerType === "dymo") {
            const dymoXml = createDymoXml(title, code);

            const payload = "printerName=" + encodeURIComponent(activeDeviceName) +
                            "&printParamsXml=" + encodeURIComponent("") +
                            "&labelSetXml=" + encodeURIComponent("") +
                            "&labelXml=" + encodeURIComponent(dymoXml);

            console.log(`[DYMO DEBUG] Wysyłam polecenie druku do: ${activeDeviceName}`);

            GM_xmlhttpRequest({
                method: "POST",
                url: "https://localhost:41951/DYMO/DLS/Printing/PrintLabel",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                data: payload,
                onload: function(res) {
                    console.log(`[DYMO DEBUG] Status wydruku: ${res.status}`);
                    console.log(`[DYMO DEBUG] Odpowiedź serwera DYMO:`, res.responseText);
                },
                onerror: function(err) {
                    console.error("[DYMO DEBUG] Wystąpił błąd sieciowy podczas próby wydruku:", err);
                }
            });
        }
    }

    //////////////////////////////////////////////////////
    // SZABLONY ETYKIET
    //////////////////////////////////////////////////////
    function createZPL(title, code) {
        const safeTitle = title.replace(/\^/g, "").substring(0, 80);
        const titleHex = toZplHexUtf8(safeTitle);

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

    function createDymoXml(title, code) {
        const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Przełamujemy tytuł na max 3 linie (ok. 38 znaków na linię), używając encji HTML dla nowej linii (&#10;)
        const wrappedTitle = wrapTextForDymo(safeTitle, 38);
        const fCode = formatCode(code);

        return `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Portrait</PaperOrientation>
  <Id>Multipurpose11354</Id>
  <PaperName>11354 Multi-Purpose</PaperName>
  <DrawCommands/>

  <ObjectInfo>
    <TextObject>
      <Name>TITLE</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
      <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>False</IsVariable>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Top</VerticalAlignment>
      <TextFitMode>ShrinkToFit</TextFitMode>
      <UseFullFontHeight>True</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>
        <Element>
          <String>${wrappedTitle}</String>
          <Attributes>
            <Font Family="Arial" Size="11" Bold="True" Italic="False" Underline="False" Strikeout="False" />
            <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
          </Attributes>
        </Element>
      </StyledText>
    </TextObject>
    <Bounds X="100" Y="100" Width="3030" Height="750" />
  </ObjectInfo>

  <ObjectInfo>
    <BarcodeObject>
      <Name>BARCODE</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
      <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>False</IsVariable>
      <Text>${code}</Text>
      <Type>Code128Auto</Type>
      <Size>Medium</Size>
      <TextPosition>None</TextPosition>
      <TextFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False" />
      <CheckSumFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False" />
      <TextEmbedding>None</TextEmbedding>
      <ECLevel>0</ECLevel>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <QuietZonesPadding Left="0" Top="0" Right="0" Bottom="0" />
    </BarcodeObject>
    <Bounds X="100" Y="580" Width="3030" Height="580" />
  </ObjectInfo>

  <ObjectInfo>
    <TextObject>
      <Name>CODE</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
      <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>False</IsVariable>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <TextFitMode>ShrinkToFit</TextFitMode>
      <UseFullFontHeight>True</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>
        <Element>
          <String>${fCode}</String>
          <Attributes>
            <Font Family="Arial" Size="26" Bold="True" Italic="False" Underline="False" Strikeout="False" />
            <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
          </Attributes>
        </Element>
      </StyledText>
    </TextObject>
    <Bounds X="100" Y="1200" Width="3030" Height="400" />
  </ObjectInfo>

</DieCutLabel>`;
    }

    //////////////////////////////////////////////////////
    // BUTTON & STATUS
    //////////////////////////////////////////////////////
    function updateButtonReady(printerName) {
        if (!printBtn) return;
        printBtn.disabled = false;

        let shortName = String(printerName);
        if(shortName.length > 25) shortName = shortName.substring(0, 22) + "...";

        printBtn.innerHTML = `🖨 Drukuj brakujące kody (${shortName})`;
        printBtn.style.background = "#10b981";
    }

    //////////////////////////////////////////////////////
    // HELPERS
    //////////////////////////////////////////////////////
    function extractSku(text) {
        const match = text.match(/\[SKU\s+(.*?)\]/i);
        if (!match) return null;
        return match[1].trim();
    }

    function formatCode(code) {
        return String(code).match(/.{1,3}/g).join(" ");
    }

    function toZplHexUtf8(text) {
        const bytes = new TextEncoder().encode(text);
        return Array.from(bytes).map(b => "_" + b.toString(16).padStart(2, "0").toUpperCase()).join("");
    }

    // Funkcja na twardo wstawiająca nową linię po określonej liczbie znaków (dla DYMO)
    function wrapTextForDymo(text, maxLength) {
        if (!text) return "";
        let words = text.split(' ');
        let lines = [];
        let currentLine = '';

        for(let word of words) {
            if((currentLine + word).length > maxLength) {
                if (currentLine.trim() !== '') lines.push(currentLine.trim());
                currentLine = word + ' ';
            } else {
                currentLine += word + ' ';
            }
        }
        if (currentLine.trim() !== '') lines.push(currentLine.trim());

        // Zwracamy maksymalnie 3 linijki, łącząc je encją nowej linii
        return lines.slice(0, 3).join('&#10;');
    }

    //////////////////////////////////////////////////////
    // PRINT ACTION
    //////////////////////////////////////////////////////
    async function printMissing() {
        if (!printerReady) return;

        const rows = [...document.querySelectorAll("td.td_product_name p")];

        for (const row of rows) {
            const sku = extractSku(row.textContent);
            if (!sku) continue;
            if (sku.includes("stocksell_")) continue;

            const product = productCache.get(sku);
            if (!product) continue;

            printLabel(product.title, product.code);

            row.style.background = "rgba(16,185,129,.2)";
        }
    }

    function addButton() {
        if (document.getElementById("stocksellPrint")) return;

        const header = [...document.querySelectorAll("th")].find(
            el => el.innerText.trim() === "NAZWA PRODUKTU"
        );

        if (!header) return;

        printBtn = document.createElement("button");
        printBtn.id = "stocksellPrint";
        printBtn.disabled = true;
        printBtn.innerHTML = "⏳ Szukanie drukarki (Zebra/DYMO)...";
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
        printBtn.onclick = printMissing;
        header.appendChild(printBtn);

        if (printerReady) {
            let shortName = activeDeviceName || "Drukarka";
            if(printerType === "zebra") shortName = shortName.split("-")[0].trim();
            updateButtonReady((printerType === "zebra" ? "" : "DYMO ") + shortName);
        }
    }

    //////////////////////////////////////////////////////
    // IMAGE ENLARGER (ALLEGRO I ERLI)
    //////////////////////////////////////////////////////
    function initImageEnlarger() {
        if (!document.getElementById("stocksell_large_image_overlay")) {
            const overlay = document.createElement("div");
            overlay.id = "stocksell_large_image_overlay";

            overlay.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 999999;
                display: none;
                background: white;
                padding: 15px;
                border-radius: 12px;
                box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                pointer-events: none;
                min-width: 150px;
                min-height: 150px;
                align-items: center;
                justify-content: center;
            `;

            const loadingText = document.createElement("div");
            loadingText.id = "stocksell_image_loading";
            loadingText.innerText = "⏳ Pobieranie zdjęcia...";
            loadingText.style.cssText = `
                position: absolute;
                font-weight: bold;
                color: #666;
                font-size: 14px;
                z-index: -1;
            `;

            const img = document.createElement("img");
            img.id = "stocksell_large_image";
            img.style.cssText = `
                max-width: 600px;
                max-height: 600px;
                object-fit: contain;
                border-radius: 8px;
                opacity: 0;
                transition: opacity 0.2s;
            `;

            overlay.appendChild(loadingText);
            overlay.appendChild(img);
            document.body.appendChild(overlay);
        }

        const thumbs = document.querySelectorAll("img.img_thumb:not([data-hover-added])");

        thumbs.forEach(thumb => {
            thumb.setAttribute("data-hover-added", "true");

            thumb.addEventListener("mouseenter", function() {
                const tr = this.closest("tr");
                if (!tr) return;

                const linkEl = tr.querySelector('a[href*="allegro.pl/oferta/"], a[href*="code=erli"]');
                if (!linkEl) return;

                const overlay = document.getElementById("stocksell_large_image_overlay");
                const largeImg = document.getElementById("stocksell_large_image");
                const loadingText = document.getElementById("stocksell_image_loading");

                largeImg.onerror = null;
                largeImg.onload = null;
                largeImg.style.opacity = "0";
                largeImg.src = "";
                loadingText.innerText = "⏳ Pobieranie zdjęcia...";
                loadingText.style.display = "block";
                overlay.style.display = "flex";

                const safeThumbUrl = this.getAttribute("data-src") || this.src;

                const applyImage = (primaryUrl) => {
                    largeImg.onerror = function() {
                        if (largeImg.src !== safeThumbUrl) {
                            largeImg.src = safeThumbUrl;
                        } else {
                            loadingText.innerText = "❌ Brak obrazka";
                            largeImg.onerror = null;
                        }
                    };

                    largeImg.onload = function() {
                        largeImg.style.opacity = "1";
                        loadingText.style.display = "none";
                    };

                    largeImg.src = primaryUrl;
                };

                const originalUrl = linkEl.href;
                let fetchUrl = originalUrl;

                if (originalUrl.includes('code=erli')) {
                    const erliIdMatch = originalUrl.match(/outer_item_id=([^&]+)/);
                    const erliId = (erliIdMatch && erliIdMatch[1]) ? erliIdMatch[1] : linkEl.innerText.trim();
                    fetchUrl = `https://allegro.pl/oferta/${erliId}`;
                }

                if (marketplaceImageCache.has(originalUrl)) {
                    applyImage(marketplaceImageCache.get(originalUrl));
                } else {
                    GM_xmlhttpRequest({
                        method: "GET",
                        url: fetchUrl,
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                        },
                        onload: function(res) {
                            let imgUrl = null;
                            const ogMatch = res.responseText.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i);

                            if (ogMatch && ogMatch[1] && !ogMatch[1].includes('empik_logo')) {
                                imgUrl = ogMatch[1];
                                if (imgUrl.includes('allegroimg')) {
                                    imgUrl = imgUrl.replace(/\/s\d+\//, '/original/');
                                }
                            }

                            if (imgUrl) {
                                marketplaceImageCache.set(originalUrl, imgUrl);
                                applyImage(imgUrl);
                            } else {
                                applyImage(safeThumbUrl);
                            }
                        },
                        onerror: function() {
                            applyImage(safeThumbUrl);
                        }
                    });
                }
            });

            thumb.addEventListener("mouseleave", function() {
                const overlay = document.getElementById("stocksell_large_image_overlay");
                if (overlay) {
                    overlay.style.display = "none";
                    const largeImg = document.getElementById("stocksell_large_image");
                    largeImg.onerror = null;
                    largeImg.onload = null;
                }
            });
        });
    }

    //////////////////////////////////////////////////////
    // START
    //////////////////////////////////////////////////////
    preloadProducts();
    initPrinter();
    setInterval(() => {
        addButton();
        initImageEnlarger();
    }, 1000);

})();
