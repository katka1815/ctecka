(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { LANGS, byCode, pivot, rank, WORD_RE } = window.Lang;
  // jazyk právě otevřené knížky; slova si pamatujeme zvlášť pro každý jazyk
  let lang = 'en';
  const resolve = w => window.Lang.resolve(w, lang);
  const wkey = lemma => lang === 'en' ? lemma : lang + ':' + lemma;

  // ---------- úložiště (IndexedDB) ----------
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('ctecka', 2);
      r.onupgradeneeded = () => {
        const have = r.result.objectStoreNames;
        if (!have.contains('books')) r.result.createObjectStore('books', { keyPath: 'id' });
        if (!have.contains('kv')) r.result.createObjectStore('kv');
        if (!have.contains('files')) r.result.createObjectStore('files');   // původní PDF kvůli zobrazení originálu stránky
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  }
  const getBooks = () => tx('books', 'readonly', s => s.getAll());
  const putBook = b => tx('books', 'readwrite', s => s.put(b));
  const delBook = id => tx('books', 'readwrite', s => s.delete(id)).then(() => tx('files', 'readwrite', s => s.delete(id)));
  const fileGet = id => tx('files', 'readonly', s => s.get(id));
  const fileSet = (id, blob) => tx('files', 'readwrite', s => s.put(blob, id));
  const kvGet = k => tx('kv', 'readonly', s => s.get(k));
  const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));

  // ---------- paměť slov ----------
  // words[lemma] = { s: kolikrát přečteno, l: kolikrát přeloženo, k: 1 znám / 0 neznám }
  let words = {};
  let wordsTimer = 0;
  const wordRec = lemma => words[lemma] || (words[lemma] = { s: 0, l: 0 });
  function saveWords() {
    clearTimeout(wordsTimer);
    wordsTimer = setTimeout(() => kvSet('words', words), 400);
  }

  // ---------- načtení PDF ----------
  async function extractPage(pdfPage) {
    const tc = await pdfPage.getTextContent();
    const lines = [];
    let cur = null;
    for (const it of tc.items) {
      if (!it.str) { if (it.hasEOL) cur = null; continue; }
      const x = it.transform[4], y = it.transform[5], h = it.height || Math.abs(it.transform[3]) || 10;
      if (!cur || Math.abs(y - cur.y) > h * 0.5) {
        cur = { y, x, h, end: x, text: '' };
        lines.push(cur);
      } else if (x - cur.end > h * 0.2 && !cur.text.endsWith(' ') && !it.str.startsWith(' ')) {
        cur.text += ' ';
      }
      cur.text += it.str;
      cur.end = x + it.width;
      if (it.hasEOL) cur = null;
    }
    const ls = lines.map(l => ({ ...l, text: l.text.normalize('NFC').replace(/\s+/g, ' ').trim() })).filter(l => l.text);
    // samotné číslo stránky v záhlaví nebo zápatí pryč
    if (ls.length && /^[-–\s]*\d{1,4}[-–\s]*$/.test(ls[ls.length - 1].text)) ls.pop();
    if (ls.length && /^[-–\s]*\d{1,4}[-–\s]*$/.test(ls[0].text)) ls.shift();
    if (!ls.length) return { text: '', ys: [] };
    const gaps = [];
    for (let i = 1; i < ls.length; i++) { const g = ls[i - 1].y - ls[i].y; if (g > 0) gaps.push(g); }
    gaps.sort((a, b) => a - b);
    const gap = gaps.length ? gaps[gaps.length >> 1] : 0;
    const right = Math.max(...ls.map(l => l.end));
    const left = Math.min(...ls.map(l => l.x));
    const paras = [], ys = [ls[0].y];   // ys = výška začátku každého odstavce, kvůli zařazení obrázků
    let p = '';
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i], prev = ls[i - 1];
      if (prev) {
        const g = prev.y - l.y;
        const newPara = g < 0 || (gap && g > gap * 1.45) || l.x - left > l.h * 0.8 && prev.x - left < l.h * 0.4 ||
          prev.end < left + (right - left) * 0.75 && /[.!?:"”’]$/.test(prev.text);
        if (newPara) { paras.push(p); p = ''; ys.push(l.y); }
      }
      if (p.endsWith('-') && /^\p{Ll}/u.test(l.text) && /\p{L}-$/u.test(p)) p = p.slice(0, -1) + l.text;
      else p += (p ? ' ' : '') + l.text;
    }
    paras.push(p);
    return { text: paras.join('\n'), ys };
  }

  // Obrázky na stránce: najde jejich místo, stránku vykreslí a obrázky z ní vyřízne.
  // Vrací [{ before: před kolikátý odstavec patří, blob, w: šířka jako podíl šířky stránky }].
  async function extractImages(pdfPage, ys) {
    const O = pdfjsLib.OPS, U = pdfjsLib.Util;
    const ops = await pdfPage.getOperatorList();
    const paint = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageXObjectRepeat, O.paintJpegXObject].filter(Boolean));
    const [vx0, vy0, vx1, vy1] = pdfPage.view;
    let ctm = [1, 0, 0, 1, 0, 0], boxes = [];
    const stack = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], a = ops.argsArray[i];
      if (fn === O.save) stack.push(ctm);
      else if (fn === O.restore) ctm = stack.pop() || ctm;
      else if (fn === O.transform) ctm = U.transform(ctm, a);
      else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (a && a[0]) ctm = U.transform(ctm, a[0]); }
      else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (paint.has(fn)) {
        const c = [[0, 0], [1, 0], [0, 1], [1, 1]].map(pt => U.applyTransform(pt, ctm));
        const b = [Math.max(vx0, Math.min(...c.map(q => q[0]))), Math.max(vy0, Math.min(...c.map(q => q[1]))),
          Math.min(vx1, Math.max(...c.map(q => q[0]))), Math.min(vy1, Math.max(...c.map(q => q[1])))];
        if (b[2] - b[0] > 4 && b[3] - b[1] > 4) boxes.push(b);
      }
    }
    // obrázek bývá v PDF rozsekaný na pruhy: sousedící kusy spojím
    for (let merged = true; merged;) {
      merged = false;
      for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i], B = boxes[j];
        if (A[0] <= B[2] + 2 && B[0] <= A[2] + 2 && A[1] <= B[3] + 2 && B[1] <= A[3] + 2) {
          boxes[i] = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])];
          boxes.splice(j, 1); merged = true; break;
        }
      }
    }
    boxes = boxes.filter(b => b[2] - b[0] >= 40 && b[3] - b[1] >= 40).sort((a, b) => b[3] - a[3]);
    if (!boxes.length) return [];
    const vp = pdfPage.getViewport({ scale: Math.min(2, 1600 / (vx1 - vx0)) });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    await pdfPage.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const out = [];
    for (const b of boxes) {
      const r = vp.convertToViewportRectangle(b);
      const x = Math.max(0, Math.floor(Math.min(r[0], r[2]))), y = Math.max(0, Math.floor(Math.min(r[1], r[3])));
      const w = Math.min(cv.width - x, Math.ceil(Math.abs(r[2] - r[0]))), h = Math.min(cv.height - y, Math.ceil(Math.abs(r[3] - r[1])));
      if (w < 8 || h < 8) continue;
      const cut = document.createElement('canvas');
      cut.width = w; cut.height = h;
      cut.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, w, h);
      const blob = await new Promise(res => cut.toBlob(res, 'image/jpeg', 0.85));
      const mid = (b[1] + b[3]) / 2;
      if (blob) out.push({ before: ys.filter(v => v > mid).length, blob, w: (b[2] - b[0]) / (vx1 - vx0) });
    }
    return out;
  }

  async function importPdf(file) {
    const st = $('importStatus');
    st.hidden = false;
    st.textContent = 'Načítám ' + file.name + '…';
    try {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const base = { id, lang: $('newLang').value, added: Date.now(), opened: 0, pos: { page: 0, scroll: 0 }, counted: [], marks: [], hls: [] };
      const name = file.name.replace(/\.[a-z0-9]+$/i, '');
      if (Formats.canImport(file.name)) {
        const r = await Formats.importFile(file, t => { st.textContent = `Načítám ${file.name}… ${t}`; });
        if (r.pages.join('').replace(/\s/g, '').length < 20) { st.textContent = 'V tomhle souboru jsem nenašla žádný text.'; return 'sken'; }
        await putBook({ ...base, title: name, kind: Formats.extOf(file.name), pages: r.pages, imgs: r.imgs, toc: r.toc, cover: r.cover || null });
        st.hidden = true;
        return 'ok';
      }
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const pages = [], imgs = {};
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const { text, ys } = await extractPage(pg);
        pages.push(text);
        try {
          const im = await extractImages(pg, ys);
          if (im.length) imgs[i - 1] = im;
        } catch (e) { console.warn('obrázky, strana ' + i, e); }
        pg.cleanup();
        if (i % 5 === 0) st.textContent = `Načítám ${file.name}… strana ${i} z ${pdf.numPages}`;
      }
      const letters = pages.join('').replace(/\s/g, '').length;
      if (letters < pdf.numPages * 20) {
        st.textContent = 'V tomhle PDF není text, jen obrázky stránek (sken). Takové zatím přečíst neumím.';
        return 'sken';
      }
      // obsah (záložky v PDF) a obálka z první stránky
      const toc = [];
      try {
        const addOutline = async (items, depth) => {
          for (const it of items || []) {
            if (toc.length >= 300) return;
            let dest = it.dest;
            if (typeof dest === 'string') dest = await pdf.getDestination(dest);
            if (dest && dest[0]) toc.push({ title: (depth ? '  '.repeat(depth) : '') + it.title.trim(), page: await pdf.getPageIndex(dest[0]) });
            if (depth < 2) await addOutline(it.items, depth + 1);
          }
        };
        await addOutline(await pdf.getOutline(), 0);
      } catch (e) { console.warn('obsah PDF', e); }
      let cover = null;
      try {
        const p1 = await pdf.getPage(1), vp = p1.getViewport({ scale: 240 / (p1.view[2] - p1.view[0]) });
        const cv = document.createElement('canvas');
        cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
        await p1.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        cover = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.8));
      } catch (e) { console.warn('obálka', e); }
      await putBook({ ...base, title: name, kind: 'pdf', pages, imgs, toc, cover });
      try { await fileSet(id, file); } catch (e) { console.warn('původní soubor se neuložil', e); }
      st.hidden = true;
      return 'ok';
    } catch (e) {
      console.error(e);
      st.textContent = 'Soubor se nepodařilo načíst: ' + (e.message || e);
      return 'chyba';
    }
  }

  // Nahraje víc PDF za sebou; knížky, které v knihovně už jsou (stejný název), přeskočí.
  async function importMany(files) {
    const have = new Set((await getBooks()).map(b => b.title));
    const n = { ok: 0, sken: 0, chyba: 0, dup: 0 };
    let last = '';
    for (const f of files) {
      const title = f.name.replace(/\.[a-z0-9]+$/i, '');
      if (have.has(title)) { n.dup++; continue; }
      const r = await importPdf(f);
      n[r]++;
      if (r === 'ok') have.add(title); else last = $('importStatus').textContent;
    }
    await showLibrary();
    const st = $('importStatus');
    if (files.length === 1 && !n.dup) { if (n.ok) st.hidden = true; else st.textContent = last; return; }
    st.hidden = false;
    st.textContent = `Nahráno ${n.ok} z ${files.length}.` + (n.dup ? ` Už v knihovně: ${n.dup}.` : '') +
      (n.sken ? ` Bez textu (sken): ${n.sken}.` : '') + (n.chyba ? ` Nepodařilo se načíst: ${n.chyba}.` : '');
  }

  // ---------- hledání PDF ve složce zařízení ----------
  // Čtečka se nejdřív zeptá, složku pak vybereš v okně systému; projde jen tu a nic nikam neposílá.
  let found = [];
  async function walk(dir, path, out, depth) {
    if (depth > 6 || out.length >= 500) return;
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'file' && Formats.supported(name)) out.push({ name, path, get: () => h.getFile() });
      else if (h.kind === 'directory' && !name.startsWith('.')) {
        try { await walk(h, path + name + '/', out, depth + 1); } catch (e) { /* složka bez přístupu */ }
      }
    }
  }
  function showFound(list) {
    found = list;
    const box = $('found');
    box.hidden = false;
    $('foundInfo').textContent = list.length
      ? `Našla jsem ${list.length} knížek (PDF, EPUB, FB2, TXT). Zaškrtni, které chceš nahrát (jazyk: ${byCode[$('newLang').value].name}, jde změnit i při čtení).`
      : 'Žádnou knížku (PDF, EPUB, FB2, TXT) jsem tu nenašla.';
    $('foundList').innerHTML = list.map((f, i) =>
      `<label class="chk"><input type="checkbox" data-i="${i}"> <span>${esc(f.name)}<small>${esc(f.path)}</small></span></label>`).join('');
    $('foundAdd').hidden = !list.length;
  }
  // V androidí aplikaci (apk) jde po povolení projít celé úložiště telefonu naráz.
  async function scanPhone() {
    const A = window.Android, st = $('importStatus');
    if (!A.hasAccess()) {
      if (!confirm('Aby čtečka našla PDF v telefonu, potřebuje povolení číst soubory. Android ti teď ukáže nastavení, kde ho můžeš zapnout (a kdykoli zase vypnout). Čtečka nemá přístup k internetu, takže nic nikam poslat nemůže.\n\nOtevřít nastavení?')) return;
      A.askAccess();
      st.hidden = false;
      st.textContent = 'Až přístup povolíš, vrať se sem a klepni na „Najít knížky v telefonu" znovu.';
      return;
    }
    st.hidden = false; st.textContent = 'Prohledávám telefon…';
    await new Promise(r => setTimeout(r, 50));
    const list = JSON.parse(A.listPdfs());
    st.hidden = true;
    showFound(list.map(f => ({
      name: f.name, path: f.path.replace(/^\/storage\/emulated\/0\//, '').replace(/[^/]*$/, ''),
      get: async () => new File([await (await fetch('/__file?p=' + encodeURIComponent(f.path))).blob()], f.name),
    })));
  }

  async function scanFolder() {
    if (window.Android) return scanPhone();
    if (!confirm('Čtečka projde složku, kterou teď vybereš, a vypíše PDF, která v ní najde. Nahraje jen ta, která zaškrtneš. Nic nikam neposílá, všechno zůstává v tomhle zařízení.\n\nPokračovat?')) return;
    if (window.showDirectoryPicker) {
      let dir;
      try { dir = await window.showDirectoryPicker({ mode: 'read' }); } catch (e) { return; }
      const st = $('importStatus');
      st.hidden = false; st.textContent = 'Prohledávám složku…';
      const out = [];
      await walk(dir, dir.name + '/', out, 0);
      st.hidden = true;
      showFound(out);
    } else $('dirPick').click();
  }

  // ---------- knihovna ----------
  function show(view) {
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== view;
    hidePopup();
  }

  let allBooks = [], coverUrls = [];
  async function showLibrary() {
    book = null;
    kvSet('lastBook', null);
    show('library');
    allBooks = await getBooks();
    drawLibrary();
  }

  function drawLibrary() {
    const q = $('libSearch').value.trim().toLowerCase(), sort = $('libSort').value;
    const prog = b => (b.pos.page + (b.pos.scroll || 0)) / Math.max(1, b.pages.length);
    const books = allBooks.filter(b => !q || b.title.toLowerCase().includes(q)).sort(
      sort === 'title' ? (a, b) => a.title.localeCompare(b.title, 'cs')
      : sort === 'added' ? (a, b) => b.added - a.added
      : sort === 'progress' ? (a, b) => prog(b) - prog(a)
      : (a, b) => (b.opened || b.added) - (a.opened || a.added));
    const ul = $('books');
    ul.textContent = '';
    coverUrls.forEach(u => URL.revokeObjectURL(u));
    coverUrls = [];
    $('empty').hidden = allBooks.length > 0;
    $('libTools').hidden = allBooks.length === 0;
    // přehled: kolik slov umím a kolik jsem toho přečetla
    const ws = Object.values(words);
    const pagesRead = allBooks.reduce((n, b) => n + (b.counted || []).filter(Boolean).length, 0);
    $('libStats').textContent = allBooks.length
      ? `Knížek: ${allBooks.length} · přečtených stran: ${pagesRead} · slov, která znáš: ${ws.filter(w => w.k === 1).length} · slov, která se učíš: ${ws.filter(w => w.l > 0 && w.k !== 1).length}`
      : '';
    for (const b of books) {
      const li = document.createElement('li');
      const open = document.createElement('button');
      open.className = 'book';
      const pct = Math.round(prog(b) * 100);
      open.innerHTML = '<em class="cover"></em><b></b><span></span><i><u></u></i>';
      if (b.cover) {
        const u = URL.createObjectURL(b.cover);
        coverUrls.push(u);
        open.children[0].style.backgroundImage = `url(${u})`;
      } else open.children[0].textContent = (b.kind || 'pdf').toUpperCase();
      open.children[1].textContent = b.title;
      open.children[2].textContent = `${(byCode[b.lang] || byCode.en).name} · strana ${b.pos.page + 1} z ${b.pages.length} · ${pct} %`;
      open.querySelector('u').style.width = pct + '%';
      open.onclick = () => openBook(b);
      const del = document.createElement('button');
      del.className = 'btn del';
      del.textContent = 'Smazat';
      del.onclick = async () => {
        if (confirm(`Smazat knížku „${b.title}"? Zapamatovaná slova zůstanou.`)) { await delBook(b.id); showLibrary(); }
      };
      li.append(open, del);
      ul.append(li);
    }
  }

  // ---------- čtení ----------
  let book = null;
  let fontSize = 19;

  async function openBook(b) {
    book = b;
    book.opened = Date.now();
    kvSet('lastBook', book.id);
    $('bookTitle').textContent = book.title;
    $('pageCount').textContent = book.pages.length;
    $('pageNo').max = book.pages.length;
    $('bookLang').value = lang = byCode[book.lang] ? book.lang : 'en';
    if (App.hooks.open) App.hooks.open();
    show('reader');
    await useLang();
  }

  // Slovníky se načítají až ve chvíli, kdy jsou potřeba (některé mají desítky MB).
  async function useLang() {
    const wanted = lang, b = book;
    $('page').innerHTML = '<p class="hint">Načítám slovník (' + byCode[wanted].name + ')…</p>';
    try { await window.Lang.load(wanted); }
    catch (e) { $('page').innerHTML = '<p class="hint">Slovník se nepodařilo načíst: ' + esc(e.message) + '</p>'; return; }
    if (book === b && lang === wanted && !$('reader').hidden) renderPage(book.pos.scroll);
  }

  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function wordClass(lemma) {
    const r = words[lemma];
    return r && r.l > 0 && r.k !== 1 ? 'w lk' : 'w';
  }

  let imgUrls = [], shownAt = 0;
  const H = Formats.H;
  function renderPage(scrollRatio) {
    const el = $('page');
    const text = book.pages[book.pos.page] || '';
    imgUrls.forEach(u => URL.revokeObjectURL(u));
    imgUrls = [];
    const figs = ((book.imgs || {})[book.pos.page] || []).map(im => {
      const u = URL.createObjectURL(im.blob);
      imgUrls.push(u);
      return { before: im.before, html: `<figure class="fig"><img src="${u}" style="width:${Math.round(Math.max(0.3, Math.min(1, im.w)) * 100)}%" alt=""></figure>` };
    });
    const paras = text ? text.split('\n') : [];
    const hls = (book.hls || []).filter(h => h.page === book.pos.page);
    // obrázek patří před odstavec číslo "before"; co je pod posledním odstavcem, jde na konec
    const figsAt = i => figs.filter(f => f.before === i).map(f => f.html).join('');
    const figsEnd = figs.filter(f => f.before >= paras.length).map(f => f.html).join('');
    el.innerHTML = text ? paras.map((raw, pi) => {
      const head = raw[0] === H, p = head ? raw.slice(1) : raw;
      let html = '', last = 0;
      for (const m of p.matchAll(WORD_RE)) {
        const key = wkey(resolve(m[0]).lemma);
        const hl = hls.find(h => h.pi === pi && m.index >= h.a && m.index < h.b);
        html += esc(p.slice(last, m.index)) +
          `<span class="${wordClass(key)}${hl ? ' hl' + (hl.note ? ' note' : '') : ''}" data-l="${key.replace(/"/g, '')}" data-o="${m.index}">${m[0]}</span>`;
        last = m.index + m[0].length;
      }
      const tag = head ? 'h3' : 'p';
      return figsAt(pi) + `<${tag} data-pi="${pi}">` + html + esc(p.slice(last)) + `</${tag}>`;
    }).join('') + figsEnd : figsEnd || '<p class="hint">(na této straně není žádný text)</p>';
    $('pageNo').value = book.pos.page + 1;
    $('prev').disabled = book.pos.page === 0;
    $('next').disabled = book.pos.page >= book.pages.length - 1;
    hidePopup();
    el.scrollTop = (scrollRatio || 0) * Math.max(0, el.scrollHeight - el.clientHeight);
    shownAt = Date.now();
    savePos();
    if (App.hooks.render) App.hooks.render();
  }

  let posTimer = 0;
  function savePos() {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => { if (book) putBook(book); }, 300);
  }

  // Stranu, kterou dočtu a jdu dál, započítám do "už jsem četla".
  function countPageAsRead(i) {
    if (book.counted[i]) return;
    book.counted[i] = 1;
    for (const m of (book.pages[i] || '').match(WORD_RE) || []) wordRec(wkey(resolve(m).lemma)).s++;
    saveWords();
  }

  function goTo(i, viaNext) {
    i = Math.max(0, Math.min(book.pages.length - 1, i));
    if (i === book.pos.page) return;
    if (viaNext) {
      countPageAsRead(book.pos.page);
      // rychlost čtení (kvůli odhadu, kolik času zbývá): stránky čtené 3 s až 10 min
      const dt = Date.now() - shownAt, len = (book.pages[book.pos.page] || '').length;
      if (dt > 3000 && dt < 600000 && len > 200) { book.ms = (book.ms || 0) + dt; book.chars = (book.chars || 0) + len; }
    }
    book.pos = { page: i, scroll: 0 };
    renderPage(0);
  }

  // ---------- okénko s překladem ----------
  let popLemma = null;

  function seenText(r, before) {
    if (r.k === 1) return '✓ Tohle slovo máš označené jako známé.';
    if (before.l > 0) return `Už jsi ho překládala ${before.l}× a ještě ho neumíš.`;
    if (before.s > 0) return `Už jsi ho četla ${before.s}×, ale ještě nikdy nepřekládala.`;
    return 'Nové slovo, vidíš ho poprvé.';
  }

  function trHtml(tr) {
    return tr.split('; ').map(part => {
      const m = /^(\w+): (.*)$/.exec(part);
      return m ? `<div><i>${esc(m[1])}</i> ${esc(m[2])}</div>` : `<div>${esc(part)}</div>`;
    }).join('');
  }

  // Výklad jednoho hesla: u jazyků bez českého slovníku nejdřív anglicky, pak česky.
  function glossHtml(e) {
    if (lang === 'en') return e.cs ? trHtml(e.cs) : '';
    const en = e.en ? `<div class="g"><small>anglicky</small>${trHtml(e.en)}</div>` : '';
    const cs = e.cs ? `<div class="g"><small>česky</small>${trHtml(e.cs)}</div>` : '';
    return byCode[lang].primary === 'en' ? en + cs : cs + en;
  }

  // Popis tvaru slova (pád, číslo, čas…), když ho slovník zná.
  const gramHtml = e => e.gram && e.gram.length ? `<div class="gram">tvar: ${e.gram.map(esc).join(' <i>nebo</i> ')}</div>` : '';

  function showPopup(span) {
    const res = resolve(span.textContent);
    const key = wkey(res.lemma);
    const rec = wordRec(key);
    const before = { s: rec.s, l: rec.l };
    rec.l++;
    saveWords();
    popLemma = key;
    $('pWord').textContent = res.form;
    $('pBase').textContent = res.show !== res.form ? ' → ' + res.show : '';
    let html = (res.formCs ? `<div class="own">${trHtml(res.formCs)}</div>` : '') + gramHtml(res) + glossHtml(res);
    for (const a of res.alt) html += `<div class="alt"><b>nebo tvar od: ${esc(a.lemma)}</b>${gramHtml(a)}${glossHtml(a)}</div>`;
    let enAll = res.en;
    if (res.parts) {
      html = '<div class="hint">Ve slovníku není, zkouším ho rozložit na části:</div>' +
        res.parts.map(p => `<div class="alt"><b>${esc(p.show)}</b>${gramHtml(p)}${glossHtml(p) || '<div class="hint">bez překladu</div>'}</div>`).join('');
      enAll = res.parts.filter(p => !p.cs && p.en).map(p => p.en).join('; ');
    }
    if (!res.parts && !res.cs && !res.en) html = '<div class="hint">Ve slovníku jsem ho nenašla.</div>';
    else if (res.parts ? enAll : !res.cs) html += '<button id="pPivot" class="btn small">Přeložit do češtiny</button><div id="pPivotOut"></div>';
    $('pTr').innerHTML = html;
    const pv = $('pPivot');
    if (pv) pv.onclick = () => {
      const rows = pivot(enAll);
      $('pPivotOut').innerHTML = rows.length
        ? rows.map(r => `<div><i>${esc(r.w)}</i> ${esc(r.cs)}</div>`).join('')
        : '<div class="hint">Pro tenhle výklad český překlad nemám.</div>';
      pv.remove();
      placePopup(span);
    };
    $('pSeen').textContent = seenText(rec, before);
    $('pSeen').className = rec.k === 1 ? 'known' : before.l > 0 ? 'again' : before.s > 0 ? 'seen' : 'new';
    $('pKnown').classList.toggle('on', rec.k === 1);
    $('pUnknown').classList.toggle('on', rec.k !== 1);
    remark(key);
    document.querySelectorAll('.w.sel').forEach(s => s.classList.remove('sel'));
    span.classList.add('sel');
    $('popup').hidden = false;
    placePopup(span);
  }

  function placePopup(span) {
    const pop = $('popup');
    const r = span.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2));
    const y = Math.max(8, r.bottom + ph + 12 < window.innerHeight ? r.bottom + 8 : r.top - ph - 8);
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
  }

  function hidePopup() {
    $('popup').hidden = true;
    popLemma = null;
    document.querySelectorAll('.w.sel').forEach(s => s.classList.remove('sel'));
  }

  function remark(lemma) {
    const cls = wordClass(lemma);
    for (const s of $('page').querySelectorAll('.w')) {
      if (s.dataset.l === lemma) s.classList.toggle('lk', cls.includes('lk'));
    }
  }

  function setKnown(lemma, known) {
    wordRec(lemma).k = known ? 1 : 0;
    saveWords();
  }

  // ---------- slovníček ----------
  function vocabTr(r) {
    if (r.parts) return r.parts.map(p => p.show + ' (' + (vocabTr(p).split(/[;,] /)[0] || '?').replace(/^\w+: /, '') + ')').join(' + ');
    if (lang === 'en' || byCode[lang].primary === 'cs') return r.cs || r.en || '';
    return (r.en || '') + (r.cs ? (r.en ? ' · česky: ' : '') + r.cs : '');
  }

  function buildVocab() {
    const scope = $('fScope').value, cur = book.pos.page;
    const from = scope === 'rest' ? cur : 0;
    const to = scope === 'read' ? cur : book.pages.length;
    const map = new Map();
    let order = 0;
    for (let i = from; i < to; i++) {
      for (const m of book.pages[i].match(WORD_RE) || []) {
        const r = resolve(m);
        let e = map.get(r.lemma);
        if (!e) map.set(r.lemma, e = { lemma: r.lemma, show: r.show, tr: vocabTr(r), n: 0, order: order++ });
        e.n++;
      }
    }
    const total = map.size;
    const skip = lang === 'en' ? +$('fCommon').value : 0;
    const min = +$('fMin').value, hideKnown = $('fHideKnown').checked, onlyTr = $('fOnlyTr').checked;
    let list = [...map.values()].filter(e => e.n >= min && (!onlyTr || e.tr) && (!skip || rank(e.lemma) > skip) &&
      !(hideKnown && words[wkey(e.lemma)] && words[wkey(e.lemma)].k === 1));
    const sort = $('fSort').value;
    list.sort(sort === 'abc' ? (a, b) => a.lemma.localeCompare(b.lemma)
      : sort === 'order' ? (a, b) => a.order - b.order
      : (a, b) => b.n - a.n || a.order - b.order);
    return { list, total };
  }

  function renderVocab() {
    $('fCommonWrap').hidden = lang !== 'en';
    const { list, total } = buildVocab();
    $('vocabTitle').textContent = 'Slovníček: ' + book.title;
    $('vocabInfo').textContent = `Zobrazeno ${list.length} z ${total} různých slov. ` +
      'Zaškrtni slova, která znáš, a ze seznamu zmizí.';
    const box = $('vocabList');
    box.innerHTML = list.map(e => {
      const r = words[wkey(e.lemma)];
      const mark = r && r.k === 1 ? ' checked' : '';
      const cls = r && r.l > 0 && r.k !== 1 ? ' lk' : '';
      return `<div class="row${cls}"><label class="noprint"><input type="checkbox" data-l="${esc(wkey(e.lemma)).replace(/"/g, '')}"${mark}></label>` +
        `<b>${esc(e.show)}</b><small>${e.n}×</small><span>${e.tr ? esc(e.tr) : ''}</span></div>`;
    }).join('');
  }

  // ---------- události ----------
  const pdfsOf = list => [...list].filter(x => Formats.supported(x.name));
  $('file').onchange = e => { const fs = pdfsOf(e.target.files); e.target.value = ''; if (fs.length) importMany(fs); };
  $('scan').onclick = scanFolder;
  if (window.Android) $('scan').textContent = 'Najít knížky v telefonu';
  $('dirPick').onchange = e => {
    const fs = pdfsOf(e.target.files);
    e.target.value = '';
    showFound(fs.map(f => ({ name: f.name, path: (f.webkitRelativePath || '').replace(/[^/]*$/, ''), get: async () => f })));
  };
  $('foundCancel').onclick = () => { $('found').hidden = true; found = []; };
  $('foundAdd').onclick = async () => {
    const picked = [...$('foundList').querySelectorAll('input:checked')].map(c => found[+c.dataset.i]);
    if (!picked.length) return;
    $('found').hidden = true;
    const files = [];
    for (const p of picked) { try { files.push(await p.get()); } catch (e) { console.warn(e); } }
    found = [];
    importMany(files);
  };
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const fs = pdfsOf(e.dataTransfer.files);
    if (fs.length && !$('library').hidden) importMany(fs);
  });

  for (const sel of [$('newLang'), $('bookLang')]) {
    sel.innerHTML = LANGS.map(l => `<option value="${l.code}">${l.name}</option>`).join('');
  }
  $('newLang').onchange = e => kvSet('newLang', e.target.value);
  $('bookLang').onchange = e => { book.lang = lang = e.target.value; putBook(book); useLang(); };

  $('toLibrary').onclick = async () => { await putBook(book); showLibrary(); };
  $('prev').onclick = () => goTo(book.pos.page - 1);
  $('next').onclick = () => goTo(book.pos.page + 1, true);
  $('pageNo').onchange = e => goTo((+e.target.value || 1) - 1);
  $('fontPlus').onclick = () => setFont(fontSize + 1);
  $('fontMinus').onclick = () => setFont(fontSize - 1);
  function setFont(px) {
    fontSize = Math.max(13, Math.min(34, px));
    $('page').style.fontSize = fontSize + 'px';
    kvSet('fontSize', fontSize);
  }

  $('page').addEventListener('scroll', () => {
    const el = $('page'), max = el.scrollHeight - el.clientHeight;
    book.pos.scroll = max > 0 ? el.scrollTop / max : 0;
    savePos();
    hidePopup();
  });
  $('page').addEventListener('click', e => {
    const w = e.target.closest('.w');
    if (w) showPopup(w); else hidePopup();
  });
  $('pKnown').onclick = () => { const l = popLemma; setKnown(l, true); hidePopup(); remark(l); };
  $('pUnknown').onclick = () => { const l = popLemma; setKnown(l, false); hidePopup(); remark(l); };

  document.addEventListener('keydown', e => {
    if ($('reader').hidden || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); $('next').click(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); $('prev').click(); }
    if (e.key === 'Escape') hidePopup();
  });

  $('openVocab').onclick = () => { show('vocab'); renderVocab(); };
  $('toReader').onclick = () => { show('reader'); renderPage(book.pos.scroll); };
  $('print').onclick = () => window.Android ? window.Android.print('Slovníček') : window.print();
  // tlačítko Zpět v androidí aplikaci: zavře okénko, pak slovníček, pak knížku; v knihovně aplikaci opustí
  window.__back = () => {
    if (!$('popup').hidden) { hidePopup(); return true; }
    if (!$('vocab').hidden) { $('toReader').click(); return true; }
    if (!$('reader').hidden) { $('toLibrary').click(); return true; }
    return false;
  };
  for (const id of ['fScope', 'fSort', 'fMin', 'fCommon', 'fHideKnown', 'fOnlyTr']) $(id).onchange = renderVocab;
  $('vocabList').addEventListener('change', e => {
    if (e.target.dataset.l === undefined) return;
    setKnown(e.target.dataset.l, e.target.checked);
    if (e.target.checked && $('fHideKnown').checked) e.target.closest('.row').remove();
  });

  window.addEventListener('pagehide', () => { if (book) putBook(book); kvSet('words', words); });

  $('libSearch').oninput = drawLibrary;
  $('libSort').onchange = drawLibrary;

  // Co potřebují doplňky v more.js (hledání, záložky, vzhled, kartičky, záloha…).
  const App = window.App = {
    $, esc, byCode, H, hooks: {},
    get book() { return book; }, get lang() { return lang; }, get words() { return words; },
    setWords(w) { words = w; kvSet('words', words); },
    resolve, wkey, wordRec, saveWords, setKnown, remark, putBook, getBooks, kvGet, kvSet, fileGet, goTo, renderPage, showLibrary, show,
    hidePopup, placePopup, buildVocab, renderVocab, trHtml, glossHtml, savePos,
  };

  // ---------- start ----------
  (async function init() {
    words = (await kvGet('words')) || {};
    $('newLang').value = (await kvGet('newLang')) || 'en';
    setFont((await kvGet('fontSize')) || fontSize);
    const last = await kvGet('lastBook');
    const b = last && (await getBooks()).find(x => x.id === last);
    if (b) openBook(b); else showLibrary();
    // offline: stránku i slovníky si prohlížeč uloží do zařízení (sw.js); anglický slovník rovnou
    if ('serviceWorker' in navigator && !window.Android) navigator.serviceWorker.register('sw.js').catch(e => console.warn(e));
    setTimeout(() => window.Lang.load('en').catch(() => {}), 3000);
  })();
})();
