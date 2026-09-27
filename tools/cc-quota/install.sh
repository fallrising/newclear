#!/bin/bash
# 在 Mac 上安裝 cc-quota：複製腳本、產生 launchd 設定、每小時採集一次
set -euo pipefail
LABEL="io.github.fallrising.cc-quota"
BIN="$HOME/.local/bin/cc_quota.py"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/.local/share/cc-quota"

mkdir -p "$(dirname "$BIN")" "$LOG" "$HOME/Library/LaunchAgents"
cp "$(dirname "$0")/cc_quota.py" "$BIN"
chmod +x "$BIN"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$BIN</string>
    <string>collect</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG/collect.log</string>
  <key>StandardErrorPath</key><string>$LOG/collect.err</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "已安裝。先手動跑一次（第一次會跳 Keychain 授權，請選「永遠允許」）："
echo "  python3 $BIN collect -v"
echo "之後隨時看報表："
echo "  python3 $BIN report"
echo "解除安裝："
echo "  launchctl bootout gui/\$(id -u)/$LABEL && rm $PLIST"
