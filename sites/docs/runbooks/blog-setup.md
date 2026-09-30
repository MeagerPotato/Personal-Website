# Runbook: put the blog on blog.allenkh.com

**Who:** Allen (agents never touch the Cloudflare dashboard or DNS). **When:** once, after the PR
that adds `sites/blog` is merged to `main`. **Time:** about 20 minutes for the blog itself; email
(§7) and Turnstile (§8) can wait. **Reference:** [sites/docs/PLAN.md](../PLAN.md); the journal's
runbook, [cloudflare-setup.md](cloudflare-setup.md), which this one follows step for step.
Dashboard labels drift; if something has moved, the dashboard's search box finds it.

> **The one rule** is the main site's: what already lives on this domain must not change. Today
> that is `allenkh.com` itself (the Worker `allenkh-com`), `days2meet.allenkh.com` and
> `fishai.allenkh.com` (both on Vercel), and the journal if it is up. The blog adds one hostname,
> `blog.allenkh.com`, through a Custom Domain, which makes exactly one DNS record of its own.
> Email (§7) adds a few more, all named in §7. If a step ever offers to edit, replace, or "fix"
> any other record, stop.

## 0. Before you start

1. Snapshot the existing subdomains exactly as in the main runbook's §0 (`nslookup` and
   `curl.exe -sI` for days2meet and fishai), and keep the output.
2. Check that nothing answers on `blog` yet (asking Cloudflare's public resolver, 1.1.1.1):

   ```bash
   nslookup blog.allenkh.com 1.1.1.1
   ```

   Expect a `Name:` line with nothing under it: no `Addresses`, no `Aliases` (the `Address`
   near the top is the resolver's own). Cloudflare answers a name that does not exist this way,
   without the words "Non-existent domain"; a made-up name looks the same:

   ```bash
   nslookup no-such-name.allenkh.com 1.1.1.1
   ```

   If an address or an alias shows under the name, stop and tell Claude: some record already uses
   it.

**Plan.** The Workers Free plan runs the blog: D1, R2, the cron and the rate limits all work on
it. Two things need Workers Paid ($5 a month), and nothing in the code changes when you switch:
**email to readers** (§7), and more CPU if a request outgrows Free's 10 ms. The heaviest request
is publishing a long post full of code and math (it is highlighted and typeset once, then
stored). If publishing ever fails with error 1102, or the Worker's logs say "exceeded CPU", that
is the sign.

## 1. Make the storage

**The database.** Dashboard → **Storage & databases** → **D1 SQL database** → **Create
database**.

| Field | Value |
| --- | --- |
| Name | `allenkh-blog` |
| Location | leave it automatic |
| Jurisdiction | none |

Open it and copy its **Database ID** (a UUID; not a secret). The Worker makes its own tables on
its first request.

**The bucket.** Dashboard → **Storage & databases** → **R2 object storage** → **Create bucket**
(R2 is already enabled if the journal is up):

| Field | Value |
| --- | --- |
| Name | `allenkh-blog-media` |
| Location | automatic |
| Default storage class | Standard |

Leave **Public access** off: the Worker serves the images itself, with long cache lives, at
`blog.allenkh.com/media/…`.

## 2. Send Claude the database id

Send the Database ID in chat. Claude opens a one-line PR that puts it in
`sites/blog/wrangler.jsonc` in place of the zeros, and merges it once it is green. The Worker's
builds fail until this is on `main`: wait for the merge before §3.

## 3. Create the Worker from the GitHub repo

1. **Workers & Pages** → **Create** → **Import a repository** → GitHub →
   `MeagerPotato/Personal-Website`.
2. Configure it:

   | Field | Value |
   | --- | --- |
   | Project / Worker name | `allenkh-blog` (**must match** `name` in `sites/blog/wrangler.jsonc`) |
   | Production branch | `main` |
   | Root directory | `sites/blog` |
   | Build command | `cd .. && npm ci && npm run build --workspace=blog` |
   | Deploy command | `npx wrangler deploy` |
   | Builds for non-production branches (Preview builds) | **off** |

3. Under **Build variables** add `SKIP_DEPENDENCY_INSTALL` = `1` (the lockfile is in `sites/`,
   and the build command installs from it).
4. **Save and deploy.** The build ends green with a Worker that has no public address yet;
   `wrangler.jsonc` turns off the `workers.dev` address and preview URLs on purpose.
5. **Check that preview builds are off** (the Worker → **Settings** → **Build** → **Branch
   control**). A preview would run a branch's unreviewed code against the real blog.
6. **Build watch paths** (the Worker → **Settings** → **Build** → **Build watch paths**):

   | | Paths |
   | --- | --- |
   | Include | `sites/blog/*`, `sites/packages/*`, `sites/package.json`, `sites/package-lock.json`, `src/universe/design/tokens.ts`, `src/site/contrast.ts` |
   | Exclude | `*.md` |

If the build fails on the Node version (`EBADENGINE`): add the build variable `NODE_VERSION` =
`24` and retry.

## 4. The setup code

The studio asks for a setup code once, for its first passkey, so that nobody who finds the
address first can claim it. While the studio has a passkey the code opens nothing.

1. Make a code:

   ```bash
   node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
   ```

2. The Worker → **Settings** → **Variables and secrets** → **Add** → type **Secret**, name
   `SETUP_TOKEN`, the code as its value → **Deploy**.

## 5. Put it on blog.allenkh.com

1. The Worker → **Settings** → **Domains & Routes** → **Add** → **Custom Domain** →
   `blog.allenkh.com` → **Add Custom Domain**.
2. Cloudflare creates the DNS record and the certificate itself. Give it a few minutes.

**Custom Domain, never Route**: a route pattern can capture other hostnames. The blog sends its
own HSTS header without `includeSubDomains`, like the main site.

## 6. Set up the studio

1. Open `https://blog.allenkh.com/studio/`. Enter the setup code, then make the passkey (Face ID,
   Touch ID, Windows Hello, or your phone over the QR code).
2. **Other devices:** any passkey works for the studio (nothing is encrypted with it, unlike the
   journal). A passkey that syncs (iCloud Keychain, Google Password Manager) signs in at once;
   otherwise sign in with your phone's passkey over the QR code, then Settings → **Add a passkey
   on this device**.
3. Write the first post: **Posts** → **New post**. It stays a draft, seen by no one, until you
   press **Publish**. **Preview** shows it as readers will see it before that.

## 7. Email to readers (optional; Workers Paid)

Without this the blog works fully, and simply has no subscribe form. With it, readers subscribe
(a confirmation email first), and each post can be emailed to them once, from the post's page in
the studio. Cloudflare's own Email Service sends it; its sending is a beta on Workers Paid only.

1. **Workers Paid:** Dashboard → **Workers & Pages** → **Plans** → Paid ($5 a month; 3,000
   emails included).
2. **Onboard the domain:** **Compute** → **Email Service** → **Email Sending** → **Onboard
   Domain** → `allenkh.com`. Before **Done**, read the records it will add. They should be only:
   MX and TXT records on `cf-bounce.allenkh.com` (bounces, SPF, DKIM), and a TXT record on
   `_dmarc.allenkh.com`. **If it wants to change a record that already exists** (for example a
   `_dmarc` record you already have, or anything on `allenkh.com` itself, days2meet or fishai),
   stop and tell Claude.
3. **Tell Claude** it is onboarded. Claude adds the `send_email` binding to
   `sites/blog/wrangler.jsonc` in a PR (a binding added in the dashboard would be dropped by the
   next deploy: the file owns the Worker's settings).
4. **The sender:** the Worker → **Settings** → **Variables and secrets** → **Add** → type
   **Secret**, name `MAIL_FROM`, value the blog's name and an address at allenkh.com, in the
   form `Captain’s Log <allen@allenkh.com>`. A secret, not a plain variable, because a deploy
   keeps secrets. Use the public address, or another one at allenkh.com that you read: readers
   may reply.
5. **Check:** the studio's Settings says email is set up, and the blog shows its subscribe form.
   Subscribe with your own address, confirm from the email, then on a published post in the
   studio press **Email subscribers**.

## 8. Turnstile on the comment form (optional)

Until it is on, comments rely on a hidden honeypot field, a rate limit and your approval, which
is enough for a quiet blog. If spam gets through anyway:

1. Dashboard → **Turnstile** → **Add widget**: name `allenkh-blog`, hostname `blog.allenkh.com`,
   mode **Managed**.
2. Copy the **site key** and the **secret key**. The Worker → **Variables and secrets** → add
   both as type **Secret**: `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`. The form switches it on
   by itself, and each page's Content-Security-Policy lets exactly Cloudflare's widget in.

## 9. Tell Claude, then check

Tell Claude the blog is up: Claude reads its headers from outside, repeats the §0 snapshot, and
links the main site's Log station to it (docs/PLAN.md, Phase 5). What you can check yourself:

```bash
curl.exe -sI https://blog.allenkh.com
```

Expect status `200` with `content-security-policy` and `strict-transport-security:
max-age=31536000` (no `includeSubDomains`). Then run the §0 commands again: days2meet and fishai
should still answer from Vercel, unchanged.

The main site's Worker rebuilds on every push, `sites/` included; the journal's runbook, §7,
says how to skip those builds, if you have not already.

## Lost every passkey

1. Dashboard → **D1** → `allenkh-blog` → **Console**, and run:

   ```sql
   DELETE FROM sessions;
   DELETE FROM credentials;
   ```

   That signs every browser out and forgets every passkey. Posts, comments and subscribers are
   untouched.
2. Make a new setup code (§4, a fresh value), then open `/studio/` and set it up again (§6).

## Undo

- **Take it offline:** the Worker → **Settings** → **Domains & Routes** → the domain →
  **Remove**. The record Cloudflare made goes with it; the posts stay in D1 and R2.
- **A bad deploy:** the Worker → **Deployments** → an earlier version → **Rollback**. D1 keeps
  its own history too (Time Travel: a week on Free, a month on Paid).
- **Email:** remove `MAIL_FROM` and the blog stops sending at once (mail waiting in the outbox
  waits). Offboarding the domain in Email Service removes the records it added.
- **Deleting the database or the bucket** cannot be undone: it destroys the posts and images.
