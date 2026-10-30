"""Opt-in real-model SDK persistence regression; requires prepared assets."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def observe_child(output):
    from offline import local_environment, deny_network
    local_environment()
    network = deny_network()
    from semantic_sdk import activate
    patch = activate()
    import memvid_sdk as sdk
    control = json.loads((output / 'control.json').read_text())
    with sdk.use('basic', str(output / 'probe.mv2'), read_only=True) as memory:
        hits = memory.find(control['query'], mode='sem', query_embedding=control['vector'],
                           k=30, snippet_chars=8000)['hits']
        actual = {int(h['frame_id']): h['uri'] for h in hits}
        expected = {int(k): v for k, v in control['expected'].items()}
        assert len(hits) == len(expected) and actual == expected, 'new process lost or misidentified vectors'
        for frame, uri in control['latest'].items():
            assert int(memory.frame(uri)['id']) == int(frame), 'current source frame mismatch'
    result = {'new_process_reopen': True, 'all_expected_sources_searchable': True,
              'removed_frame_absent': control['removed'] not in actual,
              'invalid_batch_rejected_before_writes': control['invalid_batch_rejected'],
              'native_hits': hits, 'network': network, 'patched_sdk': patch}
    (output / 'update-report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print('PASS: child reopen, appended version, returned-ID delete and retained old vectors')


def update_control(cache, output):
    from semantic_models import LocalEncoder, MODELS
    import memvid_sdk as sdk
    report = json.loads((output / 'report.json').read_text())
    encoder = LocalEncoder(cache, 'bge_zh')
    text = '更新後的合成筆記：下週三在海風教室舉行讀書會。'
    uri = 'mv2://notes/n01'
    vector = encoder.encode([text])[0]
    with sdk.use('basic', str(output / 'probe.mv2'), read_only=False) as memory:
        bad_docs = [{'uri': f'mv2://invalid/{i}', 'title': '無效向量控制', 'label': 'fixture', 'text': text} for i in range(2)]
        before_count = memory.stats()['frame_count']
        try:
            memory.put_many(bad_docs, embeddings=[vector, [float('nan')] * 512],
                            opts={'enable_embedding': False, 'auto_tag': False, 'extract_dates': False})
        except ValueError:
            pass
        else:
            raise AssertionError('nonfinite batch accepted')
        assert memory.stats()['frame_count'] == before_count, 'invalid batch partially wrote frames'
        new_id = memory.put_many([{'uri': uri, 'title': '更新控制', 'label': 'fixture', 'text': text}], embeddings=[vector],
                                 embedding_identity={'provider': 'local-onnx', 'model': MODELS['bge_zh']['repository'],
                                                     'dimension': 512, 'normalized': True},
                                 opts={'enable_embedding': False, 'auto_tag': False, 'extract_dates': False,
                                       'disable_auto_checkpoint': True})[0]
        removed = report['after_reopen']['frames']['mv2://notes/n02']
        memory.remove(removed)
        memory.seal()
    expected = {str(i): u for u, i in report['after_reopen']['frames'].items() if i != removed}
    expected[str(new_id)] = uri
    latest = {i: u for i, u in expected.items() if u != uri}
    latest[str(new_id)] = uri
    control = {'query': text, 'vector': vector, 'expected': expected, 'latest': latest, 'removed': removed, 'invalid_batch_rejected': True}
    (output / 'control.json').write_text(json.dumps(control, ensure_ascii=False, indent=2) + '\n')
    subprocess.run([sys.executable, str(Path(__file__).resolve()), '_reopen', str(output)], check=True, timeout=60)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '_reopen':
        observe_child(Path(sys.argv[2]))
        return
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / 'work/semantic-models')
    parser.add_argument('--patched', action='store_true')
    args = parser.parse_args()
    from diagnose_vectors import run
    run(args.cache, args.output, patched=args.patched)
    report = json.loads((args.output / 'report.json').read_text())
    assert report['native_persistence_passed'], 'native returned IDs / complete reopened vectors failed'
    assert len(report['before_seal']['hits']) == 24, 'vectors missing before seal'
    print('PASS: all 24 real vectors and returned frame IDs persist')
    if args.patched:
        update_control(args.cache, args.output)


if __name__ == '__main__':
    main()
