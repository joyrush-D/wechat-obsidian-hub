# Progress Log

## Session start: 2026-04-18 (continued from c6a4802)

### Recent commits already on origin/main
- `c6a4802` v0.11.0: Obsidian native integration — wikilinks + auto person profile pages (89 wikilinks, 52 profiles)
- `c2a932f` v0.10.0 step 3: CriticAgent wired into briefing flow
- `9b75f70` v0.10.0 step 2: Skills + AgentRunner via vercel/ai SDK
- `2d98b02` v0.10.0 step 1: CriticAgent baseline

### Working tree
clean

### Test count baseline
558 passing (verified after c6a4802)

---

## Phase 1: Skip user wikilinks
status: complete
started: 2026-04-18
completed: 2026-04-18

### Bug fix
Was passing nonexistent `(this.settings as any).userWxid` (always undefined) so user filter never engaged. Now `enrichWithObsidianLinks` accepts `userIdentities: string[]` parameter from generate-briefing's existing `userIdsList` scope.

### Belt + suspenders
1. Skip messages where `senderWxid === userOwnWxid` (resolved via IdentityResolver)
2. Skip messages where senderWxid is in user token set (case-insensitive)
3. Skip identities where `id.wxid === userOwnWxid`
4. Filter user aliases out of each remaining identity's `aliases[]` array

### Mac E2E evidence
```
Dexter: 0
joyrush: 0
罗俊: 0
罗俊-产品经理: 0
猫大师: 0
腾讯 罗俊: 0
total wikilinks: 100   (was 89; counts went up because other names matched more)
total profile pages: 52
```

All 6 user identities → 0 wikilinks. Other names still wikilinked. ✅

### Tests
- 558 passing (no new tests needed — bug was integration not module)
- npm run verify: green
- Build: 775KB

## Phase 3: Insert into Daily Note command
status: in_progress
started: now
