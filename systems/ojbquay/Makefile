COMPOSE := docker compose -f deploy/compose/docker-compose.yml

.PHONY: up down demo demo-down e2e generate-proto validate-deploy

up:
	$(COMPOSE) up -d --build --wait

down:
	$(COMPOSE) down

demo:
	./demo/run.sh

demo-down:
	./demo/down.sh

e2e:
	./e2e/compose_full.sh

generate-proto:
	./sdk/go/generate-proto.sh

validate-deploy:
	$(COMPOSE) config --quiet
	./deploy/validate.sh
