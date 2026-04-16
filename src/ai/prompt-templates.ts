export function buildBriefingPrompt(date: string, messagesText: string): string {
  return `你是一个微信消息助手。请根据以下 ${date} 的微信聊天记录，生成一份简洁的中文日报摘要。

要求：
1. 按对话分组，列出每个群或联系人的主要话题
2. 提炼重要信息、待办事项或需要回复的消息
3. 对于链接，说明其标题和简介
4. 语言简洁，使用中文
5. 如果某个对话没有重要内容，可以简短带过

聊天记录如下：

${messagesText}

请输出日报摘要：`;
}
