STATUS: DONE

## Summary

Base: `d8ca3c4089a9fbe852459da3d9602329224230e7`, branch `fix/379-owned-runner-signals`.
The original cleanup fixture reproducibly fails when its parent supplies ignored SIGINT: unchanged `stop_runner` waits 45 seconds, kills the child and raises `rehearsal_cleanup_incomplete`. The real `test-postgres.py` runner also failed a bounded fake-Docker regression under inherited ignored SIGINT while its ordinary-signal subcase passed.

The runner now installs `signal.default_int_handler` at `main()` entry, before resource allocation. Its Python command then starts with cooperative SIGINT behavior too. The synthetic fixture explicitly establishes the same contract before readiness. Wrapper code, production 45/5-second waits, ownership-label verification, removal arguments and prior assertions are unchanged. Two focused tests cover real runner startup/finally with default and ignored dispositions using only a private fake Docker executable, plus a real noncooperating subprocess that must be SIGKILLed and reported incomplete. Only its wait seam is shortened; assertions require the wrapper's actual 45/5 timeout arguments.

Full #379/M4, AC-04 and live qualification remain incomplete. Historical CI did not capture its signal disposition; reproducing this defect does not establish that historical run's exact cause.

## Verification

All test jobs used the shared launcher from the component directory. CPython 3.13.5 meets the component's >=3.12 constraint; dependencies were installed from unchanged `requirements.lock` with `--require-hashes` into the task-owned `T023-env2/build/venv`. No real Docker, PostgreSQL, VM, SSH, provider or deployed service operation occurred.

- Controlled original-fixture RED receipt `T023-red-original/preserve/evidence/red.log` readback/assertion: 1 error after 45.023 seconds, expected `rehearsal_cleanup_incomplete` — passed
- Controlled real-runner RED receipt `T023-red-runner2/preserve/evidence/red.log` readback/assertion: ignored subcase failed its 5-second wait, ordinary subcase passed — passed
- Launcher `T023-green2`: inherited-ignore exec bootstrap -> `python -m unittest test_single_node_deployment.RehearsalBoundaryTests test_owned_runner_signals -v`, 8 tests in 0.877 seconds — passed
- Launcher `T023-final-static`: `ruff check src tests tests_platform scripts` — passed
- Launcher `T023-final-static`: `ruff format --check src tests tests_platform scripts`, 165 files — passed
- Launcher `T023-final-static`: `python3 ../../scripts/check_project_success.py`, 42 contracts and navigation/index — passed
- Final `git diff --check` and `git diff --no-index --check /dev/null` for each new scoped file — passed

Receipts are retained in the shared workspace task evidence directories with the job IDs above. GREEN log SHA256: `5be5e2b375094f91dc33efde8ce83b5f01a58f58cfcc28e8c80b253f731eece5`. RED original SHA256: `660f1d1f3bc86836b3b6a15c56b5d5b9ee5c78b8b69a0f296c210e4bfb847d39`; runner RED: `1736e848adca25d7ff45ee4dc3b3bf36654c2b35ef3761ae01a82043e0cfbd3b`.

Source SHA256:

| File | SHA256 |
| --- | --- |
| scripts/test-postgres.py | 05718c076f81d4a66f999d31c4db02d0a7ee0b29997f01e4603aa149409e7239 |
| tests_platform/test_single_node_deployment.py | 26003b4b9f1aca21538163d9b217d41794d303f38ae952f6f5d02e454336dcf6 |
| tests_platform/test_owned_runner_signals.py | 117d242ebaabfcd58cf21db8365d88680d46adce9cd044d7c9798bf15e061a3a |
| scripts/single-node-rehearsal.py (unchanged) | 75b43052f2e436b659cc3fc532f63661a7e88177ab53033fad27191bd003fbb1 |

## Documentation

SUCCESS records this bounded AC/evidence without changing the original AC-01–04 or M4 acceptance. This task/report records the process journal: source/history diagnosis -> controlled RED on original fixture and real runner -> startup handler fix -> focused GREEN -> static/contract checks. No delegation or commits.

An initial new test mistakenly reset SIGINT in its command and passed; it was corrected before the retained runner RED. The first combined GREEN had one sandbox loopback socket PermissionError; the approved rerun passed all eight. Initial environment setup failed on an unwritable uv path, then sandbox DNS; the approved hash-locked install completed. An escalated broader `T023-checks` call remained pending and was interrupted after ~903 seconds: no task manifest/log exists, so no execution or result is claimed. Required scoped gates were subsequently completed with the final static job and existing GREEN receipt.

## Risks and Follow-ups

The fix addresses inherited ignored SIGINT, not a blocked signal mask, repeated interrupts during finally, uncatchable termination or host loss. The existing creation/cleanup ownership protocol is preserved, not redesigned. Full database-backed platform, browser, deployed-host, KVM, real export and provider qualification were outside this offline task; none is claimed. Parent owns independent review, publication, PR/CI and acceptance. Keep #379 open and do not mark M4 complete.
