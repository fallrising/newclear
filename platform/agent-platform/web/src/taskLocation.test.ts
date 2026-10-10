import { expect, it } from 'vitest';
import { readTaskLocation, taskLocationHref } from './taskLocation';

const defaults = { q: '', project_id: '', state: '' };
const project = 'abcdefab-1234-4234-8234-abcdefabcdef';

it('decodes and normalizes filters while ignoring unowned parameters', () => {
  const query = new URLSearchParams({
    q: '  你好 %_\\ + &😀  ',
    project_id: project.toUpperCase(),
    state: 'awaiting_approval',
    cursor: 'ignored',
  });
  expect(readTaskLocation(query.toString())).toEqual({
    filters: { q: '你好 %_\\ + &😀', project_id: project, state: 'awaiting_approval' },
    invalid: false,
  });
  expect(readTaskLocation('?q=%20%20')).toEqual({ filters: defaults, invalid: false });
});

it('counts Unicode code points before trimming and rejects NUL', () => {
  expect(readTaskLocation(new URLSearchParams({ q: '😀'.repeat(200) }).toString()).invalid).toBe(
    false,
  );
  for (const q of ['😀'.repeat(201), ' '.repeat(201), 'okay\0no']) {
    expect(readTaskLocation(new URLSearchParams({ q, state: 'failed' }).toString())).toEqual({
      filters: defaults,
      invalid: true,
    });
  }
});

it.each([
  'q=one&q=two',
  'state=failed&state=failed',
  `project_id=${project}&project_id=${project}`,
  'state=unknown',
  'state=toString',
  'state=',
  'project_id=',
  'project_id=abc',
  'project_id=abcdefab123442348234abcdefabcdef',
  'project_id={abcdefab-1234-4234-8234-abcdefabcdef}',
])('rejects malformed or duplicate owned parameters: %s', (query) => {
  expect(readTaskLocation(query)).toEqual({ filters: defaults, invalid: true });
});

it('serializes literal text and preserves path, hash and duplicate unknown parameters', () => {
  const filters = { q: '你好 %_\\ + &😀', project_id: project, state: 'failed' };
  const href = taskLocationHref(
    'http://localhost/workbench?view=first&q=old&view=second&cursor=other#task-1',
    filters,
  );
  const url = new URL(href, 'http://localhost');
  expect(url.pathname).toBe('/workbench');
  expect(url.hash).toBe('#task-1');
  expect(url.searchParams.getAll('view')).toEqual(['first', 'second']);
  expect(url.searchParams.get('cursor')).toBe('other');
  expect(readTaskLocation(url.search)).toEqual({ filters, invalid: false });
  const cleared = new URL(taskLocationHref(url.href, defaults), url);
  expect([...cleared.searchParams]).toEqual([
    ['view', 'first'],
    ['view', 'second'],
    ['cursor', 'other'],
  ]);
  expect(cleared.hash).toBe('#task-1');
});
