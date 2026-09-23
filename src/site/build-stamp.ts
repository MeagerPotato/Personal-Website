/**
 * What `<meta name="build">` says: which deploy a page belongs to. The router compares the stamp
 * of a page it fetches with the one it is showing (src/shell/swap.ts), and a different stamp
 * means a new deploy happened mid-visit: it then lets the browser load the page normally. So two
 * deploys must never share a stamp, and people reading the page source should see the commit.
 *
 * Workers Builds and GitHub Actions both give a commit hash. Not always a HASH: the first build
 * Cloudflare ran for this site stamped its pages "main". Anything that is not a hash falls back
 * to the build's own id, which is unique per build. A local build says "dev".
 */
export function buildStamp(env: Readonly<Record<string, string | undefined>>): string {
  for (const sha of [env.WORKERS_CI_COMMIT_SHA, env.GITHUB_SHA]) {
    if (sha !== undefined && /^[0-9a-f]{7,40}$/i.test(sha)) return sha.toLowerCase();
  }
  const build = env.WORKERS_CI_BUILD_UUID?.trim();
  return build ? `build-${build}` : 'dev';
}
