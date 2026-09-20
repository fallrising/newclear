# Local publication rebuild

Publication artifacts are disposable generated views. The only inputs are the
tracked manifests under `books/` and tracked knowledge records under
`knowledge/50-patterns/`. Generated Markdown and HTML are ignored below
`.ice-maker/publications/` and must never be edited or used as compiler input.

## Rebuild both books

From the repository root, choose the source commit being documented and run:

```sh
rm -rf .ice-maker/publications
SOURCE_COMMIT=0123456789abcdef0123456789abcdef01234567
for manifest in books/system-design.json books/reliability-patterns.json; do
  PYTHONPATH=src python3 -m ice_maker.publication_cli \
    --repository-root . \
    --manifest "$manifest" \
    --output-root .ice-maker/publications \
    --source-commit "$SOURCE_COMMIT"
done
```

This cleanup target is deliberately limited to the generated publications
directory; do not recursively remove `.ice-maker` or its unrelated runtime
state.

The command publishes each book as a complete pair:
`.ice-maker/publications/<manifest-id>/book.md` and `book.html`. Delete the
output root before rebuilding; an existing book directory is intentionally a
collision and is never overwritten. Re-running after deletion with identical
tracked inputs and source commit produces byte-identical files.

## External-pending gates

The shared `synthetic-idempotency` record is explicitly marked synthetic Phase
5 evidence. It is not production experience and a manifest cannot relabel it.
Local compilation does not grant rights to publish it. Before any external
release, an operator must complete source-by-source rights and privacy review,
verify provenance and permitted transformations, obtain curator and
independent-critic review plus human approval identities, and retain the audit
record. A release also requires an approved signing identity and signature
verification, followed by the separately authorized publishing target and
operator deployment gate. EPUB/PDF generation, object storage, CDN, signing,
and public publishing are outside this local compiler.
