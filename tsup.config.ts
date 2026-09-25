import { defineConfig, type Options } from 'tsup';

const common: Options = {
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  target: 'es2020',
  external: ['react', 'react-dom'],
};

export default defineConfig([
  {
    ...common,
    entry: { index: 'src/index.ts' },
    // The provider and hooks run on the client. The directive lets Next.js App
    // Router import the package from a Server Component tree without a wrapper.
    // (No `treeshake`: its rollup pass would strip the directive.)
    banner: { js: "'use client';" },
  },
  {
    ...common,
    // Server-safe helpers: no directive, so Server Components can call them.
    entry: { server: 'src/server.ts' },
  },
]);
