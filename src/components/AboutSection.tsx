import FadeIn from './FadeIn';
import AnimatedText from './AnimatedText';
import ContactButton from './ContactButton';

const FACTS = [
  '华中科技大学 · 计算机科学与技术 · 2027 届硕士',
  'SCI 一区在审论文 第一作者',
  '方向：深度强化学习 · 智能决策 · Agent 可靠性工程',
];

export default function AboutSection() {
  return (
    <section
      id="about"
      className="relative flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-24 text-center md:gap-10"
    >
      <FadeIn>
        <h2
          className="hero-heading font-black"
          style={{ fontSize: 'clamp(2.75rem, 9vw, 7rem)', lineHeight: 1 }}
        >
          About me
        </h2>
      </FadeIn>

      <AnimatedText
        text="我是罗毅扬，华中科技大学计算机科学与技术 2027 届硕士，研究方向是深度强化学习与智能决策。做工程时我在意三件事：工具契约要写清什么时候不该用，失败必须能归因到具体的错误码，结论必须能被原样复现。"
        className="max-w-[560px] text-base leading-relaxed text-[#D7E2EA] md:text-lg"
      />

      <FadeIn delay={0.15} className="flex max-w-[720px] flex-wrap items-center justify-center gap-x-5 gap-y-3">
        {FACTS.map((fact) => (
          <span
            key={fact}
            className="rounded-full border border-[#D7E2EA]/20 px-4 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[#D7E2EA]/75 md:text-xs"
          >
            {fact}
          </span>
        ))}
      </FadeIn>

      <FadeIn delay={0.2}>
        <ContactButton />
      </FadeIn>
    </section>
  );
}
