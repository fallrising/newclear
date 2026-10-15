import copy
from pathlib import Path
import signal
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import crash
import lab


class FakeOwner:
    def __init__(self):
        self.identity = dict(pid=100, pgid=100, start_ticks=1, state="S")
        self.child = dict(pid=200, pgid=200, start_ticks=2, state="S")
        self.records = {100: self.identity.copy(), 200: self.child.copy()}
        self.observation_error = None
        self.process = unittest.mock.Mock()
        self.process.poll.side_effect = lambda: -9 if 100 not in self.records else None
        self.reader = unittest.mock.Mock()
        self.monitor = unittest.mock.Mock()
        self.reader.is_alive.return_value = self.monitor.is_alive.return_value = False
        self.finish_threads = unittest.mock.Mock()

    def snapshot(self):
        if self.observation_error:
            raise RuntimeError("private observation detail")

    def live(self):
        self.snapshot()
        return [x.copy() for x in self.records.values() if x["state"] != "Z"]

    def observed_identities(self):
        return [dict(pid=100, start_ticks=1), dict(pid=200, start_ticks=2)]

    def read(self, pid):
        return self.records.get(pid)

    def kill(self, pid, sig):
        self.assert_signal = sig
        self.records.pop(pid)


class CrashTests(unittest.TestCase):
    def run_crash(self, owner=None, **kwargs):
        owner = owner or FakeOwner()
        with patch.object(crash.os, "kill", side_effect=kwargs.pop("kill", owner.kill)):
            return crash.abrupt_shutdown(owner, deadline=kwargs.pop("deadline", time.monotonic() + 1),
                                         read_identity=kwargs.pop("read", owner.read))

    def test_daemon_first_unique_frozen_generation_receipts(self):
        owner = FakeOwner()
        calls = []
        def kill(pid, sig):
            calls.append((pid, sig))
            owner.kill(pid, sig)
        result = self.run_crash(owner, kill=kill)
        self.assertEqual(calls, [(100, signal.SIGKILL), (200, signal.SIGKILL)])
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["root_exit_code"], -9)
        self.assertEqual(result["attempted"], 2)
        self.assertTrue(result["all_owned_exited"])
        owner.finish_threads.assert_called_once()

    def test_missing_root_child_unknown_and_target_limit_before_signals(self):
        for mutation in ("root", "child", "unknown", "limit"):
            with self.subTest(mutation=mutation):
                owner = FakeOwner()
                if mutation == "root": owner.records.pop(100)
                if mutation == "child": owner.records.pop(200)
                if mutation == "unknown": owner.observation_error = "private"
                if mutation == "limit":
                    owner.records.update({p: dict(pid=p, pgid=p, start_ticks=p, state="S") for p in range(300, 364)})
                with patch.object(crash.os, "kill") as kill:
                    with self.assertRaises(crash.CrashError) as caught:
                        crash.abrupt_shutdown(owner, deadline=time.monotonic()+1, read_identity=owner.read)
                    self.assertEqual(caught.exception.receipt["status"], "failed")
                    kill.assert_not_called()

    def test_stale_zombie_unreadable_and_disappeared_child_fail(self):
        for condition in ("stale", "zombie", "unreadable", "missing"):
            with self.subTest(condition=condition):
                owner = FakeOwner()
                def kill(pid, sig):
                    owner.kill(pid, sig)
                    if pid == 100:
                        if condition == "stale": owner.records[200]["start_ticks"] = 99
                        if condition == "zombie": owner.records[200]["state"] = "Z"
                        if condition == "missing": owner.records.pop(200)
                def read(pid):
                    if pid == 200 and 100 not in owner.records and condition == "unreadable":
                        raise OSError("private path")
                    return owner.read(pid)
                with self.assertRaises(crash.CrashError) as caught:
                    self.run_crash(owner, kill=kill, read=read)
                self.assertEqual(caught.exception.receipt["signaled"], 1)
                self.assertFalse(caught.exception.receipt["targets"][1]["signal_sent"])

    def test_signal_denial_and_esrch_are_not_success(self):
        for error in (PermissionError("secret"), ProcessLookupError("secret")):
            with self.subTest(error=type(error)):
                with self.assertRaises(crash.CrashError) as caught:
                    self.run_crash(kill=unittest.mock.Mock(side_effect=error))
                self.assertEqual(caught.exception.reason, "signal")
                self.assertEqual(caught.exception.receipt["attempted"], 1)
                self.assertEqual(caught.exception.receipt["signaled"], 0)
                self.assertNotIn("secret", str(caught.exception))

    def test_root_normal_exit_survivor_and_observer_failure(self):
        for condition in ("normal", "survivor", "observer", "unknown_after"):
            with self.subTest(condition=condition):
                owner = FakeOwner()
                if condition == "normal": owner.process.poll.side_effect = lambda: 0
                if condition == "observer": owner.reader.is_alive.return_value = True
                def kill(pid, sig):
                    if condition != "survivor": owner.kill(pid, sig)
                    if condition == "unknown_after" and pid == 200: owner.observation_error = "private"
                with self.assertRaises(crash.CrashError):
                    self.run_crash(owner, kill=kill, deadline=time.monotonic()+.03)

    def test_expired_deadline_refuses_signals(self):
        with patch.object(crash.os, "kill") as kill:
            with self.assertRaises(crash.CrashError) as caught:
                self.run_crash(deadline=time.monotonic()-1)
            self.assertEqual(caught.exception.reason, "deadline")
            kill.assert_not_called()

    def test_retained_history_survivor_cannot_be_hidden_by_target_exits(self):
        owner = FakeOwner()
        original = owner.live
        def live():
            rows = original()
            if not rows: return [dict(pid=300, start_ticks=3, pgid=300, state="S")]
            return rows
        owner.live = live
        with self.assertRaises(crash.CrashError) as caught:
            self.run_crash(owner, deadline=time.monotonic()+.03)
        self.assertFalse(caught.exception.receipt["all_owned_exited"])

    def test_initial_and_success_are_deep_copied(self):
        first = crash.initial_crash()
        first["limits"]["max_targets"] = 0
        self.assertEqual(crash.initial_crash()["limits"]["max_targets"], 64)
        result = self.run_crash()
        projected = crash.project_crash(result)
        result["targets"][0]["pid"] = 0
        self.assertEqual(projected["targets"][0]["pid"], 100)

    def test_strict_projection_rejects_injection_numbers_order_and_forgery(self):
        valid = self.run_crash()
        changes = [lambda x: x.update(private="token"), lambda x: x.update(attempted=True),
                   lambda x: x.update(elapsed_seconds=float("nan")),
                   lambda x: x.update(elapsed_seconds=11), lambda x: x.update(root_exit_code=0),
                   lambda x: x["targets"][0].update(signal_sent=False),
                   lambda x: x["targets"][1].update(pid=100),
                   lambda x: x["targets"][1].update(exit_observed=False),
                   lambda x: x["limitations"].update(power_loss_tested=True)]
        for change in changes:
            with self.subTest(change=change):
                candidate=copy.deepcopy(valid); change(candidate)
                with self.assertRaises(crash.CrashError): crash.project_crash(candidate)
        failed=copy.deepcopy(valid); failed.update(status="failed", reason=None)
        with self.assertRaises(crash.CrashError): crash.project_crash(failed)
        failed.update(reason="signal", attempted=2, signaled=1)
        failed["targets"][0]["signal_sent"]=False
        with self.assertRaises(crash.CrashError): crash.project_crash(failed)

    def test_truthful_failed_overdeadline_unsignaled_exit_allowed(self):
        value=crash.initial_crash()
        value.update(status="failed", reason="deadline", elapsed_seconds=11,
                     targets=[dict(pid=100, pgid=100, start_ticks=1, signal_sent=False, exit_observed=True)],
                     all_owned_exited=True)
        self.assertEqual(crash.project_crash(value), value)

    def test_error_receipt_cannot_carry_unvalidated_private_data(self):
        error=crash.CrashError("signal", {"private": "token"})
        self.assertNotIn("private", error.receipt)
        self.assertEqual(error.receipt["status"], "failed")
        crash.project_crash(error.receipt)

    def test_huge_numeric_duration_rejects_as_fixed_schema_error(self):
        value=crash.initial_crash()
        value.update(status="failed", reason="deadline", elapsed_seconds=10**1000)
        with self.assertRaises(crash.CrashError): crash.project_crash(value)

    def test_unrelated_live_generation_never_gets_signaled(self):
        owner=FakeOwner()
        owner.records[300]=dict(pid=300, pgid=300, start_ticks=3, state="S")
        with patch.object(crash.os, "kill") as kill:
            with self.assertRaises(crash.CrashError):
                crash.abrupt_shutdown(owner, deadline=time.monotonic()+1, read_identity=owner.read)
            kill.assert_not_called()

    def test_wrong_frozen_root_cannot_be_signaled(self):
        owner=FakeOwner()
        owner.identity=dict(pid=900, pgid=900, start_ticks=9, state="S")
        with patch.object(crash.os, "kill") as kill:
            with self.assertRaises(crash.CrashError):
                crash.abrupt_shutdown(owner, deadline=time.monotonic()+1, read_identity=owner.read)
            kill.assert_not_called()

    def test_exact_target_limit_and_deterministic_child_order(self):
        owner=FakeOwner()
        owner.records.update({p:dict(pid=p,pgid=p,start_ticks=p,state="S") for p in range(300,362)})
        authorized=[dict(pid=x["pid"],start_ticks=x["start_ticks"]) for x in owner.records.values()]
        owner.observed_identities=lambda: authorized
        original=owner.live
        owner.live=lambda: list(reversed(original()))
        result=self.run_crash(owner)
        self.assertEqual(len(result["targets"]),64)
        self.assertEqual([x["pid"] for x in result["targets"]],[100,200]+list(range(300,362)))

    def test_slow_identity_read_cannot_signal_after_deadline(self):
        owner=FakeOwner()
        def read(pid):
            time.sleep(.02)
            return owner.read(pid)
        with patch.object(crash.os,"kill") as kill:
            with self.assertRaises(crash.CrashError) as caught:
                crash.abrupt_shutdown(owner,deadline=time.monotonic()+.01,read_identity=read)
            self.assertEqual(caught.exception.reason,"deadline")
            kill.assert_not_called()

    def test_observer_closure_error_cannot_forge_verified_receipt(self):
        owner=FakeOwner()
        def close(): owner.observation_error="private reader fault"
        owner.finish_threads.side_effect=close
        with self.assertRaises(crash.CrashError) as caught: self.run_crash(owner)
        self.assertEqual(caught.exception.reason,"observer")
        self.assertFalse(caught.exception.receipt["observers_closed"])

    def test_actual_nested_alarm_failure_starts_no_new_io_and_records_final_elapsed(self):
        owner=FakeOwner()
        reads=[]
        def slow(pid):
            reads.append(pid)
            time.sleep(.08)
            return owner.read(pid)
        started=time.monotonic()
        with patch.object(crash.os,"kill") as kill:
            with self.assertRaises(crash.CrashError) as caught:
                with lab.m3_deadline(.3,"outer regression"):
                    with lab.m3_deadline(.03,"inner regression"):
                        crash.abrupt_shutdown(owner,deadline=started+.03,read_identity=slow)
            elapsed=time.monotonic()-started
            kill.assert_not_called()
        self.assertEqual(reads,[100])
        owner.process.poll.assert_not_called()
        receipt=caught.exception.receipt
        self.assertEqual(caught.exception.reason,"deadline")
        self.assertFalse(receipt["all_owned_exited"])
        self.assertLess(abs(elapsed-receipt["elapsed_seconds"]),.01)
        self.assertLess(elapsed,.12)

    def test_actual_alarm_preserves_only_cached_partial_exit_observations(self):
        owner=FakeOwner()
        reads=[]
        def read(pid):
            reads.append(pid)
            if not owner.records and pid==200: time.sleep(.08)
            return owner.read(pid)
        started=time.monotonic()
        with self.assertRaises(crash.CrashError) as caught:
            with lab.m3_deadline(.3,"outer partial"):
                with lab.m3_deadline(.03,"inner partial"):
                    self.run_crash(owner,deadline=started+.03,read=read)
        self.assertEqual(reads,[100,200,100,200])
        receipt=caught.exception.receipt
        self.assertEqual(receipt["root_exit_code"],-9)
        self.assertEqual(receipt["signaled"],2)
        self.assertTrue(receipt["targets"][0]["exit_observed"])
        self.assertFalse(receipt["targets"][1]["exit_observed"])
        self.assertFalse(receipt["all_owned_exited"])
        self.assertEqual(caught.exception.reason,"deadline")

    def test_nonlive_proc_after_first_pending_poll_waits_for_root_reap(self):
        owner=FakeOwner()
        owner.process.poll.side_effect=[None,-9]
        receipt=self.run_crash(owner)
        self.assertEqual(owner.process.poll.call_count,2)
        self.assertEqual(receipt["status"],"verified")
        self.assertEqual(receipt["root_exit_code"],-9)
        self.assertTrue(receipt["all_owned_exited"])

    def test_nonlive_proc_with_never_reaped_root_is_bounded_failure(self):
        owner=FakeOwner()
        owner.process.poll.side_effect=lambda:None
        with self.assertRaises(crash.CrashError) as caught:
            self.run_crash(owner,deadline=time.monotonic()+.03)
        self.assertEqual(caught.exception.reason,"deadline")
        self.assertGreater(owner.process.poll.call_count,1)
        self.assertIsNone(caught.exception.receipt["root_exit_code"])
        owner.finish_threads.assert_not_called()

    def test_delayed_normal_root_reap_still_fails(self):
        owner=FakeOwner()
        owner.process.poll.side_effect=[None,0]
        with self.assertRaises(crash.CrashError) as caught:self.run_crash(owner)
        self.assertEqual(owner.process.poll.call_count,2)
        self.assertEqual(caught.exception.reason,"identity")
        self.assertEqual(caught.exception.receipt["root_exit_code"],0)

    def test_readback_exact_types_bounds_and_complete_controls(self):
        value=crash.initial_readback()
        with self.assertRaises(crash.CrashError): crash.project_readback(value, complete=True)
        for key in value:
            if key != "read_requests": value[key]=True
        value["read_requests"]=6
        self.assertEqual(crash.project_readback(value, complete=True), value)
        for change in (lambda x:x.update(read_requests=True), lambda x:x.update(read_requests=257),
                       lambda x:x.update(private="secret"), lambda x:x.update(d1_row_unchanged=1)):
            candidate=value.copy(); change(candidate)
            with self.assertRaises(crash.CrashError): crash.project_readback(candidate)

    def test_actual_separate_group_parent_child_abrupt_exit(self):
        code=("import subprocess,sys,time\n"
              "p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'],start_new_session=True)\n"
              "print('ready',flush=True)\n"
              "time.sleep(20)\n")
        owner=lab.Process([sys.executable,"-c",code])
        try:
            deadline=time.monotonic()+3
            while (not owner.children() or "ready" not in owner.text()) and time.monotonic()<deadline:
                time.sleep(.01)
            self.assertTrue(owner.children())
            self.assertNotEqual(owner.children()[0]["pgid"], owner.identity["pgid"])
            result=crash.abrupt_shutdown(owner, deadline=time.monotonic()+5, read_identity=lab.process_info)
            self.assertEqual(result["status"],"verified")
            self.assertEqual(result["root_exit_code"],-9)
            self.assertTrue(all(x["signal_sent"] and x["exit_observed"] for x in result["targets"]))
        finally:
            if owner.live(strict=False): owner.stop(grace=.1)
            else: owner.finish_threads()


if __name__ == "__main__":
    unittest.main()
