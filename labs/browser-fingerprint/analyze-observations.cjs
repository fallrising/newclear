'use strict';

const fs = require('node:fs');
const path = require('node:path');

const usage = `Usage: node analyze-observations.cjs [options]

Options:
  --log-dir DIR   Observation directory; overrides LOG_DIR and the active pointer.
  --sample LABEL  Match client.context.sampleLabel (default: computer-use-iab).
  --operator NOTE Optional self-supplied operator note, not a verified identity.
  --help          Show this help without reading or writing observation files.

Directory precedence: --log-dir > LOG_DIR > .runtime/active-log-dir.txt
                      > .runtime/observations in this lab.
Relative --log-dir and LOG_DIR paths use the current working directory.
Relative paths stored in the active pointer use this script's directory.
Observation directories must stay inside this lab and outside public/.
The result is written as analysis.json in the selected observation directory.
Open the page with ?sample=LABEL to record a matching experiment label.`;

function parseOptions(args) {
  const options = { sample: 'computer-use-iab', operator: null, help: false };
  const names = { '--log-dir': 'logDir', '--sample': 'sample', '--operator': 'operator' };
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === '--help') { options.help = true; continue; }
    const separator = argument.indexOf('=');
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const name = Object.hasOwn(names, flag) ? names[flag] : null;
    if (!name) throw new Error(`Unknown option ${flag}. Use --help for usage.`);
    const value = separator === -1 ? args[++i] : argument.slice(separator + 1);
    if (value === undefined || !value.trim() || (separator === -1 && value.startsWith('--'))) {
      throw new Error(`${flag} requires a value. Use --help for usage.`);
    }
    if (name === 'sample' && value.length > 80) throw new Error('--sample must be at most 80 characters, matching the page label limit.');
    if (name === 'operator' && value.length > 2048) throw new Error('--operator must be at most 2048 characters.');
    options[name] = value;
  }
  return options;
}

function insideDirectory(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

const options = parseOptions(process.argv.slice(2));
if (options.help) { console.log(usage); process.exit(0); }

const projectDir = __dirname;
const activeLogPointer = path.join(projectDir, '.runtime', 'active-log-dir.txt');
let requestedLogDir;
let logDirectorySource;
if (options.logDir !== undefined) {
  requestedLogDir = path.resolve(options.logDir);
  logDirectorySource = '--log-dir';
} else if (process.env.LOG_DIR) {
  requestedLogDir = path.resolve(process.env.LOG_DIR);
  logDirectorySource = 'LOG_DIR';
} else if (fs.existsSync(activeLogPointer)) {
  const storedPath = fs.readFileSync(activeLogPointer, 'utf8').trim();
  if (!storedPath) throw new Error('The active observation pointer is empty. Supply --log-dir or LOG_DIR.');
  requestedLogDir = path.resolve(projectDir, storedPath);
  logDirectorySource = 'active-log-dir.txt';
} else {
  requestedLogDir = path.join(projectDir, '.runtime', 'observations');
  logDirectorySource = 'default';
}
const logDir = fs.realpathSync(requestedLogDir);
const realProjectDir = fs.realpathSync(projectDir);
const publicDir = fs.realpathSync(path.join(projectDir, 'public'));
if (!insideDirectory(realProjectDir, logDir) || insideDirectory(publicDir, logDir)) {
  throw new Error('The observation directory must stay inside this lab and outside public/.');
}
if (!fs.statSync(logDir).isDirectory()) throw new Error('The observation path must be a directory.');

const files = Object.fromEntries(['fingerprints', 'events', 'requests'].map(name => {
  const file = fs.realpathSync(path.join(logDir, name + '.jsonl'));
  if (!insideDirectory(logDir, file) || !insideDirectory(realProjectDir, file) || insideDirectory(publicDir, file)) {
    throw new Error('Observation files must stay inside the selected log directory and outside public/.');
  }
  return [name, file];
}));
if (logDirectorySource === 'active-log-dir.txt') files.activeLogPointer = activeLogPointer;
files.analysis = path.join(logDir, 'analysis.json');
if (fs.existsSync(files.analysis) && fs.lstatSync(files.analysis).isSymbolicLink()) {
  throw new Error('Refusing to overwrite an analysis.json symbolic link.');
}

function readJsonl(file) {
  const rows = [];
  const parseErrors = [];
  for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Expected a JSON object');
      rows.push(row);
    } catch (error) {
      // Report locations without echoing a malformed record's sensitive data.
      parseErrors.push({ line: index + 1, error: error.message });
    }
  }
  return { rows, parseErrors };
}

const raw = Object.fromEntries(['fingerprints', 'events', 'requests'].map(name => [name, readJsonl(files[name])]));
const sampleLabel = options.sample;
const fingerprints = raw.fingerprints.rows
  .filter(row => row.client?.context?.sampleLabel === sampleLabel)
  .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
if (!fingerprints.length) throw new Error(`No fingerprint records matched sample label ${JSON.stringify(sampleLabel)}. Open the page with ?sample=${encodeURIComponent(sampleLabel)} before collecting observations.`);

const unique = values => [...new Set(values.filter(value => value !== undefined && value !== null))];
const sessionIds = unique(fingerprints.map(row => row.sessionId));
const runIds = unique(fingerprints.map(row => row.runId));
const fingerprintIds = unique(fingerprints.map(row => row.fingerprintId));
const selectedSessionRuns = new Set(fingerprints.map(row => row.runId + ':' + row.sessionId));
const belongsToSample = row => selectedSessionRuns.has(row.runId + ':' + row.sessionId);
const events = raw.events.rows.filter(belongsToSample).sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
const requests = raw.requests.rows.filter(belongsToSample).sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
const representative = fingerprints.at(-1);
const client = representative.client;
const round = value => Number(value.toFixed(3));
const secondsBetween = (start, end) => {
  const elapsed = Date.parse(end) - Date.parse(start);
  return Number.isFinite(elapsed) ? round(elapsed / 1000) : null;
};

function countBy(rows, select) {
  const counts = {};
  for (const row of rows) {
    const key = String(select(row));
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

const tutorials = events.filter(row => row.type === 'tutorial_start').map(start => {
  const matching = events.filter(row => row.sessionId === start.sessionId && row.runId === start.runId && row.details?.tutorialId === start.details?.tutorialId);
  const steps = matching.filter(row => row.type === 'tutorial_step' && row.details?.status !== 'cancelled');
  const complete = matching.find(row => row.type === 'tutorial_complete');
  const timing = row => ({
    receivedAt: row.receivedAt,
    clientTime: row.clientTime || null,
    elapsedSecondsFromStart: secondsBetween(start.receivedAt, row.receivedAt),
  });
  return {
    runId: start.runId,
    sessionId: start.sessionId,
    tutorialId: start.details?.tutorialId || null,
    tutorial_start: timing(start),
    tutorial_steps: steps.map(row => ({ step: row.details.step, action: row.details.action, ...timing(row) })),
    tutorial_complete: complete ? timing(complete) : null,
    completed: Boolean(complete),
    elapsedSeconds: complete ? secondsBetween(start.receivedAt, complete.receivedAt) : null,
    clientElapsedSeconds: complete && typeof complete.details?.elapsedMs === 'number' && typeof start.details?.elapsedMs === 'number'
      ? round((complete.details.elapsedMs - start.details.elapsedMs) / 1000) : null,
    expectedActions: ['create', 'update', 'complete', 'search', 'delete'],
    stepsMatchExpected: steps.map(row => row.details.action).join(',') === 'create,update,complete,search,delete',
  };
});

const mutations = requests.filter(row =>
  (row.method === 'POST' && row.path === '/api/tasks') ||
  (['PATCH', 'DELETE'].includes(row.method) && /^\/api\/tasks\/[^/]+$/.test(row.path))
);
const expectedMutationCounts = { POST: 1, PATCH: 2, DELETE: 1 };
const mutationCounts = countBy(mutations, row => row.method);
const inputEvents = events.filter(row => row.type === 'search').map(row => ({
  receivedAt: row.receivedAt,
  isTrusted: row.details?.isTrusted ?? null,
  inputType: row.details?.inputType ?? null,
  queryLength: row.details?.queryLength ?? null,
}));
const requestErrors = requests.filter(row => Number(row.status) >= 400);
const requestEvidence = row => ({ receivedAt: row.receivedAt, method: row.method, path: row.path, status: row.status });

const analysis = {
  generatedAt: new Date().toISOString(),
  runId: runIds.length === 1 ? runIds[0] : null,
  runIds,
  scope: {
    sampleLabel,
    operatorNote: options.operator,
    operatorNoteProvenance: 'Optional --operator text is self-supplied by the person running this analyzer; it is not verified or inferred from browser/server observations.',
    sampleLabelProvenance: 'The sample label is manually supplied experiment metadata. It is not an intrinsic browser header or a site-detectable operator identity.',
    provenance: 'Browser control methods and operator identity are not inferred from these observations.',
    inclusionRule: 'Fingerprint client.context.sampleLabel matches scope.sampleLabel; events and requests are joined by the same runId and sessionId.',
    logDirectorySource,
  },
  fingerprints: {
    recordCount: fingerprints.length,
    distinctFingerprintCount: fingerprintIds.length,
    sessionCount: sessionIds.length,
    sessionIds,
    fingerprintIds,
    stableAcrossRecordedSamples: fingerprints.length > 1 ? fingerprintIds.length === 1 : null,
    samples: fingerprints.map(row => ({ receivedAt: row.receivedAt, sessionId: row.sessionId, fingerprintId: row.fingerprintId })),
    representativeReceivedAt: representative.receivedAt,
  },
  observed: {
    browser: client.browser || null,
    device: client.device || null,
    screen: client.screen || null,
    viewport: client.viewport || null,
    locale: client.locale || null,
    rendering: client.rendering || null,
    plugins: client.browser?.plugins || [],
    capabilities: client.capabilities || null,
  },
  server: {
    representative: representative.server || null,
    httpVersions: unique(requests.map(row => row.httpVersion)),
    originTlsObserved: unique(requests.map(row => row.originTlsObserved)),
    reportedClientIpSources: unique(requests.map(row => row.reportedClientIpSource)),
    remoteHosts: unique(requests.map(row => String(row.remoteAddr).startsWith('[')
      ? String(row.remoteAddr).replace(/^\[([^\]]+)\]:\d+$/, '$1')
      : String(row.remoteAddr).replace(/:\d+$/, ''))),
    forwardedHeadersTrusted: unique(requests.map(row => row.forwardedHeadersTrusted)),
  },
  tutorials,
  crud: {
    expectedMutationCounts,
    observedMutationCounts: mutationCounts,
    matchesExpectedMutationCounts: Object.entries(expectedMutationCounts).every(([method, count]) => (mutationCounts[method] || 0) === count) && mutations.length === 4,
    allMutationsSucceeded: mutations.length > 0 && mutations.every(row => row.status >= 200 && row.status < 300),
    requests: mutations.map(requestEvidence),
  },
  inputEventEvidence: {
    records: inputEvents,
    fields: ['isTrusted', 'inputType', 'queryLength'],
    observation: 'These are client-reported event properties. They do not establish which control method produced an event or whether an operator was human or automated.',
  },
  requests: {
    count: requests.length,
    statusCounts: countBy(requests, row => row.status),
    methodCounts: countBy(requests, row => row.method),
    errorCount: requestErrors.length,
    errors: requestErrors.map(requestEvidence),
  },
  events: { count: events.length, typeCounts: countBy(events, row => row.type) },
  parseErrors: Object.fromEntries(Object.entries(raw).map(([name, data]) => [name, data.parseErrors])),
  files,
  cautions: [
    'The sample label and optional operator note are manually supplied annotations, not authenticated operator identity.',
    'All browser fields and client event fields are client-reported and can be altered. Forwarded headers are recorded claims, not authenticated identity.',
    'fingerprintId is an experimental configuration hash. Stability in this small sample does not prove uniqueness, a person, or a permanent device identity.',
    'navigator.webdriver=false and isTrusted=true do not prove a human operator. They do not identify whether AI selected an action.',
    'An ordinary page cannot enumerate all installed browser extensions or their versions; Plugin API entries can be fixed PDF compatibility entries.',
    'User-Agent may be reduced. Windows UA-CH platformVersion is an API contract version, not an exact OS build.',
    'Go sees the loopback HTTP origin connection from cloudflared. It cannot inspect the original browser-to-Cloudflare TLS handshake or derive its JA3/JA4 from these logs.',
    'This report covers the selected sample label only. Different browsers, control implementations, profiles, and manual interactions require separate comparison samples.',
  ],
  officialSources: {
    plugins: 'https://developer.mozilla.org/en-US/docs/Web/API/Navigator/plugins',
    uaReduction: 'https://www.chromium.org/updates/ua-reduction/',
    windowsPlatformVersion: 'https://learn.microsoft.com/en-us/microsoft-edge/web-platform/how-to-detect-win11',
    webdriver: 'https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver',
    isTrusted: 'https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted',
    clientHints: 'https://developer.mozilla.org/en-US/docs/Web/API/NavigatorUAData/getHighEntropyValues',
    tunnelOrigin: 'https://developers.cloudflare.com/tunnel/reference/origin-parameters/',
    cloudflareHeaders: 'https://developers.cloudflare.com/fundamentals/reference/http-headers/',
    ja3ja4: 'https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/',
  },
};

fs.writeFileSync(files.analysis, JSON.stringify(analysis, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  analysisPath: files.analysis,
  sampleLabel,
  logDirectorySource,
  runId: analysis.runId,
  fingerprintRecords: fingerprints.length,
  distinctFingerprints: fingerprintIds.length,
  sessions: sessionIds.length,
  requests: requests.length,
  requestErrors: requestErrors.length,
  events: events.length,
  completedTutorials: tutorials.filter(row => row.completed).length,
  tutorialSeconds: tutorials.map(row => row.elapsedSeconds),
  mutationCounts,
  allMutationsSucceeded: analysis.crud.allMutationsSucceeded,
  inputEvidence: inputEvents.map(({ isTrusted, inputType, queryLength }) => ({ isTrusted, inputType, queryLength })),
  parseErrorCount: Object.values(raw).reduce((total, data) => total + data.parseErrors.length, 0),
}, null, 2));
