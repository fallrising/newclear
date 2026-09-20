.PHONY: check

check:
	PYTHONPATH=src python3 scripts/check_repo.py
	PYTHONPATH=src python3 -m unittest discover -s tests -v
