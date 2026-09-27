#!/usr/bin/env python3
"""cc-quota: Claude Code 額度 pacing 監控（採集與展示解耦）

  collect  每次執行獨立：抓一次快照 -> 計算 -> 追加寫入 SQLite -> 偏離時發通知
  report   只讀 SQLite，輸出最新狀態與近期趨勢

只依賴 Python 3 標準函式庫。資料源是 Claude Code 自己使用的額度端點
（/api/oauth/usage，未公開文件，欄位可能變動，所以原始 JSON 一併落庫）。
"""
import argparse, glob, json, os, sqlite3, subprocess, sys, time, urllib.request
from datetime import datetime, timezone

CLAUDE_DIR = os.path.expanduser(os.environ.get("CLAUDE_CONFIG_DIR", "~/.claude"))
DB_PATH = os.path.expanduser(os.environ.get("CC_QUOTA_DB", "~/.local/share/cc-quota/quota.db"))
USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
WINDOWS = {"five_hour": 5 * 3600, "seven_day": 7 * 86400, "seven_day_opus": 7 * 86400}

# 通知門檻（可用環境變數覆寫）
PACE_HIGH = float(os.environ.get("CC_QUOTA_PACE_HIGH", "1.2"))
PACE_LOW = float(os.environ.get("CC_QUOTA_PACE_LOW", "0.8"))
REMAIN_MIN = float(os.environ.get("CC_QUOTA_REMAIN_MIN", "15"))
MIN_ELAPSED_PCT = 10.0  # 視窗剛開始時 pace 噪音太大，不計算


# ---------- 資料源 ----------
def read_token():
    """macOS 從 Keychain 讀；Linux 從 ~/.claude/.credentials.json 讀。"""
    raw = None
    if sys.platform == "darwin":
        r = subprocess.run(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                           capture_output=True, text=True)
        if r.returncode == 0:
            raw = r.stdout.strip()
    if raw is None:
        p = os.path.join(CLAUDE_DIR, ".credentials.json")
        if os.path.exists(p):
            with open(p) as f:
                raw = f.read()
    if not raw:
        raise RuntimeError("找不到 Claude Code 憑證（請先在這台電腦登入 claude）")
    return json.loads(raw)["claudeAiOauth"]["accessToken"]


def fetch_usage():
    if os.environ.get("CC_QUOTA_MOCK"):  # 測試用
        with open(os.environ["CC_QUOTA_MOCK"]) as f:
            return json.load(f)
    req = urllib.request.Request(USAGE_URL, headers={
        "Authorization": f"Bearer {read_token()}",
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise RuntimeError("憑證過期：開一次 claude 讓它自動刷新即可") from e
        raise


def local_tokens_since(start_ts):
    """本機 Claude Code 紀錄中、start_ts 之後的 token 加總（僅本機，不含雲端/其他裝置）。"""
    seen, total, out = set(), 0, 0
    for path in glob.glob(os.path.join(CLAUDE_DIR, "projects", "**", "*.jsonl"), recursive=True):
        try:
            if os.path.getmtime(path) < start_ts:
                continue
            with open(path, errors="ignore") as f:
                for line in f:
                    if '"usage"' not in line:
                        continue
                    try:
                        e = json.loads(line)
                        msg = e.get("message") or {}
                        u = msg.get("usage")
                        ts = datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00")).timestamp()
                    except Exception:
                        continue
                    if not u or ts < start_ts:
                        continue
                    key = (msg.get("id"), e.get("requestId"))  # 串流會重複寫同一則訊息
                    if key in seen:
                        continue
                    seen.add(key)
                    o = u.get("output_tokens", 0) or 0
                    total += (u.get("input_tokens", 0) or 0) + o + (u.get("cache_creation_input_tokens", 0) or 0)
                    out += o
        except OSError:
            continue
    return total, out


# ---------- 計算（純函式，無狀態） ----------
def compute(name, win, now):
    used = float(win.get("utilization") or 0)
    reset = datetime.fromisoformat(win["resets_at"].replace("Z", "+00:00")).timestamp()
    length = WINDOWS[name]
    start = reset - length
    elapsed_pct = min(100.0, max(0.0, (now - start) / length * 100))
    pace = used / elapsed_pct if elapsed_pct >= MIN_ELAPSED_PCT else None
    eta = None  # 照目前速度，幾秒後用完
    if used > 0 and now > start:
        rate = used / (now - start)
        eta = max(0.0, (100 - used) / rate)
    return {
        "window": name,
        "used_pct": used,
        "remaining_pct": min(100.0, max(0.0, 100 - used)),
        "reset_in_s": max(0, int(reset - now)),
        "elapsed_pct": round(elapsed_pct, 1),
        "pace": round(pace, 2) if pace is not None else None,
        "exhaust_in_s": int(eta) if eta is not None else None,
        "window_start": int(start),
        "resets_at": int(reset),
    }


def verdict(r):
    if r["remaining_pct"] < REMAIN_MIN:
        return "LOW"
    if r["exhaust_in_s"] is not None and r["exhaust_in_s"] < r["reset_in_s"] and (r["pace"] or 0) >= PACE_HIGH:
        return "FAST"
    if r["pace"] is not None and r["pace"] < PACE_LOW and r["elapsed_pct"] >= 50:
        return "SLOW"  # 過半還落後，才值得提醒「可以塞重任務」
    return "OK"


def fmt_dur(s):
    if s is None:
        return "—"
    h, m = divmod(int(s) // 60, 60)
    return f"{h // 24}d{h % 24}h" if h >= 24 else f"{h}h{m:02d}m"


# ---------- 儲存 ----------
def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.execute("""CREATE TABLE IF NOT EXISTS snapshots(
        ts INTEGER, window TEXT, used_pct REAL, remaining_pct REAL, reset_in_s INTEGER,
        elapsed_pct REAL, pace REAL, exhaust_in_s INTEGER, resets_at INTEGER,
        local_tokens INTEGER, local_output_tokens INTEGER, verdict TEXT,
        PRIMARY KEY (ts, window))""")
    c.execute("CREATE TABLE IF NOT EXISTS raw(ts INTEGER PRIMARY KEY, json TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS errors(ts INTEGER, message TEXT)")
    return c


def notify(title, body):
    if sys.platform == "darwin":
        subprocess.run(["osascript", "-e",
                        f'display notification {json.dumps(body)} with title {json.dumps(title)}'])
    else:
        print(f"[notify] {title}: {body}")


# ---------- 指令 ----------
def cmd_collect(args):
    now = int(time.time())
    conn = db()
    try:
        data = fetch_usage()
    except Exception as e:
        conn.execute("INSERT INTO errors VALUES (?,?)", (now, str(e)))
        conn.commit()
        notify("Claude 額度：採集失敗", str(e))
        return 1
    conn.execute("INSERT OR REPLACE INTO raw VALUES (?,?)", (now, json.dumps(data)))
    alerts = []
    for name in WINDOWS:
        win = data.get(name)
        if not win or not win.get("resets_at"):
            continue
        r = compute(name, win, now)
        tok, out = local_tokens_since(r["window_start"]) if not args.no_tokens else (None, None)
        v = verdict(r)
        conn.execute("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                     (now, name, r["used_pct"], r["remaining_pct"], r["reset_in_s"], r["elapsed_pct"],
                      r["pace"], r["exhaust_in_s"], r["resets_at"], tok, out, v))
        if v != "OK":
            alerts.append(f"{name} {v}: 剩 {r['remaining_pct']:.0f}%，pace {r['pace']}，重置 {fmt_dur(r['reset_in_s'])}")
    conn.commit()
    if alerts:
        notify("Claude 額度偏離", "\n".join(alerts))
    if args.verbose:
        cmd_report(argparse.Namespace(hours=0))
    return 0


def cmd_report(args):
    conn = db()
    last = conn.execute("SELECT MAX(ts) FROM snapshots").fetchone()[0]
    if not last:
        print("還沒有資料，先跑一次 collect")
        return 1
    age = int(time.time()) - last
    print(f"最新快照：{datetime.fromtimestamp(last).strftime('%m-%d %H:%M')}（{fmt_dur(age)} 前）")
    print(f"{'視窗':<15}{'剩餘':>6}{'時間進度':>9}{'pace':>7}{'重置':>9}{'耗盡':>9}{'本機tokens':>12}  狀態")
    for row in conn.execute("""SELECT window, remaining_pct, elapsed_pct, pace, reset_in_s,
            exhaust_in_s, local_tokens, verdict, ts FROM snapshots WHERE ts=?""", (last,)):
        w, rem, el, pace, rs, ex, tok, v, ts = row
        rs_now = max(0, rs - age)  # 報表時刻重算倒數，不需重新採集
        print(f"{w:<15}{rem:>5.0f}%{el:>8.0f}%{(pace if pace is not None else '—'):>7}"
              f"{fmt_dur(rs_now):>9}{fmt_dur(ex):>9}{(tok if tok is not None else '—'):>12}  {v}")
    if args.hours:
        print(f"\n近 {args.hours} 小時 five_hour 趨勢：")
        for ts, used, pace, v in conn.execute("""SELECT ts, used_pct, pace, verdict FROM snapshots
                WHERE window='five_hour' AND ts>=? ORDER BY ts""", (last - args.hours * 3600,)):
            bar = "█" * int(used / 5)
            print(f"  {datetime.fromtimestamp(ts).strftime('%m-%d %H:%M')}  {used:>5.1f}% {bar:<20} pace {pace}  {v}")
    err = conn.execute("SELECT ts, message FROM errors ORDER BY ts DESC LIMIT 1").fetchone()
    if err and err[0] > last:
        print(f"\n⚠ 最近一次採集失敗：{err[1]}")
    return 0


def main():
    p = argparse.ArgumentParser(description="Claude Code 額度 pacing 監控")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect", help="採集一次並落庫（給排程用）")
    c.add_argument("--no-tokens", action="store_true", help="略過本機 token 加總")
    c.add_argument("-v", "--verbose", action="store_true")
    r = sub.add_parser("report", help="讀庫顯示報表")
    r.add_argument("--hours", type=int, default=24)
    a = p.parse_args()
    sys.exit(cmd_collect(a) if a.cmd == "collect" else cmd_report(a))


if __name__ == "__main__":
    main()
