# Reviewed engineering baselines

These three PNGs cover login, the operator home empty panel, and the console people list only. Source/environment, dimensions, input hashes and independent review are in [metadata.json](metadata.json). Font files are listed and hashed in [font-files.json](font-files.json); actual CJK fallback is WenQuanYi Zen Hei, not a claim that the CSS Noto family is installed.

Run/update/adoption policy: [local visual oracle](../../docs/v2/11-visual-oracle.md). Normal checks cannot update these fixtures. Candidates must be generated into protected artifacts and independently reviewed before explicit adoption. Keep native threshold0/maxDiffPixels0 (Pixelmatch includeAA=false, AA-classified pixels excluded), controlled mutation RED, three fresh GREEN runs and unchanged PNG hashes. Engineering adoption does not certify whole-product owner acceptance or a hosted CI gate.
