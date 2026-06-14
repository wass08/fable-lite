import { defineConfig } from 'vite';

export default defineConfig({
  // Vercel serves from the root domain, so the app lives at "/". Override with
  // VITE_BASE only if hosting under a subpath.
  base: process.env.VITE_BASE ?? '/',
  // ez-tree and the three addons import bare 'three'; we render with the
  // WebGPU build. Alias the exact specifier so only one copy of three ships.
  resolve: {
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  build: { target: 'esnext' },
});
