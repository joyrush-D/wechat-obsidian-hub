/**
 * Tests for HostAdapter contract — exercised via the InMemoryHostAdapter
 * reference implementation (which tests of downstream code can reuse).
 */
import { describe, it, expect } from 'vitest';
import { InMemoryHostAdapter } from '../../../src/core/adapters/host';

describe('InMemoryHostAdapter', () => {
  it('readFile throws for missing path', async () => {
    const h = new InMemoryHostAdapter();
    await expect(h.readFile('nope.md')).rejects.toThrow(/File not found/);
  });

  it('writeFile then readFile roundtrips content', async () => {
    const h = new InMemoryHostAdapter();
    await h.writeFile('a/b.md', 'hello');
    expect(await h.readFile('a/b.md')).toBe('hello');
  });

  it('fileExists reflects writeFile', async () => {
    const h = new InMemoryHostAdapter();
    expect(await h.fileExists('x')).toBe(false);
    await h.writeFile('x', 'y');
    expect(await h.fileExists('x')).toBe(true);
  });

  it('showNotice pushes to inspectable notices list', () => {
    const h = new InMemoryHostAdapter();
    h.showNotice('hello world', 2000);
    expect(h.notices).toEqual([{ message: 'hello world', durationMs: 2000 }]);
  });

  it('getBaseDir returns configured base', () => {
    const h = new InMemoryHostAdapter('/tmp/custom');
    expect(h.getBaseDir()).toBe('/tmp/custom');
  });

  it('overwrites existing file content', async () => {
    const h = new InMemoryHostAdapter();
    await h.writeFile('a', 'first');
    await h.writeFile('a', 'second');
    expect(await h.readFile('a')).toBe('second');
  });
});
