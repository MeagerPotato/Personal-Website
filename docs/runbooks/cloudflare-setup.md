# Runbook: connect allenkh.com to Cloudflare Workers

**Who:** Allen (agents never touch the Cloudflare dashboard or DNS). **When:** once, after PR #1 is
merged to `main`. **Time:** about 10 minutes. **Plan reference:** docs/PLAN.md §5.9 and §6, Phase 0
step 8. Dashboard labels drift; if something has moved, the dashboard's search box finds it.

> **The one rule:** `days2meet.allenkh.com` is live on Vercel and must not change. Nothing below
> touches its DNS record. If a step ever offers to edit, replace, or "fix" that record, stop.

## 0. Before you start: snapshot days2meet

Run these and keep the output. Expected today (recorded 2026-09-20): a CNAME to
`9963483035711a72.vercel-dns-017.com`, status `200`, `Server: Vercel`.

```bash
nslookup days2meet.allenkh.com
```

```bash
curl.exe -sI https://days2meet.allenkh.com
```

## 1. Create the Worker from the GitHub repo

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Connect GitHub when asked. On GitHub's permission screen choose **Only select repositories** →
   `MeagerPotato/Personal-Website`. (Not "All repositories".)
3. Configure the project:

   | Field | Value |
   | --- | --- |
   | Project / Worker name | `allenkh-com` (**must match** `name` in `wrangler.jsonc`, or the build fails) |
   | Production branch | `main` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | Non-production branch deploy command | `npx wrangler versions upload` |
   | Root directory | `/` (leave empty) |
   | Builds for non-production branches | **enabled** (this is what gives every PR a preview URL) |

4. **Save and deploy.** The first build takes a minute or two. When it is green, open the
   `*.workers.dev` URL it shows: you should see the starfield placeholder.

If the build fails on the Node version (`EBADENGINE`): Worker → **Settings** → **Build** →
**Variables** → add `NODE_VERSION` = `24`, then retry the build. (The repo's `.node-version` file
should make this unnecessary.)

## 2. Put it on allenkh.com

1. The Worker → **Settings** → **Domains & Routes** (or the **Domains** tab) → **Add** →
   **Custom Domain** → `allenkh.com` → **Add Custom Domain**.
2. Cloudflare creates the DNS record and the certificate itself. Give it a few minutes.

**Custom Domain, never Route.** A route such as `*allenkh.com/*` would capture days2meet.

## 3. Send www to the apex

A Custom Domain matches one exact hostname, so `www` needs a redirect.

1. The `allenkh.com` zone → **DNS** → **Records** → **Add record**:
   type `A`, name `www`, IPv4 `192.0.2.0`, proxy status **Proxied**. (A reserved placeholder
   address. Traffic never reaches it; the record only exists so Cloudflare can apply the rule.)
2. The zone → **Rules** → **Redirect Rules** → **Create rule** → pick the template
   **Redirect from WWW to root** → deploy it as is (301, keeps path and query string).

Do not touch any other DNS record while you are in there. In particular, leave the `MX` and `TXT`
records alone: they are Cloudflare Email Routing, which is what makes email on this domain work.

## 4. Two zone settings to switch off

Both rewrite HTML on its way out, which would break the site's Content Security Policy and add
scripts to plain mode. They only affect traffic proxied by Cloudflare, so days2meet (DNS-only, on
Vercel) is unaffected.

- **Rocket Loader**: off. (Zone → **Speed** → **Optimization** → **Content Optimization**.)
- **Email Address Obfuscation**: off. (Zone → **Scrape Shield**, or search the dashboard for it.)

## 5. Web Analytics

1. Account home → **Analytics & Logs** → **Web Analytics** → **Add a site** → `allenkh.com`.
2. If it offers **automatic setup**, decline it: choose the **manual / JS snippet** option. (The
   site injects the beacon itself, and only on `allenkh.com`, so previews never count as visits.)
3. Copy the **token** out of the snippet: the 32-character value in `data-cf-beacon='{"token": "…"}'`.
   It is public (it ships in the page HTML), so it is fine to paste into chat.

## 6. Tell Claude, then check

Send Claude: "Cloudflare is connected" plus the analytics token. Claude then opens the follow-up
PR (Phase 0 step 9: turns off the public `workers.dev` hostname, adds the token) and runs the Phase 0
checks in docs/PLAN.md §7.

Re-run both commands from step 0. **The output must match the snapshot.** Then:

```bash
curl.exe -sI https://allenkh.com
```

Expect `200`, a `content-security-policy` header, and `strict-transport-security: max-age=31536000`
with **no** `includeSubDomains`.

```bash
curl.exe -sI https://www.allenkh.com/some/path?x=1
```

Expect `301` with `location: https://allenkh.com/some/path?x=1`.

## Undo

- Remove the site from the domain: Worker → **Domains & Routes** → delete the Custom Domain.
- Stop deploys: Worker → **Settings** → **Build** → disconnect the repository.
- The `www` record and the redirect rule can be deleted independently. None of this touches
  days2meet.

## GitHub side (done by Claude in Phase 0 step 7; listed so it is reproducible)

- Repo settings: squash merging only, delete head branches automatically.
- Branch protection on `main`: required status check `verify`, linear history, no force pushes,
  applies to admins too. The exact API body is in docs/PLAN.md Appendix B. To relax it:
  GitHub → **Settings** → **Branches** → edit the rule for `main`.
