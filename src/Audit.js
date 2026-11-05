/**
 * Audit log. Tidak menyimpan password, token, data foto, maupun koordinat
 * lengkap untuk percobaan yang gagal (cukup kode, jarak, dan akurasi).
 */

function audit_(ctx, action, entity, entityId, result, detail) {
  try {
    const now = new Date();
    const u = ctx && ctx.user;
    let d = '';
    if (detail !== undefined && detail !== null) d = typeof detail === 'string' ? detail : JSON.stringify(detail);
    insert_('AuditLogs', {
      logId: uid_().slice(0, 16),
      timestamp: now.toISOString(),
      waktuLokal: fmtLocal_(now.getTime(), 'yyyy-MM-dd HH:mm:ss'),
      userId: u ? u.userId : '',
      username: u ? u.username : (ctx && ctx.username) || '',
      role: u ? u.role : '',
      action: action,
      entity: entity || '',
      entityId: entityId || '',
      result: result || 'SUCCESS',
      detail: d.slice(0, 1000),
    });
  } catch (e) {
    console.error('Audit gagal: ' + e);
  }
}

function auditList_(ctx, p) {
  const all = rowsTail_('AuditLogs', 3000).slice().reverse();
  const action = cleanText_(p.action, 40);
  const result = cleanText_(p.result, 20);
  const q = cleanText_(p.q, 60).toLowerCase();
  const out = [];
  for (let i = 0; i < all.length && out.length < 500; i++) {
    const r = all[i];
    if (action && r.action !== action) continue;
    if (result && r.result !== result) continue;
    if (q && (r.username + ' ' + r.entityId + ' ' + r.detail + ' ' + r.action).toLowerCase().indexOf(q) < 0) continue;
    out.push(strip_(r));
  }
  return { logs: out };
}
