import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createServer} from '../web/node_modules/vite/dist/node/index.js';
import react from '../web/node_modules/@vitejs/plugin-react/dist/index.mjs';
import {requireOrigin} from './isolation.mjs';

const web = fileURLToPath(new URL('../web/', import.meta.url));
assert(process.env.FE_REVIEW_STATE_DIR, 'private state is required');
assert.equal(process.env.VITE_API_URL, requireOrigin('http://127.0.0.1:3001', 3001) + '/api');
// Match the existing Vite React plugin and lucide optimization exclusion. A
// programmatic config keeps temporary config/cache files out of readonly source.
const server = await createServer({
  root: web,
  configFile: false,
  cacheDir: join(process.env.FE_REVIEW_STATE_DIR, 'vite-cache'),
  plugins: [react(), {
    name: 'review-local-app-icon',
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (!['/vite.svg', '/review.svg'].includes(req.url)) return next();
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#2563eb"/></svg>');
      });
    },
  }],
  optimizeDeps: {exclude: ['lucide-react']},
  server: {host: '127.0.0.1', port: 5173, strictPort: true},
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {await server.close(); console.log('REVIEW_VITE_CLOSED'); process.exitCode = 0;}
  catch {console.error('REVIEW_VITE_CLOSE_FAILED'); process.exitCode = 1;}
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
await server.listen();
console.log('REVIEW_VITE_READY');
