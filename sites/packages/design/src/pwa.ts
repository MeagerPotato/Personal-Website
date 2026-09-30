/**
 * A Vite plugin for an installable app's icons and manifest, drawn from the tokens at build
 * time (icons.ts) and served by the dev server from memory. Nothing is written to public/.
 */
import sharp from 'sharp';
import type { Plugin } from 'vite';
import { appIconSvg, type AppMark } from './icons.ts';
import { themes } from './tokens.ts';

export interface AppIconOptions {
  mark: AppMark;
  /** Full name ("Allen’s journal") and the name under the icon ("Journal"). */
  name: string;
  shortName: string;
  description: string;
  /** Emit manifest.webmanifest too (an installable app). */
  manifest?: boolean;
}

type Files = Record<string, string | Uint8Array>;

const TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  webmanifest: 'application/manifest+json',
};

async function draw(options: AppIconOptions): Promise<Files> {
  const icon = appIconSvg(options.mark);
  const maskable = appIconSvg(options.mark, { maskable: true });
  const png = async (svg: string, size: number) =>
    new Uint8Array(
      await sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toBuffer(),
    );
  const files: Files = {
    'icon.svg': icon,
    'icon-192.png': await png(icon, 192),
    'icon-512.png': await png(icon, 512),
    'icon-maskable-512.png': await png(maskable, 512),
    // iOS rounds the corners itself and puts transparent ones on black: give it the full tile.
    'apple-touch-icon.png': await png(maskable, 180),
  };
  if (options.manifest) {
    files['manifest.webmanifest'] = JSON.stringify(
      {
        id: '/',
        name: options.name,
        short_name: options.shortName,
        description: options.description,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: themes.day.bg,
        theme_color: themes.day.bg,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      null,
      2,
    );
  }
  return files;
}

export function appIcons(options: AppIconOptions): Plugin {
  let files: Promise<Files> | null = null;
  const get = () => (files ??= draw(options));
  return {
    name: 'allenkh-app-icons',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.split('?')[0]?.replace(/^\//, '') ?? '';
        void get().then((all) => {
          const body = all[name];
          if (body === undefined) return next();
          response.setHeader(
            'Content-Type',
            TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream',
          );
          response.end(body);
        }, next);
      });
    },
    applyToEnvironment: (environment) => environment.name === 'client',
    async generateBundle() {
      for (const [fileName, source] of Object.entries(await get())) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
  };
}
