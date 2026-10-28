// ==UserScript==
// @name         StockSell AI -> Google Sheets (Dynamiczne Kategorie)
// @namespace    http://tampermonkey.net/
// @version      3.1.2
// @description  Logi AI do dotychczasowego arkusza oraz rejestrator poprawek Estila z zatwierdzaniem stanowisk.
// @match https://stocksell.io/*
// @match https://*.stocksell.io/*
// @grant GM_xmlhttpRequest
// @grant unsafeWindow
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_listValues
// @grant GM_deleteValue
// @connect script.google.com
// @connect script.googleusercontent.com
// @connect odlozone.estila.com.pl
// @run-at       document-start
// @downloadURL https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/StockSell-AI-LOGS.user.js
// @updateURL https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/StockSell-AI-LOGS.user.js
// ==/UserScript==

(function(){
'use strict';
const BOOT='__estilaStocksellAiRecorderCombined312';
if(globalThis[BOOT]===true)return;
Object.defineProperty(globalThis,BOOT,{value:true,configurable:false});
let sheetsStarted=false;
function startSheets(){
 if(sheetsStarted)return;sheetsStarted=true;
 try {


(function() {
    'use strict';

    const GOOGLE_MACRO_URL = 'https://example.invalid/ai-test';

    let lastKnownUser = 'Nieznany użytkownik';
    let currentSessionId = null;
    let aiFilledLabels = []; // Dynamiczna pamięć dla pól uzupełnionych przez AI

    function generateSessionId() {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    }

    document.body.addEventListener('click', function(event) {
        const currentUrl = window.location.href.toLowerCase();
        if (!currentUrl.includes('create')) {
            return;
        }

        // 1. WYKRYCIE "URUCHOM AI"
        const aiButton = event.target.closest('.stocksell-plus_ai-button');
        if (aiButton) {
            console.log('[StockSell Script] Wykryto kliknięcie Uruchom AI. Czekam na zakończenie procesu...');

            currentSessionId = generateSessionId();
            aiFilledLabels = []; // Resetujemy listę pól dla nowego produktu

            // Obserwator czekający na odblokowanie przycisku
            const observer = new MutationObserver((mutations, obs) => {
                if (!aiButton.classList.contains('loading') && !aiButton.hasAttribute('disabled')) {
                    console.log('[StockSell Script] AI zakończyło pracę! Pobieram dane...');
                    obs.disconnect();

                    setTimeout(() => extractAndSendData('ai_run'), 300);
                }
            });

            observer.observe(aiButton, { attributes: true, attributeFilter: ['class', 'disabled'] });
            return;
        }

        // 2. WYKRYCIE "ZAPISZ"
        const buttonElement = event.target.closest('button');
        if (buttonElement) {
            const btnText = buttonElement.innerText.trim().toLowerCase();
            if (btnText.includes('zapisz')) {

                // ZABEZPIECZENIE: Jeśli nie ma ID sesji (AI nie było kliknięte), przerywamy!
                if (!currentSessionId) {
                    console.log('[StockSell Script] Kliknięto Zapisz, ale AI nie było używane. Ignoruję wysyłkę do Arkusza.');
                    return;
                }

                buttonElement.style.border = "3px solid #4CAF50";
                console.log('[StockSell Script] Wykryto kliknięcie Zapisz po użyciu AI...');

                extractAndSendData('save');

                // Czyszczenie pamięci po zapisie produktu (przygotowanie pod kolejny ręczny lub z AI)
                setTimeout(() => {
                    currentSessionId = null;
                    aiFilledLabels = [];
                }, 1000);
            }
        }
    }, true);

    function extractAndSendData(actionType) {
        console.log(`[StockSell Script] Rozpoczynam pobieranie danych dla trybu: ${actionType}`);

        const userElement = document.querySelector('span[data-cy="username"] span.header');
        if (userElement && userElement.innerText.trim() !== '') {
            lastKnownUser = userElement.innerText.trim();
        }

        const allFields = document.querySelectorAll('mat-form-field');
        const rawData = {};
        const detectedAiLabels = [];

        // Najpierw pobieramy wartości ze wszystkich pól na stronie
        allFields.forEach(field => {
            const labelElement = field.querySelector('label, mat-label, .mat-form-field-label');
            let label = labelElement ? labelElement.innerText : '';
            label = label.replace(/\*/g, '').trim();

            if (!label) return;

            // Sprawdzamy, czy to pole zostało obsłużone przez AI (klasa lub tag span)
            const isAiField = field.classList.contains('stocksell-plus_ai-filled') || field.querySelector('.stocksell-plus_ai-tag');
            if (isAiField) {
                detectedAiLabels.push(label);
            }

            let value = '';
            const selectedChip = field.querySelector('mat-chip.mat-chip-selected');
            const selectValueElement = field.querySelector('.mat-select-value-text span');
            const inputElement = field.querySelector('input, textarea');

            if (selectedChip) {
                value = selectedChip.innerText;
            } else if (selectValueElement) {
                value = selectValueElement.innerText;
            } else if (inputElement) {
                value = inputElement.value;
            }

            rawData[label] = value.trim();
        });

        // Decydujemy, których etykiet użyć
        let labelsToProcess = [];
        if (actionType === 'ai_run') {
            aiFilledLabels = detectedAiLabels;
            labelsToProcess = aiFilledLabels;
        } else if (actionType === 'save') {
            labelsToProcess = aiFilledLabels.length > 0 ? aiFilledLabels : detectedAiLabels;
        }

        // Tworzymy ostateczny obiekt z zachowaniem restrykcyjnej kolejności
        const orderedData = {};
        labelsToProcess.forEach(label => {
            orderedData[label] = rawData[label] !== undefined ? rawData[label] : "";
        });

        console.log(`[StockSell Script] Zebrane dane (${actionType}):`, {
            user: lastKnownUser,
            fields: orderedData,
            sessionId: currentSessionId
        });

        GM_xmlhttpRequest({
            method: "POST",
            url: GOOGLE_MACRO_URL,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({
                user: lastKnownUser,
                type: actionType,
                fields: orderedData,
                sessionId: currentSessionId
            }),
            onload: function(response) {
                console.log(`[StockSell Script] Sukces (${actionType})! Dane zapisane.`, response.responseText);
            },
            onerror: function(error) {
                console.error(`[StockSell Script] Błąd podczas wysyłania do Arkusza (${actionType}):`, error);
            }
        });
    }

})();

 } catch (_) { console.warn('[Stocksell] Nie uruchomiono modulu logow AI.'); }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startSheets,{once:true});
else startSheets();
if(location.origin==='https://stocksell.io' && window.top===window.self){
 try {

(function(){
'use strict';
const scope={crypto};

// ---- userscript-core.js ----
(function (root) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const fields = new Set(('id rawProviderId sku name title productType condition amount titleSize descriptionSize colour brand batch composition defect additionalParameters startingPrice buyNowPrice priceListId originalPrice pricesList imagesUrls sizeTableId allegroCategoryId code paperLabel boxLabel insideLabel ean season state sortedProductId universalSize sellingType allegroProductId responsiblePersonId responsiblePersonAllegroId responsiblePersonName responsibleProducerId responsibleProducerAllegroId responsibleProducerName responsiblePerson responsibleProducer marketedBeforeGPSRObligation allegroRequiredParameters allegroNotRequiredParameters externalId').split(' '));
  const labels = {name:'Nazwa produktu',title:'Tytuł oferty',titleSize:'Rozmiar (tytuł)',descriptionSize:'Rozmiar (opis)',colour:'Kolor',composition:'Skład',state:'Stan',condition:'Stan towaru / wada',defect:'Opis wady',imagesUrls:'Zdjęcia',ean:'EAN',amount:'Ilość',buyNowPrice:'Cena Kup Teraz',startingPrice:'Cena startowa',originalPrice:'Cena katalogowa',brand:'Marka',batch:'Partia',sku:'SKU',code:'Kod produktu',externalId:'External ID',season:'Sezon',paperLabel:'Metka papierowa',insideLabel:'Metka wewnętrzna',boxLabel:'Opakowanie',allegroProductId:'Produkt w katalogu Allegro',allegroCategoryId:'Kategoria Allegro',rawProviderId:'Dostawca',pricesList:'Cenniki'};
  Object.assign(labels,{productType:'Kategoria produktu',universalSize:'Rozmiar uniwersalny',priceListId:'Cennik',sizeTableId:'Tabela rozmiarów',additionalParameters:'Niestandardowe parametry',allegroRequiredParameters:'Obowiązkowe parametry Allegro',allegroNotRequiredParameters:'Nieobowiązkowe parametry Allegro',responsiblePersonId:'Osoba odpowiedzialna — ID',responsiblePersonName:'Osoba odpowiedzialna',responsibleProducerId:'Producent — ID',responsibleProducerName:'Producent',marketedBeforeGPSRObligation:'Wprowadzony przed obowiązkiem GPSR',responsiblePerson:'Osoba odpowiedzialna',responsibleProducer:'Producent'});
  const sensitive = /^(?:authorization|proxyAuthorization|cookie|setCookie|password|passwd|passphrase|token|accessToken|refreshToken|idToken|jwt|session|sessionId|sessionToken|secret|apiKey|clientSecret|email|phone|address|customer|buyer)$/i;
  const excluded = /auth|password|passwd|passphrase|credential|cookie|token|secret|session|headers|customer|buyer|email|phone|address/i;
  function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function cleanString(value) {
    if(/^data:[^,]*;base64,/i.test(String(value)))return '[DANE PLIKU POMINIĘTE]';
    let s = String(value).slice(0, 12000).replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [USUNIĘTO]').replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g, '[TOKEN USUNIĘTY]');
    s = s.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL USUNIĘTY]');
    if (/^https?:\/\//i.test(s)) { try { const u = new URL(s); u.search = ''; u.hash = ''; s = u.href; } catch {} }
    return s;
  }
  function sanitize(value, depth = 0, limits = {}) {
    if (depth > (limits.maxDepth ?? 9)) return '[ZBYT GŁĘBOKIE DANE]';
    if (typeof value === 'string') return cleanString(value);
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, limits.maxItems ?? 600).map(v => sanitize(v, depth + 1, limits));
    if (!plain(value)) return null;
    const out = {};
    for (const [key, v] of Object.entries(value).slice(0, limits.maxKeys ?? 250)) {
      if (['__proto__','prototype','constructor'].includes(key)) continue;
      if(/^(?:base64|base64Url|imageData|fileData|binaryData)$/i.test(key)){out[key]='[DANE PLIKU POMINIĘTE]';continue;}
      out[key] = sensitive.test(key.replace(/[-_]/g, '')) || excluded.test(key) ? '[USUNIĘTO]' : sanitize(v, depth + 1, limits);
    }
    return out;
  }
  function productId(value) { return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null; }
  function productFrom(value, expectedId = null) {
    let best = null, bestScore = -1, seen = 0;
    function visit(v, depth) {
      if (++seen > 12000 || depth > 7 || !v || typeof v !== 'object') return;
      if (plain(v)) {
        const id = productId(v.id) || productId(v.productId);
        const score = Object.keys(v).filter(k => fields.has(k) && k !== 'id').length;
        if (id && (!expectedId || id === expectedId) && score >= 2 && score > bestScore) {
          const result = {id};
          for (const [key,entry] of Object.entries(v)) if (key !== 'id' && !excluded.test(key) && !['__proto__','prototype','constructor'].includes(key)) result[key] = sanitize(entry);
          best = result; bestScore = score;
        }
      }
      for (const child of Object.values(v).slice(0, 600)) visit(child, depth + 1);
    }
    visit(value, 0); return best;
  }
  function parseJson(text) { if (typeof text !== 'string' || text.length > 2_000_000) return null; try { return JSON.parse(text); } catch { return null; } }
  function describe(url, method, body, pagePath, action = null) {
    let u; try { u = new URL(url, 'https://stocksell.io'); } catch { return null; }
    if (u.origin !== 'https://api.stocksell.io' || !u.pathname.startsWith('/api/') || /auth|login|logout|token|password/i.test(u.pathname)) return null;
    const verb = String(method || 'GET').toUpperCase();
    const expectedId = productId(body?.id) || productId(u.searchParams.get('id')) || productId((u.pathname.match(/[0-9a-f-]{36}/i) || [])[0]) || productId((String(pagePath).match(/\/products\/([0-9a-f-]{36})/i) || [])[1]) || productId(action?.productId);
    if(!/^\/api\/products(?:\/|$)/.test(u.pathname))return action&&expectedId?{kind:'operation',expectedId,method:verb,endpoint:u.origin+u.pathname,actionId:action.actionId,errorsOnly:!/print|label|etykiet|publish|post-again|relist|validat|catalog/i.test(u.pathname)}:null;
    const snapshot = productFrom(body, expectedId);
    if(action&&expectedId&&!snapshot&&/print|label|etykiet/.test(u.pathname))return {kind:'operation',expectedId,method:verb,endpoint:u.origin+u.pathname,actionId:action.actionId,errorsOnly:false};
    const read = verb === 'GET' || (verb === 'POST' && /\/get\/?$/.test(u.pathname));
    if (!read && !(['POST','PUT','PATCH'].includes(verb) && snapshot)) return action&&expectedId?{kind:'operation',expectedId,method:verb,endpoint:u.origin+u.pathname,actionId:action.actionId,errorsOnly:false}:null;
    return {kind:read?'read':'write', expectedId, snapshot, method:verb, endpoint:u.origin+u.pathname,actionId:action?.actionId||null};
  }
  function canonical(value, field = '') {
    if (Array.isArray(value)) {
      const list = value.map(v => canonical(v));
      return field === 'pricesList' ? list.sort((a,b) => `${a.priceListId}:${a.type}`.localeCompare(`${b.priceListId}:${b.type}`)) : list;
    }
    if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k], k)]));
    return value;
  }
  function same(a, b, field) { return JSON.stringify(canonical(a, field)) === JSON.stringify(canonical(b, field)); }
  function category(path, fieldLabels = {}) {
    const f = path.split('.')[0];
    const human = fieldLabels[path] || fieldLabels[f] || '';
    if (['titleSize','descriptionSize','universalSize','sizeTableId'].includes(f) || /rozmiar|wkładk/i.test(human)) return 'Rozmiar';
    if (f === 'colour' || /kolor|odcień/i.test(human)) return 'Kolor';
    if (f === 'composition' || /skład/i.test(human)) return 'Skład';
    if (['state','condition'].includes(f) || /^stan\b/i.test(human)) return 'Stan';
    if (f === 'defect') return 'Wada';
    if (f === 'imagesUrls') return 'Zdjęcia';
    if (f === 'ean' || /ean|gtin/i.test(human) || /\.225693$/.test(path)) return 'EAN';
    if (['name','title'].includes(f)) return 'Nazwa / tytuł';
    if (/price|sellingType/i.test(f)) return 'Cena / sprzedaż';
    if (/allegroProduct|allegroCategory|responsible/i.test(f)) return 'Katalog / Allegro';
    return 'Inne parametry';
  }
  function diff(before, after, fieldLabels = {}, options = {}) {
    if (!before || !after) return [];
    const result = [];
    function walk(a, b, path, knownAbsence = false) {
      if (same(a,b,path.split('.')[0])) return;
      if (plain(a) && plain(b)) {
        for (const k of new Set([...Object.keys(a),...Object.keys(b)])) walk(a[k], b[k], path ? `${path}.${k}` : k, !Object.hasOwn(a,k));
        return;
      }
      const first = path.split('.')[0];
      if (first === 'id' || excluded.test(first) || ['__proto__','prototype','constructor'].includes(first)) return;
      const change={field:path,label:fieldLabels[path] || labels[path] || labels[first] || path,before:a === undefined?null:a,after:b === undefined?null:b,category:category(path,fieldLabels),beforeKnown:a !== undefined||knownAbsence};
      if(knownAbsence)change.beforeAbsent=true;
      if(b===undefined)change.removed=true;
      result.push(change);
    }
    const keys = options.complete === true ? new Set([...Object.keys(before),...Object.keys(after)]) : Object.keys(after);
    for (const key of keys) if (key !== 'id') walk(before[key], after[key], key);
    const primary = result.find(v => ['Rozmiar','Kolor'].includes(v.category));
    if (primary) for (const change of result) if (change.field === 'title') change.relatedTo = primary.category;
    return result;
  }
  function responseError(value, status) {
    if (status === 0) return {message:'Błąd sieci lub przerwana operacja.',details:null};
    const stocksellError = plain(value) && ['ERROR','ERROR_SORT','ERROR_CATALOG','ERROR_PARAMETERS','ERROR_CATALOG_BLOCKED'].includes(value.offerStatus);
    const explicit = value === false || stocksellError || (plain(value) && (value.success === false || value.isSuccess === false || value.succeeded === false || value.isValid === false || /^(?:error|failed|failure)$/i.test(String(value.status||'')) || value.error || value.errorMessage || (value.errors && Object.keys(value.errors).length) || (value.validationErrors && Object.keys(value.validationErrors).length)));
    if (status >= 200 && status < 300 && !explicit) return null;
    let details = null;
    if (plain(value)) {
      details = {};
      for (const key of ['message','error','errors','detail','title','errorMessage','validationErrors']) if (Object.hasOwn(value,key)) details[key] = sanitize(value[key]);
      if (stocksellError) {
        details.offerStatus = value.offerStatus;
        if (Object.hasOwn(value,'productProposalError')) details.productProposalError = sanitize(value.productProposalError);
      }
    } else if (typeof value === 'string') details = cleanString(value);
    return {message:status >= 400 ? `Błąd HTTP ${status}` : 'Odpowiedź zawiera zgłoszony błąd.',details};
  }
  function formDiff(before = {}, after = {}) {
    const changes=[];
    for(const key of new Set([...Object.keys(before),...Object.keys(after)])) {
      const a=before[key],b=after[key];
      if(a&&b&&same(a.value,b.value)&&same(a.text,b.text))continue;
      changes.push({key,label:b?.label||a?.label||key,before:a?.value??null,after:b?.value??null,beforeText:a?.text??null,afterText:b?.text??null,kind:!a?'appeared':!b?'disappeared':'value'});
    }
    return changes;
  }
  function actionType(label) {
    const text=String(label||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ł/g,'l');
    if(/wystaw.*ponow/.test(text)&&/(?:druk|print).*etyk|etyk.*(?:druk|print)/.test(text))return 'relist-and-print';
    if(/(?:druk|print).*etyk|etyk.*(?:druk|print)|print.*label/.test(text))return 'print-label';
    if(/wystaw.*ponow|post.again|relist/.test(text))return 'relist';
    if(/polacz.*katalog/.test(text))return 'catalog-link';
    if(/wyszukaj.*katalog/.test(text))return 'catalog-search';
    if(/stworz.*produkt.*katalog/.test(text))return 'catalog-create';
    if(/zapisz|zapis.*zmian|zatwierdz|save/.test(text))return 'save';
    return null;
  }
  function newStore() { return {version:2,enabled:true,operator:'',cases:[],contexts:{},diagnostic:null}; }
  function upgradeStore(db) {
    db.version=2;
    for(const r of db.cases) {r.actions||=[];r.operations||=[];r.uiMessages||=[];r.formViews||=[];r.timeline||=[];}
    return db;
  }
  function time(value) { const n=Date.parse(value); return Number.isFinite(n)?n:0; }
  function selectedBefore(context, at) { return (context.reads || []).filter(r => time(r.startedAt) <= time(at)).sort((a,b)=>time(b.startedAt)-time(a.startedAt))[0] || null; }
  function completeWrite(attempt) {
    const method = String(attempt.method || '').toUpperCase();
    return method === 'PUT' || (method === 'POST' && /^https:\/\/api\.stocksell\.io\/api\/products(?:\/post-again(?:-v2)?)?\/?$/.test(String(attempt.endpoint || '')));
  }
  function recompute(record, attempt) {
    attempt.changes = diff(attempt.before, attempt.proposed, record.fieldLabels, {complete:completeWrite(attempt)});
    attempt.categories = [...new Set(attempt.changes.map(c => c.relatedTo || c.category))];
  }
  function reduceEvent(db, event, tabId, makeId = () => crypto.randomUUID()) {
    if (!db.enabled || !plain(event)) return false;
    const id = productId(event.productId || event.snapshot?.id);
    if (!id) return false;
    upgradeStore(db);
    const key = `${tabId}:${id}`;
    const context = db.contexts[key] ||= {reads:[],caseId:null,labels:{}};
    const record = () => db.cases.find(c => c.caseId === context.caseId);
    function ensure(at, snapshot=null) {
      let r=record();
      if(!r||r.outcome==='verified') {
        const baseline=selectedBefore(context,at);
        const initial=snapshot||baseline?.snapshot||{};
        const initialRead=baseline?{startedAt:baseline.startedAt,at:baseline.at,snapshot:baseline.snapshot}:null;
        r={caseId:makeId(),productId:id,operator:cleanString(db.operator),openedAt:at,initialRead,baselineMissing:!initialRead,code:initial.code??null,sku:initial.sku??null,name:initial.name??'',fieldLabels:{...context.labels},attempts:[],uiErrors:[],actions:[],operations:[],uiMessages:[],formViews:context.form?[sanitize(context.form,0,{maxDepth:20,maxItems:Infinity,maxKeys:Infinity})]:[],timeline:[],outcome:'action_only'};
        db.cases.push(r);context.caseId=r.caseId;
      }
      return r;
    }
    function linkedAction(r,at,explicit) {return r.actions.find(a=>a.actionId===explicit)||[...r.actions].reverse().find(a=>time(at)>=time(a.at)&&time(at)-time(a.at)<180000)||null;}
    function timeline(r,type,at,data={}) {r.timeline.push({type,at,...data});}
    function latestActionHasError(r) {
      const actionId=r.actions.at(-1)?.actionId;
      return !!actionId&&(r.uiErrors.some(e=>e.actionId===actionId)||r.operations.some(o=>o.actionId===actionId&&o.error));
    }
    if(event.kind==='form') {
      if(!plain(event.fields)||!event.formId)return false;
      const current=sanitize(event.fields,0,{maxDepth:12,maxItems:1000,maxKeys:1000});
      if(!context.form||context.form.formId!==event.formId)context.form={formId:cleanString(event.formId),openedAt:event.at,initial:current,last:current,changes:[]};
      else {
        const changes=formDiff(context.form.last,current);
        if(!changes.length)return false;
        context.form.changes.push({at:event.at,changes});context.form.last=current;
      }
      const r=record();
      if(r) {
        const session=sanitize(context.form,0,{maxDepth:20,maxItems:Infinity,maxKeys:Infinity});
        const index=r.formViews.findIndex(f=>f.formId===session.formId);
        if(index<0)r.formViews.push(session);else r.formViews[index]=session;
      }
      return true;
    }
    if(event.kind==='action') {
      if(!event.actionId)return false;
      if(db.cases.some(c=>c.actions.some(a=>a.actionId===event.actionId)))return false;
      const r=ensure(event.at),previous=r.actions.at(-1),form=context.form;
      const fieldsNow=sanitize(event.fields||form?.last||{},0,{maxDepth:12,maxItems:1000,maxKeys:1000});
      const a={actionId:cleanString(event.actionId),type:cleanString(event.actionType||'submit'),label:cleanString(event.label||'Wysłanie formularza'),at:event.at,formId:form?.formId||null,fields:fieldsNow,changes:formDiff(previous?.fields||form?.initial||{},fieldsNow),status:'clicked'};
      r.actions.push(a);r.outcome='action_only';context.lastAction={actionId:a.actionId,productId:id,at:event.at};timeline(r,'action',event.at,{actionId:a.actionId,label:a.label});
      return true;
    }
    if(event.kind==='operation-finish') {
      if(!event.requestId||!event.actionId)return false;
      const r=record();if(!r||r.operations.some(o=>o.requestId===event.requestId))return false;
      const action=linkedAction(r,event.startedAt,event.actionId);if(!action)return false;
      const error=responseError(event.response,Number(event.status)||0);
      const operation={requestId:cleanString(event.requestId),actionId:action.actionId,endpoint:cleanString(event.endpoint),method:cleanString(event.method),startedAt:event.startedAt,finishedAt:event.at,httpStatus:Number(event.status)||0,error};
      r.operations.push(operation);if(error){action.status='failed';if(r.actions.at(-1)===action)r.outcome=r.attempts.at(-1)?.status==='verified'?'followup_error':'failed';}
      timeline(r,error?'operation-error':'operation-response',event.at,{requestId:operation.requestId,actionId:action.actionId,endpoint:operation.endpoint,httpStatus:operation.httpStatus,error});
      return true;
    }
    if (event.kind === 'ui') {
      if (plain(event.labels)) for (const [k,v] of Object.entries(event.labels).slice(0,100)) if (typeof v==='string' && v.length<160 && k.length<100 && !['__proto__','constructor','prototype'].includes(k)) context.labels[k]=cleanString(v);
      let r=record();
      const notices=[...(Array.isArray(event.messages)?event.messages:[]),...(Array.isArray(event.errors)?event.errors:[]).map(message=>({message,severity:'error',source:'formularz'}))];
      if(!r && notices.some(n=>n.severity==='error') && (context.reads.length||context.form)) {r=ensure(event.at);r.outcome='ui_error';}
      if(r) {r.fieldLabels={...r.fieldLabels,...context.labels};for(const a of r.attempts)recompute(r,a);}
      for (const item of notices.slice(0,30)) if (typeof item?.message === 'string' && r) {
        const message=cleanString(item.message),action=linkedAction(r,event.at,event.actionId),actionId=action?.actionId||null,source=cleanString(item.source||'formularz');
        if(r.uiMessages.some(e=>e.message===message&&e.actionId===actionId&&e.source===source))continue;
        const entry={at:event.at,message,actionId,source,severity:item.severity==='error'?'error':'notice'};
        r.uiMessages.push(entry);if(entry.severity==='error') {
          r.uiErrors.push(entry);if(action)action.status='ui_error';
          if(!r.attempts.length&&r.outcome!=='verified')r.outcome='ui_error';
          if(r.attempts.at(-1)?.status==='verified'&&latestActionHasError(r))r.outcome='followup_error';
        }
        timeline(r,entry.severity==='error'?'ui-error':'ui-message',event.at,entry);
      }
      return true;
    }
    if (event.kind === 'read') {
      const snapshot = productFrom(event.snapshot,id); if(!snapshot)return false;
      if (!(event.status>=200 && event.status<300))return false;
      const read={startedAt:event.startedAt,at:event.at,snapshot};
      context.reads.push(read);context.reads.sort((a,b)=>time(a.startedAt)-time(b.startedAt));context.reads=context.reads.slice(-6);
      const r=record();
      if(r) {
        if(!r.initialRead && time(event.startedAt)<=time(r.openedAt)) {
          r.initialRead={startedAt:event.startedAt,at:event.at,snapshot};r.baselineMissing=false;
        }
        r.code??=snapshot.code??null;r.sku??=snapshot.sku??null;if(!r.name)r.name=snapshot.name||'';
        for(const a of r.attempts) if(!a.before && time(event.startedAt)<time(a.startedAt)) {
          a.before=snapshot;a.beforeAt=event.at;recompute(r,a);
          if(r.attempts.at(-1)===a&&r.outcome==='missing_before')r.outcome=a.status==='http_accepted'?'verification_needed':a.status==='failed'?'failed':'pending';
        }
        const last=r.attempts.at(-1);
        if(last?.status==='http_accepted' && time(event.startedAt)>time(last.finishedAt)) {
          const changes=last.changes.filter(c=>c.beforeKnown);
          const absent=last.changes.some(c=>!c.beforeKnown);
          const valueAt=(obj,path)=>path.split('.').reduce((v,k)=>v?.[k],obj);
          const verified=changes.every(c=>same(valueAt(snapshot,c.field),c.removed?undefined:c.after,c.field.split('.')[0]));
          last.verification={at:event.at,snapshot,result:verified&&!absent&&!!last.before?'confirmed':'different_or_incomplete'};
          if(last.verification.result==='confirmed') {last.status='verified';r.outcome=latestActionHasError(r)?'followup_error':'verified';} else r.outcome=last.before?'verification_needed':'missing_before';
        }
      }
      return true;
    }
    if (event.kind === 'save-start') {
      const proposed=productFrom(event.snapshot,id);if(!proposed||!event.requestId)return false;
      if(db.cases.some(c=>c.attempts.some(a=>a.requestId===event.requestId)))return false;
      const r=ensure(event.startedAt,proposed);
      r.code??=proposed.code??null;r.sku??=proposed.sku??null;if(!r.name)r.name=proposed.name||'';
      const baseline=selectedBefore(context,event.startedAt);
      const action=linkedAction(r,event.startedAt,event.actionId),previous=r.attempts.at(-1);
      const attempt={requestId:String(event.requestId).slice(0,150),actionId:action?.actionId||null,startedAt:event.startedAt,method:event.method,endpoint:event.endpoint,before:baseline?.snapshot||null,beforeAt:baseline?.at||null,proposed,correctionsSincePrevious:previous?diff(previous.proposed,proposed,r.fieldLabels,{complete:completeWrite(event)}):[],status:'pending',finishedAt:null,httpStatus:null,error:null,verification:null};
      recompute(r,attempt);r.attempts.push(attempt);r.outcome=attempt.before?'pending':'missing_before';timeline(r,'save-start',event.startedAt,{requestId:attempt.requestId,actionId:attempt.actionId});return true;
    }
    if(event.kind==='save-finish') {
      const r=db.cases.find(c=>c.productId===id&&c.attempts.some(a=>a.requestId===event.requestId));
      if(!r)return false;
      const a=r.attempts.find(v=>v.requestId===event.requestId);if(a.finishedAt)return false;
      a.finishedAt=event.at;a.httpStatus=Number(event.status)||0;a.error=responseError(event.response,a.httpStatus);
      a.status=a.error?'failed':'http_accepted';if(r.attempts.at(-1)===a)r.outcome=a.error?'failed':a.before?'verification_needed':'missing_before';
      const action=r.actions.find(v=>v.actionId===a.actionId);if(action)action.status=a.status;
      timeline(r,a.error?'save-error':'save-response',event.at,{requestId:a.requestId,actionId:a.actionId,httpStatus:a.httpStatus,error:a.error});
      return true;
    }
    return false;
  }
  function exportData(db) { return {format:'stocksell-change-log',version:2,exportedAt:new Date().toISOString(),extensionVersion:'0.4.1',cases:sanitize(db.cases,0,{maxDepth:32,maxItems:Infinity,maxKeys:Infinity}),diagnostic:db.diagnostic}; }
  const api = Object.freeze({fields:[...fields],labels,productId,productFrom,sanitize,parseJson,describe,diff,formDiff,actionType,responseError,newStore,upgradeStore,reduceEvent,exportData,cleanString});
  if(typeof module !== 'undefined' && module.exports)module.exports=api;else Object.defineProperty(root,'StockLogCore',{value:api,configurable:true});
})(scope);


// ---- form.js ----
(function(root) {
  'use strict';
  const core=root.StockLogCore;
  const blocked=/password|passwd|token|cookie|secret|session|auth|email|e-mail|telefon|phone|address|adres|customer|buyer/i;
  const compact=v=>String(v||'').replace(/\s+/g,' ').trim();
  function label(element) {
    const native=element.labels?.[0]?.textContent;
    const container=element.closest('mat-form-field,.form-group,.form-field,fieldset,[data-field]');
    const floating=container?.querySelector('mat-label,.mat-form-field-label,.mdc-floating-label,legend,label');
    return compact(native||element.getAttribute('aria-label')||floating?.textContent||element.getAttribute('placeholder')||element.getAttribute('name')||element.id).replace(/\s*\*$/,'').slice(0,180);
  }
  function keyFor(element,text,kind,index) {
    const parameter=element.id?.match(/^parameter_(\d+)/)?.[1];
    const name=element.getAttribute('formcontrolname')||element.getAttribute('name')||element.getAttribute('data-field');
    return `${kind}:${parameter?'parameter_'+parameter:name||text||element.id||index}`;
  }
  function applicationImage(image,src) {
    if(!src || /^(?:chrome-extension|moz-extension|edge-extension|safari-web-extension|chrome|about|resource):/i.test(src))return true;
    if(/^data:image\/(?:svg\+xml|x-icon|vnd\.microsoft\.icon)(?:[;,])/i.test(src))return true;
    if(image.closest?.('[data-stocksell-recorder-ui]'))return true;
    if(/logo|avatar/i.test(image.getAttribute('alt')||''))return true;
    const path=src.split(/[?#]/,1)[0];
    return /^(?:https?:\/\/[^/]+)?\/(?:assets|static)\//i.test(path) && /\/(?:icon(?:[-_][^/]*)?|logo(?:[-_][^/]*)?|avatar(?:[-_][^/]*)?)\.(?:png|svg|gif|webp|jpe?g|ico)$/i.test(path);
  }
  function collect(doc) {
    const result={},occurrences={};
    const scope=doc.querySelector('main')||doc;
    function put(element,kind,value,text,index) {
      const name=label(element),identity=name+' '+element.id+' '+(element.getAttribute('name')||'')+' '+(element.getAttribute('formcontrolname')||'');
      if(blocked.test(identity))return;
      const base=keyFor(element,name,kind,index),n=occurrences[base]||0;occurrences[base]=n+1;
      const key=n?`${base}#${n+1}`:base;
      result[key]={label:name||key,type:kind,value:core.sanitize(value),text:core.cleanString(text??(typeof value==='string'?value:JSON.stringify(value)))};
    }
    let index=0;
    for(const el of scope.querySelectorAll('input,textarea,select,mat-select,[role="combobox"],[contenteditable="true"]')) {
      if(el.matches('[role="combobox"]')&&!el.matches('mat-select,input,select')&&el.querySelector('input,mat-select,select'))continue;
      const type=String(el.type||el.tagName).toLowerCase();
      if(['password','file','email','tel','submit','reset','button'].includes(type))continue;
      let value,text;
      if(type==='checkbox'||type==='radio') {value={checked:!!el.checked,value:el.value};text=el.checked?'Zaznaczone':'Niezaznaczone';}
      else if(el.tagName==='SELECT') {const selected=[...el.selectedOptions];value=el.multiple?selected.map(o=>o.value):el.value;text=selected.map(o=>compact(o.textContent)).join(', ');}
      else if(el.matches('mat-select,[role="combobox"]')) {text=compact(el.querySelector('.mat-select-value,.mat-mdc-select-value')?.textContent||el.textContent);value=el.value??text;}
      else if(el.getAttribute('contenteditable')==='true') {value=el.textContent;text=value;}
      else {value=el.value??el.getAttribute('value')??'';text=value;}
      put(el,type,value,text,index++);
    }
    for(const group of scope.querySelectorAll('mat-chip-listbox,mat-chip-list,mat-button-toggle-group,[role="radiogroup"],fieldset,mat-form-field,.form-group,.form-field')) {
      const selected=[...group.querySelectorAll('[aria-pressed="true"],[aria-selected="true"],[aria-checked="true"],.mat-chip-selected,.mat-mdc-chip-selected,.mat-button-toggle-checked,button.selected,button.active')].map(el=>compact(el.textContent)).filter(Boolean);
      if(selected.length)put(group,'wybór',selected,selected.join(', '),index++);
    }
    for(const image of scope.querySelectorAll('img')) {
      let src=image.currentSrc||image.getAttribute('src')||'';
      if(applicationImage(image,src))continue;
      if(src.startsWith('data:'))src='[DANE PLIKU POMINIĘTE]';
      put(image,'zdjęcie',{src,alt:image.getAttribute('alt')||''},image.getAttribute('alt')||src,index++);
    }
    return result;
  }
  Object.defineProperty(root,'StockLogForm',{value:Object.freeze({collect,label}),configurable:true});
})(scope);


// ---- userscript-runtime.js ----
(function(root){
  'use strict';
  const PREFIX='estilaStocksellRecorder.',SHARD=PREFIX+'shard.',CONFIG=PREFIX+'config',ACK=PREFIX+'ack.',CLEAR=PREFIX+'clear.';
  const kinds=new Set(['read','ui','form','action','save-start','save-finish','operation-finish']);
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=canonical(value[key]);return out;}return value;}
  function create(deps){
    if(!deps?.core||!deps.store||!['get','set','list'].every(key=>typeof deps.store[key]==='function'))throw new TypeError('Nieprawidłowy magazyn rejestratora.');
    const core=deps.core,store=deps.store,makeId=deps.uuid||(()=>root.crypto.randomUUID());
    const uuid=()=>{const id=String(makeId());if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw new TypeError('Nieprawidłowy identyfikator dokumentu.');return id.toLowerCase();};
    const sourceId=uuid();
    const limit=Math.min(8500000,Number.isFinite(deps.saveLimitBytes)&&deps.saveLimitBytes>0?deps.saveLimitBytes:8500000);
    const now=()=>{const value=typeof deps.clock==='function'?deps.clock():Date.now();const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():new Date().toISOString();};
    let cleanupDiagnostic=null,lastMaintenanceAt=-Infinity;
    let local={version:1,sourceId,generation:0,currentCaseId:null,currentProductId:null,db:core.newStore(),revisions:{},diagnostic:null,halted:false,updatedAt:now()},queue=Promise.resolve(),syncState=null;
    const serial=work=>{const result=queue.then(work,work);queue=result.catch(()=>{});return result;};
    const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
    const cleanText=value=>core.cleanString(value).replace(/\b[a-f0-9]{32}\.[a-f0-9]{64}\b/gi,'[KLUCZ USUNIĘTY]');
    const redact=value=>typeof value==='string'?cleanText(value):Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,redact(entry)])):value;
    const safe=value=>redact(core.sanitize(value,0,{maxDepth:32,maxItems:Infinity,maxKeys:Infinity}));
    async function revision(record){
      const input=new TextEncoder().encode(JSON.stringify(canonical(safe(record))));
      const digest=await root.crypto.subtle.digest('SHA-256',input);return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    }
    async function config(){const value=await store.get(CONFIG,null);return {enabled:value?.enabled!==false,operator:typeof value?.operator==='string'?cleanText(value.operator).slice(0,80):''};}
    async function allShards(){
      const generations=[],errors=[],latest=new Map();
      for(const name of await store.list())if(name.startsWith(SHARD)){
        const value=await store.get(name,null);
        if(!value||value.version!==1||typeof value.sourceId!=='string'||!name.startsWith(SHARD+value.sourceId+'.')||!Number.isSafeInteger(value.generation)||value.generation<1||!Array.isArray(value.db?.cases)||!value.revisions||typeof value.revisions!=='object'){errors.push('Nie można odczytać części lokalnych logów. Dane pozostały w magazynie.');continue;}
        const entry={key:name,value};generations.push(entry);const previous=latest.get(value.sourceId);if(!previous||value.generation>previous.value.generation)latest.set(value.sourceId,entry);
      }
      return {shards:[...latest.values()],generations,errors};
    }
    // Keep the live baseline in RAM; persistent storage contains only unacknowledged revisions.
    async function persistentProjection(value){
      const removed=new Set();
      for(const record of value.db.cases){
        const meta=value.revisions[record.caseId],ack=await store.get(ACK+encodeURIComponent(record.caseId),null);
        if(meta&&ack?.revision===meta.revision&&meta.revision===await revision(record))removed.add(record.caseId);
      }
      if(!removed.size)return {value,changed:false};
      const projected=clone(value);projected.db.cases=projected.db.cases.filter(record=>!removed.has(record.caseId));
      for(const id of removed)delete projected.revisions[id];
      for(const [key,context]of Object.entries(projected.db.contexts||{}))if(removed.has(context.caseId))delete projected.db.contexts[key];
      if(removed.has(projected.currentCaseId)){projected.currentCaseId=null;projected.currentProductId=null;}
      return {value:projected,changed:true};
    }
    async function collectGarbage(){
      const view=await allShards();if(view.errors.length)return;
      const latest=new Map(view.shards.map(shard=>[shard.value.sourceId,shard])),validLatest=new Map();
      for(const shard of view.shards){let valid=true;for(const record of shard.value.db.cases){const meta=shard.value.revisions[record.caseId];if(!meta||meta.revision!==await revision(record)||!Number.isSafeInteger(meta.sequence)){valid=false;break;}}validLatest.set(shard.value.sourceId,valid);}
      for(const entry of view.generations){
        if(!validLatest.get(entry.value.sourceId)){cleanupDiagnostic='Nie potwierdzono rewizji generacji. Nie usunięto danych.';continue;}
        const newest=latest.get(entry.value.sourceId);
        if(entry.value.generation<newest.value.generation&&typeof store.remove==='function'){
          try{await store.remove(entry.key);continue;}catch{cleanupDiagnostic='Sprzątanie potwierdzonych generacji wymaga ponowienia; logi pozostały w magazynie.';}
        }
        const projection=await persistentProjection(entry.value);if(!projection.changed)continue;
        // Generations are immutable for their owner. Do not overwrite another cleaner's result.
        const current=await store.get(entry.key,null);if(JSON.stringify(current)!==JSON.stringify(entry.value))continue;
        try{await store.set(entry.key,projection.value);}catch{cleanupDiagnostic='Nie udało się usunąć potwierdzonej kopii lokalnej. Sprzątanie zostanie ponowione.';}
        // Keep the empty highest generation as a small tombstone, so an old copy cannot become latest.
      }
    }
    async function pruneOwned(next){
      const removed=new Set();
      for(const record of next.db.cases){
        if(record.caseId===next.currentCaseId||record.attempts?.some(attempt=>!attempt.finishedAt))continue;
        const meta=next.revisions[record.caseId],ack=await store.get(ACK+encodeURIComponent(record.caseId),null);
        const explicitlyCleared=meta&&await store.get(clearKey(record.caseId,meta.revision),null);
        if(explicitlyCleared||(meta&&ack?.revision===meta.revision))removed.add(record.caseId);
      }
      if(!removed.size)return false;
      next.db.cases=next.db.cases.filter(record=>!removed.has(record.caseId));for(const id of removed)delete next.revisions[id];
      for(const [key,context]of Object.entries(next.db.contexts||{}))if(removed.has(context.caseId))delete next.db.contexts[key];
      return true;
    }
    async function maintenance(){
      const stamp=Date.parse(now());if(stamp-lastMaintenanceAt<60000)return;lastMaintenanceAt=stamp;
      await collectGarbage();const next=clone(local);if(await pruneOwned(next)){next.updatedAt=now();try{await commit(next);}catch{cleanupDiagnostic='Nie udało się posprzątać potwierdzonych logów. Dane pozostały w magazynie.';}}
    }
    const clearKey=(caseId,rev)=>CLEAR+encodeURIComponent(caseId)+'.'+rev;
    async function merged(){
      const {shards,errors}=await allShards(),records=new Map();
      for(const shard of shards)for(const raw of shard.value.db.cases){
        if(!raw||typeof raw.caseId!=='string')continue;
        const record=safe(raw),rev=await revision(record),meta=shard.value.revisions[record.caseId];
        if(!meta||meta.revision!==rev||!Number.isSafeInteger(meta.sequence)||meta.sequence<1){errors.push('Nie można potwierdzić rewizji lokalnego logu. Nie usunięto danych.');continue;}
        if(await store.get(clearKey(record.caseId,rev),null))continue;
        const item={caseId:record.caseId,revision:rev,sequence:meta.sequence,sourceId:shard.value.sourceId,record,meta};
        const previous=records.get(item.caseId);if(!previous||item.sequence>previous.sequence)records.set(item.caseId,item);
      }
      return {items:[...records.values()],shards,errors};
    }
    async function pendingInternal(view){
      const {items}=view||await merged(),out=[];
      for(const item of items){const ack=await store.get(ACK+encodeURIComponent(item.caseId),null);if(ack?.revision===item.revision)continue;
        out.push({caseId:item.caseId,revision:item.revision,sequence:item.sequence,sourceId:item.sourceId,data:core.exportData({cases:[item.record],diagnostic:null})});
      }
      return out;
    }
    async function statusInternal(view){
      view=view||await merged();const waiting=await pendingInternal(view);let lastSuccessAt=null;
      for(const name of await store.list())if(name.startsWith(ACK)){const ack=await store.get(name,null);if(typeof ack?.at==='string'&&(!lastSuccessAt||ack.at>lastSuccessAt))lastSuccessAt=ack.at;}
      let state=waiting.length?'pending':lastSuccessAt?'synced':'pending',message=waiting.length?'Logi czekają na wysłanie do aplikacji.':'Brak oczekujących zmian.';
      if(syncState){state=syncState.state;message=syncState.message;}
      return {state,message,pendingCases:waiting.length,lastSuccessAt};
    }
    async function getSummary(){
      const cfg=await config();
      return {ok:true,enabled:cfg.enabled&&!local.halted,operator:cfg.operator,cases:[],diagnostic:local.diagnostic||cleanupDiagnostic||null,sync:syncState||null,summaryOnly:true};
    }
    async function getData(){const cfg=await config(),view=await merged();return {ok:true,enabled:cfg.enabled&&!local.halted,operator:cfg.operator,cases:view.items.map(item=>item.record),diagnostic:local.diagnostic||cleanupDiagnostic||view.errors[0]||view.shards.map(shard=>shard.value.diagnostic).find(Boolean)||null,sync:await statusInternal(view)};}
    async function revise(next){
      for(const record of next.db.cases){const rev=await revision(record),old=next.revisions[record.caseId];if(old?.revision===rev)continue;
        const history={...(old?.history||{})};if(old)history[old.revision]=old.sequence;
        const sequence=(old?.sequence||0)+1;if(!Number.isSafeInteger(sequence))throw new Error('revision_limit');
        next.revisions[record.caseId]={revision:rev,sequence,history,changedAt:now()};
      }
      next.updatedAt=now();return next;
    }
    async function commit(next){
      const {shards,errors}=await allShards();if(errors.length)throw new Error('damaged_storage');
      next.generation=local.generation+1;if(!Number.isSafeInteger(next.generation))throw new Error('generation_limit');
      const name=SHARD+sourceId+'.'+String(next.generation).padStart(16,'0')+'.'+String(uuid());
      const persisted=(await persistentProjection(next)).value;
      const total=shards.filter(shard=>shard.value.sourceId!==sourceId).reduce((sum,shard)=>sum+bytes(shard.value),0)+bytes(persisted);
      if(total>limit)throw new Error('storage_limit');await store.set(name,persisted);local=next;await collectGarbage();
    }
    async function failStorage(){
      local.halted=true;local.diagnostic='Brak miejsca lub błąd zapisu logów. Rejestrowanie zatrzymano; wcześniejsze dane pozostały. Wyeksportuj logi i sprawdź magazyn.';
      try{const cfg=await config();await store.set(CONFIG,{...cfg,enabled:false});}catch{}
      return {ok:false,diagnostic:local.diagnostic};
    }
    function cleanEvent(input){
      if(!input||!kinds.has(input.kind)||!core.productId(input.productId||input.snapshot?.id))return null;
      const event=safe(input);
      if(['read','save-start'].includes(event.kind)){event.snapshot=core.productFrom(event.snapshot,event.snapshot?.id);if(!event.snapshot)return null;}
      if(['form','action'].includes(event.kind)&&(!event.fields||typeof event.fields!=='object'||Array.isArray(event.fields)))return null;
      if(['save-start','operation-finish'].includes(event.kind)){
        let url;try{url=new URL(event.endpoint);}catch{return null;}
        if(url.origin!=='https://api.stocksell.io'||!url.pathname.startsWith('/api/')||/auth|login|logout|token|password/i.test(url.pathname))return null;
        if(event.kind==='save-start'&&(!/^\/api\/products(?:\/|$)/.test(url.pathname)||!['POST','PUT','PATCH'].includes(event.method)))return null;
        if(event.kind==='operation-finish'&&!['GET','POST','PUT','PATCH','DELETE'].includes(event.method))return null;
        event.endpoint=url.origin+url.pathname;
      }
      return event;
    }
    async function capture(input){
      const event=cleanEvent(input);if(!event)return {ok:false,error:'Nieprawidłowe zdarzenie.'};
      const cfg=await config();if(!cfg.enabled||local.halted)return {ok:true,diagnostic:local.diagnostic};
      const next=clone(local);next.db.enabled=true;next.db.operator=cfg.operator;
      if(!core.reduceEvent(next.db,event,sourceId,uuid))return {ok:true};
      next.currentProductId=event.productId||event.snapshot?.id;next.currentCaseId=next.db.contexts[sourceId+':'+next.currentProductId]?.caseId||null;
      try{await revise(next);await pruneOwned(next);await commit(next);return {ok:true,diagnostic:null};}catch{return failStorage();}
    }
    async function acknowledgeInternal(caseId,rev){
      if(typeof caseId!=='string'||typeof rev!=='string'||!/^[a-f0-9]{64}$/.test(rev))return {ok:false,error:'Nieprawidłowe potwierdzenie.'};
      const name=ACK+encodeURIComponent(caseId),previous=await store.get(name,null);
      const view=await merged();const item=view.items.find(item=>item.caseId===caseId);if(!item){if(previous?.revision===rev){await collectGarbage();return {ok:true,alreadyAcknowledged:true};}return {ok:false,error:'Nie znaleziono lokalnego logu.'};}
      const sequence=item.revision===rev?item.sequence:item.meta.history?.[rev];if(!Number.isSafeInteger(sequence))return {ok:false,error:'Nieznana rewizja logu.'};
      if(previous&&Number.isSafeInteger(previous.sequence)&&previous.sequence>sequence)return {ok:true,stale:true};
      await store.set(name,{caseId,revision:rev,sequence,sourceId:item.sourceId,at:now()});await collectGarbage();
      const next=clone(local);if(await pruneOwned(next))local=next;return {ok:true};
    }
    async function clearInternal(message){
      if(!Array.isArray(message.caseIds)||!message.caseIds.length||message.caseIds.some(id=>typeof id!=='string')||new Set(message.caseIds).size!==message.caseIds.length)return {ok:false,error:'Wskaż logi do usunięcia.'};
      const view=await merged(),selected=view.items.filter(item=>message.caseIds.includes(item.caseId));
      if(selected.length!==message.caseIds.length)return {ok:false,error:'Lista logów zmieniła się. Odśwież panel.'};
      for(const item of selected){const ack=await store.get(ACK+encodeURIComponent(item.caseId),null);if(ack?.revision!==item.revision&&message.confirmPending!==true)return {ok:false,error:'Logi czekają na wysłanie. Potwierdź ich usunięcie.'};}
      for(const item of selected)await store.set(clearKey(item.caseId,item.revision),{caseId:item.caseId,revision:item.revision,at:now(),confirmedPending:message.confirmPending===true});
      return {ok:true,cleared:selected.length};
    }
    async function handle(message){
      if(!message||typeof message!=='object')return {ok:false};
      if(message.type==='capture-event')return capture(message.event);
      if(message.type==='capture-status'){const cfg=await config();const actions=Object.values(local.db.contexts||{}).map(context=>context.lastAction).filter(Boolean).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));return {enabled:cfg.enabled&&!local.halted,diagnostic:local.diagnostic,lastAction:actions[0]||null};}
      if(message.type==='get-data')return getData();
      if(message.type==='get-summary')return getSummary();
      if(message.type==='export'){const data=await getData();return {ok:true,data:core.exportData({cases:data.cases,diagnostic:data.diagnostic})};}
      if(message.type==='settings'){
        if((Object.hasOwn(message,'enabled')&&typeof message.enabled!=='boolean')||(Object.hasOwn(message,'operator')&&typeof message.operator!=='string'))return {ok:false};
        const cfg=await config();if(typeof message.enabled==='boolean')cfg.enabled=message.enabled;if(typeof message.operator==='string')cfg.operator=cleanText(message.operator).slice(0,80);
        await store.set(CONFIG,cfg);if(cfg.enabled){local.halted=false;local.diagnostic=null;}return {ok:true};
      }
      if(message.type==='clear-logs')return clearInternal(message);
      if(message.type==='sync-ack')return acknowledgeInternal(message.caseId,message.revision);
      if(message.type==='sync-status'){
        if(typeof message.state==='string'&&['pending','syncing','synced','offline','error','missing_key','key_rejected','waiting'].includes(message.state))syncState={state:message.state,message:cleanText(message.message||'').slice(0,400)};
        return {ok:true,sync:syncState};
      }
      return {ok:false};
    }
    return Object.freeze({sourceId,request:message=>serial(async()=>{if(!['capture-status','get-summary','sync-status'].includes(message?.type))await maintenance();return handle(message);}),pending:()=>serial(async()=>{await maintenance();return pendingInternal();}),acknowledge:(caseId,rev)=>serial(async()=>{await maintenance();return acknowledgeInternal(caseId,rev);}),revision});
  }
  Object.defineProperty(root,'StockLogUserscriptRuntime',{value:Object.freeze({create}),configurable:true});
})(scope);


// ---- userscript-capture.js ----
(function (root) {
  root.StockLogUserscriptCapture = function (options) {
  const window=options.pageWindow,core=options.core,location=window.location,XMLHttpRequest=window.XMLHttpRequest,Request=window.Request,URL=window.URL;
  if(window.__estilaStocksellRecorderCapture) return {installed:false,setEnabled(){},setAction(){}};
  window.__estilaStocksellRecorderCapture=true;
  'use strict';




  let enabled = true, actionContext = null;
  function activeAction() {
    const product=core.productId(location.pathname.match(/\/products\/([0-9a-f-]{36})/i)?.[1]);
    return actionContext&&(!product||product===actionContext.productId)&&Date.now()-Date.parse(actionContext.at)<20000?actionContext:null;
  }
  function emit(event) {
    try { if (enabled) options.deliver(event); } catch {}
  }
  function start(meta, startedAt, requestId) {
    if(meta?.kind==='write')emit({kind:'save-start',requestId,actionId:meta.actionId,productId:meta.snapshot.id,snapshot:meta.snapshot,method:meta.method,endpoint:meta.endpoint,startedAt});
  }
  function finish(meta, status, text, startedAt, requestId) {
    if(!meta)return;
    const parsed=typeof text==='string'?core.parseJson(text):text;
    const at=new Date().toISOString();
    if(meta.kind==='read') {
      const error=core.responseError(parsed,status);
      if(error&&meta.actionId) {emit({kind:'operation-finish',productId:meta.expectedId,actionId:meta.actionId,requestId,status,startedAt,at,endpoint:meta.endpoint,method:meta.method,response:{success:false,message:error.message,errors:error.details}});return;}
      if(error)return;
      const snapshot=core.productFrom(parsed,meta.expectedId);
      if(snapshot)emit({kind:'read',productId:snapshot.id,snapshot,status,startedAt,at});
    } else if(meta.kind==='operation') {
      // A false answer to a read-only preflight question is data, not a failed
      // write. False print/validation/catalog results and mutations still fail.
      const booleanRead=meta.errorsOnly===true && ['GET','HEAD'].includes(meta.method) && parsed===false && status>=200 && status<300;
      const error=booleanRead?null:core.responseError(parsed,status);
      if(error||!meta.errorsOnly)emit({kind:'operation-finish',productId:meta.expectedId,actionId:meta.actionId,requestId,status,startedAt,at,endpoint:meta.endpoint,method:meta.method,response:error?{success:false,message:error.message,errors:error.details}:null});
    } else {
      const error=core.responseError(parsed,status);
      emit({kind:'save-finish',productId:meta.snapshot.id,requestId,status,at,response:error?{success:false,message:error.message,errors:error.details}:null});
    }
  }
  function requestBody(input, init) {
    try {
      if(init && Object.hasOwn(init,'body'))return Promise.resolve(core.parseJson(typeof init.body==='string'?init.body:''));
      if(input instanceof Request && !['GET','HEAD'].includes(input.method))return input.clone().text().then(core.parseJson,()=>null);
    } catch {}
    return Promise.resolve(null);
  }
  const originalFetch=window.fetch;
  if(typeof originalFetch==='function')window.fetch=function(input,init) {
    let info=null;
    try {
      const url=typeof input==='string'||input instanceof URL?String(input):input.url;
      if(enabled && new URL(url,location.href).origin==='https://api.stocksell.io' && !/auth|login|logout|token|password/i.test(new URL(url,location.href).pathname) && (/\/api\/products(?:\/|\?|$)/.test(url)||activeAction())) {
        const startedAt=new Date().toISOString(),requestId=crypto.randomUUID(),pagePath=location.pathname;
        const action=activeAction();
        const method=init?.method||input?.method||'GET';
        info=(/\/api\/products(?:\/|\?|$)/.test(url)?requestBody(input,init):Promise.resolve(null)).then(body=>{
          const meta=core.describe(url,method,body,pagePath,action);start(meta,startedAt,requestId);return {meta,startedAt,requestId};
        }).catch(()=>null);
      }
    } catch {}
    // Return the application's original promise. Logging cannot delay or replace it.
    const promise=Reflect.apply(originalFetch,this,arguments);
    if(info)promise.then(response=>{
      let copy;try{copy=response.clone();}catch{return;}
      const declared=Number(response.headers.get('content-length')||0),type=response.headers.get('content-type')||'';
      if(type&&!/json|text/i.test(type)) {info.then(d=>{if(d?.meta?.kind==='operation')finish(d.meta,response.status,null,d.startedAt,d.requestId);}).catch(()=>{});return;}
      if(declared>2_000_000)return;
      Promise.all([info,copy.text()]).then(([details,text])=>{
        if(details&&text.length<=2_000_000)finish(details.meta,response.status,text,details.startedAt,details.requestId);
      }).catch(()=>{});
    },()=>{info.then(d=>{if(d)finish(d.meta,0,null,d.startedAt,d.requestId);}).catch(()=>{});});
    return promise;
  };
  const xhrInfo=new WeakMap(),originalOpen=XMLHttpRequest.prototype.open,originalSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url) {
    try{xhrInfo.set(this,{method,url:String(url)});}catch{}
    return Reflect.apply(originalOpen,this,arguments);
  };
  XMLHttpRequest.prototype.send=function(body) {
    try {
      const saved=xhrInfo.get(this);
      const productRequest=saved&&/^https:\/\/api\.stocksell\.io\/api\/products(?:\/|\?|$)/.test(saved.url);
      const meta=enabled&&saved?core.describe(saved.url,saved.method,productRequest?core.parseJson(typeof body==='string'?body:''):null,location.pathname,activeAction()):null;
      if(meta) {
        const startedAt=new Date().toISOString(),requestId=crypto.randomUUID();start(meta,startedAt,requestId);
        this.addEventListener('loadend',()=>{
          try {
            const value=this.responseType==='json'?this.response:(!this.responseType||this.responseType==='text')?this.responseText:null;
            if(typeof value!=='string'||value.length<=2_000_000)finish(meta,this.status,value,startedAt,requestId);
          }catch{}
        },{once:true});
      }
    } catch {}
    return Reflect.apply(originalSend,this,arguments);
  };
  for(const name of ['alert','confirm']) {
    const original=window[name];if(typeof original!=='function')continue;
    window[name]=function(message) {
      try {
        const productId=core.productId(location.pathname.match(/\/products\/([0-9a-f-]{36})/i)?.[1])||activeAction()?.productId;
        if(productId)emit({kind:'ui',productId,actionId:activeAction()?.actionId||null,at:new Date().toISOString(),messages:[{message:core.cleanString(message),source:name,severity:/błąd|błęd|nieprawidł|niepopraw|error|invalid|failed|zajęt|nie można|prosz[eę]\s+zaznacz(?:yć|yc)\s+obrazek\s+g[łl][oó]wny|wype[łl]nij\s+prawid[łl]owo\s+pola\s+w\s+formularzu/i.test(String(message))?'error':'notice'}]});
      }catch{}
      return Reflect.apply(original,this,arguments);
    };
  }
  return Object.freeze({installed:true,setEnabled(value){enabled=value===true;},setAction(value){
    if(core.productId(value?.productId)&&typeof value.actionId==='string')actionContext={productId:value.productId,actionId:core.cleanString(value.actionId),at:value.at};
  }});
  };
})(scope);


// ---- userscript-dom.js ----
(function(root) {
 root.StockLogUserscriptDOM=function(options) {
  'use strict';
  const core=options.core,StockLogForm=options.form;
  let active=true,lastUi='',lastForm='',route='',sessionId='',timer=null,uiTimer=null,lastFormAt=-Infinity,lastLabelsAt=-Infinity,lastLabels={},lastAction=null,visibleUi=new Map();
  const now=()=>new Date().toISOString();
  const idInPage=()=>core.productId(location.pathname.match(/^\/products\/([0-9a-f-]{36})(?:\/|$)/i)?.[1]);
  function currentProduct() {return idInPage()||(lastAction&&Date.now()-Date.parse(lastAction.at)<180000?lastAction.productId:null);}
  function settings(enabled) {options.capture.setEnabled(enabled);}
  async function status() {
    try {
      const reply=await options.request({type:'capture-status'});active=reply.enabled===true;
      if(!lastAction&&reply.lastAction)lastAction=reply.lastAction;
      settings(active);
    }catch{active=false;}
  }
  function deliver(event) {
    options.request({type:'capture-event',event}).then(reply=>{
      if(reply?.diagnostic) {active=false;settings(false);}
    }).catch(()=>{active=false;});
  }
  function collectForm(force=false) {
    const productId=idInPage();if(!active||!productId)return null;
    if(route!==location.pathname) {route=location.pathname;sessionId=crypto.randomUUID();lastForm='';lastUi='';lastFormAt=-Infinity;lastLabelsAt=-Infinity;lastLabels={};visibleUi=new Map();}
    if(!force&&(document.hidden||Date.now()-lastFormAt<3000))return null;lastFormAt=Date.now();
    const fields=StockLogForm.collect(document),signature=JSON.stringify(fields);
    if(Object.keys(fields).length&&signature!==lastForm) {lastForm=signature;deliver({kind:'form',productId,formId:sessionId,fields,at:now()});}
    return fields;
  }
  function collectUi() {
    if(!active||document.hidden)return;
    const productId=currentProduct();if(!productId){route='';return;}
    collectForm();
    let labels=lastLabels;
    if(idInPage()&&Date.now()-lastLabelsAt>=3000){labels={};for(const element of document.querySelectorAll('[id^="parameter_"]')) {
      const code=element.id.match(/^parameter_(\d+)/)?.[1],text=StockLogForm.label(element);
      if(code&&text)for(const prefix of ['allegroRequiredParameters','allegroNotRequiredParameters'])labels[`${prefix}.${code}`]=text;
    }lastLabelsAt=Date.now();lastLabels=labels;}
    const previousVisible=visibleUi;visibleUi=new Map();
    const actionId=lastAction?.actionId||null;
    const messages=[...document.querySelectorAll('mat-error,mat-snack-bar-container,mat-mdc-snack-bar-container,[role="alert"],[role="dialog"],.cdk-overlay-pane .error')]
      .filter(el=>el.getClientRects().length).map(el=>{
        const message=el.textContent.trim().slice(0,12000),previous=previousVisible.get(el);
        // A dialog still visible from an earlier attempt is evidence for that
        // attempt. Re-attribute it only after it disappears or its text changes.
        const messageAction=previous?.message===message?previous.actionId:actionId;
        visibleUi.set(el,{message,actionId:messageAction});
        return {message,source:el.matches('mat-error')?'walidacja pola':el.matches('[role="dialog"]')?'okno dialogowe':'komunikat strony',severity:el.matches('mat-error')||/błąd|błęd|nieprawidł|niepopraw|nie można|nie udało|wymagan|obowiązkow|error|invalid|failed|zajęt|niezgodn|odrzucon|brakuje|prosz[eę]\s+zaznacz(?:yć|yc)\s+obrazek\s+g[łl][oó]wny|wype[łl]nij\s+prawid[łl]owo\s+pola\s+w\s+formularzu/i.test(message)?'error':'notice',messageAction};
      }).filter(m=>m.message&&m.messageAction===actionId).map(({messageAction,...message})=>message).slice(0,30);
    const signature=JSON.stringify({productId,labels,messages,actionId:lastAction?.actionId});
    if(signature===lastUi)return;lastUi=signature;
    deliver({kind:'ui',productId,labels,messages,actionId:lastAction?.actionId||null,at:now()});
  }
  function action(label,type) {
    if(!active||!idInPage())return;
    const fields=collectForm(true)||{},at=now(),productId=idInPage();
    if(type==='submit'&&lastAction?.productId===productId&&Date.now()-Date.parse(lastAction.at)<500)return;
    lastAction={productId,actionId:crypto.randomUUID(),at};
    deliver({kind:'action',...lastAction,actionType:type,label:label.slice(0,250),fields});
    options.capture.setAction(lastAction);
    setTimeout(collectUi,0);setTimeout(collectUi,600);setTimeout(collectUi,1800);
  }
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-stocksell-recorder-ui]'))return;
    const button=event.target?.closest?.('button,[role="button"],a,input[type="submit"]');
    if(!button)return;
    const text=[button.textContent,button.getAttribute('aria-label'),button.getAttribute('title'),button.value].map(v=>String(v||'').replace(/\s+/g,' ').trim()).find(Boolean)||'';
    const type=core.actionType(text)||(button.type==='submit'?'submit':null);if(type)action(text,type);
  },true);
  document.addEventListener('submit',event=>{if(!event.target?.closest?.('[data-stocksell-recorder-ui]'))action('Wysłanie formularza','submit');},true);
  // Typing marks the form dirty; it never scans or writes the whole history
  // in the input event. A bounded fallback also catches silent .value updates.
  document.addEventListener('input',event=>{if(event.target?.closest?.('[data-stocksell-recorder-ui]'))return;clearTimeout(timer);timer=setTimeout(()=>collectForm(),900);},true);
  document.addEventListener('change',()=>{if(!uiTimer)uiTimer=setTimeout(()=>{uiTimer=null;collectUi();},300);},true);
  const observer=new MutationObserver(()=>{if(active&&!document.hidden&&!uiTimer)uiTimer=setTimeout(()=>{uiTimer=null;collectUi();},500);});
  // Global class/value changes used to rescan the page continuously. Native
  // value polling and forced action snapshots retain those values without it.
  observer.observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-invalid']});
  status();setInterval(status,15000);setInterval(collectUi,3000);
  return {collectUi,collectForm,refreshStatus:status};
 };
})(scope);


// ---- enrollment.js ----
(function(root){
'use strict';
const ENDPOINT='https://odlozone.estila.com.pl/recorder-ingest.php',BASE='estilaStocksellEnrollment.',CANDIDATE=BASE+'candidate.',CANONICAL=BASE+'canonical',REGISTERED=BASE+'registered.';
const valid=value=>value&&typeof value.id==='string'&&/^[a-f0-9]{32}$/.test(value.id)&&typeof value.key==='string'&&new RegExp('^'+value.id+'\\.[a-f0-9]{64}$').test(value.key)&&Number.isFinite(value.createdAt);
function create(options){
 const store=options.store,transport=options.transport,crypto=options.crypto||root.crypto,now=options.now||(()=>Date.now()),label=options.label||(()=>''),version=options.version||'0.4.1';
 let flight=null,nextPoll=0,failures=0,cached=null;
 const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 async function credentials(){
  let candidates=[];
  async function list(){const out=[];for(const name of await store.list())if(name.startsWith(CANDIDATE)){const value=await store.get(name,null);if(valid(value)&&name===CANDIDATE+value.id)out.push(value);}return out;}
  candidates=await list();const previous=await store.get(CANONICAL,null);
  if(valid(previous)&&!candidates.some(value=>value.id===previous.id)){await store.set(CANDIDATE+previous.id,previous);candidates.push(previous);}
  if(!candidates.length){const id=hex(crypto.getRandomValues(new Uint8Array(16))),secret=hex(crypto.getRandomValues(new Uint8Array(32))),value={id,key:id+'.'+secret,createdAt:now()};await store.set(CANDIDATE+id,value);candidates=await list();}
  candidates.sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));const selected=candidates[0];if(!valid(selected))throw new Error('credential_storage');
  await store.set(CANONICAL,selected);const saved=await store.get(CANONICAL,null);if(!valid(saved))throw new Error('credential_storage');return saved;
 }
 async function post(body,key){
  const headers={'Content-Type':'application/json','Accept':'application/json','Origin':'https://stocksell.io'};if(key)headers['X-Recorder-Key']=key;
  const response=await transport({method:'POST',url:ENDPOINT,headers,data:JSON.stringify(body),anonymous:true,redirect:'error',timeout:20000});
  let final;try{final=new URL(response.finalUrl||ENDPOINT);}catch{throw new Error('destination');}
  if(final.href!==ENDPOINT)throw new Error('destination');
  if(response.status!==200){const error=new Error('http');error.status=response.status;throw error;}
  let result;try{result=JSON.parse(response.responseText);}catch{throw new Error('response');}
  if(result?.ok!==true||typeof result.id!=='string'||!['pending','approved','revoked','rejected','unknown'].includes(result.state))throw new Error('response');return result;
 }
 async function register(credential){
  const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credential.key))));
  const displayLabel=String(await label()||'').replace(/\s+/g,' ').trim().slice(0,80)||'Stanowisko '+credential.id.slice(-8);
  const result=await post({action:'install-register',id:credential.id,keyHash:digest,label:displayLabel,clientVersion:version});
  if(result.id!==credential.id)throw new Error('identity');await store.set(REGISTERED+credential.id,true);return result;
 }
 async function run(metadata){
  let credential;
  try{
   credential=await credentials();
   if(cached?.id===credential.id&&now()<nextPoll)return cached.state==='approved'?{...cached,key:credential.key}:{...cached};
   const registered=await store.get(REGISTERED+credential.id,false);if(!registered)await register(credential);
   let result;
   try{result=await post({action:'install-status',pendingCount:Math.max(0,Math.min(10000,Number.isSafeInteger(metadata.pendingCount)?metadata.pendingCount:0)),clientVersion:version},credential.key);}catch(error){if(error.status!==401)throw error;await register(credential);result=await post({action:'install-status',pendingCount:Math.max(0,Math.min(10000,Number.isSafeInteger(metadata.pendingCount)?metadata.pendingCount:0)),clientVersion:version},credential.key);}
   if(result.id!==credential.id)throw new Error('identity');
   if(result.state==='unknown'){await register(credential);result=await post({action:'install-status',pendingCount:Math.max(0,Math.min(10000,Number.isSafeInteger(metadata.pendingCount)?metadata.pendingCount:0)),clientVersion:version},credential.key);if(result.id!==credential.id)throw new Error('identity');}
   failures=0;nextPoll=now()+60000;cached={id:credential.id,state:result.state};return result.state==='approved'?{...cached,key:credential.key}:{...cached};
  }catch{failures++;nextPoll=now()+Math.min(300000,60000*Math.pow(2,Math.min(failures-1,3)));cached={id:credential?.id||null,state:'offline'};return {...cached};}
 }
 async function authorize(metadata={}){if(flight)return flight;flight=run(metadata);try{return await flight;}finally{flight=null;}}
 return Object.freeze({authorize,invalidate(){nextPoll=0;cached=null;}});
}
root.StockLogEnrollment=Object.freeze({create,endpoint:ENDPOINT});
})(scope);

// ---- userscript-sync.js ----
(function(root){
'use strict';
const ENDPOINT='https://odlozone.estila.com.pl/recorder-ingest.php';
// Only fixed application errors may enter the local UI. Never echo arbitrary response bodies.
const SERVER_ERRORS=new Set(['Pojedynczy log przekracza limit 1 MiB.','Nieprawidłowy JSON.','Nieprawidłowa struktura danych.','Wymagane dane pojedynczego logu i rejestratora.','Nieprawidłowy identyfikator lub rewizja rejestratora.','Automatyczny import wymaga dokładnie jednego przypadku w wersji 2.','Ten identyfikator logu jest już przypisany do innego produktu.','Ta sama kolejność logu ma inną treść. Zachowano wcześniejszy zapis.','Rejestrator wysłał zbyt wiele zmian. Ponów za minutę.','Log jest zbyt rozbudowany. Podziel eksport na mniejsze części.','Nieprawidłowy zapis próby poprawki.','Nieprawidłowa zmiana pola w logu.','Nie udało się zapisać logu rejestratora.']);
function create(options){
 const runtime=options.runtime,transport=options.transport,keyProvider=options.keyProvider,now=options.now||(()=>Date.now());
 let busy=false,retryAt=0,failures=0,cursor=null;
 const report=async(state,message)=>runtime.request({type:'sync-status',state,message});
 const itemKey=item=>String(item.sourceId)+':'+String(item.caseId);
 const itemRef=item=>String(item.caseId||'').replace(/[^A-Za-z0-9._:-]/g,'').slice(-12)||'nieustalony';
 const serverError=result=>typeof result?.error==='string'&&SERVER_ERRORS.has(result.error)?result.error:'Serwer nie potwierdził zapisu logu.';
 function rateDelay(response){
  const value=/^retry-after:\s*([^\r\n]+)/im.exec(String(response.responseHeaders||''))?.[1]?.trim();
  const delay=value&&/^\d+$/.test(value)?Number(value)*1000:value?Date.parse(value)-now():60000;
  return Number.isFinite(delay)?Math.max(1000,Math.min(3600000,delay)):60000;
 }
 async function tick(){
  if(busy||now()<retryAt)return {ok:false,busy:true};
  busy=true;let sent=0,activeRef=null;
  try{
   const items=await runtime.pending();
   const authorization=await keyProvider({pendingCount:items.length}),key=authorization?.key;
   if(authorization?.state!=='approved'){const state=authorization?.state||'offline';await report(state==='offline'?'offline':'waiting',state==='pending'?'Stanowisko czeka na zatwierdzenie przez opiekuna. Logi pozostają lokalnie.':['revoked','rejected'].includes(state)?'Dostęp stanowiska jest wyłączony. Logi pozostają lokalnie.':'Nie potwierdzono dostępu stanowiska. Logi pozostają lokalnie.');return {ok:false,enrollment:state};}
   if(!items.length){await report('synced','Wszystkie zapisane zmiany zostały przesłane.');return {ok:true,sent:0};}
   if(typeof key!=='string'||!/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(key)){
    await report('missing_key','Brak klucza rejestratora. Nie potwierdzono tożsamości stanowiska. Logi pozostają lokalnie.');return {ok:false,missingKey:true};
   }
   await report('syncing','Wysyłanie logów w tle…');const diagnostics=[];
   const previous=items.findIndex(item=>itemKey(item)===cursor),start=previous<0?0:(previous+1)%items.length;
   const batch=Array.from({length:Math.min(5,items.length)},(_,index)=>items[(start+index)%items.length]);
   const failed=(item,kind,status,message)=>diagnostics.push({caseRef:itemRef(item),kind,httpStatus:Number.isInteger(status)?status:null,message});
   // Advance before each attempt: a failed item cannot hold the next bounded batch hostage.
   for(const item of batch){
    cursor=itemKey(item);activeRef=itemRef(item);
    let body;try{body=JSON.stringify({data:item.data,recorder:{sourceId:item.sourceId,caseId:item.caseId,sequence:item.sequence,revision:item.revision}});}catch{failed(item,'serialization',null,'Nie udało się przygotować logu.');continue;}
    if(new TextEncoder().encode(body).length>1048576){failed(item,'too_large',413,'Log przekracza limit 1 MiB i pozostał lokalnie.');continue;}
    const response=await transport({method:'POST',url:ENDPOINT,headers:{'Content-Type':'application/json','Accept':'application/json','X-Recorder-Key':key,'Origin':'https://stocksell.io'},data:body,anonymous:true,timeout:20000});
    let final;try{final=new URL(response.finalUrl||ENDPOINT);}catch{throw new Error('destination');}
    if(final.origin!=='https://odlozone.estila.com.pl'||final.pathname!=='/recorder-ingest.php')throw new Error('destination');
    if(response.status===401||response.status===403){options.invalidate?.();retryAt=now()+60000;await report('key_rejected','Serwer odrzucił klucz rejestratora. Logi pozostają lokalnie; opiekun musi sprawdzić klucz lub dostęp aplikacji.');return {ok:false,unauthorized:true,sent};}
    if(response.status===429){retryAt=now()+rateDelay(response);await report('error','HTTP 429: serwer ograniczył wysyłkę. Logi pozostają lokalnie; próba zostanie ponowiona.');return {ok:false,rateLimited:true,sent};}
    let result;try{result=JSON.parse(response.responseText);}catch{failed(item,'invalid_response',response.status,'Nieprawidłowa odpowiedź serwera.');continue;}
    if(response.status!==200){failed(item,'http',response.status,serverError(result));continue;}
    const counts=['imported','updated','skipped'].map(name=>result?.[name]);
    if(result?.ok!==true||counts.some(value=>!Number.isInteger(value)||value<0)||counts.reduce((a,b)=>a+b,0)!==1){failed(item,'not_acknowledged',response.status,'Brak jednoznacznego potwierdzenia odbioru.');continue;}
    if(!result.recorder||['sourceId','caseId','sequence','revision'].some(name=>result.recorder[name]!==item[name])){failed(item,'wrong_revision_ack',response.status,'Potwierdzenie dotyczy innej rewizji.');continue;}
    try{const acknowledged=await runtime.acknowledge(item.caseId,item.revision);if(acknowledged?.ok!==true)throw new Error('local_ack_failed');}catch{failed(item,'local_ack_failed',response.status,'Nie zapisano lokalnego potwierdzenia; log pozostał do ponowienia.');continue;}
    sent++;
   }
   failures=0;retryAt=0;const left=await runtime.pending();
   if(diagnostics.length){const first=diagnostics[0];await report('error',`Log ${first.caseRef}${first.httpStatus===null?'':': HTTP '+first.httpStatus}: ${first.message} Niepotwierdzone: ${diagnostics.length}; wysłane w partii: ${sent}. Pozostałe logi będą wysyłane dalej.`);return {ok:false,itemErrors:true,tooLarge:diagnostics.some(item=>item.kind==='too_large'),sent,diagnostics};}
   await report(left.length?'pending':'synced',left.length?'Kolejne logi czekają na wysłanie.':'Logi przesłano do „Zebranych logów”.');return {ok:true,sent};
  }catch{
   failures++;retryAt=now()+Math.min(300000,10000*Math.pow(2,Math.min(failures-1,5)));await report('offline',`${activeRef?'Log '+activeRef+': ':''}Nie potwierdzono odbioru (błąd połączenia lub obsługi kolejki). Dane pozostają lokalnie; wysyłka zostanie ponowiona.`);return {ok:false,retry:true,sent};
  }finally{busy=false;}
 }
 return Object.freeze({tick,refresh(){retryAt=0;return tick();}});
}
root.StockLogUserscriptSync=Object.freeze({create,endpoint:ENDPOINT});
})(scope);

// ---- panel.js ----
(function (root) {
  'use strict';
  function StockLogUserscriptPanel(options) {
    if (!options || typeof options.getData !== 'function') throw new TypeError('Rejestrator wymaga getData().');
    const core = options.core || {};
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const array = value => Array.isArray(value) ? value : [];
    const value = entry => {
      if (entry === null || entry === undefined) return '—';
      if (typeof entry === 'object') { try { return JSON.stringify(entry, null, 2); } catch { return '[Danych nie można wyświetlić]'; } }
      return String(entry);
    };
    const date = input => { const parsed = new Date(input); return input && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('pl-PL') : '—'; };
    const outcomes = {verified:'Potwierdzone odczytem',verification_needed:'Wymaga ponownego odczytu',failed:'Błąd zapisu / operacji',missing_before:'Brak danych przed',ui_error:'Błąd formularza',pending:'Oczekuje na odpowiedź',action_only:'Kliknięcie / bez potwierdzonego zapisu',followup_error:'Dane potwierdzone; błąd dalszej operacji'};
    const outcomeOptions = [['all','Wszystkie wyniki'],...Object.entries(outcomes)];
    const icons = {
      close:'<path d="m6 6 12 12M6 18 18 6"/>',
      download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
      refresh:'<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14 0M19 17a8 8 0 0 1-14 0"/>',
      list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
      search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>'
    };
    const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.list}</svg>`;
    const pill = status => `<span class="pill ${status === 'verified' ? 'good' : ['failed','missing_before','ui_error','followup_error'].includes(status) ? 'error' : ''}">${escape(outcomes[status] || status || 'Wynik nieustalony')}</span>`;
    const host = document.createElement('div');
    host.setAttribute('data-stocksell-recorder-ui', '');
    host.setAttribute('data-stocklog-ui', '');
    const shadow = host.attachShadow({mode:'closed'});
    let data = {enabled:true,operator:'',cases:[],diagnostic:null,sync:null}, selected = null, isOpen = false, generation = 0;
    shadow.innerHTML = `<style>
      :host{all:initial;color:#263f49;font-family:"Segoe UI",Arial,sans-serif;font-size:13px;line-height:1.5;direction:ltr}*,*:before,*:after{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer}button:disabled{cursor:wait;opacity:.6}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #a7d7cb;outline-offset:3px}button{border:1px solid #d9e4e5;border-radius:8px;background:#fff;color:#55717b;padding:9px 13px;display:inline-flex;align-items:center;justify-content:center;gap:7px;font-size:11px;line-height:1.4}button:hover{background:#f2f7f6}svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}.primary{background:#087f78;border-color:#087f78;color:#fff}.primary:hover{background:#086d67}.danger{color:#a7685d;border-color:#ecd9d3;background:#fffaf7}.floating{position:fixed;bottom:20px;right:20px;z-index:2147483645;box-shadow:0 6px 30px #173e4d2b;background:#087f78;border-color:#087f78;color:#fff;padding:12px 16px;border-radius:10px;font-size:11px;font-weight:600}.floating:hover{background:#086d67}.floating.off{background:#63777f;border-color:#63777f}.overlay{position:fixed;inset:0;z-index:2147483646;background:#17333f6b;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(3px);overscroll-behavior:contain}.overlay[hidden],.floating[hidden],[hidden]{display:none!important}.panel{width:min(1240px,100%);height:min(890px,calc(100vh - 48px));max-height:calc(100dvh - 48px);background:#f5f8f8;border:1px solid #d8e6e4;border-radius:16px;box-shadow:0 25px 100px #102d3b40;display:flex;flex-direction:column;overflow:hidden;min-width:0}.header{padding:22px 25px;background:#fff;border-bottom:1px solid #e2e9e9;display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.eyebrow{display:block;font-size:9px;font-weight:650;letter-spacing:1.5px;color:#8da39f;text-transform:uppercase;margin-bottom:6px}h1,h2,h3,h4,p{margin:0}h1{font-size:23px;font-weight:620;letter-spacing:-.7px;line-height:1.3}h2{font-size:17px;font-weight:620;line-height:1.5}h3{font-size:13px;font-weight:650;line-height:1.6}h4{font-size:11px;font-weight:600;line-height:1.6;margin:16px 0 7px}.subtitle{font-size:11px;color:#8b9ba2;line-height:1.7;margin-top:7px}.header-actions{display:flex;align-items:center;gap:8px;padding-top:3px}.close{border:0;background:transparent;padding:7px;min-width:30px}.body{overflow:auto;overscroll-behavior:contain;padding:20px 25px 25px;min-height:0;flex:1}.controls{display:flex;align-items:flex-end;gap:18px;background:#fff;border:1px solid #e1e9e8;border-radius:10px;padding:15px 18px;margin-bottom:15px}.recording-toggle{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;color:#527a6e;white-space:nowrap;padding:8px 0;flex-shrink:0}.recording-toggle input{accent-color:#0b8178;width:15px;height:15px;margin:0}.operator{margin-left:auto;display:flex;align-items:flex-end;gap:8px}.operator label{display:block;font-size:9px;color:#899ba4;margin-bottom:6px}.operator input{width:215px;max-width:100%;padding:8px 10px;border:1px solid #dae5e5;border-radius:6px;color:#3c5c68;background:#fff;font-size:11px;line-height:1.5}.sync-status{display:flex;align-items:center;justify-content:space-between;gap:20px;background:#edf6f2;border:1px solid #dcebe3;border-radius:9px;padding:15px 18px;margin-bottom:15px}.sync-status h2{font-size:12px;margin-bottom:6px;color:#527c6d}.sync-state{font-size:10px;font-weight:600;color:#718d80}.sync-description{font-size:10px;line-height:1.8;color:#81978d;margin-top:5px}.sync-meta{font-size:9px;color:#96a79e;line-height:1.8;margin-top:4px}.sync-status button{white-space:nowrap;flex-shrink:0}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;margin-bottom:16px}.metric{background:white;border:1px solid #e1e9e8;border-radius:9px;padding:13px 17px;font-size:10px;color:#8c9ca4;display:flex;align-items:center;justify-content:space-between;gap:10px}.metric strong{font-size:23px;letter-spacing:-.6px;font-weight:550;color:#41636b}.metric.good strong{color:#218573}.filters{display:flex;gap:10px;align-items:center;margin-bottom:14px}.search{position:relative;flex:1;max-width:420px}.search svg{position:absolute;top:10px;left:11px;width:14px;height:14px;color:#8b9ea7}.search input{width:100%;padding:9px 12px 9px 33px;border:1px solid #dce5e6;border-radius:7px;background:#fff;color:#48646d;font-size:10px}.filters select{max-width:310px;padding:8px 11px;border:1px solid #dce5e6;border-radius:7px;background:#fff;color:#69818a;font-size:10px;min-height:34px}.count{font-size:9px;color:#8c9ea6;margin-left:auto;white-space:nowrap}.workspace{display:grid;grid-template-columns:minmax(220px,.73fr) minmax(0,1.8fr);gap:16px;align-items:start}.cases{display:grid;gap:9px}.case{width:100%;display:block;text-align:left;padding:15px 16px;border:1px solid #dfe8e7;border-radius:9px;background:#fff;overflow-wrap:anywhere}.case[aria-pressed="true"]{border-color:#7db5a7;background:#f1f8f4;box-shadow:0 0 0 1px #7db5a7}.case strong{display:block;font-size:11px;line-height:1.7;color:#4e6a73;font-weight:620}.case small{display:block;font-size:9px;color:#91a2aa;margin-top:6px;line-height:1.8}.pill{display:inline-flex;padding:4px 7px;margin-top:9px;border-radius:4px;background:#f1f3e9;font-size:8px;color:#9a8b62;line-height:1.7;font-weight:550}.pill.good{background:#e7f5ee;color:#43876e}.pill.error{background:#fff0e8;color:#b17d65}.detail{min-width:0;background:#fff;border:1px solid #dfe8e7;border-radius:10px;padding:23px;overflow-wrap:anywhere}.detail-header{border-bottom:1px solid #e7eded;padding-bottom:19px;margin-bottom:20px}.detail-meta{font-size:9px;color:#90a1a9;line-height:1.9;margin-top:8px}.section-title{font-size:12px;margin:23px 0 11px;color:#52727c}.attempt{border:1px solid #e3ebe9;border-radius:8px;padding:15px;margin-top:12px;min-width:0}.attempt .meta{margin-top:5px}.meta{font-size:9px;color:#93a1a8;line-height:1.8}.empty{padding:38px 22px;text-align:center;color:#8fa0a8;font-size:11px;line-height:1.9}.empty strong{display:block;color:#5c7780;font-size:13px;font-weight:600;margin-bottom:8px}.empty-icon{display:inline-flex;width:44px;height:44px;align-items:center;justify-content:center;color:#7ea39a;background:#f0f7f3;border-radius:12px;margin-bottom:14px}.table-wrap{overflow:auto;margin-top:10px}table{width:100%;border-collapse:collapse;text-align:left;font-size:10px;table-layout:fixed}th{background:#f6f9f8;font-size:8px;font-weight:550;color:#90a2aa;padding:9px 10px;border:1px solid #e6edeb}td{padding:10px;border:1px solid #e6edeb;vertical-align:top;overflow-wrap:anywhere;color:#6d858e;line-height:1.7}td:first-child{color:#5c7580;font-weight:550}pre{font:10px/1.8 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;max-height:250px;overflow:auto;color:inherit}small{font-size:9px}.notice{font-size:10px;color:#638478;padding:10px 13px;background:#edf6f0;border:1px solid #dfece3;border-radius:7px;margin-bottom:13px;line-height:1.8}.notice.error,.warning{color:#a8795b;background:#fff6e9;border:1px solid #f0e2c9}.warning,.readme{padding:11px 13px;border-radius:7px;font-size:10px;line-height:1.8;margin-top:10px}.readme{background:#f3f7f8;color:#80939c;border:1px solid #e7edee}.warning pre{margin-top:5px}details{margin-top:12px;padding-top:10px;border-top:1px solid #e8eeed}summary{font-size:10px;color:#6d8e83;cursor:pointer;line-height:1.8}details>pre{margin-top:10px}.footer{margin-top:19px;padding-top:17px;border-top:1px solid #dfe8e5;display:flex;align-items:center;justify-content:space-between;gap:18px}.footer p{max-width:730px;font-size:9px;line-height:1.9;color:#8b9da6}.footer .danger{font-size:10px;flex-shrink:0}.timeline{padding-left:17px;font-size:9px;line-height:1.9;color:#8b9da5}.operator input:disabled{background:#f4f7f7}.screen-reader{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
      @media(max-width:900px){.header{padding:19px}.body{padding:17px 19px}.workspace{grid-template-columns:minmax(195px,.8fr) minmax(0,1.6fr)}.detail{padding:17px}.controls{flex-wrap:wrap;gap:9px}.operator{flex:1}.operator>div{flex:1}.operator input{width:100%}.recording-toggle{margin-right:15px}.header-actions button{font-size:10px;padding:8px 10px}.header-actions .close{padding:6px}.metric{padding:12px}.filters{flex-wrap:wrap}.filters select{max-width:100%;flex:1}.count{flex-basis:100%;margin-left:0}}
      @media(max-width:650px){.floating{right:12px;bottom:12px;padding:11px 13px;font-size:10px}.overlay{padding:8px}.panel{height:calc(100vh - 16px);max-height:calc(100dvh - 16px);border-radius:12px}.header{padding:16px;gap:10px;flex-wrap:wrap}.header h1{font-size:19px}.header .subtitle{font-size:10px}.header-actions{width:100%;padding-top:4px}.header-actions .primary{flex:1}.header-actions .close{position:absolute;right:20px;top:21px}.body{padding:14px 13px 18px}.controls{padding:13px}.recording-toggle{font-size:10px}.operator{flex-basis:100%;margin-left:0}.operator input{font-size:10px}.operator button{font-size:9px;padding-inline:10px}.sync-status{padding:13px;align-items:flex-start;flex-direction:column;gap:11px}.sync-status button{width:100%}.summary{grid-template-columns:1fr 1fr;gap:8px}.metric{padding:11px 13px;font-size:9px}.metric strong{font-size:21px}.workspace{grid-template-columns:1fr;gap:13px}.cases{max-height:235px;overflow:auto;overscroll-behavior:contain}.case{padding:12px 14px}.case strong{font-size:10px}.detail{padding:16px}.detail h2{font-size:15px}.attempt{padding:12px}table{min-width:440px}.search{max-width:none;flex-basis:100%}.filters select{font-size:9px}.footer{align-items:flex-start;flex-direction:column;gap:13px}.footer .danger{font-size:9px}.empty{padding:29px 18px}.header .eyebrow{font-size:8px}}
      @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
    </style><button class="floating" id="floating" type="button" aria-haspopup="dialog">${icon('list')}<span id="floating-label">Stocksell · Logi (0)</span></button><div class="overlay" id="overlay" hidden><section class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><header class="header"><div><span class="eyebrow">LOKALNA HISTORIA ZMIAN · PILOTAŻ</span><h1 id="panel-title" tabindex="-1">Rejestrator Stocksell</h1><p class="subtitle">Zarejestrowane próby, komunikaty i dane techniczne formularza.</p></div><div class="header-actions"><button id="refresh" type="button">${icon('refresh')}Odśwież</button><button id="export" type="button" class="primary">${icon('download')}Eksportuj logi JSON</button><button id="close" type="button" class="close" aria-label="Zamknij rejestrator">${icon('close')}</button></div></header><div class="body"><div class="controls"><label class="recording-toggle"><input id="recording" type="checkbox">Rejestrowanie włączone</label><div class="operator"><div><label for="operator">Oznaczenie pracownika <span>(opcjonalne)</span></label><input id="operator" maxlength="80" autocomplete="off" placeholder="np. stanowisko 1"></div><button id="save-operator" type="button">Zapisz oznaczenie</button></div></div><div id="notice" class="notice" role="status" hidden></div><div id="diagnostic" class="notice error" role="alert" hidden></div><section class="sync-status" aria-label="Synchronizacja logów"><div><h2>Synchronizacja z aplikacją</h2><div id="sync-state" class="sync-state"></div><p id="sync-description" class="sync-description"></p><p id="sync-meta" class="sync-meta"></p></div><button id="open-app" type="button" class="primary">Połącz / odnów logowanie</button></section><div id="summary" class="summary"></div><div class="filters"><label class="search">${icon('search')}<span class="screen-reader">Szukaj kodu lub nazwy</span><input id="search" type="search" placeholder="Szukaj kodu produktu lub nazwy…" maxlength="200"></label><label><span class="screen-reader">Wynik obsługi</span><select id="filter">${outcomeOptions.map(([key,label])=>`<option value="${escape(key)}">${escape(label)}</option>`).join('')}</select></label><span class="count" id="count"></span></div><div class="workspace"><section id="cases" class="cases" aria-label="Zarejestrowane produkty"></section><section id="detail" class="detail" aria-label="Szczegóły zmian produktu"></section></div><footer class="footer"><p>Logi wysyłają się w tle podczas pracy w Stocksellu. Karta aplikacji „Zwroty odłożone” może być zamknięta. Przy braku sieci lub ważnego klucza logi czekają w lokalnej kolejce. Eksport JSON pozostaje kopią zapasową. Rejestrator nie zmienia ofert.</p><button id="clear" type="button" class="danger">Usuń lokalne logi</button></footer></div></section></div>`;
    const $ = id => shadow.getElementById(id);
    function notify(message, error) { $('notice').textContent = message; $('notice').hidden = !message; $('notice').classList.toggle('error', !!error); }
    function errors(items) {
      return array(items).map(entry => { const item = entry && typeof entry === 'object' ? entry : {message:entry}; return `<div class="warning"><strong>${escape(item.message || 'Komunikat operacji')}</strong>${item.at ? `<div class="meta">${escape(date(item.at))}</div>` : ''}${item.details !== null && item.details !== undefined ? `<pre>${escape(value(item.details))}</pre>` : ''}</div>`; }).join('');
    }
    function formChanges(changes) {
      if (!array(changes).length) return '<p class="meta">Brak różnic względem poprzedniego uchwyconego formularza.</p>';
      return `<div class="table-wrap"><table><thead><tr><th>Pole formularza</th><th>Było</th><th>Teraz</th></tr></thead><tbody>${changes.map(change=>`<tr><td>${escape(change.label || change.field || change.key)}${change.kind && change.kind !== 'value' ? `<div class="meta">${change.kind === 'appeared' ? 'Pole pojawiło się' : 'Pole przestało być dostępne'}</div>` : ''}</td><td><pre>${escape(value(change.beforeText ?? change.before))}</pre></td><td><pre>${escape(value(change.afterText ?? change.after))}</pre></td></tr>`).join('')}</tbody></table></div>`;
    }
    function history(record) {
      const actions = array(record.actions), messages = array(record.uiMessages), operations = array(record.operations);
      if (!actions.length && !messages.length) return '';
      const steps = actions.map((action,index)=>{
        const notices = messages.filter(message=>message.actionId === action.actionId).map(message=>`<div class="${message.severity === 'error' ? 'warning' : 'readme'}"><strong>${message.severity === 'error' ? 'Błąd / walidacja' : 'Komunikat'}</strong> · ${escape(date(message.at))}<pre>${escape(message.message)}</pre></div>`).join('');
        const responses = operations.filter(operation=>operation.actionId === action.actionId).map(operation=>operation.error ? errors([operation.error]) : `<p class="meta">Odebrano odpowiedź operacji · HTTP ${escape(operation.httpStatus ?? '—')}</p>`).join('');
        return `<section class="attempt"><h3>${index+1}. ${escape(action.label || 'Próba zapisu')}</h3><p class="meta">${escape(date(action.at))} · zapisany stan formularza</p><details><summary>Zmiany formularza, także automatyczne (diagnostyka)</summary><p class="meta">${index ? 'Porównanie z poprzednią próbą.' : 'Porównanie z pierwszym uchwyconym formularzem.'} Obejmuje ładowanie pól i zmiany automatyczne; nie potwierdza, które poprawki wykonano ręcznie.</p>${formChanges(action.changes)}</details>${responses}${notices}</section>`;
      }).join('');
      const unlinked = messages.filter(message=>!message.actionId).map(message=>`<div class="${message.severity === 'error' ? 'warning' : 'readme'}">${escape(date(message.at))} · ${escape(message.message)}</div>`).join('');
      const timeline = array(record.timeline).map((entry,index)=>({...entry,index})).sort((a,b)=>(Date.parse(a.at)-Date.parse(b.at)) || a.index-b.index).map(entry=>`<li>${escape(date(entry.at))} · ${escape(entry.label || ({'save-start':'Wysłano dane produktu','save-response':'Odpowiedź zapisu','save-error':'Błąd zapisu','operation-error':'Błąd operacji','operation-response':'Odpowiedź operacji','ui-error':'Błąd formularza','ui-message':'Komunikat strony'}[entry.type] || entry.type || 'Zdarzenie'))}${entry.message ? ' · '+escape(entry.message) : ''}</li>`).join('');
      return `<h3 class="section-title">Przebieg obsługi i komunikaty</h3>${steps}${unlinked}${timeline ? `<details><summary>Chronologia zdarzeń</summary><ol class="timeline">${timeline}</ol></details>` : ''}`;
    }
    function attempts(record) {
      return array(record.attempts).map((attempt,index)=>{
        const confirmed = attempt.verification?.result === 'confirmed';
        const result = confirmed ? 'Potwierdzono ponownym odczytem' : attempt.error ? 'Zapis zgłosił błąd' : attempt.finishedAt ? 'Odebrano odpowiedź; zapis wymaga odczytu' : 'Oczekiwanie na odpowiedź';
        const rows = array(attempt.changes).map(change=>`<tr><td>${escape(change.label || core.labels?.[change.field] || change.field)}<div class="meta">${escape(change.field)}</div></td><td><pre>${escape(change.beforeKnown ? (change.beforeAbsent ? 'Brak pola' : value(change.beforeLabel ?? change.before)) : 'Brak wartości początkowej')}</pre></td><td><pre>${escape(change.removed ? 'Usunięto pole' : value(change.afterLabel ?? change.after))}</pre></td></tr>`).join('');
        return `<section class="attempt"><h3>Próba ${index+1} · ${escape(date(attempt.startedAt))}</h3><p class="meta">${escape(result)}${attempt.httpStatus !== null && attempt.httpStatus !== undefined ? ' · HTTP '+escape(attempt.httpStatus) : ''}</p>${!attempt.before ? '<div class="warning">Brak danych sprzed poprawki. Przy kolejnej poprawce otwórz produkt od początku po odświeżeniu Stocksella.</div>' : ''}${array(attempt.correctionsSincePrevious).length ? `<details><summary>Surowe różnice od poprzedniego żądania API</summary><p class="meta">Dane mogą obejmować normalizację i zmiany automatyczne; nie potwierdzają ręcznej poprawki.</p>${formChanges(attempt.correctionsSincePrevious)}</details>` : ''}<details><summary>Surowe różnice żądania API</summary><p class="meta">Porównanie techniczne wysłanych danych obejmuje też wartości automatyczne i zmiany formatu. Nie jest listą ręcznych poprawek.</p>${rows ? `<div class="table-wrap"><table><thead><tr><th>Pole</th><th>Było</th><th>${confirmed ? 'Potwierdzone' : 'Wysłano'}</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="meta">Brak różnic w porównywanych polach.</p>'}</details>${attempt.error ? errors([attempt.error]) : ''}${attempt.verification && !confirmed ? '<div class="warning">Ponowny odczyt nie potwierdził wszystkich wysłanych wartości. Oba stany pozostają w eksporcie.</div>' : ''}<details><summary>Dane techniczne przed i po</summary><h4>Przed</h4><pre>${escape(value(attempt.before))}</pre><h4>Wysłano</h4><pre>${escape(value(attempt.proposed))}</pre><p class="meta">${escape(attempt.method || '')} ${escape(attempt.endpoint || '')}</p></details></section>`;
      }).join('');
    }
    function renderDetail(record) {
      if (!record) { $('detail').innerHTML = `<div class="empty"><span class="empty-icon">${icon('list')}</span><strong>Wybierz zapisany produkt</strong>Po wybraniu pozycji zobaczysz zmienione pola, błędy i kolejne próby.</div>`; return; }
      $('detail').innerHTML = `<div class="detail-header"><span class="eyebrow">SZCZEGÓŁY PRODUKTU</span><h2>${escape(record.name || 'Produkt bez nazwy')}</h2><p class="detail-meta">Kod ${escape(record.code ?? '—')} · SKU ${escape(record.sku ?? '—')}<br>ID: ${escape(record.productId || '—')}${record.operator ? '<br>Oznaczenie: '+escape(record.operator) : ''}</p>${pill(record.outcome)}</div><div class="readme">To zapis pracy w Stocksellu. HTTP 200 samo w sobie nie potwierdza zapisu. Po poprawieniu ponownie otwórz produkt, aby potwierdzić wartości.</div>${history(record)}<h3 class="section-title">Żądania wysłane do Stocksella</h3>${attempts(record) || '<p class="meta">Nie zarejestrowano żądania zapisu. Sprawdź przebieg kliknięć i komunikaty formularza.</p>'}${!array(record.uiMessages).length && array(record.uiErrors).length ? `<h3 class="section-title">Komunikaty formularza</h3>${errors(record.uiErrors)}` : ''}`;
    }
    function render() {
      if(!isOpen){$('floating-label').textContent=data.diagnostic?'Stocksell · Logi — sprawdź':data.enabled?'Stocksell · Logi':'Stocksell · Logi — OFF';$('floating').classList.toggle('off',!data.enabled);return;}
      const records = [...array(data.cases)].reverse(), mode = $('filter').value, query = $('search').value.trim().toLocaleLowerCase('pl-PL');
      const visible = records.filter(record=>(mode === 'all' || record.outcome === mode) && (!query || [record.code,record.name,record.sku,record.operator].some(field=>String(field ?? '').toLocaleLowerCase('pl-PL').includes(query))));
      if (!visible.some(record=>record.caseId === selected)) selected = visible[0]?.caseId || null;
      $('floating-label').textContent = `Stocksell · Logi (${records.length})${data.enabled ? '' : ' · OFF'}`;
      $('floating').classList.toggle('off', !data.enabled);
      const incomplete=records.filter(record=>record.outcome==='missing_before').length;
      if(incomplete)$('floating-label').textContent+=' · BRAK DANYCH PRZED: '+incomplete;
      if(data.diagnostic||['missing_key','key_rejected','error'].includes(data.sync?.state))$('floating-label').textContent+=' · SPRAWDŹ';
      $('recording').checked = data.enabled === true;
      if (shadow.activeElement !== $('operator')) $('operator').value = data.operator || '';
      $('diagnostic').textContent = data.diagnostic || ''; $('diagnostic').hidden = !data.diagnostic;
      const sync = data.sync && typeof data.sync === 'object' ? data.sync : {};
      const syncLabels = {synced:'Zsynchronizowano',success:'Zsynchronizowano',syncing:'Trwa synchronizacja',pending:'Czeka na synchronizację',offline:'Aplikacja jest niedostępna',missing_key:'Brak klucza rejestratora',key_rejected:'Klucz odrzucony',waiting:'Czeka na zatwierdzenie stanowiska',error:'Synchronizacja wymaga sprawdzenia'};
      $('sync-state').textContent = syncLabels[sync.state] || 'Czeka na połączenie z aplikacją';
      $('sync-description').textContent = typeof sync.message === 'string' && sync.message ? sync.message : 'Stanowisko zgłasza się automatycznie. Opiekun zatwierdza dostęp. Do tego czasu i przy braku sieci logi pozostają lokalnie.';
      $('sync-meta').textContent = [typeof sync.pendingCases === 'number' ? `Oczekujących zapisów: ${sync.pendingCases}` : '',sync.lastSuccessAt ? `Ostatnia synchronizacja: ${date(sync.lastSuccessAt)}` : ''].filter(Boolean).join(' · ');

      const saved = records.filter(record=>record.outcome === 'verified').length;
      const tries = records.reduce((total,record)=>total+array(record.attempts).length,0);
      const errorsCount = records.reduce((total,record)=>total+array(record.uiErrors).length+array(record.attempts).filter(attempt=>attempt.error).length+array(record.operations).filter(operation=>operation.error).length,0);
      $('summary').innerHTML = [['Przypadki',records.length],['Potwierdzone odczytem',saved],['Próby zapisu',tries],['Komunikaty błędów',errorsCount]].map(([label,count],index)=>`<div class="metric${index === 1 ? ' good' : ''}"><span>${escape(label)}</span><strong>${escape(count)}</strong></div>`).join('');
      $('count').textContent = `Widoczne: ${visible.length} / ${records.length}`;
      $('cases').innerHTML = visible.length ? visible.map(record=>`<button type="button" class="case" data-case="${escape(record.caseId)}" aria-pressed="${record.caseId === selected}"><strong>${escape(record.name || 'Produkt bez nazwy')}</strong><small>Kod ${escape(record.code ?? '—')} · SKU ${escape(record.sku ?? '—')}</small>${pill(record.outcome)}<small>${escape(date(record.openedAt))}${record.operator ? ' · '+escape(record.operator) : ''}</small></button>`).join('') : `<div class="empty"><span class="empty-icon">${icon('list')}</span><strong>${records.length ? 'Brak pasujących zapisów' : 'Nie ma jeszcze logów'}</strong>${records.length ? 'Zmień szukany kod lub filtr wyniku.' : 'Odśwież Stocksell, otwórz produkt od początku i wykonaj potrzebną poprawkę. Pierwszy zapis pojawi się po próbie zapisu lub rozpoznanym błędzie.'}</div>`;
      renderDetail(visible.find(record=>record.caseId === selected));
    }
    async function refresh() {
      const current = ++generation;
      try { const incoming = await options.getData({full:isOpen}); if (current !== generation) return false; if (!incoming || typeof incoming !== 'object') throw new Error(); data = {enabled:incoming.enabled === true,operator:typeof incoming.operator === 'string' ? incoming.operator : '',cases:array(incoming.cases),diagnostic:incoming.diagnostic || null,sync:incoming.sync && typeof incoming.sync === 'object' ? incoming.sync : null}; render(); return true; }
      catch { if (current === generation) notify('Nie udało się odczytać lokalnych logów. Spróbuj odświeżyć panel.', true); return false; }
    }
    function open() { isOpen = true; $('overlay').hidden = false; $('floating').hidden = true; refresh(); $('panel-title').focus(); }
    function close() { isOpen = false; $('overlay').hidden = true; $('floating').hidden = false; $('floating').focus(); }
    function mount() { if (!host.isConnected && document.documentElement) document.documentElement.append(host); }
    async function action(button, work) { button.disabled = true; try { await work(); } catch { notify('Operacja nie powiodła się. Lokalne logi pozostają w rejestratorze.', true); } finally { button.disabled = false; } }
    $('open-app').hidden = typeof options.onOpenApp !== 'function';
    $('open-app').addEventListener('click',event=>action(event.currentTarget,async()=>{ if (typeof options.onOpenApp !== 'function') throw new Error(); await options.onOpenApp(); notify('Otworzono logowanie do aplikacji. Po połączeniu możesz zamknąć jej kartę — wysyłka logów będzie działać w tle podczas pracy w Stocksellu.'); }));
    $('floating').addEventListener('click',open); $('close').addEventListener('click',close);
    $('overlay').addEventListener('click',event=>{ if (event.target === $('overlay')) close(); });
    $('refresh').addEventListener('click',event=>action(event.currentTarget,async()=>{ if (typeof options.onRefresh === 'function') await options.onRefresh(); await refresh(); }));
    $('recording').addEventListener('change',event=>action(event.currentTarget,async()=>{ if (typeof options.onSettings !== 'function') throw new Error(); const result = await options.onSettings({enabled:event.currentTarget.checked}); if (result === false || result?.ok === false) throw new Error(); if (!await refresh()) return; notify(data.enabled ? 'Rejestrowanie włączone.' : 'Rejestrowanie zatrzymane.'); }));
    $('save-operator').addEventListener('click',event=>action(event.currentTarget,async()=>{ if (typeof options.onSettings !== 'function') throw new Error(); const result = await options.onSettings({operator:$('operator').value.trim()}); if (result === false || result?.ok === false) throw new Error(); if (!await refresh()) return; notify('Zapisano oznaczenie pracownika.'); }));
    $('export').addEventListener('click',event=>action(event.currentTarget,async()=>{ if (typeof options.onExport !== 'function') throw new Error(); const result = await options.onExport(); if (result === false || result?.cancelled) return; if (result?.ok === false) throw new Error(); notify('Przygotowano zapasowy eksport JSON. Sprawdź Pobrane lub wybrany folder. W razie potrzeby możesz dodać plik w aplikacji „Zwroty odłożone” → „Zebrane logi”.'); }));
    $('clear').addEventListener('click',event=>action(event.currentTarget,async()=>{ if (typeof options.onClear !== 'function') throw new Error(); const before = array(data.cases).length; const result = await options.onClear(); if (result === false || result?.cancelled) return; if (result?.ok === false) throw new Error(); if (!await refresh()) return; if (before && !array(data.cases).length) notify('Usunięto lokalne logi.'); else if (!array(data.cases).length) notify('Brak lokalnych logów do usunięcia.'); else notify('Lokalne logi pozostały bez zmian.'); }));
    $('search').addEventListener('input',render); $('filter').addEventListener('change',render);
    $('cases').addEventListener('click',event=>{ const button = event.target.closest('[data-case]'); if (button && $('cases').contains(button)) { selected = button.getAttribute('data-case'); render(); } });
    shadow.addEventListener('keydown',event=>{
      if (event.key === 'Escape' && isOpen) { event.preventDefault(); close(); }
      if (event.key === 'Tab' && isOpen) {
        const focusable = [...$('overlay').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(element=>!element.hidden && element.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1), current = shadow.activeElement;
        if (focusable.length && event.shiftKey && (current === first || current === $('panel-title'))) { event.preventDefault(); last.focus(); }
        else if (focusable.length && !event.shiftKey && current === last) { event.preventDefault(); first.focus(); }
      }
      event.stopPropagation();
    });
    for (const type of ['click','input','change']) shadow.addEventListener(type,event=>event.stopPropagation());
    mount(); if (!host.isConnected) document.addEventListener('DOMContentLoaded',mount,{once:true});
    refresh();
    return Object.freeze({open,refresh,close});
  }
  Object.defineProperty(root,'StockLogUserscriptPanel',{value:StockLogUserscriptPanel,configurable:true});
})(scope);


// ---- userscript-start.js ----
(function(root){
'use strict';
root.StockLogUserscriptStart=function(config){
 const scope=root,core=scope.StockLogCore;
 const store={get:(key,fallback)=>Promise.resolve(GM_getValue(key,fallback)),set:(key,value)=>Promise.resolve(GM_setValue(key,value)),list:()=>Promise.resolve(GM_listValues()),remove:key=>Promise.resolve(GM_deleteValue(key))};
 const runtime=scope.StockLogUserscriptRuntime.create({core,store,uuid:()=>crypto.randomUUID()});
 let panel=null,refreshTimer=null,uploadTimer=null,captureWarning=null;
 const refresh=()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{panel?.refresh().catch(()=>{});},500);};
 const transport=details=>new Promise((resolve,reject)=>{
  let settled=false,handle=null;
  const finish=(ok,value)=>{if(settled)return;settled=true;clearTimeout(watchdog);ok?resolve(value):reject(new Error(value));};
  // anonymous mode uses fetch in Chrome, where the native GM timeout is ineffective.
  const watchdog=setTimeout(()=>{if(settled)return;settled=true;try{handle?.abort();}catch{}reject(new Error('timeout'));},20000);
  try{handle=GM_xmlhttpRequest({...details,redirect:'error',onload:value=>finish(true,value),onerror:()=>finish(false,'network'),ontimeout:()=>finish(false,'timeout'),onabort:()=>finish(false,'abort')});}
  catch{finish(false,'request_failed');}
 });
 const enrollment=scope.StockLogEnrollment.create({store,transport,crypto,version:'0.4.1',label:()=>document.querySelector('[data-cy=username] .header')?.textContent||''});
 const sync=scope.StockLogUserscriptSync.create({runtime,transport,keyProvider:metadata=>enrollment.authorize(metadata),invalidate:()=>enrollment.invalidate()});
 function deliver(event){
  runtime.request({type:'capture-event',event}).then(reply=>{
   if(reply?.diagnostic)capture.setEnabled(false);
   refresh();clearTimeout(uploadTimer);uploadTimer=setTimeout(()=>sync.tick().then(refresh),3500);
  }).catch(()=>{capture.setEnabled(false);captureWarning='Nie udało się zapisać zdarzenia. Wcześniejsze logi pozostają lokalnie.';refresh();});
 }
 // Install synchronously: do not await GM storage before the initial product read.
 const capture=scope.StockLogUserscriptCapture({pageWindow:unsafeWindow,core,deliver});
 if(!capture.installed)return;
 const dom=scope.StockLogUserscriptDOM({core,form:scope.StockLogForm,capture,request:message=>runtime.request(message)});
 async function exportBackup(){
  const result=await runtime.request({type:'export'});if(result?.ok!==true)return {ok:false};
  const blob=new Blob([JSON.stringify(result.data,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download='stocksell-logi-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';link.style.display='none';document.documentElement.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return {ok:true};
 }
 function mount(){
  panel=scope.StockLogUserscriptPanel({core,
   getData:async({full}={})=>{const data=await runtime.request({type:full?'get-data':'get-summary'});if(captureWarning)data.diagnostic=captureWarning;return data;},
   onSettings:async changes=>{const reply=await runtime.request({type:'settings',...changes});await dom.refreshStatus();return reply;},
   onExport:exportBackup,
   onRefresh:()=>sync.refresh(),
   onClear:async()=>{
    const data=await runtime.request({type:'get-data'});if(!data.cases.length)return {cancelled:true};
    const pending=await runtime.pending();
    const text=pending.length?'UWAGA: część logów nie ma potwierdzenia odbioru przez serwer. Najpierw wykonaj eksport zapasowy. Usunąć te lokalne logi?':'Usunąć lokalne kopie logów? Potwierdzone dane pozostają na serwerze.';
    if(!window.confirm(text))return {cancelled:true};
    return runtime.request({type:'clear-logs',caseIds:data.cases.map(record=>record.caseId),confirmPending:pending.length>0});
   }
  });
  sync.tick().then(refresh);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
 setInterval(()=>sync.tick().then(refresh).catch(()=>{}),15000);
 setInterval(refresh,30000);
 window.addEventListener('online',()=>sync.refresh().then(refresh).catch(()=>{}));
};
})(scope);
scope.StockLogUserscriptStart({});
})();

 } catch (_) { console.warn('[Stocksell] Nie uruchomiono rejestratora poprawek.'); }
}
})();
