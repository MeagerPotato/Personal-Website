# allenkh.com

Allen's personal site, built as a small universe you can fly through: solar systems are passions,
planets are projects, moons are sub-projects. Mini Motorways colours, dark navy space, a rocket.

**Status: Phase 0 (foundations).** What exists so far is an "under construction" page with a
starfield, built as a miniature of the real architecture. The roadmap is in
[docs/PLAN.md](docs/PLAN.md) §6.

## One URL, two modes

Every page is real pre-rendered HTML with the full content.

- **Universe mode** boots a three.js world on top, and the page content becomes the info panel.
- **Plain mode** is a fast typographic site: about 5 KB gzipped per page, no framework JavaScript,
  and it never downloads three.js. Add `?plain` to any URL (`?universe` switches back). It is also
  what you get without WebGL2, with reduced motion requested, or if the engine fails to start.

## Quick start

Needs Node 24 (see `.node-version`).

```bash
npm ci
```

```bash
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Astro dev server on http://localhost:4321 |
| `npm run build` | asset checks, static build into `dist/`, then `dist/_headers` with CSP hashes |
| `npm run preview` | serve `dist/` with `wrangler dev`, exactly as Cloudflare will (build first) |
| `npm run verify` | format check, lint, type check, tests, build, and checks on the built site. Run before every commit; CI runs the same thing |

## Stack

[Astro](https://astro.build) 7 used thinly (static HTML and content only), vanilla TypeScript,
[three.js](https://threejs.org) r186, no UI framework. Hosted on Cloudflare Workers static assets;
every push to `main` deploys and every pull request gets a preview URL.

## Where things are

| | |
| --- | --- |
| [AGENTS.md](AGENTS.md) | the rules: invariants, commands, repo map, the "never" list |
| [docs/PLAN.md](docs/PLAN.md) | the master plan: decisions, architecture, roadmap, verification |
| [docs/DESIGN.md](docs/DESIGN.md) | the design brief |
| [docs/handoffs/](docs/handoffs/) | design packets for Astra |
| [docs/runbooks/cloudflare-setup.md](docs/runbooks/cloudflare-setup.md) | one-time hosting setup |
| `src/universe/` | the engine: framework-free TypeScript and three.js |
| `src/shell/` | client code outside the engine: mode switch, boot, watchdog |
| `src/pages`, `src/layouts`, `src/components` | markup-only Astro |

## License

© 2026 Allen Hsieh. All rights reserved. The source is public to read and learn from, not to
reuse: see [LICENSE](LICENSE).

## Who builds it

Allen is the product owner and co-developer. [Claude Code](https://claude.com/claude-code) does the
engineering and first-pass design. Astra (an OpenAI Codex agent) does focused visual and UX passes
inside the design surface. How they work together: [AGENTS.md](AGENTS.md).
