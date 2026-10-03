import { useRef } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import FadeIn from './FadeIn';
import { page } from '../shared/asset';

// 卡片 01-03 都做了可交互的独立页（同一仓库、同一域名）；04 只有公开仓库。
const DEMO: Record<string, { href: string; label: string; external?: boolean }> = {
  '01': { href: page('eap'), label: '进入交互 Demo' },
  '02': { href: page('yyhelp'), label: '进入交互 Demo' },
  '03': { href: page('rag'), label: '进入交互 Demo' },
  '04': { href: 'https://github.com/lyy20/RLforUSV_CTRIP', label: '查看公开仓库', external: true },
};

interface StackGroup {
  label: string;
  items: string[];
}

interface Point {
  tag: string;
  text: string;
}

interface Metric {
  value: string;
  label: string;
}

interface Project {
  id: string;
  name: string;
  tagline: string;
  role: string;
  stack: StackGroup[];
  points: Point[];
  metrics: Metric[];
}

const PROJECTS: Project[] = [
  {
    id: '01',
    name: '科研实验分析助手 Agent',
    tagline:
      '把实验数据目录变成可溯源、可拒答、可审计的对比结论——平台不许 LLM 参与数值计算，也不许它判定自己输出的正确性。',
    role: '独立设计与交付 · 2026.08 — 至今',
    stack: [
      { label: 'Agent 与契约', items: ['Python 3.12', 'YAML 声明式契约', 'typing.Protocol', 'argparse 多入口'] },
      { label: '数据与统计', items: ['pandas', 'numpy', 'scipy', 'SQLite'] },
      { label: '验证与呈现', items: ['pytest 547 项', '变异测试', 'Streamlit', 'Altair'] },
    ],
    points: [
      {
        tag: '工具契约',
        text: '为 8 个外部能力定义四段式契约（做什么 / 何时用 / 何时不用 / 失败时怎么办），只读与幂等显式声明，参数 enum 收敛减少模型猜测空间，返回值附来源句柄（run_id / 指标名 / n）。',
      },
      {
        tag: '失败语义',
        text: '9 类错误码严格区分「没有数据」与「数据没取到」——把系统故障表述成「实验没有结果」，是这一场景里最严重的事故。',
      },
      {
        tag: '容错与降级',
        text: '重试矩阵（仅作用于幂等只读调用）、熔断（60 s 内失败 ≥5 次 → OPEN 30 s）、deadline 预算向下传播、L0–L5 降级阶梯逐级留痕，全部用假时钟做确定性测试。',
      },
      {
        tag: '评测门禁',
        text: '547 项测试 + 25 个入口全链路验收：每个入口声明期望退出码与输出证据，按设计拒答计通过、崩溃计失败，期望码被冻结后与实现不一致即中止。',
      },
    ],
    metrics: [
      { value: '547 项', label: '测试全绿' },
      { value: '25 / 25', label: '入口验收通过' },
      { value: '0.222 MB', label: '146.5 GB 数据根实际读取' },
      { value: '9 类', label: '错误码区分失败语义' },
    ],
  },
  {
    id: '02',
    name: 'YYHelp 电商智能客服平台',
    tagline: '多轮对话 Agent：前作解决的是检索准不准，本项目解决的是多轮对话能不能可靠地把事办完。',
    role: '独立开发 · 2026.09 — 至今',
    stack: [
      { label: '编排与状态', items: ['LangGraph', 'TypedDict state', 'checkpointer'] },
      { label: '检索与语料', items: ['Milvus', 'pymilvus', 'jieba', 'bge-m3', 'RRF + 精排'] },
      { label: '服务与闭环', items: ['FastAPI + SSE', 'Langfuse v4', 'MySQL', 'pytest'] },
    ],
    points: [
      {
        tag: '状态图编排',
        text: 'LangGraph 装配主图：9 类意图分流到 5 个出口，各子流程汇合到主力 Agent 的 ReAct 循环；会话状态持久化——缺关键信息不猜、停下来问，进程重启后接着跑。',
      },
      {
        tag: '写操作安全',
        text: '@tool + pydantic 入参校验；查订单、建工单等写操作设计幂等键与人工确认，工具抛异常不炸图。',
      },
      {
        tag: '检索修复',
        text: 'Milvus 单库双路同时承载 dense 向量与 BM25 稀疏检索，RRF 融合后精排；定位并修复默认 analyzer 导致中文 BM25 静默返回空，切 jieba 后恢复命中。',
      },
      {
        tag: '闭环与门禁',
        text: '自研 JSONL trace 为默认路径（写入失败写 observability_degraded 事件而非抛异常），Langfuse v4 为增强路径；数据飞轮三入口配检索快照做离线重放；评测门禁带 Holm 校正与三态退出码。',
      },
    ],
    metrics: [
      { value: '163', label: '结构感知切片（零表格拆分）' },
      { value: '0.7708', label: 'recall@5 macro · 40 题评测集' },
      { value: '9 → 5', label: '意图分流入 5 个出口' },
      { value: '0 / 1 / 2', label: '门禁三态退出码' },
    ],
  },
  {
    id: '03',
    name: '科研文献 RAG 问答平台',
    tagline: '把 PDF 文献库变成答案带可核对引用的问答链路，重点在评测与消融，而不是再接一个模型。',
    role: '独立开发 · 2026.08 — 至今',
    stack: [
      { label: '检索链路', items: ['PyMuPDF', 'bge-m3', 'FAISS', 'rank-bm25', 'RRF', 'bge-reranker-v2-m3'] },
      { label: '服务化', items: ['FastAPI + SSE', '鉴权 / 限流 / 配额', '成本熔断', 'Docker'] },
      { label: '工程', items: ['GitHub Actions CI', '索引版本化 + 回滚', 'Streamlit 四页'] },
    ],
    points: [
      {
        tag: '拒答与引用',
        text: '双层拒答 + 生成后引用编号校验，阈值由实测分数分布标定；知识库天然自带不可回答问题集，用来验证拒答机制，而不是等它出错。',
      },
      {
        tag: '成本与配额',
        text: '每 key 配额与成本熔断：超预算返回 402 且 ready=false，检索仍然可用——降级而不是整体不可用。',
      },
      {
        tag: '性能定位',
        text: '分阶段时延基准把用户等待归因到 CPU 精排而非模型生成，并以 readiness 门禁优化冷启动。',
      },
      {
        tag: '评测',
        text: '130 题分层评测集（chunk 级 ground truth）+ 三组消融，把「检索准不准」变成可比较的数字。',
      },
    ],
    metrics: [
      { value: '130 题', label: '分层评测集' },
      { value: '3 组', label: '检索消融对照' },
      { value: '402', label: '超预算降级响应' },
    ],
  },
  {
    id: '04',
    name: 'CTRIP · 无人水面艇目标跟踪',
    tagline: '把「部分可观测下的状态估计」与「执行不完美下的可靠性设计」做成一篇第一作者论文。',
    role: '第一作者 · 2024.12 — 至今 · 投稿 Science China Information Sciences（中科院一区，审稿中）',
    stack: [
      { label: '算法', items: ['PyTorch', 'DI-engine', 'SAC', 'PER', 'ICM'] },
      { label: '估计与仿真', items: ['EKF', 'Particle Environment', 'Domain Randomization'] },
      { label: '评测', items: ['12 指标', '200 episodes', '3 算法 × 3 预测方案'] },
    ],
    points: [
      {
        tag: '探索-利用平衡',
        text: '提出 CTRIP-SAC：以 ICM 内在好奇心 × TD-error 联合生成经验样本优先级，训练早期偏探索、后期偏利用，缓解稀疏奖励下的失衡。',
      },
      {
        tag: '状态估计',
        text: '针对纯测距 + 感知噪声 + 观测丢包，LS / EKF / 无预测三方案对比后引入 EKF 融合历史与实时观测；观测空间固定容量，显式建模信息取舍。',
      },
      {
        tag: '执行不完美',
        text: '把执行不完美显式建模：转向角限幅 [−1, 1] rad、延迟转向（每步仅 30% 转向角生效）、稠密 + 稀疏混合奖励，并实现输入异常处理与推理延迟 telemetry。',
      },
      {
        tag: '评测纪律',
        text: '训练 / 测试双阶段 12 指标（200 episodes）与 3 算法 × 3 预测方案对照，明确区分「安全底线指标」与「任务完成指标」。',
      },
    ],
    metrics: [
      { value: '+35.3%', label: '最终奖励 vs SAC' },
      { value: '+64.9%', label: '最终奖励 vs PER-SAC' },
      { value: '92.98%', label: '测试生存率' },
      { value: '22.83 m', label: '平均跟踪距离（安全区间 15–30 m）' },
    ],
  },
];

function ProjectCard({
  project,
  index,
  total,
  progress,
}: {
  project: Project;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const targetScale = 1 - (total - 1 - index) * 0.03;
  const scale = useTransform(progress, [index / total, 1], [1, targetScale]);
  const stackLine = project.stack.map((group) => group.items.join(' · ')).join(' · ');
  const demo = DEMO[project.id];

  return (
    <div className="sticky top-24 flex h-[85vh] items-center justify-center md:top-32">
      <motion.div
        style={{ scale, top: index * 28 }}
        className="relative w-full max-w-5xl origin-top rounded-[2.5rem] border-2 border-[#D7E2EA] bg-[#0C0C0C] p-5 shadow-2xl md:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <span className="hero-heading text-4xl font-black leading-none md:text-6xl">
            {project.id}
          </span>
          <div className="text-right">
            <h3 className="text-lg font-bold uppercase leading-tight text-[#D7E2EA] md:text-3xl">
              {project.name}
            </h3>
            <p className="mt-1.5 text-[9px] uppercase tracking-[0.16em] text-[#D7E2EA]/50 md:text-[11px]">
              {project.role}
            </p>
            {demo && (
              <a
                href={demo.href}
                target={demo.external ? '_blank' : undefined}
                rel={demo.external ? 'noreferrer' : undefined}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[#D7E2EA]/40 px-3 py-1 text-[9px] uppercase tracking-[0.16em] text-[#D7E2EA] transition duration-200 hover:border-[#D7E2EA] hover:bg-[#D7E2EA]/10 md:text-[10px]"
              >
                {demo.label} <span aria-hidden="true">→</span>
              </a>
            )}
          </div>
        </div>

        <p className="mt-3 border-l-2 border-[#D7E2EA]/30 pl-3 text-[11px] leading-relaxed text-[#D7E2EA]/80 md:pl-4 md:text-sm">
          {project.tagline}
        </p>

        <p className="mt-3 text-[10px] leading-relaxed text-[#D7E2EA]/55 md:hidden">{stackLine}</p>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-5 md:gap-4">
          <div className="col-span-2 hidden flex-col gap-2 md:flex">
            {project.stack.map((group) => (
              <div
                key={group.label}
                className="rounded-2xl border border-[#D7E2EA]/15 bg-[#D7E2EA]/[0.04] p-3"
              >
                <p className="text-[9px] uppercase tracking-[0.2em] text-[#D7E2EA]/45 md:text-[10px]">
                  {group.label}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {group.items.map((item) => (
                    <span
                      key={item}
                      className="rounded-full bg-[#D7E2EA]/10 px-2 py-0.5 text-[10px] text-[#D7E2EA] md:text-[11px]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="col-span-3 flex flex-col gap-2">
            {project.points.map((point, i) => (
              <div
                key={point.tag}
                className={
                  'rounded-2xl border border-[#D7E2EA]/15 bg-[#D7E2EA]/[0.03] px-3 py-2' +
                  (i > 1 ? ' hidden md:block' : '')
                }
              >
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#D7E2EA]/50 md:text-[10px]">
                  {point.tag}
                </span>
                <p className="mt-1 text-[11px] leading-[1.55] text-[#D7E2EA] md:text-[12.5px]">
                  {point.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t border-[#D7E2EA]/15 pt-3 md:mt-3 md:pt-3">
          {project.metrics.map((metric) => (
            <div key={metric.label}>
              <p className="hero-heading text-xl font-black leading-none md:text-2xl">
                {metric.value}
              </p>
              <p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-[#D7E2EA]/45 md:text-[10px]">
                {metric.label}
              </p>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export default function ProjectsSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  return (
    <section id="projects" className="relative z-10 -mt-16 rounded-t-[3rem] bg-[#0C0C0C] md:-mt-24">
      <div className="px-6 pb-10 pt-16 text-center md:pb-14 md:pt-20">
        <FadeIn>
          <h2
            className="hero-heading font-black"
            style={{ fontSize: 'clamp(2.75rem, 9vw, 7rem)', lineHeight: 1 }}
          >
            Project
          </h2>
        </FadeIn>
        <FadeIn delay={0.1}>
          <p className="mx-auto mt-5 max-w-[560px] text-xs leading-relaxed text-[#D7E2EA]/70 md:text-sm">
            三段独立交付的工程项目，加一段第一作者科研经历。下面每张卡片都能对上简历里的每一句。
          </p>
        </FadeIn>
      </div>

      <div ref={containerRef} className="px-4 md:px-8">
        {PROJECTS.map((project, i) => (
          <ProjectCard
            key={project.id}
            project={project}
            index={i}
            total={PROJECTS.length}
            progress={scrollYProgress}
          />
        ))}
      </div>
    </section>
  );
}
