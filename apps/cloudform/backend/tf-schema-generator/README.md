# TF Schema Generator

Generates Terraform provider schema JSON files used by CloudForm's `TfSchemaParser`.

## How it works

`terraform providers schema -json` only works inside an initialised TF working directory. Each subdirectory here (`alicloud/`, `aws/`) is a minimal TF config that pins one provider version. `generate.sh` runs `terraform init` then `terraform providers schema -json` and writes `{provider}-{version}.json` to `backend/src/main/resources/tf-schemas/` — which is where `ClasspathTfSchemaRepository` reads from at runtime.

The output JSON is committed to the repo. The backend has zero terraform CLI dependency at runtime.

## Usage

```bash
# Requires: terraform >= 1.5, jq
./generate.sh                  # all providers
./generate.sh alicloud         # just one
```

## Adding a new provider

1. `mkdir <name>` and add a `main.tf` with `required_providers` pinning the version.
2. Run `./generate.sh <name>`.
3. Commit the new JSON file under `src/main/resources/tf-schemas/`.

## Why pre-generate vs run at request time

Schema changes ~quarterly per provider; pre-generation gives us:
- Reproducibility — every dev/CI/prod reads the same bytes.
- Auditability — schema upgrades show up as a reviewable diff.
- Lightweight backend — no terraform CLI / network egress required at runtime.

Manual one-off upload remains available via `POST /api/v1/tf-schemas/upload` for cases where pre-generation isn't possible.
