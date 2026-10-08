# stdin: kaikki.org JSONL for one language -> compact JSON {gloss: {head: {pos: [..]}}, forms: {form: [lemma..]}}
import sys, json, re, collections
from norm import norm
lang, out = sys.argv[1], sys.argv[2]
gloss = collections.defaultdict(lambda: collections.OrderedDict())
forms = collections.defaultdict(list)
disp = {}
SKIP_POS = {"character", "symbol", "punct", "letter", "diacritic"}
SKIP_TAGS = {"table-tags", "inflection-template", "class", "romanization"}
ftags = collections.defaultdict(dict)
JUNK = {"form-of", "alt-of", "canonical", "alternative", "error-unknown-tag", "error-unrecognized-form"}
def addform(f, lemma, tags=()):
    f, lemma = norm(f, lang), norm(lemma, lang)
    if not f or not lemma or f == lemma or " " in f or " " in lemma or len(f) > 40: return
    l = forms[f]
    if lemma not in l and len(l) < 4: l.append(lemma)
    t = " ".join(x for x in tags if x not in JUNK)
    if t and lemma in l:
        ts = ftags[f].setdefault(lemma, [])
        if t not in ts and len(ts) < 6: ts.append(t)
n = 0
for line in sys.stdin.buffer:
    try: o = json.loads(line)
    except Exception: continue
    n += 1
    w = o.get("word") or ""
    pos = o.get("pos") or ""
    if not w or " " in w or pos in SKIP_POS or w[0] == "-" or w[-1] == "-": continue
    key = norm(w, lang)
    if not key: continue
    islemma = False
    for s in o.get("senses", []):
        fo = s.get("form_of") or s.get("alt_of")
        if fo:
            for x in fo[:2]:
                if x.get("word"): addform(w, x["word"], s.get("tags") or ())
            continue
        g = (s.get("glosses") or [None])[-1]
        if not g: continue
        g = re.sub(r"\s+", " ", g).strip().rstrip(".")
        if len(g) > 90: g = g[:88].rsplit(" ", 1)[0] + "…"
        lst = gloss[key].setdefault(pos, [])
        if g not in lst and sum(len(v) for v in gloss[key].values()) < 6: lst.append(g)
        islemma = True
        if key != w: disp.setdefault(key, w)
    if islemma:
        for f in o.get("forms", []):
            if SKIP_TAGS & set(f.get("tags") or []): continue
            ff = f.get("form") or ""
            if ff and ff not in ("-", "—", "–"): addform(ff, w, f.get("tags") or ())
json.dump({"gloss": gloss, "forms": forms, "disp": disp, "ftags": ftags}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
print(lang, "entries", n, "heads", len(gloss), "forms", len(forms), file=sys.stderr)
