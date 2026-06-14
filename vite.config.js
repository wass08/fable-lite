import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // dev serves from "/" (keeps localhost + LAN testing simple); the production
  // build targets the GitHub Pages project subpath. Override with VITE_BASE if
  // the repo is renamed.
  base: command === 'build' ? (process.env.VITE_BASE ?? '/fable-lite/') : '/',
  // ez-tree and the three addons import bare 'three'; we render with the
  // WebGPU build. Alias the exact specifier so only one copy of three ships.
  resolve: {
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  build: { target: 'esnext' },
}));
