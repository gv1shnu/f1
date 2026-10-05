import { build } from 'esbuild';
import { mkdir, rm, copyFile, readFile, writeFile, cp } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
const result = await build({
  entryPoints: ['public/js/main.js', 'public/css/style.css'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  outdir: 'dist/assets',
  entryNames: '[name]-[hash]',
  metafile: true,
});
const output = Object.entries(result.metafile.outputs);
const js = output
  .find(([, v]) => v.entryPoint === 'public/js/main.js')[0]
  .replace('dist/', '');
const css = output
  .find(([, v]) => v.entryPoint === 'public/css/style.css')[0]
  .replace('dist/', '');
let html = await readFile('public/index.html', 'utf8');
html = html.replace('css/style.css', css).replace('js/main.js', js);
await writeFile('dist/index.html', html);
await cp('public/audio', 'dist/audio', { recursive: true });
await copyFile('public/js/boot.js', 'dist/boot.js');
console.log(`Built ${js} and ${css}`);
