# Runbook: put the journal on journal.allenkh.com

**Who:** Allen (agents never touch the Cloudflare dashboard or DNS). **When:** once, after the PR
that adds `sites/journal` is merged to `main`. **Time:** about 20 minutes, most of it waiting for
the first build. **Reference:** [sites/docs/PLAN.md](../PLAN.md); the main site's own runbook,
[docs/runbooks/cloudflare-setup.md](../../../docs/runbooks/cloudflare-setup.md), which this one
follows. Dashboard labels drift; if something has moved, the dashboard's search box finds it.

> **The one rule** is the main site's: what already lives on this domain must not change. Today
> that is `allenkh.com` itself (the Worker `allenkh-com`), and `days2meet.allenkh.com` and
> `fishai.allenkh.com` (both on Vercel). The journal adds one hostname, `journal.allenkh.com`,
> through a Custom Domain, which makes exactly one DNS record of its own. If a step ever offers to
> edit, replace, or "fix" any other record, stop.

## 0. Before you start

1. Snapshot the existing subdomains exactly as in the main runbook's §0 (`nslookup` and
   `curl.exe -sI` for days2meet and fishai), and keep the output.
2. Check that nothing answers on `journal` yet (asking Cloudflare's public resolver, 1.1.1.1):

   ```bash
   nslookup journal.allenkh.com 1.1.1.1
   ```

   Expect a `Name:` line with nothing under it: no `Addresses`, no `Aliases` (the `Address`
   near the top is the resolver's own). Cloudflare answers a name that does not exist this way,
   without the words "Non-existent domain"; a made-up name looks the same:

   ```bash
   nslookup no-such-name.allenkh.com 1.1.1.1
   ```

   If an address or an alias shows under the name, stop and tell Claude: some record already uses
   it.

**Plan.** The Workers Free plan is enough to start: D1, R2, the cron and the rate limit all work
on it. The one thing to watch is Free's CPU limit per request (10 ms). The journal's heaviest
requests (a passkey sign-in, a big first sync) should fit, but if the Worker's logs ever show
"exceeded CPU" or error 1102, Workers Paid ($5 a month) lifts it, and nothing in the code changes.

## 1. Make the storage

**The database.** Dashboard → **Storage & databases** → **D1 SQL database** → **Create
database**.

| Field | Value |
| --- | --- |
| Name | `allenkh-journal` |
| Location | leave it automatic (it picks the region nearest you) |
| Jurisdiction | none |

Open the new database and copy its **Database ID** (a UUID). It is not a secret: it means nothing
without your Cloudflare login. The Worker creates its own tables on its first request; there is
nothing to run.

**The bucket.** Dashboard → **Storage & databases** → **R2 object storage**. If R2 is not
enabled yet, it asks you to enable it, and wants a payment method on file even though the journal
stays well inside the free tier (10 GB; a photo a day is about 0.1 GB a year). Then **Create
bucket**:

| Field | Value |
| --- | --- |
| Name | `allenkh-journal-blobs` |
| Location | automatic |
| Default storage class | Standard |

Leave **Public access** off: no custom domain, no `r2.dev` address. The Worker is the bucket's
only door, and everything in it is encrypted anyway.

## 2. Send Claude the database id

Send the Database ID in chat. Claude opens a one-line PR that puts it in
`sites/journal/wrangler.jsonc` in place of the zeros, and merges it once it is green. (Or edit
that line yourself, in a branch `allen/…`.) The Worker's builds fail until this is on `main`,
because the zeros name no database: wait for the merge before §3.

## 3. Create the Worker from the GitHub repo

1. **Workers & Pages** → **Create** → **Import a repository** → GitHub →
   `MeagerPotato/Personal-Website` (the Cloudflare app already has access to it, for the main
   site).
2. Configure it:

   | Field | Value |
   | --- | --- |
   | Project / Worker name | `allenkh-journal` (**must match** `name` in `sites/journal/wrangler.jsonc`, or the build fails) |
   | Production branch | `main` |
   | Root directory | `sites/journal` |
   | Build command | `cd .. && npm ci && npm run build --workspace=journal` |
   | Deploy command | `npx wrangler deploy` |
   | Builds for non-production branches (Preview builds) | **off** |

3. Under **Build variables** (on the same form, or later in **Settings** → **Build** →
   **Variables and secrets**) add `SKIP_DEPENDENCY_INSTALL` = `1`. The workspace's lockfile is in
   `sites/`, one level above the root directory; the build command installs from it instead.
4. **Save and deploy.** The first build takes a few minutes. It ends green with a Worker that has
   no public address yet: `wrangler.jsonc` turns off the `workers.dev` address and preview URLs
   on purpose. §5 gives it its one address.
5. **Check that preview builds are off:** the Worker → **Settings** → **Build** → **Branch
   control** → **Enable Preview Builds** unticked. A preview would run a branch's unreviewed code
   against the real journal (new Workers' previews share production's database and bucket unless
   told otherwise), and passkeys work only on `journal.allenkh.com` anyway.
6. **Build watch paths** (the Worker → **Settings** → **Build** → **Build watch paths**), so the
   journal rebuilds only when something it is made of changes:

   | | Paths |
   | --- | --- |
   | Include | `sites/journal/*`, `sites/packages/*`, `sites/package.json`, `sites/package-lock.json`, `src/universe/design/tokens.ts`, `src/site/contrast.ts` |
   | Exclude | `*.md` |

   The last two include paths are the main site's files the journal's design system reads: the
   palette and the contrast maths.

If the build fails on the Node version (`EBADENGINE`): add the build variable `NODE_VERSION` =
`24` and retry. (The build image's default is already 24.)

## 4. The setup code

The journal asks for a setup code once, when it is set up, so that nobody who finds the address
before you do can claim it. Without the secret, setup is switched off entirely.

1. Make a code:

   ```bash
   node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
   ```

2. The Worker → **Settings** → **Variables and secrets** → **Add** → type **Secret**, name
   `SETUP_TOKEN`, the code as its value → **Deploy**.

Keep the code until §6 is done. After setup it opens nothing (a journal that exists refuses a
second setup), so you may delete the secret then, or leave it.

## 5. Put it on journal.allenkh.com

1. The Worker → **Settings** → **Domains & Routes** → **Add** → **Custom Domain** →
   `journal.allenkh.com` → **Add Custom Domain**.
2. Cloudflare creates the DNS record and the certificate itself. Give it a few minutes.

**Custom Domain, never Route**, for the main site's reason: a route pattern can capture other
hostnames. The zone settings from the main runbook's §4 (Always Use HTTPS and the rest) already
cover the new name; change nothing there. The journal sends its own HSTS header without
`includeSubDomains`, like the main site.

## 6. Set the journal up

1. On the device you use most, open `https://journal.allenkh.com`. Enter the setup code, then:
   - **the recovery phrase**: 24 words, shown once. Write them on paper (or print the page) and
     keep it somewhere safe and offline. It is the one way back in if every passkey is lost, and
     whoever holds it can read everything;
   - **the passkey**: Face ID, Touch ID or Windows Hello. It unlocks the journal from then on.
2. **iPhone and iPad:** Safari → **Share** → **Add to Home Screen**. The daily reminder only
   works in the Home Screen app, because Safari offers notifications to nothing else there.
3. **Other devices:** open the journal and unlock. A passkey that syncs to that device (iCloud
   Keychain across the iPhone, iPad and Mac) works at once; anywhere else, **Use recovery
   phrase** gives that device a passkey of its own.
4. **The reminder:** Settings → **Daily reminder** → tick it on each device that should nudge you,
   then **Send a test**.

## 7. The main site's builds (optional)

The main site's Worker, `allenkh-com`, rebuilds on every push, including pushes that change only
`sites/`. It deploys the same site again, so this is harmless, just slow. To skip those builds:
`allenkh-com` → **Settings** → **Build** → **Build watch paths** → **Exclude paths**: `sites/*`.

## 8. Tell Claude, then check

Tell Claude the journal is up. Claude reads its headers from outside and repeats the §0 snapshot.
What you can check yourself:

```bash
curl.exe -sI https://journal.allenkh.com
```

Expect status `200` with `content-security-policy`, `strict-transport-security:
max-age=31536000` (and no `includeSubDomains`), and `x-robots-tag: noindex, nofollow`. Then run
the §0 commands again: days2meet and fishai should still answer from Vercel, unchanged.

## Undo

- **Take it offline:** the Worker → **Settings** → **Domains & Routes** → the domain → **Remove**.
  The record Cloudflare made goes with it; the data stays in D1 and R2.
- **A bad deploy:** the Worker → **Deployments** → an earlier version → **Rollback**. The
  database keeps its own history as well (D1 Time Travel: a week on Free, a month on Paid), but
  restoring it to an earlier time loses, on the server, everything written since. The devices
  put back what they still have when they next sync, but what only the server had is gone. So
  roll back the Worker first, and restore the database only if its data is damaged, after
  **Export everything** on a device that has synced.
- **Deleting the database or the bucket** is the one step that cannot be undone: it destroys
  the journal, except for what each device still holds. Before anything like that, use Settings →
  **Export everything** on a device that has synced.
