/** Errors a handler may throw on purpose; the app turns them into { error } JSON with a status. */
import type { Context } from 'hono';
import type { z } from 'zod';
import type { AppContext } from '../env';

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 411 | 413 | 429;

export class HttpError extends Error {
  constructor(
    readonly status: ErrorStatus,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Parses the JSON body against a schema, or answers 400. */
export async function body<T extends z.ZodType>(
  c: Context<AppContext>,
  schema: T,
): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, 'Malformed request');
  return parsed.data;
}
