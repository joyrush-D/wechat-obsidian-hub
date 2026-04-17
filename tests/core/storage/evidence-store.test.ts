/**
 * Tests for EvidenceStore — domain entity + Finding persistence.
 * Uses sandboxed temp dir; no real filesystem dependencies beyond tmpdir.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EvidenceStore, EvidenceStoreError } from '../../../src/core/storage/evidence-store';
import type { Actor, WxObject } from '../../../src/core/types/domain';
import type { Finding } from '../../../src/core/types/finding';

const NOW = '2026-04-18T10:00:00Z';

function makeActor(id: string, overrides: Partial<Actor> = {}): Actor {
  return {
    id,
    type: 'actor',
    createdAt: NOW,
    sourceAdapter: 'wechat',
    displayName: `Person ${id}`,
    aliases: [id],
    isGroup: false,
    ...overrides,
  };
}

function makeObject(id: string, overrides: Partial<WxObject> = {}): WxObject {
  return {
    id,
    type: 'object',
    createdAt: NOW,
    sourceAdapter: 'wechat',
    kind: 'message',
    text: `Message ${id}`,
    occurredAt: NOW,
    ...overrides,
  };
}

function makeFinding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    createdAt: NOW,
    judgment: 'Test judgment',
    kentPhrase: 'likely',
    probRange: [60, 80],
    sourceGrade: 'B2',
    evidenceRefs: [{ entityId: 'o-1', stance: 'supports', grade: 'B2' }],
    assumptions: [],
    ...overrides,
  };
}

describe('EvidenceStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owh-evstore-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('entity put/get', () => {
    it('stores and retrieves an actor by id', () => {
      const store = new EvidenceStore(dir);
      const a = makeActor('wxid_1');
      store.put(a);
      expect(store.get('wxid_1')).toEqual(a);
    });

    it('get returns null for unknown id', () => {
      const store = new EvidenceStore(dir);
      expect(store.get('nonexistent')).toBeNull();
    });

    it('has reports membership correctly', () => {
      const store = new EvidenceStore(dir);
      store.put(makeActor('wxid_1'));
      expect(store.has('wxid_1')).toBe(true);
      expect(store.has('wxid_nope')).toBe(false);
    });

    it('entities with same id and content deduplicate silently', () => {
      const store = new EvidenceStore(dir);
      const a = makeActor('wxid_1');
      store.put(a);
      expect(() => store.put(a)).not.toThrow();
      expect(store.list('actor')).toHaveLength(1);
    });

    it('refuses to overwrite existing entity with different content (default)', () => {
      const store = new EvidenceStore(dir);
      store.put(makeActor('wxid_1'));
      expect(() => store.put(makeActor('wxid_1', { displayName: 'Changed' })))
        .toThrow(EvidenceStoreError);
    });

    it('allows overwrite when {allowOverwrite: true} is passed', () => {
      const store = new EvidenceStore(dir);
      store.put(makeActor('wxid_1'));
      const mutated = makeActor('wxid_1', { displayName: 'Changed' });
      expect(() => store.put(mutated, { allowOverwrite: true })).not.toThrow();
      expect(store.get('wxid_1')).toMatchObject({ displayName: 'Changed' });
    });
  });

  describe('list and filter', () => {
    it('list returns all entities of a given type', () => {
      const store = new EvidenceStore(dir);
      store.put(makeActor('a1'));
      store.put(makeActor('a2', { isGroup: true }));
      store.put(makeObject('o1'));

      expect(store.list('actor')).toHaveLength(2);
      expect(store.list('object')).toHaveLength(1);
      expect(store.list('event')).toHaveLength(0);
    });

    it('filter applies a predicate on the list', () => {
      const store = new EvidenceStore(dir);
      store.put(makeActor('a1', { isGroup: false }));
      store.put(makeActor('a2', { isGroup: true }));
      store.put(makeActor('a3', { isGroup: true }));

      const groups = store.filter<Actor>('actor', a => a.isGroup);
      expect(groups).toHaveLength(2);
    });
  });

  describe('Finding ops', () => {
    it('stores and retrieves a Finding', () => {
      const store = new EvidenceStore(dir);
      const f = makeFinding('f-1');
      store.putFinding(f);
      expect(store.getFinding('f-1')).toEqual(f);
    });

    it('listFindings returns all findings', () => {
      const store = new EvidenceStore(dir);
      store.putFinding(makeFinding('f-1'));
      store.putFinding(makeFinding('f-2'));
      expect(store.listFindings()).toHaveLength(2);
    });

    it('findingsReferencing returns findings that cite a given entity', () => {
      const store = new EvidenceStore(dir);
      store.putFinding(makeFinding('f-1', {
        evidenceRefs: [{ entityId: 'o-1', stance: 'supports', grade: 'B2' }],
      }));
      store.putFinding(makeFinding('f-2', {
        evidenceRefs: [{ entityId: 'o-2', stance: 'supports', grade: 'B2' }],
      }));
      expect(store.findingsReferencing('o-1')).toHaveLength(1);
      expect(store.findingsReferencing('o-2')).toHaveLength(1);
      expect(store.findingsReferencing('o-3')).toHaveLength(0);
    });

    it('refuses to overwrite Finding with different content by default', () => {
      const store = new EvidenceStore(dir);
      store.putFinding(makeFinding('f-1'));
      expect(() => store.putFinding(makeFinding('f-1', { judgment: 'Changed' })))
        .toThrow();
    });
  });

  describe('persistence', () => {
    it('writes JSON files per entity type', () => {
      const store = new EvidenceStore(dir);
      store.put(makeActor('a1'));
      store.put(makeObject('o1'));
      store.putFinding(makeFinding('f-1'));

      expect(existsSync(join(dir, 'actors.json'))).toBe(true);
      expect(existsSync(join(dir, 'objects.json'))).toBe(true);
      expect(existsSync(join(dir, 'findings.json'))).toBe(true);
    });

    it('second instance reads data written by first', () => {
      const a = new EvidenceStore(dir);
      a.put(makeActor('persistent', { displayName: '持久化测试' }));
      a.putFinding(makeFinding('f-persist'));

      const b = new EvidenceStore(dir);
      expect(b.get('persistent')).toMatchObject({ displayName: '持久化测试' });
      expect(b.getFinding('f-persist')).toBeDefined();
    });

    it('creates directory if it does not exist', () => {
      const nested = join(dir, 'deep', 'nested');
      new EvidenceStore(nested);
      expect(existsSync(nested)).toBe(true);
    });
  });

  describe('stats', () => {
    it('reports zero counts for empty store', () => {
      const store = new EvidenceStore(dir);
      expect(store.stats()).toEqual({
        actors: 0, objects: 0, events: 0, relationships: 0,
        indicators: 0, reports: 0, findings: 0,
      });
    });

    it('reports accurate counts after inserts', () => {
      const store = new EvidenceStore(dir);
      store.put(makeActor('a1'));
      store.put(makeActor('a2'));
      store.put(makeObject('o1'));
      store.putFinding(makeFinding('f1'));

      expect(store.stats().actors).toBe(2);
      expect(store.stats().objects).toBe(1);
      expect(store.stats().findings).toBe(1);
    });
  });
});
