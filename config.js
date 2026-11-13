/**
 * Pengaturan opsional Lautan Pasir. Semua sudah punya nilai bawaan yang aman,
 * jadi di hosting cukup mengisi ADMIN_USER dan ADMIN_PASSWORD.
 * Ubah nilai di bawah ini (bukan di dashboard hosting) bila perlu.
 * Nilai dari environment variable dengan nama yang sama (mis. di start.bat/VPS) tetap menang.
 */
const defaults = {
  PORT: 3000,
  HOST: '0.0.0.0',          // start.bat memakai 127.0.0.1 untuk komputer lokal
  DATA_DIR: '',             // kosong = folder "data" di samping server.js; isi path volume bila hosting punya disk permanen
  TZ_OFFSET_HOURS: 7,       // 7 = WIB, 8 = WITA, 9 = WIT
  TRUST_PROXY: '',          // kosong = otomatis (aktif di cloud, mati di komputer lokal)
  RATE_LIMIT_MULTIPLIER: 1, // hanya untuk pengujian
  DATABASE_URL: ''          // isi (env) dengan alamat Postgres/Neon agar data permanen; kosong = hanya disk
};
// Pembacaan dinamis (bukan process.env.NAMA) agar pemindai platform tidak menganggapnya wajib diisi.
const read = key => { const v = process.env[key]; return v !== undefined && v !== '' ? v : defaults[key]; };
module.exports = { read };
