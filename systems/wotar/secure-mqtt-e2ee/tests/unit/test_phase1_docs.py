"""Phase 1: verify requirements and threat model documentation."""

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"

REQUIRED_REQ_IDS = [
    "FR-001",
    "FR-002",
    "FR-003",
    "FR-004",
    "FR-005",
    "FR-006",
    "FR-007",
    "FR-008",
    "FR-009",
    "FR-010",
    "FR-011",
    "FR-012",
    "SEC-001",
    "SEC-002",
    "SEC-003",
    "SEC-004",
    "SEC-005",
    "SEC-006",
    "SEC-007",
    "SEC-008",
    "SEC-009",
    "SEC-010",
    "SEC-011",
    "SEC-012",
    "REL-001",
    "REL-002",
    "REL-003",
    "REL-004",
    "REL-005",
    "OPS-001",
    "OPS-002",
    "OPS-003",
]


@pytest.mark.parametrize("req_id", REQUIRED_REQ_IDS)
def test_requirement_id_documented(req_id: str) -> None:
    content = (DOCS / "requirements.md").read_text()
    assert req_id in content


def test_threat_model_non_goals() -> None:
    content = (DOCS / "threat-model.md").read_text()
    assert "Non-Goals" in content or "non-goals" in content.lower()
    assert "forward secrecy" in content.lower()


def test_adrs_exist() -> None:
    for name in [
        "0001-aes-gcm-siv.md",
        "0002-canonical-cbor.md",
        "0003-ed25519-signatures.md",
        "0004-durable-inbox-outbox.md",
    ]:
        assert (DOCS / "adr" / name).exists()


def test_traceability_covers_all_requirements() -> None:
    content = (DOCS / "traceability.md").read_text()
    for req_id in REQUIRED_REQ_IDS:
        assert req_id in content


def test_progress_doc_exists() -> None:
    content = (DOCS / "progress.md").read_text()
    assert "SDD Phase Tracker" in content
    for phase in range(11):
        assert f"| {phase} |" in content


def test_self_managed_key_design_exists() -> None:
    path = DOCS / "self-managed-key-design.md"
    assert path.exists()
    content = path.read_text()
    assert "FileKeyringProvider" in content
    assert "broker" in content.lower()
