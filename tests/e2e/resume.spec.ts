// The resume: the one page that names Allen in full, on screen, on paper and as a PDF.

import { expect, plain, test } from './support';

test.describe('the resume', () => {
  test('offers itself as a PDF that the site really serves', async ({ page, request }) => {
    await page.goto(plain('/resume/'));
    await expect(page.locator('main .resume-name')).toHaveText('Allen Hsieh');

    const link = page.getByRole('link', { name: 'Download the PDF' });
    await expect(link).toHaveAttribute('download', '');
    const href = await link.getAttribute('href');
    expect(href).toMatch(/\.pdf$/);

    const response = await request.get(href ?? '');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
    expect((await response.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('on paper, is headed by the full name and nothing else', async ({ page }) => {
    await page.goto(plain('/resume/'));
    await page.emulateMedia({ media: 'print' });

    await expect(page.locator('main .resume-name')).toBeVisible();
    // The wordmark ("Allen"), the page's own title and the screen's controls stay off paper.
    // (Located by CSS, not by role: a role query never finds what is hidden, so it would pass.)
    for (const selector of ['.wordmark', 'main h1', 'main .actions a', '.colophon']) {
      await expect(page.locator(selector)).toHaveCount(1);
      await expect(page.locator(selector)).toBeHidden();
    }
  });
});
