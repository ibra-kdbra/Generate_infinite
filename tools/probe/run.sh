#!/bin/sh
# Runs a probe (a script that drives the game) in headless Firefox against the dev server
# (npm run dev on port 5173 first) and saves its screenshots and log lines.
#
#   [EXTRA='probe=/tools/probe/probe-moves.js&slot=0'] [OUT=dir] [WINDOW=1400,900] tools/probe/run.sh <seconds>
#
# A probe is an ES module exporting `async function ({ w, log, wait, shot, timing })`: `w` is
# the game page's window (w.game, and the dev helpers w.step / w.tp / w.shot from src/index.ts),
# `shot(name)` saves the canvas as OUT/name.jpg, `log(...)` prints a line. On a laptop with an
# NVIDIA GPU (PRIME offload) it renders there; elsewhere on whatever GPU (or software) Firefox has.
D=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-$D/out}
PROFILE=${PROFILE:-$D/.profile}
mkdir -p "$OUT" "$PROFILE"
[ -f "$PROFILE/user.js" ] || cat > "$PROFILE/user.js" <<'PREFS'
user_pref("devtools.console.stdout.content", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("startup.homepage_welcome_url", "");
user_pref("browser.sessionstore.resume_from_crash", false);
PREFS
GPU=""
command -v prime-run >/dev/null && GPU=prime-run
timeout "$1" $GPU firefox -headless -no-remote -profile "$PROFILE" --window-size "${WINDOW:-1400,900}" "http://127.0.0.1:5173/tools/probe/probe-tmp.html?q=high&$EXTRA" > "$OUT/run.log" 2>&1
python3 - "$OUT/run.log" "$OUT" <<'PY'
import sys, base64, re
log, out = sys.argv[1:3]
for line in open(log, errors='replace'):
    m = re.search(r'SHOT (\S+) data:image/jpeg;base64,([A-Za-z0-9+/=]+)', line)
    if m:
        open(f'{out}/{m.group(1)}.jpg', 'wb').write(base64.b64decode(m.group(2)))
    elif 'PROBE' in line and 'UniformsUtils' not in line:
        print(line.strip()[:900].replace('console.log: "PROBE" ', ''))
PY
