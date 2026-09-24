import type { APIRoute } from 'astro';
import { faviconSvg } from '../site/favicon';
import { tokens } from '../universe/design/tokens';

// The site's icon, /favicon.svg, written once at build time from the design tokens. The drawing
// is a pure function (src/site/favicon.ts).
export const GET: APIRoute = () =>
  new Response(faviconSvg(tokens), { headers: { 'Content-Type': 'image/svg+xml' } });
