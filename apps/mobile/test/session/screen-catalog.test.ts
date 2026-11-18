/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import fs from 'node:fs';
import path from 'node:path';
import {
  routeFiles,
  SCREENS,
  type ScreenEntry,
  screenHref,
} from '../../src/session/screen-catalog.js';

// Screen catalog (3.2 §11.1): the 63 screens of §10, and every screen marked as done has its
// file in app/ with the ID comment on its first line ("// F-02 · Elegir meses").

const APP_DIR = path.resolve(__dirname, '../../app');

/** app/<route>.tsx or app/<route>/index.tsx, whichever exists. */
function fileOf(route: string): string | null {
  for (const candidate of [`${route}.tsx`, path.join(route, 'index.tsx')]) {
    const file = path.join(APP_DIR, candidate);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

const firstLine = (file: string) => fs.readFileSync(file, 'utf8').split('\n', 1)[0] ?? '';

describe('screen catalog', () => {
  it('has the 63 screens of 3.2 §10, each ID and route once', () => {
    expect(SCREENS).toHaveLength(63);
    expect(new Set(SCREENS.map((s) => s.id)).size).toBe(63);
    expect(new Set(SCREENS.map((s) => s.route)).size).toBe(63);
  });

  it('uses Figma IDs, English routes under (auth) or (app) and Spanish titles', () => {
    for (const entry of SCREENS) {
      expect(entry.id).toMatch(/^[A-Z]-\d{2}$/);
      expect(entry.route).toMatch(/^\((auth|app)\)\/[a-z0-9_\-/[\]<>]+$/);
      expect(entry.title.trim()).not.toBe('');
    }
  });

  const done = SCREENS.filter((entry: ScreenEntry) => entry.done);

  it('marks the screens of M2 to M5 as done', () => {
    expect(done.map((entry) => entry.id)).toEqual([
      'C-01',
      'C-02',
      'C-04',
      'C-05',
      'G-01',
      'G-02',
      'G-03',
      'G-11',
      'P-01',
      'P-02',
      'P-03',
      'P-04',
      'P-05',
      'P-06',
      'J-06',
      'S-01',
      'S-02',
      'S-03',
      'S-04',
      'S-05',
      'S-06',
      'S-07',
      'S-08',
      'R-01',
      'R-02',
      'R-03',
      'A-01',
      'A-02',
      'A-03',
      'A-04',
    ]);
  });

  it.each(done.map((entry) => [entry.id, entry] as const))(
    '%s has its file in app/ with the ID comment',
    (_id, entry) => {
      for (const route of routeFiles(entry)) {
        const file = fileOf(route);
        expect({ route, file: file !== null }).toEqual({ route, file: true });
        if (file) expect(firstLine(file)).toBe(`// ${entry.id} · ${entry.title}`);
      }
    },
  );

  it('builds URLs without the route groups', () => {
    const more = SCREENS.find((s) => s.id === 'C-04');
    const profile = SCREENS.find((s) => s.id === 'C-05');
    if (!more || !profile) throw new Error('missing screens');
    expect(screenHref(more, 'block_leader')).toBe('/block_leader/more');
    expect(screenHref(profile)).toBe('/common/profile');
    expect(routeFiles(more)).toHaveLength(6);
  });
});
