# Quickstart

## Requirements

- Python 3.11+
- POSIX host
- official `codex` CLI already installed
- CLI already authenticated to the intended ChatGPT account/workspace

The collector does not install Codex or perform login.

## Offline verification

```sh
cd tools/codex-usage
python3 -m unittest discover -s tests -v
```

## Target selection

Create a local file outside Git, for example `$HOME/.config/codex-usage/target.json`:

```json
{
  "expected_email": "YOUR_CHATGPT_ACCOUNT_EMAIL",
  "use_current_cli_workspace": true
}
```

Do not put tokens, cookies or auth-file contents in this file. Do not commit it.

## One-shot collection

```sh
python3 /absolute/path/to/newclear/tools/codex-usage/codex_usage.py \
  --codex "$(command -v codex)" \
  --target-file "$HOME/.config/codex-usage/target.json"
```

Exit code: `0` both usage reads OK; `2` partial; `1` failed. Always inspect stdout JSON on non-zero exit.

## Acceptance gate

Before scheduling anything, record and review:

1. `codex --version`;
2. actual authentication/account type without exposing credentials;
3. installed App Server method/schema support;
4. one redacted real snapshot;
5. comparison against the visible Codex usage/status view;
6. confirmation that missing cycle-aligned token data remains `null`.

Until this passes, this project is **offline-tested / live-unverified**.
