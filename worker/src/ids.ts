// URL-safe, unambiguous alphabet (no look-alike characters in the short ids).
const SHORT = '23456789abcdefghijkmnpqrstuvwxyz';
const LONG = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

function pick(alphabet: string, size: number): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < size; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Collection id — short and typeable, e.g. "kx3f9a". */
export const collectionId = () => pick(SHORT, 6);

/** Screenshot id, e.g. "ab12cd34". */
export const screenshotId = () => pick(SHORT, 8);

/** Annotation id. */
export const annotationId = () => pick(SHORT, 10);

/** Share token — must be unguessable. */
export const shareToken = () => pick(LONG, 21);
