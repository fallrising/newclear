// The only persistence port. `batch` must be atomic (D1 batch semantics): any statement error
// rolls back the whole batch. A statement that matches 0 rows is NOT an error — callers must
// make every dependent statement conditional on the CAS row they just wrote (SDD 02 §4).

export type SqlValue = string | number | null;

export interface SqlStatement {
  sql: string;
  params: SqlValue[];
}

export interface SqlDatabase {
  batch(statements: SqlStatement[]): Promise<{ changes: number }[]>;
  all<T>(statement: SqlStatement): Promise<T[]>;
}

export const sql = (text: string, ...params: SqlValue[]): SqlStatement => ({ sql: text, params });

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message);
}

export interface Clock {
  now(): number;
}

export interface IdSource {
  next(prefix: string): string;
}
