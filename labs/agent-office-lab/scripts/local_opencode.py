"""Isolated OpenCode configuration and macOS sandbox for synthetic lab tasks."""
import json
import os
import shutil
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]
BINARY = LAB / 'tools/opencode/node_modules/opencode-darwin-arm64/bin/opencode'


def prepare(out, workspace, office=False):
    out, workspace = Path(out).resolve(), Path(workspace).resolve()
    settings = json.loads((LAB / 'configs/opencode-strata-local.json').read_text())
    if office:
        # Explicit synthetic acceptance mode, not a global auto-approval setting.
        mode = os.environ.get('LAB_OPENCODE_PERMISSION_MODE', 'fixture-allow')
        if mode not in ('fixture-allow', 'ask'):
            raise ValueError('Unknown local permission mode')
        if mode == 'ask':
            settings['permission'].update(edit='ask', bash='ask')
        # Keep only the local status plugin injected by the native Office adapter.
        # Provider/model/permissions remain fixed by our own configuration.
        from urllib.parse import urlparse, unquote
        inline = json.loads(os.environ.get('OPENCODE_CONFIG_CONTENT', '{}'))
        plugins = inline.get('plugin', [])
        for plugin in plugins:
            parsed = urlparse(plugin)
            source = Path(unquote(parsed.path)).resolve()
            if parsed.scheme != 'file' or not source.is_relative_to(workspace / '.agent-office'):
                raise ValueError('Only the workspace Office status plugin may be loaded')
        settings['plugin'] = plugins
    # Receipt exists only in the dedicated local text-task workspace.
    text_run = workspace.parent
    text_mode = (text_run / 'text-task.json').is_file()
    if text_mode:
        settings['permission'] = {'*':'deny', 'read':'allow', 'edit':'allow'}
        settings['plugin'] = [*settings.get('plugin', []), (LAB / 'scripts/local_text_boundary.mjs').as_uri()]
        settings['compaction']['auto'] = False
    config = out / 'opencode.json'
    config.write_text(json.dumps(settings, indent=2) + '\n')
    env = {k: os.environ[k] for k in ('PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'SHELL', 'TERM') if k in os.environ}
    env.update(DO_NOT_TRACK='1', NO_PROXY='127.0.0.1,localhost,::1',
               OPENCODE_CONFIG=str(config), OPENCODE_CONFIG_DIR=str(out / 'config/opencode'),
               OPENCODE_DISABLE_PROJECT_CONFIG='true', OPENCODE_DISABLE_EXTERNAL_SKILLS='true',
               OPENCODE_DISABLE_AUTOUPDATE='true', OPENCODE_DISABLE_DEFAULT_PLUGINS='true',
               OPENCODE_DISABLE_MODELS_FETCH='true', OPENCODE_DISABLE_CLAUDE_CODE='true',
               OPENCODE_DISABLE_LSP_DOWNLOAD='true', OPENCODE_DISABLE_PRUNE='true')
    if text_mode:
        home = out / 'home'; home.mkdir(exist_ok=True)
        env['HOME'] = str(home)
        env['LAB_TEXT_LOG'] = str(out / 'text-tools.jsonl')
        env['LAB_TEXT_WORKSPACE'] = str(workspace)
        env['LAB_TEXT_RECEIPT'] = str(text_run / 'text-task.json')
    if office:
        for key in ('AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_HOOK_TOKEN', 'AGENT_OFFICE_WORKER_ID',
                    'AGENT_OFFICE_SESSION_ID', 'AGENT_OFFICE_EFFORT', 'AGENT_OFFICE_MODEL'):
            if key in os.environ:
                env[key] = os.environ[key]
    for key, subdir in {'XDG_CACHE_HOME': 'cache', 'XDG_CONFIG_HOME': 'config',
                        'XDG_DATA_HOME': 'data', 'XDG_STATE_HOME': 'state', 'TMPDIR': 'tmp'}.items():
        folder = out / subdir
        folder.mkdir(parents=True, exist_ok=True)
        env[key] = str(folder)
    # OpenCode waits for this SDK before loading even a self-contained local plugin.
    # Seed the locked dependencies at setup time; runtime never needs npm access.
    sdk = LAB / 'tools/opencode-plugin'
    config_dir = out / 'config/opencode'
    config_dir.mkdir(parents=True, exist_ok=True)
    for name in ('package.json', 'package-lock.json'):
        shutil.copy2(sdk / name, config_dir / name)
    if not (config_dir / 'node_modules').exists():
        shutil.copytree(sdk / 'node_modules', config_dir / 'node_modules', symlinks=True)
    # Inherited by OpenCode's shell tools. Writes stay in this synthetic run.
    profile = ('(version 1)(allow default)(deny network*)'
               '(allow network-outbound (remote ip "localhost:*"))'
               '(allow network-inbound network-bind (local ip "localhost:*"))'
               '(allow network* (local unix-socket) (remote unix-socket))'
               '(deny file-write*)'
               f'(allow file-write* (subpath {json.dumps(str(out))}))'
               f'(allow file-write* (subpath {json.dumps(str(workspace))}))'
               '(allow file-write* (regex #"^/dev/"))')
    if text_mode:
        profile += f'(deny file-write* (subpath {json.dumps(str(workspace / "source"))}))'
    profile_path = out / 'opencode.sb'
    profile_path.write_text(profile + '\n')
    return ['/usr/bin/sandbox-exec', '-f', str(profile_path), str(BINARY)], env
