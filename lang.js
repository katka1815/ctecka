// Slovník a převod slova na základní tvar (angličtina -> čeština).
// Další jazyk = další soubor ve složce dict/ a další sada pravidel tady.
(function () {
  const LANGS = [
    { code: 'en', name: 'angličtina', files: ['en-cs', 'en-common', 'en-phr'], primary: 'cs' },
    { code: 'de', name: 'němčina', primary: 'cs', links: ['s', 'es', 'n', 'en', 'e', 'er', '-'] },
    { code: 'fr', name: 'francouzština', primary: 'cs' },
    { code: 'es', name: 'španělština', primary: 'cs' },
    { code: 'it', name: 'italština', primary: 'cs' },
    { code: 'la', name: 'latina', primary: 'en' },
    { code: 'grc', name: 'starořečtina', primary: 'en' },
    { code: 'eu', name: 'baskičtina', primary: 'en', links: ['-'] },
    { code: 'et', name: 'estonština', primary: 'en', links: ['-'] },
    { code: 'hsb', name: 'hornolužická srbština', primary: 'en' },
    { code: 'dsb', name: 'dolnolužická srbština', primary: 'en' },
  ];
  // Verze slovníků: po každém přegenerování souborů v dict/ zvednout, jinak zůstanou v offline paměti staré.
  const DICT_V = 4;
  const byCode = Object.fromEntries(LANGS.map(l => [l.code, l]));
  window.DICTS = window.DICTS || {};
  window.FORMS = window.FORMS || {};
  window.FTAGS = window.FTAGS || {};

  // data[code] = { heads: Map(slovo -> [česky, anglicky]), forms: Map(tvar -> "základ|základ") }
  const data = {};
  const loading = {};

  function addScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('Chybí soubor ' + src));
      document.head.append(s);
    });
  }

  function parse(raw, into, asPair) {
    let i = 0;
    while (i < raw.length) {
      let j = raw.indexOf('\n', i);
      if (j < 0) j = raw.length;
      const t = raw.indexOf('\t', i);
      if (t > i && t < j) {
        const rest = raw.slice(t + 1, j);
        if (asPair) {
          into.set(raw.slice(i, t), rest.split('\t'));   // [česky, anglicky, původní pravopis]
        } else into.set(raw.slice(i, t), rest);
      }
      i = j + 1;
    }
  }

  // Načte slovník jazyka (a anglicko-český, který slouží i k dopřekladu z angličtiny).
  function load(code) {
    if (!byCode[code]) code = 'en';
    if (!loading[code]) loading[code] = (async () => {
      for (const f of byCode[code].files || [code]) await addScript('dict/' + f + '.js?v=' + DICT_V);
      const d = { heads: new Map(), forms: new Map(), tags: (window.FTAGS[code] || '').split('\n') };
      parse(window.DICTS[code] || '', d.heads, true);
      parse(window.FORMS[code] || '', d.forms, false);
      window.DICTS[code] = window.FORMS[code] = window.FTAGS[code] = null;
      data[code] = d;
      if (code !== 'en') await load('en');
    })();
    return loading[code];
  }
  const dictEn = { get: w => { const e = data.en.heads.get(w); return e && e[0]; }, has: w => data.en.heads.has(w) };
  const loadEn = () => dictEn;

  const IRREGULAR = {};
  const irr = (base, forms) => forms.split(' ').forEach(f => { IRREGULAR[f] = base; });
  irr('be', "am is are was were been being isn't aren't wasn't weren't");
  irr('have', "has had having hasn't haven't hadn't");
  irr('do', "does did done doing doesn't don't didn't");
  irr('go', 'goes went gone going');
  irr('say', 'says said'); irr('get', 'got gotten getting'); irr('make', 'made making');
  irr('know', 'knew known'); irr('think', 'thought'); irr('take', 'took taken taking');
  irr('see', 'saw seen'); irr('come', 'came coming'); irr('give', 'gave given giving');
  irr('find', 'found'); irr('tell', 'told'); irr('become', 'became becoming');
  irr('leave', 'left leaving'); irr('feel', 'felt'); irr('bring', 'brought');
  irr('begin', 'began begun beginning'); irr('keep', 'kept'); irr('hold', 'held');
  irr('write', 'wrote written writing'); irr('stand', 'stood'); irr('hear', 'heard');
  irr('let', 'letting'); irr('mean', 'meant'); irr('set', 'setting'); irr('meet', 'met');
  irr('run', 'ran running'); irr('pay', 'paid'); irr('sit', 'sat sitting');
  irr('speak', 'spoke spoken'); irr('lie', 'lay lain lying'); irr('lead', 'led');
  irr('read', 'reading'); irr('grow', 'grew grown'); irr('lose', 'lost losing');
  irr('fall', 'fell fallen'); irr('send', 'sent'); irr('build', 'built');
  irr('understand', 'understood'); irr('draw', 'drew drawn'); irr('break', 'broke broken');
  irr('spend', 'spent'); irr('cut', 'cutting'); irr('rise', 'rose risen rising');
  irr('drive', 'drove driven driving'); irr('buy', 'bought'); irr('wear', 'wore worn');
  irr('choose', 'chose chosen choosing'); irr('seek', 'sought'); irr('throw', 'threw thrown');
  irr('catch', 'caught'); irr('deal', 'dealt'); irr('win', 'won winning');
  irr('forget', 'forgot forgotten forgetting'); irr('lay', 'laid'); irr('sell', 'sold');
  irr('fight', 'fought'); irr('bear', 'bore borne'); irr('teach', 'taught');
  irr('eat', 'ate eaten'); irr('sing', 'sang sung'); irr('strike', 'struck striking');
  irr('hang', 'hung'); irr('shake', 'shook shaken shaking'); irr('ride', 'rode ridden riding');
  irr('feed', 'fed'); irr('shoot', 'shot'); irr('drink', 'drank drunk'); irr('hit', 'hitting');
  irr('arise', 'arose arisen'); irr('fly', 'flew flown'); irr('hide', 'hid hidden hiding');
  irr('sleep', 'slept'); irr('wake', 'woke woken waking'); irr('swim', 'swam swum swimming');
  irr('steal', 'stole stolen'); irr('blow', 'blew blown'); irr('bite', 'bit bitten biting');
  irr('freeze', 'froze frozen'); irr('tear', 'tore torn'); irr('swear', 'swore sworn');
  irr('shine', 'shone'); irr('kneel', 'knelt'); irr('sweep', 'swept'); irr('weep', 'wept');
  irr('creep', 'crept'); irr('lend', 'lent'); irr('bend', 'bent'); irr('dig', 'dug digging');
  irr('stick', 'stuck'); irr('swing', 'swung'); irr('cling', 'clung'); irr('fling', 'flung');
  irr('spin', 'spun spinning'); irr('sink', 'sank sunk'); irr('ring', 'rang rung');
  irr('spring', 'sprang sprung'); irr('shrink', 'shrank shrunk');
  irr('bleed', 'bled'); irr('flee', 'fled');
  irr('forgive', 'forgave forgiven'); irr('stride', 'strode'); irr('light', 'lit');
  irr('slide', 'slid sliding'); irr('tread', 'trod trodden'); irr('weave', 'wove woven');
  irr('will', "would won't wouldn't"); irr('can', "could can't cannot couldn't");
  irr('shall', "should shan't shouldn't"); irr('may', 'might'); irr('must', "mustn't");
  irr('man', 'men'); irr('woman', 'women'); irr('child', 'children'); irr('foot', 'feet');
  irr('tooth', 'teeth'); irr('mouse', 'mice'); irr('goose', 'geese'); irr('person', 'people');
  irr('life', 'lives'); irr('wife', 'wives'); irr('knife', 'knives'); irr('leaf', 'leaves');
  irr('half', 'halves'); irr('wolf', 'wolves'); irr('shelf', 'shelves'); irr('thief', 'thieves');
  irr('good', 'better best'); irr('bad', 'worse worst'); irr('far', 'further farther furthest');

  // Slova, která vypadají jako ohnutý tvar, ale nejsou.
  const KEEP = new Set(('news pants his this thus always perhaps series species means towards afterwards ' +
    'besides sometimes across unless clothes trousers jeans scissors physics mathematics politics thanks ' +
    'yes its hers ours yours theirs us as is has was does goes less bus gas plus morning evening during ' +
    'ceiling wedding darling sibling string spring anything everything nothing something thing king ring ' +
    'bring sing wing being hundred indeed need seed speed sacred naked wicked red bed fed led wed shed ' +
    'sled bred sped bled fled embed united need used').split(' '));

  function candidates(w) {
    const c = [];
    const add = x => { if (x.length > 1 && x !== w && !c.includes(x)) c.push(x); };
    if (KEEP.has(w)) return c;
    const n = w.length;
    if (w.endsWith("n't")) add(w.slice(0, -3));
    if (w.endsWith("'ll") || w.endsWith("'ve") || w.endsWith("'re")) add(w.slice(0, -3));
    if (w.endsWith("'d") || w.endsWith("'m")) add(w.slice(0, -2));
    if (n > 4 && w.endsWith('ies')) add(w.slice(0, -3) + 'y');
    if (n > 4 && w.endsWith('ves')) { add(w.slice(0, -3) + 'f'); add(w.slice(0, -3) + 'fe'); }
    if (n > 4 && /(s|x|z|ch|sh|o)es$/.test(w)) add(w.slice(0, -2));
    if (n > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) add(w.slice(0, -1));
    if (n > 4 && w.endsWith('ied')) add(w.slice(0, -3) + 'y');
    if (n > 4 && w.endsWith('ed')) {
      const b = w.slice(0, -2);
      add(b); add(w.slice(0, -1));
      if (b.length > 2 && b[b.length - 1] === b[b.length - 2]) add(b.slice(0, -1));
    }
    if (n > 5 && w.endsWith('ing')) {
      const b = w.slice(0, -3);
      add(b); add(b + 'e');
      if (b.length > 2 && b[b.length - 1] === b[b.length - 2]) add(b.slice(0, -1));
      if (w.endsWith('ying')) add(w.slice(0, -4) + 'ie');
    }
    return c;
  }

  // Stupňování a příslovce zkoušíme jen u slov, která ve slovníku sama nejsou
  // (jinak by z "mother" vzniklo "moth").
  function looseCandidates(w) {
    const c = [];
    const add = x => { if (x.length > 2 && !c.includes(x)) c.push(x); };
    const n = w.length;
    for (const suf of ['er', 'est']) {
      if (n > suf.length + 2 && w.endsWith(suf)) {
        const b = w.slice(0, -suf.length);
        add(b); add(b + 'e');
        if (b.endsWith('i')) add(b.slice(0, -1) + 'y');
        if (b[b.length - 1] === b[b.length - 2]) add(b.slice(0, -1));
      }
    }
    if (n > 4 && w.endsWith('ily')) add(w.slice(0, -3) + 'y');
    if (n > 4 && w.endsWith('ly')) { add(w.slice(0, -2)); add(w.slice(0, -2) + 'le'); }
    if (n > 5 && w.endsWith('ness')) add(w.slice(0, -4));
    return c;
  }

  const caches = {};

  function norm(raw, code) {
    let w = raw.toLowerCase().replace(/[’ʼ]/g, "'");
    if (code === 'la' || code === 'grc') w = w.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
    if (code === 'la') w = w.replace(/j/g, 'i').replace(/v/g, 'u').replace(/æ/g, 'ae').replace(/œ/g, 'oe');
    if (code === 'grc') w = w.replace(/ς/g, 'σ').replace(/['᾽]/g, '');
    return w.normalize('NFC').replace(/^['-]+|['-]+$/g, '');
  }

  function resolveEn(rawWord) {
    let w = norm(rawWord, 'en');
    if (w.endsWith("'s")) w = w.slice(0, -2);
    const d = loadEn();
    const own = d.get(w) || null;
    let lemma = w, tr = own;
    const irrBase = IRREGULAR[w];
    if (irrBase && d.has(irrBase)) { lemma = irrBase; tr = d.get(irrBase); }
    else {
      const base = candidates(w).find(x => d.has(x)) || (!own && looseCandidates(w).find(x => d.has(x)));
      if (base) { lemma = base; tr = d.get(base); }
    }
    return { form: w, lemma, show: lemma, cs: tr, en: null, formCs: lemma !== w ? own : null, alt: [] };
  }

  function resolveOther(rawWord, code, noSplit) {
    const { heads, forms, tags } = data[code];
    let w = norm(rawWord, code);
    // záznam tvaru: "základ~3.1a|základ", čísla za ~ ukazují do tabulky popisů tvaru (pád, číslo, čas…)
    const gramOf = {};
    const read = x => (forms.get(x) || '').split('|').filter(Boolean).map(c => {
      const [lem, ids] = c.split('~');
      gramOf[lem] = ids ? ids.split('.').map(i => tags[parseInt(i, 36)]).filter(Boolean) : null;
      return lem;
    });
    let cands = read(w);
    if (code === 'la' && !heads.has(w) && !cands.length) {
      for (const suf of ['que', 'ne', 'ue']) {   // přívěsky -que, -ne, -ve
        const b = w.endsWith(suf) && w.length > suf.length + 1 ? w.slice(0, -suf.length) : '';
        if (b && (heads.has(b) || forms.has(b))) { w = b; cands = read(w); break; }
      }
    }
    const known = cands.filter(c => heads.has(c));
    const own = heads.get(w);
    // vlastní jméno ustoupí, když je slovo zároveň tvarem běžného slova (šp. "casas" -> casa)
    const ownIsName = own && !own[0] && /^name: [^;]*$/.test(own[1] || '');
    const capital = rawWord[0] !== rawWord[0].toLowerCase();
    const lemma = own && !(ownIsName && known.length && !capital) ? w : known[0] || cands[0] || w;
    const show = k => (heads.get(k) || [])[2] || k;
    const e = heads.get(lemma) || [];
    const alt = [...known, ...(own ? [w] : [])].filter(c => c !== lemma).slice(0, 2)
      .map(c => ({ lemma: show(c), cs: heads.get(c)[0] || null, en: heads.get(c)[1] || null, gram: gramOf[c] || null }));
    const res = { form: rawWord.toLowerCase(), lemma, show: show(lemma), cs: e[0] || null, en: e[1] || null, formCs: null, alt, gram: gramOf[lemma] || null };
    if (!heads.has(lemma) && !noSplit && byCode[code].links) {
      const parts = splitCompound(w, code);
      // tvar (pád, číslo) nese jen poslední část složeniny
      if (parts) res.parts = parts.map((p, i) => i < parts.length - 1 ? { ...resolveOther(p, code, true), gram: null } : resolveOther(p, code, true));
    }
    return res;
  }

  // Složeninu, která ve slovníku není, zkusí rozložit na známá slova (něm. Schul|buch, est. kooli|maja).
  // Mezi částmi může být spojovací hláska (něm. -s-, -n-…) a první část může mít odpadlé koncové -e.
  function splitCompound(w, code) {
    const { heads, forms } = data[code];
    const links = byCode[code].links;
    const known = s => heads.has(s) || forms.has(s);
    if (w.length < 7 || w.includes('-') && w.split('-').every(known)) return w.includes('-') && w.length >= 7 ? w.split('-') : null;
    let best = null, bestScore = Infinity;
    const walk = (pos, parts) => {
      if (parts.length >= 4) return;
      const tail = w.slice(pos);
      if (parts.length && tail.length >= 3 && known(tail)) {
        const all = [...parts, tail];
        const score = all.length * 100 - Math.min(...all.map(p => p.length)) * 10 - all[all.length - 1].length;
        if (score < bestScore) { bestScore = score; best = all; }
      }
      for (let end = w.length - 3; end >= pos + 3; end--) {
        const seg = w.slice(pos, end);
        const part = known(seg) ? seg : code === 'de' && known(seg + 'e') ? seg + 'e' : null;
        if (!part) continue;
        walk(end, [...parts, part]);
        for (const l of links) if (l && w.startsWith(l, end) && w.length - end - l.length >= 3) walk(end + l.length, [...parts, part]);
      }
    };
    walk(0, []);
    return best;
  }

  // Vrací { form, lemma, cs, en, formCs, alt, gram }: gram popisuje tvar (pád, číslo…), lemma je základní tvar, pod kterým si slovo pamatujeme.
  function resolve(rawWord, code) {
    code = byCode[code] ? code : 'en';
    const cache = caches[code] || (caches[code] = new Map());
    let r = cache.get(rawWord);
    if (!r) cache.set(rawWord, r = code === 'en' ? resolveEn(rawWord) : resolveOther(rawWord, code));
    return r;
  }

  // Dopřeklad anglického výkladu do češtiny: pro každé významové slovo najde český překlad.
  function pivot(enGloss) {
    const out = [], seen = new Set();
    const text = enGloss.split('; ').map(p => p.replace(/^\w+: /, '')).join('; ');   // bez značek slovních druhů
    for (const m of text.matchAll(/[A-Za-z][A-Za-z'-]*/g)) {
      const r = resolveEn(m[0]);
      if (!r.cs || seen.has(r.lemma) || rank(r.lemma) <= 60) continue;
      seen.add(r.lemma);
      out.push({ w: r.lemma, cs: r.cs.replace(/\b\w+: /g, '').split(/[;,] /).slice(0, 5).join(', ') });
      if (out.length >= 8) break;
    }
    return out;
  }

  // Pořadí slova mezi nejběžnějšími anglickými slovy (1 = nejčastější), nebo Infinity.
  let ranks = null;
  function rank(lemma) {
    if (!ranks) {
      ranks = new Map();
      ((window.COMMON && window.COMMON.en) || '').split(' ').forEach((w, i) => {
        const l = resolveEn(w).lemma;
        if (!ranks.has(l)) ranks.set(l, i + 1);
      });
    }
    return ranks.get(lemma) || Infinity;
  }

  window.Lang = { LANGS, byCode, load, resolve, pivot, rank, WORD_RE: /\p{L}[\p{L}\p{M}'’᾽-]*/gu };
})();
