.PHONY: check preflight integration integration-restore

check:
	PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v

preflight:
	PYTHONDONTWRITEBYTECODE=1 python3 lab.py preflight

integration:
	PYTHONDONTWRITEBYTECODE=1 python3 lab.py integration $(LAB_ARGS)

integration-restore:
	PYTHONDONTWRITEBYTECODE=1 python3 lab.py integration-restore $(LAB_ARGS)
