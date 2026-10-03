import HeroSection from './components/HeroSection';
import MarqueeSection from './components/MarqueeSection';
import AboutSection from './components/AboutSection';
import ProjectsSection from './components/ProjectsSection';
import ContactButton from './components/ContactButton';
import FadeIn from './components/FadeIn';
import StarField from './components/StarField';
import ClothEffect from './components/ClothEffect';
import ClickInk from './components/ClickInk';

export default function App() {
  return (
    <div className="relative min-h-screen bg-[#0C0C0C]">
      <StarField />
      <main className="relative z-10">
        <HeroSection />
        <MarqueeSection />
        <AboutSection />
        <ProjectsSection />
        <footer id="contact" className="bg-[#0C0C0C] px-6 py-20 text-center md:py-28">
          <FadeIn>
            <p className="text-[10px] uppercase tracking-[0.35em] text-[#D7E2EA]/60 md:text-xs">
              Get in touch
            </p>
            <div className="mt-7 flex flex-col items-center gap-3 md:mt-9">
              <a
                href="mailto:yiyangluo@hust.edu.cn"
                className="text-xl font-light text-[#D7E2EA] transition-opacity duration-200 hover:opacity-70 md:text-3xl"
              >
                yiyangluo@hust.edu.cn
              </a>
              <a
                href="tel:13970849593"
                className="text-xl font-light text-[#D7E2EA] transition-opacity duration-200 hover:opacity-70 md:text-3xl"
              >
                139 7084 9593
              </a>
            </div>
            <p className="mt-7 text-[10px] uppercase leading-relaxed tracking-[0.18em] text-[#D7E2EA]/55 md:text-xs">
              求职意向：AI Agent 开发工程师 · 华中科技大学 · 2027 届硕士
            </p>
            <div className="mt-8 flex justify-center">
              <ContactButton href="mailto:yiyangluo@hust.edu.cn" />
            </div>
            <p className="mt-16 text-[10px] tracking-[0.18em] text-[#D7E2EA]/35">
              © 2026 罗毅扬 · React + TypeScript + TailwindCSS + Framer-Motion + Three.js
            </p>
          </FadeIn>
        </footer>
      </main>
      <ClothEffect />
      <ClickInk />
    </div>
  );
}
