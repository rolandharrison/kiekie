/**
 * Minimal image header sniffing — enough to record width/height at upload time so
 * the viewer can overlay normalised annotation regions accurately. No dependencies,
 * and it never throws: unknown formats simply yield nulls.
 */
export interface ImageInfo {
  width: number | null;
  height: number | null;
  contentType: string | null;
}

export function sniffImage(bytes: Uint8Array): ImageInfo {
  return png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes) ?? {
    width: null,
    height: null,
    contentType: null,
  };
}

function u32be(b: Uint8Array, o: number) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function u16be(b: Uint8Array, o: number) {
  return (b[o] << 8) | b[o + 1];
}
function u16le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}

function png(b: Uint8Array): ImageInfo | null {
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return null;
  return { width: u32be(b, 16), height: u32be(b, 20), contentType: 'image/png' };
}

function gif(b: Uint8Array): ImageInfo | null {
  if (b.length < 10) return null;
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;
  return { width: u16le(b, 6), height: u16le(b, 8), contentType: 'image/gif' };
}

function webp(b: Uint8Array): ImageInfo | null {
  if (b.length < 30) return null;
  const tag = (o: number, s: string) =>
    s.split('').every((c, i) => b[o + i] === c.charCodeAt(0));
  if (!tag(0, 'RIFF') || !tag(8, 'WEBP')) return null;
  const type = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (type === 'VP8 ') {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, contentType: 'image/webp' };
  }
  if (type === 'VP8L') {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      contentType: 'image/webp',
    };
  }
  if (type === 'VP8X') {
    const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width: w, height: h, contentType: 'image/webp' };
  }
  return { width: null, height: null, contentType: 'image/webp' };
}

function jpeg(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o++;
      continue;
    }
    const marker = b[o + 1];
    // SOF0..SOF15 carry the frame dimensions; skip DHT/DAC/RST variants.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: u16be(b, o + 7), height: u16be(b, o + 5), contentType: 'image/jpeg' };
    }
    const len = u16be(b, o + 2);
    if (len < 2) break;
    o += 2 + len;
  }
  return { width: null, height: null, contentType: 'image/jpeg' };
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function extensionFor(contentType: string | null, filename?: string | null): string {
  if (contentType && EXT[contentType]) return EXT[contentType];
  const m = filename?.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : 'bin';
}
