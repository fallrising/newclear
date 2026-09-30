# Interface brief

Status: design input; rendered verification pending.

The owner’s main task is to find a saved script, inspect its exact revision, and assemble a runbook whose steps keep those revisions. The interface is an operator notebook: a readable index beside precise code and ordered instructions. No execution button or live terminal is present.

## Structure

- Shared header: spring-pool, Scripts, Runbooks, Audit. Keep primary navigation usable on narrow screens. Local development displays a LOCAL AUTH MODE banner.
- Script index: page title, New script action, title/tag search, archive filter, then a semantic list/table with title, language, revision and tags. An empty index explains the first paste/file operation and exposes the same create action.
- Script editor: labelled Title, Description, Tags, Language, Script content and Upload file controls; Save script is the primary action. Display field errors beside controls and a summary with focus. Preserve entered content on validation/conflict. Archive is a separate labelled form and retains historical revisions.
- Script detail: title/revision/archive state above escaped code; edit, history and archive actions grouped by purpose. Long code scrolls inside its own labelled region without widening the page.
- Runbook editor: title/description, then numbered fieldsets with Script, Revision, Instruction. Add step and explicit Up/Down/Remove controls work without JavaScript. Save runbook is the only operation that persists the draft. Never silently replace a pinned revision with the script head.
- Runbook detail: ordered steps, visible pinned revision, instructions and export action. History shows earlier revisions. Export Markdown downloads a file rather than rendering user-authored HTML.
- Audit: compact time/action/entity/revision rows, no script bodies or instructions.

## Visual choices

Use a warm light canvas, white content surfaces, charcoal text, muted slate utility text, thin neutral dividers and a deep teal primary action. Archive/error controls use a distinct dark red. Keep corners small and avoid decorative gradients, card grids or dashboard statistics. Use a local system sans stack with a clear title/body/utility scale; code uses the local monospace stack. Define named CSS variables for surface/text/border/focus/action/status colors and spacing. Dark mode may follow the operating system, but both schemes must preserve readable contrast.

## Interaction and responsive constraints

Semantic header/nav/main landmarks, one H1 per page, explicit form labels, fieldset legends and visible focus. Buttons need generous touch targets; no hover-only or drag-only action. Layout reflows at 390px, 768px and 1440px. At mobile width, the index becomes stacked rows and action groups wrap; ordered step controls remain adjacent to their step. Respect reduced motion. Loading/error/empty/archive/conflict states describe the observed outcome; never show a saved state before the API returns success.

Runtime dependencies remain Hono only. No remote fonts, imagery, analytics or component libraries. Hono JSX escapes every user field. The existing auth.ts and csrf.ts modules are lead-owned read-only inputs for the UI worker; connect them before any route including assets and health. Never proxy browser identity headers to the API.

## Rendered evidence required

Use the requested codex-ui-design and codex-ui-evidence workflows. Capture desktop/mobile list, detail and step editor after real local integration. Inspect PNGs for hierarchy/clipping/contrast and review browser-health JSON for overflow, exceptions and failed requests. Run the no-JS happy path, literal XSS display and two-tab conflict E2E journeys. These artifacts remain pending until the interface exists; static checks are not visual acceptance.
