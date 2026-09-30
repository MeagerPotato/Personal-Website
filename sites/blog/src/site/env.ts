/**
 * The Worker's bindings and variables, for the pages. Only .astro files import this module:
 * `cloudflare:workers` exists in workerd, not in Vitest, so the server code takes its env as an
 * argument instead and is tested with a local one.
 */
import { env } from 'cloudflare:workers';
import type { BlogEnv } from '../server/env';

export const blogEnv = (): BlogEnv => env as unknown as BlogEnv;
