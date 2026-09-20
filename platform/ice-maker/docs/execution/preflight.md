# Preflight Evidence

Date: 2026-09-02 (Europe/Berlin)

## Repository and GitHub

- Target `/home/ckc/test/codex/ice-maker` was absent before bootstrap.
- `gh auth status` identified authenticated login `fallrising`; no credential was
  copied into this repository.
- `gh repo view fallrising/ice-maker` initially returned repository-not-found.
- The repository was then created private with a minimal README seed on `main`,
  cloned, and `build/full-sdd` was created from `origin/main`.
- On 2026-09-03 the still-valid GitHub CLI OAuth token was confirmed to have
  `repo` but not `workflow` scope. The existing SSH key authenticated as
  `fallrising`, so this repository now uses SSH for Git fetch/push and the GitHub
  CLI OAuth token for PR/API operations. No credential material was recorded.

## Toolchain

| Capability | Evidence | Status |
|---|---|---|
| Git | `git version 2.39.5` | available |
| Python | `Python 3.11.2` | available |
| Docker client | `27.5.1` | available; daemon checked by phase gate |
| GNU Make | `4.3` | available |
| Tesseract | command not found | unavailable |
| Poppler (`pdftotext`, `pdfinfo`) | command not found | unavailable |
| Node | command not found in non-interactive PATH | not required |
| Disk | 148 GiB available | sufficient |

## Worker doctor matrix

| Worker | Version/model evidence | Auth/non-interactive evidence | Route |
|---|---|---|---|
| Codex | CLI 0.152.1; `gpt-5.6-luna` | logged in; read-only smoke returned `DOCTOR_OK` | routine implementation |
| Claude | CLI 2.1.258; `fable` | first-party auth; plan-mode smoke returned `DOCTOR_OK` | security/subtle review |
| Cursor | 2026.08.31; `cursor-grok-4.6-high` listed | login successful; ask-mode smoke returned `DOCTOR_OK` | large edits/UI |
| Grok | 1.0.13; `grok-4.6` listed/default | grok.com auth; plan-mode smoke returned `DOCTOR_OK` | read-only review |
| OpenCode | 1.18.9; `opencode-go/deepseek-v4-flash` listed | credential listed; run returned `DOCTOR_OK` | docs/boilerplate |

Codex doctor reported only non-interactive terminal limitations after network was
enabled; provider HTTP and WebSocket reachability passed. The exact commands and
exit codes are recorded in phase verification rather than credentials or raw auth
files.

## External evidence gates

No real VPS, runner registration, production object-store configuration,
production credentials, or rights-cleared private corpus was supplied or read.
Implementation may proceed using local adapters and synthetic fixtures, but these
items remain operational evidence gates and prevent a `PRODUCTION_READY` claim.
