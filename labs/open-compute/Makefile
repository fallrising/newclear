.PHONY: check preflight integration integration-restore integration-resources integration-storage integration-crash

check:
	PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v

preflight:
	PYTHONDONTWRITEBYTECODE=1 python3 lab.py preflight

integration:
	PYTHONDONTWRITEBYTECODE=1 python3 lab.py integration $(LAB_ARGS)

integration-restore:
	PYTHONDONTWRITEBYTECODE=1 python3 lab.py integration-restore $(LAB_ARGS)

integration-resources:
	PYTHONDONTWRITEBYTECODE=1 python3 lab.py integration-resources $(LAB_ARGS)

integration-storage:
	PYTHONDONTWRITEBYTECODE=1 python3 lab.py integration-storage $(LAB_ARGS)

integration-crash:
	PYTHONDONTWRITEBYTECODE=1 python3 lab.py integration-crash $(LAB_ARGS)
