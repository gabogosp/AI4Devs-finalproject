import type { AppError } from './http/errors';

/** Estado async como unión discriminada (frontend-standards §11.4/11.9 — sin flags booleanos). */
export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: AppError };
