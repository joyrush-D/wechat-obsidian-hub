import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  lookupMessageSkill,
  isUserSkill,
  getUserIdentitiesSkill,
  defaultCritiqueSkills,
} from '../../../src/core/skills/builtin-skills';
import { EvidenceStore } from '../../../src/core/storage/evidence-store';
import type { WxObject, Actor } from '../../../src/core/types/domain';

const NOW = '2026-04-18T10:00:00Z';

function makeActor(wxid: string, displayName: string): Actor {
  return {
    id: `actor:wechat:${wxid}`,
    type: 'actor',
    createdAt: NOW,
    sourceAdapter: 'wechat',
    sourceId: wxid,
    displayName,
    aliases: [displayName, wxid],
    isGroup: false,
  };
}

function makeMessage(id: string, authorId: string, containerId: string, text: string): WxObject {
  return {
    id, type: 'object', kind: 'message',
    createdAt: NOW, sourceAdapter: 'wechat',
    text, occurredAt: NOW,
    authorId, containerId,
  };
}

describe('lookupMessageSkill', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'owh-bs-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns ok:false for unknown message id', async () => {
    const store = new EvidenceStore(dir);
    const skill = lookupMessageSkill({ store, userWxids: [] });
    const result = JSON.parse(await skill.execute({ messageId: 'msg:wechat:nope:1' }));
    expect(result.ok).toBe(false);
  });

  it('returns sender + container + text for known message', async () => {
    const store = new EvidenceStore(dir);
    store.put(makeActor('wxid_alice', 'Alice'));
    store.put(makeActor('group1@chatroom', 'Dev Team'));
    store.put(makeMessage(
      'msg:wechat:group1@chatroom:42',
      'actor:wechat:wxid_alice',
      'actor:wechat:group1@chatroom',
      'Hello team',
    ));

    const skill = lookupMessageSkill({ store, userWxids: ['wxid_dexter'] });
    const result = JSON.parse(await skill.execute({ messageId: 'msg:wechat:group1@chatroom:42' }));
    expect(result.ok).toBe(true);
    expect(result.senderName).toBe('Alice');
    expect(result.senderWxid).toBe('wxid_alice');
    expect(result.isSenderUser).toBe(false);
    expect(result.containerName).toBe('Dev Team');
    expect(result.text).toBe('Hello team');
  });

  it('marks isSenderUser=true when sender wxid is in userWxids', async () => {
    const store = new EvidenceStore(dir);
    store.put(makeActor('wxid_dexter', 'Dexter'));
    store.put(makeMessage('msg:wechat:g:1', 'actor:wechat:wxid_dexter', 'actor:wechat:g', 'I said this'));

    const skill = lookupMessageSkill({ store, userWxids: ['wxid_dexter', 'joyrush'] });
    const result = JSON.parse(await skill.execute({ messageId: 'msg:wechat:g:1' }));
    expect(result.isSenderUser).toBe(true);
  });

  it('truncates very long text to 500 chars', async () => {
    const store = new EvidenceStore(dir);
    store.put(makeMessage('msg:wechat:g:1', 'actor:wechat:wxid_a', 'actor:wechat:g', 'x'.repeat(2000)));
    const skill = lookupMessageSkill({ store, userWxids: [] });
    const result = JSON.parse(await skill.execute({ messageId: 'msg:wechat:g:1' }));
    expect(result.text.length).toBeLessThanOrEqual(500);
  });
});

describe('isUserSkill', () => {
  it('returns true when wxid is in user list', async () => {
    const skill = isUserSkill({ store: new EvidenceStore(mkdtempSync(join(tmpdir(), 'x'))), userWxids: ['wxid_dexter'] });
    const result = JSON.parse(await skill.execute({ wxid: 'wxid_dexter' }));
    expect(result.isUser).toBe(true);
  });

  it('returns false when wxid is not in user list', async () => {
    const skill = isUserSkill({ store: new EvidenceStore(mkdtempSync(join(tmpdir(), 'x'))), userWxids: ['wxid_dexter'] });
    const result = JSON.parse(await skill.execute({ wxid: 'wxid_other' }));
    expect(result.isUser).toBe(false);
  });
});

describe('getUserIdentitiesSkill', () => {
  it('returns all wxids', async () => {
    const skill = getUserIdentitiesSkill({ store: new EvidenceStore(mkdtempSync(join(tmpdir(), 'x'))), userWxids: ['a', 'b', 'c'] });
    const result = JSON.parse(await skill.execute({}));
    expect(result.wxids).toEqual(['a', 'b', 'c']);
  });
});

describe('defaultCritiqueSkills', () => {
  it('returns the 3 standard skills', () => {
    const skills = defaultCritiqueSkills({ store: new EvidenceStore(mkdtempSync(join(tmpdir(), 'x'))), userWxids: [] });
    expect(skills).toHaveLength(3);
    expect(skills.map(s => s.name).sort()).toEqual(['get_user_identities', 'is_user', 'lookup_message']);
  });
});
