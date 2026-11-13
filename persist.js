'use strict';
/**
 * Penyimpanan permanen. Bila DATABASE_URL (Postgres, mis. Neon) diisi, setiap berkas data
 * (pemesanan, paket, armada, pengaturan, akun admin, bukti bayar, foto unggahan) disalin ke database
 * dan dipulihkan otomatis saat server start. Tanpa DATABASE_URL, data hanya di disk container.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const cfg = require('./config').read;
let pool = null;

async function query(sql, params) {
  try { return await pool.query(sql, params); }
  catch { await new Promise(r => setTimeout(r, 600)); return pool.query(sql, params); } // sambungan Neon bisa baru "bangun"
}
const persist = {
  enabled: false,
  async init(dataDir) {
    const url = cfg('DATABASE_URL');
    if (!url) { console.warn('PERINGATAN: DATABASE_URL belum diisi, data HILANG saat deploy ulang/restart.'); return; }
    const { Pool } = require('pg');
    const local = /@(localhost|127\.0\.0\.1)/.test(String(url));
    pool = new Pool({ connectionString: String(url), ssl: local ? false : { rejectUnauthorized: false }, max: 4, idleTimeoutMillis: 10000, connectionTimeoutMillis: 20000 });
    pool.on('error', e => console.error('DB (koneksi idle):', e.message));
    await query('create table if not exists app_files (path text primary key, data bytea not null, updated_at timestamptz not null default now())');
    const { rows } = await query('select path, data from app_files');
    const root = path.resolve(dataDir);
    for (const r of rows) {
      const target = path.resolve(root, r.path);
      if (!target.startsWith(root + path.sep)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, r.data);
    }
    persist.enabled = true;
    console.log(`Penyimpanan permanen aktif (database): ${rows.length} berkas dipulihkan.`);
  },
  async save(rel, buf) {
    if (!pool) return;
    await query('insert into app_files (path, data) values ($1, $2) on conflict (path) do update set data = excluded.data, updated_at = now()', [rel, buf]);
  },
  async remove(rel) { if (pool) await query('delete from app_files where path = $1', [rel]); }
};
module.exports = persist;
