#!/bin/bash
# Compile et installe l'app sur l'iPhone dès qu'il est branché au Mac.
# Lancé toutes les 30 s par launchd (~/Library/LaunchAgents/com.villainclement.jinja-autobuild.plist) :
# ne fait rien tant que l'iPhone n'est pas branché, puis une seule fois par branchement.
# Ne recompile que si l'app a changé depuis la dernière installation, ou si celle-ci date de plus
# de 6 jours (le profil gratuit expire au bout de 7). Récupère d'abord develop (git flow : les fonctionnalités
# fusionnées mais pas encore publiées) si le dossier est propre et sur develop.
#   Forcer une compilation : rm "$HOME/Library/Application Support/JinjaAutoBuild/last-tree"
#   Journal : "$HOME/Library/Application Support/JinjaAutoBuild/build.log"
set -u

REPO="$HOME/Claude code/jinja-collection"
DEVICE=00008110-000624C61A80A01E
BUNDLE=com.villainclement.jinjacollection
STATE="$HOME/Library/Application Support/JinjaAutoBuild"
LOG="$STATE/build.log"
MAX_AGE=$((6 * 24 * 3600))

export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$STATE"

# iPhone branché ? (test USB rapide, sans réveiller Xcode)
if ! ioreg -p IOUSB -l -w0 | grep -q "\"USB Serial Number\" = \"${DEVICE//-/}\""; then
  rm -f "$STATE/plugged"
  exit 0
fi
[ -e "$STATE/plugged" ] && exit 0      # déjà traité pour ce branchement
mkdir "$STATE/lock" 2>/dev/null || exit 0
trap 'rmdir "$STATE/lock"' EXIT

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"Jinja Collection\"" >/dev/null 2>&1; }
fail() { log "ÉCHEC : $1"; notify "Échec : $1 (voir build.log)"; exit 1; }

# L'iPhone doit être appairé et joignable par Xcode (déverrouillé au moins une fois).
if ! xcrun devicectl list devices 2>/dev/null | grep "$DEVICE" | grep -q "available"; then
  log "iPhone branché mais pas encore disponible pour Xcode, nouvel essai dans 30 s"
  exit 0
fi
touch "$STATE/plugged"
log "iPhone branché"

cd "$REPO" || fail "dossier du projet introuvable"

# Dernière version de develop, seulement si le dossier est propre (jamais d'écrasement de travail en cours).
if [ "$(git branch --show-current)" = develop ] && [ -z "$(git status --porcelain)" ]; then
  git pull --ff-only -q origin develop >> "$LOG" 2>&1 || log "git pull impossible, compilation de la version locale"
else
  log "dossier modifié ou hors de develop : compilation de la version locale, sans git pull"
  notify "Modifications locales en cours : compilation du dossier tel quel"
fi

# Version de l'app = arbre git de mobile/ (+ « modifié » s'il y a des changements non commités).
TREE=$(git rev-parse HEAD:mobile)
git diff --quiet HEAD -- mobile || TREE="$TREE-modifie-$(date +%s)"
NATIVE=$(cat mobile/app.json mobile/app.config.js mobile/package.json mobile/package-lock.json | shasum | cut -d' ' -f1)
LAST_TREE=$(cat "$STATE/last-tree" 2>/dev/null)
LAST_TIME=$(cat "$STATE/last-time" 2>/dev/null || echo 0)
AGE=$(( $(date +%s) - LAST_TIME ))
if [ "$TREE" = "$LAST_TREE" ] && [ "$AGE" -lt "$MAX_AGE" ]; then
  log "app inchangée depuis la dernière installation, rien à faire"
  exit 0
fi

notify "iPhone branché : compilation de l'app (≈ 5 min)…"
log "compilation de $TREE"
cd mobile || fail "dossier mobile introuvable"

# Dépendances et projet Xcode régénérés seulement si la config native a changé.
if [ "$NATIVE" != "$(cat "$STATE/last-native" 2>/dev/null)" ] || [ ! -d ios ]; then
  log "configuration native modifiée : npm install, prebuild, pod install"
  npm install --no-audit --no-fund >> "$LOG" 2>&1 || fail "npm install"
  npx expo prebuild -p ios --no-install >> "$LOG" 2>&1 || fail "expo prebuild"
  (cd ios && pod install) >> "$LOG" 2>&1 || fail "pod install"
fi

xcodebuild -workspace ios/JinjaCollection.xcworkspace -scheme JinjaCollection -configuration Release -sdk iphoneos \
  -destination "id=$DEVICE" -derivedDataPath ios/build -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=DZGF8CAR26 CODE_SIGN_STYLE=Automatic -quiet build >> "$LOG" 2>&1 || fail "compilation Xcode"
xcrun devicectl device install app --device "$DEVICE" ios/build/Build/Products/Release-iphoneos/JinjaCollection.app >> "$LOG" 2>&1 \
  || fail "installation sur l'iPhone"

echo "$TREE" > "$STATE/last-tree"
echo "$NATIVE" > "$STATE/last-native"
date +%s > "$STATE/last-time"
log "installée"
if xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE" >> "$LOG" 2>&1; then
  notify "App installée et lancée sur l'iPhone ✓"
else
  notify "App installée ✓ (déverrouille l'iPhone pour l'ouvrir)"
fi
