import { describe, expect, it } from 'vitest';
import { mapPath, normalise, parsePathMap, UnmappedPathError } from '../src/pathmap.js';

const windows = parsePathMap('C:\\Dev=/host/dev');
const posix = parsePathMap('/Users/roland/dev=/host/dev');

describe('normalise', () => {
  it('converts separators, collapses duplicates and trims trailing slashes', () => {
    expect(normalise('C:\\Dev\\\\proj\\shot.png')).toBe('C:/Dev/proj/shot.png');
    expect(normalise('/host/dev/')).toBe('/host/dev');
    expect(normalise('  /host/dev  ')).toBe('/host/dev');
  });

  it('upper-cases the drive letter', () => {
    expect(normalise('c:/dev')).toBe('C:/dev');
  });
});

describe('parsePathMap', () => {
  it('parses a single Windows entry despite the drive-letter colon', () => {
    expect(parsePathMap('C:\\Dev=/host/dev')).toEqual([
      { host: 'C:/Dev', container: '/host/dev', raw: 'C:\\Dev' },
    ]);
  });

  it('parses multiple entries and orders the longest prefix first', () => {
    const maps = parsePathMap('/home/r=/host/home;/home/r/shots=/host/shots');
    expect(maps.map((m: { container: string }) => m.container)).toEqual(['/host/shots', '/host/home']);
  });

  it('accepts newline-separated entries', () => {
    expect(parsePathMap('/a=/x\n/b=/y')).toHaveLength(2);
  });

  it('returns nothing for an empty spec', () => {
    expect(parsePathMap(undefined)).toEqual([]);
    expect(parsePathMap('   ')).toEqual([]);
  });

  it('rejects a malformed entry', () => {
    expect(() => parsePathMap('nonsense')).toThrow(/invalid PATH_MAP entry/);
    expect(() => parsePathMap('=/host/dev')).toThrow(/invalid PATH_MAP entry/);
  });
});

describe('mapPath', () => {
  it('maps a Windows host path into the container', () => {
    expect(mapPath('C:\\Dev\\proj\\shot.png', windows)).toBe('/host/dev/proj/shot.png');
  });

  it('is case-insensitive on the Windows prefix', () => {
    expect(mapPath('c:/dev/proj/shot.png', windows)).toBe('/host/dev/proj/shot.png');
    expect(mapPath('C:/DEV/proj/shot.png', windows)).toBe('/host/dev/proj/shot.png');
  });

  it('maps the mount root itself', () => {
    expect(mapPath('C:\\Dev', windows)).toBe('/host/dev');
  });

  it('maps a POSIX host path and stays case-sensitive there', () => {
    expect(mapPath('/Users/roland/dev/app/shot.png', posix)).toBe('/host/dev/app/shot.png');
    expect(() => mapPath('/users/roland/dev/app/shot.png', posix)).toThrow(UnmappedPathError);
  });

  it('picks the longest matching prefix', () => {
    const maps = parsePathMap('/home/r=/host/home;/home/r/shots=/host/shots');
    expect(mapPath('/home/r/shots/a.png', maps)).toBe('/host/shots/a.png');
    expect(mapPath('/home/r/other/a.png', maps)).toBe('/host/home/other/a.png');
  });

  it('does not treat a sibling directory as being under the root', () => {
    expect(() => mapPath('C:\\Development\\shot.png', windows)).toThrow(UnmappedPathError);
  });

  it('refuses to climb out of the mount with ..', () => {
    expect(() => mapPath('C:\\Dev\\..\\Secrets\\shot.png', windows)).toThrow(UnmappedPathError);
  });

  it('still resolves .. that stays inside the mount', () => {
    expect(mapPath('C:\\Dev\\a\\..\\b\\shot.png', windows)).toBe('/host/dev/b/shot.png');
  });

  it('names the mounted roots when a path is unmapped', () => {
    expect(() => mapPath('D:\\Elsewhere\\shot.png', windows)).toThrow(/C:\\Dev/);
    expect(() => mapPath('D:\\Elsewhere\\shot.png', windows)).toThrow(/not under any mounted root/);
  });

  it('passes paths through untouched when no mapping is configured', () => {
    expect(mapPath('/tmp/shot.png', [])).toBe('/tmp/shot.png');
    expect(mapPath('C:\\Dev\\shot.png', [])).toBe('C:/Dev/shot.png');
  });
});
