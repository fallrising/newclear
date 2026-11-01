"""Strict closure proofs for subreaper-v1. Pure validator, no processes."""
import copy
import json
import unittest
from unittest.mock import patch

from agent_workforce.native_stop_proof import StopProofError, validate_closure


def _identity(**overrides):
    identity = {"pid": 4242, "start_ticks": 100, "boot_id": "boot-1"}
    identity.update(overrides)
    return identity


def _trusted(**overrides):
    trusted = {
        "operation_id": "op-1",
        "request_digest": "ab" * 32,
        "nonce": "cd" * 16,
        "helper_identity": _identity(),
    }
    trusted.update(overrides)
    return trusted


def _proof(**overrides):
    proof = {
        "protocol": "subreaper-v1",
        "operation_id": "op-1",
        "request_digest": "ab" * 32,
        "nonce": "cd" * 16,
        "helper_identity": _identity(),
        "admitted": True,
        "fork_gate_closed": True,
        "wait_echild": True,
        "leader_exit_code": 0,
        "reason": "exited",
        "effects_resolved": False,
    }
    proof.update(overrides)
    return proof


def _validate(proof=None, **trusted_overrides):
    if proof is None:
        proof = _proof()
    return validate_closure(proof, **_trusted(**trusted_overrides))


class NativeStopProofTests(unittest.TestCase):
    def test_stop_proof_error_is_a_value_error(self):
        self.assertTrue(issubclass(StopProofError, ValueError))

    def test_accepts_exited_timeout_and_cancelled_closures(self):
        expected_keys = {
            "protocol",
            "operation_id",
            "request_digest",
            "nonce",
            "helper_identity",
            "admitted",
            "fork_gate_closed",
            "wait_echild",
            "leader_exit_code",
            "reason",
            "effects_resolved",
        }
        for reason, code in (("exited", 0), ("timeout", 124), ("cancelled", -15)):
            got = _validate(_proof(reason=reason, leader_exit_code=code))
            self.assertEqual(set(got), expected_keys)
            self.assertEqual(got["protocol"], "subreaper-v1")
            self.assertEqual(got["reason"], reason)
            self.assertEqual(got["leader_exit_code"], code)
            self.assertIs(got["admitted"], True)
            self.assertIs(got["fork_gate_closed"], True)
            self.assertIs(got["wait_echild"], True)
            self.assertIs(got["effects_resolved"], False)
            self.assertEqual(got["helper_identity"], _identity())

    def test_exit_code_bounds_are_inclusive(self):
        for code in (-255, -1, 0, 1, 255):
            got = _validate(_proof(leader_exit_code=code))
            self.assertEqual(got["leader_exit_code"], code)

    def test_json_round_trip_keeps_literal_flags_and_ints(self):
        proof = json.loads(json.dumps(_proof(leader_exit_code=-255, reason="timeout")))
        got = _validate(proof)
        self.assertEqual(got["leader_exit_code"], -255)
        self.assertEqual(got["reason"], "timeout")
        self.assertIs(got["effects_resolved"], False)

    def test_result_and_identity_are_detached_and_inputs_stay_unchanged(self):
        shared = _identity()
        proof = _proof()
        proof["helper_identity"] = shared
        trusted_identity = shared
        before_proof = copy.deepcopy(proof)
        before_identity = copy.deepcopy(trusted_identity)
        got = validate_closure(proof, **_trusted(helper_identity=trusted_identity))
        self.assertIsNot(got, proof)
        self.assertIsNot(got["helper_identity"], shared)
        self.assertIsNot(got["helper_identity"], proof["helper_identity"])
        got["leader_exit_code"] = 9
        got["helper_identity"]["pid"] = 9
        got["reason"] = "timeout"
        proof["leader_exit_code"] = 4
        proof["helper_identity"]["boot_id"] = "changed"
        trusted_identity["pid"] = 3
        again = validate_closure(before_proof, **_trusted(helper_identity=before_identity))
        self.assertEqual(again["leader_exit_code"], 0)
        self.assertEqual(again["helper_identity"]["pid"], 4242)
        self.assertEqual(again["helper_identity"]["boot_id"], "boot-1")
        self.assertEqual(proof["operation_id"], before_proof["operation_id"])
        self.assertEqual(set(before_proof), set(_proof()))

    def test_failed_validation_does_not_mutate_inputs(self):
        proof = _proof(admitted=False)
        trusted = _trusted()
        before_proof = copy.deepcopy(proof)
        before_trusted = copy.deepcopy(trusted)
        with self.assertRaises(StopProofError):
            validate_closure(proof, **trusted)
        self.assertEqual(proof, before_proof)
        self.assertEqual(trusted, before_trusted)

    def test_validator_performs_no_io(self):
        def boom(*_args, **_kwargs):
            raise AssertionError("validator performed I/O")

        with patch("builtins.open", boom), patch("os.open", boom), patch("os.read", boom), patch("os.write", boom):
            got = _validate()
        self.assertEqual(got["operation_id"], "op-1")

    def test_keyword_only_trusted_fields(self):
        proof = _proof()
        trusted = _trusted()
        with self.assertRaises(TypeError):
            validate_closure(
                proof,
                trusted["operation_id"],
                trusted["request_digest"],
                trusted["nonce"],
                trusted["helper_identity"],
            )

    def test_rejects_non_object_proofs(self):
        trusted = _trusted()
        for proof in (None, [], "closure", 0, True, b"{}", 1.0):
            with self.assertRaises(StopProofError):
                validate_closure(proof, **trusted)

    def test_rejects_missing_and_extra_fields(self):
        missing = _proof()
        del missing["wait_echild"]
        extra = _proof(origin="spoofed-file")
        nested_extra = _proof()
        nested_extra["helper_identity"] = _identity(extra={"nested": True})
        for proof in (missing, extra, nested_extra, {}):
            with self.assertRaises(StopProofError):
                _validate(proof)

    def test_rejects_mismatched_trusted_binding(self):
        cases = (
            _proof(operation_id="op-2"),
            _proof(request_digest="ef" * 32),
            _proof(nonce="01" * 16),
            _proof(helper_identity=_identity(pid=4243)),
            _proof(helper_identity=_identity(start_ticks=101)),
            _proof(helper_identity=_identity(boot_id="boot-2")),
        )
        for proof in cases:
            with self.assertRaises(StopProofError):
                _validate(proof)

    def test_rejects_spoofed_flags_reason_and_protocol(self):
        cases = (
            _proof(protocol="subreaper-v2"),
            _proof(protocol="Subreaper-v1"),
            _proof(admitted=False),
            _proof(admitted=1),
            _proof(fork_gate_closed=False),
            _proof(fork_gate_closed=1),
            _proof(wait_echild=False),
            _proof(wait_echild=1),
            _proof(effects_resolved=True),
            _proof(effects_resolved=0),
            _proof(effects_resolved=None),
            _proof(reason="canceled"),
            _proof(reason="killed"),
            _proof(reason="unknown"),
            _proof(reason="fault"),
            _proof(reason=""),
            _proof(reason=None),
        )
        for proof in cases:
            with self.assertRaises(StopProofError):
                _validate(proof)

    def test_bool_never_passes_as_integer(self):
        cases = (
            _proof(leader_exit_code=True),
            _proof(leader_exit_code=False),
            _proof(helper_identity=_identity(pid=True)),
            _proof(helper_identity=_identity(start_ticks=True)),
            _proof(helper_identity=_identity(start_ticks=False)),
        )
        for proof in cases:
            trusted = _trusted()
            if type(proof["helper_identity"]) is dict:
                trusted["helper_identity"] = copy.deepcopy(proof["helper_identity"])
            with self.assertRaises(StopProofError):
                validate_closure(proof, **trusted)

    def test_rejects_nonfinite_and_non_integer_numbers(self):
        cases = (
            _proof(leader_exit_code=float("nan")),
            _proof(leader_exit_code=float("inf")),
            _proof(leader_exit_code=float("-inf")),
            _proof(leader_exit_code=0.0),
            _proof(leader_exit_code=1.5),
            _proof(leader_exit_code=-256),
            _proof(leader_exit_code=256),
            _proof(helper_identity=_identity(pid=0)),
            _proof(helper_identity=_identity(pid=-1)),
            _proof(helper_identity=_identity(start_ticks=-1)),
            _proof(helper_identity=_identity(pid=1.0)),
            _proof(helper_identity=_identity(start_ticks=float("nan"))),
        )
        for proof in cases:
            trusted = _trusted()
            trusted["helper_identity"] = copy.deepcopy(proof["helper_identity"])
            with self.assertRaises(StopProofError):
                validate_closure(proof, **trusted)

    def test_rejects_malformed_identity_and_nested_values(self):
        cases = (
            _proof(helper_identity=["4242", 100, "boot-1"]),
            _proof(helper_identity=_identity(boot_id="")),
            _proof(helper_identity=_identity(boot_id="x" * 129)),
            _proof(helper_identity=_identity(boot_id=None)),
            _proof(helper_identity=_identity(pid="4242")),
            _proof(helper_identity={"pid": 4242, "start_ticks": 100}),
            _proof(helper_identity=_identity(boot_id={"id": "boot-1"})),
        )
        for proof in cases:
            trusted = _trusted()
            if type(proof["helper_identity"]) is dict:
                trusted["helper_identity"] = copy.deepcopy(proof["helper_identity"])
            with self.assertRaises(StopProofError):
                validate_closure(proof, **trusted)

    def test_accepts_boot_id_at_128_and_rejects_unpaired_shape(self):
        boot = "b" * 128
        got = _validate(
            _proof(helper_identity=_identity(boot_id=boot)),
            helper_identity=_identity(boot_id=boot),
        )
        self.assertEqual(got["helper_identity"]["boot_id"], boot)
        self.assertEqual(len(got["helper_identity"]["boot_id"]), 128)

    def test_operation_id_utf8_bound_and_journal_shape(self):
        long_id = "a" * 256
        got = _validate(_proof(operation_id=long_id), operation_id=long_id)
        self.assertEqual(got["operation_id"], long_id)
        multibyte = "é" * 128
        self.assertEqual(len(multibyte.encode("utf-8")), 256)
        got = _validate(_proof(operation_id=multibyte), operation_id=multibyte)
        self.assertEqual(got["operation_id"], multibyte)
        for operation_id in ("a" * 257, "é" * 129, "", "op\0id", "\ud800"):
            with self.assertRaises(StopProofError):
                _validate(_proof(operation_id=operation_id), operation_id=operation_id)

    def test_digest_and_nonce_must_be_exact_lowercase_hex(self):
        digest = "ab" * 32
        nonce = "cd" * 16
        got = _validate()
        self.assertEqual(got["request_digest"], digest)
        self.assertEqual(got["nonce"], nonce)
        malformed = (
            (_proof(request_digest="AB" * 32), _trusted(request_digest="AB" * 32)),
            (_proof(request_digest="ab" * 31), _trusted(request_digest="ab" * 31)),
            (_proof(request_digest="ab" * 32 + "a"), _trusted(request_digest="ab" * 32 + "a")),
            (_proof(request_digest="gg" * 32), _trusted(request_digest="gg" * 32)),
            (_proof(nonce="CD" * 16), _trusted(nonce="CD" * 16)),
            (_proof(nonce="cd" * 15), _trusted(nonce="cd" * 15)),
            (_proof(nonce="cd" * 16 + "e"), _trusted(nonce="cd" * 16 + "e")),
            (_proof(nonce="zz" * 16), _trusted(nonce="zz" * 16)),
            (_proof(request_digest=None), _trusted(request_digest=None)),
            (_proof(nonce=0xCD), _trusted(nonce=0xCD)),
        )
        for proof, trusted in malformed:
            with self.assertRaises(StopProofError):
                validate_closure(proof, **trusted)

    def test_start_ticks_zero_and_positive_pid_are_accepted(self):
        identity = _identity(pid=1, start_ticks=0)
        got = _validate(_proof(helper_identity=identity), helper_identity=copy.deepcopy(identity))
        self.assertEqual(got["helper_identity"], {"pid": 1, "start_ticks": 0, "boot_id": "boot-1"})

    def test_same_shape_spoof_of_trusted_identity_still_must_match_proof(self):
        with self.assertRaises(StopProofError):
            validate_closure(
                _proof(),
                **_trusted(helper_identity=_identity(pid=7)),
            )

    def test_helper_fault_without_echild_or_admission_is_not_closure(self):
        for proof in (
            _proof(admitted=False, reason="exited"),
            _proof(wait_echild=False, reason="cancelled"),
            _proof(fork_gate_closed=False, reason="timeout"),
        ):
            with self.assertRaises(StopProofError):
                _validate(proof)

    def test_dict_and_str_subclasses_are_rejected(self):
        class Proof(dict):
            pass

        class Name(str):
            pass

        class Identity(dict):
            pass

        proof = Proof(_proof())
        with self.assertRaises(StopProofError):
            _validate(proof)
        named = _proof(operation_id=Name("op-1"))
        with self.assertRaises(StopProofError):
            _validate(named, operation_id=Name("op-1"))
        identity = Identity(_identity())
        with self.assertRaises(StopProofError):
            _validate(_proof(helper_identity=identity), helper_identity=Identity(_identity()))
