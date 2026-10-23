# Issue #526 delivery evidence

The common `python3 scripts/check_indexes.py` entrypoint runs the unchanged project-success and llms validators, reports both failures, and never passes `--write-index`. The existing Project success contracts CI job calls the same entrypoint. Maintenance instructions describe new component registration, explicit index generation, navigation repairs and the working-tree/index boundary.

Local verification on the candidate based on `11931293eb7318f1380d4f62df8e805da2b9441e`:

- `python3 -m unittest discover -s scripts/tests -p test_index_preflight.py -v`: RED, five failures before the entrypoint existed.
- `python3 -m unittest discover -s scripts/tests -v`: GREEN, 20 tests passed, including actual-validator negative fixtures and file/index immutability.
- `python3 scripts/check_indexes.py`: passed, 42 project contracts and five llms files, zero diagnostics.
- `git diff --check`: passed.
- An independent read-only reviewer reran all 20 tests, candidate validation and whitespace checks and recommended ACCEPT with no findings.

The command validates working-tree bytes with the existing Git-index file enumeration for llms files. It does not claim to validate partially staged bytes. This is documented; a clean candidate checkout gives CI the same content. No product runtime acceptance is implied. Remote CI and merge are recorded by the PR timeline.
