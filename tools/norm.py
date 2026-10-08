import unicodedata
def norm(w, lang):
    w = w.lower().replace("’", "'").replace("ʼ", "'")
    if lang in ("la", "grc"):
        w = "".join(c for c in unicodedata.normalize("NFD", w) if not unicodedata.combining(c))
        w = unicodedata.normalize("NFC", w)
    if lang == "la": w = w.replace("j", "i").replace("v", "u").replace("æ", "ae").replace("œ", "oe")
    if lang == "grc": w = w.replace("ς", "σ").replace("'", "").replace("᾽", "")
    return unicodedata.normalize("NFC", w).strip("-' ")
