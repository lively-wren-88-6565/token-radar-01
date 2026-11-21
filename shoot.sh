#!/bin/sh
# Re-shoot the three dossier screenshots from out/dashboard at 1440x1080.
# Uses the Playwright chromium-headless-shell already on this VM; no network.
# 1080 tall so the board shot holds the funnel and the first ranked rows.
set -e
cd "$(dirname "$0")"
HS="$HOME/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell"
BASE="file://$PWD/out/dashboard/index.html"
"$HS" --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=1440,1080 --virtual-time-budget=5000 --screenshot="$PWD/screenshots/board.png" "$BASE" 2>/dev/null
"$HS" --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=1440,1080 --virtual-time-budget=5000 --screenshot="$PWD/screenshots/detail.png" "$BASE#p=bittensor-dtao" 2>/dev/null
"$HS" --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=1440,1080 --virtual-time-budget=5000 --screenshot="$PWD/screenshots/filtered.png" "$BASE#category=Dexs" 2>/dev/null
ls -la screenshots/
md5sum screenshots/*.png
