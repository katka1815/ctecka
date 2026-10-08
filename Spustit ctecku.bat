@echo off
rem Spusti ctecku: maly lokalni server jen pro tento pocitac + otevre ji v prohlizeci.
rem Tohle okno nech otevrene, dokud ctes. Zavrenim okna ctecku vypnes (knizky a slovicka zustanou ulozene).
cd /d "%~dp0"
start "" http://127.0.0.1:8765/
python -m http.server 8765 --bind 127.0.0.1
