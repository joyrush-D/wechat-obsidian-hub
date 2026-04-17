# Changelog

## [0.1.0] - 2026-04-17 (Initial Release)

### Added
- **Core Intelligence Pipeline** — 5-stage processing: Triage → Extract → Cluster → Synthesize → Enrich
- **Mac WeChat 4.0+ Support** — decrypt SQLCipher 4 databases with WCDB zstd compression
- **Auto Key Extraction** — one-time script with signature backup+restore (no permanent app modification)
- **Daily Decryption** — refresh messages on every briefing run, no sudo needed after setup
- **Intelligence Features:**
  - PDB-format output (CIA President's Daily Brief style)
  - BLUF (Bottom Line Up Front) at top
  - Sherman Kent estimative language (7-level confidence)
  - NATO Admiralty Code source evaluation (rendered as plain Chinese)
  - NSA Tearline — 30-second TL;DR
  - Israeli Tenth Man — forced devil's advocate section
  - Heuer 18-bias audit — post-brief quality check
  - ICD 203 analytic standards discipline
- **Cross-Group Topic Clustering** — group by topic, not by conversation
- **@-Mention Detection** — highlights messages requiring your response
- **Source Trust Accumulation** — tracks speaker credibility over time
- **Extraction Persistence** — cache per-conversation extractions, skip re-work on re-runs
- **Data Freshness Indicator** — shows timestamp of latest message + report generation time
- **Model Auto-Detection** — works with whichever model is loaded in LM Studio
- **Filter Broken Links** — skip "version not supported" pseudo-URLs

### Supported Message Types
- Text (including compressed)
- Voice messages (duration shown)
- Videos (duration shown)
- Images (placeholder with metadata)
- Links (title + description + URL)
- Files (name + size)
- Mini-programs
- Quoted replies (with context)
- Forwarded chat histories
- Group announcements
- System messages
- Revoked messages
