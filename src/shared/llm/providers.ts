/**
 * 浏览器可直连的 LLM provider 表。
 * 只收录**已用 curl 预检实测 CORS 通过**的服务商（Origin: https://lyy20.github.io）：
 *   DeepSeek 200+回显 / Moonshot 204+回显 / DashScope * / 智谱 回显 / SiliconFlow * / 火山方舟 回显 / MiniMax 200
 * OpenAI 与 Anthropic 未收录：前者本机网络不可达，后者需要额外 header 且本机受限。
 */

export type Capability = 'chat' | 'embed' | 'rerank';

export interface Provider {
  id: string;
  label: string;
  /** OpenAI 兼容根地址（不含 /chat/completions） */
  base: string;
  chatModel: string;
  chatModels: string[];
  caps: Capability[];
  embedModel?: string;
  rerankModel?: string;
  note?: string;
  /** 已实测浏览器直连可用 */
  corsVerified: boolean;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    base: 'https://api.deepseek.com',
    chatModel: 'deepseek-chat',
    chatModels: ['deepseek-chat', 'deepseek-reasoner'],
    caps: ['chat'],
    corsVerified: true,
    note: '无 embedding 接口，向量需另选一家（换成 SiliconFlow / 百炼即可）',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    base: 'https://api.siliconflow.cn/v1',
    chatModel: 'Qwen/Qwen2.5-7B-Instruct',
    chatModels: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-14B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    caps: ['chat', 'embed', 'rerank'],
    embedModel: 'BAAI/bge-m3',
    rerankModel: 'BAAI/bge-reranker-v2-m3',
    corsVerified: true,
    note: '一家就能给齐 chat + bge-m3 向量 + bge-reranker（与原项目同款模型）',
  },
  {
    id: 'dashscope',
    label: '阿里云百炼',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    chatModel: 'qwen-plus',
    chatModels: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    caps: ['chat', 'embed'],
    embedModel: 'text-embedding-v3',
    corsVerified: true,
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    chatModel: 'glm-4-flash',
    chatModels: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
    caps: ['chat', 'embed'],
    embedModel: 'embedding-3',
    corsVerified: true,
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    base: 'https://api.moonshot.cn/v1',
    chatModel: 'moonshot-v1-8k',
    chatModels: ['moonshot-v1-8k', 'moonshot-v1-32k'],
    caps: ['chat'],
    corsVerified: true,
  },
  {
    id: 'ark',
    label: '火山方舟',
    base: 'https://ark.cn-beijing.volces.com/api/v3',
    chatModel: 'doubao-1-5-lite-32k-250115',
    chatModels: ['doubao-1-5-lite-32k-250115', 'doubao-1-5-pro-32k-250115'],
    caps: ['chat'],
    corsVerified: true,
    note: '模型名填你在方舟控制台创建的推理接入点 ID（ep- 开头）最稳',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    base: 'https://api.minimax.chat/v1',
    chatModel: 'abab6.5s-chat',
    chatModels: ['abab6.5s-chat', 'abab6.5-chat'],
    caps: ['chat'],
    corsVerified: true,
  },
];

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providersWith(cap: Capability): Provider[] {
  return PROVIDERS.filter((p) => p.caps.includes(cap));
}

export const DEFAULT_PROVIDER_ID = 'deepseek';
export const DEFAULT_EMBED_PROVIDER_ID = 'siliconflow';
