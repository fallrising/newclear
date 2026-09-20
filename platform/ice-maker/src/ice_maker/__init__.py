"""Local-first SDD validation primitives."""

from .sdd import ValidationIssue, ValidationResult, parse_front_matter, validate_sdd
from .cli import main

__all__ = ["ValidationIssue", "ValidationResult", "parse_front_matter", "validate_sdd", "main"]
