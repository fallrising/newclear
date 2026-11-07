# Upstream provenance

This is a localization maintained in `fallrising/newclear`, **not** an official Traditional Chinese edition by the original author.

| Item | Source |
| --- | --- |
| Repository | https://github.com/showheyohtaki/motion-prompt |
| Website | https://showheyohtaki.github.io/motion-prompt/ |
| Imported commit | `770eefb7091cc725ab0eb6d4ef5cbf28b28e282c` |
| Import date | 2026-10-16 |
| Scope | 5 packs, 24 entries each, 120 entries (#001–#120) |
| Author / license | Shohei Ohtaki, © 2026, MIT |

The original import on 2026-10-16 used the pinned commit above. On 2026-10-28, upstream HEAD was checked again and was `bd6bf08d8d412cc82c1bbc8f1a81638617a45cfb`. The approved SDD keeps the original pinned source for this integration; 120-entry coverage refers to that source, not the newer HEAD. Integration date: 2026-10-28. `upstream-lock.json` records original file SHA-256 hashes, canonical metadata hashes and the full ID/slug/name/category mapping.

Imported: all five metadata files and drawing programs; the lightweight runtime; gallery interaction/style structure; favicon; builder and real-browser animation checker; unmodified LICENSE and THIRD-PARTY-NOTICES. Original drawing files are preserved as `packs/*/source.js`; generated `pack.js` and `pack.en.js` contain localized labels and system font stacks. Source comments remain in original files; Japanese comments are omitted from generated standalone code. This does not change drawing geometry, easing or cycle lengths.

Locally added or adapted: complete zh-Hant metadata (120 entries); bilingual UI and canvas locales; template; build validation and generated catalog/API/Markdown; independent prompt language; local subpath links; full-spec multi-pick copying; browser tests, source/numeric checks and verification evidence. English/Japanese metadata is preserved byte-for-content (canonical hash), while generated English prose normalizes references to Japanese sample labels. Typographic specimens such as GLITCH, single Latin glyphs, the four English marquee service names and mock brand/URL text remain intentional sample content; the marquee's measured width and loop behavior are preserved.

Excluded: upstream `.git` / GitHub workflows, promotional GIF/video/image assets, bundled fonts, social examples/embeds (`found`), personal promotional pages, make-your-own materials, Skill, CLI, callback/agent bridge and rendering/export dependencies. The original developer preview is not shipped. The gallery has no analytics, backend, account, LLM API or automatic external requests. External links are explicitly labeled upstream/reference links; local demos and specs remain local.

All shipped sample imagery is drawn by the imported Canvas programs. No social posts, third-party photographs or videos from example pages are redistributed. MIT coverage for repository code is not treated as permission to redistribute referenced media. Preserve [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), including the inspiration credit to Lucian UX/UI Prompt.

To synchronize: fetch upstream into a separate checkout, select a full commit SHA, read its license/notices/contracts and diff metadata plus drawing sources. Keep existing public IDs stable. Update source files and lock hashes only after reviewing changes; translate every new/changed field and label; rebuild and compare output determinism; run data/browser checks and the animation checker against both the chosen upstream version and both local languages. Record differences and inspect representative screenshots. Do not overwrite monorepo root files with an upstream checkout.

Known interpretation boundaries: example requests intentionally use parameters different from the illustrative demo specification. The UI labels these separately. Photography samples are schematic drawings, not a photographic renderer (for example, the butterfly-light demonstration uses a faceless silhouette and a chin shadow while its definition describes the conventional nose shadow). These are inherited illustration choices, not new rendering regressions.
