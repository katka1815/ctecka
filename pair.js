// Čtení s překladem vedle: knížka v cizím jazyce a tatáž knížka v jazyce, který znáš, na jedné obrazovce.
// Stránky dvou vydání si neodpovídají (překlad bývá delší, jinak zalomený, má jinou předmluvu), proto se
// párují věty: podle slovníku (překlad slova se hledá ve větě překladu), jmen a podobných slov a délky vět.
// Klepnutí na slovo ukáže odpovídající větu a slovo na druhé straně. Párování jde ručně opravit.
(function () {
  'use strict';
  const L = window.Lang, WORD_RE = L.WORD_RE, H = '\x01';
  const PV = 2;   // verze párování: po změně postupu zvednout, uložená párování se pak spočítají znovu

  // ---------- věty ----------
  // Konec věty: . ! ? … (případně uvozovky a závorka), mezera a za ní velké písmeno, číslice nebo uvozovky.
  const END_RE = /[.!?…]+["'»«”“’)\]]*\s+(?=[„"'»«“‚‘(\[—–-]*\s*[\p{Lu}\p{N}])/gu;
  // Věty nepřecházejí přes konec odstavce ani stránky (přes stránku je spojí párování, když je potřeba).
  function splitBook(b) {
    const S = [];   // { p: strana, pi: odstavec, a, b: poloha v odstavci (bez značky nadpisu), t: text }
    b.pages.forEach((txt, p) => {
      if (!txt) return;
      txt.split('\n').forEach((raw, pi) => {
        const t = raw[0] === H ? raw.slice(1) : raw;
        const add = (a, z) => { const s = t.slice(a, z); if (/\p{L}/u.test(s)) S.push({ p, pi, a, b: z, t: s }); };
        let a = 0;
        for (const m of t.matchAll(END_RE)) { const z = m.index + m[0].length; add(a, z); a = z; }
        add(a, t.length);
      });
    });
    return S;
  }

  // ---------- klíče slov ----------
  // Slovo překladu se zapisuje klíčem: v angličtině základní tvar, v češtině a jiných jazycích začátek slova
  // bez koncovky (kniha/knihu -> knih). Slovo originálu dostane klíče všech slov ze svého výkladu ve slovníku.
  const deacc = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  function makeStem(tl) {
    const c = new Map();
    const f = tl === 'en' ? w => L.resolve(w, 'en').lemma
      : tl === 'cs' ? w => { const s = deacc(w); return s.length <= 4 ? s : s.slice(0, Math.max(4, s.length - 3)); }
      : w => deacc(w).slice(0, 5);
    return w => { let k = c.get(w); if (k === undefined) c.set(w, k = f(w)); return k; };
  }
  // jména a slova, která vypadají v obou jazycích stejně (Gregor, Familie/family)
  const same = w => w.length >= 4 ? '=' + deacc(w).slice(0, 5) : null;
  const glossWords = g => g ? g.split('; ').map(p => p.replace(/^\w+: /, '')).join(' ').match(/\p{L}[\p{L}'-]*/gu) || [] : [];

  function makeKeys(lang, tl) {
    const stem = makeStem(tl), fc = new Map(), tc = new Map();
    const fromRes = (r, out) => {
      let ws = glossWords(tl === 'en' ? r.en : tl === 'cs' ? r.cs : null).slice(0, 16);
      // jazyky bez českého slovníku: přes anglický výklad
      if (tl === 'cs' && !r.cs && r.en) ws = L.pivot(r.en).flatMap(x => glossWords(x.cs).slice(0, 4));
      for (const w of ws) if (w.length > 2) out.add(stem(w));
      for (const a of r.alt || []) fromRes(a, out);
      for (const p of r.parts || []) fromRes(p, out);
    };
    return {
      f(w) {   // slovo originálu
        let k = fc.get(w);
        if (!k) {
          const out = new Set();
          fromRes(L.resolve(w, lang), out);
          const s = same(w);
          if (s) out.add(s);
          fc.set(w, k = [...out]);
        }
        return k;
      },
      t(w) {   // slovo překladu
        let k = tc.get(w);
        if (!k) { const s = same(w); tc.set(w, k = w.length < 3 ? [] : s ? [stem(w), s] : [stem(w)]); }
        return k;
      },
    };
  }

  // ---------- párování vět ----------
  // F, T: věty originálu a překladu jako { w: [klíče každého slova], n: počet znaků }.
  // Vrací konce úseků [konec vlevo, konec vpravo, ...]: úsek je 0–3 vět vlevo k 0–3 větám vpravo.
  // anchors: ručně opravená místa [věta vlevo, věta vpravo], kde úsek musí začínat.
  const SKIP = 0.5, LW = 0.5;
  const PEN = { 11: 0, 21: 0.1, 12: 0.1, 22: 0.25, 31: 0.2, 13: 0.2 };
  const MOVES = [[1, 1], [1, 0], [0, 1], [2, 1], [1, 2], [2, 2], [3, 1], [1, 3]];

  async function align(F, T, anchors, tick) {
    tick = tick || (() => {});
    // klíče na čísla; časté klíče (the, a, být…) nic neříkají, ty se nepočítají
    const ids = new Map(), df = [];
    const tsets = T.map(s => {
      const set = new Set();
      for (const ks of s.w) for (const k of ks) {
        let id = ids.get(k);
        if (id === undefined) { ids.set(k, id = df.length); df.push(0); }
        set.add(id);
      }
      for (const id of set) df[id]++;
      return set;
    });
    const stop = Math.max(4, T.length * 0.04), ok = id => id !== undefined && df[id] <= stop;
    const Tk = tsets.map(set => Int32Array.from([...set].filter(ok)));
    const nt = T.map(s => s.w.filter(ks => ks.some(k => ok(ids.get(k)))).length);
    const Fw = F.map(s => s.w.map(ks => Int32Array.from(ks.map(k => ids.get(k)).filter(ok))).filter(a => a.length));
    const nf = Fw.map(w => w.length);
    const Fn = F.map(s => s.n), Tn = T.map(s => s.n);
    const ratio = (Tn.reduce((a, b) => a + b, 0) || 1) / (Fn.reduce((a, b) => a + b, 0) || 1);

    // kolik slov věty i má svůj překlad ve větě j
    const stamp = new Int32Array(df.length);
    let tag = 0;
    const cache = [];
    function match(i, j) {
      const c = cache[i] || (cache[i] = new Map());
      let m = c.get(j);
      if (m !== undefined) return m;
      tag++;
      for (const id of Tk[j]) stamp[id] = tag;
      m = 0;
      for (const w of Fw[i]) for (const id of w) if (stamp[id] === tag) { m++; break; }
      c.set(j, m);
      return m;
    }
    // hodnota úseku: podíl slov s překladem na druhé straně, pomer délek, za vynechanou větu srážka;
    // násobí se délkou, aby počet úseků sám nic nezvýhodňoval
    function bead(m, nfs, nts, lf, lt, pen, base) {
      const size = (lf + lt) / 100;
      if (pen < 0) return -SKIP * size;
      const lex = (nfs + nts ? 2 * m / (nfs + nts) : 0) - (base || 0);
      const lp = Math.abs(Math.log((lt + 20) / (ratio * lf + 20)));
      return (lex - LW * lp - pen) * size;
    }

    // jeden úsek mezi ručními opravami
    async function solve(f0, f1, t0, t1, done, part) {
      const nF = f1 - f0, nT = t1 - t0;
      if (!nF || !nT) return [[f1, t1]];
      const fine = (i, j, di, dj) => {
        const a = f0 + i, b = t0 + j;
        let lf = 0, lt = 0, m = 0, nfs = 0, nts = 0;
        for (let x = 0; x < di; x++) lf += Fn[a + x];
        for (let y = 0; y < dj; y++) { lt += Tn[b + y]; nts += nt[b + y]; }
        if (!di || !dj) return bead(0, 0, 0, lf, lt, -1);
        for (let x = 0; x < di; x++) {
          let mx = 0;
          for (let y = 0; y < dj; y++) mx += match(a + x, b + y);
          m += Math.min(mx, nf[a + x]);
          nfs += nf[a + x];
        }
        return bead(m, nfs, nts, lf, lt, PEN[di * 10 + dj]);
      };
      let lo, hi;
      if (nF * nT <= 250000) {
        lo = new Int32Array(nF + 1); hi = new Int32Array(nF + 1).fill(nT);
      } else {
        // kotvy: věty, které mají v překladu jeden jasný protějšek (sdílejí s ním hlavně vzácná slova);
        // z nich nejdelší řada jdoucí stejným směrem. Přesně se pak páruje jen mezi sousedními kotvami.
        const idf = id => Math.log(nT / df[id]), post = new Map(), wt = new Float64Array(nT);
        for (let j = 0; j < nT; j++) for (const id of Tk[t0 + j]) {
          wt[j] += idf(id);
          let l = post.get(id);
          if (!l) post.set(id, l = []);
          l.push(j);
        }
        const sc = new Float64Array(nT), seen = new Int32Array(nT).fill(-1), touched = [], cand = [];
        let wn = 0;
        for (let i = 0; i < nF; i++) {
          let wf = 0;
          for (const w of Fw[f0 + i]) {
            // slovo se v jedné větě překladu počítá jednou, a to svým nejvzácnějším klíčem
            const ks = [...w].sort((x, y) => df[x] - df[y]);
            wn++;
            wf += idf(ks[0]);
            for (const id of ks) {
              const v = idf(id);
              for (const j of post.get(id) || []) if (seen[j] !== wn) { seen[j] = wn; if (!sc[j]) touched.push(j); sc[j] += v; }
            }
          }
          let bj = -1, s1 = 0, s2 = 0;
          for (const j of touched) {
            const s = 2 * sc[j] / (wf + wt[j]);
            if (s > s1) { s2 = s1; s1 = s; bj = j; } else if (s > s2) s2 = s;
            sc[j] = 0;
          }
          touched.length = 0;
          if (bj >= 0 && s1 >= 0.15 && s1 >= 1.3 * s2) cand.push([i, bj]);
          if (i % 500 === 499) { tick(done + part * 0.2 * i / nF); await new Promise(r => setTimeout(r, 0)); }
        }
        // nejdelší rostoucí řada (j roste spolu s i)
        const tails = [], prev = new Int32Array(cand.length).fill(-1);
        cand.forEach(([, j], k) => {
          let a = 0, b = tails.length;
          while (a < b) { const m = (a + b) >> 1; if (cand[tails[m]][1] < j) a = m + 1; else b = m; }
          if (a) prev[k] = tails[a - 1];
          tails[a] = k;
        });
        let mid = [];
        for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) mid.push(cand[k]);
        mid.reverse();
        // kotva platí, jen když leží v řadě aspoň tří kotev, které spolu drží běžný poměr délek;
        // osamocené kotvy (i dvojice) bývají omyl a posunuly by celý pás
        const per0 = nT / nF, fits = (a, b) => Math.abs(b[1] - a[1] - per0 * (b[0] - a[0])) <= 3 + 0.25 * per0 * (b[0] - a[0]);
        const keep = [];
        for (let k = 0; k < mid.length;) {
          let e = k + 1;
          while (e < mid.length && fits(mid[e - 1], mid[e])) e++;
          if (e - k >= 3) keep.push(...mid.slice(k, e));
          k = e;
        }
        mid = keep;
        const anc = [[0, 0], ...mid, [nF, nT]];
        // pás: mezi dvěma kotvami všechno, co leží mezi nimi v překladu, a kus okolo
        const M = 25;
        lo = new Int32Array(nF + 1); hi = new Int32Array(nF + 1);
        const per = nT / nF;
        for (let k = 0, i = 0; i <= nF; i++) {
          while (k < anc.length - 2 && anc[k + 1][0] <= i) k++;
          const [i1, j1] = anc[k], [i2, j2] = anc[k + 1];
          lo[i] = Math.max(0, j1 - M); hi[i] = Math.min(nT, j2 + M);
          // dlouhý kus bez kotev: jen pruh podél úhlopříčky (široký o to, oč se úsek odchyluje od běžného poměru)
          if ((i2 - i1) * (j2 - j1) > 160000) {
            const mid = j1 + (i - i1) * (j2 - j1) / Math.max(1, i2 - i1), w = Math.abs(j2 - j1 - (i2 - i1) * per) + 2 * M;
            lo[i] = Math.max(lo[i], Math.floor(mid - w)); hi[i] = Math.min(hi[i], Math.ceil(mid + w));
          }
        }
        lo[0] = 0; hi[nF] = nT;
        for (let i = 1; i <= nF; i++) lo[i] = Math.max(lo[i], lo[i - 1]);
        for (let i = nF - 1; i >= 0; i--) hi[i] = Math.min(hi[i], hi[i + 1]);
        for (let i = 0; i <= nF; i++) { if (i) lo[i] = Math.min(lo[i], hi[i - 1]); if (hi[i] < lo[i]) hi[i] = lo[i]; }
        lo[nF] = Math.min(lo[nF], nT);
        done += part * 0.2; part *= 0.8;
      }
      const path = await dp(nF, nT, lo, hi, MOVES, fine, r => tick(done + part * r));
      return path.map(([i, j]) => [f0 + i, t0 + j]);
    }

    // ruční opravy: rostoucí v obou směrech, uvnitř knížek
    const an = (anchors || []).filter(([i, j]) => i > 0 && j > 0 && i < F.length && j < T.length).sort((x, y) => x[0] - y[0]);
    const pts = [[0, 0]];
    for (const a of an) { const l = pts[pts.length - 1]; if (a[0] > l[0] && a[1] > l[1]) pts.push(a); }
    pts.push([F.length, T.length]);
    const out = [];
    for (let k = 1; k < pts.length; k++) {
      const [f0, t0] = pts[k - 1], [f1, t1] = pts[k];
      const done = f0 / Math.max(1, F.length), part = (f1 - f0) / Math.max(1, F.length);
      for (const [i, j] of await solve(f0, f1, t0, t1, done, part)) out.push(i, j);
    }
    return out;
  }

  // Nejlepší cesta mřížkou (i vět vlevo, j vpravo), j smí být jen v pásu lo[i]..hi[i].
  async function dp(nI, nJ, lo, hi, moves, score, tick) {
    const best = [], from = [];
    for (let i = 0; i <= nI; i++) {
      const w = hi[i] - lo[i] + 1, B = new Float64Array(w).fill(-Infinity), Fm = new Int8Array(w).fill(-1);
      best.push(B); from.push(Fm);
      for (let j = lo[i]; j <= hi[i]; j++) {
        if (!i && !j) { B[0] = 0; continue; }
        let b = -Infinity, bm = -1;
        for (let k = 0; k < moves.length; k++) {
          const pi = i - moves[k][0], pj = j - moves[k][1];
          if (pi < 0 || pj < lo[pi] || pj > hi[pi]) continue;
          const prev = best[pi][pj - lo[pi]];
          if (prev === -Infinity) continue;
          const s = prev + score(pi, pj, moves[k][0], moves[k][1]);
          if (s > b) { b = s; bm = k; }
        }
        B[j - lo[i]] = b; Fm[j - lo[i]] = bm;
      }
      if (i % 150 === 149) { tick(i / nI); await new Promise(r => setTimeout(r, 0)); }
    }
    const path = [];
    for (let i = nI, j = nJ; i > 0 || j > 0;) {
      const k = from[i][j - lo[i]];
      if (k < 0) throw new Error('Věty se nepodařilo spárovat.');
      path.push([i, j]);
      i -= moves[k][0]; j -= moves[k][1];
    }
    return path.reverse();
  }

  // Odhad jazyka překladu z prostředka knížky (začátek a konec bývá tiráž, často anglicky).
  function detectLang(b) {
    const mid = b.pages.length >> 1;
    const s = b.pages.slice(Math.max(0, mid - 15), mid + 15).join(' ').slice(0, 80000).toLowerCase();
    const n = (s.match(/\p{L}+/gu) || []).length || 1;
    if ((s.match(/[ěščřžůťďň]/g) || []).length / n > 0.05) return 'cs';
    if ((s.match(/\b(the|and|of|was|to)\b/g) || []).length / n > 0.06) return 'en';
    return 'x';
  }

  // Odhad jazyka knížky podle nejčastějších slov (jen jazyky, které se dají poznat spolehlivě).
  const STOP = {
    en: 'the and of to was he that it his in', de: 'der die und das nicht sich er ich ist zu',
    fr: 'le la les et des est que une il pas', es: 'el la que los de las por una con se',
    it: 'il che di la non per una è gli del', la: 'et in est non ad cum quod ut sed qui',
  };
  function guessLang(b) {
    const mid = b.pages.length >> 1;
    const words = b.pages.slice(Math.max(0, mid - 15), mid + 15).join(' ').slice(0, 80000).toLowerCase().match(/\p{L}+/gu) || [];
    if (words.length < 200) return null;
    const cnt = new Map();
    for (const w of words) cnt.set(w, (cnt.get(w) || 0) + 1);
    let best = null, bs = 0;
    for (const [l, list] of Object.entries(STOP)) {
      const sc = list.split(' ').reduce((a, w) => a + (cnt.get(w) || 0), 0) / words.length;
      if (sc > bs) { bs = sc; best = l; }
    }
    return bs > 0.08 ? best : null;
  }

  // Věty knížek jako vstup pro párování (s přestávkami, ať čtečka během počítání nezamrzne).
  async function prepare(S, keyOf) {
    const out = [];
    for (let i = 0; i < S.length; i++) {
      out.push({ n: S[i].t.length, w: (S[i].t.match(WORD_RE) || []).map(keyOf) });
      if (i % 400 === 399) await new Promise(r => setTimeout(r, 0));
    }
    return out;
  }

  window.Pair = { splitBook, makeKeys, align, detectLang, guessLang, prepare, PV };

  // ================= obrazovka =================
  const A = window.App;
  if (!A) return;
  const $ = A.$, esc = A.esc;
  const el = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
  const LANG_NAMES = { cs: 'čeština', en: 'angličtina', x: 'jiný jazyk' };

  // prvky: tlačítko v liště, druhý sloupec vedle stránky, okno pro výběr překladu
  $('menu').before(el('<button id="pairBtn" class="btn" title="Číst vedle překladu do jazyka, který znáš">⇆ Překlad</button>'));
  const split = el('<div id="split"></div>');
  $('page').before(split);
  split.append($('page'), el(`<div id="trSide" hidden>
    <div id="trBar"><span id="trTitle"></span><button id="trFix" class="btn small" title="Když věty vedle sebe nesedí">Opravit</button><button id="trSet" class="btn small">Změnit</button><button id="trOff" class="btn small" title="Schovat překlad">×</button></div>
    <p id="trMsg" hidden></p>
    <article id="trPage"></article></div>`));
  document.body.append(el(`<aside id="pairBox" hidden>
    <header class="bar"><span class="title">Překlad vedle</span><span class="spacer"></span><button id="pairClose" class="btn">Zavřít</button></header>
    <div id="pairBody"></div></aside>`));

  let P = null;          // spárovaná knížka právě otevřené knížky (viz load)
  let fix = null;        // oprava párování: { f: věta vlevo } čeká na klepnutí vpravo
  let busy = false;

  const tStart = k => k ? P.beads[2 * k - 1] : 0, fStart = k => k ? P.beads[2 * k - 2] : 0;
  const tEnd = k => P.beads[2 * k + 1], fEnd = k => P.beads[2 * k];
  function msg(html) { $('trMsg').hidden = !html; $('trMsg').innerHTML = html || ''; }

  // Připraví párování pro otevřenou knížku: načte překlad, rozdělí obě na věty, případně spočítá párování.
  async function load(force) {
    const b = A.book, pr = b && b.pair;
    if (!pr || !pr.on) { P = null; return false; }
    if (P && P.for === b && P.id === pr.id && !force) return true;
    const tb = (await A.getBooks()).find(x => x.id === pr.id);
    if (!tb) { P = null; msg('Knížka s překladem už v knihovně není. Vyber jinou tlačítkem Změnit.'); $('trPage').innerHTML = ''; return false; }
    const FS = splitBook(b), TS = splitBook(tb), sig = A.lang + ':' + FS.length + ':' + TS.length;   // jiný jazyk knížky = jiný slovník, spočítat znovu
    if (force || pr.v !== PV || pr.sig !== sig || !pr.beads) {
      busy = true;
      try {
        msg('Páruji věty obou knížek… 0 %');
        await L.load(A.lang);
        const keys = makeKeys(A.lang, pr.tl);
        const F = await prepare(FS, keys.f), T = await prepare(TS, keys.t);
        pr.beads = await align(F, T, pr.anchors, r => msg(`Páruji věty obou knížek… ${Math.round(r * 100)} %`));
        pr.v = PV; pr.sig = sig;
        await A.putBook(b);
      } catch (e) {
        console.error(e); msg('Párování se nepovedlo: ' + esc(e.message || String(e))); return false;
      } finally { busy = false; }
      msg('');
    }
    if (A.book !== b) return false;
    const fB = new Int32Array(FS.length), tB = new Int32Array(TS.length), beads = pr.beads;
    for (let k = 0, f = 0, t = 0; 2 * k < beads.length; k++) {
      for (; f < beads[2 * k]; f++) fB[f] = k;
      for (; t < beads[2 * k + 1]; t++) tB[t] = k;
    }
    const byPage = new Map();   // strana -> první věta na ní
    FS.forEach((s, i) => { if (!byPage.has(s.p)) byPage.set(s.p, i); });
    P = { for: b, id: pr.id, tb, tl: pr.tl, FS, TS, beads, fB, tB, byPage, keys: makeKeys(A.lang, pr.tl), lang: A.lang };
    $('trTitle').textContent = tb.title;
    return true;
  }

  // Věty originálu na zobrazené straně a jim odpovídající věty překladu.
  function pageRange() {
    const p = A.book.pos.page, f0 = P.byPage.get(p);
    if (f0 === undefined) return null;
    let f1 = f0;
    while (f1 < P.FS.length && P.FS[f1].p === p) f1++;
    return { f0, f1, t0: tStart(P.fB[f0]), t1: tEnd(P.fB[f1 - 1]) };
  }

  // Slova na stránce dostanou číslo své věty; vedle se vykreslí odpovídající kus překladu.
  function draw() {
    const page = $('page'), tp = $('trPage');
    if (!P) return;
    if (P.lang !== A.lang) P.keys = makeKeys(P.lang = A.lang, P.tl);
    const r = pageRange();
    if (r) {
      const sents = {};
      for (let i = r.f0; i < r.f1; i++) (sents[P.FS[i].pi] || (sents[P.FS[i].pi] = [])).push(i);
      for (const w of page.querySelectorAll('.w')) {
        const o = +w.dataset.o, list = sents[w.parentElement.dataset.pi] || [];
        const i = list.find(k => o >= P.FS[k].a && o < P.FS[k].b);
        if (i !== undefined) w.dataset.s = i;
      }
    }
    if (!r || r.t1 <= r.t0) {
      tp.innerHTML = '<p class="hint">' + (r ? 'K téhle straně jsem v překladu nic nenašla. Když to nesedí, oprav to tlačítkem Opravit.' : 'Na téhle straně není text.') + '</p>';
      return;
    }
    // jen spárované věty: žádný začátek ani konec odstavce okolo, ať nahoře nestojí nic, co k straně nepatří
    let html = '', cur = null, last = 0, para = '';
    const close = () => { if (cur) html += para + (cur.head ? '</h3>' : '</p>'); };
    for (let j = r.t0; j < r.t1; j++) {
      const s = P.TS[j];
      if (!cur || cur.p !== s.p || cur.pi !== s.pi) {
        close();
        const raw = (P.tb.pages[s.p] || '').split('\n')[s.pi] || '', head = raw[0] === H;
        cur = { p: s.p, pi: s.pi, head, text: head ? raw.slice(1) : raw };
        para = head ? '<h3>' : '<p>'; last = s.a;
      }
      let inner = '', at = 0;
      for (const m of s.t.matchAll(WORD_RE)) {
        inner += esc(s.t.slice(at, m.index)) + `<span class="tw">${esc(m[0])}</span>`;
        at = m.index + m[0].length;
      }
      inner += esc(s.t.slice(at));
      para += esc(cur.text.slice(last, s.a)) + `<span class="ts" data-s="${j}">${inner}</span>`;
      last = s.b;
    }
    close();
    const pg = [P.TS[r.t0].p + 1, P.TS[r.t1 - 1].p + 1];
    tp.innerHTML = html;
    $('trTitle').textContent = `${P.tb.title} · str. ${pg[0]}${pg[1] > pg[0] ? '–' + pg[1] : ''}`;
    syncScroll();
  }

  // Překlad sleduje čtení: nahoře je věta, která odpovídá první viditelné větě originálu.
  function syncScroll() {
    const page = $('page'), tp = $('trPage');
    if (!P || $('trSide').hidden) return;
    const w = [...page.querySelectorAll('.w[data-s]')].find(x => x.offsetTop + x.offsetHeight > page.scrollTop);
    if (!w) return;
    const k = P.fB[+w.dataset.s], t = tp.querySelector(`.ts[data-s="${tStart(k)}"]`) || tp.querySelector('.ts');
    if (t) tp.scrollTop = t.offsetTop - (w.offsetTop - page.scrollTop);
  }
  let syncing = 0;
  $('page').addEventListener('scroll', () => { cancelAnimationFrame(syncing); syncing = requestAnimationFrame(syncScroll); });

  function clearMarks() {
    for (const x of document.querySelectorAll('#split .pl, #split .pm')) x.classList.remove('pl', 'pm');
  }
  // Ze slov kandidátů vybere to, které leží ve větě nejblíž stejnému místu (podle pořadí slov).
  function nearest(cands, all, rel) {
    let best = null, bd = Infinity;
    for (const c of cands) { const d = Math.abs(all.indexOf(c) / Math.max(1, all.length - 1) - rel); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  const hit = (a, b) => a.some(k => b.includes(k));

  // Klepnutí na slovo originálu: odpovídající věty vpravo a v nich slovo, které je jeho překladem.
  function fromForeign(w) {
    const s = +w.dataset.s, k = P.fB[s];
    if (fix) {
      A.hidePopup();
      clearMarks();
      fix.f = s;
      for (const x of $('page').querySelectorAll(`.w[data-s="${s}"]`)) x.classList.add('pl');
      msg('Teď klepni vpravo na větu, která té označené odpovídá. <button id="fixCancel" class="btn small">Zrušit</button>');
      $('fixCancel').onclick = endFix;
      return;
    }
    clearMarks();
    const f0 = fStart(k), f1 = fEnd(k), t0 = tStart(k), t1 = tEnd(k);
    const fw = [...$('page').querySelectorAll('.w[data-s]')].filter(x => +x.dataset.s >= f0 && +x.dataset.s < f1);
    fw.forEach(x => x.classList.add('pl'));
    if (t1 <= t0) { msg('Tahle věta v překladu chybí (nebo jsem ji nespárovala).'); return; }
    msg('');
    const ts = [...$('trPage').querySelectorAll('.ts')].filter(x => +x.dataset.s >= t0 && +x.dataset.s < t1);
    ts.forEach(x => x.classList.add('pl'));
    const tw = ts.flatMap(x => [...x.querySelectorAll('.tw')]);
    const keys = P.keys.f(w.textContent);
    const m = nearest(tw.filter(x => hit(P.keys.t(x.textContent), keys)), tw, fw.indexOf(w) / Math.max(1, fw.length - 1));
    if (m) m.classList.add('pm');
    (m || ts[0])?.scrollIntoView({ block: 'nearest' });
  }

  // Klepnutí na slovo překladu: odpovídající věty vlevo a v nich slovo originálu.
  function fromTrans(tw) {
    const tsEl = tw.closest('.ts'), j = +tsEl.dataset.s, k = P.tB[j];
    if (fix) {
      if (fix.f === undefined) { msg('Nejdřív klepni vlevo na větu, která nesedí. <button id="fixCancel" class="btn small">Zrušit</button>'); $('fixCancel').onclick = endFix; return; }
      const b = A.book, f = fix.f;
      b.pair.anchors = (b.pair.anchors || []).filter(([i, t]) => (i < f && t < j) || (i > f && t > j));
      b.pair.anchors.push([f, j]);
      endFix();
      redo();
      return;
    }
    clearMarks();
    const f0 = fStart(k), f1 = fEnd(k), t0 = tStart(k), t1 = tEnd(k);
    const ts = [...$('trPage').querySelectorAll('.ts')].filter(x => +x.dataset.s >= t0 && +x.dataset.s < t1);
    ts.forEach(x => x.classList.add('pl'));
    if (f1 <= f0) { msg('Tahle věta v originálu chybí (nebo jsem ji nespárovala).'); return; }
    const fw = [...$('page').querySelectorAll('.w[data-s]')].filter(x => +x.dataset.s >= f0 && +x.dataset.s < f1);
    if (!fw.length) {
      const p = P.FS[f0].p;
      msg(`Tohle místo je v originálu na straně ${p + 1}. <button id="trGo" class="btn small">Přejít tam</button>`);
      $('trGo').onclick = () => { msg(''); A.goTo(p); };
      return;
    }
    msg('');
    fw.forEach(x => x.classList.add('pl'));
    const tw2 = ts.flatMap(x => [...x.querySelectorAll('.tw')]), keys = P.keys.t(tw.textContent);
    const m = nearest(fw.filter(x => hit(P.keys.f(x.textContent), keys)), fw, tw2.indexOf(tw) / Math.max(1, tw2.length - 1));
    if (m) m.classList.add('pm');
    (m || fw[0]).scrollIntoView({ block: 'nearest' });
  }

  $('page').addEventListener('click', e => {
    const w = e.target.closest('.w');
    if (!P || $('trSide').hidden || busy) return;
    if (!w || w.dataset.s === undefined) { if (!fix) clearMarks(); return; }
    fromForeign(w);
  });
  $('trPage').addEventListener('click', e => {
    const w = e.target.closest('.tw');
    if (!P || busy) return;
    A.hidePopup();
    if (w) fromTrans(w); else if (!fix) clearMarks();
  });

  function endFix() { fix = null; $('trFix').classList.remove('on'); msg(''); clearMarks(); }
  $('trFix').onclick = () => {
    if (fix) { endFix(); return; }
    if (!P || busy) return;
    fix = {};
    $('trFix').classList.add('on');
    clearMarks();
    msg('Oprava: klepni vlevo na větu, která nesedí, a pak vpravo na větu, která jí odpovídá. Od toho místa se věty spárují znovu. <button id="fixCancel" class="btn small">Zrušit</button>');
    $('fixCancel').onclick = endFix;
  };

  // Znovu spočítá párování (po opravě nebo změně) a překreslí.
  async function redo() {
    A.putBook(A.book);
    $('trPage').innerHTML = '';
    if (await load(true)) A.renderPage(A.book.pos.scroll);
  }

  // Zapne nebo vypne sloupec s překladem.
  async function showSide(on) {
    const b = A.book;
    $('trSide').hidden = !on;
    $('reader').classList.toggle('paired', on);
    $('pairBtn').classList.toggle('on', on);
    if (b.pair) { b.pair.on = on ? 1 : 0; A.putBook(b); }
    if (!on) { endFix(); clearMarks(); return; }
    if (await load()) A.renderPage(b.pos.scroll);
  }
  $('trOff').onclick = () => showSide(false);
  $('trSet').onclick = () => openBox();
  $('pairBtn').onclick = () => {
    const b = A.book;
    if (!b.pair) openBox();
    else showSide($('trSide').hidden);
  };

  // ---------- výběr knížky s překladem ----------
  let pick = null;
  async function openBox() {
    const b = A.book, books = (await A.getBooks()).filter(x => x.id !== b.id).sort((x, y) => (y.opened || y.added) - (x.opened || x.added));
    pick = b.pair ? b.pair.id : null;
    A.hidePopup();
    $('pairBox').hidden = false;
    const tl = b.pair ? b.pair.tl : null, g = guessLang(b);
    $('pairBody').innerHTML = `<p class="hint">Vyber knížku, která je překladem téhle. Musí být v knihovně: nahraj ji jako každou jinou knížku (jazyk, který jí dáš, je jedno).
      Čtečka spáruje věty obou knížek, takže nevadí, že mají jinak dlouhé stránky nebo jinou předmluvu.</p>` +
      (books.length ? books.map(x => `<button class="item${x.id === pick ? ' cur' : ''}" data-id="${x.id}"><span>${esc(x.title)}</span><small>${x.pages.length} str.</small></button>`).join('')
        : '<p class="hint"><b>V knihovně zatím žádná další knížka není.</b> Vrať se do knihovny a přidej překlad.</p>') +
      (g && g !== A.lang && A.byCode[g] ? `<p class="warn">Jazyk téhle knížky je nastavený na „${A.byCode[A.lang].name}“, ale text vypadá na „<b>${A.byCode[g].name}</b>“.
        Se špatným jazykem nepomáhá slovník a věty se spárují špatně. <button id="pairFixLang" class="btn small" data-l="${g}">Přepnout: ${A.byCode[g].name}</button></p>` : '') +
      `<p><label>Překlad je v jazyce <select id="pairLang">${Object.entries(LANG_NAMES).map(([k, n]) => `<option value="${k}"${k === tl ? ' selected' : ''}>${n}</option>`).join('')}</select></label></p>
      <p class="hint">U češtiny a angličtiny pomáhá párovat slovník. U jiného jazyka se páruje jen podle jmen a délky vět, takže je to méně přesné.</p>
      <div class="rowb"><button id="pairGo" class="btn primary"${pick ? '' : ' disabled'}>Spárovat</button>
      ${b.pair && (b.pair.anchors || []).length ? '<button id="pairAnch" class="btn">Smazat ruční opravy</button>' : ''}
      ${b.pair ? '<button id="pairDel" class="btn">Zrušit párování</button>' : ''}</div>`;
  }
  const closeBox = () => { $('pairBox').hidden = true; };
  $('pairClose').onclick = closeBox;
  $('pairBody').addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    const b = A.book;
    if (t.id === 'pairFixLang') {
      $('bookLang').value = t.dataset.l;
      $('bookLang').dispatchEvent(new Event('change'));
      t.closest('p').remove();
    } else if (t.dataset.id) {
      pick = t.dataset.id;
      for (const x of $('pairBody').querySelectorAll('.item')) x.classList.toggle('cur', x === t);
      $('pairGo').disabled = false;
      const tb = (await A.getBooks()).find(x => x.id === pick);
      if (tb) $('pairLang').value = detectLang(tb);
    } else if (t.id === 'pairGo' && pick) {
      const tl = $('pairLang').value, same = b.pair && b.pair.id === pick && b.pair.tl === tl;
      b.pair = same ? { ...b.pair, on: 1 } : { id: pick, tl, on: 1, anchors: [] };
      closeBox();
      P = null;
      showSide(true);
    } else if (t.id === 'pairAnch') {
      b.pair.anchors = [];
      b.pair.beads = null;
      closeBox();
      P = null;
      showSide(true);
    } else if (t.id === 'pairDel') {
      if (!confirm('Zrušit párování s překladem? Knížka s překladem zůstane v knihovně.')) return;
      showSide(false);
      delete b.pair;
      P = null;
      A.putBook(b);
      closeBox();
    }
  });

  // ---------- napojení na čtečku ----------
  // Písmo sloupce s překladem se řídí písmem stránky (velikost, druh, řádkování).
  new MutationObserver(() => {
    const s = $('page').style, t = $('trPage').style;
    t.fontSize = s.fontSize; t.fontFamily = s.fontFamily; t.lineHeight = s.lineHeight;
  }).observe($('page'), { attributes: true, attributeFilter: ['style'] });

  const open0 = A.hooks.open, render0 = A.hooks.render;
  A.hooks.open = () => {
    if (open0) open0();
    P = null; fix = null; closeBox(); msg(''); $('trPage').innerHTML = '';
    const on = !!(A.book.pair && A.book.pair.on);
    $('trSide').hidden = !on;
    $('reader').classList.toggle('paired', on);
    $('pairBtn').classList.toggle('on', on);
  };
  A.hooks.render = () => {
    if (render0) render0();
    if ($('trSide').hidden) return;
    clearMarks();
    if (fix) { fix = {}; }
    if (P && P.for === A.book) draw();
    else if (!busy) load().then(ok => { if (ok) draw(); });
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeBox(); if (fix) endFix(); } });
  const back0 = window.__back;
  window.__back = () => {
    if (!$('pairBox').hidden) { closeBox(); return true; }
    if (fix) { endFix(); return true; }
    return back0();
  };
})();
