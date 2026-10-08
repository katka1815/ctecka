import sys, json, re, gzip, html, collections
from norm import norm
from gram import gram
SRC, OUT = sys.argv[1], sys.argv[2]
LANGS = sys.argv[3:] or ["de", "fr", "es", "it", "la", "grc", "eu", "et", "hsb", "dsb"]
FD = {"de": "deu", "fr": "fra", "es": "spa", "it": "ita"}
POS = {"noun": "n", "verb": "v", "adj": "adj", "adv": "adv", "name": "name"}
clean = lambda t: re.sub(r"[\t\n\r]+", " ", t).strip()

cs = {l: collections.defaultdict(list) for l in LANGS}
def addcs(l, w, t, cap=8):
    k = norm(w, l); t = clean(t)
    if re.search(r"osoba|pád |čísl[oa] |tvar |singulár|plurál|příčestí|přechodník|stupeň|nominativ|genitiv|dativ|akuzativ|ablativ|vokativ|imperativ|infinitiv ", t): return
    if k and t and " " not in k and t not in cs[l][k] and len(cs[l][k]) < cap and len(t) < 80: cs[l][k].append(t)

for l, fd in FD.items():
    if l not in cs: continue
    data = open(f"{SRC}/{fd}-ces/{fd}-ces.tei", encoding="utf-8").read()
    for e in re.finditer(r"<entry>(.*?)</entry>", data, re.S):
        m = re.search(r"<orth>(.*?)</orth>", e.group(1), re.S)
        if not m: continue
        for q in re.findall(r'<cit type="trans"[^>]*>\s*<quote>(.*?)</quote>', e.group(1), re.S):
            addcs(l, html.unescape(m.group(1)), html.unescape(q))
    print(l, "freedict heads", len(cs[l]))

n = collections.Counter(); rev = []
with gzip.open(f"{SRC}/cs-extract.jsonl.gz", "rt", encoding="utf-8") as f:
    for line in f:
        if '"lang_code": "cs"' in line:
            # české heslo: jeho tabulka překladů dává opačný směr (cizí slovo -> české)
            if '"translations"' in line:
                o = json.loads(line)
                if o.get("lang_code") == "cs" and " " not in o.get("word", " "):
                    for t in o.get("translations", []):
                        if t.get("lang_code") in cs and t.get("word"): rev.append((t["lang_code"], t["word"], o["word"]))
            continue
        o = json.loads(line); l = o.get("lang_code")
        if l not in cs: continue
        for s in o.get("senses", []):
            if s.get("form_of") or "form-of" in (s.get("tags") or []): continue
            g = (s.get("glosses") or [None])[-1]
            if g: addcs(l, o["word"], g.rstrip(".")); n[l] += 1
for l, fw, cw in rev: addcs(l, fw, cw)
print("cswikt glosses", dict(n), "reverse pairs", len(rev))
ET = json.load(open(f"{SRC}/k/entrans.json", encoding="utf-8"))

for l in LANGS:
    k = json.load(open(f"{SRC}/k2/{l}.json", encoding="utf-8"))
    heads = {}
    for w, bypos in k["gloss"].items():
        en = "; ".join((POS.get(p, p) + ": " if p else "") + ", ".join(clean(g) for g in gs) for p, gs in bypos.items())
        heads[w] = ["", en]
    for w, lst in cs[l].items():
        heads.setdefault(w, ["", ""])[0] = ", ".join(lst)
    disp = dict(k.get("disp", {}))
    added = 0
    if l != "de": disp = {w: d for w, d in disp.items() if d.lower() != w}
    for w, ens in ET["tr"].get(l, {}).items():
        if w not in heads and w in k["forms"]: continue   # ohnutý tvar známého slova, ne nové heslo
        h = heads.setdefault(w, ["", ""])
        if not h[1]:
            h[1] = ", ".join(clean(e) for e in ens); added += 1
            if w in ET["disp"].get(l, {}): disp.setdefault(w, ET["disp"][l][w])
    forms = collections.defaultdict(list)
    kf = k["forms"]
    ftab, fgram = {}, {}          # popis tvaru -> cislo; (tvar, zaklad) -> cisla popisu
    def addf(f, lem, depth=0, tags=()):
        if lem not in heads and depth < 2:
            for l2 in kf.get(lem, []): addf(f, l2, depth + 1, tags)
            return
        if f != lem and lem in heads and f and " " not in f and "\t" not in f and "~" not in f + lem and "|" not in f + lem and lem not in forms[f] and len(forms[f]) < 3:
            forms[f].append(lem)
            ids = []
            gs = [gram(t, l) for t in tags]
            sets = [set(g.split(", ")) for g in gs]
            for n, g in enumerate(gs):
                if any(sets[n] < o for o in sets): continue      # mene uplny popis tehoz tvaru
                if g and len(ids) < 3:
                    i = ftab.setdefault(g, len(ftab))
                    if i not in ids: ids.append(i)
            if ids: fgram[f, lem] = ids
    for f, lems in k["forms"].items():
        for lem in lems: addf(f, lem, 0, k.get("ftags", {}).get(f, {}).get(lem, ()))
    try:
        for line in open(f"{SRC}/lemm-{l}.txt", encoding="utf-8-sig"):
            p = line.rstrip("\r\n").split("\t")
            if len(p) == 2: addf(norm(p[1], l), norm(p[0], l))
    except FileNotFoundError: pass
    forms = {f: v for f, v in forms.items() if v}
    d = "\n".join(f"{w}\t{c}\t{e}" + ("\t" + disp[w] if w in disp and "\t" not in disp[w] else "")
                  for w, (c, e) in heads.items() if "\t" not in w and "\n" not in w)
    b36 = lambda n: "0123456789abcdefghijklmnopqrstuvwxyz"[n] if n < 36 else b36(n // 36) + b36(n % 36)
    fm = "\n".join(f + "\t" + "|".join(lem + ("~" + ".".join(b36(i) for i in fgram[f, lem]) if (f, lem) in fgram else "") for lem in v) for f, v in forms.items())
    with open(f"{OUT}/{l}.js", "w", encoding="utf-8", newline="\n") as o:
        o.write("// Slovnik: en.wiktionary.org pres kaikki.org (CC BY-SA), cs.wiktionary.org (CC BY-SA), FreeDict (GPL), tvary: michmech/lemmatization-lists (ODbL)\n")
        o.write("window.DICTS = window.DICTS || {}; window.FORMS = window.FORMS || {};\n")
        o.write(f"window.DICTS.{l} = {json.dumps(d, ensure_ascii=False)};\n")
        o.write(f"window.FORMS.{l} = {json.dumps(fm, ensure_ascii=False)};\n")
        o.write(f"window.FTAGS = window.FTAGS || {{}}; window.FTAGS.{l} = {json.dumps(chr(10).join(ftab), ensure_ascii=False)};\n")
    withcs = sum(1 for c, e in heads.values() if c)
    print(l, "from en translation tables +", added, end=" | ")
    print(l, "heads", len(heads), "with cs", withcs, "forms", len(forms), "with gram", len(fgram), "kinds", len(ftab), "MB", round((len(d.encode()) + len(fm.encode())) / 1e6, 1))
