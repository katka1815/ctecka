import sys, re, json, html, collections
src, out = sys.argv[1], sys.argv[2]
data = open(src, encoding="utf-8").read()
d = collections.OrderedDict()
for e in re.finditer(r"<entry>(.*?)</entry>", data, re.S):
    b = e.group(1)
    m = re.search(r"<orth>(.*?)</orth>", b, re.S)
    if not m: continue
    w = html.unescape(m.group(1)).strip()
    if not w or " " in w or len(w) > 40: continue
    pos = re.search(r"<pos>(.*?)</pos>", b)
    pos = pos.group(1).strip() if pos else ""
    trs = [html.unescape(q).strip() for q in re.findall(r"<quote>(.*?)</quote>", b, re.S)]
    trs = [t for t in trs if t and "\t" not in t and "\n" not in t]
    if not trs: continue
    slot = d.setdefault(w.lower(), collections.OrderedDict())
    lst = slot.setdefault(pos, [])
    for t in trs:
        if t not in lst: lst.append(t)
lines = []
for w, slot in d.items():
    parts, n = [], 0
    for pos, lst in slot.items():
        lst = lst[:max(0, 10 - n)]; n += len(lst)
        if lst: parts.append((pos + ": " if pos else "") + ", ".join(lst))
    lines.append(w + "\t" + "; ".join(parts))
raw = "\n".join(lines)
open(out, "w", encoding="utf-8").write(
    "// English-Czech dictionary derived from FreeDict eng-ces 0.1.3 (GNU GPL v2+), https://freedict.org/\n"
    "window.DICTS = window.DICTS || {};\nwindow.DICTS.en = " + json.dumps(raw, ensure_ascii=False) + ";\n")
print("headwords", len(lines), "bytes", len(raw.encode("utf-8")))
for k in ("slouched", "run", "went", "though", "remember", "houses", "better", "pocket"): print(k, "->", (dict(l.split("\t") for l in lines)).get(k) if k=="slouched" else next((l for l in lines if l.startswith(k+"\t")), None))
