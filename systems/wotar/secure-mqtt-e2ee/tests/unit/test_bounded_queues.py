"""Bounded queue enforcement on workers."""

from __future__ import annotations

import pytest
from tests.fixtures import test_vector

from secure_mqtt.errors import PublishError, QueueFullError
from secure_mqtt.mqtt.subscriptions import SubscriptionRegistry
from secure_mqtt.mqtt.transport import IncomingMessage
from secure_mqtt.observability.metrics import Metrics
from secure_mqtt.persistence.inbox import InboxStore
from secure_mqtt.persistence.replay import ReplayGuard
from secure_mqtt.workers.publish_worker import PublishWorker
from secure_mqtt.workers.receive_worker import ReceiveWorker


class _NoopTransport:
    connection_state = None

    def publish(self, *args, **kwargs):
        raise RuntimeError("not connected")

    def wait_puback(self, *args, **kwargs):
        return


def test_receive_worker_queue_full(tmp_db, in_memory_keys, registry, policy_resolver) -> None:
    worker = ReceiveWorker(
        key_provider=in_memory_keys,
        registry=registry,
        policy_resolver=policy_resolver,
        replay_guard=ReplayGuard(tmp_db),
        inbox=InboxStore(tmp_db),
        subscriptions=SubscriptionRegistry(),
        metrics=Metrics(),
        max_queue_size=1,
    )
    worker.start()
    incoming = IncomingMessage(topic=test_vector.TOPIC, payload=b"x", qos=1)
    worker.offer(incoming)
    with pytest.raises(QueueFullError):
        worker.offer(incoming)
    worker.stop()


def test_publish_worker_queue_full(tmp_db, in_memory_keys, policy_resolver) -> None:
    from secure_mqtt.persistence.outbox import OutboxStore

    outbox = OutboxStore(tmp_db, in_memory_keys, policy_resolver)
    worker = PublishWorker(
        transport=_NoopTransport(),
        outbox=outbox,
        metrics=Metrics(),
        max_queue_size=1,
    )
    worker.start()
    worker.enqueue(1)
    with pytest.raises(PublishError):
        worker.enqueue(2)
    worker.stop()
