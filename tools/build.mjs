// Builds the app from src/ into three outputs:
//   dist/ftc-sim-bench.html   publishable fragment (Claude artifact)
//   dist/preview.html         standalone page for local testing
//   docs/index.html           GitHub Pages (main branch, /docs)
//
//   node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// Concatenation order matters: later files use functions and constants the
// earlier ones define. The engine never touches the DOM; only view3d and app do.
export const ORDER = ['hardware', 'samples', 'step', 'expr', 'java', 'mapping', 'robotconfig', 'compare', 'analyze', 'sim', 'view3d', 'app'];

// An inline script must never contain a literal closing script tag.
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

const js = '"use strict";\n' + ORDER.map((n) => `// ---- src/${n}.js ----\n${rd('src', n + '.js')}`).join('\n');
const css = rd('src', 'styles.css');
const markup = rd('src', 'markup.html');

const fragment = [
  '<title>FTC Sim Bench</title>',
  '<meta name="description" content="Drop in any FTC robot\'s STEP CAD and any OpMode. The bench reads the assembly, interprets the code at 50 Hz, and lets you drive the result with a virtual gamepad.">',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap">',
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
  `<style>\n${css}</style>`,
  markup,
  `<script>\n${safe(js)}</script>`,
].join('\n');

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'ftc-sim-bench.html'), fragment, 'utf8');

const favicon = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect x="2" y="9" width="28" height="15" rx="7.5" fill="#1E6FE0"/>' +
  '<circle cx="10" cy="16.5" r="3" fill="#fff"/><circle cx="21.5" cy="14.5" r="1.8" fill="#fff"/>' +
  '<circle cx="24.5" cy="18" r="1.8" fill="#fff"/></svg>');
const page = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">\n<link rel="icon" href="${favicon}">\n` +
  `</head>\n<body>\n${fragment}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(ROOT, 'dist', 'preview.html'), page, 'utf8');

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), page, 'utf8');
fs.writeFileSync(path.join(ROOT, 'docs', '.nojekyll'), '', 'utf8');

console.log(`built dist/ftc-sim-bench.html (${(fragment.length / 1024).toFixed(0)} KB), dist/preview.html, docs/index.html`);
