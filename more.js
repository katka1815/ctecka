// Doplňky čtečky: nabídka u knížky (obsah, hledání, záložky a poznámky, vzhled), překlad označeného textu,
// zvýrazňování, výslovnost, listování tažením, původní stránka PDF, kartičky, export pro Anki a záloha.
(function () {
  'use strict';
  const A = window.App, $ = A.$, esc = A.esc;
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
  const pageText = i => (A.book.pages[i] || '').split(A.H).join('');
  const keepScroll = () => A.renderPage(A.book.pos.scroll);

  // ---------- prvky stránky ----------
  $('fontMinus').before(el('<button id="menu" class="btn" title="Obsah, hledání, záložky, vzhled">☰ Nabídka</button>'));
  $('pageCount').parentElement.after(el('<span id="progress" class="lang"></span>'));
  document.querySelector('#popup .pw').append(el('<button id="pSpeak" class="btn small" title="Přečíst nahlas">🔊</button>'));
  $('print').before(el('<button id="cardsOpen" class="btn">Zkoušet</button>'), el('<button id="anki" class="btn" title="Soubor, který jde nahrát do Anki nebo Quizletu">Export</button>'));
  document.body.append(
    el(`<aside id="sheet" hidden>
      <header class="bar"><span class="title">Nabídka</span><span class="spacer"></span><button id="sheetClose" class="btn">Zavřít</button></header>
      <nav id="tabs"><button data-t="toc" class="btn small">Obsah</button><button data-t="search" class="btn small">Hledat</button><button data-t="marks" class="btn small">Záložky a poznámky</button><button data-t="look" class="btn small">Vzhled</button><button data-t="tools" class="btn small">Další</button></nav>
      <div id="sheetBody"></div></aside>`),
    el('<div id="selbar" hidden><button data-a="tr" class="btn small">Přeložit</button><button data-a="hl" class="btn small">Zvýraznit</button><button data-a="note" class="btn small">Poznámka</button><button data-a="say" class="btn small">🔊</button></div>'),
    el('<div id="pop2" class="popbox" hidden><div class="pw"><b id="p2Word"></b></div><div id="p2Tr"></div><div class="pbtn"><button id="p2Close" class="btn">Zavřít</button></div></div>'),
    el('<div id="orig" hidden><header class="bar"><span class="title">Původní stránka</span><span class="spacer"></span><button id="origClose" class="btn">Zavřít</button></header><div id="origBox"><canvas id="origCv"></canvas></div></div>'),
    el(`<section id="cards" class="view" hidden>
      <header class="bar"><button id="cardsBack" class="btn">‹ Slovníček</button><span class="title">Zkoušení</span><span class="spacer"></span><span id="cardNo" class="lang"></span></header>
      <div id="card"><div id="cardWord"></div><div id="cardTr"></div></div>
      <footer class="bar pager"><button id="cardNo0" class="btn">Neznám</button><button id="cardShow" class="btn primary">Ukázat překlad</button><button id="cardYes" class="btn">Znám</button></footer>
    </section>`));

  // ---------- vzhled ----------
  const FONTS = { serif: 'Georgia, "Palatino Linotype", "Times New Roman", serif', sans: 'system-ui, "Segoe UI", Roboto, sans-serif', mono: '"Courier New", monospace' };
  let look = { theme: 'auto', font: 'serif', lh: 1.65, pad: 28 };
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  function applyLook() {
    document.documentElement.dataset.theme = look.theme === 'auto' ? (dark.matches ? 'dark' : 'light') : look.theme;
    const p = $('page');
    p.style.fontFamily = FONTS[look.font] || FONTS.serif;
    p.style.lineHeight = look.lh;
    p.style.paddingLeft = p.style.paddingRight = look.pad + 'px';
  }
  dark.addEventListener('change', applyLook);
  A.kvGet('look').then(v => { if (v) look = { ...look, ...v }; applyLook(); });
  applyLook();
  const setLook = ch => { look = { ...look, ...ch }; applyLook(); A.kvSet('look', look); drawTab(); };

  // ---------- výslovnost ----------
  const VOICE = { en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', la: 'it-IT', grc: 'el-GR', eu: 'eu-ES', et: 'et-EE', hsb: 'cs-CZ', dsb: 'pl-PL' };
  function speak(text) {
    const tag = VOICE[A.lang] || 'en-US';
    text = text.slice(0, 3500);
    if (window.Android && window.Android.speak) { window.Android.speak(text, tag); return; }
    if (!window.speechSynthesis) { alert('Tenhle prohlížeč čtení nahlas neumí.'); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = tag;
    const v = speechSynthesis.getVoices().find(x => x.lang.replace('_', '-').toLowerCase().startsWith(tag.slice(0, 2)));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
  function stopSpeak() {
    if (window.Android && window.Android.stopSpeak) window.Android.stopSpeak();
    else if (window.speechSynthesis) speechSynthesis.cancel();
  }
  $('pSpeak').onclick = () => speak($('pWord').textContent);

  // ---------- ukládání souborů (záloha, export) ----------
  function saveFile(name, mime, text) {
    if (window.Android && window.Android.saveFile) {
      const bytes = new TextEncoder().encode(text);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      alert(window.Android.saveFile(name, mime, btoa(bin)));
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const safeName = s => s.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'knizka';

  // ---------- nabídka ----------
  let tab = 'toc', query = '', flash = null;
  const openSheet = t => { if (t) tab = t; $('sheet').hidden = false; A.hidePopup(); drawTab(); };
  const closeSheet = () => { $('sheet').hidden = true; };
  $('menu').onclick = () => openSheet();
  $('sheetClose').onclick = closeSheet;
  $('tabs').onclick = e => { const t = e.target.dataset.t; if (t) { tab = t; drawTab(); } };

  function jump(page, q) {
    closeSheet();
    flash = q || null;
    if (page === A.book.pos.page) keepScroll(); else A.goTo(page);
  }

  function searchBook(q) {
    const out = [], needle = q.toLowerCase();
    for (let i = 0; i < A.book.pages.length && out.length < 200; i++) {
      const t = pageText(i).replace(/\n/g, ' '), low = t.toLowerCase();
      for (let at = low.indexOf(needle); at >= 0 && out.length < 200; at = low.indexOf(needle, at + needle.length)) {
        out.push({ page: i, before: t.slice(Math.max(0, at - 40), at), hit: t.slice(at, at + q.length), after: t.slice(at + q.length, at + q.length + 50) });
      }
    }
    return out;
  }

  function drawTab() {
    if ($('sheet').hidden) return;
    const b = A.book, body = $('sheetBody');
    for (const x of $('tabs').children) x.classList.toggle('on', x.dataset.t === tab);
    if (tab === 'toc') {
      const toc = b.toc || [];
      body.innerHTML = toc.length
        ? toc.map((t, i) => `<button class="item${t.page <= b.pos.page && (!toc[i + 1] || toc[i + 1].page > b.pos.page) ? ' cur' : ''}" data-page="${t.page}"><span>${esc(t.title)}</span><small>${t.page + 1}</small></button>`).join('')
        : '<p class="hint">Tahle knížka v sobě obsah nemá. Skákat jde na číslo strany dole, nebo přes Hledat.</p>';
    } else if (tab === 'search') {
      body.innerHTML = `<input id="q" type="search" placeholder="Hledat v knížce" value="${esc(query).replace(/"/g, '&quot;')}"><div id="qOut"></div>`;
      const run = () => {
        query = $('q').value.trim();
        if (query.length < 2) { $('qOut').innerHTML = '<p class="hint">Napiš aspoň dvě písmena.</p>'; return; }
        const res = searchBook(query);
        $('qOut').innerHTML = `<p class="hint">${res.length >= 200 ? 'Prvních 200 výskytů' : 'Výskytů: ' + res.length}</p>` +
          res.map(r => `<button class="item" data-page="${r.page}" data-q="1"><span>…${esc(r.before)}<mark>${esc(r.hit)}</mark>${esc(r.after)}…</span><small>${r.page + 1}</small></button>`).join('');
      };
      let timer = 0;
      $('q').oninput = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
      if (query) run();
      $('q').focus();
    } else if (tab === 'marks') {
      const list = [...(b.marks || []).map((m, i) => ({ ...m, kind: 'm', i })), ...(b.hls || []).map((h, i) => ({ ...h, kind: 'h', i }))]
        .sort((x, y) => x.page - y.page);
      body.innerHTML = '<button id="addMark" class="btn primary">Přidat záložku na tuhle stranu</button>' +
        '<p class="hint">Zvýraznění a poznámku uděláš tak, že v textu označíš kus věty (na mobilu podržením prstu).</p>' +
        list.map(x => `<div class="item"><button class="go" data-page="${x.page}"><span>${x.kind === 'm' ? '🔖 ' : '🖍 '}${esc(x.text || '')}${x.note ? `<em>${esc(x.note)}</em>` : ''}</span><small>${x.page + 1}</small></button><button class="btn small" data-del="${x.kind}${x.i}" title="Smazat">×</button></div>`).join('');
      $('addMark').onclick = () => {
        (b.marks || (b.marks = [])).push({ page: b.pos.page, t: Date.now(), text: pageText(b.pos.page).replace(/\n/g, ' ').slice(0, 70) });
        A.putBook(b); drawTab();
      };
    } else if (tab === 'look') {
      const opt = (key, val, label) => `<button class="btn small${look[key] === val ? ' on' : ''}" data-k="${key}" data-v="${val}">${label}</button>`;
      body.innerHTML = `<h4>Barvy</h4><div class="rowb">${opt('theme', 'auto', 'Podle systému')}${opt('theme', 'light', 'Světlé')}${opt('theme', 'sepia', 'Sépie')}${opt('theme', 'dark', 'Tmavé')}</div>
        <h4>Písmo</h4><div class="rowb">${opt('font', 'serif', 'Patkové')}${opt('font', 'sans', 'Bezpatkové')}${opt('font', 'mono', 'Strojové')}</div>
        <h4>Velikost písma</h4><div class="rowb"><button class="btn" data-f="-1">A−</button><button class="btn" data-f="1">A+</button></div>
        <h4>Řádkování</h4><div class="rowb"><button class="btn" data-lh="-0.1">Hustší</button><span>${look.lh.toFixed(1)}</span><button class="btn" data-lh="0.1">Řidší</button></div>
        <h4>Okraje</h4><div class="rowb"><button class="btn" data-pad="-8">Užší</button><span>${look.pad}</span><button class="btn" data-pad="8">Širší</button></div>`;
    } else {
      body.innerHTML = `<button id="tSay" class="btn">🔊 Přečíst stranu nahlas</button> <button id="tStop" class="btn">Zastavit čtení</button>
        <p></p><button id="tOrig" class="btn">Ukázat původní stránku (PDF)</button>
        <p class="hint">Původní stránka ukáže stranu tak, jak je v PDF, včetně tabulek a kreseb. Jde jen u PDF nahraných od téhle verze.</p>
        <p></p><button id="tRename" class="btn">Přejmenovat knížku</button>
        <h4>Čtení</h4><p id="tStats" class="hint"></p>`;
      $('tRename').onclick = () => {
        const name = (prompt('Nový název knížky:', b.title) || '').trim();
        if (!name || name === b.title) return;
        b.title = name;
        $('bookTitle').textContent = name;
        A.putBook(b);
      };
      $('tSay').onclick = () => speak(pageText(b.pos.page));
      $('tStop').onclick = stopSpeak;
      $('tOrig').onclick = showOrig;
      const read = (b.counted || []).filter(Boolean).length;
      $('tStats').textContent = `Přečtených stran: ${read} z ${b.pages.length}. ` + (b.ms ? `Čteš asi ${Math.round(b.chars / (b.ms / 60000))} znaků za minutu. ` : '') + (timeLeft() ? 'Zbývá ' + timeLeft() + '.' : '');
    }
  }

  $('sheetBody').addEventListener('click', e => {
    const b = A.book, t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.del) {
      const arr = t.dataset.del[0] === 'm' ? b.marks : b.hls;
      arr.splice(+t.dataset.del.slice(1), 1);
      A.putBook(b); drawTab(); keepScroll();
    } else if (t.dataset.page !== undefined) jump(+t.dataset.page, t.dataset.q ? query : null);
    else if (t.dataset.k) setLook({ [t.dataset.k]: t.dataset.v });
    else if (t.dataset.f) $(+t.dataset.f > 0 ? 'fontPlus' : 'fontMinus').click();
    else if (t.dataset.lh) setLook({ lh: Math.max(1.2, Math.min(2.4, +(look.lh + +t.dataset.lh).toFixed(1))) });
    else if (t.dataset.pad) setLook({ pad: Math.max(8, Math.min(72, look.pad + +t.dataset.pad)) });
  });

  // ---------- postup a zbývající čas ----------
  let sums = null, sumsFor = null;
  function timeLeft() {
    const b = A.book;
    if (!b.ms || !b.chars || b.chars < 3000) return '';
    if (sumsFor !== b.id) { sums = [0]; for (const p of b.pages) sums.push(sums[sums.length - 1] + p.length); sumsFor = b.id; }
    const min = Math.round((sums[sums.length - 1] - sums[b.pos.page]) * (b.ms / b.chars) / 60000);
    return min >= 60 ? `asi ${Math.floor(min / 60)} h ${min % 60} min` : `asi ${Math.max(1, min)} min`;
  }

  A.hooks.open = () => { sumsFor = null; flash = null; query = ''; closeSheet(); hideSel(); };
  A.hooks.render = () => {
    const b = A.book, left = timeLeft();
    $('progress').textContent = Math.round((b.pos.page + 1) / b.pages.length * 100) + ' %' + (left ? ' · zbývá ' + left : '');
    hideSel();
    $('pop2').hidden = true;
    if (flash) {
      const qs = flash.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
      let first = null;
      for (const s of $('page').querySelectorAll('.w')) {
        if (qs.some(q => s.textContent.toLowerCase().includes(q))) { s.classList.add('found'); first = first || s; }
      }
      if (first) first.scrollIntoView({ block: 'center' });
      flash = null;
    }
  };

  // ---------- fráze u slova a poznámka u zvýraznění ----------
  let phr = null;
  function phrases() {
    if (!phr) {
      phr = new Map();
      for (const line of (window.DICTS['en-phr'] || '').split('\n')) { const t = line.indexOf('\t'); if (t > 0) phr.set(line.slice(0, t), line.slice(t + 1)); }
    }
    return phr;
  }
  function findPhrase(span) {
    const ws = [...span.parentElement.querySelectorAll('.w')], i = ws.indexOf(span), map = phrases();
    const low = ws.map(s => s.textContent.toLowerCase());
    for (let n = 4; n >= 2; n--) for (let st = Math.max(0, i - n + 1); st <= i && st + n <= ws.length; st++) {
      const g = low.slice(st, st + n);
      for (const first of [g[0], A.resolve(g[0]).lemma]) {
        const key = [first, ...g.slice(1)].join(' ');
        if (map.has(key)) return { key, tr: map.get(key) };
      }
    }
    return null;
  }
  $('page').addEventListener('click', e => {
    const w = e.target.closest('.w');
    if (!w || $('popup').hidden) return;
    let extra = '';
    if (A.lang === 'en') { const p = findPhrase(w); if (p) extra += `<div class="own"><small>fráze</small><b>${esc(p.key)}</b> ${esc(p.tr)}</div>`; }
    if (w.classList.contains('hl')) {
      const h = hlOf(w);
      if (h) extra += `<div class="own">${h.note ? `<small>poznámka</small>${esc(h.note)} ` : ''}<button id="hlDel" class="btn small">Odebrat zvýraznění</button></div>`;
    }
    if (!extra) return;
    $('pTr').insertAdjacentHTML('afterbegin', extra);
    const d = $('hlDel');
    if (d) d.onclick = () => { const b = A.book; b.hls.splice(b.hls.indexOf(hlOf(w)), 1); A.putBook(b); keepScroll(); };
    A.placePopup(w);
  });
  const hlOf = w => (A.book.hls || []).find(h => h.page === A.book.pos.page && h.pi === +w.parentElement.dataset.pi && +w.dataset.o >= h.a && +w.dataset.o < h.b);

  // ---------- označený text: překlad, zvýraznění, poznámka ----------
  let picked = [];
  function hideSel() { $('selbar').hidden = true; picked = []; }
  function onSelect() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || $('reader').hidden || !$('page').contains(sel.anchorNode)) { hideSel(); return; }
    const ws = [...$('page').querySelectorAll('.w')].filter(s => sel.containsNode(s, true));
    if (ws.length < 2) { hideSel(); return; }
    picked = ws;
    const bar = $('selbar'), r = sel.getRangeAt(0).getBoundingClientRect();
    bar.hidden = false;
    A.hidePopup();
    bar.style.left = Math.max(8, Math.min(window.innerWidth - bar.offsetWidth - 8, r.left + r.width / 2 - bar.offsetWidth / 2)) + 'px';
    bar.style.top = (r.top - bar.offsetHeight - 10 > 8 ? r.top - bar.offsetHeight - 10 : Math.min(window.innerHeight - bar.offsetHeight - 8, r.bottom + 10)) + 'px';
  }
  let selTimer = 0;
  document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(onSelect, 300); });

  const firstGloss = r => {
    if (r.parts) return r.parts.map(p => firstGloss(p) || '?').join(' + ');
    const g = (A.byCode[A.lang].primary === 'en' ? r.en || r.cs : r.cs || r.en) || '';
    return g.split('; ').map(p => p.replace(/^\w+: /, '')).join(', ').split(', ').slice(0, 3).join(', ');
  };
  $('selbar').onclick = e => {
    const act = (e.target.closest('button') || {}).dataset?.a;
    if (!act || !picked.length) return;
    const ws = picked, text = ws.map(s => s.textContent).join(' ');
    if (act === 'say') { speak(window.getSelection().toString() || text); return; }
    if (act === 'tr') {
      let html = '';
      if (A.lang === 'en') {
        const seen = new Set();
        for (const s of ws) { const p = findPhrase(s); if (p && !seen.has(p.key)) { seen.add(p.key); html += `<div class="own"><small>fráze</small><b>${esc(p.key)}</b> ${esc(p.tr)}</div>`; } }
      }
      html += ws.slice(0, 40).map(s => {
        const r = A.resolve(s.textContent), g = firstGloss(r);
        return `<div class="wrow"><i>${esc(s.textContent)}</i> ${g ? esc(g) : '<span class="hint">?</span>'}</div>`;
      }).join('');
      $('p2Word').textContent = text.length > 90 ? text.slice(0, 90) + '…' : text;
      $('p2Tr').innerHTML = html + '<p class="hint">Překlad slovo po slovu ze slovníku, ne celé věty.</p>';
      const pop = $('pop2');
      pop.hidden = false;
      const r = ws[0].getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
      pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 8)) + 'px';
      $('selbar').hidden = true;
      return;
    }
    // zvýraznění drží v jednom odstavci (v tom, kde označení začíná)
    const para = ws[0].parentElement, same = ws.filter(s => s.parentElement === para), last = same[same.length - 1];
    let note = '';
    if (act === 'note') { note = prompt('Poznámka k označenému textu:') || ''; if (!note) return; }
    const b = A.book;
    (b.hls || (b.hls = [])).push({ page: b.pos.page, pi: +para.dataset.pi, a: +same[0].dataset.o, b: +last.dataset.o + last.textContent.length,
      text: same.map(s => s.textContent).join(' ').slice(0, 120), note, t: Date.now() });
    A.putBook(b);
    window.getSelection().removeAllRanges();
    keepScroll();
  };
  $('p2Close').onclick = () => { $('pop2').hidden = true; };

  // ---------- listování tažením prstu ----------
  let touch = null;
  $('page').addEventListener('touchstart', e => { touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null; }, { passive: true });
  $('page').addEventListener('touchend', e => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y, dt = Date.now() - touch.t;
    touch = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 50 || dt > 600 || !window.getSelection().isCollapsed) return;
    $(dx < 0 ? 'next' : 'prev').click();
  }, { passive: true });

  // ---------- původní stránka PDF ----------
  let pdfDoc = null, pdfFor = null;
  async function showOrig() {
    const b = A.book;
    try {
      if (pdfFor !== b.id) {
        const blob = b.kind === 'pdf' || !b.kind ? await A.fileGet(b.id) : null;
        if (!blob) { alert('U téhle knížky původní PDF uložené nemám. Jde to jen u PDF nahraných od téhle verze: stačí ji nahrát znovu.'); return; }
        pdfDoc = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
        pdfFor = b.id;
      }
      closeSheet();
      $('orig').hidden = false;
      const pg = await pdfDoc.getPage(b.pos.page + 1);
      const width = Math.min(window.innerWidth, 1100), dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = pg.getViewport({ scale: width / (pg.view[2] - pg.view[0]) * dpr });
      const cv = $('origCv');
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      cv.style.width = Math.ceil(vp.width / dpr) + 'px';
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    } catch (e) { console.error(e); alert('Původní stránku se nepodařilo zobrazit.'); $('orig').hidden = true; }
  }
  $('origClose').onclick = () => { $('orig').hidden = true; };

  // ---------- kartičky a export ----------
  let deck = [], shown = false;
  function drawCard() {
    const c = deck[0];
    $('cardNo').textContent = c ? `zbývá ${deck.length}` : '';
    $('cardWord').textContent = c ? c.show : 'Hotovo, všechna slova jsi prošla.';
    $('cardTr').textContent = c && shown ? c.tr || '(bez překladu)' : '';
    $('cardShow').hidden = !c || shown;
    $('cardYes').disabled = $('cardNo0').disabled = !c;
  }
  $('cardsOpen').onclick = () => {
    deck = A.buildVocab().list.filter(e => e.tr).slice();
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    shown = false;
    A.show('cards');
    drawCard();
  };
  $('cardShow').onclick = () => { shown = true; drawCard(); };
  $('card').onclick = () => { if (deck[0]) { shown = true; drawCard(); } };
  $('cardYes').onclick = () => { A.setKnown(A.wkey(deck.shift().lemma), true); shown = false; drawCard(); };
  $('cardNo0').onclick = () => { const c = deck.shift(); A.setKnown(A.wkey(c.lemma), false); A.wordRec(A.wkey(c.lemma)).l++; A.saveWords(); deck.push(c); shown = false; drawCard(); };
  $('cardsBack').onclick = () => { A.show('vocab'); A.renderVocab(); };
  $('anki').onclick = () => {
    const rows = A.buildVocab().list.filter(e => e.tr).map(e => e.show.replace(/\t/g, ' ') + '\t' + e.tr.replace(/\t/g, ' '));
    if (!rows.length) { alert('Ve slovníčku teď není žádné slovo s překladem.'); return; }
    saveFile('slovicka ' + safeName(A.book.title) + '.txt', 'text/plain', rows.join('\n'));
  };

  // ---------- záloha a obnova ----------
  const toData = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob); });
  const fromData = async url => (await fetch(url)).blob();
  $('backup').onclick = async () => {
    const st = $('importStatus');
    st.hidden = false; st.textContent = 'Připravuji zálohu…';
    const books = await A.getBooks();
    const imgBytes = books.reduce((n, b) => n + Object.values(b.imgs || {}).flat().reduce((m, im) => m + im.blob.size, 0), 0);
    const withImgs = imgBytes < 15e6;
    const out = [];
    for (const b of books) {
      const c = { ...b, cover: b.cover ? await toData(b.cover) : null, imgs: {} };
      if (withImgs) for (const [pg, list] of Object.entries(b.imgs || {})) {
        c.imgs[pg] = [];
        for (const im of list) c.imgs[pg].push({ before: im.before, w: im.w, data: await toData(im.blob) });
      }
      out.push(c);
    }
    saveFile('ctecka-zaloha-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json',
      JSON.stringify({ app: 'ctecka', v: 1, words: A.words, look, books: out }));
    st.textContent = 'Záloha obsahuje slovíčka, knížky, místa, kde jsi skončila, záložky a poznámky.' +
      (withImgs ? '' : ' Obrázky v knížkách jsou moc velké, do zálohy se nevešly.') + ' Původní PDF soubory v ní nejsou.';
  };
  $('restoreFile').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const st = $('importStatus');
    st.hidden = false;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== 'ctecka' || !d.words || !d.books) throw new Error('Tohle není záloha ze čtečky.');
      // slova: sloučit, u počtů vzít vyšší; "znám" má přednost z toho, kde je nastaveno
      const words = A.words;
      for (const [k, w] of Object.entries(d.words)) {
        const mine = words[k];
        if (!mine) words[k] = w;
        else { mine.s = Math.max(mine.s || 0, w.s || 0); mine.l = Math.max(mine.l || 0, w.l || 0); if (mine.k === undefined && w.k !== undefined) mine.k = w.k; }
      }
      A.setWords(words);
      const have = await A.getBooks(), ids = new Set(have.map(b => b.id)), titles = new Set(have.map(b => b.title));
      let added = 0;
      for (const b of d.books) {
        if (ids.has(b.id) || titles.has(b.title)) continue;
        if (b.cover) b.cover = await fromData(b.cover);
        for (const list of Object.values(b.imgs || {})) for (const im of list) { im.blob = await fromData(im.data); delete im.data; }
        await A.putBook(b);
        added++;
      }
      await A.showLibrary();
      st.hidden = false;
      st.textContent = `Obnoveno: slovíčka sloučena, přidáno knížek: ${added} (knížky, které tu už jsou, zůstaly beze změny).`;
    } catch (err) { console.error(err); st.textContent = 'Zálohu se nepodařilo načíst: ' + (err.message || err); }
  };

  // ---------- klávesy a tlačítko Zpět ----------
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    $('pop2').hidden = true; $('orig').hidden = true; closeSheet();
  });
  const back0 = window.__back;
  window.__back = () => {
    if (!$('orig').hidden) { $('orig').hidden = true; return true; }
    if (!$('pop2').hidden) { $('pop2').hidden = true; return true; }
    if (!$('sheet').hidden) { closeSheet(); return true; }
    if (!$('cards').hidden) { $('cardsBack').click(); return true; }
    return back0();
  };
})();
