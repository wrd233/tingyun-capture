# Tingyun Capture v2 Final Test Report

Date: 2026-07-11 (Asia/Shanghai)

## Baseline

Starting branch `main`; starting local and `origin/main` SHA `ff57c0bd7729e0166a69b29cd45816ac256a049a`; starting worktree clean. Baseline typecheck and 11 unit tests passed. The first E2E run proved the Playwright executable was absent after `npm ci`; installing the locked Chromium build repaired the environment and all three legacy E2E tests passed without code changes.

## Automated verification

- TypeScript typecheck: PASS.
- Unit: 23 tests PASS across Task/Session, annotations, Raw, v1 AI-ready, windows/navigation, correlation/endpoints, downloads, security, export determinism, and validator failure behavior.
- E2E: 4 tests PASS, including all three v1 flows and the complete v2 browser Task flow.
- Aggregate: 27 tests PASS.
- Vite production build: PASS.
- Dependency audit at moderate threshold: PASS, zero vulnerabilities.

## Complete local fixture flow

The `research-list` fixture performs list-to-detail SPA navigation, returns `actionId=7788`, reuses it in subsequent query and JSON body requests, opens a popup, exposes CSV and XLSX downloads, supports Reload/New-tab Verify, and includes separate fake secret, large-body, failed-request, and HTTP-200/code=-1 routes. The E2E performs MARK, NOTE, FINISH, stop, derivation, validation, Private export, Shareable export, ZIP inspection, and confirms both downloads normalize. Security regressions prove fake Authorization/Cookie/Bearer/JWT/environment material blocks Shareable; cleaned input passes. Repeated frozen export core hashes match.

## Fixture hashes

- `src/test-site/server.ts`: `44a03430eadcaf568c3011b651106ec61278854df6bda18dd4b4f56183727a83`
- `tests/e2e/capture-flow.test.ts`: `925ae99f9915f0b00287670435b2949824593827e19fee53008e8ceff525e387`
- R1 template: `7b02e70666a23cbb5648f82b452427e9b5283d0db2837ac98617d2fefaea3588`
- R2 template: `576c1a7d8722b34fcb114442948376f963df9d7d991114bda317094be0c95d92`
- R3 template: `6d98d921545269d26b6b0ef4df1343c1a4a222b7bcb3afa906d9648a32043d94`
- R4 template: `b984e81e62498cb7ed13b41b73df3bee9bd713fa1f8bffb40c45681c077bbd9a`

No generated Session, browser profile, private package, shareable package, or download is committed.
