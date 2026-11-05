'use strict';
/**
 * Server pratinjau lokal: merender src/Index.html seperti HtmlService dan
 * meneruskan google.script.run ke mock runtime GAS (dev/gas-mock.js).
 *
 *   node dev/server.js            → http://localhost:5173 dengan data demo
 *   PORT=8080 node dev/server.js
 *   OFFICE="-6.2,106.8" node dev/server.js   → titik kantor demo
 *
 * localhost termasuk "secure context", sehingga kamera & GPS bisa diuji.
 * Data hanya disimpan di memori dan hilang saat server dihentikan.
 */
const http = require('http');
const { createGas } = require('./gas-mock');

const SHIM = `<script>
(function () {
  function Runner(ok, fail) { this._ok = ok; this._fail = fail; }
  Runner.prototype.withSuccessHandler = function (fn) { return new Runner(fn, this._fail); };
  Runner.prototype.withFailureHandler = function (fn) { return new Runner(this._ok, fn); };
  Runner.prototype.api = function () {
    var ok = this._ok, fail = this._fail, args = Array.prototype.slice.call(arguments);
    fetch('/__api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: 'api', args: args }) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (res) { if (ok) ok(res.result); }, function (err) { if (fail) fail(err); });
  };
  window.google = { script: { run: new Runner(null, null) } };
})();
</script>`;

function startServer(opts = {}) {
  const env = opts.env || createGas();
  const now = opts.now || (() => Date.now());
  const latency = opts.latencyMs || 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?') || req.url.startsWith('/exec'))) {
      env.setNow(now());
      let html;
      try { html = env.run('doGet').content; } catch (e) { res.writeHead(500); res.end(String(e.stack || e)); return; }
      html = html.replace('<head>', '<head>' + SHIM);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    if (req.method === 'POST' && req.url === '/__api') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 8e6) req.destroy(); });
      req.on('end', () => {
        let msg;
        try { msg = JSON.parse(body); } catch (e) { res.writeHead(400); res.end('bad json'); return; }
        if (msg.fn !== 'api') { res.writeHead(403); res.end('forbidden'); return; }
        const reply = () => {
          env.setNow(now());
          let result;
          try { result = env.run('api', ...(msg.args || [])); } catch (e) { res.writeHead(500); res.end(String(e.stack || e)); return; }
          if (opts.onApi) opts.onApi(msg.args, result);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result }));
        };
        latency ? setTimeout(reply, latency) : reply();
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/__exec') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 8e6) req.destroy(); });
      req.on('end', () => {
        env.setNow(now());
        const reply = () => {
          let out;
          try { out = env.run('doPost', { postData: { contents: body, type: req.headers['content-type'] || '' } }); } catch (e) { res.writeHead(500); res.end(String(e.stack || e)); return; }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(out.content);
        };
        latency ? setTimeout(reply, latency) : reply();
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/__vercel') {
      env.setNow(now());
      let html;
      try { html = require('./build-vercel').vercelHtml(env, '/__exec', '/__sw.js'); } catch (e) { res.writeHead(500); res.end(String(e.stack || e)); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && req.url === '/__sw.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(require('./build-vercel').SW_JS);
      return;
    }
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && req.url === '/__frame') {
      // Meniru web app Apps Script: aplikasi berjalan di dalam iframe sandbox dengan daftar
      // izin yang sama seperti Google (geolocation ada, camera TIDAK ada). Di Google iframe-nya
      // beda origin sehingga camera otomatis terblokir; di sini satu origin, jadi ditulis camera 'none'.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><meta charset="utf-8"><title>Web app</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">' +
        '<iframe src="/?framed=1" style="border:0;width:100vw;height:100vh;display:block" allow="camera \'none\'; accelerometer *; autoplay *; clipboard-read *; clipboard-write *; encrypted-media *; fullscreen *; geolocation *; gyroscope *; magnetometer *; midi *; payment *; picture-in-picture *; screen-wake-lock *; sync-xhr *; web-share *" ' +
        'sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation"></iframe></body></html>');
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise(resolve => server.listen(opts.port || 0, '127.0.0.1', () => resolve({ server, env, port: server.address().port })));
}

/** Data demo: admin, HR, manager, dua karyawan, lokasi & jadwal. */
function seedDemo(env, office) {
  env.setNow(Date.now());
  env.run('setup');
  const temp = /password sementara: (\S+)/.exec(env.state.logs.join('\n'))[1];
  const call = (a, p, t) => {
    const r = env.api(a, p, t);
    if (!r.ok) throw new Error(a + ': ' + r.error);
    return r.data;
  };
  let t = call('auth.login', { username: 'admin', password: temp }).token;
  const admin = call('auth.changePassword', { oldPassword: temp, newPassword: 'Admin12345' }, t).token;
  call('locations.save', { nama: 'Kantor Pusat', alamat: 'Lokasi demo', latitude: office.lat, longitude: office.lng, radius: 150 }, admin);
  const people = [
    ['budi', 'Budi Santoso', 'Staff IT', 'IT', 'karyawan'],
    ['siti', 'Siti Rahayu', 'Staff Marketing', 'Marketing', 'karyawan'],
    ['andi', 'Andi Pratama', 'Manager IT', 'IT', 'manager'],
    ['rina', 'Rina Marlina', 'HR Officer', 'HRD', 'hr'],
  ];
  const accounts = [['admin', 'Admin12345', 'Super Admin']];
  people.forEach(p => {
    const r = call('employees.save', { nama: p[1], jabatan: p[2], departemen: p[3], tanggalBergabung: '2025-01-06', createAccount: true, username: p[0], accountRole: p[4] }, admin);
    const tk = call('auth.login', { username: p[0], password: r.account.tempPassword }).token;
    call('auth.changePassword', { oldPassword: r.account.tempPassword, newPassword: 'Demo12345' }, tk);
    accounts.push([p[0], 'Demo12345', p[4]]);
  });
  // Izinkan absen kapan saja di demo agar mudah dicoba.
  const sched = call('schedules.list', {}, admin).schedules[0];
  call('schedules.save', Object.assign({}, sched, { hariKerja: '1,2,3,4,5,6,7', bukaCheckInMenit: 480, batasCheckOutMenit: 400 }), admin);
  return accounts;
}

if (require.main === module) {
  const office = (process.env.OFFICE || '-6.175392,106.827153').split(',').map(Number);
  const env = createGas({ now: Date.now() });
  const accounts = seedDemo(env, { lat: office[0], lng: office[1] });
  startServer({ env, port: Number(process.env.PORT) || 5173, latencyMs: 250 }).then(({ port }) => {
    console.log('Pratinjau lokal: http://localhost:' + port);
    console.log('Titik kantor demo: ' + office.join(', ') + ' (radius 150 m). Ubah di Pengaturan → Lokasi kerja → "Gunakan lokasi saya".');
    console.log('Akun demo:');
    accounts.forEach(a => console.log('  ' + a[0].padEnd(6) + ' / ' + a[1] + '  (' + a[2] + ')'));
  });
}

module.exports = { startServer, seedDemo, SHIM };
