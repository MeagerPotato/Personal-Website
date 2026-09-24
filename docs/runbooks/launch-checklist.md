# Runbook: the v0.1 launch checklist

**What "launch" means:** allenkh.com is public and Phase 2's exit criteria hold (docs/PLAN.md §6):
a recruiter reaches the resume and the projects in under ten seconds on any device, and an
explorer can fly, dock and go Back. **Who:** marked on every item. **H** needs Allen (a real
device, a dashboard, a judgement of voice or feel). **C** is Claude's, and most of it needs the
live site to answer first. **M** is held by machines on every PR and is listed so that nobody
repeats it by hand.

Tick the boxes in a copy of this file in the launch PR's description, not here.

## 0. What must be merged first

- [ ] **H** Cloudflare is connected: [cloudflare-setup.md](cloudflare-setup.md), about ten minutes.
- [ ] **C** The follow-up PR: `workers_dev: false`, and the Web Analytics token in
      `ANALYTICS_TOKEN` (`src/config/analytics.ts`), the one line that turns counting on. The
      beacon only loads on `allenkh.com`, and not for a visitor who sends Global Privacy Control
      or Do Not Track.
- [ ] **H** `allen@allenkh.com` receives mail (Cloudflare Email Routing → a rule for `allen`).
      Send one test message from another account before the address is public.
- [ ] **H** The copy has had its voice edit: About, the project pages, the home page, the hint
      card. The build already fails on any `TODO(copy)` that would ship.
- [ ] **H** The points to confirm in docs/PLAN.md §9 are answered (the summer of 2024, the
      preparedness club's dates, the VEX numbers, the Raytheon title, the name on the resume).
- [ ] **H → C** The visual identity pass (A1) is merged. Claude did it at Allen's request, on
      `claude/a1-visual-identity`; it already deletes the typefaces that were not chosen, with
      their `@font-face` rules, and preloads the one that was (Outfit).
- [ ] **H → C** The playtest on a laptop and a real phone (Phase 1's exit gate) has happened, and
      what it found is in a tuning-only PR.

## 1. Held by machines, on every PR (M)

`npm run verify` (required) and `npm run e2e` (its own CI job, in Chromium, WebKit and a phone-
sized Chromium). From docs/PLAN.md §7, these are no longer hand checks:

- Every page's content is in the HTML, and reads with JavaScript off.
- Plain mode asks for one script, never for three.js or the galaxy, and stays chosen for the
  visit. A visitor who prefers reduced motion gets plain mode and an invitation.
- A soft navigation ends in exactly the page a fresh load builds, head included, for every page.
- A deep link opens docked, fetches nothing, takes no focus. Back, Forward, Close, Escape; scroll
  restored per entry; of three clicks faster than the network the last one wins.
- Clicks that are not plain clicks on plain links (modifiers, middle button, downloads, mail,
  hashes, other origins) are left to the browser.
- The heading takes focus after a soft navigation, with reduced motion too.
- The canvas and its WebGL context survive fifty soft navigations.
- A deploy in the middle of a visit, or a dead network, means a normal page load.
- A GPU that gives no context: the page turns plain, says so, and loses nothing. The 404 is a
  real 404.
- Pointing at a planet or its name flies there; Stop; the cut under reduced motion; the hint
  card; the star map by button, key, wheel, drag and pinch.
- axe finds no serious issue on any page in either mode, nor on the map. Nothing scrolls sideways
  at 360 and 320 px. Every control is at least 44 px.
- CSP hashes, weight budgets (30 KiB per plain page, 220 KiB of lazy JavaScript, gzip), every
  internal link, nothing dev-only in `dist/`, no phone number and no private address in the repo.

## 2. Against the live site (C, once allenkh.com answers)

- [ ] `days2meet.allenkh.com` and `fishai.allenkh.com` still match the snapshot in
      [cloudflare-setup.md](cloudflare-setup.md) §0: status 200, `Server: Vercel`, the same CNAME.
- [ ] `curl.exe -sI https://allenkh.com/`: 200, a `content-security-policy`, and
      `strict-transport-security: max-age=31536000` with **no** `includeSubDomains`.
- [ ] `/_astro/*` and `/fonts/*` are `immutable`; `/nope` is a 404 with the site's own page;
      `http://` and `www.` answer 301 to the apex with path and query kept; `/index.html` → 307.
- [ ] `<meta name="build">` on the live page equals the commit that was merged.
- [ ] A PR's preview URL sends `X-Robots-Tag: noindex` and loads no beacon.
- [ ] No CSP error in the console, in either mode, on any page (`npm run dev` cannot show these:
      only the deployed site and `npm run preview` apply the headers).
- [ ] Exactly one analytics POST per page view, soft navigations included (DevTools → Network,
      filter `cloudflareinsights`), and none with Do Not Track on.
- [ ] securityheaders.com: grade A.
- [ ] Lighthouse, mobile, plain mode, on `/`, `/about/`, `/projects/fishai/`, `/resume/`:
      performance ≥ 95, the other three 100, LCP < 1.5 s, CLS < 0.02. Measured before launch
      behind `wrangler dev`: 100 / 100 / 100 / 100, LCP 0.9 to 1.1 s, CLS 0 (docs/PLAN.md §6).

## 3. By hand (H)

- [ ] **A real iPhone, Safari.** Fly with the thumb stick and the boost pad; tap a planet; open
      the map, drag it, pinch it. Twenty page changes without losing the picture. Put Safari in
      the background for a minute and come back. Rotate. Try it once in Low Power Mode (the
      display runs at 30 Hz there, and the engine should not take that for a slow GPU).
- [ ] **A real Android phone.** The same, and ten minutes of flying at 30 fps or better; if not,
      compare `?universe&q=low`, `&q=medium`, `&q=high` and tell Claude which one holds.
- [ ] **A screen reader** (NVDA is free on Windows; VoiceOver on the iPhone). Plain mode: headings
      and landmarks make sense, the resume reads in order. Universe mode: a nav link says "Flying
      to …" and then "Docked at …", the page's heading is read after it opens, the names of
      planets are buttons, the Map button says whether it opens or closes, Escape leaves.
- [ ] **Keyboard only.** Tab reaches everything, the focus ring is always visible, nothing traps
      focus, the flight keys do nothing while a page has the focus.
- [ ] **Back/forward cache.** Follow a link to GitHub, press Back: the site is there at once, in
      the same mode, and the world still moves (Chrome DevTools → Application → Back/forward
      cache → Test says "restored").
- [ ] **Link previews.** LinkedIn's Post Inspector and opengraph.xyz for `/`,
      `/projects/fishai/`, `/projects/days2meet/` and `/resume/`: title, sentence, picture.
- [ ] **Print the resume** (Ctrl+P on `/resume/`): two clean pages, and no phone number.
- [ ] **The ten-second test.** Hand a phone to someone who has never seen the site and ask them
      to find the resume. Then ask them to find FishAI without using the links.

## 4. Going public (H)

- [ ] The site's address on LinkedIn, on the GitHub profile, and as the repository's website.
- [ ] Optional: Google Search Console, with `https://allenkh.com/sitemap-index.xml`.
- [ ] Optional: a `v0.1.0` tag on the commit that went public.

## 5. The week after (C, H)

- [ ] Web Analytics shows visits, and its Core Web Vitals agree with Lighthouse.
- [ ] Anything a real visitor tripped over becomes an issue, and Phase 3 carries on
      (docs/PLAN.md §6; the lazy-JavaScript budget in §9 is the first decision it needs).
