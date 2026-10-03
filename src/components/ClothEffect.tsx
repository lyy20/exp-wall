import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

const COLS = 24;
const ROWS = 14;

interface Node {
  x: number;
  y: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
}

export default function ClothEffect() {
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

    const buildNodes = (): Node[] => {
      const spacingX = width / (COLS - 2);
      const spacingY = height / (ROWS - 2);
      const nodes: Node[] = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const x = (c - 1) * spacingX;
          const y = (r - 1) * spacingY;
          nodes.push({ x, y, ox: x, oy: y, vx: 0, vy: 0 });
        }
      }
      return nodes;
    };

    let nodes = buildNodes();
    const idx = (c: number, r: number) => r * COLS + c;

    const mouse = { x: -9999, y: -9999, down: false };
    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onDown = () => { mouse.down = true; };
    const onUp = () => { mouse.down = false; };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; mouse.down = false; };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mouseleave', onLeave);

    const onResize = () => {
      resize();
      nodes = buildNodes();
    };
    window.addEventListener('resize', onResize);

    const STIFFNESS = 0.05;
    const DAMPING = 0.86;
    const RADIUS = 190;

    const tick = (_time: number, delta: number) => {
      const dt = Math.min(delta / 16.667, 2);

      for (const n of nodes) {
        n.vx = (n.vx + (n.ox - n.x) * STIFFNESS) * DAMPING;
        n.vy = (n.vy + (n.oy - n.y) * STIFFNESS) * DAMPING;

        const dx = n.x - mouse.x;
        const dy = n.y - mouse.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < RADIUS && d > 0.0001) {
          const force = (1 - d / RADIUS) * (mouse.down ? 16 : 6);
          n.vx += (dx / d) * force;
          n.vy += (dy / d) * force;
        }

        n.x += n.vx * dt;
        n.y += n.vy * dt;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(130, 165, 225, 0.10)';
      ctx.beginPath();
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS - 1; c++) {
          const a = nodes[idx(c, r)];
          const b = nodes[idx(c + 1, r)];
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      for (let r = 0; r < ROWS - 1; r++) {
        for (let c = 0; c < COLS; c++) {
          const a = nodes[idx(c, r)];
          const b = nodes[idx(c, r + 1)];
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();

      ctx.fillStyle = 'rgba(130, 165, 225, 0.20)';
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    gsap.ticker.add(tick);

    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-20" />;
}
