import type { ComponentChildren } from 'preact';

/**
 * Hand-rolled 16px icons. Inlining them keeps the bundle self-contained — an
 * icon font or sprite would be a second request, and on the public share page
 * only /assets is reachable without a login, so fewer moving parts is better.
 *
 * Every icon is a stroked path on a 16×16 grid using `currentColor`, so they
 * inherit whatever colour the surrounding button or link already has.
 */

interface IconProps {
  size?: number;
}

function Glyph({ size, children }: { size: number; children: ComponentChildren }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class="icon"
    >
      {children}
    </svg>
  );
}

export function IconArrowLeft({ size = 14 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M12.5 8h-9M7 3.5 2.5 8 7 12.5" />
    </Glyph>
  );
}

export function IconShare({ size = 14 }: IconProps) {
  return (
    <Glyph size={size}>
      <circle cx="12" cy="3.8" r="2" />
      <circle cx="4" cy="8" r="2" />
      <circle cx="12" cy="12.2" r="2" />
      <path d="M5.8 7.1 10.2 4.9M5.8 8.9l4.4 2.2" />
    </Glyph>
  );
}

export function IconPlus({ size = 14 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Glyph>
  );
}

export function IconUpload({ size = 14 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M8 10.5v-8M4.8 5.7 8 2.5l3.2 3.2" />
      <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </Glyph>
  );
}

export function IconLink({ size = 14 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l1.8-1.8a2.6 2.6 0 0 0-3.7-3.7l-1 1" />
      <path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3L3.7 8.1a2.6 2.6 0 0 0 3.7 3.7l1-1" />
    </Glyph>
  );
}

export function IconDownload({ size = 14 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M8 2.5v8M4.8 7.3 8 10.5l3.2-3.2" />
      <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </Glyph>
  );
}

export function IconEye({ size = 14 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M1.5 8S3.9 3.8 8 3.8 14.5 8 14.5 8 12.1 12.2 8 12.2 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </Glyph>
  );
}

export function IconImage({ size = 14 }: IconProps) {
  return (
    <Glyph size={size}>
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <circle cx="5.7" cy="6.4" r="1.1" />
      <path d="m2.6 11.4 3-2.7 2.6 2.3 2-1.7 3.2 2.6" />
    </Glyph>
  );
}

export function IconSun({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.4v1.4M8 13.2v1.4M14.6 8h-1.4M2.8 8H1.4M12.7 3.3l-1 1M4.3 11.7l-1 1M12.7 12.7l-1-1M4.3 4.3l-1-1" />
    </Glyph>
  );
}

export function IconMoon({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7Z" />
    </Glyph>
  );
}
