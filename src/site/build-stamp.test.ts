import { describe, expect, it } from 'vitest';
import { buildStamp } from './build-stamp';

const SHA = '2f8f8234c86275b650c8ade8f97b901bff1acf6f';

describe('the build stamp', () => {
  it('is the commit, from Workers Builds or from GitHub Actions', () => {
    expect(buildStamp({ WORKERS_CI_COMMIT_SHA: SHA })).toBe(SHA);
    expect(buildStamp({ GITHUB_SHA: SHA.toUpperCase() })).toBe(SHA);
    expect(buildStamp({ WORKERS_CI_COMMIT_SHA: SHA, GITHUB_SHA: 'abc1234' })).toBe(SHA);
  });

  it('is never a branch name, which every deploy of that branch would share', () => {
    expect(buildStamp({ WORKERS_CI_COMMIT_SHA: 'main', WORKERS_CI_BUILD_UUID: 'b-1' })).toBe(
      'build-b-1',
    );
    expect(buildStamp({ WORKERS_CI_COMMIT_SHA: 'main', GITHUB_SHA: 'abc1234' })).toBe('abc1234');
    expect(buildStamp({ WORKERS_CI_COMMIT_SHA: 'main' })).toBe('dev');
  });

  it('says "dev" for a build on a laptop', () => {
    expect(buildStamp({})).toBe('dev');
    expect(buildStamp({ WORKERS_CI_BUILD_UUID: '  ' })).toBe('dev');
  });
});
