import { expect, test } from '@playwright/test';
import {
  clickImageAt,
  createCollection,
  dragImage,
  unique,
  uploadScreenshot,
} from './helpers';

async function subject(page: import('@playwright/test').Page, label: string) {
  const cid = await createCollection(page, unique(label), 'annotation checks');
  const sid = await uploadScreenshot(page, cid);
  await page.goto(`/c/${cid}/s/${sid}`);
  await expect(page.getByTestId('annotator')).toBeVisible();
  return { cid, sid };
}

test('drops a pin comment that survives a reload', async ({ page }) => {
  await subject(page, 'Pins');

  await clickImageAt(page, 0.5, 0.4);
  await expect(page.getByTestId('draft-pin')).toBeVisible();
  await page.getByTestId('region-comment-input').fill('this icon is misaligned');
  await page.getByTestId('region-comment-submit').click();

  await expect(page.getByTestId('comment-count')).toHaveText('1');
  const comment = page.locator('[data-testid^="comment-"][data-resolved]').first();
  const aid = (await comment.getAttribute('data-testid'))!.replace('comment-', '');
  await expect(page.getByTestId(`comment-kind-${aid}`)).toHaveText('pin');
  await expect(page.getByTestId(`pin-${aid}`)).toBeVisible();

  await page.reload();
  await expect(page.getByTestId(`pin-${aid}`)).toBeVisible();
  await expect(page.locator(`[data-testid="comment-${aid}"] .body`)).toHaveText('this icon is misaligned');

  // The pin should sit roughly where it was clicked, i.e. the region round-tripped.
  const box = (await page.getByTestId('annotator').boundingBox())!;
  const pin = (await page.getByTestId(`pin-${aid}`).boundingBox())!;
  expect((pin.x + pin.width / 2 - box.x) / box.width).toBeCloseTo(0.5, 1);
  expect((pin.y + pin.height / 2 - box.y) / box.height).toBeCloseTo(0.4, 1);
});

test('draws a rectangle comment over a region', async ({ page }) => {
  await subject(page, 'Regions');

  await dragImage(page, [0.2, 0.2], [0.6, 0.5]);
  await expect(page.getByTestId('draft-region')).toBeVisible();
  await page.getByTestId('region-comment-input').fill('this whole block is wrong');
  await page.getByTestId('region-comment-submit').click();

  const comment = page.locator('[data-testid^="comment-"][data-resolved]').first();
  const aid = (await comment.getAttribute('data-testid'))!.replace('comment-', '');
  await expect(page.getByTestId(`comment-kind-${aid}`)).toHaveText('region');

  await page.reload();
  const region = page.getByTestId(`region-${aid}`);
  await expect(region).toBeVisible();

  const box = (await page.getByTestId('annotator').boundingBox())!;
  const drawn = (await region.boundingBox())!;
  expect((drawn.x - box.x) / box.width).toBeCloseTo(0.2, 1);
  expect(drawn.width / box.width).toBeCloseTo(0.4, 1);
});

test('adds a whole-image comment attributed to the signed-in user', async ({ page }) => {
  await subject(page, 'Whole');

  await page.getByTestId('whole-comment-input').fill('overall this needs more contrast');
  await page.getByTestId('whole-comment-submit').click();

  await expect(page.getByTestId('comment-count')).toHaveText('1');
  const comment = page.locator('[data-testid^="comment-"][data-resolved]').first();
  const aid = (await comment.getAttribute('data-testid'))!.replace('comment-', '');
  await expect(page.getByTestId(`comment-kind-${aid}`)).toHaveText('whole image');
  await expect(comment.locator('.who strong')).toHaveText('dev@localhost');
  await expect(page.getByTestId(`pin-${aid}`)).toHaveCount(0);
});

test('edits, resolves and deletes a comment', async ({ page }) => {
  await subject(page, 'Lifecycle');

  await page.getByTestId('whole-comment-input').fill('first draft');
  await page.getByTestId('whole-comment-submit').click();
  const comment = page.locator('[data-testid^="comment-"][data-resolved]').first();
  const aid = (await comment.getAttribute('data-testid'))!.replace('comment-', '');

  await page.getByTestId(`comment-edit-${aid}`).click();
  await page.getByTestId('comment-edit-input').fill('revised wording');
  await page.getByTestId('comment-edit-save').click();
  await expect(page.locator(`[data-testid="comment-${aid}"] .body`)).toHaveText('revised wording');

  await page.getByTestId(`comment-resolve-${aid}`).click();
  await expect(page.getByTestId(`comment-${aid}`)).toHaveAttribute('data-resolved', 'true');
  await page.reload();
  await expect(page.getByTestId(`comment-${aid}`)).toHaveAttribute('data-resolved', 'true');

  await page.getByTestId(`comment-resolve-${aid}`).click();
  await expect(page.getByTestId(`comment-${aid}`)).toHaveAttribute('data-resolved', 'false');

  await page.getByTestId(`comment-delete-${aid}`).click();
  await expect(page.getByTestId(`comment-${aid}`)).toHaveCount(0);
  await expect(page.getByTestId('no-comments')).toBeVisible();
});

test('shows the annotation count back on the collection grid', async ({ page }) => {
  const { cid, sid } = await subject(page, 'Counts');

  await page.getByTestId('whole-comment-input').fill('one');
  await page.getByTestId('whole-comment-submit').click();
  await expect(page.getByTestId('comment-count')).toHaveText('1');

  await page.goto(`/c/${cid}`);
  await expect(page.getByTestId(`annotation-count-${sid}`)).toHaveText('1');
});

test('moves a screenshot to another collection', async ({ page }) => {
  const source = await createCollection(page, unique('Source'), 'from');
  const targetName = unique('Target');
  const target = await createCollection(page, targetName, 'to');
  const sid = await uploadScreenshot(page, source);

  await page.goto(`/c/${source}/s/${sid}`);
  await page.getByTestId('move-select').selectOption(target);

  await page.goto(`/c/${source}`);
  await expect(page.getByTestId('no-screenshots')).toBeVisible();

  await page.goto(`/c/${target}`);
  await expect(page.getByTestId(`screenshot-${sid}`)).toBeVisible();
});

test('deletes a screenshot from the viewer', async ({ page }) => {
  const { cid, sid } = await subject(page, 'Remove');

  page.once('dialog', (d) => d.accept());
  await page.getByTestId('delete-screenshot').click();

  await expect(page).toHaveURL(new RegExp(`/c/${cid}$`));
  await expect(page.getByTestId('no-screenshots')).toBeVisible();
});
