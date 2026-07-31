import { expect, test } from '@playwright/test';
import { createCollection, unique, uploadScreenshot } from './helpers';

test('shares a collection publicly, then revokes it', async ({ page, browser }) => {
  const name = unique('Client review');
  const cid = await createCollection(page, name, 'for the client');
  const sid = await uploadScreenshot(page, cid);

  await page.goto(`/c/${cid}/s/${sid}`);
  await page.getByTestId('whole-comment-input').fill('feedback visible to the client');
  await page.getByTestId('whole-comment-submit').click();
  await expect(page.getByTestId('comment-count')).toHaveText('1');

  await page.goto(`/c/${cid}`);
  await page.getByTestId('share-collection').click();
  const shareUrl = await page.getByTestId('share-collection-url').textContent();
  expect(shareUrl).toMatch(/\/p\/[A-Za-z0-9_-]{21}$/);
  const token = shareUrl!.split('/p/')[1];

  // A completely separate browser context — no cookies, no session, no login.
  const visitor = await browser.newContext();
  const guest = await visitor.newPage();
  await guest.goto(shareUrl!);

  await expect(guest.getByTestId('public-title')).toHaveText(name);
  await expect(guest.getByTestId('public-readonly-note')).toBeVisible();
  await guest.getByTestId(`public-screenshot-${sid}`).click();
  await expect(guest.getByTestId('screenshot-image')).toBeVisible();
  await expect(guest.locator('[data-testid^="comment-"][data-resolved] .body')).toHaveText(
    'feedback visible to the client',
  );

  // The public viewer offers no way to write, and the API says no either.
  await expect(guest.getByTestId('whole-composer')).toHaveCount(0);
  await expect(guest.getByTestId('region-composer')).toHaveCount(0);
  await expect(guest.locator('[data-testid^="comment-resolve-"]')).toHaveCount(0);

  const imageLoaded = await guest
    .getByTestId('screenshot-image')
    .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(imageLoaded).toBe(true);

  // The share surface itself carries no write verbs — that is the server-side
  // guarantee. (In production the `/api/*` paths are additionally behind Access,
  // which is exercised in the Worker suite rather than here.)
  const publicWrites = await guest.evaluate(async (t) => {
    const methods = ['POST', 'PATCH', 'DELETE', 'PUT'];
    return Promise.all(
      methods.map((method) => fetch(`/p/${t}/data`, { method }).then((r) => r.status)),
    );
  }, token);
  expect(publicWrites).toEqual([404, 404, 404, 404]);

  // Revoke from the share-links page and the public URL dies.
  await page.goto('/shares');
  await expect(page.getByTestId(`share-row-${token}`)).toBeVisible();
  await page.getByTestId(`revoke-${token}`).click();
  await expect(page.getByTestId(`share-row-${token}`)).toHaveCount(0);

  await guest.goto(shareUrl!);
  await expect(guest.getByTestId('public-error')).toContainText('revoked');

  await visitor.close();
});

test('shares a single screenshot without exposing its siblings', async ({ page, browser }) => {
  const cid = await createCollection(page, unique('Mixed'), 'one shared, one not');
  const shared = await uploadScreenshot(page, cid);
  const secret = await uploadScreenshot(page, cid);
  expect(secret).not.toBe(shared);

  await page.goto(`/c/${cid}/s/${shared}`);
  await page.getByTestId('share-screenshot').click();
  const shareUrl = (await page.getByTestId('share-screenshot-url').textContent())!;
  const token = shareUrl.split('/p/')[1];

  const visitor = await browser.newContext();
  const guest = await visitor.newPage();
  await guest.goto(shareUrl);
  await expect(guest.getByTestId('screenshot-image')).toBeVisible();

  const payload = await guest.evaluate(async (t) => {
    const res = await fetch(`/p/${t}/data`);
    return res.json();
  }, token);
  expect(payload.kind).toBe('screenshot');
  expect(payload.screenshots.map((s: any) => s.id)).toEqual([shared]);

  await visitor.close();
});

test('lists active share links with their target', async ({ page }) => {
  const name = unique('Listed');
  const cid = await createCollection(page, name, 'share listing');
  await page.getByTestId(`share-collection-${cid}`).click();
  const url = (await page.getByTestId(`share-collection-${cid}-url`).textContent())!;
  const token = url.split('/p/')[1];

  await page.goto('/shares');
  const row = page.getByTestId(`share-row-${token}`);
  await expect(row).toContainText(name);
  await expect(row).toContainText('collection');
  await expect(row).toContainText('dev@localhost');
});
