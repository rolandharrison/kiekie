import path from 'node:path';

export interface Mapping {
  /** Host-side prefix, normalised (forward slashes, upper-cased drive letter). */
  host: string;
  /** Container-side prefix the volume is mounted at. */
  container: string;
  /** Prefix exactly as the user wrote it, for error messages. */
  raw: string;
}

/**
 * Normalise a path for prefix comparison: backslashes to forward slashes,
 * collapsed separators, no trailing separator, and an upper-cased drive letter
 * so `c:\dev` and `C:/Dev` are the same root.
 */
export function normalise(input: string): string {
  let p = input.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (/^[a-zA-Z]:/.test(p)) p = p[0].toUpperCase() + p.slice(1);
  return p;
}

/** Windows paths are case-insensitive; POSIX ones are not. */
function isWindowsPath(p: string): boolean {
  return /^[A-Z]:\//.test(p) || /^[A-Z]:$/.test(p);
}

/**
 * Parse `PATH_MAP` — `hostPrefix=containerPrefix`, multiple entries separated by
 * `;` or a newline. Longest host prefix is tried first so nested mounts resolve
 * to the most specific one.
 */
export function parsePathMap(spec: string | undefined): Mapping[] {
  if (!spec?.trim()) return [];
  return spec
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      // Split on the last `=` so Windows drive letters (`C:\Dev=/host/dev`) work.
      const idx = entry.lastIndexOf('=');
      if (idx <= 0) throw new Error(`invalid PATH_MAP entry: "${entry}" (expected host=container)`);
      const rawHost = entry.slice(0, idx).trim();
      const container = normalise(entry.slice(idx + 1));
      if (!rawHost || !container) {
        throw new Error(`invalid PATH_MAP entry: "${entry}" (expected host=container)`);
      }
      return { host: normalise(rawHost), container, raw: rawHost };
    })
    .sort((a, b) => b.host.length - a.host.length);
}

export class UnmappedPathError extends Error {
  constructor(input: string, mappings: Mapping[]) {
    const roots = mappings.map((m) => m.raw).join(', ') || '(none configured)';
    super(
      `"${input}" is not under any mounted root. Save screenshots under one of: ${roots}. ` +
        'Mounted roots come from the PATH_MAP env var and the matching Docker volume mounts.',
    );
    this.name = 'UnmappedPathError';
  }
}

function startsWithPrefix(candidate: string, prefix: string, caseInsensitive: boolean): boolean {
  const a = caseInsensitive ? candidate.toLowerCase() : candidate;
  const b = caseInsensitive ? prefix.toLowerCase() : prefix;
  // Either the path *is* the root, or it sits beneath it — "/host/devil" must
  // not match the root "/host/dev".
  return a === b || a.startsWith(b.endsWith('/') ? b : `${b}/`);
}

/**
 * Translate a host path (as Claude Code knows it) into the container path where
 * the file is actually readable.
 */
export function mapPath(input: string, mappings: Mapping[]): string {
  const candidate = normalise(input);

  for (const m of mappings) {
    if (startsWithPrefix(candidate, m.host, isWindowsPath(m.host))) {
      const remainder = candidate.slice(m.host.length).replace(/^\/+/, '');
      const joined = remainder ? `${m.container}/${remainder}` : m.container;
      const resolved = path.posix.normalize(joined);
      // `..` in the input must not be able to climb out of the mount.
      if (!startsWithPrefix(resolved, m.container, false)) {
        throw new UnmappedPathError(input, mappings);
      }
      return resolved;
    }
  }

  // With no mappings configured the server is running outside Docker, so host
  // paths are already container paths.
  if (mappings.length === 0) return candidate;

  throw new UnmappedPathError(input, mappings);
}
