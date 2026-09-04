export const queryKeys = {
  templates: {
    all: ['templates'] as const,
    list: (params?: Record<string, unknown>) => ['templates', 'list', params ?? {}] as const,
    detail: (id: string) => ['templates', 'detail', id] as const,
    fields: (id: string) => ['templates', id, 'fields'] as const,
  },
  schemas: {
    all: ['schemas'] as const,
    sources: () => ['schemas', 'sources'] as const,
    resources: (provider: string, version: string) =>
      ['schemas', provider, version, 'resources'] as const,
    resourceTree: (provider: string, version: string, name: string) =>
      ['schemas', provider, version, 'resources', name] as const,
  },
};
