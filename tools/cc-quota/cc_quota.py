#!/usr/bin/env python3
"""cc-quota: Claude Code 額度 pacing 監控（採集與展示解耦）

  collect  每次執行獨立：抓一次快照 -> 計算 -> 追加寫入 SQLite -> 偏離時發通知
  report   只讀 SQLite，輸出最新狀態與近期趨勢

只依賴 Python 3 標準函式庫。資料源是 Claude Code 自己使用的額度端點
（/api/oauth/usage，未公開文件，欄位可能變動，所以原始 JSON 一併落庫）。
"""
import argparse, glob, json, math, os, sqlite3, subprocess, sys, time, urllib.request
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

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
CREDENTIAL_MESSAGES = {
    "keychain_unavailable": "Keychain未提供憑證；請確認claude登入及Keychain授權",
    "keychain_timeout": "Keychain讀取逾時；請在Mac完成授權後重試",
    "file_unavailable": "無法讀取Claude Code憑證檔；請先在本機登入claude",
    "invalid_credentials": "Claude Code憑證格式無效；請確認claude登入",
}


class CredentialError(RuntimeError):
    """Only fixed codes/messages can reach logs; never include source contents."""
    def __init__(self, code):
        self.code = code if code in CREDENTIAL_MESSAGES else "invalid_credentials"
        super().__init__(CREDENTIAL_MESSAGES[self.code])


def read_token():
    """Read one platform's source, fail closed, and never refresh credentials."""
    if sys.platform == "darwin":
        try:
            r = subprocess.run(["/usr/bin/security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                               capture_output=True, text=True, timeout=10)
        except subprocess.TimeoutExpired:
            raise CredentialError("keychain_timeout") from None
        except (OSError, UnicodeError):
            raise CredentialError("keychain_unavailable") from None
        if r.returncode != 0:
            raise CredentialError("keychain_unavailable")
        raw = r.stdout
    else:
        try:
            with open(os.path.join(CLAUDE_DIR, ".credentials.json"), encoding="utf-8") as f:
                raw = f.read()
        except (OSError, UnicodeError):
            raise CredentialError("file_unavailable") from None
    try:
        token = json.loads(raw)["claudeAiOauth"]["accessToken"]
    except (ValueError, TypeError, KeyError):
        raise CredentialError("invalid_credentials") from None
    if not isinstance(token, str) or not token or any(not 33 <= ord(c) <= 126 for c in token):
        raise CredentialError("invalid_credentials")
    return token


def fetch_usage():
    if os.environ.get("CC_QUOTA_MOCK"):  # 測試用
        with open(os.environ["CC_QUOTA_MOCK"]) as f:
            return json.load(f)
    req = urllib.request.Request(USAGE_URL, headers={
        "Authorization": f"Bearer {read_token()}",
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def local_tokens_since(start_ts):
    """Count local usage once per (message ID, request ID), across all files.

    A usable message ID alone is the fallback when request ID is absent. With
    no message ID, count each valid line separately: neither a missing ID nor
    a request ID alone proves two records are the same assistant message.
    Malformed lines/usage (including counts outside SQLite's integer range)
    are ignored. If valid aggregate counts overflow that range, return unknown
    counts instead of preventing the quota snapshot from being stored.
    """
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
                        if not isinstance(e, dict) or not isinstance(e.get("message"), dict):
                            continue
                        msg = e["message"]
                        u = msg.get("usage")
                        if not isinstance(u, dict) or not u:
                            continue
                        timestamp = datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00"))
                        if timestamp.tzinfo is None:
                            continue
                        ts = timestamp.timestamp()
                        counts = [u.get(k, 0) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens")]
                        if any(type(n) is not int or not 0 <= n <= 2**63 - 1 for n in counts):
                            continue
                    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
                        continue
                    if ts < start_ts:
                        continue
                    mid, rid = msg.get("id"), e.get("requestId")
                    if isinstance(mid, str) and mid:
                        key = (mid, rid if isinstance(rid, str) and rid else None)
                        if key in seen:
                            continue
                        seen.add(key)
                    total += sum(counts)
                    out += counts[1]
                    if total > 2**63 - 1:
                        return None, None
        except OSError:
            continue
    return total, out


# ---------- 計算（純函式，無狀態） ----------
def compute(name, win, now):
    if not isinstance(win, dict):
        raise ValueError("invalid quota window")
    used = win.get("utilization")
    if type(used) not in (int, float):
        raise ValueError("invalid utilization")
    try:
        used = float(used)
        if not math.isfinite(used) or used < 0:
            raise ValueError("invalid utilization")
        value = win.get("resets_at")
        if not isinstance(value, str):
            raise ValueError("invalid reset timestamp")
        reset_dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if reset_dt.tzinfo is None:
            raise ValueError("reset timestamp needs timezone")
        reset = reset_dt.timestamp()
    except (OverflowError, OSError) as exc:
        raise ValueError("invalid quota values") from exc
    length = WINDOWS[name]
    start = reset - length
    elapsed_pct = min(100.0, max(0.0, (now - start) / length * 100))
    pace = used / elapsed_pct if elapsed_pct >= MIN_ELAPSED_PCT else None
    eta = None  # 照目前速度，幾秒後用完
    if used > 0 and now > start:
        rate = used / (now - start)
        if rate > 0:
            estimate = max(0.0, (100 - used) / rate)
            # SQLite stores seconds in a signed 64-bit integer. An estimate
            # beyond that range is unknown, not a reason to lose valid usage.
            if math.isfinite(estimate) and estimate < 2**63:
                eta = estimate
    return {
        "window": name,
        "used_pct": used,
        "remaining_pct": min(100.0, max(0.0, 100 - used)),
        "reset_in_s": max(0, int(reset - now)),
        # Threshold decisions use full precision; only presentation rounds.
        "elapsed_pct": elapsed_pct,
        "pace": pace,
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
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
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
                        f'display notification {json.dumps(body, ensure_ascii=False)} with title {json.dumps(title, ensure_ascii=False)}'],
                       capture_output=True, text=True, timeout=10, check=True)
    else:
        print(f"[notify] {title}: {body}")


# ---------- 指令 ----------
def safe_error(stage, exc):
    """Never persist exception text: it may contain credentials or HTTP bodies."""
    if isinstance(exc, CredentialError):
        return f"{stage}: {exc.code}，{CREDENTIAL_MESSAGES[exc.code]}"
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code == 401:
            return f"{stage}: HTTP 401，憑證過期：開一次 claude 讓它自動刷新即可"
        return f"{stage}: HTTP {exc.code}"
    return f"{stage}: {type(exc).__name__}"


def send_notification(conn, now, title, body):
    try:
        notify(title, body)
    except Exception as exc:
        conn.execute("INSERT INTO errors VALUES (?,?)", (now, safe_error("notification failed", exc)))
        conn.commit()


def cmd_collect(args):
    now = int(time.time())
    with closing(db()) as conn:
        try:
            data = fetch_usage()
        except Exception as exc:
            message = safe_error("fetch failed", exc)
            conn.execute("INSERT INTO errors VALUES (?,?)", (now, message))
            conn.commit()
            send_notification(conn, now, "Claude 額度：採集失敗", message)
            return 1
        # Preserve every successful JSON fetch, including invalid schemas, before
        # validation. Snapshot writes start only after ALL windows are validated.
        conn.execute("INSERT OR REPLACE INTO raw VALUES (?,?)", (now, json.dumps(data)))
        conn.commit()
        try:
            if not isinstance(data, dict):
                raise ValueError("invalid usage source")
            results = [compute(name, data[name], now) for name in WINDOWS
                       if name in data and data[name] is not None]
            if not results:
                raise ValueError("no quota windows")
        except (ValueError, TypeError, OverflowError) as exc:
            message = safe_error("invalid quota data", exc)
            conn.execute("INSERT INTO errors VALUES (?,?)", (now, message))
            conn.commit()
            send_notification(conn, now, "Claude 額度：採集失敗", message)
            return 1
        alerts = []
        with conn:
            # A same-second recollection replaces the complete window set,
            # including optional windows that disappeared from the response.
            conn.execute("DELETE FROM snapshots WHERE ts=?", (now,))
            for r in results:
                name = r["window"]
                tok, out = local_tokens_since(r["window_start"]) if not args.no_tokens else (None, None)
                v = verdict(r)
                conn.execute("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                             (now, name, r["used_pct"], r["remaining_pct"], r["reset_in_s"], r["elapsed_pct"],
                              r["pace"], r["exhaust_in_s"], r["resets_at"], tok, out, v))
                if v != "OK":
                    pace_text = f"{r['pace']:.2f}" if r['pace'] is not None else "—"
                    alerts.append(f"{name} {v}: 剩 {r['remaining_pct']:.0f}%，pace {pace_text}，重置 {fmt_dur(r['reset_in_s'])}")
        if alerts:
            send_notification(conn, now, "Claude 額度偏離", "\n".join(alerts))
    if args.verbose:
        cmd_report(argparse.Namespace(hours=0))
    return 0


def cmd_report(args):
    # as_uri percent-encodes '?', '#', Unicode, etc. mode=ro cannot create a DB.
    uri = Path(DB_PATH).absolute().as_uri() + "?mode=ro"
    try:
        with closing(sqlite3.connect(uri, uri=True)) as conn:
            return report(conn, args)
    except sqlite3.Error:
        print("無法讀取額度資料庫，請先成功執行 collect")
        return 1


def report(conn, args):
    last = conn.execute("SELECT MAX(ts) FROM snapshots").fetchone()[0]
    err = conn.execute("SELECT ts, message FROM errors ORDER BY ts DESC LIMIT 1").fetchone()
    if last is None:
        print("還沒有資料，先跑一次 collect")
        if err:
            print(f"最近記錄的錯誤：{err[1]}")
        return 1
    now = int(time.time())
    age = max(0, now - last)
    print(f"最新快照：{datetime.fromtimestamp(last).strftime('%m-%d %H:%M')}（{fmt_dur(age)} 前）")
    print("使用量、pace、狀態均為快照時的觀測值；倒數只按時間推算。")
    if age > 5400:
        print("⚠ STALE：超過每小時採集的容許間隔，不能視為目前額度。")
    print(f"{'視窗':<15}{'剩餘':>6}{'時間進度':>9}{'pace':>7}{'重置':>9}{'耗盡':>9}{'本機tokens':>12}  狀態")
    for row in conn.execute("""SELECT window, remaining_pct, elapsed_pct, pace, reset_in_s,
            exhaust_in_s, local_tokens, verdict, resets_at FROM snapshots WHERE ts=?""", (last,)):
        w, rem, el, pace, rs, ex, tok, v, reset = row
        rs_now = max(0, reset - now)
        ex_now = max(0, ex - age) if ex is not None and rs_now > 0 else None
        if rs_now == 0:
            print(f"⚠ STALE {w}：快照視窗已重置，目前額度未知。")
        pace_text = f"{pace:.2f}" if pace is not None else "—"
        print(f"{w:<15}{rem:>5.0f}%{el:>8.0f}%{pace_text:>7}"
              f"{fmt_dur(rs_now):>9}{fmt_dur(ex_now):>9}{(tok if tok is not None else '—'):>12}  {v}")
    if args.hours:
        print(f"\n近 {args.hours} 小時 five_hour 趨勢：")
        previous = None
        for ts, used, pace, v in conn.execute("""SELECT ts, used_pct, pace, verdict FROM snapshots
                WHERE window='five_hour' AND ts>=? ORDER BY ts""", (last - args.hours * 3600,)):
            if previous is not None and ts - previous > 5400:
                print(f"  ⚠ GAP：兩次快照相隔 {fmt_dur(ts - previous)}，期間用量未知。")
            previous = ts
            bar = "█" * int(min(100, max(0, used)) / 5)
            pace_text = f"{pace:.2f}" if pace is not None else "—"
            print(f"  {datetime.fromtimestamp(ts).strftime('%m-%d %H:%M')}  {used:>5.1f}% {bar:<20} pace {pace_text}  {v}")
    if err and err[0] >= last:
        print(f"\n⚠ 最近記錄的錯誤（快照後或同秒）：{err[1]}")
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
