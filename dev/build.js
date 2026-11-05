'use strict';
/**
 * Membangun folder build/ yang di-push ke Apps Script (rootDir di .clasp.json).
 *  - File server (.js) dan appsscript.json disalin apa adanya.
 *  - Halaman (.html): <script> dipadatkan dengan terser, <style> dibuang komentar
 *    & spasinya. Scriptlet Apps Script (<?!= ... ?>) tidak disentuh.
 * src/ tetap menjadi sumber yang dibaca manusia dan dipakai uji.
 *
 *   node dev/build.js      (atau: npm run build)
 */
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'build');

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/\s*:\s*(?![^(]*\))/g, ':')
    .replace(/;}/g, '}')
    .trim();
}

async function minifyHtml(html, name) {
  let out = html.replace(/<style>([\s\S]*?)<\/style>/g, (m, css) => '<style>' + minifyCss(css) + '</style>');
  const scripts = [];
  out.replace(/<script>([\s\S]*?)<\/script>/g, (m, js) => { scripts.push(js); return m; });
  for (const js of scripts) {
    if (js.indexOf('<?') >= 0) continue;
    const res = await minify(js, { ecma: 2017, compress: { passes: 2 }, mangle: true, format: { comments: false } });
    if (!res.code) throw new Error('terser gagal: ' + name);
    out = out.replace('<script>' + js + '</script>', () => '<script>' + res.code + '</script>');
  }
  return out;
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let before = 0, after = 0;
  for (const f of fs.readdirSync(SRC)) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    let data = src;
    if (f.endsWith('.html')) {
      data = await minifyHtml(src, f);
      before += src.length;
      after += data.length;
    }
    fs.writeFileSync(path.join(OUT, f), data);
  }
  console.log('build/ siap. Halaman: ' + Math.round(before / 1024) + ' KB → ' + Math.round(after / 1024) + ' KB');
})().catch(e => { console.error(e); process.exit(1); });
