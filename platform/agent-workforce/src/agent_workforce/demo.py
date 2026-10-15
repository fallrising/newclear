"""A synthetic, offline demonstration of durable command identity."""
import json
from pathlib import Path

from .controller import Controller
from .fake import FakeBackend
from .store import Store


def run_demo(path):
    fixture=json.loads(Path(__file__).with_name('demo_fixture.json').read_text(encoding='utf-8'))
    backend=FakeBackend(mode='complete')
    issuer=fixture['grant']['issuer']
    with Store(path) as store:
        controller=Controller(store,backend,clock=lambda:fixture['clock'],trusted_issuers=(issuer,))
        for kind, rows in fixture['records'].items():
            for key, row in rows.items(): controller.register(kind,key,row)
        controller.put_grant(fixture['grant'],authenticated_operator=issuer)
        command=controller.accept(fixture['request'],authenticated_caller=issuer)
        attempt=controller.dispatch(command['command_id'])
        return {
            'backend':'fake', 'command_id':command['command_id'],
            'operation_id':attempt['operation_id'], 'state':attempt['state'],
            'external_done':False, 'commands':len(store.commands()),
            'backend_starts':len(backend.starts),
            'held_reservations':sum(not row['released'] for row in store.reservations()),
            'usage':store.usage(fixture['grant']['job_id']),
        }
