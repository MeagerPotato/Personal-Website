import { describe, expect, it } from 'vitest';
import { site } from '../config/site';
import {
  DEFAULT_PREVIEW,
  absoluteUrl,
  breadcrumbLd,
  pageTitle,
  personLd,
  profilePageLd,
  projectLd,
  serializeLd,
  websiteLd,
} from './seo';

describe('titles and URLs', () => {
  it('names the site after the page, so a tab or a search result reads "FishAI · Allen"', () => {
    expect(pageTitle('FishAI')).toBe(`FishAI · ${site.name}`);
  });

  it('makes site paths absolute, which crawlers on another origin need', () => {
    expect(absoluteUrl('/projects/fishai/')).toBe('https://allenkh.com/projects/fishai/');
    expect(absoluteUrl(DEFAULT_PREVIEW.path)).toBe('https://allenkh.com/og/default.png');
  });

  it('describes the default card for people who cannot see it', () => {
    expect(DEFAULT_PREVIEW).toMatchObject({ width: 1200, height: 630 });
    expect(DEFAULT_PREVIEW.alt.length).toBeGreaterThan(40);
  });
});

describe('structured data', () => {
  it('describes the person once, and lets every other node point at them', () => {
    const person = personLd();
    expect(person).toMatchObject({
      '@type': 'Person',
      '@id': 'https://allenkh.com/#allen',
      name: site.name,
      sameAs: [site.socials.github, site.socials.linkedin],
    });
    expect(websiteLd()).toMatchObject({ '@type': 'WebSite', author: { '@id': person['@id'] } });
    expect(profilePageLd()).toMatchObject({ '@type': 'ProfilePage', mainEntity: person });
  });

  it('never publishes contact details in structured data', () => {
    const everything = serializeLd([personLd(), websiteLd(), profilePageLd()]);
    expect(everything).not.toContain('@allenkh.com');
    expect(everything).not.toMatch(/telephone|email/i);
  });

  it('writes breadcrumbs that end with the page itself, as absolute URLs', () => {
    const list = breadcrumbLd(
      [
        { label: 'Projects', href: '/projects/' },
        { label: 'Code', href: '/systems/code/' },
      ],
      { label: 'FishAI', href: '/projects/fishai/' },
    );
    expect(list.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Projects', item: 'https://allenkh.com/projects/' },
      { '@type': 'ListItem', position: 2, name: 'Code', item: 'https://allenkh.com/systems/code/' },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'FishAI',
        item: 'https://allenkh.com/projects/fishai/',
      },
    ]);
  });

  const base = {
    id: 'fishai',
    title: 'FishAI',
    summary: 'Bots for a card game.',
    date: '2026-08',
    stack: ['TypeScript', 'Rust'],
    imagePath: '/_astro/cover.abc.jpg',
  };

  it('calls a project source code only when it links a repository', () => {
    expect(projectLd({ ...base, repo: 'https://github.com/MeagerPotato/FishAI' })).toMatchObject({
      '@type': 'SoftwareSourceCode',
      '@id': 'https://allenkh.com/projects/fishai/#project',
      codeRepository: 'https://github.com/MeagerPotato/FishAI',
      image: 'https://allenkh.com/_astro/cover.abc.jpg',
      keywords: 'TypeScript, Rust',
      author: { '@id': 'https://allenkh.com/#allen' },
    });
    const plain = projectLd({ ...base, stack: [] });
    expect(plain['@type']).toBe('CreativeWork');
    expect(plain).not.toHaveProperty('codeRepository');
    expect(plain).not.toHaveProperty('keywords');
  });

  it('hangs a moon on its planet', () => {
    const moon = projectLd({ ...base, id: 'canadian-fish-demo', parentId: 'fishai' });
    expect(moon.isPartOf).toEqual({ '@id': 'https://allenkh.com/projects/fishai/#project' });
    expect(projectLd(base)).not.toHaveProperty('isPartOf');
  });
});

describe('serializeLd', () => {
  it('wraps the nodes in one schema.org graph that parses back', () => {
    const parsed = JSON.parse(serializeLd([websiteLd(), personLd()])) as Record<string, unknown>;
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@graph']).toHaveLength(2);
  });

  it('cannot be closed from the inside: no "<" survives, and the data still round-trips', () => {
    const hostile = { '@type': 'Thing', name: '</script><script>alert(1)</script>' };
    const body = serializeLd([hostile]);
    expect(body).not.toContain('<');
    const parsed = JSON.parse(body) as { '@graph': Array<{ name: string }> };
    expect(parsed['@graph'][0]?.name).toBe(hostile.name);
  });
});
