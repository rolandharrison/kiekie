import { expect, test } from '@playwright/test';
import { createCollection, openCollection, unique, uploadScreenshot, FIXTURE_B } from './helpers';

test('creates a collection with a description and shows it in the list', async ({ page }) => {
  const name = unique('Checkout');
  const cid = await createCollection(page, name, 'v2 redesign pass');

  await expect(page.getByTestId(`collection-desc-${cid}`)).toHaveText('v2 redesign pass');
  await expect(page.getByTestId(`collection-count-${cid}`)).toHaveText('0');
});

test('orders collections by most recent activity', async ({ page }) => {
  const older = await createCollection(page, unique('Older'), 'first');
  const newer = await createCollection(page, unique('Newer'), 'second');

  // The list renders after its fetch resolves, so wait for a known card before
  // reading the order off the DOM.
  const ids = async () => {
    await expect(page.getByTestId(`collection-card-${newer}`)).toBeVisible();
    return page
      .locator('[data-testid^="collection-card-"]')
      .evaluateAll((els) =>
        els.map((e) => (e.getAttribute('data-testid') ?? '').replace('collection-card-', '')),
      );
  };

  await page.goto('/');
  const first = await ids();
  expect(first.indexOf(newer)).toBeLessThan(first.indexOf(older));

  // Uploading into the older collection should float it back to the top.
  await uploadScreenshot(page, older);
  await page.goto('/');
  const second = await ids();
  expect(second.indexOf(older)).toBeLessThan(second.indexOf(newer));
});

test('renames a collection and edits its description', async ({ page }) => {
  const cid = await createCollection(page, unique('Draft'), 'original purpose');

  await page.getByTestId(`edit-collection-${cid}`).click();
  await page.getByTestId('edit-name').fill('Renamed collection');
  await page.getByTestId('edit-description').fill('updated purpose');
  await page.getByTestId('edit-save').click();

  await expect(page.getByTestId(`collection-desc-${cid}`)).toHaveText('updated purpose');
  await openCollection(page, cid);
  await expect(page.getByTestId('collection-title')).toHaveText('Renamed collection');
});

test('uploads a screenshot into the Today bucket with a live annotation count', async ({ page }) => {
  const cid = await createCollection(page, unique('Uploads'), 'upload check');
  const sid = await uploadScreenshot(page, cid, FIXTURE_B);

  await expect(page.getByTestId('bucket-today')).toBeVisible();
  await expect(page.getByTestId(`annotation-count-${sid}`)).toHaveText('0');

  // The image must actually load from R2 through the Worker, not just render a broken tag.
  const loaded = await page
    .locator(`[data-testid="screenshot-${sid}"] img`)
    .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);

  await page.goto('/');
  await expect(page.getByTestId(`collection-count-${cid}`)).toHaveText('1');
});

test('deletes a collection and everything in it', async ({ page }) => {
  const name = unique('Doomed');
  const cid = await createCollection(page, name, 'to be removed');
  await uploadScreenshot(page, cid);

  await page.goto('/');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId(`delete-collection-${cid}`).click();

  await expect(page.getByTestId(`collection-card-${cid}`)).toHaveCount(0);
  await page.goto(`/c/${cid}`);
  await expect(page.getByTestId('error')).toContainText('not found');
});
