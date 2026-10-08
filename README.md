# Čtečka

Čtení knížek (PDF, EPUB, FB2, TXT) s překladem slov po kliknutí. Funguje offline, nic nikam neposílá: knížky, slovíčka
i slovníky zůstávají v zařízení.

Otevřít: https://katka1815.github.io/ctecka/

## Slovníky a licence

- anglicko-český: FreeDict eng-ces (GPL)
- němčina, francouzština, španělština, italština: FreeDict *-ces (GPL)
- všechny jazyky: en.wiktionary.org přes kaikki.org a cs.wiktionary.org (CC BY-SA)
- tvary slov: github.com/michmech/lemmatization-lists (ODbL)
- nejběžnější anglická slova: google-10000-english
- čtení PDF: pdf.js (Apache 2.0), viz `vendor/`

Skripty, kterými slovníky vznikly, jsou ve složce `tools/`.

## Instalace

- **Android:** stáhni `Ctecka.apk` z [Releases](https://github.com/katka1815/ctecka/releases/latest) a otevři ho. Aplikace nemá
  oprávnění k internetu; po povolení umí projít úložiště a najít PDF.
- **iPhone:** otevři adresu výše v Safari, klepni na Sdílet a „Přidat na plochu".
- **Počítač:** otevři adresu výše, nebo spusť `Spustit ctecku.bat`.

Zdroják androidího obalu je ve složce `android/` (staví se skriptem `build.sh`).
