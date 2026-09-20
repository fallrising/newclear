import sys
from types import SimpleNamespace

from ocr_service.backends.paddle_structure import PaddleStructureBackend
from ocr_service.backends.rapidocr import RapidOCRBackend
from ocr_service.backends.tesseract import TesseractBackend
from ocr_service.config import Settings


class AmbiguousSequence(list[object]):
    def __bool__(self) -> bool:
        raise ValueError("truth value is ambiguous")


def test_rapidocr_normalizes_line_polygons_and_scores() -> None:
    output = SimpleNamespace(
        boxes=(((1, 2), (9, 2), (9, 8), (1, 8)),),
        txts=("快速辨識",),
        scores=(0.91234,),
    )

    result = RapidOCRBackend.normalize_output(output, width=20, height=10)

    assert result.regions[0].text == "快速辨識"
    assert result.regions[0].confidence == 0.91234
    assert result.regions[0].polygon == ((1, 2), (9, 2), (9, 8), (1, 8))


def test_rapidocr_accepts_numpy_like_sequences() -> None:
    output = SimpleNamespace(
        boxes=AmbiguousSequence([((1, 2), (9, 2), (9, 8), (1, 8))]),
        txts=AmbiguousSequence(["array output"]),
        scores=AmbiguousSequence([0.8]),
    )

    result = RapidOCRBackend.normalize_output(output, width=20, height=10)

    assert result.regions[0].text == "array output"


def test_tesseract_groups_words_into_lines_and_normalizes_confidence() -> None:
    data = {
        "page_num": [1, 1, 1],
        "block_num": [1, 1, 1],
        "par_num": [1, 1, 1],
        "line_num": [1, 1, 2],
        "left": [2, 10, 2],
        "top": [3, 3, 20],
        "width": [6, 8, 6],
        "height": [7, 7, 7],
        "conf": [90.0, 80.0, -1.0],
        "text": ["hello", "world", ""],
    }

    result = TesseractBackend.normalize_output(data, width=30, height=40)

    assert len(result.regions) == 1
    assert result.regions[0].text == "hello world"
    assert result.regions[0].confidence == 0.85
    assert result.regions[0].polygon == ((2, 3), (18, 3), (18, 10), (2, 10))


def test_tesseract_reports_the_engine_binary_version(monkeypatch) -> None:
    fake_module = SimpleNamespace(
        get_tesseract_version=lambda: "5.5.0",
        get_languages=lambda config: ["eng", "chi_tra"],
    )
    monkeypatch.setitem(sys.modules, "pytesseract", fake_module)

    backend = TesseractBackend.create(
        Settings(
            backend="tesseract",
            api_key="0123456789abcdef",
            tesseract_languages="chi_tra+eng",
        )
    )

    assert backend.version == "5.5.0"


def test_paddle_structure_normalizes_ocr_layout_and_markdown() -> None:
    payload = {
        "res": {
            "overall_ocr_res": {
                "rec_texts": ["表格內容"],
                "rec_scores": [0.97],
                "rec_polys": [[[1, 2], [9, 2], [9, 8], [1, 8]]],
            },
            "layout_det_res": {
                "boxes": [
                    {
                        "label": "table",
                        "score": 0.91,
                        "coordinate": [1, 2, 9, 8],
                    }
                ]
            },
        }
    }
    markdown = {"markdown_texts": "|欄位|\n|---|\n|值|"}

    result = PaddleStructureBackend.normalize_output(
        payload, markdown, width=20, height=10
    )

    assert result.regions[0].text == "表格內容"
    assert result.structured is not None
    assert result.structured.markdown.startswith("|欄位|")
    assert result.structured.blocks[0].block_type == "table"
    assert result.structured.blocks[0].polygon == (
        (1, 2),
        (9, 2),
        (9, 8),
        (1, 8),
    )


def test_paddle_structure_omits_local_markdown_image_references() -> None:
    result = PaddleStructureBackend.normalize_output(
        {"res": {}},
        {"markdown_texts": "before ![asset](output/private.png) after"},
        width=20,
        height=10,
    )

    assert result.structured is not None
    assert result.structured.markdown == "before  after"
