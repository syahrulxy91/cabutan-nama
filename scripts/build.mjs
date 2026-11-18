import { build } from 'esbuild';

await build({
  entryPoints: ['web/firebase.js'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  minify: true,
  outfile: 'dist/firebase.js',
  define: { 'process.env.CABUT_APP_CHECK_SITE_KEY': JSON.stringify(process.env.CABUT_APP_CHECK_SITE_KEY ?? '') }
});
