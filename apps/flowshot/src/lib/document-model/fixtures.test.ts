import { describe, expect, it } from 'vitest';
import { buildDocumentModel } from './index';
const fixtures = import.meta.glob('../../../fixtures/markdown/*.md', { query: '?raw', import: 'default', eager: true });
const names = ['gfm','unicode','security','adapters'];
describe('four synthetic canonical regression fixtures', () => {
  for (const name of names) it(`${name}: snapshot and 100-repeat determinism`, () => {
    const source = fixtures[`../../../fixtures/markdown/${name}.md`] as string;
    const first = buildDocumentModel(source);
    expect(first).toMatchSnapshot();
    const expected = JSON.stringify(first);
    for (let i = 0; i < 100; i++) expect(JSON.stringify(buildDocumentModel(source))).toBe(expected);
  });
});
