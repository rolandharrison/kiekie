import { expect, test } from '@playwright/test';
import { createCollection, mintShareLink, unique, uploadScreenshot } from './helpers';

test('shares a collection publicly, then revokes it', async ({ page, browser }) => {
  const name = unique('Client review');
  const cid = await createCollection(page, name, 'for the client');
  const sid = await uploadScreenshot(page, cid);

  await page.goto(`/c/${cid}/s/${sid}`);
  await page.getByTestId('whole-comment-input').fill('feedback visible to the client');
  await page.getByTestId('whole-comment-submit').click();
  await expect(page.getByTestId('comment-count')).toHaveText('1');

  await page.goto(`/c/${cid}`);
  const shareUrl = await mintShareLink(page, 'share-collection');
  expect(shareUrl).toMatch(/\/p\/[A-Za-z0-9_-]{21}$/);
  const token = shareUrl.split('/p/')[1];

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

test('asks for the expiry in a dialog, not inline on the page', async ({ page }) => {
  const cid = await createCollection(page, unique('Dialog'), 'share dialog');
  await page.goto(`/c/${cid}`);

  // The expiry choice only exists once you have decided to share.
  await expect(page.getByTestId('share-collection-expiry')).toHaveCount(0);

  await page.getByTestId('share-collection').click();
  await expect(page.getByTestId('share-collection-expiry')).toBeVisible();

  // Backing out mints nothing — opening the dialog must not be what creates
  // the link, or every idle click would leak a public URL.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('share-collection-expiry')).toHaveCount(0);

  const links = await page.evaluate(() =>
    fetch('/api/share-links').then((r) => r.json()),
  );
  expect(links.links.some((l: any) => l.target_id === cid)).toBe(false);
});

test('shares a single screenshot without exposing its siblings', async ({ page, browser }) => {
  const cid = await createCollection(page, unique('Mixed'), 'one shared, one not');
  const shared = await uploadScreenshot(page, cid);
  const secret = await uploadScreenshot(page, cid);
  expect(secret).not.toBe(shared);

  await page.goto(`/c/${cid}/s/${shared}`);
  const shareUrl = await mintShareLink(page, 'share-screenshot');
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

test('shares with an expiry date and shows it on the share-links page', async ({ page, browser }) => {
  const name = unique('Timeboxed');
  const cid = await createCollection(page, name, 'expires soon');
  await uploadScreenshot(page, cid);

  await page.goto(`/c/${cid}`);
  const shareUrl = await mintShareLink(page, 'share-collection', '7');

  // The dialog confirms the deadline rather than silently minting a forever link.
  await expect(page.getByTestId('share-collection-expiry-note')).toContainText('Expires');
  const token = shareUrl.split('/p/')[1];

  // A dated link still works right now.
  const visitor = await browser.newContext();
  const guest = await visitor.newPage();
  await guest.goto(shareUrl);
  await expect(guest.getByTestId('public-title')).toHaveText(name);
  await visitor.close();

  await page.goto('/shares');
  const expiry = page.getByTestId(`share-expiry-${token}`);
  await expect(expiry).not.toHaveText('Never');
  await expect(page.getByTestId(`share-row-${token}`)).toHaveAttribute('data-expired', 'false');

  // Roughly a week out, not some default.
  const shown = Date.parse((await expiry.textContent())!);
  const daysOut = (shown - Date.now()) / 86_400_000;
  expect(daysOut).toBeGreaterThan(6);
  expect(daysOut).toBeLessThan(8);
});

test('defaults to a link that never expires', async ({ page }) => {
  const cid = await createCollection(page, unique('Permanent'), 'no deadline');
  await page.goto(`/c/${cid}`);
  const shareUrl = await mintShareLink(page, 'share-collection');

  await expect(page.getByTestId('share-collection-expiry-note')).toHaveText('Never expires');
  const token = shareUrl.split('/p/')[1];

  await page.goto('/shares');
  await expect(page.getByTestId(`share-expiry-${token}`)).toHaveText('Never');
});

test('lists active share links with their target', async ({ page }) => {
  const name = unique('Listed');
  const cid = await createCollection(page, name, 'share listing');
  const url = await mintShareLink(page, `share-collection-${cid}`);
  const token = url.split('/p/')[1];

  await page.goto('/shares');
  const row = page.getByTestId(`share-row-${token}`);
  await expect(row).toContainText(name);
  await expect(row).toContainText('collection');
  await expect(row).toContainText('dev@localhost');
});
