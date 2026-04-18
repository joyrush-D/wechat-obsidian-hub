/**
 * Built-in skills — fact-check primitives the CriticAgent uses to verify
 * attribution claims in a generated briefing.
 *
 * Each skill is intentionally narrow and side-effect-free. The agent
 * loop calls them iteratively to drill into specific findings rather
 * than getting all context up front.
 */

import { z } from 'zod';
import { defineSkill } from './skill';
import type { EvidenceStore } from '../storage/evidence-store';
import type { WxObject, Actor } from '../types/domain';

export interface BuiltinSkillContext {
  store: EvidenceStore;
  /** All wxids (and aliases) the user is known by. */
  userWxids: string[];
}

/**
 * Look up a single message by its entity id and return who sent it,
 * what they said, and which conversation it lived in.
 */
export const lookupMessageSkill = (ctx: BuiltinSkillContext) => defineSkill({
  name: 'lookup_message',
  description:
    '通过 messageId（形如 msg:wechat:<convoId>:<localId>）查询一条消息的' +
    '发送者真名、wxid、所在对话名、原文。用于核查 finding 引用的证据是否真的存在' +
    '以及发送人是不是领导本人。',
  parameters: z.object({
    messageId: z.string().describe('完整的消息 ID，如 msg:wechat:12345@chatroom:42'),
  }),
  execute: async ({ messageId }: { messageId: string }) => {
    const obj = ctx.store.get(messageId) as WxObject | null;
    if (!obj || obj.type !== 'object') {
      return JSON.stringify({ ok: false, error: `messageId ${messageId} 不在证据库中` });
    }

    const author = obj.authorId ? (ctx.store.get(obj.authorId) as Actor | null) : null;
    const container = obj.containerId ? (ctx.store.get(obj.containerId) as Actor | null) : null;
    const isUser = author?.sourceId ? ctx.userWxids.includes(author.sourceId) : false;

    return JSON.stringify({
      ok: true,
      messageId,
      senderName: author?.displayName ?? '(未知)',
      senderWxid: author?.sourceId ?? '(未知)',
      isSenderUser: isUser,
      containerName: container?.displayName ?? '(未知)',
      occurredAt: obj.occurredAt,
      text: obj.text.slice(0, 500),
    });
  },
});

/**
 * Quick boolean: is this wxid one of the user's identities?
 */
export const isUserSkill = (ctx: BuiltinSkillContext) => defineSkill({
  name: 'is_user',
  description: '检查给定 wxid 是不是领导本人（领导有多个 wxid / 别名）',
  parameters: z.object({
    wxid: z.string(),
  }),
  execute: async ({ wxid }: { wxid: string }) => {
    return JSON.stringify({ wxid, isUser: ctx.userWxids.includes(wxid) });
  },
});

/**
 * Return the user's known identities (wxids + aliases).
 */
export const getUserIdentitiesSkill = (ctx: BuiltinSkillContext) => defineSkill({
  name: 'get_user_identities',
  description: '获取领导的全部已知 wxid 和别名',
  parameters: z.object({}),
  execute: async () => {
    return JSON.stringify({ wxids: ctx.userWxids });
  },
});

/** Bundle the standard fact-check skill set. */
export function defaultCritiqueSkills(ctx: BuiltinSkillContext) {
  return [
    lookupMessageSkill(ctx),
    isUserSkill(ctx),
    getUserIdentitiesSkill(ctx),
  ];
}
