/** Vite5's config bundler writes adjacent to vite.config.ts. Load the pinned equivalent in review only. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const originalConfigSha256 = 'e3c18a83e6de2d367810fd2324d7a4cf14246d9b679cc5d97f11d5860631ff2d';
export function pinnedOptions(bytes, react) {
  if (createHash('sha256').update(bytes).digest('hex') !== originalConfigSha256) throw new Error('REVIEW_VITE_CONFIG_DRIFT');
  return { configFile: false, plugins: [react()], clearScreen: false, resolve: { alias: [] }, server: { watch: { ignored: ['**/src-tauri/**'] } } };
}
export async function loadReviewViteConfig(component) {
  const bytes = await readFile(join(component, 'vite.config.ts'));
  const { default: react } = await import(pathToFileURL(join(component, 'node_modules/@vitejs/plugin-react/dist/index.js')));
  return pinnedOptions(bytes, react);
}
