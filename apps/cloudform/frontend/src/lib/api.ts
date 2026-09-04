import axios, { AxiosError, AxiosResponse } from 'axios';
import { toast } from 'sonner';
import type { ApiResponse } from '@/types/api';

export const api = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Unwrap the { success, data, error, message } envelope so callers get T directly.
// Throw on server-side error envelopes so React Query treats them as errors.
api.interceptors.response.use(
  (resp: AxiosResponse<ApiResponse<unknown>>) => {
    const body = resp.data;
    if (body && typeof body === 'object' && 'success' in body) {
      if (!body.success) {
        const err = new ApiCallError(body.error?.code ?? 'UNKNOWN', body.error?.message ?? body.message);
        throw err;
      }
      // mutate resp.data so axios callers receive the unwrapped payload
      (resp as AxiosResponse<unknown>).data = body.data;
    }
    return resp;
  },
  (error: AxiosError<ApiResponse<unknown>>) => {
    const body = error.response?.data;
    const code = body?.error?.code ?? `HTTP_${error.response?.status ?? 'NETWORK'}`;
    const message = body?.error?.message ?? body?.message ?? error.message;
    toast.error(message, { description: code });
    return Promise.reject(new ApiCallError(code, message));
  }
);

export class ApiCallError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ApiCallError';
  }
}
