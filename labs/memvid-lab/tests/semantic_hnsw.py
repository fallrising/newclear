"""Real-encoder HNSW retention control, separate from frozen retrieval-quality evaluation."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from notes_eval import digest, write_json


def initialize():
    from offline import local_environment, deny_network
    local_environment()
    network = deny_network()
    from semantic_sdk import activate
    return network, activate()


def persisted_count(path):
    import memvid_sdk as sdk
    before = digest(path)
    report = sdk.Memvid.doctor(str(path), dry_run=True, rebuild_vec_index=True, quiet=True)
    assert digest(path) == before, 'dry-run inspection changed memory'
    details = [a['detail'] for p in report['plan']['phases'] for a in p['actions']
               if (a.get('detail') or {}).get('type') == 'vec_index']
    assert len(details) == 1, 'missing vector manifest detail'
    return details[0]['expected_vectors']


def check_sources(path, control):
    import memvid_sdk as sdk
    hits = []
    with sdk.use('basic', str(path), read_only=True) as memory:
        for vector in control['probes']:
            found = memory.find('', mode='sem', query_embedding=vector, k=5, snippet_chars=8000)['hits']
            assert found and all(str(h['frame_id']) in control['manifest'] for h in found)
            for hit in found:
                expected = control['manifest'][str(hit['frame_id'])]
                assert hit['uri'] == expected['uri'] and (hit.get('text') or hit.get('snippet')) == expected['rendered']
                assert hit['frame_id'] != control.get('removed')
            hits.extend(found)
    assert any(h['frame_id'] != control['new_id'] for h in hits), 'old vectors not searchable'
    return hits


def run(output, cache):
    if output.exists() or output.is_symlink():
        raise FileExistsError('Output exists')
    network, patch = initialize()
    from semantic_models import LocalEncoder, MODELS
    import memvid_sdk as sdk
    encoder = LocalEncoder(cache, 'bge_zh')
    notes = json.loads((ROOT / 'fixtures/notes.json').read_text())['notes']
    # Reuse the exact 24 real encoded payloads, under unique synthetic URIs.
    # This exercises 1000-vector storage; it is explicitly not a quality corpus.
    payloads = [n['title'] + '\n' + n['text'] for n in notes]
    vectors = encoder.encode(payloads)
    docs = [{'uri': f'mv2://retention/{i:04d}', 'title': notes[i % 24]['title'], 'label': 'fixture',
             'text': payloads[i % 24], 'metadata': {'fixture': 'synthetic'}, 'timestamp': 1700000000} for i in range(1001)]
    identity = {'provider': 'local-onnx', 'model': MODELS['bge_zh']['repository'], 'dimension': 512, 'normalized': True}
    options = {'enable_embedding': False, 'auto_tag': False, 'extract_dates': False, 'enable_enrichment': False}
    output.mkdir(parents=True)
    path = output / 'hnsw.mv2'
    report = {'network': network, 'patched_sdk': patch, 'passed': False, 'stages': {},
              'corpus_sha256': digest(ROOT / 'fixtures/notes.json'),
              'test_sha256': digest(Path(__file__).resolve()),
              'scope': '1000 repeated real-encoder payloads; storage retention control, not quality scores'}
    def count(stage, expected):
        actual = persisted_count(path)
        report['stages'][stage] = {'expected': expected, 'actual': actual}
        write_json(output / 'report.json', report)
        assert actual == expected, f'{stage}: expected {expected} retained vectors, got {actual}'
    with sdk.create(str(path), enable_vec=True, enable_lex=True) as memory:
        ids = memory.put_many(docs[:1000], embeddings=[vectors[i % 24] for i in range(1000)],
                              embedding_identity=identity, opts=options)
        memory.seal()
    ids = [int(i) for i in ids]
    count('initial_reopen', 1000)
    with sdk.use('basic', str(path), read_only=False) as memory:
        new_id = memory.put_many([docs[1000]], embeddings=[vectors[1000 % 24]], embedding_identity=identity, opts=options)[0]
        memory.seal()
    new_id = int(new_id)
    count('append_reopen', 1001)
    removed = ids[0]
    with sdk.use('basic', str(path), read_only=False) as memory:
        memory.remove(removed)
        memory.seal()
    count('delete_reopen', 1000)
    normalize = lambda text: ' '.join(unicodedata.normalize('NFKC', text).split())
    manifest = {}
    for frame, doc in zip([*ids, new_id], docs):
        if frame == removed:
            continue
        rendered = (normalize(doc['text']) + ' title: ' + normalize(doc['title']) + ' uri: ' + doc['uri']
                    + ' fixture: "synthetic" memvid.embedding.dimension: 512 memvid.embedding.model: '
                    + identity['model'] + ' memvid.embedding.normalized: true memvid.embedding.provider: local-onnx')
        manifest[str(frame)] = {'uri': doc['uri'], 'rendered': rendered}
    write_json(output / 'control.json', {'manifest': manifest, 'probes': vectors, 'removed': removed, 'new_id': new_id})
    child = subprocess.run([sys.executable, str(Path(__file__).resolve()), '_reopen', str(output)],
                           capture_output=True, text=True, timeout=60)
    if child.returncode:
        raise RuntimeError(child.stderr[-1500:])
    report.update({'passed': True, 'new_process': json.loads(child.stdout)})
    write_json(output / 'report.json', report)
    print(json.dumps({'passed': True, 'stages': report['stages']}))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '_reopen':
        network, patch = initialize()
        output = Path(sys.argv[2])
        count = persisted_count(output / 'hnsw.mv2')
        assert count == 1000
        hits = check_sources(output / 'hnsw.mv2', json.loads((output / 'control.json').read_text()))
        print(json.dumps({'vector_count': count, 'native_hits': hits, 'network': network, 'patched_sdk': patch}))
    else:
        parser = argparse.ArgumentParser()
        parser.add_argument('--output', type=Path, required=True)
        parser.add_argument('--cache', type=Path, default=ROOT / 'work/semantic-models')
        args = parser.parse_args()
        run(args.output, args.cache)
