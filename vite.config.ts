import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 相对 base：无论部署在域根（xxx.github.io）还是项目子路径（xxx.github.io/exp-wall/）都能正确取到资源
  base: './',
  plugins: [react()],
});
