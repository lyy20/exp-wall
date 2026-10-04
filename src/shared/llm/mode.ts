/** 页面当前处于哪种 LLM 模式。三种模式必须永远显式写在徽标上，不能拿代理冒充用户自己的 key。 */

export type LlmMode = 'byok' | 'proxy' | 'replay';

export const MODE_TITLE: Record<LlmMode, string> = {
  byok: '已配置你的 API key：本次回答是浏览器直连服务商、用你自己的 key 真实生成的。',
  proxy: '站内代理：没有填 key 时走本站自己的 Cloudflare Worker 转发（密钥只在服务端），所以能真答；额度用完会明确提示，填自己的 key 可以直接绕开。',
  replay: '回放模式：下面展示的是录制自项目真实日志的模型输出，按真实节奏重放；不需要任何 key。填入你自己的 key（或走站内代理）即可实时提问。',
};
