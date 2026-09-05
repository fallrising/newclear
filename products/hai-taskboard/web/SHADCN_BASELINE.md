# Controlled shadcn-compatible source baseline

This fixture shell uses a committed-source equivalent of the shadcn `base` preset rather than
running a mutable registry generator during implementation. `components.json` fixes the intended
configuration: shadcn CLI `4.21.0`, official registry identity `https://ui.shadcn.com/r`,
Vite/React, preset/style `base`, base colour `slate`, icon choice `lucide`, CSS variables, and no
RSC. The small `Button`, `Badge`, and `Card` primitives are source-owned, semantic React components
with the same project-local `components/ui` layout; no shadcn runtime package is used.

The corresponding controlled generation recipe, if a source refresh is intentionally approved, is:

```text
pnpm dlx shadcn@4.21.0 init --base base --icon-library lucide
```

It must use registry `https://ui.shadcn.com/r` and the exact committed `components.json` choices,
review the registry response before writing, and update this hash register and the lockfile in the
same reviewed change. It is not run in CI and was not run for this source-equivalent bootstrap: no
registry request or response was used, so no moving registry response is represented as a
reproducible input.

SHA-256 register after source formatting:

| File                           | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `components.json`              | `98d222b34ddb07037d5077718cd403dc802e87431c0821aa1efab6feccec0919` |
| `src/components/ui/button.tsx` | `1bbf24402b06068445cff8d14697044a153ae671311cd31ce09eb47343eb2fd4` |
| `src/components/ui/badge.tsx`  | `0e219c3367ce0766f1d0598a05d96d8d5936782ab3c14414f04a4faef562d259` |
| `src/components/ui/card.tsx`   | `36ae3c672b153c8cb34fff1309f6aadfc2c4582886f1cda97bb8686143dfb656` |
| `src/styles.css`               | `91795c7511551720df4b6a10af642ef0d74d207255d0af879665cba6da7ae73a` |
