import { readFileSync } from 'node:fs';
export const baseUrl = 'http://127.0.0.1:5173/dim-gate/';
export const viewports = [{name:'desktop',width:1440,height:900},{name:'tablet',width:834,height:1112},{name:'mobile',width:390,height:844}];
export function reviewUrl(route) {
  if (!route.startsWith('/') || route.startsWith('//') || route.split('/').includes('..') || /[?#\\]/.test(route)) throw new Error('invalid review route');
  return new URL('dim-gate' + route, 'http://127.0.0.1:5173/').href;
}
export function buildPlan() {
  const personas = JSON.parse(readFileSync(new URL('./personas.json', import.meta.url)));
  return Object.entries(personas).flatMap(([persona,pages]) => ['light','dark'].flatMap(theme => viewports.map(viewport => ({persona,theme,viewport,pages}))));
}

export function verifiedCaptureKeys(results) {
  return new Set(results.filter(r => r.screenshot && r.status === 200 && r.theme === r.colorScheme && r.selectedPersona === r.persona && typeof r.heading === 'string' && r.heading.trim()).map(r => [r.persona,r.page,r.viewport,r.colorScheme].join('|')));
}
