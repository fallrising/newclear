export class DomainError extends Error {
  status: number
  code: string
  fieldErrors?: Record<string, string[]>
  constructor(status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) {
    super(message)
    this.name = 'DomainError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}
