import { useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppSession } from './session/AppSession'

export function createAppQueryClient() {
  return new QueryClient({ defaultOptions: { queries: {
    staleTime: 5_000,
    retry: (count, error) => {
      const status = (error as { status?: number }).status
      return count < 1 && status !== 401 && status !== 403 && status !== 404
    },
    refetchOnWindowFocus: false,
  }, mutations: { retry: false } } })
}

export function App() {
  const [client] = useState(createAppQueryClient)
  return <QueryClientProvider client={client}><BrowserRouter basename={import.meta.env.BASE_URL}><AppSession /></BrowserRouter></QueryClientProvider>
}

export { AppSession } from './session/AppSession'
