import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest
import warnings

from ice_maker.document_batch import BatchItem, CODE_MAXIMA, CONFIG_SCHEMA, SourceDescriptor
from ice_maker.production_extraction import (
    DecodedImage, OcrWord, PdfExtraction, PdfPageExtraction,
    ProductionExtractionError, RasterExtraction, Tile, canonical_pdf_chunk_id,
    _parse_pdfinfo, decode_image, deduplicate_words, extract_pdf, extract_raster, parse_tsv,
    run_tesseract, tile_image,
)

PNG = b"\x89PNG\r\n\x1a\nfixture"
JPEG = b"\xff\xd8\xff\xe0fixture"
WEBP = b"RIFF\x10\x00\x00\x00WEBPfixture"
HEADER = b"level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"


def config(**changes):
    values = dict(CODE_MAXIMA)
    values.update({"max_decoded_pixels": 1000, "max_image_dimension": 100,
                   "max_tile_pixels": 80,
                   "tile_height_pixels": 8, "tile_overlap_pixels": 2,
                   "max_ocr_output_bytes": 4096, "timeout_seconds": 2, "max_workers": 2})
    values.update(changes)
    return {"schema_version": CONFIG_SCHEMA, "limits": values}


def descriptor(source=PNG):
    return SourceDescriptor(BatchItem("screen.png", "confirmed", "internal", ("eng",)),
                            len(source), hashlib.sha256(source).hexdigest(), "png")


def pdf_descriptor(source):
    return SourceDescriptor(BatchItem("document.pdf", "confirmed", "internal", ("eng",)),
                            len(source), hashlib.sha256(source).hexdigest(), "pdf")


class ProductionExtractionTests(unittest.TestCase):
    def test_pdfinfo_accepts_supported_utf8_metadata_without_retaining_it(self):
        metadata = (
            "Title: 歷史系統技術分析\n"
            "Creator: Ice Maker\n"
            "Pages: 1\n"
            "Encrypted: no\n"
            "Page size: 612 x 792 pts (letter)\n"
            "PDF version: 1.7\n"
        ).encode("utf-8")
        self.assertEqual(_parse_pdfinfo(metadata, 1000), 1)

    def test_red_pdf_routes_native_and_scanned_pages_independently(self):
        source = b"%PDF-1.7\nfixture"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = []
            for name in ("pdfinfo", "pdftotext", "pdftoppm", "tesseract"):
                path = root / name
                path.write_text("#!/bin/sh\n")
                path.chmod(0o700)
                tools.append(str(path))

            def runner(argv, **kwargs):
                name = Path(argv[0]).name
                if name == "pdfinfo":
                    return subprocess.CompletedProcess(argv, 0, b"Pages: 2\nEncrypted: no\n", b"")
                if name == "pdftotext":
                    page = argv[argv.index("-f") + 1]
                    text = "Ａ useful native PDF page has enough text.\n".encode() if page == "1" else b"\n"
                    return subprocess.CompletedProcess(argv, 0, text, b"")
                if name == "pdftoppm":
                    self.assertEqual(argv[argv.index("-f") + 1], "2")
                    self.assertIn("-singlefile", argv)
                    self.assertIn("-png", argv)
                    Path(argv[-1] + ".png").write_bytes(PNG)
                    return subprocess.CompletedProcess(argv, 0, b"", b"")
                if name == "tesseract":
                    row = "5\t1\t1\t1\t1\t1\t1\t1\t2\t1\t50\tＳcanned\n".encode()
                    return subprocess.CompletedProcess(argv, 0, HEADER + row, b"")
                self.fail(name)

            result = extract_pdf(
                source, pdf_descriptor(source), config=config(),
                pdfinfo_executable=tools[0], pdftotext_executable=tools[1],
                pdftoppm_executable=tools[2], poppler_version="poppler 25.0",
                ocr_executable=tools[3], languages=("eng",), installed_languages=("eng",),
                tesseract_version="tesseract 5", runner=runner,
                decoder=lambda raw: ("png", 10, 8, "RGB", object()),
                tile_encoder=lambda raster, tile, path, codec: path.write_bytes(PNG),
            )
        self.assertEqual([page.method for page in result.pages], ["pdf-text", "ocr"])
        self.assertEqual([page.page for page in result.pages], [1, 2])
        self.assertEqual(result.pages[0].text, "A useful native PDF page has enough text.")
        self.assertEqual(result.pages[1].text, "Scanned")
        self.assertEqual(len({page.chunk_id for page in result.pages}), 2)

    def test_red_pdf_raster_is_a_verified_single_output_file(self):
        source = b"%PDF-1.7\nfixture"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {}
            for name in ("pdfinfo", "pdftotext", "pdftoppm", "tesseract"):
                path = root / name; path.write_text("#!/bin/sh\n"); path.chmod(0o700); paths[name] = str(path)

            def run(mode):
                def runner(argv, **kwargs):
                    name = Path(argv[0]).name
                    if name == "pdfinfo":
                        return subprocess.CompletedProcess(argv, 0, b"Pages: 1\nEncrypted: no\n", b"")
                    if name == "pdftotext":
                        self.assertEqual(argv[1:5], ["-enc", "UTF-8", "-eol", "unix"])
                        self.assertIn("-nopgbrk", argv)
                        return subprocess.CompletedProcess(argv, 0, b"\n", b"")
                    if name == "pdftoppm":
                        output = Path(argv[-1] + ".png")
                        if mode == "good": output.write_bytes(PNG)
                        elif mode == "symlink": output.symlink_to(paths["pdfinfo"])
                        elif mode == "extra":
                            output.write_bytes(PNG); Path(argv[-1] + "-2.png").write_bytes(PNG)
                        elif mode == "large": output.write_bytes(PNG + b"x" * 5000)
                        return subprocess.CompletedProcess(argv, 0, b"", b"")
                    if name == "tesseract":
                        return subprocess.CompletedProcess(argv, 0, HEADER + b"5\t1\t1\t1\t1\t1\t1\t1\t2\t1\t50\tScan\n", b"")
                    self.fail(name)
                return extract_pdf(source, pdf_descriptor(source), config=config(max_file_bytes=4096),
                    pdfinfo_executable=paths["pdfinfo"], pdftotext_executable=paths["pdftotext"],
                    pdftoppm_executable=paths["pdftoppm"], poppler_version="poppler 25.0",
                    ocr_executable=paths["tesseract"], languages=("eng",), installed_languages=("eng",),
                    tesseract_version="tesseract 5", runner=runner,
                    decoder=lambda raw: ("png", 10, 8, "RGB", object()),
                    tile_encoder=lambda raster, tile, path, codec: path.write_bytes(PNG))
            self.assertEqual(run("good").pages[0].method, "ocr")
            for mode in ("missing", "symlink", "extra", "large"):
                with self.subTest(mode=mode), self.assertRaises(ProductionExtractionError): run(mode)

    def test_red_pdf_evidence_binds_page_content_and_seals_fields(self):
        digest = "a" * 64
        tool_digest = "b" * 64
        native_id = canonical_pdf_chunk_id(digest, 1, "pdf-text", digest, tool_digest,
                                           text="useful native content", text_region=(0, 21), ocr_words=())
        changed_id = canonical_pdf_chunk_id(digest, 1, "pdf-text", digest, tool_digest,
                                            text="different native text", text_region=(0, 21), ocr_words=())
        self.assertNotEqual(native_id, changed_id)
        page = PdfPageExtraction(digest, 1, "pdf-text", "useful native content", 1.0,
                                 (0, 21), (), None, None, None, "production-pdf-v2", digest,
                                 tool_digest, native_id)
        for field in ("page", "text", "ocr_words", "raster_sha256", "chunk_id"):
            values = dict(zip(PdfPageExtraction.__dataclass_fields__, (
                digest, 1, "pdf-text", "useful native content", 1.0, (0, 21), (), None,
                None, None, "production-pdf-v2", digest, tool_digest, native_id,
            )))
            values[field] = {"page": "1", "text": object(), "ocr_words": object(),
                             "raster_sha256": digest, "chunk_id": "forged"}[field]
            with self.subTest(field=field), self.assertRaises(ProductionExtractionError): PdfPageExtraction(**values)
        with self.assertRaises(ProductionExtractionError):
            PdfExtraction(digest, (page,) * 1001, "production-pdf-v2", digest, tool_digest,
                          "poppler 25.0", "tesseract 5", ("eng",), "forged")

    def test_red_pdf_page_routing_and_failure_matrix(self):
        source = b"%PDF-1.7\nfixture"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {}
            for name in ("pdfinfo", "pdftotext", "pdftoppm", "tesseract"):
                path = root / name; path.write_text("#!/bin/sh\n"); path.chmod(0o700); paths[name] = str(path)

            def attempt(texts, *, info=b"Pages: 2\nEncrypted: no\n", raster="good", ocr="word"):
                def runner(argv, **kwargs):
                    name = Path(argv[0]).name
                    if name == "pdfinfo": return subprocess.CompletedProcess(argv, 0, info, b"")
                    if name == "pdftotext":
                        page = int(argv[argv.index("-f") + 1])
                        value = texts[page - 1]
                        if value == "timeout": raise subprocess.TimeoutExpired(argv, 1)
                        if value == "nonzero": return subprocess.CompletedProcess(argv, 1, b"", b"")
                        return subprocess.CompletedProcess(argv, 0, value.encode(), b"")
                    if name == "pdftoppm":
                        if raster == "nonzero": return subprocess.CompletedProcess(argv, 1, b"", b"")
                        if raster == "stdout": return subprocess.CompletedProcess(argv, 0, b"x" * 5000, b"")
                        if raster == "good": Path(argv[-1] + ".png").write_bytes(PNG)
                        return subprocess.CompletedProcess(argv, 0, b"", b"")
                    if name == "tesseract":
                        if ocr == "nonzero": return subprocess.CompletedProcess(argv, 1, b"", b"")
                        if ocr == "blank": return subprocess.CompletedProcess(argv, 0, HEADER, b"")
                        return subprocess.CompletedProcess(argv, 0, HEADER + b"5\t1\t1\t1\t1\t1\t1\t1\t2\t1\t50\tOCR\n", b"")
                    self.fail(name)
                return extract_pdf(source, pdf_descriptor(source), config=config(max_ocr_output_bytes=4096),
                    pdfinfo_executable=paths["pdfinfo"], pdftotext_executable=paths["pdftotext"],
                    pdftoppm_executable=paths["pdftoppm"], poppler_version="poppler 25.0",
                    ocr_executable=paths["tesseract"], languages=("eng",), installed_languages=("eng",),
                    tesseract_version="tesseract 5", runner=runner,
                    decoder=lambda raw: ("png", 10, 8, "RGB", object()),
                    tile_encoder=lambda raster, tile, path, codec: path.write_bytes(PNG))

            all_native = attempt(["native page has more than twenty bytes", "another native page with enough text"])
            self.assertEqual([page.method for page in all_native.pages], ["pdf-text", "pdf-text"])
            scanned = attempt(["\n", "\n"])
            self.assertEqual([page.method for page in scanned.pages], ["ocr", "ocr"])
            for values in ((["\n", "\n"], {"ocr": "blank"}),
                           (["native page has more than twenty bytes", "nonzero"], {}),
                           (["timeout", "\n"], {}),
                           (["\n", "\n"], {"raster": "nonzero"}),
                           (["\n", "\n"], {"raster": "stdout"}),
                           (["\n", "\n"], {"ocr": "nonzero"}),
                           (["api_key=secret material here", "\n"], {}),
                           (["page one has useful native text\fpage two", "\n"], {}),
                           (["\n", "\n"], {"info": b"Pages: 2\nEncrypted: no\nUnknown: value\n"}),
                           (["\n", "\n"], {"info": b"Pages: 2\nEncrypted: no\nPages: 2\n"})):
                texts, options = values
                with self.subTest(texts=texts, options=options), self.assertRaises(ProductionExtractionError):
                    attempt(texts, **options)
            for malformed in (b"", b"%PD", b"not a pdf"):
                with self.subTest(malformed=malformed), self.assertRaises(ProductionExtractionError):
                    extract_pdf(malformed, pdf_descriptor(source), config=config(),
                        pdfinfo_executable=paths["pdfinfo"], pdftotext_executable=paths["pdftotext"],
                        pdftoppm_executable=paths["pdftoppm"], poppler_version="poppler 25.0",
                        ocr_executable=paths["tesseract"], languages=("eng",), installed_languages=("eng",),
                        tesseract_version="tesseract 5")

    def test_red_pdf_rejects_metadata_tools_and_source_failures(self):
        source = b"%PDF-1.7\nfixture"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {}
            for name in ("pdfinfo", "pdftotext", "pdftoppm", "tesseract"):
                path = root / name; path.write_text("#!/bin/sh\n"); path.chmod(0o700); paths[name] = str(path)

            def attempt(info, *, raw=source, **extra):
                def runner(argv, **kwargs):
                    if Path(argv[0]).name == "pdfinfo": return info
                    return subprocess.CompletedProcess(argv, 0, b"", b"")
                return extract_pdf(raw, pdf_descriptor(source), config=config(),
                                   pdfinfo_executable=paths["pdfinfo"], pdftotext_executable=paths["pdftotext"],
                                   pdftoppm_executable=paths["pdftoppm"], poppler_version="poppler 25.0",
                                   ocr_executable=paths["tesseract"], languages=("eng",), installed_languages=("eng",),
                                   tesseract_version="tesseract 5", runner=runner, **extra)

            bad_info = (
                b"Pages: 0\nEncrypted: no\n", b"Pages: 1001\nEncrypted: no\n",
                b"Pages: 2\nPages: 2\nEncrypted: no\n", b"Pages: 2\nEncrypted: yes\n",
                b"Pages: two\nEncrypted: no\n", b"Seiten: 2\nEncrypted: no\n",
            )
            for output in bad_info:
                with self.subTest(output=output), self.assertRaises(ProductionExtractionError):
                    attempt(subprocess.CompletedProcess([], 0, output, b""))
            with self.assertRaises(ProductionExtractionError):
                attempt(subprocess.CompletedProcess([], 1, b"", b""))
            with self.assertRaises(ProductionExtractionError):
                attempt(subprocess.CompletedProcess([], 0, "not bytes", b""))
            with self.assertRaises(ProductionExtractionError):
                attempt(subprocess.CompletedProcess([], 0, b"Pages: 1\nEncrypted: no\n", b""), raw=source + b"changed")
            with self.assertRaises(ProductionExtractionError):
                extract_pdf(source, pdf_descriptor(source), config=config(), pdfinfo_executable="/missing/pdfinfo",
                            pdftotext_executable=paths["pdftotext"], pdftoppm_executable=paths["pdftoppm"],
                            poppler_version="poppler 25.0", ocr_executable=paths["tesseract"], languages=("eng",),
                            installed_languages=("eng",), tesseract_version="tesseract 5")
    def test_red_signature_codec_digest_and_decode_limits(self):
        for source, codec in ((PNG, "png"), (JPEG, "jpeg"), (WEBP, "webp")):
            image = decode_image(source, decoder=lambda raw, c=codec: (c, 10, 10, "RGB", object()))
            self.assertEqual((image.format, image.source_sha256), (codec, hashlib.sha256(source).hexdigest()))
        for source in (b"", b"\x89PNG", b"RIFFxxxxWEPB", b"\xff\xd8nope"):
            with self.assertRaises(ProductionExtractionError): decode_image(source, decoder=lambda raw: ("png", 1, 1, "RGB", object()))
        for response in (("jpeg", 1, 1, "RGB", object()), ("png", 0, 1, "RGB", object()),
                         ("png", 1, 1, "CMYK", object()), ("png", 101, 10, "RGB", object())):
            with self.assertRaises(ProductionExtractionError):
                decode_image(PNG, limits={"max_decoded_pixels": 1000, "max_image_dimension": 100}, decoder=lambda raw, r=response: r)
        with self.assertRaises(ProductionExtractionError): decode_image(PNG, expected_sha256="0" * 64, decoder=lambda raw: ("png", 1, 1, "RGB", object()))
        with self.assertRaisesRegex(ProductionExtractionError, "image codec unavailable"): decode_image(PNG)
        with self.assertRaises(ProductionExtractionError): decode_image(PNG, decoder=lambda raw: (_ for _ in ()).throw(RuntimeError("bomb")))
        with self.assertRaises(ProductionExtractionError):
            decode_image(PNG, decoder=lambda raw: (warnings.warn("bomb"), ("png", 1, 1, "RGB", object()))[1])

    def test_red_tiler_complete_and_bounded(self):
        self.assertEqual(tile_image(5, 4, 10, 2), (Tile(0, 0, 5, 4),))
        self.assertEqual(tile_image(5, 10, 10, 2), (Tile(0, 0, 5, 10),))
        tiles = tile_image(5, 25, 10, 2)
        self.assertEqual(tiles, (Tile(0, 0, 5, 10), Tile(0, 8, 5, 10), Tile(0, 16, 5, 9)))
        self.assertEqual(set().union(*(set(range(tile.top, tile.top + tile.height)) for tile in tiles)), set(range(25)))
        for args in ((0, 1, 2, 1), (1, 0, 2, 1), (1, 1, 0, 0), (1, 1, 2, 2)):
            with self.assertRaises(ProductionExtractionError): tile_image(*args)

    def test_red_tsv_hierarchy_unicode_bounds_and_exact_deduplication(self):
        good = HEADER + (b"1\t1\t0\t0\t0\t0\t0\t0\t20\t20\t-1\t\n"
                         b"2\t1\t1\t0\t0\t0\t0\t0\t20\t20\t-1\t\n"
                         b"5\t1\t1\t1\t1\t1\t1\t1\t2\t2\t0.000000\t\n"
                         b"5\t1\t1\t1\t1\t2\t2\t3\t4\t5\t91.5\tHello\n")
        word = parse_tsv(good, Tile(0, 100, 20, 20), (20, 200))[0]
        self.assertEqual((word.text, word.confidence, word.region), ("Hello", .915, (2, 103, 4, 5)))
        bad = (b"bad", HEADER + b"5\t1\n", HEADER + b"5\t01\t1\t1\t1\t1\t1\t1\t2\t2\t9\tword\n",
               HEADER + b"6\t1\t0\t0\t0\t0\t0\t0\t1\t1\t-1\t\n",
               HEADER + b"5\t1\t1\t1\t1\t1\t19\t1\t2\t2\t9\tword\n",
               HEADER + "5\t1\t1\t1\t1\t1\t1\t1\t2\t2\t9\tab\u202ecd\n".encode(),
               HEADER + b"5\t1\t1\t1\t1\t1\t1\t1\t2\t2\t9\tapi_key=x\n")
        for payload in bad:
            with self.assertRaises(ProductionExtractionError): parse_tsv(payload, Tile(0, 0, 20, 20), (20, 20))
        same, lower = OcrWord("Same", .5, 1, 1, 2, 2), OcrWord("same", .5, 1, 1, 2, 2)
        self.assertEqual(deduplicate_words((same, same, lower)), (same, lower))

    def test_red_public_values_are_validated_and_raw_free(self):
        image = DecodedImage(hashlib.sha256(PNG).hexdigest(), "png", 20, 20, "RGB")
        word = OcrWord("word", .5, 1, 1, 2, 2)
        result = RasterExtraction(image.source_sha256, "ocr-tesseract-tsv", "production-raster-ocr-v1", "a" * 64,
                                  "tesseract 5.0", hashlib.sha256(b"tesseract 5.0").hexdigest(), 20, 20,
                                  (Tile(0, 0, 20, 20),), (word,), "word", .5)
        self.assertNotIn("fixture", repr(result)); self.assertNotIn("raster", repr(image))
        for values in (("bad", "png", 1, 1, "RGB"), ("a" * 64, "gif", 1, 1, "RGB"), ("a" * 64, "png", 0, 1, "RGB")):
            with self.assertRaises(ProductionExtractionError): DecodedImage(*values)
        for values in (("word", 2.0, 1, 1, 1, 1), ("\ud800", .5, 1, 1, 1, 1), ("word", .5, 0, 1, 0, 1)):
            with self.assertRaises(ProductionExtractionError): OcrWord(*values)
        invalid_results = (
            {"method": "unknown"}, {"extractor_version": "unknown"},
            {"config_sha256": "bad"}, {"tool_version": "bad\nversion"},
            {"tool_version_sha256": "b" * 64}, {"width": 0},
            {"tiles": (Tile(0, 1, 20, 19),)},
            {"words": (OcrWord("word", .5, 19, 1, 2, 2),)},
            {"text": "different"}, {"confidence": .4},
        )
        fields = {
            "source_sha256": image.source_sha256,
            "method": "ocr-tesseract-tsv",
            "extractor_version": "production-raster-ocr-v1",
            "config_sha256": "a" * 64,
            "tool_version": "tesseract 5.0",
            "tool_version_sha256": hashlib.sha256(b"tesseract 5.0").hexdigest(),
            "width": 20,
            "height": 20,
            "tiles": (Tile(0, 0, 20, 20),),
            "words": (word,),
            "text": "word",
            "confidence": .5,
        }
        for change in invalid_results:
            with self.subTest(change=change), self.assertRaises(ProductionExtractionError):
                RasterExtraction(**(fields | change))

    def test_red_runner_validates_paths_languages_and_bounded_results(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); executable = root / "tesseract"; image = root / "in.png"
            executable.write_text("#!/bin/sh\n"); executable.chmod(0o700); image.write_bytes(PNG)
            calls = []
            def runner(argv, **kwargs):
                calls.append((argv, kwargs)); return subprocess.CompletedProcess(argv, 0, b"tsv", b"")
            self.assertEqual(run_tesseract(image, executable=str(executable), languages=("eng",), installed_languages=("eng",), tool_version="tesseract 5", timeout_seconds=1, runner=runner), b"tsv")
            self.assertEqual(calls[0][0], [str(executable), str(image), "stdout", "-l", "eng", "tsv"]); self.assertFalse(calls[0][1]["shell"])
            for languages, installed in (((), ("eng",)), (("eng", "deu"), ("deu", "eng")), (("fra",), ("eng",))):
                with self.assertRaises(ProductionExtractionError): run_tesseract(image, executable=str(executable), languages=languages, installed_languages=installed, tool_version="tesseract 5", timeout_seconds=1, runner=runner)
            for response in (subprocess.CompletedProcess([], 1, b"", b""), subprocess.CompletedProcess([], 0, "bad", b""), subprocess.CompletedProcess([], 0, b"x" * 20, b"")):
                with self.assertRaises(ProductionExtractionError): run_tesseract(image, executable=str(executable), languages=("eng",), installed_languages=("eng",), tool_version="tesseract 5", timeout_seconds=1, max_output_bytes=10, runner=lambda *args, r=response, **kwargs: r)
            killed = []
            class Running:
                pid = 123
                def poll(self): return None
                def wait(self): return -9
            def factory(argv, **kwargs):
                kwargs["stdout"].write(b"x" * 11); kwargs["stdout"].flush()
                return Running()
            with self.assertRaises(ProductionExtractionError):
                run_tesseract(image, executable=str(executable), languages=("eng",), installed_languages=("eng",), tool_version="tesseract 5", timeout_seconds=1, max_output_bytes=10, process_factory=factory, kill_group=killed.append)
            self.assertEqual(killed, [123])

    def test_real_runner_hard_bounds_output_timeout_and_scratch(self):
        before = set(Path(tempfile.gettempdir()).glob("ice-maker-ocr-*"))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / "tesseract"
            image = root / "in.png"
            image.write_bytes(PNG)
            executable.write_text("#!/bin/sh\n/usr/bin/printf '%064d' 0\n")
            executable.chmod(0o700)
            with self.assertRaisesRegex(ProductionExtractionError, "output exceeds limit"):
                run_tesseract(
                    image,
                    executable=str(executable),
                    languages=("eng",),
                    installed_languages=("eng",),
                    tool_version="tesseract 5",
                    timeout_seconds=2,
                    max_output_bytes=10,
                )
            executable.write_text("#!/bin/sh\n/bin/sleep 2\n")
            with self.assertRaisesRegex(ProductionExtractionError, "timed out"):
                run_tesseract(
                    image,
                    executable=str(executable),
                    languages=("eng",),
                    installed_languages=("eng",),
                    tool_version="tesseract 5",
                    timeout_seconds=1,
                    max_output_bytes=10,
                )
        self.assertEqual(
            set(Path(tempfile.gettempdir()).glob("ice-maker-ocr-*")),
            before,
        )

    def test_red_integrated_operation_rebinds_tiles_and_refuses_partial_output(self):
        class FakeRaster: pass
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "tesseract"; executable.write_text("#!/bin/sh\n"); executable.chmod(0o700)
            seen = []
            def encoder(raster, tile, path, codec): path.write_text(str(tile.top))
            def runner(argv, **kwargs):
                top = int(Path(argv[1]).read_text()); seen.append(top); local_top = 7 if top == 0 else 1
                return subprocess.CompletedProcess(argv, 0, HEADER + f"5\t1\t1\t1\t1\t1\t1\t{local_top}\t2\t1\t50\tSame\n".encode(), b"")
            result = extract_raster(PNG, descriptor(), config=config(), executable=str(executable), languages=("eng",), installed_languages=("eng",), tool_version="tesseract 5", runner=runner, decoder=lambda raw: ("png", 10, 12, "RGB", FakeRaster()), tile_encoder=encoder)
            self.assertEqual(seen, [0, 6]); self.assertEqual(len(result.words), 1); self.assertEqual(result.words[0].region, (1, 7, 2, 1)); self.assertEqual(result.confidence, .5)
            with self.assertRaises(ProductionExtractionError): extract_raster(JPEG, descriptor(), config=config(), executable=str(executable), languages=("eng",), installed_languages=("eng",), tool_version="tesseract 5", runner=runner, decoder=lambda raw: ("jpeg", 10, 12, "RGB", FakeRaster()), tile_encoder=encoder)
            with self.assertRaisesRegex(ProductionExtractionError, "produced no words"):
                extract_raster(PNG, descriptor(), config=config(), executable=str(executable), languages=("eng",), installed_languages=("eng",), tool_version="tesseract 5", runner=lambda argv, **kwargs: subprocess.CompletedProcess(argv, 0, HEADER, b""), decoder=lambda raw: ("png", 10, 12, "RGB", FakeRaster()), tile_encoder=encoder)
            with self.assertRaises(ProductionExtractionError): extract_raster(PNG, descriptor(), config=config(), executable=str(executable), languages=("eng",), installed_languages=("eng",), tool_version="tesseract 5", runner=runner, decoder=lambda raw: ("png", 10, 12, "RGB", FakeRaster()), tile_encoder=encoder, max_workers=3)

    def test_red_integrated_operation_derives_tile_height_from_pixel_limit(self):
        class FakeRaster: pass
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "tesseract"
            executable.write_text("#!/bin/sh\n")
            executable.chmod(0o700)
            seen = []

            def encoder(raster, tile, path, codec):
                seen.append(tile)
                path.write_text(str(tile.top))

            def runner(argv, **kwargs):
                return subprocess.CompletedProcess(
                    argv,
                    0,
                    HEADER + b"5\t1\t1\t1\t1\t1\t1\t1\t2\t1\t50\tWord\n",
                    b"",
                )

            result = extract_raster(
                PNG,
                descriptor(),
                config=config(max_decoded_pixels=1000),
                executable=str(executable),
                languages=("eng",),
                installed_languages=("eng",),
                tool_version="tesseract 5",
                runner=runner,
                decoder=lambda raw: ("png", 20, 12, "RGB", FakeRaster()),
                tile_encoder=encoder,
            )

        self.assertEqual([tile.top for tile in seen], [0, 2, 4, 6, 8])
        self.assertTrue(all(tile.width * tile.height <= 80 for tile in seen))
        self.assertEqual(result.tiles, tuple(seen))

    def test_red_integrated_operation_bounds_utf8_and_runs_sequentially(self):
        class FakeRaster: pass
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "tesseract"
            executable.write_text("#!/bin/sh\n")
            executable.chmod(0o700)
            active = 0
            maximum_active = 0
            scratch_roots = []

            def encoder(raster, tile, path, codec):
                scratch_roots.append(path.parent)
                path.write_bytes(PNG)

            def runner(argv, **kwargs):
                nonlocal active, maximum_active
                active += 1
                maximum_active = max(maximum_active, active)
                try:
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        HEADER + ("5\t1\t1\t1\t1\t1\t1\t1\t2\t1\t50\t" + "界" * 50 + "\n").encode(),
                        b"",
                    )
                finally:
                    active -= 1

            with self.assertRaisesRegex(ProductionExtractionError, "output exceeds limit"):
                extract_raster(
                    PNG,
                    descriptor(),
                    config=config(max_ocr_output_bytes=300),
                    executable=str(executable),
                    languages=("eng",),
                    installed_languages=("eng",),
                    tool_version="tesseract 5",
                    runner=runner,
                    decoder=lambda raw: ("png", 10, 12, "RGB", FakeRaster()),
                    tile_encoder=encoder,
                    max_workers=2,
                )
            self.assertEqual(maximum_active, 1)
            self.assertTrue(scratch_roots)
            self.assertTrue(all(not root.exists() for root in scratch_roots))

    def test_red_configuration_is_exact_and_image_dimension_is_tracked(self):
        base = config()
        for bad in (
            {"schema_version": "bad", "limits": base["limits"]},
            {"schema_version": base["schema_version"], "limits": dict(base["limits"]) | {"unknown": 1}},
            {"schema_version": base["schema_version"], "limits": {k: v for k, v in base["limits"].items() if k != "max_image_dimension"}},
            config(max_image_dimension=True),
            config(max_image_dimension=100_001),
        ):
            with self.assertRaises(ProductionExtractionError):
                extract_raster(
                    PNG,
                    descriptor(),
                    config=bad,
                    executable="/missing/tesseract",
                    languages=("eng",),
                    installed_languages=("eng",),
                    tool_version="tesseract 5",
                    decoder=lambda raw: ("png", 10, 10, "RGB", object()),
                )


if __name__ == "__main__": unittest.main()
