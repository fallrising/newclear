export type ErrorBody = { error: { code: string; message: string } };

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

export function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(errorBody(code, message), { status });
}
