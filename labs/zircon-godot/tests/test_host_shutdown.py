"""Exercise upstream Program.cs in a real .NET process, with a fake world.

Requires ZIRCON_SOURCE, DOTNET and the common workspace launcher. These tests
prove host shutdown sequencing, never real MirDB persistence or gameplay.
"""
import os
from pathlib import Path
import selectors
import signal
import subprocess
import unittest
from xml.sax.saxutils import escape


class HostShutdownTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dotnet = os.environ["DOTNET"]
        source = Path(os.environ["ZIRCON_SOURCE"]) / "ServerCore/Program.cs"
        build = Path(os.environ["AGENT_BUILD_DIR"]) / "host-tests"
        build.mkdir(parents=True, exist_ok=True)
        fixture = Path(__file__).with_name("host_fixture.cs")
        project = build / "HostTests.csproj"
        project.write_text(f'''<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework>
  <EnableDefaultCompileItems>false</EnableDefaultCompileItems></PropertyGroup>
  <ItemGroup><Compile Include="{escape(str(source), {'"': '&quot;'})}" />
  <Compile Include="{escape(str(fixture), {'"': '&quot;'})}" /></ItemGroup>
</Project>''')
        cls.env = dict(os.environ, DOTNET_CLI_HOME=str(build / "cli"),
                       DOTNET_CLI_TELEMETRY_OPTOUT="1", MSBUILDDISABLENODEREUSE="1")
        result = subprocess.run([cls.dotnet, "build", str(project), "-v:q",
                                 "-p:UseSharedCompilation=false", "-nodeReuse:false"],
                                env=cls.env, capture_output=True, text=True, timeout=90)
        Path(os.environ["AGENT_EVIDENCE_DIR"], "host-build.log").write_text(
            result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        cls.dll = build / "bin/Debug/net10.0/HostTests.dll"

    def run_host(self, self_stop=False):
        process = subprocess.Popen([self.dotnet, str(self.dll)],
                                   env=dict(self.env, HOST_SELF_STOP=str(int(self_stop))),
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        output = b""
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                self.assertTrue(selector.select(5), "host never became ready")
                output += os.read(process.stdout.fileno(), 4096)
            self.assertIn(b"READY", output)
            if not self_stop:
                process.send_signal(signal.SIGINT)
            # Keep stdin OPEN: shutdown must not wait for a newline or EOF.
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.fail("host hung after world stop with stdin open")
            output += process.stdout.read()
            self.assertEqual(process.returncode, 0, output.decode())
            self.assertIn(b"WORLD_SAVED\nCONFIG_SAVED", output)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            process.stdin.close()
            process.stdout.close()

    def test_ctrl_c_waits_for_world_and_config_save(self):
        self.run_host()

    def test_internal_stop_does_not_wait_for_console_input(self):
        self.run_host(self_stop=True)


if __name__ == "__main__":
    unittest.main()
