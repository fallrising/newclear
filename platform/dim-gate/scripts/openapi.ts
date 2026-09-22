import { readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { apiResultSchema } from '../src/domain/schemas.ts'
import { operations, wireSchemas } from '../src/api/contracts.ts'

const registry = z.registry<{ id: string }>()
const names = new Map<z.ZodType, string>()
function register(name: string, schema: z.ZodType) {
  if (names.has(schema)) return names.get(schema)!
  registry.add(schema, { id: name }); names.set(schema, name)
  return name
}
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
for (const [name, schema] of Object.entries(wireSchemas)) register(name, schema)
for (const operation of operations) {
  if (operation.body) register(`${operation.id}Request`, operation.body)
  if (operation.query) register(`${operation.id}Query`, operation.query)
  register(`${operation.id}Response`, apiResultSchema(operation.data))
}
const generated = z.toJSONSchema(registry, { target: 'draft-2020-12', io: 'output', uri: name => `#/components/schemas/${name}` })
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$id' && key !== '$schema').map(([key, item]) => [key,
    key === '$ref' && typeof item === 'string' ? item.replace(/(#\/components\/schemas\/[^#]+)#\//, '$1/') : normalize(item)]))
}
const schemas = normalize(generated.schemas) as Record<string, Record<string, unknown>>
const json = (schema: unknown) => ({ 'application/json': { schema } })
const errors = Object.fromEntries([401, 403, 404, 409, 415, 422, 429, 500, 501, 503, 507].map(status => [status, {
  description: ({ 401: 'Invalid demo identity', 403: 'Action forbidden', 404: 'Not found or outside scope',
    409: 'Version, state, identity or idempotency conflict', 415: 'JSON required', 422: 'Invalid input or unknown field',
    429: 'Session command limit; reset required', 500: 'Unexpected server error', 501: 'Operation not delivered',
    503: 'Simulated unavailable; manual retry', 507: 'Atomic persistence failed; state unchanged' } as Record<number, string>)[status],
  content: json(ref('ApiError')),
}]))
const paths: Record<string, Record<string, unknown>> = {}
const ids = new Set<string>()
for (const operation of operations) {
  if (ids.has(operation.id)) throw new Error(`Duplicate operation ID: ${operation.id}`)
  ids.add(operation.id)
  const parameters: unknown[] = [...operation.path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
    name, in: 'path', required: true, schema: { type: 'string', minLength: 1, maxLength: 160 },
  }))
  if (operation.query) {
    const querySchema = schemas[names.get(operation.query)!]
    const properties = querySchema.properties as Record<string, unknown>
    for (const [name, schema] of Object.entries(operation.query.shape)) parameters.push({
      name, in: 'query', required: !schema.isOptional(), schema: properties[name],
    })
  }
  if (operation.body) parameters.push({ name: 'Idempotency-Key', in: 'header', required: true,
    description: 'Same logical retry keeps the key. Replay reauthorizes before returning the original receipt.',
    schema: { type: 'string', pattern: '^[!-~]{1,128}$' } })
  const path = `${operation.demo ? '/__demo' : '/api'}/v1${operation.path}`
  const implemented = ['M0', 'M1', 'M2', 'M3', 'M4'].includes(operation.milestone)
  paths[path] ??= {}
  if (paths[path][operation.method]) throw new Error(`Duplicate operation: ${operation.method} ${path}`)
  paths[path][operation.method] = {
    operationId: operation.id, tags: [operation.demo ? 'Demo controls' : operation.milestone],
    summary: operation.id,
    description: implemented ? `Implemented by the demo adapter through ${operation.milestone}.`
      : `Forward contract for ${operation.milestone}; unavailable in this adapter. Success below specifies the future result, not current behavior.`,
    'x-implementation-status': implemented ? 'implemented' : 'planned',
    'x-milestone': operation.milestone, 'x-demo-only': Boolean(operation.demo),
    parameters,
    ...(operation.body ? { requestBody: { required: true, content: json(ref(names.get(operation.body)!)) } } : {}),
    responses: { [operation.status]: { description: 'Authorized successful result', content: json(ref(`${operation.id}Response`)) }, ...errors },
  }
}
const document = {
  openapi: '3.1.0',
  info: { title: 'dim-gate BFF and demo controls', version: '0.1.0-m4',
    description: `Generated from Zod. M0–M4 provide ${operations.filter((operation) => ['M0', 'M1', 'M2', 'M3', 'M4'].includes(operation.milestone)).length} executable operations. Cross-entity scope, provider attributes, capacity and state invariants are enforced by the domain and behavioral tests, not fully expressible in JSON Schema. No real cloud or live authentication is provided.` },
  servers: [{ url: '/dim-gate', description: 'Default application base; api/v1 and __demo/v1 are relative to this base.' }],
  security: [{ DemoPersona: [], DemoSession: [] }],
  paths,
  components: { securitySchemes: {
    DemoPersona: { type: 'apiKey', in: 'header', name: 'X-Demo-Persona', description: 'Demo enabled-user ID; not live authentication.' },
    DemoSession: { type: 'apiKey', in: 'header', name: 'X-Demo-Session', description: 'Controller-owned tab session ID.' },
  }, schemas },
}
function validateRefs(value: unknown): void {
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (key === '$ref') {
      if (typeof item !== 'string' || !item.startsWith('#/')) throw new Error(`Nonlocal schema reference: ${item}`)
      let target: unknown = document
      for (const part of item.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
        if (!target || typeof target !== 'object' || !(part in target)) throw new Error(`Broken schema reference: ${item}`)
        target = (target as Record<string, unknown>)[part]
      }
    } else validateRefs(item)
  }
}
validateRefs(document)
const destination = new URL('../docs/openapi.json', import.meta.url)
const content = `${JSON.stringify(document, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== content) throw new Error('OpenAPI drift: run pnpm generate:contracts and commit the regenerated document.')
} else writeFileSync(destination, content)
console.log(`OpenAPI ${process.argv.includes('--check') ? 'checked' : 'generated'}: ${operations.length} operations, ${Object.keys(schemas).length} schemas, all local references resolved.`)
