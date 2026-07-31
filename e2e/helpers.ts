import path from 'node:path';
import { expect, type Page } from '@playwright/test';

// Playwright compiles specs to CJS, so `import.meta` is unavailable; the runner
// always starts at the repo root, which is enough to locate the fixtures.
const FIXTURES = path.join(process.cwd(), 'e2e', 'fixtures');

export const FIXTURE_A = path.join(FIXTURES, 'screen-a.png');
export const FIXTURE_B = path.join(FIXTURES, 'screen-b.png');

/** Names are unique per run so specs never collide with leftover local state. */
export function unique(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

export async function createCollection(page: Page, name: string, description: string) {
  await page.goto('/');
  await page.getByTestId('collection-name').fill(name);
  await page.getByTestId('collection-description').fill(description);
  await page.getByTestId('create-collection').click();
  const card = page.locator('[data-testid^="collection-card-"]', { hasText: name }).first();
  await expect(card).toBeVisible();
  return (await card.getAttribute('data-testid'))!.replace('collection-card-', '');
}

export async function openCollection(page: Page, cid: string) {
  await page.goto(`/c/${cid}`);
  await expect(page.getByTestId('collection-title')).toBeVisible();
}

export async function uploadScreenshot(page: Page, cid: string, fixture = FIXTURE_A) {
  await openCollection(page, cid);
  const before = await page.locator('[data-testid^="screenshot-"]').count();
  await page.getByTestId('upload-input').setInputFiles(fixture);
  await page.getByTestId('upload-submit').click();
  await expect(page.locator('[data-testid^="screenshot-"]')).toHaveCount(before + 1);
  const tile = page.locator('[data-testid^="screenshot-"]').first();
  return (await tile.getAttribute('data-testid'))!.replace('screenshot-', '');
}

/** Click at a fraction of the annotator's box — how a user drops a pin. */
export async function clickImageAt(page: Page, fx: number, fy: number) {
  const box = (await page.getByTestId('annotator').boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Drag a rectangle across the annotator. */
export async function dragImage(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('annotator').boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 12 });
  await page.mouse.up();
}
