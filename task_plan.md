# Task Plan: v0.11.1+ Obsidian Native Integration Polish

> Goal: ship 3 features with verifiable Mac E2E proof for each.
> No commit gets pushed before evidence-on-disk shows it works on real data.

## Goal

Three features that complete the Obsidian-native experience:

1. **Topic wikilinks + auto-generated topic pages** — `[[WeChat-Topics/<keyword>]]` for `### XXX` headers in 今日要闻 + a corresponding `WeChat-Topics/<keyword>.md` page that backlinks to every briefing the topic appeared in
2. **"Insert today's briefing into Daily Note" command** — fits Obsidian Daily Notes plugin convention; appends today's briefing as a section in the user's daily note
3. **Skip wikilinking the user themselves** — `[[WeChat-People/Dexter]]` shouldn't appear; user's own name stays as plain text

## Acceptance: each phase MUST show this evidence before "complete"

- ✅ Unit tests pass for the new module(s)
- ✅ `npm run verify` clean
- ✅ Mac deploy + E2E run produces the expected effect (file count / wikilink count / specific content sample)
- ✅ Sample of generated content pasted into progress.md

## Phases

### Phase 1: Skip user wikilinks (smallest, do first)
- **Status:** in_progress
- **Why first:** Tiny change in existing wikilink-enricher integration; lowest risk, fastest feedback
- **Plan:**
  - Modify `enrichWithObsidianLinks` in main.ts to filter out user identities from PersonMention[]
  - Verify on Mac: `grep '\[\[WeChat-People/Dexter\]\]'` should return 0 hits in regenerated briefing
  - Commit only after grep verification
- **Files touched:** src/main.ts
- **Estimated:** ~30 min

### Phase 2: Topic wikilinks + topic profile pages
- **Status:** todo
- **Plan:**
  - New module `src/obsidian/topic-extractor.ts` — pulls `### <topic>` headers from briefing markdown, returns `TopicMention[]`
  - New module `src/obsidian/topic-profile.ts` — mirror person-profile.ts but for topics; aggregates message ids that mention the topic
  - Tests for both modules (target ≥10 each)
  - Wire into main.ts after person enrichment
  - Mac E2E: `ls WeChat-Topics/ | wc -l` should show ≥3 topics for a typical briefing
- **Files touched:** src/obsidian/topic-extractor.ts, src/obsidian/topic-profile.ts, src/main.ts, tests/obsidian/...
- **Estimated:** ~90 min

### Phase 3: Insert into Daily Note command
- **Status:** todo
- **Plan:**
  - New Obsidian command `insert-briefing-into-daily-note`
  - Detect daily note location (settings → 'Daily Notes folder' or default)
  - Pick the latest briefing from today, embed as `## 微信日报` section
  - Or use `![[WeChat-Briefings/<slug>]]` transclusion link
  - Mac E2E: trigger command, verify daily note file modified
- **Files touched:** src/main.ts, src/settings.ts (add daily-notes folder setting)
- **Estimated:** ~45 min

## Order

Phase 1 → Phase 3 (small commands) → Phase 2 (bigger refactor)

Reason: Phase 1 + Phase 3 build muscle memory before tackling Phase 2 (which has more tests + more integration).

## Verification Gates (Per Phase)

```
[ ] Code written
[ ] Unit tests added & passing
[ ] npm run verify clean (typecheck + ALL tests + build)
[ ] Deployed to Mac via scripts/deploy-to-mac.sh
[ ] Mac E2E command run + observed expected output
[ ] Sample/grep evidence pasted into progress.md
[ ] Commit pushed
```

## Decisions Log

- **Why filter user wxid first** — User's reaction to seeing `[[WeChat-People/Dexter]]` in own briefing was a papercut they explicitly flagged. Cheapest win.
- **Why topic profile pages not just topic wikilinks** — Without a target page, `[[WeChat-Topics/X]]` becomes a dangling link. Auto-generating the page makes the wikilinks live + creates the cross-time topic backlink view that PKM users want.
- **Daily Notes integration as a COMMAND not auto** — Auto-inserting would surprise users; making it explicit (Cmd+P → command) respects user agency.

## Errors Encountered

(empty — will populate as we go)
