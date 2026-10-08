#!/usr/bin/env bash
# Postaví Ctecka.apk z webové čtečky (Desktop/ctecka) a androidího obalu (app/). Spouštět v Git Bash: bash build.sh
set -e
cd "$(dirname "$0")"
ROOT="C:/Users/42073/android-build"
WEB="C:/Users/42073/Desktop/ctecka"
export JAVA_HOME="$ROOT/jdk-17.0.20.1+1"
export PATH="$(cygpath -u "$JAVA_HOME")/bin:$PATH"
BT="$ROOT/sdk/build-tools/34.0.0"
JAR="$ROOT/sdk/platforms/android-34/android.jar"
VERSION_CODE=${1:-1}

rm -rf build && mkdir -p build/classes build/assets/www/dict build/assets/www/vendor build/res/mipmap-xxxhdpi
cp "$WEB"/{index.html,app.js,lang.js,style.css,manifest.webmanifest,icon-192.png,icon-512.png} build/assets/www/
cp "$WEB"/dict/*.js build/assets/www/dict/
cp "$WEB"/vendor/* build/assets/www/vendor/
cp "$WEB/icon-192.png" build/res/mipmap-xxxhdpi/ic_launcher.png

"$BT/aapt2.exe" compile --dir build/res -o build/res.zip
"$BT/aapt2.exe" link -o build/base.apk -I "$JAR" --manifest app/AndroidManifest.xml -A build/assets \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "$VERSION_CODE" --version-name "1.$VERSION_CODE" build/res.zip
javac -encoding UTF-8 -nowarn -source 11 -target 11 -cp "$JAR" -d build/classes app/src/cz/katka/ctecka/*.java
cmd //c "$(cygpath -w "$BT/d8.bat")" --lib "$JAR" --min-api 24 --output build $(find build/classes -name "*.class")
python -E -c "import zipfile; zipfile.ZipFile('build/base.apk', 'a', zipfile.ZIP_DEFLATED).write('build/classes.dex', 'classes.dex')"
"$BT/zipalign.exe" -f -p 4 build/base.apk build/aligned.apk

# podpisový klíč: vznikne jednou; bez něj by nová verze nešla nainstalovat přes starou
if [ ! -f ctecka.keystore ]; then
  keytool -genkeypair -keystore ctecka.keystore -alias ctecka -keyalg RSA -keysize 2048 -validity 20000 \
    -storepass ctecka-klic -keypass ctecka-klic -dname "CN=Ctecka"
fi
cmd //c "$(cygpath -w "$BT/apksigner.bat")" sign --ks ctecka.keystore --ks-key-alias ctecka \
  --ks-pass pass:ctecka-klic --key-pass pass:ctecka-klic --out Ctecka.apk build/aligned.apk
ls -la Ctecka.apk
