import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCTOR = ROOT / "scripts" / "document-ingestion-doctor.sh"


class DocumentIngestionDoctorTests(unittest.TestCase):
    def command(self, directory, name, body):
        path = Path(directory) / name
        path.write_text("#!/bin/sh\n" + body)
        path.chmod(path.stat().st_mode | stat.S_IXUSR)
        return str(path)

    def base(self, directory):
        env = {"PATH": "/usr/bin:/bin", "DOCTOR_CPU_COUNT": "6",
               "DOCTOR_AVAILABLE_MEMORY_BYTES": str(16 * 1024**3),
               "DOCTOR_FREE_DISK_BYTES": str(147 * 1024**3)}
        env["DOCTOR_UNAME_CMD"] = self.command(directory, "uname", "[ \"$1\" = -s ] && printf 'Linux\\n' || printf 'x86_64\\n'")
        env["DOCTOR_DOCKER_CMD"] = self.command(directory, "docker", "printf 'Cgroup Version: 2\\nSecurity Options: name=apparmor name=seccomp,profile=builtin name=cgroupns\\n'")
        for key, name in (("DOCTOR_PDFINFO_CMD", "pdfinfo"), ("DOCTOR_PDFTOTEXT_CMD", "pdftotext"),
                          ("DOCTOR_PDFTOPPM_CMD", "pdftoppm")):
            env[key] = self.command(directory, name, "exit 0")
        env["DOCTOR_TESSERACT_CMD"] = self.command(directory, "tesseract", "[ \"$1\" = --list-langs ] && printf 'eng\\nchi_tra\\n' || exit 0")
        env["DOCTOR_PYTHON_CMD"] = self.command(directory, "python", "case \"$2\" in *sys.version_info*) printf '3.11\\n';; *) exit 1;; esac")
        return env

    def invoke(self, env):
        result = subprocess.run([str(DOCTOR), "--json"], cwd=ROOT, env=env,
                                text=True, capture_output=True)
        return result, json.loads(result.stdout)

    def test_host_capable_floor_and_docker_security(self):
        with tempfile.TemporaryDirectory() as directory:
            result, data = self.invoke(self.base(directory))
            self.assertEqual(result.returncode, 1)
            self.assertEqual(data["classification"], "host-capable")
            self.assertEqual(data["host"]["cpus"], 6)
            self.assertFalse(data["gpu"]["available"])

    def test_runtime_ready_requires_tools_languages_and_python_packages(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.base(directory)
            env["DOCTOR_PYTHON_CMD"] = self.command(directory, "python", "printf '3.11\\n'")
            result, data = self.invoke(env)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(data["classification"], "runtime-ready")

    def test_malformed_numeric_observation_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.base(directory)
            env["DOCTOR_AVAILABLE_MEMORY_BYTES"] = "16 GiB"
            result, data = self.invoke(env)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(data["classification"], "unsupported")
            self.assertIsNone(data["host"]["available_memory_bytes"])

    def test_meminfo_fixture_is_converted_to_exact_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.base(directory)
            env.pop("DOCTOR_AVAILABLE_MEMORY_BYTES")
            memory = Path(directory) / "meminfo"
            memory.write_text("MemTotal:       26214400 kB\nMemAvailable:   16777216 kB\n")
            env["DOCTOR_MEMORY_FILE"] = str(memory)
            result, data = self.invoke(env)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(data["host"]["available_memory_bytes"], 16 * 1024**3)

    def test_docker_failure_with_stdout_is_not_reachable(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.base(directory)
            env["DOCTOR_DOCKER_CMD"] = self.command(directory, "docker", "printf 'Client: details\\n'; exit 1")
            result, data = self.invoke(env)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(data["docker"]["reachable"])

    def test_security_features_are_independent(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.base(directory)
            env["DOCTOR_DOCKER_CMD"] = self.command(directory, "docker", "printf 'Cgroup Version: 2\\nSecurity Options: name=seccomp,profile=builtin name=cgroupns\\n'")
            result, data = self.invoke(env)
            self.assertEqual(result.returncode, 2)
            self.assertTrue(data["docker"]["security_features"]["cgroups"])
            self.assertTrue(data["docker"]["security_features"]["seccomp"])
            self.assertFalse(data["docker"]["security_features"]["apparmor"])

    def test_configured_ocr_languages_are_reported_and_required(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.base(directory)
            env["DOCTOR_OCR_LANGUAGES"] = "eng,chi_tra"
            result, data = self.invoke(env)
            self.assertTrue(data["ocr"]["languages_available"])
            self.assertEqual(data["ocr"]["required_languages"], ["eng", "chi_tra"])
            self.assertEqual(data["ocr"]["observed_languages"], ["eng", "chi_tra"])
            env["DOCTOR_TESSERACT_CMD"] = self.command(directory, "tesseract-missing-lang", "[ \"$1\" = --list-langs ] && printf 'eng\\n' || exit 0")
            result, data = self.invoke(env)
            self.assertEqual(result.returncode, 1)
            self.assertFalse(data["ocr"]["languages_available"])

    def test_default_output_and_no_persistent_files(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.base(directory)
            result = subprocess.run([str(DOCTOR)], cwd=directory, env=env,
                                    text=True, capture_output=True)
            self.assertIn("classification:", result.stdout)
            names = {path.name for path in Path(directory).iterdir()}
            self.assertEqual(names, {"uname", "docker", "pdfinfo", "pdftotext", "pdftoppm", "tesseract", "python"})


if __name__ == "__main__":
    unittest.main()
