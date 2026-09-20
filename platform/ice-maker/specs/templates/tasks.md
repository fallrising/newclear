# <Feature title> executable tasks

Each task must fit one bounded agent run (normally 30–60 minutes), have one
ownership boundary, and state a one-sentence acceptance outcome.

- [ ] T-001 <imperative task title>
  - Depends on: none
  - Allowed paths: src/<component>/**, tests/<component>/**
  - Acceptance: <observable result and required test>
  - Suggested role: <role alias>
  - Max attempts: 2
  - Required commands: <command>

- [ ] T-002 <imperative task title>
  - Depends on: T-001
  - Allowed paths: <relative paths>
  - Acceptance: <observable result and required test>
  - Suggested role: <role alias>
  - Max attempts: 2
  - Required commands: <command>

## Task-to-requirement mapping

| Task | Requirements | Acceptance evidence |
|---|---|---|
| T-001 | FR-1 | <result evidence identifier> |
