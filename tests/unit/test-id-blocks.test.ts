/**
 * Guards the id-block registry in tests/helpers/id-blocks.ts. The overlaps it replaced
 * all started as a BASE constant copied from a sibling suite, so this checks that blocks
 * stay disjoint and that each suite takes its ids from the registry rather than its own
 * literal.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE, ID_BLOCKS, ID_BLOCK_CEILING, ID_BLOCK_FLOOR } from '../helpers/id-blocks';

const TESTS = join(process.cwd(), 'tests');
const suites = readdirSync(TESTS, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.test\.tsx?$/.test(f))
  .map((f) => f.split(sep).join('/'));
const read = (f: string) => readFileSync(join(TESTS, f), 'utf8');
const CLAIM = /\b(?:useIdBlock|idBlock)\('([^']+)'\)/g;

describe('test id blocks', () => {
  it('do not overlap, and sit between the floor and the auto-increment ceiling', () => {
    const rows = [...ID_BLOCKS].sort((a, b) => a[0] - b[0]);
    for (const [base, file] of rows) {
      expect(base, file).toBeGreaterThanOrEqual(ID_BLOCK_FLOOR);
      expect(base + BLOCK_SIZE, file).toBeLessThanOrEqual(ID_BLOCK_CEILING);
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i][0], `${rows[i - 1][1]} overlaps ${rows[i][1]}`).toBeGreaterThanOrEqual(rows[i - 1][0] + BLOCK_SIZE);
    }
  });

  it('give each suite one row', () => {
    const files = ID_BLOCKS.map(([, file]) => file);
    expect(files.filter((f, i) => files.indexOf(f) !== i)).toEqual([]);
  });

  it('are claimed by the suite each row names, and only by it', () => {
    const claimed = new Set<string>();
    for (const f of suites) {
      for (const [, claim] of read(f).matchAll(CLAIM)) {
        expect(claim, `tests/${f} claims the block of tests/${claim}`).toBe(f);
        claimed.add(claim);
      }
    }
    expect(ID_BLOCKS.map(([, file]) => file).filter((f) => !claimed.has(f))).toEqual([]);
  });

  it('are where suites get their ids, not a BASE literal of their own', () => {
    expect(suites.filter((f) => /^const (BASE|TEST_MARKER) = [0-9]/m.test(read(f)))).toEqual([]);
  });
});
