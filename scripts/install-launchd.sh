#!/bin/bash
#
# Installs the STOQWISE worker as a persistent macOS launchd agent.
#
# The agent runs scripts/worker.ts, keeps it alive if it crashes (KeepAlive) and
# starts it at login. It is scoped to the current user, writes its logs into
# data/autopilot/ and can be removed again with:
#
#   launchctl bootout gui/$(id -u)/ai.stoqwise.worker
#   rm ~/Library/LaunchAgents/ai.stoqwise.worker.plist
#
# Usage: bash scripts/install-launchd.sh
set -euo pipefail

LABEL="ai.stoqwise.worker"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN_BIN="$(command -v bun || true)"
if [ -z "$BUN_BIN" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
fi
if [ ! -x "$BUN_BIN" ]; then
  echo "Hittar inte bun (letade i PATH och $HOME/.bun/bin/bun)." >&2
  exit 1
fi

AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENTS_DIR/$LABEL.plist"
LOG_DIR="$ROOT/data/autopilot"
UID_NUM="$(id -u)"

mkdir -p "$AGENTS_DIR" "$LOG_DIR"

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

ROOT_X="$(xml_escape "$ROOT")"
BUN_X="$(xml_escape "$BUN_BIN")"
LOG_X="$(xml_escape "$LOG_DIR")"
HOME_X="$(xml_escape "$HOME")"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN_X</string>
    <string>$ROOT_X/scripts/worker.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_X</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME_X</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:$HOME_X/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>Nice</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>$LOG_X/worker.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_X/worker.err.log</string>
</dict>
</plist>
PLIST_EOF

echo "Skrev $PLIST"

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl enable "gui/$UID_NUM/$LABEL"
launchctl kickstart -k "gui/$UID_NUM/$LABEL" 2>/dev/null || true

echo "Laddade $LABEL. Väntar på första hjärtslaget…"
for _ in $(seq 1 30); do
  if [ -f "$LOG_DIR/heartbeat.json" ]; then
    echo "Hjärtslag: $LOG_DIR/heartbeat.json"
    cat "$LOG_DIR/heartbeat.json"
    exit 0
  fi
  sleep 2
done

echo "Ingen hjärtslag ännu. Kontrollera:" >&2
echo "  launchctl print gui/$UID_NUM/$LABEL" >&2
echo "  tail -n 40 \"$LOG_DIR/worker.out.log\" \"$LOG_DIR/worker.err.log\"" >&2
exit 1
