import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  external: ['react', 'react-dom'],
  // The provider and hooks run on the client. The directive lets Next.js App
  // Router import the package from a Server Component tree without a wrapper.
  banner: { js: "'use client';" },
});
