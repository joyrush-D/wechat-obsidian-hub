# Changelog

## [0.2.1] - 2026-04-17

### Changed
- **Retrospective commands use IdentityResolver**:
  - Weekly Rollup: passes resolver to LLM with hint to merge same-person-different-names
  - Topic Brief: if keyword matches a person, auto-expands search to ALL their aliases
    (e.g., searching for a contact by one nickname also finds discussions using
    their other group-specific nicknames)
  - ACH Analysis: same subject-centric expansion
  - Output headers now show which aliases were searched
- **Shared ensureIdentityResolver() helper** — built on-demand, cached on plugin instance
- **@ section header trimmed** — no longer lists all user aliases (noise)

## [0.2.0] - 2026-04-17

### Added
- **IdentityResolver** — system-wide authoritative person index
  - Indexes every wxid with ALL its aliases (contact, nickName, remark, per-group nicknames)
  - Each user may have dozens of per-group nicknames (name varies by group context)
  - Applied in: message parsing, Pattern of Life, @mention scan, Source Trust, Group Dossier
- **Lazy Group Dossier** — `[[WeChat-Groups/群名]]` wikilinks in briefings auto-populate on first click
  - 7-day activity with ASCII bar chart
  - Top 10 speakers, all shared links, last 100 raw messages
  - No pre-generation — vault stays clean
- **Direct Synthesis mode** — single-pass briefing avoids cascaded summarization info loss
  - Previously: extract→cluster→synthesize (3 LLM calls, each lossy)
  - Now: one LLM call on raw messages with full context (requires 100K+ context model)

### Fixed
- **@ mention detection** — was only searching wxid alias ("joyrush"), missed all other identities
- **Group names showed as MD5 hash** — now resolved back to real display names via hash→wxid reverse index
- **Time cutoff** — "24 hours" now means "since local midnight today" (not rolling 24h window)
- **Pattern of Life duplicates** — same person under different group nicknames no longer split
- **Pattern of Life filter** — 3-char minimum (was 10) recovered messages like "你这是什么时候的"
- **Clustering fabrications** — strict rules against grouping unrelated items (e.g., "差旅" + "稳定币")
- **Reflexive Control false positives** — conservative defaults, no paranoid conspiracy theories
- **Stale extraction cache** — now refreshes when conversation has new messages
- **Source trust cold start** — bootstrap from contact attributes (remark > B, DM > B)

### Changed
- Briefing structure (boss-optimized top-down):
  1. 30-second Tearline
  2. 📍 Direct @ you (mechanical scan, never cached)
  3. Main PDB brief (BLUF / @mentions / Today's News / Key Judgments / Tenth Man / Watch / Resources)
  4. 👥 Pattern of Life (mechanical list of ALL remarked contacts + LLM deep analysis)
  5. Optional: Reflexive Control, Bias Audit, Shareable Tearline (all off by default)

### Privacy
- Verified no keys/chats/contacts leaked to public repo
- `docs/superpowers/` (internal design docs) excluded from git
- `all_keys.json`, `data.json`, `WeChat-Briefings/`, `*.db` all gitignored

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
