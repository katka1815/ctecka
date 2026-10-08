Skripty, kterymi vznikly slovniky ve slozce dict/ (neni je potreba spoustet, jen pro pripadne pregenerovani).

en-cs.js      mkdict.py z FreeDict eng-ces (GPL)
ostatni       kaikki_extract.py: stream z https://kaikki.org/dictionary/<Jazyk>/kaikki.org-dictionary-<Jazyk>.jsonl
              (anglicky Wiktionary, CC BY-SA) -> JSON; potom assemble.py prida ceske preklady z FreeDict
              (deu/fra/spa/ita-ces) a z ceskeho Wikislovniku (kaikki cs-extract) a tvary slov
              z github.com/michmech/lemmatization-lists.
norm.py       normalizace slov; musi odpovidat funkci norm() v lang.js.
entrans.py    stream anglickeho kaikki souboru (kaikki.org-dictionary-English.jsonl): z tabulek prekladu
              u anglickych hesel udela opacny slovnik (cizi slovo -> anglicka slova) pro male jazyky.
gram.py       cesky popis tvaru slova (pad, cislo, cas...) ze znacek Wikislovniku; assemble.py ho uklada k tvarum (window.FTAGS).
