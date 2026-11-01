"""Generate synthetic known-answer inputs. Never reads real credentials."""
import base64
import copy
import hashlib
import hmac
import json
from pathlib import Path
import rfc8785

ROOT = Path(__file__).resolve().parent
def write(name, value):
    (ROOT/name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')

def main():
    body = '{"specversion":"1.0","id":"synthetic-1","source":"urn:example:release","type":"release.deploy.succeeded","time":"2026-10-03T00:00:00Z","summary":"測試"}\n'.encode()
    case = dict(name='valid-unicode-body', key_hex=bytes(range(32)).hex(), timestamp='1790985600',
                delivery_id='release-hook:42', now=1790985600,
                body_base64=base64.b64encode(body).decode(), accepted_ids=[], expected='accept')
    def signed(item):
        payload=f"v1.{item['timestamp']}.{item['delivery_id']}.".encode()+base64.b64decode(item['body_base64'])
        item['signature']='v1='+hmac.new(bytes.fromhex(item['key_hex']),payload,hashlib.sha256).hexdigest()
        return item
    signed(case)
    vectors=[case]
    def variant(name, **changes):
        item=copy.deepcopy(case); item.update(name=name, **changes); vectors.append(item)
    for offset in [-301,-300,300,301]:
        variant(f'clock-offset-{offset}',now=case['now']+offset,expected='accept' if abs(offset)<=300 else 'reject')
    variant('duplicate-valid', accepted_ids=['release-hook:42'], expected='duplicate')
    variant('body-byte-changed',body_base64=base64.b64encode(body+b' ').decode(),expected='reject')
    variant('delivery-id-changed',delivery_id='release-hook:43',expected='reject')
    variant('timestamp-changed',timestamp='1790985601',expected='reject')
    variant('wrong-key',key_hex='ff'*32,expected='reject')
    variant('uppercase-signature',signature=case['signature'].upper(),expected='reject')
    variant('short-signature',signature='v1=00',expected='reject')
    variant('leading-zero-timestamp',timestamp='01790985600',expected='reject')
    variant('signed-plus-timestamp',timestamp='+1790985600',expected='reject')
    variant('duplicate-bad-signature',accepted_ids=['release-hook:42'],signature='v1='+'0'*64,expected='reject')
    write('webhook-vectors.json',vectors)
    event=json.loads(body)
    raw=[('original',json.dumps(event,ensure_ascii=False)),('reordered',json.dumps(dict(reversed(list(event.items()))))),
         ('null-unset',json.dumps({**event,'subject':None})),
         ('explicit-default',json.dumps({**event,'severity':'info'})),
         ('number-unicode',json.dumps({**event,'data':{'z':1.0,'a':'é','nested':{'b':2,'a':-0.0}}},ensure_ascii=False))]
    hashes=[]
    for name,text in raw:
        canonical=rfc8785.dumps({k:v for k,v in json.loads(text).items() if v is not None})
        hashes.append(dict(name=name,input=text,canonical=canonical.decode(),sha256=hashlib.sha256(canonical).hexdigest()))
    write('canonical-vectors.json',hashes)

if __name__=='__main__':
    main()
