import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location("compose_e2e", Path(__file__).with_name("compose-e2e.py"))
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class ComposeFixtureTests(unittest.TestCase):
    def test_requires_explicit_local_socket_and_clears_selectors(self):
        for socket in ("", "tcp://127.0.0.1:2375", "unix://relative.sock"):
            with self.assertRaises(RUNNER.FixtureError):
                RUNNER.clean_environment(socket, {})
        with mock.patch.dict(os.environ, {"DOCKER_CONTEXT": "remote", "DOCKER_TLS_VERIFY": "1",
                                              "PRISM_UNKNOWN": "leak", "HTTPS_PROXY": "preserve"}):
            result = RUNNER.clean_environment("unix:///tmp/prism-owned.sock", {"PRISM_VERSION": "unique"})
        self.assertNotIn("DOCKER_CONTEXT", result)
        self.assertNotIn("DOCKER_TLS_VERIFY", result)
        self.assertNotIn("PRISM_UNKNOWN", result)
        self.assertEqual(result["HTTPS_PROXY"], "preserve")
        self.assertEqual(result["PRISM_VERSION"], "unique")

    def test_fixture_secrets_are_independent_and_private(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "secrets"
            values = RUNNER.fixture_secrets(target)
            self.assertEqual(set(values), set(RUNNER.SECRET_NAMES))
            self.assertNotEqual(values["jwt_secret"], values["ingest_api_key"])
            self.assertEqual(target.stat().st_mode & 0o777, 0o711)
            for name, value in values.items():
                self.assertEqual((target / name).read_text().strip(), value)
                self.assertEqual((target / name).stat().st_mode & 0o777, 0o444)

    def test_preflight_failure_removes_generated_secrets_but_keeps_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            scratch = Path(directory)
            RUNNER.fixture_secrets(scratch / "secrets")
            evidence = scratch / "evidence.log"
            evidence.write_text("redacted preflight failure\n")
            RUNNER.remove_generated_secrets_after_failure(scratch, started=False, cleaned=False)
            self.assertFalse((scratch / "secrets").exists())
            self.assertEqual(evidence.read_text(), "redacted preflight failure\n")

    def test_override_labels_every_owned_resource(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "override.json"
            RUNNER.override_file(path, "owned")
            data = json.loads(path.read_text())
            for service in RUNNER.SERVICES:
                self.assertEqual(data["services"][service]["labels"][RUNNER.LABEL], "owned")
            for value in data["volumes"].values():
                self.assertEqual(value["labels"][RUNNER.LABEL], "owned")
            self.assertEqual(data["networks"]["default"]["labels"][RUNNER.LABEL], "owned")
            self.assertEqual(data["services"]["prismd"]["pull_policy"], "never")

    def test_published_port_must_be_valid_loopback(self):
        self.assertEqual(RUNNER.parse_port("127.0.0.1:4317\n"), 4317)
        self.assertEqual(RUNNER.parse_port("[::1]:9090\n"), 9090)
        for output in ("", "garbage", "0.0.0.0:9090", "[::]:9090", "127.0.0.1:0",
                       "127.0.0.1:65536", "127.0.0.1:1\n127.0.0.1:2"):
            with self.subTest(output=output), self.assertRaisesRegex(RUNNER.FixtureError, "published port"):
                RUNNER.parse_port(output)

    def test_ownership_mismatch_fails_closed(self):
        fake = subprocess.CompletedProcess([], 0, stdout=json.dumps([{"Config": {"Labels": {
            RUNNER.LABEL: "someone-else", "com.docker.compose.project": "prism-e2e-test"}}}]))
        with mock.patch.object(RUNNER, "invoke", return_value="container-id"), \
             mock.patch.object(subprocess, "run", return_value=fake):
            with self.assertRaisesRegex(RUNNER.FixtureError, "ownership mismatch"):
                RUNNER.inspect_owned("docker", {}, "prism-e2e-test", "ours")

    def test_cleanup_absence_is_mandatory(self):
        with mock.patch.object(RUNNER, "invoke", return_value="still-running"):
            with self.assertRaisesRegex(RUNNER.FixtureError, "containers remain"):
                RUNNER.assert_absent("docker", {}, "prism-e2e-test")

    def test_unknown_inspect_failure_is_not_absence(self):
        result = subprocess.CompletedProcess([], 1, stderr=b"permission denied")
        with self.assertRaisesRegex(RUNNER.FixtureError, "inspect failed"):
            RUNNER.absent_inspect(result, "volume", "prism-e2e-test_ch-data")
        missing = subprocess.CompletedProcess([], 1, stdout=b"[]\n", stderr=b"Error response from daemon: get prism-e2e-test_ch-data: no such volume")
        self.assertTrue(RUNNER.absent_inspect(missing, "volume", "prism-e2e-test_ch-data"))

    def test_docker29_exact_network_absence_and_mixed_errors(self):
        name = "prism-e2e-bea00939ec7c_default"
        missing = subprocess.CompletedProcess([], 1, stdout="[]\n", stderr=f"Error response from daemon: network {name} not found\n")
        self.assertTrue(RUNNER.absent_inspect(missing, "network", name))
        for message in (f"Error response from daemon: network {name} not found\npermission denied",
                        "Error response from daemon: network another_default not found",
                        f"Error response from daemon: network {name} not found due to permission denied"):
            with self.subTest(message=message), self.assertRaisesRegex(RUNNER.FixtureError, "inspect failed"):
                RUNNER.absent_inspect(subprocess.CompletedProcess([], 1, stderr=message), "network", name)
        with self.assertRaisesRegex(RUNNER.FixtureError, "mixed output"):
            RUNNER.absent_inspect(subprocess.CompletedProcess([], 1, stdout="unexpected", stderr=missing.stderr), "network", name)
        with self.assertRaisesRegex(RUNNER.FixtureError, "mixed output"):
            RUNNER.absent_inspect(subprocess.CompletedProcess([], 1, stdout='[{"Name":"another"}]', stderr=missing.stderr), "network", name)

    def test_preflight_volume_and_network_collisions(self):
        for kind in ("volume", "network"):
            existing = {"Name": "occupied", "Labels": {RUNNER.LABEL: "other"}}
            def inspect(_docker, _environment, actual_kind, _name, _secrets):
                return existing if actual_kind == kind else None
            with self.subTest(kind=kind), mock.patch.object(RUNNER, "invoke", return_value=""), \
                 mock.patch.object(RUNNER, "inspect_resource", side_effect=inspect):
                with self.assertRaisesRegex(RUNNER.FixtureError, "collision before start"):
                    RUNNER.assert_project_clear("docker", {}, "prism-e2e-test", ())

    def test_preflight_container_collision(self):
        with mock.patch.object(RUNNER, "invoke", return_value="existing-container"):
            with self.assertRaisesRegex(RUNNER.FixtureError, "container collision"):
                RUNNER.assert_project_clear("docker", {}, "prism-e2e-test", ())

    def test_preflight_unknown_inspect_error_stops(self):
        with mock.patch.object(RUNNER, "invoke", return_value=""), \
             mock.patch.object(RUNNER, "inspect_resource", side_effect=RUNNER.FixtureError("Docker inspect failed")):
            with self.assertRaisesRegex(RUNNER.FixtureError, "inspect failed"):
                RUNNER.assert_project_clear("docker", {}, "prism-e2e-test", ())

    def test_evidence_redacts_success_and_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / "evidence.log"
            with mock.patch.object(RUNNER, "EVIDENCE_PATH", evidence):
                RUNNER.record_evidence(["docker", "inspect", "fixture"],
                                       subprocess.CompletedProcess([], 0, stdout="success sensitive-marker"),
                                       ("sensitive-marker",))
                RUNNER.record_evidence(["docker", "down"],
                                       subprocess.CompletedProcess([], 1, stderr="failed sensitive-marker"),
                                       ("sensitive-marker",))
            text = evidence.read_text()
            self.assertIn("success [REDACTED]", text)
            self.assertIn("failed [REDACTED]", text)
            self.assertNotIn("sensitive-marker", text)

    def test_cleanup_inspection_error_fails_closed(self):
        with mock.patch.object(RUNNER, "invoke", return_value=""), \
             mock.patch.object(RUNNER, "inspect_resource", side_effect=RUNNER.FixtureError("Docker inspect failed")):
            with self.assertRaisesRegex(RUNNER.FixtureError, "inspect failed"):
                RUNNER.assert_absent("docker", {}, "prism-e2e-test")

    def test_graceful_exit_requires_zero_status(self):
        stopped = {"Config": {"Labels": {RUNNER.LABEL: "ours"}},
                   "State": {"Running": False, "ExitCode": 137, "OOMKilled": False}}
        with mock.patch.object(RUNNER, "invoke", return_value="container-id") as invoked, \
             mock.patch.object(RUNNER, "inspect_resource", return_value=stopped):
            with self.assertRaisesRegex(RUNNER.FixtureError, "did not exit gracefully"):
                RUNNER.assert_graceful_exit("docker", {}, ["compose"], "prismd", "ours", ())
        self.assertEqual(invoked.call_args.args[0], ["compose", "ps", "--all", "-q", "prismd"])
        stopped["State"]["ExitCode"] = 0
        stopped["State"]["OOMKilled"] = True
        with mock.patch.object(RUNNER, "invoke", return_value="container-id"), \
             mock.patch.object(RUNNER, "inspect_resource", return_value=stopped):
            with self.assertRaisesRegex(RUNNER.FixtureError, "did not exit gracefully"):
                RUNNER.assert_graceful_exit("docker", {}, ["compose"], "prismd", "ours", ())

    def test_inspect_evidence_excludes_environment_and_unrelated_labels(self):
        marker = "PROXY_SECRET_MARKER"
        raw = {"Id": "container-id", "Name": "/prism-e2e-test-prismd-1",
               "Config": {"Labels": {RUNNER.LABEL: "ours", "com.docker.compose.project": "prism-e2e-test",
                                     "unrelated-secret-label": marker}, "Env": ["HTTPS_PROXY=" + marker]},
               "State": {"Running": False, "ExitCode": 0, "OOMKilled": False},
               "HostConfig": {"Secret": marker}}
        result = subprocess.CompletedProcess([], 0, stdout=json.dumps([raw]), stderr="")
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / "evidence.log"
            with mock.patch.object(RUNNER, "EVIDENCE_PATH", evidence), \
                 mock.patch.object(subprocess, "run", return_value=result):
                self.assertEqual(RUNNER.inspect_resource("docker", {}, "container", "container-id", ())["Id"], "container-id")
            text = evidence.read_text()
            self.assertNotIn(marker, text)
            self.assertNotIn("HTTPS_PROXY", text)
            self.assertIn('"ExitCode": 0', text)
            self.assertIn('"org.prism.e2e.owner": "ours"', text)

    def test_failed_startup_diagnostics_require_owned_clickhouse(self):
        item = {"Config": {"Labels": {RUNNER.LABEL: "ours", "com.docker.compose.project": "prism-e2e-test"}}}
        with mock.patch.object(RUNNER, "inspect_owned"), \
             mock.patch.object(RUNNER, "inspect_resource", return_value=item), \
             mock.patch.object(RUNNER, "invoke", side_effect=["compose logs", "container-id", "ClickHouse error"]) as invoked:
            RUNNER.diagnose_owned_failure("docker", ["compose"], {}, "prism-e2e-test", "ours", ("secret",))
        commands = [call.args[0] for call in invoked.call_args_list]
        self.assertEqual(commands[0], ["compose", "logs", "--no-color", "--tail", "80", "clickhouse", "prismd", "grafana"])
        self.assertEqual(commands[1], ["compose", "ps", "--all", "-q", "clickhouse"])
        self.assertEqual(commands[2], ["docker", "exec", "container-id", "tail", "-n", "80", "/var/log/clickhouse-server/clickhouse-server.err.log"])
        item["Config"]["Labels"][RUNNER.LABEL] = "other"
        with mock.patch.object(RUNNER, "inspect_owned"), \
             mock.patch.object(RUNNER, "inspect_resource", return_value=item), \
             mock.patch.object(RUNNER, "invoke", side_effect=["compose logs", "container-id"]) as invoked:
            RUNNER.diagnose_owned_failure("docker", ["compose"], {}, "prism-e2e-test", "ours", ())
        self.assertEqual(invoked.call_count, 2)

    def test_main_uses_supported_health_restart_and_retains_data_checks(self):
        calls = []
        def invoke(arguments, environment, timeout=90, secrets_to_redact=()):
            calls.append((arguments, timeout))
            if "start" in arguments:
                raise RUNNER.FixtureError("unknown flag: --wait")
            if "--config-check" in arguments:
                return "configuration valid"
            if "port" in arguments:
                return "127.0.0.1:12345"
            if "ps" in arguments:
                return "container-id"
            return ""

        container = {"Id": "container-id", "Config": {"Labels": {
            RUNNER.LABEL: "prism-e2e-fixed-fixed", "com.docker.compose.project": "prism-e2e-fixed"}},
            "State": {"Running": False, "ExitCode": 0, "OOMKilled": False}, "Mounts": []}
        # This routing check isolates lifecycle wiring; identity refusal is
        # exercised separately with real inspection-shaped fixtures.
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(RUNNER.secrets, "token_hex", return_value="fixed"), \
             mock.patch.object(RUNNER.shutil, "which", return_value="docker"), \
             mock.patch.object(RUNNER, "inspect_resource", return_value=container), \
             mock.patch.object(RUNNER, "assert_project_clear"), \
             mock.patch.object(RUNNER, "inspect_owned"), \
             mock.patch.object(RUNNER, "assert_absent"), \
             mock.patch.object(RUNNER, "assert_graceful_exit", return_value="container-id"), \
             mock.patch.object(RUNNER, "service_identity", return_value={"container_id": "container-id", "named_volumes": {}}), \
             mock.patch.object(RUNNER, "invoke", side_effect=invoke), \
             mock.patch.object(RUNNER, "EVIDENCE_PATH", None):
            result = RUNNER.main(["--docker-host", "unix:///tmp/owned.sock", "--no-build",
                                  "--image", "prism/prismd:prism-e2e-test", "--artifact-dir", directory])
        self.assertEqual(result, 0)
        restart_commands = [arguments for arguments, _ in calls if "--no-recreate" in arguments]
        self.assertEqual([arguments[-8:] for arguments in restart_commands], [
            ["up", "--wait", "--no-recreate", "--no-deps", "--no-build", "--pull", "never", service]
            for service in ("prismd", "clickhouse")])
        self.assertEqual([timeout for arguments, timeout in calls if "--no-recreate" in arguments], [90, 90])
        self.assertEqual(sum("^TestPhase1ComposeRestart$" in arguments for arguments, _ in calls), 2)
        self.assertTrue(any("down" in arguments and "--volumes" in arguments for arguments, _ in calls))

    def test_main_early_prerequisite_failures_leave_no_secrets_or_docker_commands(self):
        for case in ("invalid-socket", "missing-docker"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                artifact = Path(directory)
                unrelated = artifact / "unrelated-evidence.log"
                unrelated.write_text("keep previous evidence")
                with mock.patch.object(RUNNER.shutil, "which", return_value=None if case == "missing-docker" else "docker"), \
                     mock.patch.object(RUNNER, "invoke") as invoke, \
                     mock.patch.object(RUNNER, "inspect_resource") as inspect, \
                     mock.patch.object(RUNNER, "EVIDENCE_PATH", None), \
                     mock.patch("sys.stderr") as stderr:
                    try:
                        result = RUNNER.main(["--docker-host", "tcp://127.0.0.1:2375" if case == "invalid-socket" else "unix:///tmp/owned.sock",
                                              "--no-build", "--image", "prism/prismd:prism-e2e-test", "--artifact-dir", directory])
                    except (RUNNER.FixtureError, OSError) as error:
                        result = "uncaught " + type(error).__name__
                remaining = list(artifact.glob("*/secrets/*"))
                self.assertEqual(result, 1, f"{case}: remaining secret files={len(remaining)}")
                self.assertFalse(remaining)
                invoke.assert_not_called()
                inspect.assert_not_called()
                self.assertEqual(unrelated.read_text(), "keep previous evidence")
                diagnostic = "".join(call.args[0] for call in stderr.write.call_args_list)
                self.assertIn("failed", diagnostic)
                self.assertLess(len(diagnostic), 1024)

    def test_main_partial_secret_and_override_setup_failures_clean_private_bytes(self):
        for case in ("partial-secret", "override"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                artifact = Path(directory)
                unrelated = artifact / "unrelated-evidence.log"
                unrelated.write_text("keep previous evidence")
                generated = {}
                real_secrets = RUNNER.fixture_secrets
                def fixture_secrets(path):
                    if case == "partial-secret":
                        path.mkdir(mode=0o700)
                        generated["marker"] = "GENERATED_PRIVATE_MARKER"
                        (path / "jwt_secret").write_text(generated["marker"])
                        raise OSError("failed writing " + generated["marker"])
                    generated.update(real_secrets(path))
                    return generated
                def override(_path, _owner):
                    raise OSError("failed override " + generated["ingest_api_key"])
                with mock.patch.object(RUNNER.shutil, "which", return_value="docker"), \
                     mock.patch.object(RUNNER, "fixture_secrets", side_effect=fixture_secrets), \
                     mock.patch.object(RUNNER, "override_file", side_effect=override), \
                     mock.patch.object(RUNNER, "invoke") as invoke, \
                     mock.patch.object(RUNNER, "inspect_resource") as inspect, \
                     mock.patch.object(RUNNER, "EVIDENCE_PATH", None), \
                     mock.patch("sys.stderr") as stderr:
                    try:
                        result = RUNNER.main(["--docker-host", "unix:///tmp/owned.sock", "--no-build",
                                              "--image", "prism/prismd:prism-e2e-test", "--artifact-dir", directory])
                    except (RUNNER.FixtureError, OSError) as error:
                        result = "uncaught " + type(error).__name__
                self.assertEqual(result, 1)
                self.assertFalse(list(artifact.glob("*/secrets/*")))
                invoke.assert_not_called()
                inspect.assert_not_called()
                self.assertEqual(unrelated.read_text(), "keep previous evidence")
                diagnostic = "".join(call.args[0] for call in stderr.write.call_args_list)
                evidence = "".join(path.read_text() for path in artifact.rglob("*.evidence.log"))
                self.assertIn("failed", diagnostic)
                self.assertLess(len(diagnostic), 1024)
                for value in generated.values():
                    self.assertNotIn(value, diagnostic + evidence)

    def test_main_artifact_directory_failure_returns_bounded_result(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "existing-file"
            artifact.write_text("keep previous evidence")
            with mock.patch.object(RUNNER.shutil, "which", return_value="docker"), \
                 mock.patch.object(RUNNER, "invoke") as invoke, \
                 mock.patch.object(RUNNER, "inspect_resource") as inspect, \
                 mock.patch.object(RUNNER, "EVIDENCE_PATH", None), \
                 mock.patch("sys.stderr") as stderr:
                result = RUNNER.main(["--docker-host", "unix:///tmp/owned.sock", "--no-build",
                                      "--image", "prism/prismd:prism-e2e-test", "--artifact-dir", str(artifact)])
            self.assertEqual(result, 1)
            self.assertEqual(artifact.read_text(), "keep previous evidence")
            invoke.assert_not_called()
            inspect.assert_not_called()
            diagnostic = "".join(call.args[0] for call in stderr.write.call_args_list)
            self.assertIn("private fixture directory creation", diagnostic)
            self.assertLess(len(diagnostic), 1024)

    def test_main_uncertain_live_cleanup_preserves_owned_secret_fixture(self):
        def invoke(arguments, _environment, timeout=90, secrets_to_redact=()):
            if "--config-check" in arguments:
                return "configuration valid"
            if "up" in arguments:
                raise RUNNER.FixtureError("startup failed")
            return ""
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory)
            with mock.patch.object(RUNNER.shutil, "which", return_value="docker"), \
                 mock.patch.object(RUNNER, "inspect_resource", return_value={}), \
                 mock.patch.object(RUNNER, "assert_project_clear"), \
                 mock.patch.object(RUNNER, "inspect_owned", side_effect=RUNNER.FixtureError("ownership uncertain")), \
                 mock.patch.object(RUNNER, "invoke", side_effect=invoke) as invoked, \
                 mock.patch.object(RUNNER, "EVIDENCE_PATH", None), \
                 mock.patch("sys.stderr") as stderr:
                result = RUNNER.main(["--docker-host", "unix:///tmp/owned.sock", "--no-build",
                                      "--image", "prism/prismd:prism-e2e-test", "--artifact-dir", directory])
            self.assertEqual(result, 1)
            self.assertEqual(len(list(artifact.glob("*/secrets/*"))), len(RUNNER.SECRET_NAMES))
            self.assertFalse(any("down" in call.args[0] for call in invoked.call_args_list))
            diagnostic = "".join(call.args[0] for call in stderr.write.call_args_list)
            self.assertIn("startup failed", diagnostic)
            self.assertIn("ownership uncertain", diagnostic)
            self.assertIn("Owned fixture preserved for diagnosis", diagnostic)

    def main_with_changing_ports(self, invalid_port=None):
        phase = 0
        calls, test_calls, port_calls, values = [], [], [], {}
        real_secrets = RUNNER.fixture_secrets
        bindings = (("prismd", "9090"), ("prismd", "4317"), ("grafana", "3000"), ("clickhouse", "9000"))
        def fixture_secrets(path):
            values.update(real_secrets(path))
            return values
        def restart(_docker, _environment, _command, service, _project, _owner, _secrets):
            nonlocal phase
            self.assertEqual(service, ("prismd", "clickhouse")[phase])
            phase += 1
        def invoke(arguments, environment, timeout=90, secrets_to_redact=()):
            calls.append((arguments, timeout))
            if "--config-check" in arguments:
                return "configuration valid"
            if "port" in arguments:
                binding = tuple(arguments[-2:])
                port_calls.append((phase, binding, timeout))
                if invalid_port is not None and (phase, binding) == invalid_port[:2]:
                    return invalid_port[2]
                return f"127.0.0.1:{20000 + 100 * phase + bindings.index(binding) + 1}"
            if "^TestPhase1Compose$" in arguments or "^TestPhase1ComposeRestart$" in arguments:
                test_calls.append((phase, environment.copy(), timeout))
            return ""
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(RUNNER.shutil, "which", return_value="docker"), \
             mock.patch.object(RUNNER, "fixture_secrets", side_effect=fixture_secrets), \
             mock.patch.object(RUNNER, "inspect_resource", return_value={}), \
             mock.patch.object(RUNNER, "assert_project_clear"), \
             mock.patch.object(RUNNER, "inspect_owned"), \
             mock.patch.object(RUNNER, "assert_absent"), \
             mock.patch.object(RUNNER, "diagnose_owned_failure"), \
             mock.patch.object(RUNNER, "restart_owned_service", side_effect=restart), \
             mock.patch.object(RUNNER, "invoke", side_effect=invoke), \
             mock.patch.object(RUNNER, "EVIDENCE_PATH", None), \
             mock.patch("sys.stdout"), mock.patch("sys.stderr") as stderr:
            result = RUNNER.main(["--docker-host", "unix:///tmp/owned.sock", "--no-build",
                                  "--image", "prism/prismd:prism-e2e-test", "--artifact-dir", directory])
        error = "".join(call.args[0] for call in stderr.write.call_args_list)
        return result, test_calls, port_calls, calls, values, error

    def test_main_refreshes_all_endpoints_and_keeps_credentials_after_each_restart(self):
        result, test_calls, port_calls, calls, values, _error = self.main_with_changing_ports()
        self.assertEqual(result, 0)
        self.assertEqual([phase for phase, _environment, _timeout in test_calls], [0, 1, 2])
        for phase, environment, timeout in test_calls:
            self.assertEqual(environment["PRISM_E2E_HTTP_URL"], f"http://127.0.0.1:{20001 + 100 * phase}")
            self.assertEqual(environment["PRISM_E2E_GRPC_ADDRESS"], f"127.0.0.1:{20002 + 100 * phase}")
            self.assertEqual(environment["PRISM_E2E_GRAFANA_URL"], f"http://127.0.0.1:{20003 + 100 * phase}")
            self.assertEqual(environment["PRISM_E2E_CLICKHOUSE_DSN"],
                             "clickhouse://prism:" + RUNNER.quote(values["clickhouse_password"], safe="")
                             + f"@127.0.0.1:{20004 + 100 * phase}/prism")
            self.assertEqual(environment["PRISM_E2E_API_KEY"], values["ingest_api_key"])
            self.assertEqual(environment["PRISM_E2E_GRAFANA_PASSWORD"], values["grafana_password"])
            self.assertEqual(environment["DOCKER_HOST"], "unix:///tmp/owned.sock")
            self.assertEqual(timeout, 330 if phase == 0 else 90)
        self.assertEqual([(phase, binding) for phase, binding, _timeout in port_calls], [
            (phase, binding) for phase in (0, 1, 2) for binding in
            (("prismd", "9090"), ("prismd", "4317"), ("grafana", "3000"), ("clickhouse", "9000"))])
        self.assertTrue(all(timeout == 20 for _phase, _binding, timeout in port_calls))
        self.assertTrue(any("down" in arguments and "--volumes" in arguments for arguments, _timeout in calls))

    def test_main_refreshed_ports_fail_closed_before_post_restart_data_queries(self):
        bindings = (("prismd", "9090"), ("prismd", "4317"), ("grafana", "3000"), ("clickhouse", "9000"))
        for phase in (1, 2):
            for binding in bindings:
                for output in ("", "0.0.0.0:20101", "127.0.0.1:0"):
                    with self.subTest(phase=phase, binding=binding, output=output):
                        result, test_calls, _port_calls, calls, _values, error = self.main_with_changing_ports(
                            (phase, binding, output))
                        self.assertEqual(result, 1)
                        self.assertIn("unexpected Compose published port", error)
                        self.assertEqual([called_phase for called_phase, _environment, _timeout in test_calls], list(range(phase)))
                        self.assertTrue(any("down" in arguments and "--volumes" in arguments for arguments, _timeout in calls))

    @staticmethod
    def restart_fixture(service="clickhouse", running=False):
        project = "prism-e2e-test"
        identifier = "a" * 64
        labels = {RUNNER.LABEL: "ours", "com.docker.compose.project": project}
        volume = {"Name": project + "_ch-data", "Driver": "local", "Scope": "local",
                  "Mountpoint": "/var/lib/docker/volumes/" + project + "_ch-data/_data",
                  "CreatedAt": "2026-10-08T07:00:00Z", "Labels": labels.copy()}
        container = {"Id": identifier, "Config": {"Labels": {
            **labels, "com.docker.compose.service": service}},
            "State": {"Running": running, "ExitCode": 0, "OOMKilled": False,
                      "Health": {"Status": "healthy" if running else "unhealthy"}},
            "Mounts": [{"Type": "volume", "Name": volume["Name"],
                        "Source": volume["Mountpoint"], "Destination": "/var/lib/clickhouse"}]
                       if service == "clickhouse" else []}
        return container, volume

    def test_restart_retains_exact_owned_container_and_volume_identity(self):
        for service in ("prismd", "clickhouse"):
            stopped, volume = self.restart_fixture(service)
            running, _ = self.restart_fixture(service, running=True)
            containers = iter((stopped, running))
            def inspect(_docker, _environment, kind, _name, _secrets):
                return next(containers) if kind == "container" else volume
            with self.subTest(service=service), \
                 mock.patch.object(RUNNER, "assert_graceful_exit", return_value=stopped["Id"]) as graceful, \
                 mock.patch.object(RUNNER, "invoke", side_effect=[stopped["Id"], "healthy", running["Id"]]) as invoke, \
                 mock.patch.object(RUNNER, "inspect_resource", side_effect=inspect):
                RUNNER.restart_owned_service("docker", {}, ["compose"], service, "prism-e2e-test", "ours", ())
            graceful.assert_called_once_with("docker", {}, ["compose"], service, "ours", ())
            self.assertEqual(invoke.call_args_list[1], mock.call(
                ["compose", "up", "--wait", "--no-recreate", "--no-deps", "--no-build", "--pull", "never", service],
                {}, 90, ()))

    def test_restart_identity_refuses_missing_or_unowned_resources_before_mutation(self):
        cases = ("missing-container", "empty-id", "multiple-ids", "mismatched-id", "container-owner",
                 "container-project", "container-service", "running-stopped", "missing-mounts",
                 "missing-data-mount", "missing-volume", "volume-owner", "volume-project", "volume-name",
                 "volume-created", "volume-source", "duplicate-destination", "graceful-id")
        for case in cases:
            container, volume = self.restart_fixture()
            identifier = container["Id"]
            if case == "missing-container":
                container = None
            elif case == "empty-id":
                identifier = ""
            elif case == "multiple-ids":
                identifier += "\n" + "b" * 64
            elif case == "mismatched-id":
                container["Id"] = "b" * 64
            elif case.startswith("container-"):
                key = {"container-owner": RUNNER.LABEL, "container-project": "com.docker.compose.project",
                       "container-service": "com.docker.compose.service"}[case]
                container["Config"]["Labels"][key] = "other"
            elif case == "running-stopped":
                container["State"]["Running"] = True
            elif case == "missing-mounts":
                container.pop("Mounts")
            elif case == "missing-data-mount":
                container["Mounts"] = []
            elif case == "missing-volume":
                volume = None
            elif case in ("volume-owner", "volume-project"):
                volume["Labels"][RUNNER.LABEL if case == "volume-owner" else "com.docker.compose.project"] = "other"
            elif case == "volume-name":
                volume["Name"] = "another-data"
            elif case == "volume-created":
                volume.pop("CreatedAt")
            elif case == "volume-source":
                container["Mounts"][0]["Source"] = "/different-data"
            elif case == "duplicate-destination":
                container["Mounts"].append(container["Mounts"][0].copy())
            def inspect(_docker, _environment, kind, _name, _secrets):
                return container if kind == "container" else volume
            with self.subTest(case=case), \
                 mock.patch.object(RUNNER, "assert_graceful_exit", return_value="b" * 64 if case == "graceful-id" else "a" * 64), \
                 mock.patch.object(RUNNER, "invoke", return_value=identifier) as invoke, \
                 mock.patch.object(RUNNER, "inspect_resource", side_effect=inspect):
                with self.assertRaises(RUNNER.FixtureError):
                    RUNNER.restart_owned_service("docker", {}, ["compose"], "clickhouse", "prism-e2e-test", "ours", ())
            self.assertFalse(any("up" in call.args[0] for call in invoke.call_args_list))

    def test_restart_refuses_replaced_container_volume_and_failed_health(self):
        for case in ("container", "volume-created", "volume-mountpoint", "volume-name", "volume-owner",
                     "missing-container", "missing-volume", "unhealthy", "not-running"):
            stopped, old_volume = self.restart_fixture()
            restarted, new_volume = self.restart_fixture(running=True)
            identifier = restarted["Id"]
            if case == "container":
                identifier = restarted["Id"] = "b" * 64
            elif case == "volume-created":
                new_volume["CreatedAt"] = "2026-10-08T07:01:00Z"
            elif case == "volume-mountpoint":
                restarted["Mounts"][0]["Source"] = new_volume["Mountpoint"] = "/replaced-data"
            elif case == "volume-name":
                restarted["Mounts"][0]["Name"] = new_volume["Name"] = "prism-e2e-test_replaced-data"
            elif case == "volume-owner":
                new_volume["Labels"][RUNNER.LABEL] = "other"
            elif case == "missing-container":
                restarted = None
            elif case == "missing-volume":
                new_volume = None
            elif case == "unhealthy":
                restarted["State"]["Health"]["Status"] = "unhealthy"
            elif case == "not-running":
                restarted["State"]["Running"] = False
            containers, volumes = iter((stopped, restarted)), iter((old_volume, new_volume))
            def inspect(_docker, _environment, kind, _name, _secrets):
                return next(containers if kind == "container" else volumes)
            with self.subTest(case=case), \
                 mock.patch.object(RUNNER, "assert_graceful_exit", return_value=stopped["Id"]), \
                 mock.patch.object(RUNNER, "invoke", side_effect=[stopped["Id"], "healthy", identifier]), \
                 mock.patch.object(RUNNER, "inspect_resource", side_effect=inspect):
                with self.assertRaises(RUNNER.FixtureError):
                    RUNNER.restart_owned_service("docker", {}, ["compose"], "clickhouse", "prism-e2e-test", "ours", ())

    def test_restart_failure_preserves_first_error_without_identity_retry(self):
        with mock.patch.object(RUNNER, "assert_graceful_exit", return_value="a" * 64), \
             mock.patch.object(RUNNER, "service_identity", return_value={"container_id": "a" * 64}) as identity, \
             mock.patch.object(RUNNER, "invoke", side_effect=RUNNER.FixtureError("first health timeout")):
            with self.assertRaisesRegex(RUNNER.FixtureError, "first health timeout"):
                RUNNER.restart_owned_service("docker", {}, ["compose"], "prismd", "prism-e2e-test", "ours", ())
        self.assertEqual(identity.call_count, 1)

    def test_restart_identity_evidence_excludes_bind_paths_and_environment(self):
        container, volume = self.restart_fixture()
        marker = "PRIVATE_BIND_MARKER"
        container["Config"]["Env"] = ["TOKEN=" + marker]
        container["Mounts"].append({"Type": "bind", "Source": marker, "Destination": "/secret"})
        def inspect(_docker, _environment, kind, _name, _secrets):
            return container if kind == "container" else volume
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / "evidence.log"
            with mock.patch.object(RUNNER, "EVIDENCE_PATH", evidence), \
                 mock.patch.object(RUNNER, "invoke", return_value=container["Id"]), \
                 mock.patch.object(RUNNER, "inspect_resource", side_effect=inspect):
                identity = RUNNER.service_identity("docker", {}, ["compose"], "clickhouse", "prism-e2e-test", "ours", (), False)
            text = evidence.read_text()
        self.assertEqual(identity["container_id"], container["Id"])
        self.assertIn(volume["CreatedAt"], text)
        self.assertIn(volume["Name"], text)
        self.assertNotIn(marker, text)

    def test_diagnostic_failure_does_not_replace_startup_failure(self):
        with mock.patch.object(RUNNER, "inspect_owned", side_effect=RUNNER.FixtureError("owner unknown")), \
             mock.patch.object(RUNNER, "invoke") as invoked:
            RUNNER.diagnose_owned_failure("docker", ["compose"], {}, "prism-e2e-test", "ours", ())
        invoked.assert_not_called()


if __name__ == "__main__":
    unittest.main()
