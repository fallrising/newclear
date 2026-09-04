# Apache 2.0 Product License

## Context

The repository has audited dependency-license evidence but no product-level
license, so users do not yet have an explicit grant to use, modify, or
redistribute ojbquay.

## Goal

License the independently implemented ojbquay product under the Apache License,
Version 2.0.

## Non-goals

- Relicensing third-party dependencies or infrastructure images.
- Adding a project-specific contributor license agreement.
- Changing repository visibility.
- Providing legal advice beyond identifying the applied license.

## Acceptance Criteria

- Given the repository root,
  when a user opens `LICENSE`,
  then it contains the unmodified Apache License 2.0 text.
- Given the README,
  when a user looks for distribution terms,
  then it links to the root license and identifies Apache-2.0.
- Given existing dependencies,
  when the product license is added,
  then their original license obligations remain unchanged.

## Constraints

- Use the standard text published by the Apache Software Foundation.
- Do not add an empty or invented `NOTICE` file; create one only when actual
  attribution notices require it.
- The repository remains private until its owner separately changes
  visibility.

## Assumptions and Unknowns

- The repository owner has authority to select the product license.
- Previously recorded dependency-license categories remain compatible with
  Apache-2.0 distribution.

## Design

Add the canonical license text at `LICENSE` and a short README section linking
to it. The product license covers repository-owned work; dependencies retain
their own terms.

## Steps

1. Add the canonical Apache License 2.0 text.
2. Document the product license in the README.
3. Compare the file with the operating system's canonical Apache-2.0 copy and
   run repository validation.

## Verification

- `cmp LICENSE /usr/share/common-licenses/Apache-2.0`
- `./deploy/validate-brand.sh`
- `git diff --check`
