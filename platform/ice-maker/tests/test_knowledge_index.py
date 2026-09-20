import hashlib
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from ice_maker.extraction import ExtractedChunk
from ice_maker.knowledge_index import IndexError, KnowledgeIndex


def chunk(text="idempotent local indexing", page=1, source="a" * 64, cid=None):
    region = f"text:0,0,{len(text)}"
    method = "pdf-text"
    expected = hashlib.sha256(f"{source}\0{page}\0{region}\0{method}\0{text}".encode()).hexdigest()
    return ExtractedChunk(source, page, region, method, text, 1.0, cid or expected)


class KnowledgeIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "knowledge.sqlite3"

    def tearDown(self):
        self.temp.cleanup()

    def test_insert_rerun_and_bm25_search_are_deterministic(self):
        index = KnowledgeIndex(self.path)
        first = chunk("provenance makes indexing idempotent")
        second = chunk("provenance and idempotency are related", source="b" * 64)
        self.assertEqual(index.index_chunks([first, second]), 2)
        self.assertEqual(index.index_chunks([first, second]), 0)
        one = index.search("provenance", limit=10)
        two = index.search("provenance", limit=10)
        self.assertEqual(one, two)
        self.assertEqual({item.chunk_id for item in one}, {first.chunk_id, second.chunk_id})

    def test_concurrent_constructors_serialize_before_opening_sqlite(self):
        real_connect = sqlite3.connect
        first_connect = threading.Event()
        second_connect = threading.Event()
        release_first = threading.Event()
        calls_lock = threading.Lock()
        calls = 0
        failures = []

        def controlled_connect(*args, **kwargs):
            nonlocal calls
            with calls_lock:
                calls += 1
                call_number = calls
            if call_number == 1:
                first_connect.set()
                if not release_first.wait(2):
                    raise RuntimeError("first constructor was not released")
            else:
                second_connect.set()
            return real_connect(*args, **kwargs)

        def index_one(item):
            try:
                with KnowledgeIndex(self.path) as index:
                    index.index_chunks((item,))
            except BaseException as exc:
                failures.append(exc)

        with mock.patch(
            "ice_maker.knowledge_index.sqlite3.connect",
            side_effect=controlled_connect,
        ):
            first = threading.Thread(target=index_one, args=(chunk("first"),))
            second = threading.Thread(
                target=index_one,
                args=(chunk("second", source="b" * 64),),
            )
            first.start()
            self.assertTrue(first_connect.wait(1))
            second.start()
            try:
                self.assertFalse(second_connect.wait(0.25))
            finally:
                release_first.set()
                first.join(2)
                second.join(2)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(failures, [])
        with KnowledgeIndex(self.path, existing=True) as index:
            self.assertEqual(index.count(), 2)

    def test_shared_index_lock_contention_has_a_bounded_failure(self):
        with KnowledgeIndex(self.path):
            pass
        with (
            mock.patch(
                "ice_maker.knowledge_index.fcntl.flock",
                side_effect=BlockingIOError,
            ),
            mock.patch(
                "ice_maker.knowledge_index.time.monotonic",
                side_effect=(0.0, 5.0),
            ),
        ):
            with self.assertRaisesRegex(IndexError, "database lock timed out"):
                KnowledgeIndex(self.path, existing=True)

    def test_rejects_provenance_and_secret_before_mutation(self):
        index = KnowledgeIndex(self.path)
        bad = chunk("safe", source="c" * 64)
        bad = ExtractedChunk(bad.source_sha256, 2, bad.region, bad.method, bad.text, bad.confidence, bad.chunk_id)
        with self.assertRaises(IndexError):
            index.index_chunks([bad])
        with self.assertRaises(IndexError):
            index.index_chunks([chunk("password: leaked", source="d" * 64)])
        self.assertEqual(index.count(), 0)

    def test_rejects_taxonomy_and_duplicate_conflict(self):
        index = KnowledgeIndex(self.path)
        first = chunk("safe")
        index.index_chunks([first])
        with self.assertRaises(IndexError):
            index.index_chunks([chunk("different", cid=first.chunk_id)])
        with self.assertRaises(IndexError):
            index.propose("safe", "concepts/unknown", conclusions=["safe"])

    def test_conflict_rolls_back_entire_batch(self):
        index = KnowledgeIndex(self.path)
        existing = chunk("existing")
        index.index_chunks([existing])
        new_item = chunk("new", source="b" * 64)
        with self.assertRaises(IndexError):
            index.index_chunks([new_item, chunk("different", cid=existing.chunk_id)])
        self.assertEqual(index.count(), 1)
        self.assertEqual(index.search("new"), ())

    def test_proposal_is_unpromoted_and_cites_exact_chunks(self):
        index = KnowledgeIndex(self.path)
        source = chunk("provenance supports reproducible search")
        index.index_chunks([source])
        proposal = index.propose("provenance", "concepts/provenance", conclusions=["Keep the source trace."])
        self.assertEqual(proposal.status, "unpromoted")
        self.assertEqual(proposal.destination, "concepts/provenance")
        self.assertEqual(proposal.citations[0]["chunk_id"], source.chunk_id)
        self.assertEqual(proposal.citations[0]["source_sha256"], source.source_sha256)
        with self.assertRaises(AttributeError):
            proposal.status = "promoted"

    def test_rejects_symlink_database(self):
        real = Path(self.temp.name) / "real.sqlite3"
        real.touch()
        link = Path(self.temp.name) / "link.sqlite3"
        link.symlink_to(real)
        with self.assertRaises(IndexError):
            KnowledgeIndex(link)

    def test_rejects_broken_and_sidecar_symlinks(self):
        broken = Path(self.temp.name) / "broken.sqlite3"
        broken.symlink_to(Path(self.temp.name) / "missing.sqlite3")
        with self.assertRaises(IndexError):
            KnowledgeIndex(broken)
        for suffix in ("-wal", "-shm", "-journal"):
            sidecar = Path(str(self.path) + suffix)
            sidecar.symlink_to(Path(self.temp.name) / "target")
            with self.assertRaises(IndexError):
                KnowledgeIndex(self.path)
            sidecar.unlink()

    def test_taxonomy_is_snapshotted(self):
        taxonomy = {"domains": ("operations", "software", "systems"),
                    "concepts": ("consistency", "idempotency", "privacy", "provenance"),
                    "relations": ("contrasts_with", "depends_on", "derived_from", "example_of", "implements")}
        index = KnowledgeIndex(self.path, taxonomy)
        taxonomy["concepts"] = ("forged",)
        with self.assertRaises(IndexError):
            index.propose("safe", "concepts/forged", conclusions=["safe"])

    def test_search_rejects_corrupt_persisted_rows_and_fts(self):
        index = KnowledgeIndex(self.path)
        item = chunk("safe")
        index.index_chunks([item])
        index._connection.execute("UPDATE chunks SET page_number=0")
        index._connection.commit()
        with self.assertRaises(IndexError):
            index.search("safe")

        index._connection.execute("UPDATE chunks SET page_number=1")
        index._connection.commit()
        index._connection.execute("INSERT INTO chunks_fts(chunks_fts) VALUES('delete-all')")
        index._connection.commit()
        with self.assertRaises(IndexError):
            index.search("safe")

    def test_bounded_generators_and_conclusion_bindings(self):
        index = KnowledgeIndex(self.path)
        item = chunk("safe")
        index.index_chunks([item])
        def too_many():
            for _ in range(10_001):
                yield item
        with self.assertRaises(IndexError):
            index.index_chunks(too_many())
        proposal = index.propose("safe", "concepts/provenance",
                                 conclusions=(f"conclusion {n}" for n in range(100)))
        self.assertEqual(len(proposal.conclusions), 100)
        self.assertEqual(len(proposal.conclusion_citations), 100)
        self.assertEqual(proposal.conclusion_citations[0]["citation_ids"], (item.chunk_id,))
        with self.assertRaises(TypeError):
            proposal.related_comparisons[0]["chunk_id"] = "forged"

    def test_red_search_accepts_multiple_item_batches_above_ten_thousand_chunks(self):
        index = KnowledgeIndex(self.path)
        first = tuple(
            chunk(f"capacity term {number}", source=f"{number:064x}")
            for number in range(10_000)
        )
        last = chunk("capacity term final", source=f"{10_000:064x}")
        self.assertEqual(index.index_chunks(first), 10_000)
        self.assertEqual(index.index_chunks((last,)), 1)
        self.assertEqual(len(index.search("capacity", limit=3)), 3)

    def test_red_whole_index_ceiling_rolls_back_new_chunks(self):
        index = KnowledgeIndex(self.path)
        with mock.patch("ice_maker.knowledge_index._MAX_INDEX_CHUNKS", 1):
            self.assertEqual(index.index_chunks((chunk("first"),)), 1)
            with self.assertRaisesRegex(IndexError, "index contains too many chunks"):
                index.index_chunks((chunk("second", source="b" * 64),))
        self.assertEqual(index.count(), 1)

    def test_rejects_non_iterable_and_too_many_conclusions(self):
        index = KnowledgeIndex(self.path)
        item = chunk("safe")
        index.index_chunks([item])
        with self.assertRaises(IndexError):
            index.index_chunks(None)
        with self.assertRaises(IndexError):
            index.propose("safe", "concepts/provenance", conclusions=None)
        with self.assertRaises(IndexError):
            index.propose("safe", "concepts/provenance",
                          conclusions=("safe" for _ in range(101)))
        with self.assertRaises(IndexError):
            index.search("unsafe\nquery")
        with self.assertRaises(IndexError):
            index.propose("safe", "concepts/provenance", conclusions=["unsafe\nconclusion"])

    def test_failed_initialization_does_not_publish_partial_schema(self):
        connection = sqlite3.connect(self.path)
        connection.execute("CREATE TABLE index_metadata (unexpected TEXT)")
        connection.commit()
        connection.close()
        with self.assertRaises(IndexError):
            KnowledgeIndex(self.path)
        connection = sqlite3.connect(self.path)
        names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
        connection.close()
        self.assertNotIn("chunks", names)
        self.assertNotIn("chunks_fts", names)

    def test_traditional_chinese_ocr_rectangle_is_searchable(self):
        index = KnowledgeIndex(self.path)
        text, source, region = "繁體中文可搜尋", "f" * 64, "pixels:12,34,56,78"
        identity = f"{source}\0{1}\0{region}\0ocr\0{text}"
        item = ExtractedChunk(source, 1, region, "ocr", text, .91, hashlib.sha256(identity.encode()).hexdigest())
        self.assertEqual(index.index_chunks([item]), 1)
        self.assertEqual(index.search(text)[0], item)

    def test_production_bounds_unicode_and_rectangles_fail_closed(self):
        index = KnowledgeIndex(self.path)
        def ocr(text, region="pixels:1,2,3,4", page=1, confidence=.9):
            source = "e" * 64
            identity = f"{source}\0{page}\0{region}\0ocr\0{text}"
            return ExtractedChunk(source, page, region, "ocr", text, confidence,
                                  hashlib.sha256(identity.encode()).hexdigest())
        invalid = (
            ocr("safe", "pixels:99999,0,2,1"),
            ocr("safe", "pixels:0,99999,1,2"),
            ocr("safe", page=1001),
            ocr("Ａ"),
            ocr("safe\u202e"),
            ocr("safe\ufeff"),
            ocr("safe\uffff"),
            ocr("token: leaked"),
            ocr("safe", confidence=float("nan")),
        )
        for item in invalid:
            with self.subTest(item=item):
                with self.assertRaises(IndexError):
                    index.index_chunks((item,))
        self.assertEqual(index.count(), 0)

    def test_large_native_text_offsets_and_utf8_bytes_are_exact(self):
        index = KnowledgeIndex(self.path)
        text = "繁" * 5_000
        source, region = "d" * 64, f"text:12000,0,{len(text)}"
        identity = f"{source}\0{1}\0{region}\0pdf-text\0{text}"
        item = ExtractedChunk(source, 1, region, "pdf-text", text, 1.0,
                              hashlib.sha256(identity.encode()).hexdigest())
        self.assertEqual(index.index_chunks((item,)), 1)
        too_large = "繁" * 5_500
        bad_region = f"text:0,0,{len(too_large)}"
        bad_id = hashlib.sha256(f"{source}\0{1}\0{bad_region}\0pdf-text\0{too_large}".encode()).hexdigest()
        with self.assertRaises(IndexError):
            index.index_chunks((ExtractedChunk(source, 1, bad_region, "pdf-text", too_large, 1.0, bad_id),))


if __name__ == "__main__":
    unittest.main()
