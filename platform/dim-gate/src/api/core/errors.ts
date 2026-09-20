export class ApiRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly requestId: string,
    public readonly retryable: boolean, public readonly status: number,
    public readonly fieldErrors?: Record<string, string[]>) {
    super(message)
    this.name = 'ApiRequestError'
  }
}
