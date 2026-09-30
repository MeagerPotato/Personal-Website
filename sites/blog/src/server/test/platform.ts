/**
 * What the blog's server tests share: a local D1 and R2 exactly as `wrangler dev` gets them (from
 * wrangler.jsonc, in memory), a clean database per test, a mail binding that records what it is
 * given, and a browser-like caller for the API.
 */
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { api } from '../api';
import { migrate } from '../db/migrate';
import type { BlogEnv, MailBinding, MailMessage } from '../env';

export const ORIGIN = 'http://localhost:4321';
export const RP_ID = 'localhost';
export const SETUP_TOKEN = 'lantern-quiet-harbour';

export type Platform = Awaited<ReturnType<typeof startPlatform>>;

export function startPlatform() {
  return getPlatformProxy<{ DB: D1Database; MEDIA: R2Bucket }>({
    configPath: fileURLToPath(new URL('../../../wrangler.jsonc', import.meta.url)),
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
}

/** A clean blog: every table emptied (the schema stays: the Worker migrates once per isolate). */
export async function freshEnv(platform: Platform, extra: Partial<BlogEnv> = {}): Promise<BlogEnv> {
  const DB = platform.env.DB;
  await migrate(DB);
  const tables = await DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  ).all<{ name: string }>();
  // In any order: every foreign key says what happens ON DELETE.
  for (const { name } of tables.results) {
    if (name !== 'schema') await DB.prepare(`DELETE FROM "${name}"`).run();
  }
  const listed = await platform.env.MEDIA.list();
  if (listed.objects.length)
    await platform.env.MEDIA.delete(listed.objects.map((object) => object.key));
  return { DB, MEDIA: platform.env.MEDIA, RP_ID, ORIGIN, SETUP_TOKEN, ...extra };
}

/** Email Service, as a list of what was sent (or a failure, when told to fail). */
export class FakeMail implements MailBinding {
  readonly sent: MailMessage[] = [];
  failing: Error | null = null;
  async send(message: MailMessage) {
    if (this.failing) throw this.failing;
    this.sent.push(message);
    return { messageId: `message-${this.sent.length}` };
  }
}

export const context = (): ExecutionContext =>
  ({
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  }) as unknown as ExecutionContext;

type Json = Record<string, unknown>;

/** One browser: its own cookie jar, and the Origin header a page of the blog would send. */
export class Browser {
  cookie = '';
  constructor(private readonly env: BlogEnv) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const all: Record<string, string> = { ...headers };
    if (method !== 'GET' && method !== 'HEAD') all['origin'] ??= ORIGIN;
    if (this.cookie) all['cookie'] = this.cookie;
    const init: RequestInit = { method, headers: all };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      all['content-type'] = 'application/json';
    }
    const response = await api.fetch(
      new Request(`${ORIGIN}/api${path}`, init),
      this.env,
      context(),
    );
    const cookie = response.headers.get('set-cookie');
    if (cookie?.startsWith('__Host-sid=')) {
      const value = cookie.split(';')[0] ?? '';
      this.cookie = value === '__Host-sid=' ? '' : value;
    }
    return response;
  }

  async json<T = Json>(method: string, path: string, body?: unknown) {
    const response = await this.call(method, path, body);
    return { status: response.status, body: (await response.json()) as T, response };
  }
}
