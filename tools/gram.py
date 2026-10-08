# Popisy tvaru slova (pad, cislo, cas...) cesky. Poradi ve slovniku = poradi ve vypisu; nezname znacky se zahazuji.
G = {
 "infinitive": "infinitiv", "infinitive-ma": "ma-infinitiv", "infinitive-da": "da-infinitiv", "participle": "příčestí",
 "l-participle": "příčestí minulé", "gerund": "gerundium", "gerundive": "gerundivum", "supine": "supinum",
 "transgressive": "přechodník", "indicative": "oznamovací způsob", "subjunctive": "konjunktiv",
 "conditional": "podmiňovací způsob", "imperative": "rozkazovací způsob", "optative": "optativ (přání)",
 "potential": "potenciál (moci)", "quotative": "kvotativ (prý)",
 "present": "přítomný čas", "past": "minulý čas", "preterite": "préteritum (minulý čas)", "imperfect": "imperfektum",
 "perfect": "perfektum", "pluperfect": "plusquamperfektum", "aorist": "aorist", "future": "budoucí čas",
 "future-perfect": "futurum II", "historic": "jednoduchý minulý čas",
 "active": "činný rod", "passive": "trpný rod", "middle": "medium", "mediopassive": "mediopasivum", "impersonal": "neosobní tvar",
 "negative": "zápor", "connegative": "tvar po záporu",
 "first-person": "1. osoba", "second-person": "2. osoba", "third-person": "3. osoba",
 "nominative": "nominativ (1. pád)", "genitive": "genitiv (2. pád)", "dative": "dativ (3. pád)",
 "accusative": "akuzativ (4. pád)", "vocative": "vokativ (5. pád)", "locative": "lokál (6. pád)",
 "instrumental": "instrumentál (7. pád)", "ablative": "ablativ (odkud, od čeho)",
 "partitive": "partitiv (část, neurčité množství)", "illative": "ilativ (kam, dovnitř)", "inessive": "inesiv (kde, uvnitř)",
 "elative": "elativ (odkud, zevnitř)", "allative": "alativ (kam, na co, komu)", "adessive": "adesiv (kde, na čem, u koho)",
 "translative": "translativ (čím se stává)", "terminative": "terminativ (až kam)", "essive": "esiv (jako co)",
 "abessive": "abesiv (bez čeho)", "comitative": "komitativ (s kým, s čím)",
 "ergative": "ergativ (kdo děj koná)", "absolutive": "absolutiv (základní pád)", "destinative": "destinativ (pro koho, určeno komu)",
 "directive": "direktiv (směrem k)", "benefactive": "benefaktiv (pro koho)", "causative": "kauzativ (kvůli čemu)",
 "prolative": "prolativ (za co, jako co)",
 "singular": "jednotné číslo", "dual": "dvojné číslo", "plural": "množné číslo",
 "masculine": "mužský rod", "feminine": "ženský rod", "neuter": "střední rod", "virile": "mužský osobní", "nonvirile": "ostatní rody",
 "animate": "životné", "inanimate": "neživotné",
 "definite": "určitý tvar", "indefinite": "neurčitý tvar", "proximal": "blízký tvar (tihle)",
 "strong": "silné skloňování", "weak": "slabé skloňování", "mixed": "smíšené skloňování",
 "comparative": "2. stupeň", "superlative": "3. stupeň", "excessive": "příliš (nadměrná míra)", "diminutive": "zdrobnělina",
 "short-form": "krátký tvar", "long-form": "dlouhý tvar", "contraction": "stažený tvar",
}
OVER = {
 "la": {"ablative": "ablativ (čím, odkud, kde, kdy)", "locative": "lokál (kde)"},
 "grc": {"locative": "lokál (kde)"},
 "eu": {"locative": "lokativ (kde, odkud je)", "instrumental": "instrumentál (čím, o čem)", "allative": "alativ (kam)",
        "inessive": "inesiv (kde, v čem)", "dative": "dativ (komu)", "genitive": "genitiv (čí)"},
 "et": {"genitive": "genitiv (čí, 2. pád)", "accusative": "akuzativ (celý předmět)"},
 "de": {"dative": "dativ (3. pád)"}, "fr": {"historic": "passé simple"}, "es": {}, "it": {"historic": "passato remoto"},
}
ORDER = {t: i for i, t in enumerate(G)}
def gram(tags, lang):
    ts = {t for t in tags.split() if t in G}
    if lang == "et" and "accusative" in ts: return ""          # estonsky "akuzativ" je jen jiny nazev pro tvar nominativu/genitivu
    if lang == "eu" and ts & {"singular", "plural"}: ts.discard("indefinite")
    if "historic" in ts: ts.discard("past")
    if lang == "de":                                            # "urcity tvar" tu znamena jen tvar se clenem
        ts -= {"definite", "indefinite"}
        if ts == {"past"}: return ""
    ts = sorted(ts, key=ORDER.get)
    return ", ".join(OVER.get(lang, {}).get(t, G[t]) for t in ts)
