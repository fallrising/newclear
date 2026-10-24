import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from '../web/node_modules/vite/dist/node/index.js';

const web = fileURLToPath(new URL('../web/', import.meta.url));
const server = await createServer({
  root: web,
  configFile: false,
  cacheDir: fileURLToPath(new URL('runs/.state/vite-store-cache', import.meta.url)),
  server: {middlewareMode: true},
  appType: 'custom',
  logLevel: 'error',
});
const results = [];
const originalConsoleError = console.error;
try {
  const {bookmarkApi} = await server.ssrLoadModule('/src/services/api.ts');
  const {useBookmarkStore: store} = await server.ssrLoadModule('/src/store/bookmarkStore.ts');
  const originals = {...bookmarkApi};
  const initial = store.getState();
  const bookmark = {
    id: 'review-1', title: 'Synthetic bookmark', url: 'http://127.0.0.1:5173/review',
    tags: [], notes: [], createdAt: 1700000000000, updatedAt: 1700000000000,
    favicon: 'http://127.0.0.1:3001/review.svg',
  };
  const cases = [
    ['fetch', 'getAll', 'fetchBookmarks', [1], [bookmark], 'Unable to load bookmarks. Please try again.'],
    ['add', 'create', 'addBookmark', [{...bookmark, id: 'review-2'}], {...bookmark, id: 'review-2'}, 'Unable to add bookmark. Please try again.'],
    ['update', 'update', 'updateBookmark', ['review-1', {title: 'Changed synthetic title'}], {...bookmark, title: 'Changed synthetic title'}, 'Unable to save bookmark. Please try again.'],
    ['delete', 'delete', 'removeBookmark', ['review-1'], undefined, 'Unable to delete bookmark. Please try again.'],
  ];
  for (const [name, method, action, args, response, message] of cases) {
    try {
      store.setState({...initial, bookmarks: [structuredClone(bookmark)], pagination: {...initial.pagination}});
      let calls = 0;
      bookmarkApi[method] = async () => {calls++; throw Error('synthetic failure detail must not reach UI');};
      console.error = () => {};
      await store.getState()[action](...args);
      assert.equal(store.getState().error, message);
      assert.deepEqual(store.getState().bookmarks, [bookmark]);
      assert.equal(store.getState().pagination.isLoading, false);
      assert.equal(calls, 1);
      bookmarkApi[method] = async (...input) => {
        calls++;
        if (name === 'update' || name === 'delete') assert.equal(input[0], bookmark.id);
        if (name === 'add') assert.equal(input[0].id, 'review-2');
        return structuredClone(response);
      };
      await store.getState()[action](...args);
      assert.equal(store.getState().error, null);
      assert.equal(calls, 2);
      assert.equal(store.getState().bookmarks.length, name === 'delete' ? 0 : name === 'add' ? 2 : 1);
      if (name === 'update') assert.equal(store.getState().bookmarks[0].title, 'Changed synthetic title');
      results.push({name: `${name}-failure-data-retention-and-recovery`, status: 'passed'});
    } catch (error) {
      results.push({name: `${name}-failure-data-retention-and-recovery`, status: 'failed', error: String(error)});
    } finally {
      Object.assign(bookmarkApi, originals);
      console.error = originalConsoleError;
    }
  }
  try {
    bookmarkApi.getAll = async () => [];
    await store.getState().fetchBookmarks(1);
    assert.equal(store.getState().error, null);
    assert.deepEqual(store.getState().bookmarks, []);
    assert.equal(store.getState().pagination.isLoading, false);
    assert.equal(store.getState().pagination.hasMore, false);
    results.push({name: 'successful-empty-is-not-error', status: 'passed'});
  } catch (error) {
    results.push({name: 'successful-empty-is-not-error', status: 'failed', error: String(error)});
  } finally {
    Object.assign(bookmarkApi, originals);
  }
} finally {
  console.error = originalConsoleError;
  await server.close();
}
const source = await readFile(new URL('../web/src/store/bookmarkStore.ts', import.meta.url));
console.log(JSON.stringify({sourceSha256: createHash('sha256').update(source).digest('hex'), tests: results}, null, 2));
if (results.some(item => item.status !== 'passed')) process.exitCode = 1;
