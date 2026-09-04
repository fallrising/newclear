# SDD-005 驗證紀錄

> 本機驗證日期：2026-07-30
> Branch：`agent/accounts-profiles`

## Checkpoints

| Commit | 範圍 |
|--------|------|
| `1864a4f` | Spec、design、安全邊界與 54 項孫任務 |
| `5d4d7b2` | V4 migration、account repository/service、password hashing |
| `3c98889` | Spring Security session authentication、CSRF、auth APIs |
| `25224fa` | Authenticated authorship、legacy compatibility、profile APIs |
| `e9429a1` | Frontend API/CSRF boundary、account UI、profile experience |

## 自動化與 build gates

| Gate | 結果 | 證據 |
|------|------|------|
| Focused account persistence | 通過 | 33 tests |
| Focused auth/security | 通過 | 14 tests |
| Focused ownership contract | 通過 | 7 tests |
| Focused profile contract | 通過 | 20 tests |
| Complete backend regression | 通過 | 146 tests；0 failures、0 errors、0 skipped |
| Frontend lint | 通過 | oxlint；0 warnings、0 errors |
| Frontend production build | 通過 | TypeScript project build + Vite；1860 modules |
| Multi-stage Docker build | 通過 | `phark:sdd005` → `sha256:b0900c9687e281b7b16893b006938b7d165b114a2c86eb8e7265356360fed666` |

Production image build 從 frontend lint/build 到 Maven tests/package 全部重新執行。
Flyway 對 clean SQLite 依序套用 V1–V4，完整 backend suite 再驗證 empty、V3 與
legacy baseline upgrade。Runtime image 使用 UID/GID 10001。

## Production-like runtime smoke

以 `phark:sdd005` 啟動一次性 production profile 容器，container 8080 映射到
host 18085。本機 HTTP 唯一覆寫為 `SESSION_COOKIE_SECURE=false`；測試完成後容器
已停止並由 `--rm` 清理。Cookie jar 與 CSRF response 只寫入 `/tmp`，token、session
ID 與 password 未輸出，也未出現在 application log。

| Scenario | Result |
|----------|--------|
| Health + clean V4 startup | `GET /actuator/health` → 200 `UP`；Flyway latest V4 |
| Anonymous mutation with valid CSRF | Post → 401 `AUTHENTICATION_REQUIRED`；timeline byte-identical |
| Registration | Valid account → 201；canonical handle returned |
| Generic bad login | Wrong password → 401 `INVALID_CREDENTIALS` |
| Login fixation protection | Login → 200；pre/post `JSESSIONID` values differ |
| Cookie policy | Login `Set-Cookie` contains HttpOnly and SameSite=Lax |
| Session persistence | `GET /api/auth/session` returns logged-in profile |
| Authenticated ownership | Spoofed post/reply author ignored；both return account `authorHandle` |
| Profile update/read | PATCH → 200；profile posts resolve new display name |
| CSRF failure/no side effect | PATCH without token → 403 `CSRF_TOKEN_INVALID`；profile unchanged |
| Logout | POST → 204；subsequent session has `account:null` |
| Post-logout mutation | Valid anonymous CSRF + post → 401 `AUTHENTICATION_REQUIRED` |
| SPA fallback | Direct `/profiles/sdd005_user` → 200 `index.html` |

Runtime summary：

```text
health=UP anonymous_write=401 register=201 bad_login=401 login=200
session_rotated=yes post=201 reply=201 profile_patch=200 csrf_reject=403
logout=204 post_logout_write=401 spa_fallback=200
```

## GitHub Actions

- Delivery commit：`a6d37a6aba115cd1377eb3e03b169768ec817e7f`
- Workflow run：[CI #5](https://github.com/fallrising/phark/actions/runs/31324841535)
- Job：[Build container image](https://github.com/fallrising/phark/actions/runs/31324841535/job/93273449054)
- 結果：successful，3m55s；0 failing、0 skipped

此 job 從乾淨的 GitHub runner 執行 production multi-stage Docker build，涵蓋
frontend lint/build、完整 backend suite、package 與 runtime image assembly。
