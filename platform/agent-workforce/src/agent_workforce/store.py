"""Durable records, inbox/outbox, command identity, and usage."""
import hashlib
import json
from urllib.parse import quote

from .runtime_store import RuntimeStore
from .storage_base import (
    ConflictError,
    StaleFenceError,
    StorageBase,
    StoreError,
    finite_time,
    positive_int,
    text_value,
)

_ENVELOPE_REQUIRED = {"message_id", "sender", "recipients", "body", "expires_at"}
_ENVELOPE_OPTIONAL = {"job_id", "kind", "reply_to"}


def _digest_text(encoded):
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class Store(RuntimeStore, StorageBase):
    """Records, inbox, outbox, commands, and usage on the shared SQLite boundary."""

    def put_record(self, kind, key, record):
        kind = text_value(kind)
        key = text_value(key)
        if type(record) is not dict or "revision" not in record:
            raise StoreError("versioned record required")
        revision = positive_int(record["revision"])
        encoded = self._json(record)
        with self.transaction():
            row = self._db.execute(
                "SELECT revision, payload FROM records WHERE kind=? AND key=?",
                (kind, key),
            ).fetchone()
            if row is not None and row["payload"] == encoded:
                return json.loads(row["payload"])
            if row is not None and revision <= row["revision"]:
                raise ConflictError("record revision conflict")
            if row is None:
                self._db.execute(
                    "INSERT INTO records(kind, key, revision, payload) VALUES(?,?,?,?)",
                    (kind, key, revision, encoded),
                )
            else:
                self._db.execute(
                    "UPDATE records SET revision=?, payload=? WHERE kind=? AND key=?",
                    (revision, encoded, kind, key),
                )
            self._audit("record.put", {"kind": kind, "key": key, "revision": revision})
        return json.loads(encoded)

    def get_record(self, kind, key):
        kind = text_value(kind)
        key = text_value(key)
        with self._lock:
            self._require_open()
            row = self._db.execute(
                "SELECT payload FROM records WHERE kind=? AND key=?",
                (kind, key),
            ).fetchone()
        if row is None:
            return None
        return json.loads(row["payload"])

    def records(self, kind):
        kind = text_value(kind)
        with self._lock:
            self._require_open()
            rows = self._db.execute(
                "SELECT key, payload FROM records WHERE kind=? ORDER BY key",
                (kind,),
            ).fetchall()
        return {row["key"]: json.loads(row["payload"]) for row in rows}

    def receive_message(self, authenticated_sender, envelope, recipient):
        sender, message_id, recipient, encoded = self._validated_envelope(
            authenticated_sender, envelope, recipient
        )
        payload_digest = _digest_text(encoded)
        receipt_id = "receipt:" + _digest_text(self._json({
            "message_id": message_id,
            "recipient": recipient,
            "sender": sender,
        }))
        with self.transaction():
            row = self._db.execute(
                """SELECT receipt_id, sender, message_id, recipient, payload_digest
                   FROM inbox WHERE sender=? AND message_id=? AND recipient=?""",
                (sender, message_id, recipient),
            ).fetchone()
            if row is not None:
                if row["payload_digest"] != payload_digest:
                    raise ConflictError("inbox digest conflict")
                return self._receipt(row)
            self._db.execute(
                """INSERT INTO inbox(receipt_id, sender, message_id, recipient, payload_digest, envelope)
                   VALUES(?,?,?,?,?,?)""",
                (receipt_id, sender, message_id, recipient, payload_digest, encoded),
            )
            self._check_fault("inbox_before_commit")
            self._audit("inbox.receive", {
                "receipt_id": receipt_id,
                "sender": sender,
                "message_id": message_id,
                "recipient": recipient,
                "payload_digest": payload_digest,
            })
        return {
            "receipt_id": receipt_id,
            "state": "stored",
            "sender": sender,
            "message_id": message_id,
            "recipient": recipient,
            "payload_digest": payload_digest,
        }

    def accept_command(self, job_id, step_id, input_payload, *, worker_id, route_policy, grant_id):
        job_id = text_value(job_id)
        step_id = text_value(step_id)
        worker_id = text_value(worker_id)
        grant_id = text_value(grant_id)
        if type(route_policy) is not dict:
            raise StoreError("route policy object required")
        encoded_input = self._json(input_payload)
        encoded_route = self._json(route_policy)
        # Grant renewal is not part of command identity.
        input_digest = _digest_text(self._json({
            "input_payload": input_payload,
            "route_policy": route_policy,
            "worker_id": worker_id,
        }))
        command_id = "cmd:" + _digest_text(self._json({"job_id": job_id, "step_id": step_id}))
        with self.transaction():
            row = self._db.execute(
                """SELECT command_id, job_id, step_id, input_digest, input_payload, worker_id,
                          route_policy, grant_id, state
                   FROM commands WHERE job_id=? AND step_id=?""",
                (job_id, step_id),
            ).fetchone()
            if row is not None:
                if row["input_digest"] != input_digest:
                    raise ConflictError("command identity conflict")
                return self._command_from_row(row)
            self._db.execute(
                """INSERT INTO commands(command_id, job_id, step_id, input_digest, input_payload,
                       worker_id, route_policy, grant_id, state)
                   VALUES(?,?,?,?,?,?,?,?, 'queued')""",
                (command_id, job_id, step_id, input_digest, encoded_input, worker_id, encoded_route, grant_id),
            )
            self._check_fault("command_before_outbox")
            command = {
                "command_id": command_id,
                "job_id": job_id,
                "step_id": step_id,
                "input_digest": input_digest,
                "input_payload": json.loads(encoded_input),
                "worker_id": worker_id,
                "route_policy": json.loads(encoded_route),
                "grant_id": grant_id,
                "state": "queued",
            }
            self._insert_outbox(
                "command:" + quote(job_id, safe="") + ":" + quote(step_id, safe=""),
                worker_id,
                worker_id,
                command,
            )
            self._audit("command.accept", {
                "command_id": command_id,
                "job_id": job_id,
                "step_id": step_id,
                "input_digest": input_digest,
            })
        return command

    def command(self, command_id):
        command_id = text_value(command_id)
        with self._lock:
            self._require_open()
            row = self._db.execute(
                """SELECT command_id, job_id, step_id, input_digest, input_payload, worker_id,
                          route_policy, grant_id, state
                   FROM commands WHERE command_id=?""",
                (command_id,),
            ).fetchone()
        if row is None:
            return None
        return self._command_from_row(row)

    def commands(self):
        with self._lock:
            self._require_open()
            rows = self._db.execute(
                """SELECT command_id, job_id, step_id, input_digest, input_payload, worker_id,
                          route_policy, grant_id, state
                   FROM commands ORDER BY rowid"""
            ).fetchall()
        return [self._command_from_row(row) for row in rows]

    def usage(self, job_id):
        job_id = text_value(job_id)
        with self._lock:
            self._require_open()
            messages = self._db.execute(
                "SELECT COUNT(*) FROM commands WHERE job_id=?",
                (job_id,),
            ).fetchone()[0]
            turns = self._db.execute(
                """SELECT COUNT(*) FROM attempts
                   INNER JOIN commands ON commands.command_id = attempts.command_id
                   WHERE commands.job_id=?""",
                (job_id,),
            ).fetchone()[0]
        return {
            "turns": turns,
            "messages": messages,
            "provider_tokens": None,
            "provider_cost": None,
        }

    def enqueue_outbox(self, message_id, sender, recipient, payload):
        message_id = text_value(message_id)
        sender = text_value(sender)
        recipient = text_value(recipient)
        encoded = self._json(payload)
        with self.transaction():
            existing = self._outbox_identity(message_id, sender, recipient)
            if existing is not None:
                if existing["payload_digest"] != _digest_text(encoded):
                    raise ConflictError("outbox payload conflict")
                return self._outbox_from_row(existing)
            self._insert_outbox(message_id, sender, recipient, payload, encoded=encoded)
            self._check_fault("outbox_before_commit")
            outbox_id = self._outbox_id(message_id, sender, recipient)
            self._audit("outbox.enqueue", {
                "outbox_id": outbox_id,
                "message_id": message_id,
                "sender": sender,
                "recipient": recipient,
                "payload_digest": _digest_text(encoded),
            })
            row = self._outbox_by_id(outbox_id)
        return self._outbox_from_row(row)

    def pending_outbox(self):
        with self._lock:
            self._require_open()
            rows = self._db.execute(
                """SELECT outbox_id, message_id, sender, recipient, payload_digest, payload, receipt_id
                   FROM outbox WHERE receipt_id IS NULL ORDER BY rowid"""
            ).fetchall()
        return [self._outbox_from_row(row) for row in rows]

    def ack_outbox(self, outbox_id, receipt_id):
        outbox_id = text_value(outbox_id)
        receipt_id = text_value(receipt_id)
        with self.transaction():
            row = self._outbox_by_id(outbox_id)
            if row is None:
                raise StoreError("unknown outbox")
            if row["receipt_id"] is None:
                self._db.execute(
                    "UPDATE outbox SET receipt_id=? WHERE outbox_id=?",
                    (receipt_id, outbox_id),
                )
                self._audit("outbox.ack", {"outbox_id": outbox_id, "receipt_id": receipt_id})
                row = self._outbox_by_id(outbox_id)
            elif row["receipt_id"] != receipt_id:
                raise ConflictError("outbox acknowledgement conflict")
        return self._outbox_from_row(row)

    def inbox_rows(self):
        with self._lock:
            self._require_open()
            rows = self._db.execute(
                """SELECT receipt_id, sender, message_id, recipient, payload_digest, envelope
                   FROM inbox ORDER BY rowid"""
            ).fetchall()
        result = []
        for row in rows:
            result.append({
                "receipt_id": row["receipt_id"],
                "sender": row["sender"],
                "message_id": row["message_id"],
                "recipient": row["recipient"],
                "payload_digest": row["payload_digest"],
                "state": "stored",
                "envelope": json.loads(row["envelope"]),
            })
        return result

    def outbox_rows(self):
        with self._lock:
            self._require_open()
            rows = self._db.execute(
                """SELECT outbox_id, message_id, sender, recipient, payload_digest, payload, receipt_id
                   FROM outbox ORDER BY rowid"""
            ).fetchall()
        return [self._outbox_from_row(row) for row in rows]

    def _require_open(self):
        if self._db is None:
            raise StoreError("store is closed")

    def _validated_envelope(self, authenticated_sender, envelope, recipient):
        sender = text_value(authenticated_sender)
        recipient = text_value(recipient)
        if type(envelope) is not dict:
            raise StoreError("envelope object required")
        keys = set(envelope)
        if not _ENVELOPE_REQUIRED.issubset(keys) or not keys.issubset(_ENVELOPE_REQUIRED | _ENVELOPE_OPTIONAL):
            raise StoreError("invalid envelope")
        message_id = text_value(envelope["message_id"])
        if text_value(envelope["sender"]) != sender:
            raise StoreError("authenticated sender mismatch")
        recipients = envelope["recipients"]
        if type(recipients) is not list or not recipients:
            raise StoreError("recipients required")
        seen = []
        for item in recipients:
            value = text_value(item)
            if value in seen:
                raise StoreError("duplicate recipient")
            seen.append(value)
        if recipient not in seen:
            raise StoreError("recipient is not addressed")
        finite_time(envelope["expires_at"])
        for name in ("job_id", "kind", "reply_to"):
            if name in envelope:
                text_value(envelope[name])
        return sender, message_id, recipient, self._json(envelope)

    def _receipt(self, row):
        return {
            "receipt_id": row["receipt_id"],
            "state": "stored",
            "sender": row["sender"],
            "message_id": row["message_id"],
            "recipient": row["recipient"],
            "payload_digest": row["payload_digest"],
        }

    def _command_from_row(self, row):
        return {
            "command_id": row["command_id"],
            "job_id": row["job_id"],
            "step_id": row["step_id"],
            "input_digest": row["input_digest"],
            "input_payload": json.loads(row["input_payload"]),
            "worker_id": row["worker_id"],
            "route_policy": json.loads(row["route_policy"]),
            "grant_id": row["grant_id"],
            "state": row["state"],
        }

    def _outbox_id(self, message_id, sender, recipient):
        return "out:" + _digest_text(self._json({
            "message_id": message_id,
            "recipient": recipient,
            "sender": sender,
        }))

    def _insert_outbox(self, message_id, sender, recipient, payload, encoded=None):
        if encoded is None:
            encoded = self._json(payload)
        self._db.execute(
            """INSERT INTO outbox(outbox_id, message_id, sender, recipient, payload_digest, payload, receipt_id)
               VALUES(?,?,?,?,?,?,NULL)""",
            (
                self._outbox_id(message_id, sender, recipient),
                message_id,
                sender,
                recipient,
                _digest_text(encoded),
                encoded,
            ),
        )

    def _outbox_identity(self, message_id, sender, recipient):
        return self._db.execute(
            """SELECT outbox_id, message_id, sender, recipient, payload_digest, payload, receipt_id
               FROM outbox WHERE sender=? AND message_id=? AND recipient=?""",
            (sender, message_id, recipient),
        ).fetchone()

    def _outbox_by_id(self, outbox_id):
        return self._db.execute(
            """SELECT outbox_id, message_id, sender, recipient, payload_digest, payload, receipt_id
               FROM outbox WHERE outbox_id=?""",
            (outbox_id,),
        ).fetchone()

    def _outbox_from_row(self, row):
        return {
            "outbox_id": row["outbox_id"],
            "message_id": row["message_id"],
            "sender": row["sender"],
            "recipient": row["recipient"],
            "payload_digest": row["payload_digest"],
            "payload": json.loads(row["payload"]),
            "receipt_id": row["receipt_id"],
        }


__all__ = ["ConflictError", "StaleFenceError", "Store", "StoreError"]
