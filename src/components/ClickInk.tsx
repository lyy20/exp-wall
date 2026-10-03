import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  phase: number;
}

const NEON = ['#ff00e5', '#00e5ff', '#8a2bff', '#00ff9d', '#ff4d00', '#ffe600', '#ff007f', '#3d6bff'];

function rgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

export default function ClickInk() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
    };
    resize();

    const particles: Particle[] = [];
    let dragging = false;

    const randomColor = () => NEON[Math.floor(Math.random() * NEON.length)];

    const burst = (
      x: number,
      y: number,
      opts: { count: number; speed: number; sizeMin: number; sizeMax: number; lifeMin: number; lifeMax: number }
    ) => {
      const color = randomColor();
      for (let i = 0; i < opts.count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const v = Math.random() * opts.speed;
        const life = opts.lifeMin + Math.random() * (opts.lifeMax - opts.lifeMin);
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * v,
          vy: Math.sin(angle) * v,
          life,
          maxLife: life,
          size: opts.sizeMin + Math.random() * (opts.sizeMax - opts.sizeMin),
          color,
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    const onDown = (e: PointerEvent) => {
      dragging = true;
      burst(e.clientX, e.clientY, { count: 46, speed: 18, sizeMin: 14, sizeMax: 55, lifeMin: 1.9, lifeMax: 2.6 });
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        burst(e.clientX, e.clientY, { count: 3, speed: 5, sizeMin: 8, sizeMax: 22, lifeMin: 1.2, lifeMax: 2.0 });
      }
    };
    const onUp = () => { dragging = false; };

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', resize);

    const tick = (_time: number, delta: number) => {
      const dt = Math.min(delta / 16.667, 2);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt / 60;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.vx *= 0.92;
        p.vy *= 0.92;
        p.x += p.vx * dt + Math.sin(p.phase + p.life * 3) * 0.6;
        p.y += p.vy * dt + Math.cos(p.phase + p.life * 2.5) * 0.6;

        const t = p.life / p.maxLife;
        const alpha = Math.min(t * 2.5, 1) * t;
        const radius = p.size * (0.6 + t * 0.4);

        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        g.addColorStop(0, rgba(p.color, alpha * 0.85));
        g.addColorStop(1, rgba(p.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
    };

    gsap.ticker.add(tick);

    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-30" />;
}
