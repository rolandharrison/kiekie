import type { Screenshot } from './api';

export const BUCKET_LABELS = ['Today', 'Last 3 days', 'Last week', 'Last month', 'Older'] as const;
export type BucketLabel = (typeof BUCKET_LABELS)[number];

/**
 * D1 stores timestamps as `YYYY-MM-DD HH:MM:SS.sss` in UTC with no zone marker,
 * so they have to be pinned to UTC explicitly — otherwise the browser reads them
 * as local time and everything lands in the wrong bucket by the offset.
 */
export function parseTimestamp(value: string): Date {
  const normalised = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalised) ? normalised : `${normalised}Z`);
}

/** Bucketing is relative to the *viewer's* local midnight, per the design. */
export function bucketFor(createdAt: string, now = new Date()): BucketLabel {
  const created = parseTimestamp(createdAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;

  if (created.getTime() >= startOfToday) return 'Today';
  if (created.getTime() >= startOfToday - 2 * day) return 'Last 3 days';
  if (created.getTime() >= startOfToday - 6 * day) return 'Last week';
  if (created.getTime() >= startOfToday - 29 * day) return 'Last month';
  return 'Older';
}

export function groupByBucket(
  screenshots: Screenshot[],
  now = new Date(),
): { label: BucketLabel; items: Screenshot[] }[] {
  const groups = new Map<BucketLabel, Screenshot[]>();
  for (const s of screenshots) {
    const label = bucketFor(s.created_at, now);
    const list = groups.get(label);
    if (list) list.push(s);
    else groups.set(label, [s]);
  }
  return BUCKET_LABELS.filter((l) => groups.has(l)).map((label) => ({
    label,
    items: groups.get(label)!,
  }));
}

export function formatTimestamp(value: string): string {
  return parseTimestamp(value).toLocaleString();
}
