import { useEffect, useRef } from 'react';

// 科技题材配图：由 code/make_tech_art.py 程序化生成（深色底 + 蓝青主色 + 少量紫色点缀，
// 全部本地渲染，无外部图床依赖）。想换成自己的成果图时，只替换这个数组即可。
// 路径统一加 import.meta.env.BASE_URL 前缀：部署到 GitHub Pages 子路径（/exp-wall/）时不会 404。
const TILE_NAMES: string[] = [
  't01-network.jpg',
  't02-constellation.jpg',
  't03-radar.jpg',
  't04-flow.jpg',
  't05-surface.jpg',
  't06-circuit.jpg',
  't07-wave.jpg',
  't08-hex.jpg',
];

const TILES: string[] = TILE_NAMES.map((n) => import.meta.env.BASE_URL + 'tech/' + n);

const IMAGES: string[] = Array.from({ length: 21 }, (_, i) => TILES[i % TILES.length]);

export default function MarqueeSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const row1Ref = useRef<HTMLDivElement>(null);
  const row2Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      const section = sectionRef.current;
      if (!section) return;
      const sectionTop = section.getBoundingClientRect().top + window.scrollY;
      const offset = (window.scrollY - sectionTop + window.innerHeight) * 0.3;
      if (row1Ref.current) {
        row1Ref.current.style.transform = 'translateX(' + (offset - 200) + 'px)';
      }
      if (row2Ref.current) {
        row2Ref.current.style.transform = 'translateX(' + -(offset - 200) + 'px)';
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const row1 = IMAGES.slice(0, 11);
  const row2 = IMAGES.slice(11, 21);

  return (
    <section ref={sectionRef} className="relative overflow-x-clip bg-[#0C0C0C] py-16 md:py-24">
      <div className="flex flex-col gap-3">
        <div ref={row1Ref} className="flex gap-3 will-change-transform">
          {[...row1, ...row1, ...row1].map((src, i) => (
            <img
              key={'r1-' + i}
              src={src}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-[270px] w-[420px] shrink-0 rounded-2xl border border-[#D7E2EA]/10 object-cover opacity-90 transition duration-500 hover:border-[#D7E2EA]/25 hover:opacity-100"
            />
          ))}
        </div>
        <div ref={row2Ref} className="flex gap-3 will-change-transform">
          {[...row2, ...row2, ...row2].map((src, i) => (
            <img
              key={'r2-' + i}
              src={src}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-[270px] w-[420px] shrink-0 rounded-2xl border border-[#D7E2EA]/10 object-cover opacity-90 transition duration-500 hover:border-[#D7E2EA]/25 hover:opacity-100"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
