import FadeIn from './FadeIn';
import ContactButton from './ContactButton';

// 科技背景的柔和遮罩：中心保留、四周融进 #0C0C0C，避免出现"贴图方块"的边缘。
const VEIL = 'radial-gradient(120% 92% at 50% 46%, #000 38%, transparent 88%)';

export default function HeroSection() {
  return (
    <section className="relative flex h-screen flex-col overflow-x-clip">
      {/* 科技背景（程序化生成的节点网络 + 轨道环 + 地平网格），替代原先的证件照 */}
      <FadeIn delay={0.6} y={30} className="pointer-events-none absolute inset-0 -z-10">
        <div className="relative h-full w-full overflow-hidden">
          <img
            src={import.meta.env.BASE_URL + 'tech/hero.jpg'}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover opacity-70"
            style={{ maskImage: VEIL, WebkitMaskImage: VEIL }}
          />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#0C0C0C]" />
          <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#0C0C0C] to-transparent md:w-56" />
          <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#0C0C0C] to-transparent md:w-56" />
        </div>
      </FadeIn>

      <FadeIn delay={0}>
        <nav className="flex items-center justify-between px-6 py-6 md:px-12 md:py-8">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#D7E2EA] md:text-sm">
            罗毅扬 · LUO YIYANG
          </span>
          <div className="flex items-center gap-6 md:gap-10">
            <a href="#about" className="text-xs uppercase tracking-wider text-[#D7E2EA] transition-opacity duration-200 hover:opacity-70 md:text-sm">About</a>
            <a href="#projects" className="text-xs uppercase tracking-wider text-[#D7E2EA] transition-opacity duration-200 hover:opacity-70 md:text-sm">Projects</a>
            <a href="#contact" className="text-xs uppercase tracking-wider text-[#D7E2EA] transition-opacity duration-200 hover:opacity-70 md:text-sm">Contact</a>
          </div>
        </nav>
      </FadeIn>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-6">
        <FadeIn delay={0.15} y={40} className="relative z-10">
          <h1 className="hero-heading whitespace-nowrap text-center font-black uppercase leading-none tracking-[-0.02em] text-[12.5vw] sm:text-[13.5vw] md:text-[14.5vw] lg:text-[16vw]">
            AI AGENT
          </h1>
        </FadeIn>
      </div>

      <div className="flex items-end justify-between gap-6 px-6 pb-8 md:px-12 md:pb-12">
        <FadeIn delay={0.35} y={20}>
          <p className="pr-4 text-[11px] font-light uppercase leading-relaxed tracking-[0.16em] text-[#D7E2EA] md:text-sm">
            AI Agent 开发工程师 · 华中科技大学 · 2027 届硕士
          </p>
        </FadeIn>
        <FadeIn delay={0.5} y={20}>
          <ContactButton />
        </FadeIn>
      </div>
    </section>
  );
}
