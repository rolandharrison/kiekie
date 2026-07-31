import { describe, expect, it } from 'vitest';
import { extensionFor, sniffImage } from '../src/images';
import { pngBytes } from './helpers';

function bytes(...values: number[]) {
  return new Uint8Array(values);
}

describe('sniffImage', () => {
  it('reads PNG dimensions', () => {
    expect(sniffImage(pngBytes())).toEqual({ width: 2, height: 1, contentType: 'image/png' });
  });

  it('reads GIF dimensions (little-endian)', () => {
    const gif = new Uint8Array(20);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
    gif.set([0x20, 0x01, 0x10, 0x00], 6); // 288 x 16
    expect(sniffImage(gif)).toEqual({ width: 288, height: 16, contentType: 'image/gif' });
  });

  it('reads JPEG dimensions from the SOF0 frame', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0, length 4
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0xf4, // SOF0: h=300 w=500
      0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(sniffImage(jpeg)).toEqual({ width: 500, height: 300, contentType: 'image/jpeg' });
  });

  it('reads lossy WebP dimensions', () => {
    const webp = new Uint8Array(32);
    const write = (o: number, s: string) => s.split('').forEach((ch, i) => (webp[o + i] = ch.charCodeAt(0)));
    write(0, 'RIFF');
    write(8, 'WEBP');
    write(12, 'VP8 ');
    webp[26] = 0x40; webp[27] = 0x01; // 320
    webp[28] = 0xf0; webp[29] = 0x00; // 240
    expect(sniffImage(webp)).toEqual({ width: 320, height: 240, contentType: 'image/webp' });
  });

  it('returns nulls for bytes it does not recognise, without throwing', () => {
    expect(sniffImage(bytes(1, 2, 3))).toEqual({ width: null, height: null, contentType: null });
    expect(sniffImage(new Uint8Array(0))).toEqual({ width: null, height: null, contentType: null });
  });
});

describe('extensionFor', () => {
  it('prefers the sniffed content type', () => {
    expect(extensionFor('image/png', 'weird.name')).toBe('png');
    expect(extensionFor('image/jpeg', null)).toBe('jpg');
  });

  it('falls back to the filename extension, then to bin', () => {
    expect(extensionFor(null, 'capture.HEIC')).toBe('heic');
    expect(extensionFor(null, 'noextension')).toBe('bin');
    expect(extensionFor(null, null)).toBe('bin');
  });
});
