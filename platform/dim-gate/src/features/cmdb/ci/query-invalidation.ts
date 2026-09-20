import type { QueryClient } from '@tanstack/react-query'

const familyOf = (query: { queryKey: readonly unknown[] }) => query.queryKey[3]

export async function invalidateAfterCiCreate(cache: QueryClient) {
  await cache.invalidateQueries({ predicate: (query) => ['cis', 'search', 'capacity'].includes(String(familyOf(query))) })
}

export async function invalidateAfterCiUpdate(cache: QueryClient) {
  await cache.invalidateQueries({ predicate: (query) => [
    'ci', 'cis', 'search', 'topology', 'applications', 'environments', 'capacity', 'audit',
  ].includes(String(familyOf(query))) })
}
