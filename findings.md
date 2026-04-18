# Findings

## How user identities are tracked in main.ts (relevant for Phase 1)

- IdentityResolver builds `userIdsList` from `userAlias` (derived from WeChat data folder name) → calls `findByName` → spreads `allNames`
- That list is set as `userIdsList` and passed to BriefingGenerator.options.userIdentities
- It's also stashed as `this.identityResolver`
- In `enrichWithObsidianLinks` I currently do `userIds.add(userWxid)` from `(this.settings as any).userWxid` — but settings doesn't have userWxid! That's a bug — the filter never matched, so user names DID get wikilinked

## Where briefing files live on Mac
- `/Users/joyrush/Documents/WeChat-Briefings/<slug>.md`
- `/Users/joyrush/Documents/WeChat-People/<name>.md`

## How to verify Phase 1 worked
- After regen, `grep -c '\[\[WeChat-People/Dexter' <latest brief>` should be 0
- And `grep -c '\[\[WeChat-People/joyrush' <latest brief>` should be 0
- Other names should still appear

## Topic mentions in briefing (relevant for Phase 2)
- Section: `## 📰 今日要闻（按具体主题）`
- Each topic is `### <topic title>` (H3)
- Inside, `**涉及**:` line names the conversations
- `### XXX` headers can be extracted via simple regex over markdown

## Briefing file naming
- `WeChat-Briefings/2026-04-18-1341.md` format YYYY-MM-DD-HHMM
