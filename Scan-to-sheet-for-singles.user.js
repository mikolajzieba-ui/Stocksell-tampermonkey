// ==UserScript==
// @name         Returns Scan To Sheet For Singles
// @namespace    baselinker
// @version      1.0
// @description  Wysyła każdy zeskanowany kod do Google Sheets
// @match        https://panel.baselinker.com/orders_returns*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const WEBHOOK_URL =
        "https://script.google.com/macros/s/AKfycbx_cmDoVVgCAcurmQL2HAe-RPk6VGNT5qbVgj7IpFu7KXznBCKZAZs3J3Se_ndLy68Mng/exec";

    let scanBuffer = '';

    function getEmployee() {

        const el = document.querySelector('#login-name');

        return el
            ? el.textContent.trim()
            : 'unknown';
    }

    async function sendScan(scan) {

        try {

            await fetch(
                WEBHOOK_URL,
                {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        packageNumber: scan,
                        employee: getEmployee()
                    })
                }
            );

            console.log(
                '[ReturnLogger] sent:',
                scan
            );

        } catch (err) {

            console.error(
                '[ReturnLogger] error:',
                err
            );
        }
    }

    document.addEventListener(
        'keydown',
        e => {

            if (e.key === 'Enter') {

                const scan =
                    scanBuffer.trim();

                scanBuffer = '';

                if (scan) {

                    console.log(
                        '[ReturnLogger] scan:',
                        scan
                    );

                    sendScan(scan);
                }

                return;
            }

            if (
                e.key.length === 1
            ) {
                scanBuffer += e.key;
            }

        },
        true
    );

})();
