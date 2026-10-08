# Anglicke fraze (2-4 slova, napr. "give up") z FreeDict eng-ces -> dict/en-phr.js
import sys, re, json, html, collections
src, out = sys.argv[1], sys.argv[2]
data = open(src, encoding="utf-8").read()
d = collections.OrderedDict()
for e in re.finditer(r"<entry>(.*?)</entry>", data, re.S):
    b = e.group(1)
    m = re.search(r"<orth>(.*?)</orth>", b, re.S)
    if not m: continue
    w = re.sub(r"\s+", " ", html.unescape(m.group(1))).strip().lower()
    n = w.count(" ") + 1
    if n < 2 or n > 4 or len(w) > 40 or not re.fullmatch(r"[a-z' -]+", w): continue
    trs = [html.unescape(q).strip() for q in re.findall(r"<quote>(.*?)</quote>", b, re.S)]
    lst = d.setdefault(w, [])
    for t in trs:
        if t and "\t" not in t and "\n" not in t and t not in lst and len(lst) < 6: lst.append(t)
raw = "\n".join(w + "\t" + ", ".join(l) for w, l in d.items() if l)
open(out, "w", encoding="utf-8", newline="\n").write(
    "// English-Czech phrases derived from FreeDict eng-ces 0.1.3 (GNU GPL v2+), https://freedict.org/\n"
    "window.DICTS = window.DICTS || {};\nwindow.DICTS['en-phr'] = " + json.dumps(raw, ensure_ascii=False) + ";\n")
print("phrases", len(d), "bytes", len(raw.encode("utf-8")))
for k in ("give up", "look for", "as well as", "of course", "take off"): print(k, "->", d.get(k))
