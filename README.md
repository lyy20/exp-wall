# 罗毅扬 · AI Agent 开发工程师 ｜ 个人作品集

在线预览 👉 **https://lyy20.github.io/exp-wall/**

一个深色主题的单页作品集：全屏 Hero、横向滚动图带、逐字渐显的自我介绍、Framer Motion 粘性堆叠项目卡，底衬 Three.js 粒子星空，另有布料式鼠标斥力网格与点击彩色墨水特效。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | React 18.3.1 + TypeScript 5.6 + Vite 5.4 |
| 样式 | TailwindCSS 3.4.1 + PostCSS/Autoprefixer |
| 动效 | Framer Motion 12.38.0（whileInView / useScroll / useTransform）、GSAP 3.12（ticker） |
| 3D | Three.js 0.128（6000 点粒子星云） |
| 图标 | lucide-react 0.344.0 |

## 目录结构

```
src/
  App.tsx                 页面装配：StarField / 各 Section / ClothEffect / ClickInk
  index.css               字体、全局重置、.hero-heading 渐变字
  components/
    HeroSection.tsx       全屏主视觉 + 导航 + 身份行
    MarqueeSection.tsx    两行横向滚动图带（滚动驱动 translateX）
    AboutSection.tsx      自我介绍（逐字滚动透明度）
    ProjectsSection.tsx   4 张粘性堆叠项目卡
    StarField.tsx         Three.js 粒子星云背景
    ClothEffect.tsx       鼠标斥力布料网格
    ClickInk.tsx          点击/拖拽彩色墨水
    FadeIn.tsx            通用入场动画
    AnimatedText.tsx      逐字符滚动渐显
    ContactButton.tsx     渐变胶囊按钮
public/tech/              程序化生成的科技配图（本地渲染，无外部图床依赖）
.github/workflows/deploy.yml  GitHub Pages 自动部署
```

## 本地开发

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 输出到 dist/
npm run preview  # 本地预览构建产物
```

## 部署

推送到 `main` 即自动构建并发布到 GitHub Pages（`actions/configure-pages` → `actions/upload-pages-artifact` → `actions/deploy-pages`），无需手动上传产物，也不需要提交 `dist/`。

构建使用**相对 base**（`vite.config.ts` 中 `base: './'`），因此同一份代码既能跑在项目子路径（`/exp-wall/`），也能直接放到域根或自定义域名下，无需改动配置。

## 说明

- 页面内所有配图均为本地程序化生成，不依赖外部图片服务。
- 联系方式与项目数据来自个人简历，如需替换直接改 `src/components/` 下对应组件的常量即可。
