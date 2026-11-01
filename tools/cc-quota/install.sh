#!/bin/bash
# 在 Mac 上安裝 cc-quota：複製腳本、產生 launchd 設定、每小時採集一次
set -euo pipefail
if [[ "$(uname -s)" != Darwin ]]; then
  echo "install.sh 需要 macOS / launchd；其他系統請手動執行 collect / report。" >&2
  exit 1
fi
PYTHON="$(command -v python3)"
"$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else "需要 Python 3.11 或更新版本")'
LABEL="io.github.fallrising.cc-quota"
BIN="$HOME/.local/bin/cc_quota.py"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/.local/share/cc-quota"

mkdir -p "$(dirname "$BIN")" "$LOG" "$HOME/Library/LaunchAgents"
cp "$(dirname "$0")/cc_quota.py" "$BIN"
chmod +x "$BIN"

"$PYTHON" - "$LABEL" "$BIN" "$PLIST" "$LOG" <<'PY'
import os
import plistlib
import sys

label, script, plist, log = sys.argv[1:]
settings = {}
# launchd does not inherit the installing shell's settings. Persist only these
# non-secret options; never capture credentials, the full environment or MOCK.
for name in ("CLAUDE_CONFIG_DIR", "CC_QUOTA_DB", "CC_QUOTA_PACE_HIGH",
             "CC_QUOTA_PACE_LOW", "CC_QUOTA_REMAIN_MIN"):
    if name in os.environ:
        value = os.environ[name]
        if name in ("CLAUDE_CONFIG_DIR", "CC_QUOTA_DB"):
            value = os.path.abspath(os.path.expanduser(value))
        settings[name] = value
config = {
    "Label": label,
    "ProgramArguments": [sys.executable, script, "collect"],
    "StartInterval": 3600,
    "RunAtLoad": True,
    "StandardOutPath": os.path.join(log, "collect.log"),
    "StandardErrorPath": os.path.join(log, "collect.err"),
    "EnvironmentVariables": settings,
}
with open(plist, "wb") as output:
    plistlib.dump(config, output)
PY

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "已安裝。先手動跑一次（第一次會跳 Keychain 授權，請選「永遠允許」）："
printf '  %q %q collect -v\n' "$PYTHON" "$BIN"
echo "之後隨時看報表："
printf '  %q %q report\n' "$PYTHON" "$BIN"
echo "解除安裝："
printf '  launchctl bootout gui/$(id -u)/%q && rm %q\n' "$LABEL" "$PLIST"
