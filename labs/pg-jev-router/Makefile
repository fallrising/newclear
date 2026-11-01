.PHONY: check demo integration
check:
	python3 -m unittest discover -s tests -v
	bash -n scripts/integration.sh scripts/container-test.sh

demo:
	python3 demo.py

integration:
	bash scripts/integration.sh
