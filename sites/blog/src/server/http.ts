/** What every API route needs: the request's JSON, checked, and the studio's session, required. */
import type { Context } from 'hono';
import type { z } from 'zod';
import type { ApiContext, StudioSession } from './env';
import { HttpError } from './util';

/** Parses the JSON body against a schema, or answers 400. */
export async function body<T extends z.ZodType>(
  c: Context<ApiContext>,
  schema: T,
): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, 'Malformed request');
  return parsed.data;
}

/** The signed-in session, or 401. */
export function requireSession(c: Context<ApiContext>): StudioSession {
  const session = c.get('session');
  if (!session) throw new HttpError(401, 'Sign in first');
  return session;
}
