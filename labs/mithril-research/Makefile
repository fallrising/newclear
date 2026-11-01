.PHONY: check demo

check:
	PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v

demo:
	PYTHONDONTWRITEBYTECODE=1 python3 scripts/demo.py --output "$(DEMO_OUTPUT)"
