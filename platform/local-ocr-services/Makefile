.PHONY: test compile compose-check check

test:
	docker build --file docker/Dockerfile.test --tag local-ocr-services:test .
	docker run --rm local-ocr-services:test

compile:
	docker run --rm --volume "$(CURDIR):/app:ro" --workdir /app \
		--env PYTHONPATH=/app/src python:3.11-slim \
		python scripts/check_syntax.py src tests

compose-check:
	docker compose config --quiet
	docker compose --profile rapidocr config --services
	docker compose --profile tesseract config --services
	docker compose --profile paddle-structure config --services

check: test compile compose-check
