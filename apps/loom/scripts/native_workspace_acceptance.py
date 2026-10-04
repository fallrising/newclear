#!/usr/bin/env python3
"""Linux native Loom workspace acceptance; Python stdlib, no application IPC.

Root supplies an isolated Xvfb/window manager and production frontend HTTP server (1420).
This runner owns tauri-driver on a free localhost port (default 4444). Example:
  DISPLAY=:99 python3 native_workspace_acceptance.py --binary /target/debug/loom \
    --test-root /work/evidence --frontend-dir /work/dist --source-commit <sha>
All fixtures are created below a unique mkdtemp directory. Evidence is retained.
--case may select cases for diagnosis; summary.json records selection explicitly.
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import traceback
import urllib.error
import urllib.request

ELEMENT = "element-6066-11e4-a52e-4f735466cecf"


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def wait(condition, description, timeout=15):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            value = condition()
            if value:
                return value
        except (AssertionError, RuntimeError, OSError, ValueError) as error:
            last = error
        time.sleep(0.1)
    raise AssertionError(f"Timeout: {description}; last error: {last}")


def stable(condition, description, seconds=1.2):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        require(condition(), description)
        time.sleep(0.1)


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def version(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=10)
        return (result.stdout + result.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as error:
        return str(error)


def native_close():
    """Send the same WM_DELETE_WINDOW request as a window-manager close button."""
    ids = subprocess.check_output(["xdotool", "search", "--onlyvisible", "--name", "^Loom$"], text=True).splitlines()
    require(len(ids) == 1, f"Expected exactly one owned Loom window, found {ids}")
    lib = ctypes.CDLL("libX11.so.6")
    lib.XOpenDisplay.restype = ctypes.c_void_p
    display = lib.XOpenDisplay(None)
    require(display, "XOpenDisplay failed")
    lib.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    lib.XInternAtom.restype = ctypes.c_ulong
    class Data(ctypes.Union):
        _fields_ = [("l", ctypes.c_long * 5)]
    class Client(ctypes.Structure):
        _fields_ = [("type", ctypes.c_int), ("serial", ctypes.c_ulong), ("send_event", ctypes.c_int),
                    ("display", ctypes.c_void_p), ("window", ctypes.c_ulong), ("message_type", ctypes.c_ulong),
                    ("format", ctypes.c_int), ("data", Data)]
    class Event(ctypes.Union):
        _fields_ = [("client", Client), ("pad", ctypes.c_long * 24)]
    event = Event()
    event.client.type = 33
    event.client.display = display
    event.client.window = int(ids[0])
    event.client.message_type = lib.XInternAtom(display, b"WM_PROTOCOLS", 0)
    event.client.format = 32
    event.client.data.l[0] = lib.XInternAtom(display, b"WM_DELETE_WINDOW", 0)
    lib.XSendEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_long, ctypes.POINTER(Event)]
    lib.XFlush.argtypes = [ctypes.c_void_p]
    lib.XCloseDisplay.argtypes = [ctypes.c_void_p]
    try:
        require(lib.XSendEvent(display, int(ids[0]), 0, 0, ctypes.byref(event)), "XSendEvent failed")
        lib.XFlush(display)
    finally:
        lib.XCloseDisplay(display)


class Case:
    def __init__(self, args, root, name):
        self.args = args
        self.root = root / name
        self.root.mkdir()
        self.vault = self.root / "vault"
        self.vault.mkdir()
        (self.vault / ".loom").mkdir()
        self.home = self.root / "home"
        self.home.mkdir()
        self.driver = None
        self.log = None
        self.session = None
        self.starts = 0
        self.facts = {}
        self.base = f"http://127.0.0.1:{args.port}"

    def fixture(self, documents=None, tombstone=None, edges=None):
        nodes = []
        for index, (name, body) in enumerate((documents or {"doc": "original"}).items()):
            (self.vault / f"{name}.md").write_text(body)
            nodes.append({"id": name, "kind": {"type": "document", "path": f"{name}.md"},
                          "x": 760 + index * 590, "y": 30, "w": 570, "h": 660, "group": None})
        if tombstone:
            nodes.append({"id": "saved-terminal", "kind": {"type": "tombstone", "reason": "test fixture",
                          "was": {"type": "terminal", "cwd": str(self.vault), "cmd": tombstone,
                                  "shell": "/bin/sh", "name": "saved"}},
                          "x": 30, "y": 30, "w": 640, "h": 360, "group": None})
        (self.vault / ".loom/canvas.json").write_text(json.dumps({"version": 1, "nodes": nodes, "edges": edges or []}))

    def http(self, method, path, data=None):
        request = urllib.request.Request(self.base + path, method=method,
            data=None if data is None else json.dumps(data).encode(), headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                value = json.load(response).get("value")
        except urllib.error.HTTPError as error:
            raise RuntimeError(error.read().decode()) from error
        if isinstance(value, dict) and value.get("error"):
            raise RuntimeError(str(value))
        return value

    def start(self):
        require(self.driver is None, "Driver already running")
        existing = subprocess.run(["xdotool", "search", "--onlyvisible", "--name", "^Loom$"], capture_output=True)
        require(existing.returncode == 1, "A Loom window already exists; refusing an unowned desktop")
        for port in (self.args.port, self.args.native_port):
            with socket.socket() as probe:
                require(probe.connect_ex(("127.0.0.1", port)) != 0, f"Driver port {port} occupied; refusing foreign driver")
        # Explicit allowlist: no provider keys, shell profiles or caller's HOME.
        env = {key: os.environ[key] for key in ("PATH", "DISPLAY", "XAUTHORITY", "LANG", "LC_ALL") if key in os.environ}
        env.update(HOME=str(self.home), SHELL="/bin/sh", LOOM_VAULT=str(self.vault),
                   LOOM_NATIVE_ACCEPTANCE_OWNER=str(self.root),
                   XDG_CONFIG_HOME=str(self.home / ".config"), XDG_DATA_HOME=str(self.home / ".local/share"),
                   WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS="1", NO_PROXY="127.0.0.1,localhost")
        self.starts += 1
        self.log = (self.root / f"driver-{self.starts}.log").open("w")
        self.driver = subprocess.Popen([self.args.driver, "--port", str(self.args.port), "--native-port", str(self.args.native_port)], env=env,
                                       stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True)
        wait(lambda: self.http("GET", "/status"), "driver ready")
        self.session = self.http("POST", "/session", {"capabilities": {"alwaysMatch": {
            "tauri:options": {"application": str(self.args.binary)}}}})["sessionId"]
        wait(lambda: self.js("return !!document.querySelector('.cm-content')"), "document UI ready")
        wait(lambda: str(self.vault) in self.js("return document.querySelector('.app-header').textContent"), "owned vault selected")
        self.fit()

    def js(self, script, args=None):
        return self.http("POST", f"/session/{self.session}/execute/sync", {"script": script, "args": args or []})

    def selector(self, node):
        return f'.react-flow__node[data-id={json.dumps(node)}]'

    def click(self, selector):
        self.js("const e=document.querySelector(arguments[0]);if(!e||e.disabled)throw Error('not actionable: '+arguments[0]);e.click();", [selector])

    def button(self, text, scope="body"):
        self.js("const p=document.querySelector(arguments[1]);const e=p&&[...p.querySelectorAll('button')].find(e=>e.textContent.trim()===arguments[0]);if(!e||e.disabled)throw Error('missing button '+arguments[0]);e.click();", [text, scope])

    def element(self, selector):
        return self.http("POST", f"/session/{self.session}/element", {"using": "css selector", "value": selector})[ELEMENT]

    def keys(self, selector, text):
        self.focus(selector)
        element = self.element(selector)
        self.http("POST", f"/session/{self.session}/element/{element}/value", {"text": text})

    def focus(self, selector):
        # DOM focus avoids React Flow's animated fit-view/pointer overlap. Input
        # still travels through native WebDriver keyboard events, never editor state.
        wait(lambda: self.js("const e=document.querySelector(arguments[0]);if(!e||e.disabled||!e.getClientRects().length)return false;e.focus();return document.activeElement===e;", [selector]), "focus rendered control " + selector)

    def fit(self):
        self.click('.react-flow__controls-fitview')

    def editor(self, node="doc"):
        return self.js("return [...document.querySelector(arguments[0]).querySelectorAll('.cm-line')].map(e=>e.textContent).join('\\n')", [self.selector(node)])

    def edit(self, text, node="doc"):
        selector = self.selector(node) + " .cm-content"
        self.focus(selector)
        element = self.element(selector)
        self.http("POST", f"/session/{self.session}/actions", {"actions": [{"type": "key", "id": "editor-keyboard", "actions": [
            {"type": "keyDown", "value": "\ue009"}, {"type": "keyDown", "value": "a"},
            {"type": "keyUp", "value": "a"}, {"type": "keyUp", "value": "\ue009"}]}]})
        self.http("POST", f"/session/{self.session}/element/{element}/value", {"text": text})
        wait(lambda: self.editor(node) == text, "editor contains replacement")

    def dirty(self, node="doc"):
        return self.js("return !!document.querySelector(arguments[0]+' .document-dirty')", [self.selector(node)])

    def conflict(self):
        return self.js("return [...document.querySelectorAll('.loom-conflict-banner')].some(e=>e.textContent.includes('External change detected'))")

    def save(self, node="doc"):
        self.button("save", self.selector(node))

    def nodes(self, kind="terminal"):
        return self.js("return [...document.querySelectorAll(arguments[0])].map(e=>e.dataset.id)", [f".react-flow__node-{kind}"])

    def sid(self, node):
        return self.js("return document.querySelector(arguments[0]+' .sid').textContent", [self.selector(node)])

    def terminal(self, name):
        prior = self.nodes()
        self.button("+ terminal")
        node = wait(lambda: next((n for n in self.nodes() if n not in prior), None), "new terminal")
        self.fit()
        self.click(self.selector(node) + " .loom-name-button")
        self.keys(self.selector(node) + " .loom-name-input", name + "\ue007")
        wait(lambda: self.js("return document.querySelector(arguments[0]+' .loom-name-button').textContent", [self.selector(node)]) == name, "terminal name")
        self.shell(node, f"printf '%s' $$ > {shlex.quote(str(self.vault / (name + '.pid')))}")
        wait(lambda: (self.vault / (name + ".pid")).exists(), "shell PID marker")
        return node

    def shell(self, node, command):
        selector = self.selector(node) + " .xterm-helper-textarea"
        # Observe browser-delivered input order without changing or slowing it.
        self.js("const e=document.querySelector(arguments[0]);const events=[];const record=x=>events.push({type:x.type,key:x.key,data:x.data,ctrl:x.ctrlKey,alt:x.altKey});for(const type of ['keydown','beforeinput','input'])e.addEventListener(type,record,true);window.__loomAcceptanceInput={e,events,record};", [selector])
        try:
            self.keys(selector, command + "\n")
        finally:
            events = self.js("const p=window.__loomAcceptanceInput;for(const type of ['keydown','beforeinput','input'])p.e.removeEventListener(type,p.record,true);delete window.__loomAcceptanceInput;return p.events;")
            self.facts.setdefault("shell_input_events", []).append({"node": node, "command": command, "events": events})

    def run(self):
        self.click(self.selector("doc") + " .loom-run-button")

    def output(self):
        return self.js("return [...document.querySelectorAll('.loom-output-pre')].map(e=>e.textContent).join('\\n')")

    def canvas(self):
        return json.loads((self.vault / ".loom/canvas.json").read_text())

    def rows(self):
        db = self.vault / ".loom/sessions.db"
        with sqlite3.connect(db.as_uri() + "?mode=ro", uri=True, timeout=2) as connection:
            connection.row_factory = sqlite3.Row
            return [dict(row) for row in connection.execute("SELECT * FROM sessions ORDER BY id")]

    def close(self):
        self.diagnostics(f"before-close-{self.starts}")
        native_close()
        def invisible():
            result = subprocess.run(["xdotool", "search", "--onlyvisible", "--name", "^Loom$"], capture_output=True)
            return result.returncode == 1
        wait(invisible, "normal native close")
        self.stop()

    def diagnostics(self, label):
        try:
            if not self.session:
                raise RuntimeError("No active UI session; see before-close diagnostics")
            self.facts[label + "_terminal_dom_rows"] = self.js("return [...document.querySelectorAll('.react-flow__node-terminal')].map(e=>({node:e.dataset.id,rows:[...e.querySelectorAll('.xterm-rows>div')].map(r=>r.textContent)}))")
            (self.root / f"{label}.html").write_text(self.js("return document.documentElement.outerHTML"))
            png = self.http("GET", f"/session/{self.session}/screenshot")
            (self.root / f"{label}.png").write_bytes(base64.b64decode(png))
        except Exception as error:
            (self.root / f"{label}-diagnostic-error.txt").write_text(str(error))
        try:
            self.facts[label + "_sessions"] = self.rows()
            self.facts[label + "_canvas"] = self.canvas()
        except Exception as error:
            self.facts[label + "_storage_error"] = str(error)

    def owned_processes(self):
        """Find only processes bearing this unique inherited test ownership marker."""
        marker = ("LOOM_NATIVE_ACCEPTANCE_OWNER=" + str(self.root)).encode()
        owned = {}
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            try:
                if marker not in (entry / "environ").read_bytes().split(b"\0"):
                    continue
                fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
                if fields[0] != "Z":
                    owned[int(entry.name)] = fields[19]  # /proc starttime, PID reuse guard.
            except (FileNotFoundError, PermissionError, ProcessLookupError):
                continue
        return owned

    def signal_owned(self, processes, sig):
        for pid, starttime in processes.items():
            try:
                fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
                if fields[19] == starttime and fields[0] != "Z":
                    os.kill(pid, sig)
            except (FileNotFoundError, ProcessLookupError):
                pass

    def stop(self):
        if self.session:
            try:
                self.http("DELETE", f"/session/{self.session}")
            except Exception:
                pass
            self.session = None
        if self.driver:
            try:
                os.killpg(self.driver.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                self.driver.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.driver.pid, signal.SIGKILL)
                self.driver.wait(timeout=5)
            self.driver = None
        # Driver/app descendants may create new process groups or be adopted by
        # PID 1. An exact unique environment marker retains ownership across both.
        self.signal_owned(self.owned_processes(), signal.SIGTERM)
        deadline = time.monotonic() + 3
        while self.owned_processes() and time.monotonic() < deadline:
            time.sleep(0.1)
        self.signal_owned(self.owned_processes(), signal.SIGKILL)
        wait(lambda: not self.owned_processes(), "owned native processes cleaned up", timeout=3)
        if self.log:
            self.log.close()
            self.log = None


def external_changes(case):
    case.fixture()
    case.start()
    path = case.vault / "doc.md"
    for value in ("external one", "external two"):
        path.write_text(value)
        wait(lambda: case.editor() == value, "clean external reload " + value)
        require(not case.dirty(), "External reload incorrectly dirtied document")
    case.edit("local confirmed")
    path.write_text("external conflict")
    wait(case.conflict, "dirty external conflict")
    require(case.editor() == "local confirmed", "Local buffer replaced on conflict")
    case.button("Keep editing")
    case.save()
    wait(lambda: path.read_text() == "local confirmed" and not case.dirty(), "Keep then Save confirmed version")
    case.edit("local must survive")
    path.write_text("external confirmation")
    wait(case.conflict, "second conflict")
    case.button("Keep editing")
    path.write_text("external changed after Keep")
    # Save immediately as a real user could; watcher may win or write may catch hash drift.
    case.save()
    wait(case.conflict, "new change after Keep must conflict again")
    require(path.read_text() == "external changed after Keep", "Save silently overwrote unconfirmed disk change")
    require(case.editor() == "local must survive" and case.dirty(), "Conflict lost local buffer/dirty state")
    case.button("Reload")
    wait(lambda: not case.dirty(), "reload cleanup")
    case.close()


def runnable(case, named=True):
    marker = shlex.quote(str(case.vault / "run.pids"))
    return ("---\nrun_in: target\n---\n" if named else "") + "```sh run\nprintf 'TARGET_RESULT_%s\\n' $$; printf '%s\\n' $$ >> " + marker + "\n```"


def routing_setup(case):
    case.fixture({"doc": runnable(case), "reference": "reference content"}, edges=[
        {"id": "document-context", "from": "reference", "to": "doc", "kind": "context_for"}])
    case.start()
    target = case.terminal("target")
    other = case.terminal("other")  # Last-added fallback differs from named target.
    wait(lambda: case.js("const e=document.querySelector('[data-id=\"e-runin-doc\"]');return e&&e.getAttribute('aria-label')"), "synthetic routing edge")
    edge = case.js("return document.querySelector('[data-id=\"e-runin-doc\"]').getAttribute('aria-label')")
    require(target in edge and "doc" in edge, f"Synthetic edge has wrong target: {edge}")
    require(not any(e["kind"] == "feeds_output_to" for e in case.canvas()["edges"]), "Unexpected feeder fixture")
    case.run()
    target_pid = (case.vault / "target.pid").read_text()
    other_pid = (case.vault / "other.pid").read_text()
    wait(lambda: (case.vault / "run.pids").exists(), "Run shell effect")
    require((case.vault / "run.pids").read_text().splitlines() == [target_pid], "Run did not target named shell exactly once")
    wait(lambda: f"TARGET_RESULT_{target_pid}" in case.output(), "target output captured without feeds_output_to")
    case.shell(other, f"printf 'UNRELATED_OUTPUT_%s\\n' $$; touch {shlex.quote(str(case.vault / 'other-done'))}")
    wait(lambda: (case.vault / "other-done").exists(), "other terminal output completed")
    stable(lambda: f"UNRELATED_OUTPUT_{other_pid}" not in case.output() and (case.vault / "run.pids").read_text().splitlines() == [target_pid], "Unrelated output captured or extra shell executed Run")
    case.facts.update(target=target, other=other, target_pid=target_pid, other_pid=other_pid, edge_label=edge, captured_output=case.output())
    return target, other


def named_routing(case):
    routing_setup(case)
    case.close()


def pin_persistence(case):
    target, other = routing_setup(case)
    case.click(case.selector("doc") + " .loom-pin-button")
    wait(case.dirty, "Pin marks document dirty")
    case.save()
    path = case.vault / "doc.md"
    wait(lambda: f"TARGET_RESULT_{case.facts['target_pid']}" in path.read_text() and not case.dirty(), "pinned Markdown persisted")
    saved = path.read_text()
    wait(lambda: len(case.canvas()["nodes"]) == 4, "all nodes persisted")
    before = case.canvas()
    case.close()
    case.start()
    wait(lambda: len(case.nodes("tombstone")) == 2, "terminal tombstones restored")
    require(path.read_text() == saved, "Pinned Markdown changed across restart")
    require(f"TARGET_RESULT_{case.facts['target_pid']}" in case.editor(), "Pinned result absent in reopened editor")
    require(case.canvas() == before, "Document/node/edge persistence changed after reopen")
    require(case.js("return !!document.querySelector('[data-id=\"document-context\"]')"), "Persisted context edge not visible")
    require(set(case.nodes("document")) == {"doc", "reference"}, "Document nodes not restored")
    case.close()


def restart_no_auto(case):
    marker = case.vault / "launches"
    command = f"printf 'launch\\n' >> {shlex.quote(str(marker))}; exec /bin/sh -i"
    case.fixture(tombstone=command, edges=[{"id": "saved-route", "from": "doc", "to": "saved-terminal", "kind": "triggers"}])
    case.start()
    require(not marker.exists(), "Fixture tombstone executed on first boot")
    case.button("restart", case.selector("saved-terminal"))
    terminal = wait(lambda: next(iter(case.nodes()), None), "explicit initial restart")
    original_sid = case.sid(terminal)
    wait(lambda: marker.exists() and len(marker.read_text().splitlines()) == 1, "saved command initial execution")
    wait(lambda: any(r["id"] == original_sid for r in case.rows()), "original history persisted")
    wait(lambda: any(n["id"] == terminal for n in case.canvas()["nodes"]), "live terminal sidecar persisted")
    before = case.canvas()
    case.close()
    case.start()
    wait(lambda: len(case.nodes("tombstone")) == 1, "restart restores tombstone")
    stable(lambda: marker.read_text().splitlines() == ["launch"] and not case.nodes(), "Relaunch automatically executed saved command")
    require(case.canvas() == before, "Layout/connections changed on reopen")
    require(case.editor() == "original", "Document not restored")
    require(any(r["id"] == original_sid and r["state"] in ("exited", "tombstone") for r in case.rows()), "Original history not restartable")
    case.button("restart", case.selector(terminal))
    fresh = wait(lambda: next(iter(case.nodes()), None), "explicit restored restart")
    fresh_sid = case.sid(fresh)
    wait(lambda: marker.read_text().splitlines() == ["launch", "launch"], "explicit restart executes saved command")
    require(fresh_sid != original_sid, "Restart reused old session ID")
    require({original_sid, fresh_sid}.issubset({r["id"] for r in case.rows()}), "Restart lost original history")
    wait(lambda: any(e["id"] == "saved-route" and e["to"] == fresh for e in case.canvas()["edges"]), "restart rewrites connection target")
    case.facts.update(original_sid=original_sid, fresh_sid=fresh_sid)
    case.close()


def history_actions(case):
    case.fixture({"doc": "original", "reference": "reference"}, edges=[
        {"id": "history-context", "from": "reference", "to": "doc", "kind": "context_for"}])
    case.start()
    terminal = case.terminal("history")
    sid = case.sid(terminal)
    case.shell(terminal, "exit 7")
    wait(lambda: any(r["id"] == sid and r["state"] == "exited" and r["exit_code"] == 7 for r in case.rows()), "natural exit recorded")
    case.click('.session-history > button')
    row = f'.session-history li:has([title={json.dumps(sid)}])'
    wait(lambda: case.js("return !!document.querySelector(arguments[0])", [row]), "history row visible")
    original_nodes = set(case.nodes() + case.nodes("tombstone") + case.nodes("document"))
    case.button("Restart", row)
    fresh = wait(lambda: next((n for n in case.nodes() if n not in original_nodes), None), "history restart attaches fresh node")
    fresh_sid = case.sid(fresh)
    require(fresh_sid != sid, "History Restart reused session ID")
    after = set(case.nodes() + case.nodes("tombstone") + case.nodes("document"))
    require(after == original_nodes | {fresh}, "History Restart duplicated or replaced original topology")
    require({sid, fresh_sid}.issubset({r["id"] for r in case.rows()}), "History Restart lost old metadata")
    saved_doc = (case.vault / "doc.md").read_bytes()
    edges = case.canvas()["edges"]
    case.button("Forget history", row)
    wait(lambda: sid not in {r["id"] for r in case.rows()}, "Forget removed metadata")
    require(set(case.nodes() + case.nodes("tombstone") + case.nodes("document")) == after, "Forget changed existing canvas nodes")
    require((case.vault / "doc.md").read_bytes() == saved_doc, "Forget altered document")
    wait(lambda: {n["id"] for n in case.canvas()["nodes"]} == after, "Forget retains persisted canvas")
    require(case.canvas()["edges"] == edges, "History actions changed document connections")
    case.facts.update(original_sid=sid, fresh_sid=fresh_sid)
    case.close()


def removal_fallback(case):
    target, other = routing_setup(case)
    target_pid = case.facts["target_pid"]
    case.button("close", case.selector(target))
    wait(lambda: target not in case.nodes(), "closed terminal removed")
    wait(lambda: not Path(f"/proc/{target_pid}").exists(), "closed terminal child terminated")
    wait(lambda: not case.js("return !!document.querySelector('[data-id=\"e-runin-doc\"]')"), "incident synthetic route removed")
    wait(lambda: all(e["from"] != target and e["to"] != target for e in case.canvas()["edges"]), "incident persisted edges removed")
    case.edit(runnable(case, named=False))
    case.save()
    wait(lambda: not case.dirty(), "fallback document saved")
    case.run()
    wait(lambda: len((case.vault / "run.pids").read_text().splitlines()) == 2, "fallback Run executed")
    require((case.vault / "run.pids").read_text().splitlines() == [target_pid, case.facts["other_pid"]], "Fallback targeted wrong session")
    wait(lambda: f"TARGET_RESULT_{case.facts['other_pid']}" in case.output(), "remaining target capture")
    require(Path(f"/proc/{case.facts['other_pid']}").exists(), "Remaining terminal unusable")
    case.close()


CASES = {"external_changes": external_changes, "named_routing": named_routing,
         "pin_persistence": pin_persistence, "restart_no_auto": restart_no_auto,
         "history_actions": history_actions, "removal_fallback": removal_fallback}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--test-root", required=True, type=Path)
    parser.add_argument("--frontend-dir", required=True, type=Path)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--driver", default="tauri-driver")
    parser.add_argument("--port", type=int, default=4444)
    parser.add_argument("--native-port", type=int, default=4445)
    parser.add_argument("--case", action="append", choices=CASES)
    args = parser.parse_args()
    args.binary = args.binary.resolve(strict=True)
    args.frontend_dir = args.frontend_dir.resolve(strict=True)
    require(args.binary.is_file() and os.access(args.binary, os.X_OK), "Binary must be an existing executable")
    require((args.frontend_dir / "index.html").is_file(), "Production frontend directory must contain index.html")
    require(1 <= args.port <= 65535 and 1 <= args.native_port <= 65535 and args.port != args.native_port, "Invalid driver ports")
    require(shutil.which(args.driver), "tauri-driver unavailable")
    require(shutil.which("xdotool"), "xdotool unavailable")
    require(os.environ.get("DISPLAY"), "DISPLAY must identify the root-provided desktop")
    args.test_root.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix="loom-native-workspace-", dir=args.test_root.resolve()))
    print(f"Evidence retained: {root}", flush=True)
    selected = args.case or list(CASES)
    summary = {"source_commit": args.source_commit, "binary": str(args.binary), "binary_sha256": sha(args.binary),
               "frontend_dir": str(args.frontend_dir), "frontend_sha256": {str(p.relative_to(args.frontend_dir)): sha(p) for p in sorted(args.frontend_dir.rglob('*')) if p.is_file()},
               "cargo_installed_tools": version(["cargo", "install", "--list"]),
               "webkit_packages": version(["dpkg-query", "-W", "webkit2gtk-driver", "libwebkit2gtk-4.1-0"]),
               "python_version": version(["python3", "--version"]), "xdotool_version": version(["xdotool", "version"]),
               "harness_sha256": sha(__file__),
               "system": version(["uname", "-a"]), "selected_cases": selected,
               "limits": "Linux only; no Windows/macOS, provider, crash recovery or physical hardware claim. DOM button activation/focus with native WebDriver keyboard input; pointer hit testing is not covered. Root owns isolated display/WM/HTTP server.", "results": []}
    for name in selected:
        case = Case(args, root, name)
        result = {"case": name, "vault": str(case.vault)}
        print(f"RUN {name}", flush=True)
        try:
            CASES[name](case)
            result["status"] = "passed"
            print(f"PASS {name}", flush=True)
        except Exception:
            result.update(status="failed", error=traceback.format_exc())
            print(f"FAIL {name}\n{result['error']}", flush=True)
        finally:
            case.diagnostics(result.get("status", "interrupted"))
            case.stop()
            result["facts"] = case.facts
            summary["results"].append(result)
            (root / "summary.json").write_text(json.dumps(summary, indent=2))
    return 1 if any(r["status"] != "passed" for r in summary["results"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
