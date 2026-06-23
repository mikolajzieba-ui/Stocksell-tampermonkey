// ==UserScript==
// @name         Pobieranie opisu z Allegro dla StockSell
// @namespace    http://tampermonkey.net/
// @version      10.3
// @description  Czysty Opis + Wady
// @match        *://*.stocksell.io/*
// @match        *://stocksell.io/*
// @grant        GM_xmlhttpRequest
// @connect      allegro.pl
//
// @downloadURL  https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/stocksell-opis-z-allegro.user.js
// @updateURL    https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/stocksell-opis-z-allegro.user.js
//
// ==/UserScript==
(function() {
    'use strict';

    // WIZUALNY WSKAŹNIK STATUSU
    let wskaznik = document.createElement('div');
    wskaznik.style.position = 'fixed';
    wskaznik.style.bottom = '10px';
    wskaznik.style.left = '10px';
    wskaznik.style.width = '15px';
    wskaznik.style.height = '15px';
    wskaznik.style.borderRadius = '50%';
    wskaznik.style.zIndex = '999999';
    wskaznik.style.boxShadow = '0 0 5px rgba(0,0,0,0.3)';
    document.body.appendChild(wskaznik);

    function pobierzOpisyZAllegro() {
        // 1. SPRAWDZENIE ADRESU URL
        let obecnyAdres = window.location.href;
        let toJednosztuki = obecnyAdres.includes("packing-singles");
        let toWielosztuki = obecnyAdres.includes("packing/batch/packing");

        if (!toJednosztuki && !toWielosztuki) {
            wskaznik.style.backgroundColor = 'gray';
            wskaznik.title = 'Skrypt uśpiony - to nie jest strona pakowania.';
            return;
        }

        // 2. WARUNEK ZAGRANICY
        let czyZagranica = document.body.innerText.includes("PACZKA ZA GRANICĘ!");
        if (!czyZagranica) {
            wskaznik.style.backgroundColor = '#ffeb3b'; // Żółty
            wskaznik.title = 'Brak dopisku PACZKA ZA GRANICĘ! - nie pobieram danych.';
            return;
        }

        wskaznik.style.backgroundColor = '#4CAF50'; // Zielony
        wskaznik.title = 'Pobieranie aktywne (PACZKA ZA GRANICĘ!)';

        // 3. SZUKANIE LINKÓW DO ALLEGRO
        let linki = document.querySelectorAll('a[href*="allegro.pl/oferta/"]');

        linki.forEach(link => {
            if (link.dataset.opisPobrany) return;
            link.dataset.opisPobrany = "true";

            let urlAllegro = link.href;

            let status = document.createElement('div');
            status.innerText = " ✈️ Zagranica: Pobieram dane z Allegro...";
            status.style.color = "#007bff";
            status.style.fontSize = "11px";
            status.style.fontWeight = "bold";
            status.style.marginTop = "5px";
            link.parentNode.appendChild(status);

            GM_xmlhttpRequest({
                method: "GET",
                url: urlAllegro,
                onload: function(response) {
                    // Akceptujemy status 200 (OK) oraz 404 (Archiwalna)
                    if (response.status === 200 || response.status === 404) {
                        let parser = new DOMParser();
                        let doc = parser.parseFromString(response.responseText, "text/html");

                        let naglowkiH2 = doc.querySelectorAll('h2');
                        let kontenerOpisu = null;
                        let kontenerWady = null;

                        // Skanowanie nagłówków w poszukiwaniu treści
                        for (let h2 of naglowkiH2) {
                            let tekstH2 = h2.textContent.trim();
                            if (tekstH2.includes("Opis Produktu")) {
                                kontenerOpisu = h2.parentElement;
                            } else if (tekstH2.includes("Opis Wady")) {
                                kontenerWady = h2.parentElement;
                            }
                        }

                        let koncowyTekst = "";

                        if (kontenerOpisu) {
                            koncowyTekst += kontenerOpisu.innerHTML;
                        }

                        if (kontenerWady) {
                            if (kontenerWady !== kontenerOpisu) {
                                if (koncowyTekst !== "") {
                                    koncowyTekst += "<hr style='margin: 15px 0; border: 0; border-top: 2px dashed #856404;'>";
                                }
                                koncowyTekst += kontenerWady.innerHTML;
                            }
                        }

                        if (koncowyTekst === "") {
                            koncowyTekst = "❌ Nie znaleziono bloku 'Opis Produktu' ani 'Opis Wady' na stronie aukcji.";
                        }

                        status.remove();

                        let ramkaNaOpis = document.createElement('div');
                        ramkaNaOpis.style.marginTop = "10px";
                        ramkaNaOpis.style.padding = "12px";
                        ramkaNaOpis.style.backgroundColor = "#fff3cd"; // Żółtawe tło dla zagranicy
                        ramkaNaOpis.style.border = "1px solid #ffeeba";
                        ramkaNaOpis.style.borderLeft = "5px solid #856404";
                        ramkaNaOpis.style.fontSize = "13px";
                        ramkaNaOpis.style.color = "#333";
                        ramkaNaOpis.style.maxWidth = "700px";
                        ramkaNaOpis.style.display = "block";
                        ramkaNaOpis.style.whiteSpace = "normal";
                        ramkaNaOpis.style.borderRadius = "4px";

                        // Wrzucamy czysty, połączony tekst bez dodatkowych ostrzeżeń
                        ramkaNaOpis.innerHTML = koncowyTekst;

                        link.parentNode.appendChild(ramkaNaOpis);
                    } else {
                        status.innerText = " ❌ Błąd Allegro (Kod: " + response.status + ")";
                        status.style.color = "red";
                    }
                },
                onerror: function() {
                    status.innerText = " ❌ Błąd połączenia sieciowego z Allegro.";
                    status.style.color = "red";
                }
            });
        });
    }

    // Sprawdzanie co 1.5 sekundy
    setInterval(pobierzOpisyZAllegro, 1500);

    //////////////////////////////////////////////////////
// FOCUS NA POLE SKANOWANIA PO KLIKNIĘCIU
// "Wydrukuj ostatnią etykietę"
//////////////////////////////////////////////////////

document.addEventListener('click', function(e) {

    const btn = e.target.closest('button');

    if (!btn) return;

    const tekst = btn.innerText?.trim() || '';

    if (!tekst.includes('Wydrukuj ostatnią etykiete')) return;

    const ustawFocus = () => {

        const input =
            document.querySelector('input.mat-input-element') ||
            document.querySelector('input[autofocus]');

        if (input) {
            input.focus();
            input.click();
            input.select?.();
        }
    };

    // natychmiast
    ustawFocus();


});

    document.addEventListener('click', function(e) {

    const btn = e.target.closest('button');

    if (!btn) return;

    const tekst = btn.innerText?.trim() || '';

    if (tekst.includes('Wydrukuj ostatnią etykiete')) {
        console.log('KLIKNIĘTO DRUKUJ');
    }

});

})();
