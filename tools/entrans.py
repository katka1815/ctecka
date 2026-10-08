# stdin: kaikki English JSONL -> reverse dictionary from translation tables: {lang: {foreign_word: [english headwords]}}
import sys, json, collections
from norm import norm
want = {"et", "eu", "hsb", "dsb", "la", "grc"}
out = {l: collections.defaultdict(list) for l in want}
disp = {l: {} for l in want}
n = 0
for line in sys.stdin.buffer:
    if b'"translations"' not in line: continue
    try: o = json.loads(line)
    except Exception: continue
    w = o.get("word") or ""; pos = o.get("pos") or ""
    if not w or len(w) > 40 or pos in ("name", "character", "symbol"): continue
    trs = list(o.get("translations") or [])
    for s in o.get("senses", []): trs += s.get("translations") or []
    for t in trs:
        c = t.get("code") or t.get("lang_code")
        fw = t.get("word")
        if c in want and fw and " " not in fw:
            k = norm(fw, c)
            if k and k != fw: disp[c].setdefault(k, fw)
            if k and w not in out[c][k] and len(out[c][k]) < 6: out[c][k].append(w); n += 1
json.dump({"tr": out, "disp": disp}, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False)
print("pairs", n, {l: len(v) for l, v in out.items()}, file=sys.stderr)
