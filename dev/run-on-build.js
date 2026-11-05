'use strict';
/** Menjalankan uji E2E & klik terhadap folder build/ (kode yang benar-benar di-push). */
const { spawnSync } = require('child_process');
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/e2e.test.js', 'tests/clickthrough.test.js'],
  { stdio: 'inherit', env: Object.assign({}, process.env, { GAS_SRC_DIR: 'build' }) });
process.exit(r.status);
