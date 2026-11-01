PYTHON ?= python3
SOURCE ?= .upstream/TokenEconomizer

.PHONY: prepare run check
prepare:
	$(PYTHON) -B source.py --destination "$(SOURCE)"
run:
	$(PYTHON) -B run.py --source "$(SOURCE)"
check:
	TOKEN_ECONOMIZER_SOURCE="$(abspath $(SOURCE))" $(PYTHON) -B -m unittest discover -s tests -v
