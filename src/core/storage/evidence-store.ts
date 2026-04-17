/**
 * EvidenceStore — persistent home for domain entities and Findings.
 *
 * Per VISION.md §Capability 1 (Evidence Chain Integrity) the store guarantees:
 *   1. Every stored entity has a stable id — can be referenced from Findings
 *   2. Evidence entries are append-only (overwrites by id require explicit allow)
 *   3. Cross-session persistence via a JSON directory
 *
 * Storage layout:
 *   <dir>/
 *     actors.json          { id: Actor }
 *     objects.json         { id: WxObject }
 *     events.json          { id: Event }
 *     relationships.json   { id: Relationship }
 *     indicators.json      { id: Indicator }
 *     reports.json         { id: Report }
 *     findings.json        { id: Finding }
 *
 * One file per type keeps writes narrowed and makes the on-disk layout
 * navigable by humans during development.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type {
  AnyDomainEntity, DomainEntityType,
  Actor, WxObject, Event as DomainEvent, Relationship, Indicator, Report,
} from '../types/domain';
import type { Finding } from '../types/finding';

type FileMap = {
  actors: Record<string, Actor>;
  objects: Record<string, WxObject>;
  events: Record<string, DomainEvent>;
  relationships: Record<string, Relationship>;
  indicators: Record<string, Indicator>;
  reports: Record<string, Report>;
  findings: Record<string, Finding>;
};

const FILE_FOR_TYPE: Record<DomainEntityType, keyof Omit<FileMap, 'findings'>> = {
  actor: 'actors',
  object: 'objects',
  event: 'events',
  relationship: 'relationships',
  indicator: 'indicators',
  report: 'reports',
};

export class EvidenceStoreError extends Error {}

export class EvidenceStore {
  private dir: string;
  private data: FileMap;

  constructor(dir: string) {
    this.dir = dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.data = {
      actors: this.loadFile('actors'),
      objects: this.loadFile('objects'),
      events: this.loadFile('events'),
      relationships: this.loadFile('relationships'),
      indicators: this.loadFile('indicators'),
      reports: this.loadFile('reports'),
      findings: this.loadFile('findings'),
    };
  }

  // ==========================================================================
  // Entity ops
  // ==========================================================================

  put(entity: AnyDomainEntity, opts: { allowOverwrite?: boolean } = {}): void {
    const file = FILE_FOR_TYPE[entity.type];
    const bucket = this.data[file] as Record<string, AnyDomainEntity>;
    if (bucket[entity.id] && !opts.allowOverwrite) {
      const existing = bucket[entity.id];
      if (!this.shallowEqual(existing, entity)) {
        throw new EvidenceStoreError(
          `Refusing to overwrite entity ${entity.id} (type=${entity.type}) with different content. Pass {allowOverwrite: true} to mutate.`,
        );
      }
      return;
    }
    bucket[entity.id] = entity;
    this.persist(file);
  }

  get(id: string): AnyDomainEntity | null {
    for (const file of Object.values(FILE_FOR_TYPE)) {
      const bucket = this.data[file] as Record<string, AnyDomainEntity>;
      if (bucket[id]) return bucket[id];
    }
    return null;
  }

  list(type: DomainEntityType): AnyDomainEntity[] {
    const file = FILE_FOR_TYPE[type];
    return Object.values(this.data[file] as Record<string, AnyDomainEntity>);
  }

  /** Filtered list — cheap helper. */
  filter<T extends AnyDomainEntity>(type: DomainEntityType, pred: (e: T) => boolean): T[] {
    return this.list(type).filter(pred as any) as T[];
  }

  has(id: string): boolean {
    return this.get(id) !== null;
  }

  // ==========================================================================
  // Finding ops (separate from entities because Findings aren't evidence themselves)
  // ==========================================================================

  putFinding(finding: Finding, opts: { allowOverwrite?: boolean } = {}): void {
    if (this.data.findings[finding.id] && !opts.allowOverwrite) {
      const existing = this.data.findings[finding.id];
      if (!this.shallowEqual(existing, finding)) {
        throw new EvidenceStoreError(
          `Refusing to overwrite finding ${finding.id} with different content.`,
        );
      }
      return;
    }
    this.data.findings[finding.id] = finding;
    this.persist('findings');
  }

  getFinding(id: string): Finding | null {
    return this.data.findings[id] ?? null;
  }

  listFindings(): Finding[] {
    return Object.values(this.data.findings);
  }

  /** Return all findings whose evidenceRefs mention the given entity id. */
  findingsReferencing(entityId: string): Finding[] {
    return this.listFindings().filter(f =>
      f.evidenceRefs.some(r => r.entityId === entityId),
    );
  }

  /** Stats for debugging / UI. */
  stats(): { actors: number; objects: number; events: number; relationships: number; indicators: number; reports: number; findings: number } {
    return {
      actors: Object.keys(this.data.actors).length,
      objects: Object.keys(this.data.objects).length,
      events: Object.keys(this.data.events).length,
      relationships: Object.keys(this.data.relationships).length,
      indicators: Object.keys(this.data.indicators).length,
      reports: Object.keys(this.data.reports).length,
      findings: Object.keys(this.data.findings).length,
    };
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private loadFile<K extends keyof FileMap>(name: K): FileMap[K] {
    const path = join(this.dir, `${name}.json`);
    if (!existsSync(path)) return {} as FileMap[K];
    try {
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw);
      return (typeof parsed === 'object' && parsed !== null ? parsed : {}) as FileMap[K];
    } catch {
      return {} as FileMap[K];
    }
  }

  private persist<K extends keyof FileMap>(name: K): void {
    const path = join(this.dir, `${name}.json`);
    writeFileSync(path, JSON.stringify(this.data[name], null, 2), 'utf-8');
  }

  /** Shallow deep-equal via JSON stringify — sufficient for POJOs. */
  private shallowEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
