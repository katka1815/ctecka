# Čtečka: dokumentace

Stav k 8. 10. 2026 (apk verze 3). Popisuje, co čtečka je, jak je udělaná a proč, co je ověřené,
co nefungovalo a jak se to obešlo.

## 1. Co to je

Vlastní čtečka knížek s překladem slov po kliknutí. Vznikla, protože hotové aplikace jsou placené nebo
s reklamami. Zadání:

1. načíst knížku (původně PDF, teď i EPUB, FB2, TXT),
2. pamatovat si, kde čtení skončilo,
3. po kliknutí slovo přeložit,
4. udělat z knížky slovníček k vytištění,
5. u slova ukázat, jestli už bylo čtené nebo překládané.

Později přibylo: offline provoz, žádný sběr dat, instalace jako aplikace, hledání knížek v telefonu
(až po dotazu), změna jazyka knížky při čtení.

## 2. Tři způsoby, jak ji mít

| Kde | Jak | Poznámka |
|---|---|---|
| Android | `Ctecka.apk` z [Releases](https://github.com/katka1815/ctecka/releases/latest) | Všechny slovníky uvnitř, bez oprávnění k internetu, umí projít úložiště. Neaktualizuje se sama. |
| iPhone, jiný telefon | https://katka1815.github.io/ctecka/ a „Přidat na plochu" | Běží offline po prvním načtení; slovník jazyka se stáhne při prvním použití. |
| Počítač | stejná adresa, nebo `Spustit ctecku.bat` | Bat spustí místní server na portu 8765. |

Každé zařízení (a každá z těch tří cest) má **vlastní knihovnu a vlastní slovíčka**. Přenáší se jen ručně
přes „Záloha do souboru" a „Obnovit ze zálohy".

## 3. Z čeho se skládá

Čistý HTML, CSS a JavaScript bez sestavovacího kroku: soubor se upraví a je hotovo.

| Soubor | Co dělá |
|---|---|
| `index.html`, `style.css` | Stránka a vzhled (knihovna, čtení, slovníček). |
| `app.js` | Jádro: úložiště, načtení PDF, knihovna, čtení, okénko s překladem, slovníček. |
| `lang.js` | Jazyky, načítání slovníků, převod slova na základní tvar, složeniny. |
| `formats.js` | Načtení EPUB, FB2 a TXT (včetně vlastního čtení zip archivu). |
| `more.js` | Nabídka u knížky (obsah, hledání, záložky, vzhled), označený text, výslovnost, kartičky, záloha. |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Instalace z prohlížeče a offline provoz. |
| `dict/` | Slovníky jako datové soubory (175 MB). |
| `vendor/` | pdf.js 3.11 (čtení PDF). |
| `tools/` | Skripty v Pythonu, kterými slovníky vznikly. |
| `android/` | Zdroják androidího obalu a `build.sh`. |

`app.js` zpřístupňuje své funkce přes `window.App`; `more.js` je používá a do jádra se zapojuje dvěma
háčky (`App.hooks.open`, `App.hooks.render`).

## 4. Jak to funguje

### Knížka
Při nahrání se soubor jednou zpracuje na **stránky textu** a uloží do prohlížeče (IndexedDB). Čte se už jen
z toho, původní soubor není potřeba.

- **PDF:** text se bere z pdf.js po kouscích s polohou; z nich se skládají řádky a odstavce (podle mezer
  mezi řádky a odsazení), spojují se rozdělená slova a zahazují čísla stran. Stránka čtečky = stránka PDF.
- **EPUB, FB2, TXT:** nemají stránky, text se dělí zhruba po 1600 znacích, kapitola začíná na nové stránce.
- **Obrázky:** u PDF se zjistí místo obrázku na stránce, stránka se vykreslí a obrázek se z ní vyřízne
  (funguje pro všechny druhy obrázků stejně). U EPUB a FB2 se berou přímo ze souboru. Vkládají se mezi
  odstavce podle polohy.
- **Obsah:** z EPUB (nav nebo ncx), z nadpisů FB2, z osnovy PDF, pokud ji má.
- **Původní PDF** se ukládá zvlášť (úložiště `files`) jen kvůli funkci „původní stránka".

Záznam knížky: `id, title, kind, lang, pages[], imgs{}, toc[], cover, pos{page, scroll}, counted[], marks[],
hls[], ms, chars`. Odstavce na stránce dělí `\n`, odstavec začínající znakem `\x01` je nadpis.

### Slovníky a překlad
Slovník jazyka je jeden soubor `dict/<kód>.js` se třemi tabulkami: hesla (česky, anglicky, původní
pravopis), tvary slov (tvar → základní tvar a popis tvaru) a popisy tvaru česky. Načítá se, až když je
potřeba.

- **Angličtina:** základní tvar se odhaduje pravidly (koncovky, tabulka nepravidelných sloves).
- **Ostatní jazyky:** základní tvar se hledá v tabulce tvarů z Wikislovníku a ze seznamů
  lemmatization-lists.
- **Jazyky bez českého slovníku** (latina, starořečtina, baskičtina, estonština, lužická srbština): ukáže
  se nejdřív anglický výklad, tlačítkem jde dopřeložit do češtiny přes anglicko-český slovník.
- **Složeniny** (němčina, estonština, baskičtina): když slovo ve slovníku není, zkusí se rozložit na známá
  slova; u němčiny se počítá se spojovacími hláskami.
- **Tvar slova:** pád, číslo, osoba, čas se berou z tabulek skloňování a časování ve Wikislovníku
  a převádějí do češtiny (`tools/gram.py`).
- **Anglické fráze:** 16,7 tisíce víceslovných hesel („give up") v `dict/en-phr.js`.

### Paměť slov
Pro každý základní tvar: kolikrát byl přečten, kolikrát přeložen a jestli je označen jako známý. Stránka
se počítá za přečtenou, když se z ní odejde tlačítkem „Další". Slova se pamatují zvlášť pro každý jazyk
a jsou společná pro všechny knížky v zařízení.

### Androidí aplikace
Tenký obal: jedno okno s prohlížečem (WebView), které bere stránky čtečky z balíčku aplikace pod
smyšlenou adresou `https://ctecka.app/`. Navíc přidává, co web neumí: projití úložiště, hlas telefonu,
uložení souboru do Stažených, tisk a tlačítko Zpět.

## 5. Rozhodnutí a proč

| Rozhodnutí | Proč |
|---|---|
| Nejdřív verze pro počítač, mobil až potom | Tak znělo zadání; rychleji se na ní ladilo. |
| Slovníky offline, ne překladač po internetu | Nemá nic stát ani nic posílat ven; bezplatné překladače se navíc neosvědčily (viz 6). |
| Bez sestavovacích nástrojů a knihoven (kromě pdf.js) | Úprava = přepsat soubor. Nic se nemusí instalovat. |
| Nejdřív anglický výklad, čeština na vyžádání | Výslovné přání pro jazyky bez českého slovníku. |
| Apk bez oprávnění INTERNET | Záruka, že aplikace nemůže nic odeslat, ani kdyby chtěla. |
| Hledání knížek až po dotazu a povolení | Výslovné přání; povolení dává Android, čtečka jen požádá. |
| GitHub Pages, ne Cloudflare | Cloudflare má limit 25 MB na soubor, čtyři slovníky jsou větší. |
| Apk stavěné ručně (aapt2, javac, d8), bez Gradle | Jedna obrazovka nepotřebuje velký nástroj; stačí přenosná Java a Android SDK. |
| Zip pro EPUB napsaný vlastní | Prohlížeč umí rozbalovat sám (`DecompressionStream`), knihovna není potřeba. |
| Vynecháno: MOBI, rozpoznávání textu ve skenech, složky v knihovně | MOBI je uzavřený formát; rozpoznávání textu potřebuje desítky MB dat na jazyk; místo složek je hledání a řazení. |

## 6. Co nefungovalo a jak se to obešlo

| Problém | Řešení |
|---|---|
| Bezplatný Google překladač vracel z domácí sítě chybu 429 (příliš mnoho dotazů) a MyMemory překládal jednotlivá slova špatně | Přechod na offline slovníky (FreeDict, Wikislovník). |
| Prohlížeč neotevře čtečku přímo ze souboru tak, aby šla testovat a ukládat data | Spouští se přes místní server (`Spustit ctecku.bat`). |
| Slovníček zaplnila slova jako „the, be, and" | Filtr „přeskočit nejběžnější slova" (jen angličtina, podle seznamu 10 000 slov). |
| Okénko s překladem vyjíždělo mimo obrazovku | Poloha se ořezává do okna. |
| Hesla jako přípony („-ir"), čistě gramatické výklady a jména, která přebíjela běžná slova (šp. „casas") | Filtry při stavbě slovníků; jméno má přednost jen u slova s velkým písmenem. |
| Latinské příčestí vedlo na další tvar, ne na sloveso | Řetězení tvar → tvar → základ (nejvýš dva kroky). |
| Latinské -que, -ne, -ve | Přívěsek se odřízne, když zbytek slovník zná. |
| Estonský slovník měl jen 7,6 tisíce hesel | Hesla doplněna z tabulek překladů u anglických a českých hesel Wikislovníku (16,3 tisíce). Velké slovníky estonského institutu jsou zdarma, ale jen přes účet a klíč, proto použité nejsou. |
| Estonský „akuzativ" a německý „určitý tvar" ve Wikislovníku jen opakují jiné tvary | Při převodu do češtiny se zahazují. |
| PDF mívá obrázek rozsekaný na pruhy | Sousedící kusy se před vyříznutím spojí. |
| Aplikace z prohlížeče nesmí projít celý telefon (jen vybranou složku, a ne Stažené) | Proto vzniklo apk, které to po povolení umí. |
| V androidím okně nefunguje hlas prohlížeče ani stahování souborů | Obal je dělá sám (hlas telefonu, uložení do Stažených). |
| GitHub přihlášení nemá právo nahrávat automatizace, takže apk nejde stavět v cloudu | Staví se na počítači ve složce `C:\Users\42073\android-build`. |
| Zobrazení původní stránky potřebuje původní PDF, které se dřív neukládalo | Od verze 2 se ukládá; starší knížky je potřeba nahrát znovu. |

## 7. Co je ověřené a co ne

**Ověřeno v Chromu na počítači** (i na šířce mobilu), na testovacích knížkách:
nahrání PDF, EPUB, FB2 a TXT včetně obrázků a obálek, překlad slova, tvar slova, složeniny, fráze,
překlad označeného textu, zvýraznění, záložky, obsah, hledání, vzhled, kartičky, export, záloha s obnovou,
původní stránka, přejmenování, offline paměť, nahrání víc souborů najednou.

**Ověřeno jen výpisem ze slovníku, ne v prohlížeči:** tvary slov v němčině, španělštině, italštině
a latině.

**Neověřeno:**
- Firefox (na počítači i v mobilu),
- iPhone,
- v apk všechno, co dělá jen obal: hledání knížek v úložišti, hlas telefonu, ukládání zálohy a exportu,
  tisk slovníčku, výběr jiných souborů než PDF. Apk se podařilo postavit a podepsat a po instalaci
  na telefonu podle Katky funguje; tyhle části ale nikdo cíleně nezkoušel,
- hledání ve složce v prohlížeči (systémové okno nejde ovládat automaticky).

## 8. Známá omezení

- Skenovaná PDF (stránky jako obrázky) přečíst neumí.
- Kreslené ilustrace v PDF (čáry, grafy) se v textu neukážou, jen přes „původní stránku".
- Překlad je slovo po slovu, celé věty nepřekládá.
- Odhad základního tvaru se u angličtiny občas splete („tired" → „tire").
- Když tvar odpovídá víc pádům, vypíšou se až tři možnosti; z věty se nepozná, která platí.
- Složenina se rozloží jen tehdy, když slovník zná všechny její části.
- Malé slovníky: baskičtina 7,4 tisíce hesel, hornolužická srbština 3,1 tisíce, dolnolužická 2,5 tisíce.
- Výslovnost závisí na hlasech v zařízení; latina se čte italsky, starořečtina novořecky.
- Soubory se stejným názvem se berou jako jedna knížka, i s jinou příponou.
- Záloha neobsahuje původní PDF a při obrázcích nad 15 MB ani obrázky.

## 9. Jak vydat novou verzi

1. Upravit soubory ve složce `ctecka`. Po přegenerování slovníků zvednout `DICT_V` v `lang.js`.
2. Web: `git add -A`, `git commit`, `git push`. GitHub Pages se přestaví samy do minuty.
3. Apk: v Git Bash `bash C:/Users/42073/android-build/build.sh <číslo verze>` (číslo vždy o jedna vyšší),
   potom `gh release create v<číslo> C:/Users/42073/android-build/Ctecka.apk`.
4. Zkopírovat `android-build/app` a `build.sh` do `ctecka/android/`, ať je zdroják v repozitáři aktuální.

**Podpisový klíč** `C:\Users\42073\android-build\ctecka.keystore` není v repozitáři a nesmí se ztratit.
Bez něj nejde nová verze nainstalovat přes starou; aplikace by se musela odinstalovat i s knížkami.

## 10. Zdroje a licence

- anglicko-český slovník a fráze: FreeDict eng-ces (GPL)
- němčina, francouzština, španělština, italština do češtiny: FreeDict (GPL)
- všechny jazyky: en.wiktionary.org přes kaikki.org a cs.wiktionary.org (CC BY-SA)
- tvary slov: github.com/michmech/lemmatization-lists (ODbL)
- nejběžnější anglická slova: google-10000-english
- čtení PDF: pdf.js (Apache 2.0)
