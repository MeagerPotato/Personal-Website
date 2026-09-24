import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { FAVICON_SIZE, faviconSvg } from '../site/favicon';
import { tokens } from '../universe/design/tokens';

// The site's icon on a phone's home screen, /apple-touch-icon.png: the same drawing as
// /favicon.svg (src/site/favicon.ts), as the 180 px PNG that iOS asks for. iOS rounds the corners
// itself and fills anything left clear in black, so the tile's own round corners are filled in
// with its navy.
const SIZE = 180;

export const GET: APIRoute = async () => {
  const png = await sharp(Buffer.from(faviconSvg(tokens)), { density: (72 * SIZE) / FAVICON_SIZE })
    .resize(SIZE, SIZE)
    .flatten({ background: tokens.color.space[900] })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
