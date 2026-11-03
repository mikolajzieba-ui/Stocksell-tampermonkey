// ==UserScript==
// @name         Estila · Uwagi do odłożonych w Base
// @namespace    https://odlozone.estila.com.pl/base-notes
// @version      0.1.29
// @description  Poprawki przy produktach zwrotu: uwaga przed zmianą statusu. Pilotaż.
// @match        https://panel.baselinker.com/orders_returns.php*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// @downloadURL  https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/Base-uwagi-do-odlozonych.user.js
// @updateURL    https://raw.githubusercontent.com/mikolajzieba-ui/Stocksell-tampermonkey/main/Base-uwagi-do-odlozonych.user.js
// ==/UserScript==
(function () {
  'use strict';
  const TARGET = '16189';
  const MANUAL_PARAMETER = '__manual_parameter__';
  const FIELDS = [{"label":"Rozmiar","prefix":"rozmiar"},{"label":"Kolor","prefix":"kolor"},{"label":"Skład","prefix":"skład"},{"label":"Wada","prefix":"wada"},{"label":"Stopień wady","prefix":"stopień wady"},{"label":"Stan produktu","prefix":"stan"},{"label":"Metka papierowa","prefix":"metka papierowa"},{"label":"Metka wewnętrzna","prefix":"metka wewnętrzna"},{"label":"Opakowanie","prefix":"opakowanie"},{"label":"Sezon","prefix":"sezon"},{"label":"Rozmiar uniwersalny","prefix":"rozmiar uniwersalny"},{"label":"Tytuł oferty","prefix":"tytuł"},{"label":"Nazwa produktu","prefix":"nazwa"},{"label":"Marka","prefix":"marka"},{"label":"EAN / GTIN","prefix":"ean"},{"label":"Kategoria produktu i Allegro","prefix":"kategoria"},{"label":"Powiązanie z katalogiem","prefix":"katalog"},{"label":"Producent","prefix":"producent"},{"label":"Osoba odpowiedzialna","prefix":"osoba odpowiedzialna"},{"label":"Opcja wprowadzenia przed obowiązkiem GPSR","prefix":"wprowadzony przed obowiązkiem GPSR"},{"label":"Zdjęcia","prefix":"zdjęcie główne"},{"label":"Korekta istniejących Uwag / Informacji dodatkowych","prefix":"uwagi popraw"},{"label":"Cena Kup Teraz","prefix":"cena kup teraz"},{"label":"Cena startowa","prefix":"cena startowa"},{"label":"Kod producenta (Allegro)","prefix":"parametr Kod producenta ="},{"label":"Zapięcie (Allegro)","prefix":"parametr Zapięcie ="},{"label":"Płeć (Allegro)","prefix":"parametr Płeć ="},{"label":"Szerokość w pasie (cm) (Allegro)","prefix":"parametr Szerokość w pasie (cm) ="},{"label":"Odcień (Allegro)","prefix":"parametr Odcień ="},{"label":"Stan opakowania (Allegro)","prefix":"parametr Stan opakowania ="},{"label":"Długość wkładki (cm) (Allegro)","prefix":"parametr Długość wkładki (cm) ="},{"label":"Model (Allegro)","prefix":"parametr Model ="},{"label":"Materiał dominujący (Allegro)","prefix":"parametr Materiał dominujący ="},{"label":"Kod taryfy celnej (Allegro)","prefix":"parametr Kod taryfy celnej ="},{"label":"Długość nogawki (Allegro)","prefix":"parametr Długość nogawki ="},{"label":"Linia (Allegro)","prefix":"parametr Linia ="},{"label":"Oryginalne opakowanie producenta (Allegro)","prefix":"parametr Oryginalne opakowanie producenta ="},{"label":"Cechy dodatkowe (Allegro)","prefix":"parametr Cechy dodatkowe ="},{"label":"Dekolt (Allegro)","prefix":"parametr Dekolt ="},{"label":"Fason (Allegro)","prefix":"parametr Fason ="},{"label":"Wzór dominujący (Allegro)","prefix":"parametr Wzór dominujący ="},{"label":"Stan (wysokość w pasie) (Allegro)","prefix":"parametr Stan (wysokość w pasie) ="},{"label":"Materiał zewnętrzny (Allegro)","prefix":"parametr Materiał zewnętrzny ="},{"label":"Obszar nadruku (Allegro)","prefix":"parametr Obszar nadruku ="},{"label":"Kolor dodatkowy (Allegro)","prefix":"parametr Kolor dodatkowy ="},{"label":"Wysokość obcasa/platformy (cm) (Allegro)","prefix":"parametr Wysokość obcasa/platformy (cm) ="},{"label":"Rękaw (Allegro)","prefix":"parametr Rękaw ="},{"label":"Waga produktu z opakowaniem jednostkowym (kg) (Allegro)","prefix":"parametr Waga produktu z opakowaniem jednostkowym (kg) ="},{"label":"Długość (Allegro)","prefix":"parametr Długość ="},{"label":"Materiał wkładki (Allegro)","prefix":"parametr Materiał wkładki ="},{"label":"Rodzaj (Allegro)","prefix":"parametr Rodzaj ="},{"label":"Rodzaj nogawki (Allegro)","prefix":"parametr Rodzaj nogawki ="},{"label":"Skład materiałowy (Allegro)","prefix":"parametr Skład materiałowy ="},{"label":"Długość wkładki wew. (cm) (Allegro)","prefix":"parametr Długość wkładki wew. (cm) ="},{"label":"Nosek (Allegro)","prefix":"parametr Nosek ="},{"label":"Szerokość produktu (cm) (Allegro)","prefix":"parametr Szerokość produktu (cm) ="},{"label":"Przeznaczenie (Allegro)","prefix":"parametr Przeznaczenie ="},{"label":"Fason góry (Allegro)","prefix":"parametr Fason góry ="},{"label":"Okazja (Allegro)","prefix":"parametr Okazja ="},{"label":"Rozmiar obuwia (Allegro)","prefix":"parametr Rozmiar obuwia ="},{"label":"Liczba sztuk w zestawie (Allegro)","prefix":"parametr Liczba sztuk w zestawie ="},{"label":"Wysokość produktu (cm) (Allegro)","prefix":"parametr Wysokość produktu (cm) ="},{"label":"Styl (Allegro)","prefix":"parametr Styl ="},{"label":"Wysokość (Allegro)","prefix":"parametr Wysokość ="},{"label":"Liczba sztuk w ofercie (szt.) (Allegro)","prefix":"parametr Liczba sztuk w ofercie (szt.) ="},{"label":"Rodzaj zapięcia (Allegro)","prefix":"parametr Rodzaj zapięcia ="},{"label":"Wiek dziecka (Allegro)","prefix":"parametr Wiek dziecka ="},{"label":"Skład surowcowy (Allegro)","prefix":"parametr Skład surowcowy ="},{"label":"Rodzaj buta (Allegro)","prefix":"parametr Rodzaj buta ="},{"label":"Kategoria ochrony buta (Allegro)","prefix":"parametr Kategoria ochrony buta ="},{"label":"Sezon (Allegro)","prefix":"parametr Sezon ="},{"label":"Kod oznaczenia ochronnego (Allegro)","prefix":"parametr Kod oznaczenia ochronnego ="},{"label":"Wysokość całkowita (cm) (Allegro)","prefix":"parametr Wysokość całkowita (cm) ="},{"label":"Typ (Allegro)","prefix":"parametr Typ ="},{"label":"Podnosek (Allegro)","prefix":"parametr Podnosek ="},{"label":"Kolor podeszwy (Allegro)","prefix":"parametr Kolor podeszwy ="},{"label":"Nazwa koloru producenta (Allegro)","prefix":"parametr Nazwa koloru producenta ="},{"label":"Bohater / Bajka (Allegro)","prefix":"parametr Bohater / Bajka ="},{"label":"Średnica (cm) (Allegro)","prefix":"parametr Średnica (cm) ="},{"label":"Pojemność (l) (Allegro)","prefix":"parametr Pojemność (l) ="},{"label":"Pasuje do modelu (Allegro)","prefix":"parametr Pasuje do modelu ="},{"label":"Rodzaj obcasa (Allegro)","prefix":"parametr Rodzaj obcasa ="},{"label":"Długość całkowita (cm) (Allegro)","prefix":"parametr Długość całkowita (cm) ="},{"label":"Wypełnienie (Allegro)","prefix":"parametr Wypełnienie ="},{"label":"Wysokość (cm) (Allegro)","prefix":"parametr Wysokość (cm) ="},{"label":"Głębokość (krótszy bok) (cm) (Allegro)","prefix":"parametr Głębokość (krótszy bok) (cm) ="},{"label":"Wielkość (Allegro)","prefix":"parametr Wielkość ="},{"label":"Kolor okuć (Allegro)","prefix":"parametr Kolor okuć ="},{"label":"Liczba komór (Allegro)","prefix":"parametr Liczba komór ="},{"label":"Długość (cm) (Allegro)","prefix":"parametr Długość (cm) ="},{"label":"Liczba elementów w zestawie (Allegro)","prefix":"parametr Liczba elementów w zestawie ="},{"label":"Fason majtek (Allegro)","prefix":"parametr Fason majtek ="},{"label":"Długość spodni (Allegro)","prefix":"parametr Długość spodni ="},{"label":"Obwód kołnierzyka (cm) (Allegro)","prefix":"parametr Obwód kołnierzyka (cm) ="},{"label":"Szerokość cholewki (cm) (Allegro)","prefix":"parametr Szerokość cholewki (cm) ="},{"label":"Wysokość cholewki (cm) (Allegro)","prefix":"parametr Wysokość cholewki (cm) ="},{"label":"Poprawienie wcześniejszego opisu wady","prefix":"opis wady popraw"},{"label":"Usunięcie nieaktualnej wady","prefix":"opis wady usuń"},{"label":"Certyfikaty zgodności (Allegro)","prefix":"parametr Certyfikaty zgodności ="},{"label":"Tęgość (Allegro)","prefix":"parametr Tęgość ="},{"label":"Liczba kieszeni (Allegro)","prefix":"parametr Liczba kieszeni ="},{"label":"Długość nogawki od kroku (cm) (Allegro)","prefix":"parametr Długość nogawki od kroku (cm) ="},{"label":"Długość nogawki zewnętrzna (cm) (Allegro)","prefix":"parametr Długość nogawki zewnętrzna (cm) ="},{"label":"Szerokość w biodrach (cm) (Allegro)","prefix":"parametr Szerokość w biodrach (cm) ="},{"label":"Wysokość pasa (cm) (Allegro)","prefix":"parametr Wysokość pasa (cm) ="},{"label":"Długość rękawa (cm) (Allegro)","prefix":"parametr Długość rękawa (cm) ="},{"label":"Szerokość pod pachami (cm) (Allegro)","prefix":"parametr Szerokość pod pachami (cm) ="},{"label":"Szerokość w ramionach (cm) (Allegro)","prefix":"parametr Szerokość w ramionach (cm) ="},{"label":"Szerokość na dole produktu (cm) (Allegro)","prefix":"parametr Szerokość na dole produktu (cm) ="},{"label":"Zawartość zestawu (Allegro)","prefix":"parametr Zawartość zestawu ="},{"label":"Materiał podeszwy (Allegro)","prefix":"parametr Materiał podeszwy ="},{"label":"Kaptur (Allegro)","prefix":"parametr Kaptur ="},{"label":"Dodatkowe informacje (Allegro)","prefix":"parametr Dodatkowe informacje ="},{"label":"Certyfikaty, opinie, atesty (Allegro)","prefix":"parametr Certyfikaty, opinie, atesty ="},{"label":"Informacje dodatkowe (Allegro)","prefix":"parametr Informacje dodatkowe ="},{"label":"Materiał (Allegro)","prefix":"parametr Materiał ="},{"label":"Ocieplenie (Allegro)","prefix":"parametr Ocieplenie ="},{"label":"Stopień zaciemnienia (Allegro)","prefix":"parametr Stopień zaciemnienia ="},{"label":"Gramatura (g/m²) (Allegro)","prefix":"parametr Gramatura (g/m²) ="},{"label":"Długość paska (cm) (Allegro)","prefix":"parametr Długość paska (cm) ="},{"label":"Wysokość uchwytów (cm) (Allegro)","prefix":"parametr Wysokość uchwytów (cm) ="},{"label":"Kamizelka w zestawie (Allegro)","prefix":"parametr Kamizelka w zestawie ="},{"label":"Kolekcja (Allegro)","prefix":"parametr Kolekcja ="},{"label":"Głębokość produktu (cm) (Allegro)","prefix":"parametr Głębokość produktu (cm) ="},{"label":"Waga buta (g) (Allegro)","prefix":"parametr Waga buta (g) ="},{"label":"Właściwości (Allegro)","prefix":"parametr Właściwości ="},{"label":"Drop (mm) (Allegro)","prefix":"parametr Drop (mm) ="},{"label":"Stopień amortyzacji (Allegro)","prefix":"parametr Stopień amortyzacji ="},{"label":"Dystans (Allegro)","prefix":"parametr Dystans ="},{"label":"Imię na produkcie (Allegro)","prefix":"parametr Imię na produkcie ="},{"label":"Grubość (mm) (Allegro)","prefix":"parametr Grubość (mm) ="},{"label":"Sposób wykonania (Allegro)","prefix":"parametr Sposób wykonania ="},{"label":"Materiał ramy (Allegro)","prefix":"parametr Materiał ramy ="},{"label":"Materiał wykonania (Allegro)","prefix":"parametr Materiał wykonania ="},{"label":"Rodzaj klamry (Allegro)","prefix":"parametr Rodzaj klamry ="},{"label":"Elementy zestawu (Allegro)","prefix":"parametr Elementy zestawu ="},{"label":"Szerokość w biuście (cm) (Allegro)","prefix":"parametr Szerokość w biuście (cm) ="},{"label":"Waga (g) (Allegro)","prefix":"parametr Waga (g) ="},{"label":"Rozszerzenie (Allegro)","prefix":"parametr Rozszerzenie ="},{"label":"Funkcje (Allegro)","prefix":"parametr Funkcje ="},{"label":"Załączone wyposażenie (Allegro)","prefix":"parametr Załączone wyposażenie ="},{"label":"Motyw przewodni (Allegro)","prefix":"parametr Motyw przewodni ="},{"label":"Tematyka (Allegro)","prefix":"parametr Tematyka ="},{"label":"Kolor ramy (Allegro)","prefix":"parametr Kolor ramy ="},{"label":"Zestaw (Allegro)","prefix":"parametr Zestaw ="},{"label":"Liczba sztuk w zestawie (szt.) (Allegro)","prefix":"parametr Liczba sztuk w zestawie (szt.) ="},{"label":"Szerokość soczewki (mm) (Allegro)","prefix":"parametr Szerokość soczewki (mm) ="},{"label":"Szerokość mostka (mm) (Allegro)","prefix":"parametr Szerokość mostka (mm) ="},{"label":"Długość zausznika (mm) (Allegro)","prefix":"parametr Długość zausznika (mm) ="},{"label":"Szerokość pod biustem (cm) (Allegro)","prefix":"parametr Szerokość pod biustem (cm) ="},{"label":"Poziom wsparcia (Allegro)","prefix":"parametr Poziom wsparcia ="},{"label":"Haftki w zapięciu (Allegro)","prefix":"parametr Haftki w zapięciu ="},{"label":"Rodzaj spodni (Allegro)","prefix":"parametr Rodzaj spodni ="},{"label":"Maks. szerokość (cm) (Allegro)","prefix":"parametr Maks. szerokość (cm) ="},{"label":"Postać/temat (Allegro)","prefix":"parametr Postać/temat ="},{"label":"Format (Allegro)","prefix":"parametr Format ="},{"label":"Rozmiar kołnierzyka (Allegro)","prefix":"parametr Rozmiar kołnierzyka ="},{"label":"Wzrost (cm) (Allegro)","prefix":"parametr Wzrost (cm) ="},{"label":"Szerokość nogawki (cm) (Allegro)","prefix":"parametr Szerokość nogawki (cm) ="},{"label":"Okazje (Allegro)","prefix":"parametr Okazje ="},{"label":"Liczba przegródek na karty (Allegro)","prefix":"parametr Liczba przegródek na karty ="},{"label":"Wymiary (Allegro)","prefix":"parametr Wymiary ="},{"label":"Maksymalna grubość materaca (cm) (Allegro)","prefix":"parametr Maksymalna grubość materaca (cm) ="},{"label":"Certyfikat (Allegro)","prefix":"parametr Certyfikat ="},{"label":"Plecy (Allegro)","prefix":"parametr Plecy ="},{"label":"Szerokość (dłuższy bok) (cm) (Allegro)","prefix":"parametr Szerokość (dłuższy bok) (cm) ="},{"label":"Numer katalogowy producenta (Allegro)","prefix":"parametr Numer katalogowy producenta ="},{"label":"Dopasowanie rękawów (Allegro)","prefix":"parametr Dopasowanie rękawów ="},{"label":"Zdobienia (Allegro)","prefix":"parametr Zdobienia ="},{"label":"Szerokość paska (mm) (Allegro)","prefix":"parametr Szerokość paska (mm) ="},{"label":"Długość paska część ze sprzączką (mm) (Allegro)","prefix":"parametr Długość paska część ze sprzączką (mm) ="},{"label":"Długość paska część z dziurkami (mm) (Allegro)","prefix":"parametr Długość paska część z dziurkami (mm) ="},{"label":"Wysokość koperty (mm) (Allegro)","prefix":"parametr Wysokość koperty (mm) ="},{"label":"Szerokość koperty (mm) (Allegro)","prefix":"parametr Szerokość koperty (mm) ="},{"label":"Długość bransolety (mm) (Allegro)","prefix":"parametr Długość bransolety (mm) ="},{"label":"Kolekcja/Seria (Allegro)","prefix":"parametr Kolekcja/Seria ="},{"label":"Szerokość mocowania (mm) (Allegro)","prefix":"parametr Szerokość mocowania (mm) ="},{"label":"Język instrukcji (Allegro)","prefix":"parametr Język instrukcji ="},{"label":"Zawiera baterie (Allegro)","prefix":"parametr Zawiera baterie ="},{"label":"Kolor paska (Allegro)","prefix":"parametr Kolor paska ="},{"label":"Typ ochrony (Allegro)","prefix":"parametr Typ ochrony ="},{"label":"Orientacja (Allegro)","prefix":"parametr Orientacja ="},{"label":"Twardość (Allegro)","prefix":"parametr Twardość ="},{"label":"Gęstość pianki (kg/m3) (Allegro)","prefix":"parametr Gęstość pianki (kg/m3) ="},{"label":"Wysokość maksymalna (cm) (Allegro)","prefix":"parametr Wysokość maksymalna (cm) ="},{"label":"Liczba produktów w zestawie (szt.) (Allegro)","prefix":"parametr Liczba produktów w zestawie (szt.) ="},{"label":"Wymiary poduszki (Allegro)","prefix":"parametr Wymiary poduszki ="},{"label":"Zasilanie (Allegro)","prefix":"parametr Zasilanie ="},{"label":"Motyw (Allegro)","prefix":"parametr Motyw ="},{"label":"Rodzaj kołnierzyka (Allegro)","prefix":"parametr Rodzaj kołnierzyka ="},{"label":"Wysokość obcasa (cm) (Allegro)","prefix":"parametr Wysokość obcasa (cm) ="}];
  const isAllegroParameter = field => field.prefix.startsWith('parametr ') && field.prefix.endsWith(' =');
  const offlineParameters = [...new Set(FIELDS.filter(isAllegroParameter)
    .map(field => field.prefix.slice('parametr '.length, -' ='.length)))]
    .filter(name => !/^rozmiar (?:UK|US)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'pl'));
  const productStates = ['Nowy', 'Używany', 'Nowy bez metki', 'Nowy z defektem', 'Po zwrocie', 'Powystawowy'];
  const basicFields = FIELDS.filter(field => !isAllegroParameter(field));
  const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g,'l').trim();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const split = s => s === '' ? [] : s.split('|');
  function parseNote(raw, products) {
    const parts = split(raw), owned = new Map(), rest = [];
    products.forEach(p => owned.set(p.id, []));
    parts.forEach((text,index) => {
      const hits=[];
      const part = text.trim();
      for (const p of products) for (const key of p.keys) {
        if (!part.startsWith(key)) continue;
        const match = /^\s*[-\u2010-\u2015\u2212:]\s*([\s\S]*)$/.exec(part.slice(key.length));
        if (match) hits.push({p, key, value:match[1]});
      }
      // A second product key inside a fragment makes deletion unsafe.
      if (hits.some(hit => /(?:[,;\s])\s*(?:(?![0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}(?![0-9a-fA-F-]))[0-9]{4,}|stocksell_[0-9]+)\s*[-\u2010-\u2015\u2212:]|[;\r\n]\s*\S{1,128}\s*[-\u2010-\u2015\u2212:]/u.test(hit.value))) {
        rest.push({index,text});
        return;
      }
      const ids=[...new Set(hits.map(h=>h.p.id))];
      if(ids.length===1){const h=hits.sort((a,b)=>b.key.length-a.key.length)[0];owned.get(h.p.id).push({index,text,value:h.value,key:h.key});}
      else rest.push({index,text});
    });
    return {parts,owned,rest};
  }
  function mergeNote(raw, products, changes, restText) {
    const parsed=parseNote(raw,products), replacements=new Map(), removed=new Set(), extra=[];
    for(const p of products){
      if(!changes.has(p.id))continue;
      const value=changes.get(p.id).trim();
      if(/[|:\r\n]/.test(value))throw Error('W uwadze produktu nie używaj znaków | : ani nowych linii.');
      const old=parsed.owned.get(p.id);
      old.forEach(x=>removed.add(x.index));
      if(value){const text=(old[0]?.key||p.key)+'-'+value;if(old.length)replacements.set(old[0].index,text);else extra.push(text);}
    }
    const out=parsed.parts.flatMap((text,i)=>replacements.has(i)?[replacements.get(i)]:removed.has(i)?[]:[text]);
    if(restText!==undefined){const unchanged=parsed.rest.map(x=>x.text).join('|');if(restText!==unchanged){const restIds=new Set(parsed.rest.map(x=>x.index));const kept=parsed.parts.flatMap((t,i)=>replacements.has(i)?[replacements.get(i)]:removed.has(i)||restIds.has(i)?[]:[t]);return [...kept,...(restText?split(restText):[]),...extra].join('|');}}
    return [...out,...extra].join('|');
  }
  function clause(text, field, value, parameterChoices = null){
    if(!value.trim()||/[|;:\r\n]/.test(value))throw Error('Podaj wartość bez znaków | ; : i nowych linii.');
    const key = norm(field);
    const fields = parameterChoices === null ? basicFields
      : parameterChoices.map(name => ({label: name, prefix: 'parametr ' + name + ' ='}));
    const f = fields.find(item => norm(item.label) === key) ||
      (parameterChoices === null && fields.find(item => norm(item.label) === (key === 'stan' ? 'stan produktu' : key + ' (allegro)')));
    if (!f) throw Error('Wybierz pole z listy.');
    const photos=norm(f.label)==='zdjecia',command=photos&&norm(value)==='pomylone zdjecia'?'pomylone zdjęcia':f.prefix+' '+value.trim();
    const rows=text.split(';').map(x=>x.trim()).filter(Boolean), prefix=norm(f.prefix)+' ';
    const found=rows.findIndex(x=>norm(x).startsWith(prefix)||(photos&&norm(x)==='pomylone zdjecia'));if(found<0)rows.push(command);else rows[found]=command;
    return rows.join('; ');
  }
  function freeClause(text,value){
    value=value.trim();if(!value||/[|;:\r\n]/.test(value))throw Error('Wpisz jedną poprawkę bez znaków | ; : i nowych linii. Separator dodamy automatycznie.');
    const rows=text.split(';').map(x=>x.trim()).filter(Boolean);
    if(!rows.some(x=>norm(x)===norm(value)))rows.push(value);
    return rows.join('; ');
  }
  function appendDefectPreset(text, fragment, isDefect) {
    const current = text.trim();
    if (!current) return fragment;
    if (isDefect) return current + (/[.!?]$/.test(current) ? ' ' : '. ') + fragment;
    return current.replace(/\.+$/, '') + ' ' + fragment;
  }
  function defectClause(note, description, offerScope) {
    const details = description.trim();
    const scope = offerScope.trim();
    if (!details && !scope) throw Error('Wpisz opis wady albo uzupełnij pole „Oferta dotyczy”.');
    const existing = note.split(';').map(row => row.trim()).find(row => /^wada\s+/i.test(row));
    const previous = existing?.replace(/^wada\s+/i, '') || '';
    const scopeMarker = /(?:^|[.!?]\s+)oferta dotyczy\s+/i.exec(previous);
    const previousDetails = scopeMarker ? previous.slice(0, scopeMarker.index) : previous;
    const previousScope = scopeMarker ? previous.slice(scopeMarker.index + scopeMarker[0].length) : '';
    const combined = details && norm(details) !== norm(previousDetails)
      ? appendDefectPreset(previousDetails, details, true) : previousDetails;
    const finalScope = scope || previousScope;
    const text = finalScope ? appendDefectPreset(combined, 'Oferta dotyczy ' + finalScope, true) : combined;
    return clause(note, 'Wada', text);
  }
  /*CORE_END*/
  if(window.__estilaBaseNotes) return;
  window.__estilaBaseNotes=true;
  let session=null, bypass=false, wrap=null, originalStatus=null, scanTimer=null;
  const savedValues=new Map(), pending=new Map();
  // Stop page/document hotkeys while the overlay is open. Keep native typing/copy/paste.
  for(const type of ['keydown','keypress','keyup'])window.addEventListener(type,e=>{
    if(!session)return;
    const target=e.composedPath()[0];
    e.stopImmediatePropagation();
    if(type==='keydown'&&e.key==='Escape'){e.preventDefault();cancel();}
    else if(type==='keydown'&&e.key==='Enter'&&target?.matches?.('[data-value], [data-scope]')){e.preventDefault();const card=target.closest('.card');if(target.matches('[data-scope]'))addDefect(card);else add(card);}
  },true);

  const rid=()=>location.hash.match(/^#return:(\d+)$/)?.[1];
  const visible=e=>e&&e.getBoundingClientRect().width>0;
  const noteAnchor=()=>document.querySelector('a#oms_info_admin_comments');
  const noteValue=()=>{const a=noteAnchor();if(!a)throw Error('Zamknij natywny edytor uwag i spróbuj ponownie.');return a.textContent==='...'?'':a.textContent;};
  function products(){
    return [...document.querySelectorAll('tr[id^="sale_item_row_"]')].map(row=>{
      const select=row.querySelector('select.return_item_status'), name=row.querySelector('[data-tid="productName"] p');
      if(!select||!name||select.closest('tr')!==row||name.closest('tr')!==row||select.id!=='return_item_status_'+row.id.slice('sale_item_row_'.length))return null;
      const text=name.textContent.trim(), sku=text.match(/\[SKU\s+([^\]]+)\]/)?.[1]?.trim();
      const auctions=[...name.querySelectorAll('a[href]')].map(a=>{try{const u=new URL(a.href);return /(^|\.)allegro\.pl$/.test(u.hostname)?u.pathname.match(/\/(\d{8,})\/?$/)?.[1]:null;}catch{return null;}}).filter(Boolean);
      const stockCode = /^stocksell_([1-9][0-9]*)$/.exec(sku || '')?.[1];
      const keys = [...new Set([...auctions, sku, stockCode].filter(Boolean))];
      return {id:select.id.replace('return_item_status_',''),key:auctions[0]||sku,keys,sku,name:text.split('[EAN')[0].split('[SKU')[0].trim(),image:row.querySelector('img.img_thumb')?.src,select,row};
    }).filter(p=>p?.key&&p.keys.length);
  }
  const eligible=p=>p.select.value===TARGET;
  const identity=p=>JSON.stringify([p.id,p.key,p.sku||'',p.keys]);
  function currentSelection(s){
    if(rid()!==s.rid)throw Error('Otwarty zwrot się zmienił. Zamknij nakładkę i otwórz ją ponownie.');
    const all=products();
    for(const old of s.selected){
      const matches=all.filter(p=>p.id===old.id);
      if(matches.length!==1||identity(matches[0])!==identity(old))throw Error('Lista produktów w Base się zmieniła. Otwórz uwagę ponownie; niczego nie zapisano.');
      const p=matches[0];
      if(s.group&&!eligible(p))throw Error('Produkt nie ma już statusu Odłożone - do wystawienia. Otwórz uwagę ponownie; niczego nie zapisano.');
      if(!s.group&&p.select.value!==s.statuses.get(p.id))throw Error('Status produktu się zmienił. Otwórz uwagę ponownie; niczego nie zapisano.');
    }
    return all;
  }
  function moreOptions(s,all){
    return s.group?all.filter(p=>!s.selected.some(x=>x.id===p.id)&&eligible(p)):[];
  }
  function refreshMore(){
    if(!session)return;
    const picker=session.shadow.querySelector('#more-product');if(!picker)return;
    const previous=picker.value;
    const options=moreOptions(session,products());
    picker.innerHTML='<option value="">Wybierz inny produkt już odłożony…</option>'+options.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.key)}</option>`).join('');
    if(options.some(p=>p.id===previous))picker.value=previous;
  }
  function waitFor(fn,ms=12000){return new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{try{const v=fn();if(v)return resolve(v);}catch(e){return reject(e);}if(Date.now()-start>=ms)return reject(Error('Base nie potwierdziło zapisu. Status nie został przekazany; sprawdź Uwagi.'));setTimeout(check,150);};check();});}
  const css=`
    [data-category-filter]{width:100%}
[data-split-box] input{display:block;width:100%;margin:4px 0 8px}
    [data-product-state]{flex:1;min-width:0;max-width:100%}
  :host{font:15px system-ui;color:#183741}*{box-sizing:border-box}[hidden]{display:none!important}button,input,textarea,select{font:inherit}select{padding:8px;border:1px solid #bdcfd4;border-radius:7px;background:white}button{cursor:pointer;border:1px solid #d1dfe3;background:white;border-radius:8px;padding:8px 12px;color:#183741}button:hover{background:#edf7f6}button:disabled{opacity:.5;cursor:wait}.veil{position:fixed;inset:0;background:#16303e55;display:grid;place-items:center;padding:18px}.box{background:#f5f8f9;border-radius:16px;width:min(950px,100%);max-height:94vh;display:flex;flex-direction:column;box-shadow:0 15px 80px #102d4040}.head,.foot{padding:16px 22px;background:white;display:flex;gap:12px;align-items:center;justify-content:space-between}.head{border-radius:16px 16px 0 0}.foot{border-radius:0 0 16px 16px;flex-wrap:wrap}.body{padding:16px 22px;overflow:auto}h2{margin:0;font-size:21px}p{margin:5px 0;color:#657a82}.card{background:white;border:1px solid #dce7e8;border-radius:10px;padding:14px;margin-bottom:12px}.product{display:flex;gap:12px}.product img{width:48px;height:62px;object-fit:contain}.muted{font-size:12px;color:#627b83}.old{white-space:pre-wrap;background:#f1f5f6;padding:7px;border-radius:5px;margin:8px 0}textarea{width:100%;border:1px solid #bdcfd4;border-radius:7px;padding:9px;min-height:65px}input{border:1px solid #bdcfd4;border-radius:7px;padding:9px;min-width:0}.chips,.entry{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.entry input{flex:1}.entry input:first-child{flex:1.2}.primary{background:#07837f;color:white;border-color:#07837f}.danger{color:#a83c3c}.error{color:#a52c2c;white-space:pre-wrap}.preview{white-space:pre-wrap;overflow-wrap:anywhere;background:#eaf5f3;padding:10px;border-radius:8px}summary{cursor:pointer}label{display:block;margin-top:8px;font-size:13px}.count{font-size:12px}.small{font-size:12px}.title{flex:1}[data-defect-box]{padding:12px;margin-top:8px;background:#f5f8f9;border-radius:8px}[data-defect-box] .chips{margin:4px 0 8px}[data-defect-box] .chips button{padding:5px 9px}[data-scope]{width:100%}[data-defect-add]{margin-top:8px}`;
  const defectPresets = [
    ['Wada', ['Brak paska', 'Zabrudzone podeszwy', 'Delikatne ślady użytkowania', 'Ślady użytkowania',
      'Niesprawny zamek', 'Zabrudzenie', 'Zabrudzenia', 'Zarysowanie', 'Zarysowania',
      'Smugi', 'Zagniecenia', 'Przetarcia']],
    ['Strona', ['z prawej strony', 'z lewej strony', 'z przodu', 'z tyłu']],
    ['Miejsce', ['na prawym bucie', 'na lewym bucie', 'na nosku', 'na cholewce',
      'na zapiętku', 'przy sznurówkach', 'na wkładce', 'przy zamku']],
  ];
  function defectEditor() {
    const groups = defectPresets.map(([label, choices], index) => `
      <div role="group" aria-label="${esc(label)}">
        <p class="small">${esc(label)}</p>
        <div class="chips">${choices.map(choice => `<button type="button" data-defect-preset="${esc(choice)}"
          data-new-defect="${index === 0}">${esc(choice)}</button>`).join('')}</div>
      </div>`).join('');
    return `<div data-defect-box hidden>${groups}
      <label>Opis wady</label>
      <textarea data-defect aria-label="Opis wady" placeholder="Wybierz kafelek albo wpisz opis ręcznie"></textarea>
      <button type="button" data-defect-add>Dodaj</button>
    </div><div class="entry" data-scope-box hidden>
      <input value="Oferta dotyczy" aria-label="Pole poprawki oferty" readonly>
      <input data-scope aria-label="Czego dotyczy oferta" placeholder="Np. tylko prawego buta">
      <button type="button" data-defect-add>Dodaj</button>
    </div>`;
  }
  function splitEditor() {
    return `<div data-split-box hidden>
      <p class="small">Wpisz kategorię każdej części. Możesz dopisać kolor lub rozmiar.</p>
      <label>Część 1 <input data-split-category placeholder="Np. Bluzy, granatowy, M"></label>
      <label>Część 2 <input data-split-category placeholder="Np. Spodnie, czarny, L"></label>
      <button type="button" data-split-add>Dodaj</button>
    </div>`;
  }
  function setEditor(card, editor) {
    const helper = card.querySelector('[data-helper]');
    helper.hidden = editor !== 'helper' && editor !== 'parameter';
    if (!helper.hidden) {
      const parameterMode = editor === 'parameter';
      helper.dataset.mode = editor;
      const field = card.querySelector('[data-field]');
      const value = card.querySelector('[data-value]');
      field.hidden = parameterMode;
      card.querySelector('[data-product-parameters]').hidden = !parameterMode;
      value.setAttribute('aria-label', parameterMode ? 'Wartość parametru' : 'Wartość poprawki');
    }
    card.querySelector('[data-manual-parameter]').hidden = editor !== 'parameter' || card.querySelector('[data-product-parameters]').value !== MANUAL_PARAMETER;
    card.querySelector('[data-category-box]').hidden = editor !== 'category';
    card.querySelector('[data-state-box]').hidden = editor !== 'state';
    card.querySelector('[data-custom-box]').hidden = editor !== 'custom';
    card.querySelector('[data-defect-box]').hidden = editor !== 'defect';
    card.querySelector('[data-scope-box]').hidden = editor !== 'scope';
    card.querySelector('[data-split-box]').hidden = editor !== 'split';
  }
  function showParameterChoices(card, choices) {
    const list = card.querySelector('[data-product-parameters]');
    const selected = list.value;
    list.replaceChildren(new Option('Wybierz parametr produktu…', ''),
      new Option('Wpisz własny parametr…', MANUAL_PARAMETER),
      ...choices.map(name => new Option(name, name)));
    if (selected === MANUAL_PARAMETER || choices.includes(selected)) list.value = selected;
    list.disabled = false;
  }
  function addCategory(card) {
    const add = card.querySelector('[data-category-add]');
    const filter = card.querySelector('[data-category-filter]');
    const parts = filter.value.trim().split(/\s*(?:->|>|→)\s*/u);
    const categoryValue = parts.every(Boolean) ? parts.join(' → ') : '';
    if (!categoryValue) {
      message('Wpisz nazwę lub opis kategorii, np. top damski.', true);
      return false;
    }
    const note = card.querySelector('[data-note]');
    try {
      note.value = clause(note.value, 'Kategoria produktu i Allegro', categoryValue);
    } catch (error) {
      message(error.message, true);
      return false;
    }
    add.disabled = true;
    card.querySelector('[data-mode]').value = 'edit';
    filter.value = '';
    card.querySelector('[data-category-status]').textContent = 'Dodano do uwagi: ' + categoryValue;
    filter.focus();
    update();
    return true;
  }
  function addState(card) {
    const select = card.querySelector('[data-product-state]');
    if (!productStates.includes(select.value)) {
      message('Wybierz stan produktu z listy.', true);
      return false;
    }
    const note = card.querySelector('[data-note]');
    note.value = clause(note.value, 'Stan produktu', select.value);
    card.querySelector('[data-mode]').value = 'edit';
    select.value = '';
    update();
    return true;
  }
  function onlyDefectLocation(text) {
    let remaining = norm(text);
    if (!remaining) return false;
    const places = defectPresets.slice(1).flatMap(([, choices]) => choices.map(norm));
    while (remaining) {
      const place = places.find(value => remaining === value || remaining.startsWith(value + ' '));
      if (!place) return false;
      remaining = remaining.slice(place.length).trim();
    }
    return true;
  }
  function open(ids,triggered=false){
    if(!rid())return;
    if(session){if(triggered)message('Dodano kolejną oczekującą zmianę statusu. Zapisz obecne uwagi, następnie otwórz pozostałą pozycję.');return;}
    try{
      const all=products(), raw=noteValue(), parsed=parseNote(raw,all), wanted=new Set(ids);
      const selected=all.filter(p=>wanted.has(p.id));if(!selected.length||selected.length!==wanted.size||new Set(selected.map(p=>p.id)).size!==selected.length)throw Error('Nie odczytano jednoznacznego identyfikatora produktu.');
      const group=selected.every(eligible);
      if(!group&&(selected.length!==1||triggered))throw Error('Wspólne okno może zawierać tylko produkty ze statusem Odłożone - do wystawienia.');
      if(document.querySelector('#oms_info_form'))throw Error('Najpierw zakończ otwartą edycję danych zwrotu.');
      const host=document.createElement('div');host.id='estila-base-notes';host.style.cssText='position:fixed;inset:0;z-index:2147483000';const shadow=host.attachShadow({mode:'open'});
      session={rid:rid(),all,selected,group,statuses:new Map(selected.map(p=>[p.id,p.select.value])),raw,parsed,host,shadow,busy:false,initial:new Map()};
      shadow.innerHTML=`<style>${css}</style><div class="veil"><section class="box" role="dialog" aria-modal="true" aria-label="Uwagi do produktów"><header class="head"><div><h2>${group?'Poprawki do wystawienia':'Uwaga do produktu'}</h2><p>Zwrot ${esc(rid())} · kod produktu dodaje się automatycznie</p></div><button id="cancel">Anuluj</button></header><main class="body">${selected.map(p=>{
        const old=parsed.owned.get(p.id).map(x=>x.value).join('; ');session.initial.set(p.id,old);
        return `<article class="card" data-id="${esc(p.id)}"><div class="product">${p.image?`<img src="${esc(p.image)}" alt="">`:''}<div class="title"><b>${esc(p.name)}</b><p class="muted">Aukcja / kod ${esc(p.key)} · SKU ${esc(p.sku||'—')}</p></div></div><p class="small" data-product-status>Status: ${esc(p.select.selectedOptions[0]?.textContent||p.select.value)}${group?'':' · zapis uwagi nie zmienia statusu'}</p>${old?`<div class="old small">Obecna uwaga: ${esc(old)}</div><label>Co zrobić z obecną uwagą?</label>`:''}<select data-mode aria-label="Działanie dla starej uwagi" ${old?'':'hidden'}><option value="edit" selected>Zastąp uwagę</option><option value="keep">Zachowaj bez zmian</option><option value="delete">Usuń uwagę</option></select><label>${old?'Nowa treść uwagi (puste pole zachowa obecną)':'Co trzeba poprawić w tym produkcie?'}</label><textarea data-note="${esc(p.id)}" aria-label="Uwaga ${esc(p.key)}"></textarea><div class="chips">${['Rozmiar','Kolor','Skład','Kategoria','Wada','Oferta dotyczy','Stan','Metka papierowa','Metka wewnętrzna','Tytuł','Marka','Zdjęcia'].map(t=>`<button data-quick="${esc(t)}">${esc(t)}</button>`).join('')}<button data-split-toggle type="button">Rozbicie kategorii</button><button data-custom-toggle type="button">Uwaga</button><button data-parameter-toggle type="button">Inna wartość – parametr</button></div><div data-category-box hidden>
          <label>Kategoria</label>
          <input data-category-filter aria-label="Kategoria" placeholder="Np. top damski" autocomplete="off">
          <p class="small">Wpisz nazwę kategorii lub krótki opis produktu.</p>
          <p class="small" data-category-status role="status"></p>
          <button type="button" data-category-add disabled>Dodaj</button>
        </div>
        <div data-state-box hidden>
          <label>Stan produktu</label>
          <div class="entry">
            <select data-product-state aria-label="Stan produktu">
              <option value="">Wybierz stan produktu…</option>
              ${productStates.map(state => `<option>${esc(state)}</option>`).join('')}
            </select>
            <button type="button" data-state-add>Dodaj</button>
          </div>
        </div><div data-custom-box hidden><label>Treść uwagi</label><textarea data-custom aria-label="Własna poprawka" placeholder="Wpisz treść uwagi"></textarea><button data-custom-add type="button">Dodaj</button></div>${defectEditor()}${splitEditor()}<div class="entry" data-helper><input data-field list="fields" placeholder="Znajdź pole podstawowe…" aria-label="Pole poprawki"><select data-product-parameters aria-label="Nazwa parametru" hidden disabled><option value="">Wybierz parametr</option></select><input data-manual-parameter placeholder="Wpisz nazwę parametru…" aria-label="Własna nazwa parametru" hidden><input data-value placeholder="Prawidłowa wartość…" aria-label="Wartość poprawki"><button data-add>Dodaj</button></div></article>`;
      }).join('')}${group&&all.some(p=>!wanted.has(p.id)&&eligible(p))?`<div class="entry"><select id="more-product" aria-label="Kolejny produkt"><option value="">Wybierz inny produkt już odłożony…</option>${all.filter(p=>!wanted.has(p.id)&&eligible(p)).map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.key)}</option>`).join('')}</select><button id="more-add" type="button">Dodaj uwagi do innego odłożonego produktu</button></div>`:''}<datalist id="fields">${basicFields.filter(field => !['kategoria','stan'].includes(field.prefix)).map(f=>`<option value="${esc(f.label)}"></option>`).join('')}</datalist><details ${parsed.rest.some(x=>x.text.trim())?'open':''} ${parsed.rest.some(x=>x.text.trim())?'':'hidden'}><summary>Stary tekst bez przypisanego produktu</summary><p class="small">Base zawiera ten tekst, ale nie wiadomo, którego produktu dotyczy. Wybierz, czy go zachować, poprawić, usunąć lub przypisać.</p><textarea id="rest">${esc(parsed.rest.map(x=>x.text).join('|'))}</textarea><div class="entry"><select id="assign-product" aria-label="Produkt dla starego tekstu">${selected.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><button id="assign-rest">Przypisz tekst do produktu</button><button id="clear-rest" class="danger">Usuń ten tekst</button></div></details><label>Podgląd uwagi do zapisania w Base</label><div class="preview" id="preview"></div><div class="count" id="count"></div><p id="message" role="status"></p></main><footer class="foot"><span class="muted">${pending.size?'Najpierw zapis uwagi, potem ręcznie wybrana zmiana statusu.':'Zapisujesz tylko uwagi. Statusy produktów pozostają bez zmian.'}</span><button class="primary" id="save">Zapisz uwagi${pending.size?' i status':''}</button></footer></section></div>`;
      document.body.append(host);shadow.querySelector('#cancel').onclick=cancel;if(shadow.querySelector('#more-add')){shadow.querySelector('#more-add').onclick=addProduct;shadow.querySelector('#more-product').addEventListener('focus',refreshMore);}shadow.querySelector('#assign-rest').onclick=assignRest;shadow.querySelector('#clear-rest').onclick=()=>{shadow.querySelector('#rest').value='';update();};
      shadow.querySelectorAll('[data-quick]').forEach(button => button.onclick = () => {
        const card = button.closest('.card');
        if (button.dataset.quick === 'Kategoria') {
          setEditor(card, 'category');
          const filter = card.querySelector('[data-category-filter]');
          filter.focus();
          return;
        }
        if (button.dataset.quick === 'Stan') {
          setEditor(card, 'state');
          card.querySelector('[data-product-state]').focus();
          return;
        }
        if (button.dataset.quick === 'Wada') {
          setEditor(card, 'defect');
          card.querySelector('[data-defect]').focus();
          return;
        }
        if (button.dataset.quick === 'Oferta dotyczy') {
          setEditor(card, 'scope');
          card.querySelector('[data-scope]').focus();
          return;
        }
        const wasParameter = card.querySelector('[data-helper]').dataset.mode === 'parameter';
        setEditor(card, 'helper');
        if (wasParameter) card.querySelector('[data-value]').value = '';
        card.querySelector('[data-field]').value = (button.dataset.quick === 'Tytuł' ? 'Tytuł oferty' : button.dataset.quick);
        const value = card.querySelector('[data-value]');
        if (button.dataset.quick === 'Zdjęcia') value.value = 'pomylone zdjęcia';
        else if (value.value === 'pomylone zdjęcia') value.value = '';
        value.focus();
      });
      shadow.querySelectorAll('[data-custom-toggle]').forEach(b=>b.onclick=()=>{const card=b.closest('.card');setEditor(card,'custom');card.querySelector('[data-custom]').focus();});
      shadow.querySelectorAll('[data-parameter-toggle]').forEach(button => button.onclick = () => {
        const card = button.closest('.card');
        const wasParameter = card.querySelector('[data-helper]').dataset.mode === 'parameter';
        const list = card.querySelector('[data-product-parameters]');
        if (!wasParameter) {
          list.value = '';
          card.querySelector('[data-value]').value = '';
        }
        showParameterChoices(card, offlineParameters);
        setEditor(card, 'parameter');
        list.focus();
        message('Ogólna lista parametrów. Wybierz nazwę lub wpisz własną. Automat sprawdzi, czy parametr występuje w kategorii produktu.');
      });
      shadow.querySelectorAll('[data-product-parameters]').forEach(list => list.onchange = () => {
        const card = list.closest('.card');
        setEditor(card, 'parameter');
        card.querySelector(list.value === MANUAL_PARAMETER ? '[data-manual-parameter]' : '[data-value]').focus();
      });
      shadow.querySelectorAll('[data-defect-preset]').forEach(button => button.onclick = () => {
        const card = button.closest('.card');
        const input = card.querySelector('[data-defect]');
        const fragment = button.dataset.defectPreset;
        const isDefect = button.dataset.newDefect === 'true';
        input.value = isDefect && onlyDefectLocation(input.value)
          ? fragment + ' ' + input.value.trim()
          : appendDefectPreset(input.value, fragment, isDefect);
        input.focus();
      });
      shadow.querySelectorAll('[data-category-filter]').forEach(input => input.oninput = () => {
        const card = input.closest('.card');
        const add = card.querySelector('[data-category-add]');
        add.disabled = !input.value.trim();
        card.querySelector('[data-category-status]').textContent = '';
      });
      shadow.querySelectorAll('[data-category-add]').forEach(button => button.onclick = () => addCategory(button.closest('.card')));
      shadow.querySelectorAll('[data-split-toggle]').forEach(button => button.onclick = () => {
        const card = button.closest('.card');
        setEditor(card, 'split');
        card.querySelector('[data-split-category]').focus();
      });
      shadow.querySelectorAll('[data-split-add]').forEach(button => button.onclick = () => addSplit(button.closest('.card')));
      shadow.querySelectorAll('[data-state-add]').forEach(button => button.onclick = () => addState(button.closest('.card')));
      shadow.querySelectorAll('[data-defect-add]').forEach(button => button.onclick = () => addDefect(button.closest('.card')));
      shadow.querySelectorAll('[data-custom-add]').forEach(b=>b.onclick=()=>addCustom(b.closest('.card')));
      shadow.querySelectorAll('[data-clear]').forEach(b=>b.onclick=()=>{b.closest('.card').querySelector('[data-mode]').value='delete';update();});
      shadow.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>add(b.closest('.card')));
      shadow.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel();}if(e.key==='Enter'&&e.target.matches('[data-value]')){e.preventDefault();add(e.target.closest('.card'));}});
      shadow.addEventListener('input',e=>{if(e.target.matches('[data-note],[data-value],[data-custom],[data-defect],[data-scope]'))e.target.closest('.card').querySelector('[data-mode]').value='edit';update();});shadow.addEventListener('change', event => {
        if (event.target.matches('[data-mode]')) {
          const card = event.target.closest('.card');
          if (event.target.value === 'delete' || event.target.value === 'keep') {
            const add = card.querySelector('[data-category-add]');
            add.disabled = true;
            card.querySelector('[data-category-filter]').value = '';
            card.querySelector('[data-category-status]').textContent = '';
            card.querySelectorAll('[data-note],[data-value],[data-custom],[data-defect],[data-scope],[data-product-state],[data-manual-parameter],[data-split-box] input').forEach(input => {
              input.value = '';
            });

          }
        }
        update();
      });shadow.querySelector('#save').onclick=save;update();
      shadow.querySelector('[data-field]').value='Rozmiar';shadow.querySelector('[data-value]').focus();
    }catch(e){alert('Nakładka Estila: '+e.message);}
  }
  function assignRest(){
    const s=session,text=s.shadow.querySelector('#rest').value.trim();if(!text)return;
    if(/[|:\r\n]/.test(text)){message('Najpierw popraw stary tekst: usuń separatory |, dwukropki i nowe linie.',true);return;}
    const id=s.shadow.querySelector('#assign-product').value,e=s.shadow.querySelector(`[data-note="${id}"]`);if(!e)return;
    e.value=[e.value.trim(),text].filter(Boolean).join('; ');e.closest('.card').querySelector('[data-mode]').value='edit';s.shadow.querySelector('#rest').value='';update();e.focus();
  }
  function addProduct(){
    const s=session,id=s.shadow.querySelector('#more-product').value;if(!id||s.busy)return;
    let all;
    try{all=currentSelection(s);if(noteValue()!==s.raw)throw Error('Uwaga w Base się zmieniła. Otwórz nakładkę ponownie, aby zachować nowszy zapis.');}catch(e){message(e.message,true);return;}
    const matches=all.filter(p=>p.id===id),p=matches.length===1?matches[0]:null;
    if(!s.group||!p||!eligible(p)){refreshMore();message('Ten produkt nie ma statusu Odłożone - do wystawienia. Wybierz status ręcznie w Base.',true);return;}
    const stored=s.selected.map(p=>{const e=s.shadow.querySelector(`[data-note="${p.id}"]`),card=e.closest('.card');return {id:p.id,text:e.value,mode:card.querySelector('[data-mode]').value,field:card.querySelector('[data-field]').value,parameter:card.querySelector('[data-product-parameters]').value,manualParameter:card.querySelector('[data-manual-parameter]').value,value:card.querySelector('[data-value]').value,helperMode:card.querySelector('[data-helper]').dataset.mode,categoryOpen:!card.querySelector('[data-category-box]').hidden,stateOpen:!card.querySelector('[data-state-box]').hidden,productState:card.querySelector('[data-product-state]').value,categoryFilter:card.querySelector('[data-category-filter]').value,custom:card.querySelector('[data-custom]').value,customOpen:!card.querySelector('[data-custom-box]').hidden,defectOpen:!card.querySelector('[data-defect-box]').hidden,defect:card.querySelector('[data-defect]').value,scope:card.querySelector('[data-scope]').value,scopeOpen:!card.querySelector('[data-scope-box]').hidden,splitOpen:!card.querySelector('[data-split-box]').hidden,splitValues:[...card.querySelectorAll('[data-split-box] input')].map(input=>input.value)};});
    const rest=s.shadow.querySelector('#rest').value;
    // Adding a note never changes eligibility or queues a status request.
    const ids=[...s.selected.map(p=>p.id),id];s.host.remove();session=null;open(ids);
    if(!session)return;for(const row of stored){const e=session.shadow.querySelector(`[data-note="${row.id}"]`),card=e.closest('.card');showParameterChoices(card,offlineParameters);e.value=row.text;card.querySelector('[data-mode]').value=row.mode;card.querySelector('[data-field]').value=row.field;card.querySelector('[data-product-parameters]').value=row.parameter;card.querySelector('[data-manual-parameter]').value=row.manualParameter;card.querySelector('[data-value]').value=row.value;card.querySelector('[data-custom]').value=row.custom;setEditor(card,row.helperMode||'helper');const filter=card.querySelector('[data-category-filter]');filter.value=row.categoryFilter;card.querySelector('[data-category-add]').disabled=!filter.value.trim();card.querySelector('[data-product-state]').value=row.productState;setEditor(card,row.categoryOpen?'category':row.stateOpen?'state':row.customOpen?'custom':row.defectOpen?'defect':row.scopeOpen?'scope':row.splitOpen?'split':row.helperMode||'helper');card.querySelector('[data-defect]').value=row.defect;card.querySelector('[data-scope]').value=row.scope;card.querySelectorAll('[data-split-box] input').forEach((input,index)=>input.value=row.splitValues[index]);}session.shadow.querySelector('#rest').value=rest;update();
  }
  function message(text,error=false){if(session){const e=session.shadow.querySelector('#message');e.textContent=text;e.className=error?'error':'';}}
  function add(card) {
    try {
      const parameterMode = card.querySelector('[data-helper]').dataset.mode === 'parameter';
      const field = card.querySelector(parameterMode ? '[data-product-parameters]' : '[data-field]');
      const value = card.querySelector('[data-value]');
      const note = card.querySelector('[data-note]');
      if (!parameterMode && ['kategoria', 'kategoria produktu i allegro', 'stan', 'stan produktu'].includes(norm(field.value))) {
        throw Error('Otwórz odpowiednią listę przyciskiem „Kategoria” lub „Stan”.');
      }
      let label = field.value;
      let choices = parameterMode ? offlineParameters : null;
      const manual = parameterMode && label === MANUAL_PARAMETER ? card.querySelector('[data-manual-parameter]') : null;
      if (manual) {
        label = manual.value.trim();
        if (!label || /[|;:=\r\n]/.test(label)) {
          throw Error('Podaj nazwę parametru bez znaków | ; : = i nowych linii.');
        }
        choices = [label];
      }
      note.value = clause(note.value, label, value.value, choices);
      card.querySelector('[data-mode]').value = 'edit';
      value.value = '';
      if (manual) manual.value = '';
      update();
      (manual || value).focus();
      return true;
    } catch (error) {
      message(error.message, true);
      return false;
    }
  }
  function addCustom(card){try{const input=card.querySelector('[data-custom]'),note=card.querySelector('[data-note]');note.value=freeClause(note.value,input.value.trim() && 'uwaga dodaj ' + input.value.trim());card.querySelector('[data-mode]').value='edit';input.value='';update();input.focus();return true;}catch(e){message(e.message,true);return false;}}
  function addDefect(card) {
    const description = card.querySelector('[data-defect]');
    const scope = card.querySelector('[data-scope]');
    const note = card.querySelector('[data-note]');
    try {
      if (onlyDefectLocation(description.value)) throw Error('Wybierz rodzaj wady lub dopisz jej opis.');
      note.value = defectClause(note.value, description.value, scope.value);
      card.querySelector('[data-mode]').value = 'edit';
      description.value = '';
      scope.value = '';
      update();
      note.focus();
      return true;
    } catch (error) {
      message(error.message, true);
      return false;
    }
  }
  function addSplit(card) {
    const inputs = [...card.querySelectorAll('[data-split-box] input')];
    const values = inputs.map(input => input.value.trim());
    if (values.some(value => !value)) {
      message('Podaj kategorię obu części kompletu.', true);
      return false;
    }
    if (values.some(value => /[|;:\r\n]/.test(value) || value.includes(' + '))) {
      message('W polach rozbicia oddziel informacje przecinkami.', true);
      return false;
    }
    const command = 'rozbij komplet ' + values.join(' + ');
    const note = card.querySelector('[data-note]');
    const rows = note.value.split(';').map(row => row.trim()).filter(row => row && !/^rozbij komplet\s/i.test(row));
    note.value = [...rows, command].join('; ');
    card.querySelector('[data-mode]').value = 'edit';
    inputs.forEach(input => input.value = '');
    update();
    return true;
  }
  function noteChange(editor) {
    const mode = editor.closest('.card').querySelector('[data-mode]').value;
    if (mode === 'delete') return '';
    const text = editor.value.trim();
    return mode === 'edit' && text ? text : null;
  }
  function draft() {
    const s = session, changes = new Map();
    for (const product of s.selected) {
      const editor = s.shadow.querySelector(`[data-note="${product.id}"]`);
      const text = noteChange(editor);
      if (text !== null) changes.set(product.id, text);
    }
    return mergeNote(s.raw, s.all, changes, s.shadow.querySelector('#rest').value);
  }
  function update(){if(!session)return;try{const text=draft();session.shadow.querySelector('#preview').textContent=text||'Tutaj pojawi się gotowa uwaga po wpisaniu poprawki.';session.shadow.querySelector('#count').textContent=`${text.length} / 200 znaków`;message(text.length>200?'Uwaga przekracza widoczny limit Base 200 znaków. Skróć tekst; niczego nie ucinamy.':'',text.length>200);}catch(e){message(e.message,true);}}
  function resetPending(){for(const [id,item]of pending){const p=products().find(x=>x.id===id);if(p&&savedValues.has(id)){p.select.value=savedValues.get(id);const label=p.row.querySelector(`[id="select2-${p.select.id}-container"]`);if(label){label.textContent=p.select.selectedOptions[0]?.textContent||'';label.title=label.textContent;}}}pending.clear();}
  function cancel(){if(!session||session.busy)return;resetPending();session.host.remove();session=null;}
  async function save(){
    const s=session;if(!s||s.busy)return;
    try{
      currentSelection(s);
      for (const card of s.shadow.querySelectorAll('.card')) {
        if (card.querySelector('[data-mode]').value === 'delete') continue;
        if (!card.querySelector('[data-category-box]').hidden && !card.querySelector('[data-category-add]').disabled && !addCategory(card)) return;
        if (!card.querySelector('[data-state-box]').hidden && card.querySelector('[data-product-state]').value && !addState(card)) return;
        const manualParameter = card.querySelector('[data-manual-parameter]');
        if ((card.querySelector('[data-value]').value.trim() || (!manualParameter.hidden && manualParameter.value.trim())) && !add(card)) return;
        if (card.querySelector('[data-custom]').value.trim() && !addCustom(card)) return;
        const splitInputs = [...card.querySelectorAll('[data-split-box] input')];
        if (splitInputs.some(input => input.value.trim()) && !addSplit(card)) return;
        if ((card.querySelector('[data-defect]').value.trim() || card.querySelector('[data-scope]').value.trim()) && !addDefect(card)) return;
      }
      const final=draft();if(final.length>200)throw Error('Przekroczony limit 200 znaków. Skróć uwagę.');
      const covers=new Set(s.selected.map(p=>p.id));for(const id of pending.keys())if(!covers.has(id))throw Error('Dodano inny produkt. Anuluj i otwórz wspólne okno ponownie.');
      for (const id of pending.keys()) {
        const editor = s.shadow.querySelector(`[data-note="${id}"]`);
        const text = noteChange(editor) ?? s.initial.get(id);
        if (!text?.trim()) {
          throw Error('Wpisz, co trzeba poprawić w produkcie, np. rozmiar 36 albo plama na rękawie.');
        }
      }
      if(noteValue()!==s.raw)throw Error('Uwaga została zmieniona w Base. Otwórz nakładkę ponownie, aby nie nadpisać zmian.');
      s.busy=true;s.shadow.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=true);message('Zapisywanie uwagi w Base…');
      if(final!==s.raw){
        noteAnchor().click();const textarea=await waitFor(()=>document.querySelector('#oms_info_form textarea#admin_comments'));
        if(textarea.value!==s.raw)throw Error('Nowsza uwaga w formularzu Base. Nie zapisano zmian.');
        textarea.value=final;textarea.dispatchEvent(new Event('input',{bubbles:true}));textarea.dispatchEvent(new Event('change',{bubbles:true}));
        const form=textarea.closest('form');if(form.id!=='oms_info_form')throw Error('Nierozpoznany formularz Base.');
        const submit=form.querySelector('input[type="submit"][value="Zapisz"]');if(!submit)throw Error('Nie znaleziono zapisu uwagi.');
        submit.click();await waitFor(()=>{const a=noteAnchor();return a&&(a.textContent==='...'? '':a.textContent)===final;});
      }
      message('Uwaga zapisana. Przekazywanie statusu do Base…');
      for(const [id,item]of pending){if(rid()!==s.rid)throw Error('Zwrot się zmienił.');const p=products().find(p=>p.id===id);if(!p)throw Error('Nie znaleziono produktu. Uwaga zapisana; sprawdź status.');p.select.value=TARGET;bypass=true;try{item.fn.apply(item.thisArg,item.args);savedValues.set(id,TARGET);}finally{bypass=false;}}
      pending.clear();s.host.remove();session=null;
    }catch(e){if(session){session.busy=false;session.shadow.querySelectorAll('button,input,textarea,select').forEach(x=>x.disabled=false);message(e.message,true);}}
  }
  function hook(){
    const fn=window.tryUpdateReturnItemStatus;if(typeof fn!=='function'||fn===wrap)return;originalStatus=fn;
    wrap=function(...args){const id=String(args[0]),p=products().find(p=>p.id===id);if(!bypass&&p?.select.value===TARGET){if(pending.has(id))return;pending.set(id,{fn,thisArg:this,args});open([...pending.keys()],true);return;}const r=fn.apply(this,args);if(p)savedValues.set(id,p.select.value);return r;};
    window.tryUpdateReturnItemStatus=wrap;
  }
  function scan(){
    if(!rid())return;hook();
    for(const p of products()){
      if(!savedValues.has(p.id))savedValues.set(p.id,p.select.value);
      if(p.row.querySelector('[data-estila-note]'))continue;
      const b=document.createElement('button');b.type='button';b.dataset.estilaNote=p.id;b.textContent='✎ Uwaga';b.style.cssText='margin:5px 0 0 8px;border:1px solid #b5d9d4;border-radius:7px;background:#edf8f6;color:#14615b;padding:5px 9px;font-size:12px';b.onclick=()=>{const row=b.closest('tr'),select=row?.querySelector('select.return_item_status');if(select&&select.closest('tr')===row)open([select.id.replace('return_item_status_','')]);};p.row.querySelector('[data-tid="productName"]').append(b);
    }
    if(!document.querySelector('#estila-all-notes')){const area=document.querySelector('#sale_items_container');if(area){const b=document.createElement('button');b.id='estila-all-notes';b.type='button';b.textContent='Poprawki odłożonych · kilka produktów';b.className='btn btn-default';b.style.margin='10px';b.onclick=()=>open(products().filter(p=>p.select.value===TARGET).map(p=>p.id));area.append(b);}}
  }
  const observer=new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&!n.closest?.('#estila-base-notes')&&(n.matches?.('tr,select.return_item_status,#sale_items_container')||n.querySelector?.('select.return_item_status'))))){clearTimeout(scanTimer);scanTimer=setTimeout(scan,150);}});
  function boot(){
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('hashchange',()=>{if(session&&!session.busy)cancel();savedValues.clear();setTimeout(scan,200);});
    document.addEventListener('pointerdown',hook,true);document.addEventListener('keydown',hook,true);scan();
  }
  if(document.body)boot();else document.addEventListener('DOMContentLoaded',boot,{once:true});
})();
