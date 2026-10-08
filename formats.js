// Načítání knížek v jiných formátech než PDF: EPUB, FB2 a TXT.
// Výsledek má stejný tvar jako u PDF: { pages: [text stránky], imgs: {stránka: [obrázky]}, toc: [{title, page}], cover }.
// Odstavce na stránce dělí '\n'; odstavec začínající znakem \x01 je nadpis.
(function () {
  'use strict';
  const PAGE = 1600;   // kolik znaků se zhruba vejde na jednu "stránku" u formátů bez stránek
  const H = '\x01';

  // ---------- ZIP (EPUB je zip) ----------
  async function readZip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), td = new TextDecoder();
    let e = buf.byteLength - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Soubor není platný archiv.');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const files = new Map();
    for (let i = 0; i < n && dv.getUint32(p, true) === 0x02014b50; i++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
      files.set(name, async () => {
        const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
        const raw = u8.subarray(start, start + size);
        if (method === 0) return raw;
        if (method !== 8) throw new Error('Neznámá komprese v archivu.');
        const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(s).arrayBuffer());
      });
      p += 46 + nl + el + cl;
    }
    return files;
  }

  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  const mimeOf = name => MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
  const clean = s => s.replace(/\s+/g, ' ').trim().normalize('NFC');

  function resolvePath(base, rel) {
    rel = decodeURIComponent(rel.split('#')[0]);
    if (rel.startsWith('/')) return rel.slice(1);
    const parts = base.split('/').slice(0, -1);
    for (const seg of rel.split('/')) {
      if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }

  // šířka obrázku jako podíl šířky stránky (velké přes celou, malé menší)
  async function imgBlock(blob) {
    let w = 0.7;
    try { const bm = await createImageBitmap(blob); w = Math.max(0.3, Math.min(1, bm.width / 600)); bm.close(); } catch (e) { /* nechám výchozí */ }
    return { t: 'img', blob, w };
  }

  // Zmenšenina na obálku v knihovně.
  async function thumb(src) {
    try {
      const bm = src instanceof Blob ? await createImageBitmap(src) : src;
      const w = 240, h = Math.round(bm.height / bm.width * w);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bm, 0, 0, w, h);
      return await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.8));
    } catch (e) { return null; }
  }

  // Bloky (odstavce, nadpisy, obrázky, začátky kapitol) rozdělí na stránky.
  function paginate(blocks) {
    const pages = [], imgs = {}, toc = [];
    let cur = [], len = 0;
    const flush = () => { if (cur.length || (imgs[pages.length] || []).length) { pages.push(cur.join('\n')); cur = []; len = 0; } };
    for (const b of blocks) {
      if (b.t === 'break') { flush(); continue; }
      if (b.t === 'toc') { toc.push({ title: b.title, page: pages.length }); continue; }
      if (b.t === 'img') {
        (imgs[pages.length] || (imgs[pages.length] = [])).push({ before: cur.length, blob: b.blob, w: b.w });
        len += 500;
      } else {
        if (b.t === 'h' && len > PAGE * 0.7) flush();
        cur.push((b.t === 'h' ? H : '') + b.text);
        len += b.text.length;
      }
      if (len >= PAGE) flush();
    }
    flush();
    // kapitola, která začíná až na další stránce, než kam ukazoval obsah
    for (const t of toc) t.page = Math.min(t.page, Math.max(0, pages.length - 1));
    return { pages, imgs, toc };
  }

  // ---------- HTML -> bloky ----------
  const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'dd', 'dt', 'tr', 'section',
    'article', 'figure', 'figcaption', 'header', 'footer', 'aside', 'ul', 'ol', 'table', 'body', 'hr']);
  const SKIP = new Set(['script', 'style', 'head', 'title', 'nav', 'template']);

  async function htmlBlocks(body, getImg, out, wantToc) {
    let buf = '', head = 0;
    const flush = () => {
      const t = clean(buf);
      buf = '';
      if (!t) return;
      if (head && wantToc && head <= 2) out.push({ t: 'toc', title: t.slice(0, 120) });
      out.push({ t: head ? 'h' : 'p', text: t });
    };
    async function walk(node) {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) { buf += ch.nodeValue; continue; }
        if (ch.nodeType !== 1) continue;
        const tag = ch.localName.toLowerCase();
        if (SKIP.has(tag)) continue;
        if (tag === 'br') { buf += ' '; continue; }
        if (tag === 'img' || tag === 'image') {
          const src = ch.getAttribute('src') || ch.getAttribute('xlink:href') || ch.getAttribute('href') ||
            ch.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
          const blob = src && await getImg(src);
          if (blob) { flush(); out.push(await imgBlock(blob)); }
          continue;
        }
        if (BLOCK.has(tag)) {
          flush();
          const wasHead = head;
          if (/^h[1-6]$/.test(tag)) head = +tag[1];
          await walk(ch);
          flush();
          head = wasHead;
        } else await walk(ch);
      }
    }
    await walk(body);
    flush();
  }

  // ---------- EPUB ----------
  async function importEpub(file, progress) {
    const zip = await readZip(await file.arrayBuffer());
    const td = new TextDecoder();
    const text = async name => { const f = zip.get(name); if (!f) throw new Error('V knížce chybí soubor ' + name); return td.decode(await f()); };
    const xml = s => new DOMParser().parseFromString(s, 'application/xml');
    const cont = xml(await text('META-INF/container.xml'));
    const opfPath = cont.querySelector('rootfile').getAttribute('full-path');
    const opf = xml(await text(opfPath));
    const items = {};
    for (const it of opf.querySelectorAll('manifest > item')) {
      items[it.getAttribute('id')] = { href: resolvePath(opfPath, it.getAttribute('href')), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' };
    }
    const spine = [...opf.querySelectorAll('spine > itemref')].map(r => items[r.getAttribute('idref')]).filter(Boolean);
    const title = clean((opf.querySelector('metadata > *|title, metadata title') || {}).textContent || '');

    // obsah: název kapitoly podle souboru, kterým začíná
    const chap = new Map();
    const navItem = Object.values(items).find(i => i.props.includes('nav'));
    const ncxItem = Object.values(items).find(i => i.type === 'application/x-dtbncx+xml');
    try {
      if (navItem) {
        const d = new DOMParser().parseFromString(await text(navItem.href), 'application/xhtml+xml');
        for (const a of d.querySelectorAll('nav a[href]')) {
          const f = resolvePath(navItem.href, a.getAttribute('href'));
          if (!chap.has(f)) chap.set(f, clean(a.textContent));
        }
      } else if (ncxItem) {
        const d = xml(await text(ncxItem.href));
        for (const np of d.querySelectorAll('navPoint')) {
          const src = np.querySelector('content'), lab = np.querySelector('navLabel');
          if (!src || !lab) continue;
          const f = resolvePath(ncxItem.href, src.getAttribute('src'));
          if (!chap.has(f)) chap.set(f, clean(lab.textContent));
        }
      }
    } catch (e) { console.warn('obsah knížky', e); }

    const imgCache = new Map();
    const blocks = [];
    for (let i = 0; i < spine.length; i++) {
      const it = spine[i];
      if (!zip.has(it.href)) continue;
      let doc = new DOMParser().parseFromString(await text(it.href), 'application/xhtml+xml');
      if (doc.querySelector('parsererror') || !doc.body) doc = new DOMParser().parseFromString(await text(it.href), 'text/html');
      const body = doc.body || doc.documentElement;
      blocks.push({ t: 'break' });
      if (chap.has(it.href)) blocks.push({ t: 'toc', title: chap.get(it.href) });
      await htmlBlocks(body, async src => {
        const path = resolvePath(it.href, src);
        if (!zip.has(path)) return null;
        if (!imgCache.has(path)) imgCache.set(path, new Blob([await zip.get(path)()], { type: mimeOf(path) }));
        return imgCache.get(path);
      }, blocks, chap.size === 0);
      if (progress && i % 5 === 0) progress(`kapitola ${i + 1} z ${spine.length}`);
    }
    const res = paginate(blocks);
    let coverItem = Object.values(items).find(i => i.props.includes('cover-image'));
    if (!coverItem) {
      const meta = opf.querySelector('metadata > meta[name="cover"]');
      coverItem = meta && items[meta.getAttribute('content')];
    }
    if (coverItem && zip.has(coverItem.href)) res.cover = await thumb(new Blob([await zip.get(coverItem.href)()], { type: mimeOf(coverItem.href) }));
    res.title = title;
    return res;
  }

  // ---------- FB2 ----------
  async function importFb2(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const headTxt = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
    const enc = (/encoding=["']([\w-]+)["']/i.exec(headTxt) || [])[1] || 'utf-8';
    let src;
    try { src = new TextDecoder(enc).decode(bytes); } catch (e) { src = new TextDecoder().decode(bytes); }
    const doc = new DOMParser().parseFromString(src, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Soubor FB2 je poškozený.');
    const bins = new Map();
    for (const b of doc.querySelectorAll('binary')) {
      try {
        const raw = atob(b.textContent.replace(/\s+/g, ''));
        const u8 = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
        bins.set(b.getAttribute('id'), new Blob([u8], { type: b.getAttribute('content-type') || 'image/jpeg' }));
      } catch (e) { /* vadný obrázek přeskočím */ }
    }
    const imgOf = el => bins.get(((el.getAttribute('l:href') || el.getAttribute('xlink:href') || el.getAttribute('href') ||
      el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '').replace(/^#/, '')));
    const blocks = [];
    async function walk(node, depth) {
      for (const ch of node.children) {
        const tag = ch.localName;
        if (tag === 'section') { blocks.push({ t: 'break' }); await walk(ch, depth + 1); }
        else if (tag === 'title') {
          const t = clean(ch.textContent);
          if (t) { if (depth <= 2) blocks.push({ t: 'toc', title: t.slice(0, 120) }); blocks.push({ t: 'h', text: t }); }
        } else if (tag === 'subtitle') { const t = clean(ch.textContent); if (t) blocks.push({ t: 'h', text: t }); }
        else if (tag === 'image') { const b = imgOf(ch); if (b) blocks.push(await imgBlock(b)); }
        else if (tag === 'p' || tag === 'v' || tag === 'text-author') {
          for (const im of ch.querySelectorAll('image')) { const b = imgOf(im); if (b) blocks.push(await imgBlock(b)); }
          const t = clean(ch.textContent);
          if (t) blocks.push({ t: 'p', text: t });
        } else await walk(ch, depth);
      }
    }
    for (const body of doc.querySelectorAll('FictionBook > body')) await walk(body, 0);
    const res = paginate(blocks);
    const cov = doc.querySelector('coverpage image');
    if (cov && imgOf(cov)) res.cover = await thumb(imgOf(cov));
    res.title = clean((doc.querySelector('title-info > book-title') || {}).textContent || '');
    return res;
  }

  // ---------- TXT ----------
  async function importTxt(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let src;
    try { src = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { src = new TextDecoder('windows-1250').decode(bytes); }
    src = src.replace(/\r\n?/g, '\n');
    const paras = /\n\s*\n/.test(src) ? src.split(/\n\s*\n/) : src.split('\n');
    return paginate(paras.map(clean).filter(Boolean).map(text => ({ t: 'p', text })));
  }

  const KINDS = { epub: importEpub, fb2: importFb2, txt: importTxt };
  const extOf = name => (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase() || '';
  window.Formats = {
    H, thumb, extOf,
    supported: name => extOf(name) === 'pdf' || !!KINDS[extOf(name)],
    canImport: name => !!KINDS[extOf(name)],
    importFile: (file, progress) => KINDS[extOf(file.name)](file, progress),
  };
})();
