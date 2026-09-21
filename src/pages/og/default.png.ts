import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { defaultOgSvg } from '../../site/og';
import { tokens } from '../../universe/design/tokens';

// The default link-preview image, /og/default.png, rendered once at build time. The drawing is a
// pure function (src/site/og.ts); this wrapper only turns the SVG into the PNG that link-preview
// crawlers insist on.
export const GET: APIRoute = async () => {
  const png = await sharp(Buffer.from(defaultOgSvg(tokens)))
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
