'use strict';
/**
 * Menyematkan aset dari folder assets/ ke file HTML yang dibaca Apps Script
 * (HtmlService tidak dapat menyajikan file gambar statis):
 *   assets/background.jpg → src/Background.html (gambar latar, diperkecil ke 1024 px)
 *   assets/logo.png       → src/Logo.html (logo dipotong bulat 256 × 256, JPEG)
 *
 *   node dev/embed-assets.js      (atau: npm run assets)
 *
 * Jalankan ulang setiap kali gambar di assets/ diganti, lalu deploy.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const SRC = path.join(ROOT, 'src');
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(p => fs.existsSync(p));

/** Area lingkaran logo pada gambar sumber 453 × 499 (x, y, sisi). */
const LOGO_CROP = { x: 4, y: 35, size: 446 };

const dataUri = (file, type) => 'data:' + type + ';base64,' + fs.readFileSync(path.join(ASSETS, file)).toString('base64');

/** Latar diperkecil ke lebar 1024 px: gambarnya lembut, tampak sama, halaman pertama lebih ringan. */
async function writeBackground(page) {
  const uri = await page.evaluate(async src => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = Math.min(1024, img.width);
    const h = Math.round(img.height * w / img.width);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.72);
  }, dataUri('background.jpg', 'image/jpeg'));
  fs.writeFileSync(path.join(SRC, 'Background.html'),
    '<style>\n/* Gambar latar pilihan pemilik (assets/background.jpg, diperkecil ke 1024 px). Dibuat oleh dev/embed-assets.js. */\n' +
    'body::before { background-image: url("' + uri + '"); }\n</style>\n');
  console.log('src/Background.html', Math.round(uri.length / 1024) + ' KB');
}

async function writeLogo(page) {
  const out = await page.evaluate(async (src, crop) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, 256, 256);
    return c.toDataURL('image/jpeg', 0.9);
  }, dataUri('logo.png', 'image/png'), LOGO_CROP);
  fs.writeFileSync(path.join(SRC, 'Logo.html'),
    '<style>\n/* Logo GGSHOPS.ID (assets/logo.png, dipotong bulat). Dibuat oleh dev/embed-assets.js. */\n' +
    '.brand-logo { display: inline-block; flex: none; border-radius: 50%; background: #f4efe6 center / cover no-repeat url("' + out + '"); box-shadow: 0 0 0 1px rgba(255, 255, 255, .14); }\n</style>\n');
  console.log('src/Logo.html', Math.round(out.length / 1024) + ' KB');
}

(async () => {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    await writeBackground(page);
    await writeLogo(page);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
