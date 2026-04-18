/**
 * ACH runner — orchestrates the full Analysis of Competing Hypotheses pipeline:
 *   1. Collect relevant evidence from EvidenceStore (text search on WxObjects)
 *   2. Ask LLM to generate 4-6 competing hypotheses (incl. null)
 *   3. Ask LLM to mark every (hypothesis × evidence) cell as C/I/N
 *   4. Compute diagnosticity + inconsistency rank mechanically (ach.ts)
 *   5. Render markdown + persist analysis record
 *
 * Design:
 *   - LLM calls are separated so retries can target just the failed step
 *   - All arithmetic (ranking, diagnosticity) is mechanical — we do NOT
 *     trust the LLM to count or sort
 *   - Evidence entity_id passthrough means the final report cites real
 *     WxObject ids already in EvidenceStore (evidence chain integrity)
 */

import type { EvidenceStore } from '../storage/evidence-store';
import type { WxObject } from '../types/domain';
import type { AchAnalysis, AchEvidence } from './ach';
import { analyzeMatrix, renderAchMarkdown } from './ach';
import { buildHypothesisGenerationPrompt, parseHypotheses, buildEvidenceMarkingPrompt, parseMarkings, composeMatrix } from './ach-llm';

/** Minimal LLM interface — matches LlmClient but decoupled for testability. */
export interface AchLlm {
  complete(prompt: string): Promise<string>;
}

export interface AchRunnerOptions {
  /** Minimum length of WxObject.text to be considered worth including. */
  minEvidenceLength?: number;
  /** Cap on evidence items fed to the matrix (too many blows the LLM context). */
  maxEvidence?: number;
}

/** Collect evidence from store by keyword substring match. */
export function collectEvidence(
  store: EvidenceStore,
  keyword: string,
  opts: AchRunnerOptions = {},
): AchEvidence[] {
  // Default 8 chars — enough to skip "[voice]" / "[image]" / "嗯嗯" noise
  // but inclusive enough for substantive short Chinese sentences.
  const minLen = opts.minEvidenceLength ?? 8;
  const maxEv = opts.maxEvidence ?? 25;
  const kw = keyword.toLowerCase();
  const candidates = store.filter<WxObject>('object', (o) => {
    const t = (o.text || '').toLowerCase();
    return o.kind !== 'voice' && o.kind !== 'image' && t.length >= minLen && t.includes(kw);
  });

  // Helper: resolve an Actor reference id to its display name for human-readable
  // output. Returns undefined when no real name exists (so the renderer can omit
  // the noise rather than show a raw wxid / chatroom id).
  const nameFor = (actorId: string | undefined): string | undefined => {
    if (!actorId) return undefined;
    const a = store.get(actorId);
    const candidate = (a && a.type === 'actor')
      ? (a as any).displayName as string
      : actorId.replace(/^actor:[^:]+:/, '');
    if (!candidate) return undefined;
    // Suppress raw wxid / chatroom ids — those carry no info for the reader
    if (/^wxid_[a-z0-9]+$/i.test(candidate)) return undefined;
    if (/^[0-9]+@chatroom$/i.test(candidate)) return undefined;
    return candidate;
  };

  return candidates.slice(0, maxEv).map((o, i) => ({
    // Short positional ids for matrix keys — easier for the LLM to map back.
    id: `e${i + 1}`,
    description: o.text.slice(0, 200),
    entityId: o.id,
    grade: typeof o.metadata?.admiralty === 'string' ? o.metadata.admiralty : undefined,
    senderName: nameFor(o.authorId),
    containerName: nameFor(o.containerId),
  }));
}

export interface AchRunResult {
  analysis: AchAnalysis;
  markdown: string;
  raw: {
    hypothesisLlm: string;
    markingLlm: string;
  };
}

/**
 * Run the full ACH pipeline. Throws if hypothesis or marking LLM calls fail.
 * Caller can retry either step independently by re-running with cached
 * intermediate state (future feature).
 */
export async function runAch(
  topic: string,
  evidence: AchEvidence[],
  llm: AchLlm,
): Promise<AchRunResult> {
  if (evidence.length === 0) {
    throw new Error('ACH needs at least one piece of evidence');
  }

  // Step 2: hypothesis generation
  const hypPrompt = buildHypothesisGenerationPrompt(topic, evidence);
  const hypJson = await llm.complete(hypPrompt);
  const hypotheses = parseHypotheses(hypJson);
  if (hypotheses.length < 2) {
    throw new Error(`ACH requires ≥2 hypotheses; LLM returned ${hypotheses.length}`);
  }

  // Step 3: evidence marking
  const markPrompt = buildEvidenceMarkingPrompt(topic, hypotheses, evidence);
  const markJson = await llm.complete(markPrompt);
  const markings = parseMarkings(markJson);

  // Step 4: compose + analyze (mechanical)
  const matrix = composeMatrix(hypotheses, evidence, markings);
  const analysis = analyzeMatrix(topic, matrix);

  // Step 5: render
  const markdown = renderAchMarkdown(analysis);

  return {
    analysis,
    markdown,
    raw: { hypothesisLlm: hypJson, markingLlm: markJson },
  };
}
