# -*- coding: utf-8 -*-
"""AI / Agent 题材的首页配图生成器（纯程序化生成，无外部素材、无生图 API 依赖）。

设计口径：
  - 深色底（#0B0D12），青色为主光、少量品红做点级点缀；禁用 rainbow/jet。
  - 2x 超采样绘制 → Lanczos 降采样；辉光 = 同层掩膜 Gaussian bloom + 清晰笔画叠加。
  - 主题全部围绕「Agent / 大模型」：智能体星座、神经格栅、多智能体蜂群、token 流、
    推理树、嵌入空间点云、电路微距、注意力波形、同心环。
  - 画面上都保留一块低亮度区域，避免与页面大标题抢对比度。
"""
import sys, os, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

sys.stdout.reconfigure(encoding="utf-8")

OUT = "D:/DSH_Plot/hero-program/public/tech"
os.makedirs(OUT, exist_ok=True)

BG = (11, 13, 18)
CYAN = (104, 214, 255)
TEAL = (64, 226, 205)
BLUE = (74, 138, 236)
DEEP = (38, 84, 176)
VIOLET = (150, 112, 244)
PALE = (214, 230, 242)
MAGENTA = (198, 58, 190)

c8 = lambda c: np.array(c, np.float32) / 255.0


class Canvas:
    def __init__(self, w, h, ss=2.0, bg=BG):
        self.ss, self.w, self.h = ss, w, h
        self.W, self.H = int(round(w * ss)), int(round(h * ss))
        self.light = np.zeros((self.H, self.W, 3), np.float32)
        self.layers = []

    def layer(self, color, bloom=0.6, radius=6.0, crisp=0.9):
        mask = Image.new("L", (self.W, self.H), 0)
        self.layers.append([mask, color, bloom, radius, crisp])
        return mask, ImageDraw.Draw(mask)

    def point(self, x, y, r, color, strength, power=2.2):
        x, y, r = x * self.ss, y * self.ss, r * self.ss
        x0, x1 = max(0, int(x - r)), min(self.W, int(x + r) + 1)
        y0, y1 = max(0, int(y - r)), min(self.H, int(y + r) + 1)
        if x1 <= x0 or y1 <= y0:
            return
        yy, xx = np.mgrid[y0:y1, x0:x1]
        d = np.sqrt((xx - x) ** 2 + (yy - y) ** 2) / max(r, 1e-6)
        f = np.clip(1.0 - d, 0, 1) ** power
        self.light[y0:y1, x0:x1] += f[..., None] * c8(color) * strength

    def linear(self, p0, p1, c0, c1, strength=0.2, power=1.6):
        x0, y0 = p0[0] * self.ss, p0[1] * self.ss
        x1, y1 = p1[0] * self.ss, p1[1] * self.ss
        vx, vy = x1 - x0, y1 - y0
        n = max(vx * vx + vy * vy, 1e-6)
        yy, xx = np.mgrid[0:self.H, 0:self.W]
        t = np.clip(((xx - x0) * vx + (yy - y0) * vy) / n, 0, 1) ** power
        self.light += ((1 - t)[..., None] * c8(c0) + t[..., None] * c8(c1)) * strength

    def render(self, path, vignette=0.55, grain=0.012, exposure=1.4, quality=84):
        for mask, color, bloom, radius, crisp in self.layers:
            if bloom > 0:
                m = np.asarray(mask.filter(ImageFilter.GaussianBlur(radius * self.ss)), np.float32) / 255.0
                self.light += (m * bloom)[..., None] * c8(color)
        img = 1.0 - np.exp(-self.light * exposure)
        if vignette > 0:
            yy, xx = np.mgrid[0:self.H, 0:self.W]
            nx = (xx / self.W - 0.5) * 2.0
            ny = (yy / self.H - 0.5) * 2.0
            r = np.sqrt(nx ** 2 + ny ** 2) / 1.4142
            img *= (1.0 - vignette * np.clip(r, 0, 1) ** 2.0)[..., None]
        if grain > 0:
            rng = np.random.default_rng(7)
            img += (rng.random((self.H, self.W, 1), np.float32) - 0.5) * grain
        img = np.clip(img, 0, 1)
        base = Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGB")
        for mask, color, bloom, radius, crisp in self.layers:
            if crisp <= 0:
                continue
            tint = Image.new("RGB", (self.W, self.H), tuple(int(c * crisp) for c in color))
            outc = ImageChops.screen(base, tint)
            base = Image.composite(Image.blend(base, outc, 1.0), base, mask)
        base = base.resize((self.w, self.h), Image.LANCZOS)
        base.save(path, quality=quality, subsampling=0)
        return path


def poisson(rng, w, h, rmin, n, margin=0.0):
    pts = []
    tries = 0
    while len(pts) < n and tries < n * 800:
        tries += 1
        x, y = rng.uniform(margin, w - margin), rng.uniform(margin, h - margin)
        if all((px - x) ** 2 + (py - y) ** 2 >= rmin ** 2 for (px, py) in pts[-260:]):
            pts.append((x, y))
    return pts


def S(c, pts):
    return [(x * c.ss, y * c.ss) for x, y in pts]


def backdrop(c, tint=None, s=0.15):
    """统一的背景光洗：给暗场一点体积感，缩到 420px 宽的小图才不会变成纯黑。"""
    tint = tint or CYAN
    c.linear((0, c.h * 0.15), (c.w, c.h * 0.95), DEEP, (0, 0, 0), strength=s)
    c.point(c.w * 0.5, c.h * 0.42, c.w * 0.62, tint, s * 0.85, power=2.0)
    c.point(c.w * 0.18, c.h * 0.82, c.w * 0.34, VIOLET, s * 0.45, power=2.2)


def glow_node(c, x, y, r, color, strength):
    c.point(x, y, r * 2.6, color, strength * 0.45, power=2.8)
    c.point(x, y, r, PALE, strength, power=2.0)


# ---------------------------------------------------------------- hero：智能体星座
def art_hero(c, rng):
    # 地平网格
    m, d = c.layer(BLUE, bloom=0.55, radius=5.0, crisp=0.55)
    hy = c.h * 0.72
    for i in range(-14, 15):
        x = c.w * 0.5 + i * c.w * 0.09
        d.line(S(c, [(x, hy), (c.w * 0.5 + i * c.w * 0.42, c.h * 1.02)]), fill=110, width=2)
    for k in range(1, 11):
        y = hy + (c.h - hy) * (k / 10.0) ** 2.0
        d.line(S(c, [(0, y), (c.w, y)]), fill=90, width=2)
    c.linear((c.w * 0.5, hy), (c.w * 0.5, c.h), BLUE, DEEP, strength=0.26)

    # 轨道环（两条），略微倾斜
    m2, d2 = c.layer(CYAN, bloom=1.0, radius=7.0, crisp=0.8)
    cx, cy = c.w * 0.52, c.h * 0.44
    for rr, tilt, wd, a0, a1 in [(c.w * 0.26, -18, 3, 8, 352), (c.w * 0.37, -24, 2, 20, 322)]:
        d2.line(S(c, ellipse_pts(cx, cy, rr, rr * 0.34, tilt, a0, a1, 260)), fill=200, width=wd)

    # 智能体节点 + 细丝
    pts = poisson(rng, c.w, c.h * 0.86, c.w * 0.055, 46, margin=c.w * 0.03)
    m3, d3 = c.layer(CYAN, bloom=0.85, radius=4.0, crisp=0.7)
    for i, (x, y) in enumerate(pts):
        near = sorted(pts, key=lambda p: (p[0] - x) ** 2 + (p[1] - y) ** 2)[1:3]
        for (qx, qy) in near:
            d3.line(S(c, [(x, y), (qx, qy)]), fill=120, width=1)
    core = (c.w * 0.52, c.h * 0.42)
    for (x, y) in pts[:16]:
        d3.line(S(c, [core, (x, y)]), fill=70, width=1)
    for i, (x, y) in enumerate(pts):
        col = TEAL if i % 7 == 0 else (MAGENTA if i % 11 == 0 else CYAN)
        glow_node(c, x, y, rng.uniform(1.6, 3.4), col, rng.uniform(0.5, 1.15))
    glow_node(c, core[0], core[1], 9.0, PALE, 1.5)
    c.point(core[0], core[1], c.w * 0.11, CYAN, 0.30, power=2.6)
    # 左下角留暗区给标题/文字
    c.linear((0, c.h), (c.w * 0.42, c.h * 0.45), (0, 0, 0), (0, 0, 0), strength=0.0)


def ellipse_pts(cx, cy, rx, ry, tilt_deg, a0, a1, n):
    xs, ys = _ellipse(cx, cy, rx, ry, tilt_deg, a0, a1, n)
    return list(zip(xs, ys))


def _ellipse(cx, cy, rx, ry, tilt_deg, a0, a1, n):
    t = np.radians(np.linspace(a0, a1, n))
    x = rx * np.cos(t)
    y = ry * np.sin(t)
    th = math.radians(tilt_deg)
    xr = x * math.cos(th) - y * math.sin(th)
    yr = x * math.sin(th) + y * math.cos(th)
    return (cx + xr).tolist(), (cy + yr).tolist()


# ---------------------------------------------------------------- 01 神经格栅
def art_lattice(c, rng):
    backdrop(c)
    m, d = c.layer(CYAN, bloom=0.7, radius=4.0, crisp=0.75)
    rows, cols = 12, 18
    for r in range(rows):
        for q in range(cols):
            x = c.w * (q + 0.5) / cols
            y = c.h * (r + 0.5) / rows
            h = 2 if (r + q) % 3 else 3
            d.line(S(c, [(x - 10, y), (x + 10, y)]), fill=150, width=h)
            if q < cols - 1 and rng.random() < 0.55:
                d.line(S(c, [(x + 10, y), (x + c.w / cols - 10, y)]), fill=110, width=1)
    for i in range(0, rows, 3):
        y = c.h * (i + 0.5) / rows
        m2, d2 = c.layer(TEAL, bloom=0.9, radius=5.0, crisp=0.6)
        d2.line(S(c, [(0, y), (c.w, y - 14)]), fill=170, width=2)
    for _ in range(28):
        x, y = rng.uniform(0, c.w), rng.uniform(0, c.h)
        glow_node(c, x, y, rng.uniform(1.4, 2.6), CYAN, rng.uniform(0.4, 0.9))


# ---------------------------------------------------------------- 02 多智能体蜂群
def art_swarm(c, rng):
    backdrop(c)
    cx, cy = c.w * 0.5, c.h * 0.5
    m, d = c.layer(VIOLET, bloom=0.8, radius=5.0, crisp=0.6)
    for k in range(5):
        r = c.w * (0.09 + 0.055 * k)
        d.ellipse([(cx - r) * c.ss, (cy - r * 0.55) * c.ss, (cx + r) * c.ss, (cy + r * 0.55) * c.ss], outline=150, width=3)
        for j in range(46):
            a = rng.uniform(0, 2 * math.pi)
            c.point(cx + math.cos(a) * r, cy + math.sin(a) * r * 0.55, rng.uniform(1.0, 2.4), CYAN, rng.uniform(0.10, 0.35), power=2.2)
    m2, d2 = c.layer(CYAN, bloom=0.9, radius=4.0, crisp=0.8)
    agents = [(cx + math.cos(a) * c.w * (0.16 + 0.05 * rng.random()), cy + math.sin(a) * c.h * (0.2 + 0.1 * rng.random()))
              for a in np.linspace(0, 2 * math.pi, 22, endpoint=False)]
    for (x, y) in agents:
        d2.line(S(c, [(cx, cy), (x, y)]), fill=80, width=1)
    for i, (x, y) in enumerate(agents):
        glow_node(c, x, y, rng.uniform(2.0, 3.6), TEAL if i % 3 else MAGENTA, 0.9)
    glow_node(c, cx, cy, 10.0, PALE, 1.8)
    c.point(cx, cy, c.w * 0.16, CYAN, 0.28, power=2.4)


# ---------------------------------------------------------------- 03 token 流
def art_stream(c, rng):
    backdrop(c)
    for i in range(9):
        m, d = c.layer(CYAN if i % 2 == 0 else VIOLET, bloom=0.85, radius=5.0, crisp=0.65)
        base = c.h * (0.16 + 0.082 * i)
        pts = []
        for k in range(120):
            t = k / 119.0
            x = c.w * (t * 1.04 - 0.02)
            y = base + math.sin(t * 6.0 + i * 0.9) * c.h * 0.05 + math.sin(t * 17.0 + i) * c.h * 0.012
            pts.append((x, y))
        d.line(S(c, pts), fill=190 if i % 3 == 0 else 130, width=3 if i % 3 == 0 else 2)
    dots_x = rng.choice(np.linspace(c.w * 0.04, c.w * 0.96, 60), 26, replace=False)
    for x in dots_x:
        y = rng.uniform(c.h * 0.12, c.h * 0.88)
        glow_node(c, float(x), float(y), rng.uniform(1.2, 2.2), TEAL, rng.uniform(0.3, 0.7))


# ---------------------------------------------------------------- 04 推理树
def art_tree(c, rng):
    backdrop(c)
    m, d = c.layer(CYAN, bloom=0.8, radius=4.0, crisp=0.8)
    root = (c.w * 0.5, c.h * 0.94)

    def branch(x, y, ang, length, depth):
        if depth <= 0:
            return
        x2 = x + math.cos(ang) * length
        y2 = y - math.sin(ang) * length
        col = TEAL if depth >= 4 else CYAN
        d.line(S(c, [(x, y), (x2, y2)]), fill=200 - depth * 14, width=max(1, 4 - (6 - depth)))
        if depth <= 2:
            glow_node(c, x2, y2, 2.2, col, 0.85)
        for spread in (-1, 1):
            branch(x2, y2, ang + spread * rng.uniform(0.28, 0.52), length * rng.uniform(0.62, 0.78), depth - 1)

    branch(root[0], root[1], math.pi / 2, c.h * 0.2, 6)
    c.point(root[0], root[1], c.w * 0.14, CYAN, 0.3, power=2.6)


# ---------------------------------------------------------------- 05 嵌入空间点云
def art_embedding(c, rng):
    backdrop(c)
    centers = [(rng.uniform(0.15, 0.85), rng.uniform(0.18, 0.82)) for _ in range(6)]
    m, d = c.layer(VIOLET, bloom=0.5, radius=6.0, crisp=0.4)
    for (cx, cy) in centers:
        d.ellipse([(cx * c.w - 60) * c.ss, (cy * c.h - 42) * c.ss, (cx * c.w + 60) * c.ss, (cy * c.h + 42) * c.ss], outline=70, width=1)
    m3, d3 = c.layer(CYAN, bloom=0.45, radius=4.0, crisp=0.35)
    for i, (cx0, cy0) in enumerate(centers):
        col = [CYAN, TEAL, MAGENTA, VIOLET, BLUE, CYAN][i]
        cx, cy = cx0 * c.w, cy0 * c.h
        c.point(cx, cy, c.w * 0.10, col, 0.18, power=2.1)
        pts = []
        for _ in range(150):
            x = cx + float(rng.normal(0, c.w * 0.034))
            y = cy + float(rng.normal(0, c.h * 0.044))
            pts.append((x, y))
            c.point(x, y, rng.uniform(1.7, 3.4), col, rng.uniform(0.45, 1.15), power=2.2)
        for (x, y) in pts[:26]:
            d3.line(S(c, [(cx, cy), (x, y)]), fill=55, width=1)
        glow_node(c, cx, cy, 6.0, col, 1.0)


# ---------------------------------------------------------------- 06 电路微距
def art_circuit(c, rng):
    backdrop(c)
    m, d = c.layer(CYAN, bloom=0.6, radius=4.0, crisp=0.8)
    for _ in range(30):
        x = rng.uniform(c.w * 0.04, c.w * 0.96)
        y = rng.uniform(c.h * 0.04, c.h * 0.96)
        pts = [(x, y)]
        for _ in range(rng.integers(2, 6)):
            if rng.random() < 0.55:
                x += rng.choice([-1, 1]) * rng.uniform(50, 210)
            else:
                y += rng.choice([-1, 1]) * rng.uniform(40, 150)
            pts.append((x, y))
        d.line(S(c, pts), fill=200, width=4)
        for (px, py) in (pts[0], pts[-1]):
            d.ellipse([(px - 8) * c.ss, (py - 8) * c.ss, (px + 8) * c.ss, (py + 8) * c.ss], outline=235, width=3)
            glow_node(c, px, py, 3.0, TEAL, 0.95)
    for _ in range(26):
        c.point(rng.uniform(0, c.w), rng.uniform(0, c.h), rng.uniform(10, 46), CYAN, 0.10, power=2.0)


# ---------------------------------------------------------------- 07 注意力波形
def art_wave(c, rng):
    backdrop(c)
    for i in range(26):
        amp = c.h * (0.05 + 0.16 * rng.random())
        freq = rng.uniform(1.4, 4.2)
        phase = rng.uniform(0, math.pi * 2)
        col = TEAL if i % 5 == 0 else (MAGENTA if i % 9 == 0 else CYAN)
        m, d = c.layer(col, bloom=0.55, radius=4.0, crisp=0.6)
        pts = []
        for k in range(180):
            t = k / 179.0
            x = c.w * t
            y = c.h * 0.5 + math.sin(t * freq * math.pi * 2 + phase) * amp * math.sin(t * math.pi)
            pts.append((x, y))
        d.line(S(c, pts), fill=120, width=2)


# ---------------------------------------------------------------- 08 同心环雷达
def art_rings(c, rng):
    backdrop(c)
    cx, cy = c.w * 0.5, c.h * 0.52
    m, d = c.layer(CYAN, bloom=0.7, radius=5.0, crisp=0.7)
    for k in range(1, 9):
        r = c.w * 0.045 * k
        d.arc([(cx - r) * c.ss, (cy - r) * c.ss, (cx + r) * c.ss, (cy + r) * c.ss], 0, 360, fill=120, width=2)
    m2, d2 = c.layer(TEAL, bloom=1.0, radius=6.0, crisp=0.85)
    a0 = rng.uniform(0, 2 * math.pi)
    for k in range(1, 9):
        r = c.w * 0.045 * k
        d2.arc([(cx - r) * c.ss, (cy - r) * c.ss, (cx + r) * c.ss, (cy + r) * c.ss],
               math.degrees(a0), math.degrees(a0 + 0.55), fill=235, width=4)
    for _ in range(14):
        a = rng.uniform(0, 2 * math.pi)
        r = c.w * 0.045 * float(rng.integers(2, 8))
        glow_node(c, cx + math.cos(a) * r, cy + math.sin(a) * r, rng.uniform(1.6, 3.0), CYAN, 0.85)
    glow_node(c, cx, cy, 7.0, PALE, 1.4)


JOBS = [
    ("hero.jpg", 1920, 1080, 1.6, art_hero),
    ("t01-network.jpg", 1440, 960, 2.0, art_lattice),
    ("t02-constellation.jpg", 1440, 960, 2.0, art_swarm),
    ("t03-radar.jpg", 1440, 960, 2.0, art_rings),
    ("t04-flow.jpg", 1440, 960, 2.0, art_stream),
    ("t05-surface.jpg", 1440, 960, 2.0, art_embedding),
    ("t06-circuit.jpg", 1440, 960, 2.0, art_circuit),
    ("t07-wave.jpg", 1440, 960, 2.0, art_wave),
    ("t08-hex.jpg", 1440, 960, 2.0, art_tree),
]

for idx, (name, w, h, ss, fn) in enumerate(JOBS):
    rng = np.random.default_rng(1000 + idx * 37)
    c = Canvas(w, h, ss=ss)
    fn(c, rng)
    ex, vg = (1.45, 0.62) if name.startswith('hero') else (1.95, 0.36)
    p = c.render(os.path.join(OUT, name), exposure=ex, vignette=vg, quality=84)
    print("wrote", p, os.path.getsize(p) // 1024, "KB")
