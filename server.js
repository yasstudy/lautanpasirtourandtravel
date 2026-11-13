'use strict';
/**
 * Lautan Pasir Tour & Travel — server (Express, tanpa dependensi tambahan).
 *
 * Data disimpan sebagai berkas JSON di DATA_DIR (default ./data):
 *   bookings.json  packages.json  fleet.json  blocks.json  settings.json  admin.json  sessions.json
 *   proofs/   -> bukti pembayaran (PRIVAT, hanya bisa dibuka admin)
 *   uploads/  -> foto paket/armada & gambar QRIS (publik di /uploads)
 *
 * Env: PORT, HOST (default 0.0.0.0; start.bat memakai 127.0.0.1), DATA_DIR, TRUST_PROXY=1 (bila di belakang Caddy/Nginx),
 *      ADMIN_USER, ADMIN_PASSWORD (hanya dipakai saat akun admin pertama dibuat),
 *      RATE_LIMIT_MULTIPLIER (hanya untuk pengujian).
 */
const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const ROOT = __dirname;
const cfg = require('./config').read;
const persist = require('./persist');
const PORT = Number(cfg('PORT')) || 3000;
const HOST = String(cfg('HOST')); // start.bat memakai 127.0.0.1 untuk komputer lokal; hosting cloud memerlukan 0.0.0.0
const DATA_DIR = cfg('DATA_DIR') ? path.resolve(String(cfg('DATA_DIR'))) : path.join(ROOT, 'data');
const PROOF_DIR = path.join(DATA_DIR, 'proofs');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 jam
const TZ_OFFSET_HOURS = Number(cfg('TZ_OFFSET_HOURS')); // WIB
const RL = Math.max(1, Number(cfg('RATE_LIMIT_MULTIPLIER')) || 1);
const MAX_AHEAD_DAYS = 730;

const STATUSES = ['Pending', 'Dikonfirmasi', 'Dalam Perjalanan', 'Selesai', 'Dibatalkan'];
const STATUS_LABEL = {
  Pending: 'Menunggu konfirmasi',
  Dikonfirmasi: 'Pemesanan dikonfirmasi',
  'Dalam Perjalanan': 'Armada dalam perjalanan',
  Selesai: 'Perjalanan selesai',
  Dibatalkan: 'Pemesanan dibatalkan'
};

/* ------------------------------------------------------------------ util */
class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const rupiah = n => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(n) || 0);
const nowIso = () => new Date().toISOString();

const DAY = 864e5;
const parseD = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fmtD = ms => new Date(ms).toISOString().slice(0, 10);
const addDays = (s, n) => fmtD(parseD(s) + n * DAY);
const eachDay = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));
const dayDiff = (a, b) => Math.round((parseD(b) - parseD(a)) / DAY);
const todayWib = () => fmtD(Date.now() + TZ_OFFSET_HOURS * 3600e3);
const longDate = s => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`));

function cleanText(value, max = 300) { return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : ''; }
function cleanList(value, maxItems = 20, maxLen = 300) {
  if (!Array.isArray(value)) return [];
  return value.map(v => cleanText(v, maxLen)).filter(Boolean).slice(0, maxItems);
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function toInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  return i < min || i > max ? fallback : i;
}
function normalizePhone(value) {
  let d = String(value || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = `62${d.slice(1)}`;
  else if (d.startsWith('8')) d = `62${d}`;
  return d;
}
function slugify(s) { return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item'; }
function uniqueId(base, rows) { let id = base; let i = 2; while (rows.some(r => r.id === id)) id = `${base}-${i++}`; return id; }
function imagePath(value) { const v = cleanText(value, 200); return /^\/(images|uploads)\/[\w.\-]+$/.test(v) ? v : ''; }

/* ------------------------------------------------------------ JSON store */
const locks = new Map();
function withLock(name, fn) {
  const prev = locks.get(name) || Promise.resolve();
  const next = prev.then(fn);
  locks.set(name, next.catch(() => {}));
  return next;
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw error; }
}
async function writeJson(file, value) {
  const target = path.join(DATA_DIR, file);
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(tmp, text);
  try { await persist.save(file, Buffer.from(text)); } catch (e) { await fs.rm(tmp, { force: true }); throw e; }
  await fs.rename(tmp, target);
}
/** Baca-ubah-tulis yang aman dari tabrakan. Jika mutator melempar error, tidak ada yang ditulis. */
function update(file, fallback, mutator) {
  return withLock(file, async () => {
    const data = await readJson(file, fallback);
    const result = await mutator(data);
    await writeJson(file, data);
    return result;
  });
}

/* ----------------------------------------------------------- data awal */
const FEATURES = ['AC', 'Reclining Seat', 'TV', 'Bagasi'];
const DEFAULT_FLEET = [
  { id: 'medium-bus', name: 'Medium Bus (32 Kursi)', seats: 32, units: 2, image: '/images/medium-bus.webp', features: FEATURES, pricePerDay: 0, active: true, order: 1 },
  { id: 'big-bus', name: 'Big Bus (40 Kursi)', seats: 40, units: 2, image: '/images/big-bus.webp', features: FEATURES, pricePerDay: 0, active: true, order: 2 },
  { id: 'big-bus-50', name: 'Big Bus Kapasitas Besar (50 Kursi)', seats: 50, units: 2, image: '/images/large-bus.webp', features: FEATURES, pricePerDay: 0, active: true, order: 3 }
];
const allFleetOptions = () => DEFAULT_FLEET.map(f => ({ fleetId: f.id, price: 0 }));
const DEFAULT_PACKAGES = [
  {
    id: 'study-tour-yogyakarta', name: 'Paket Study Tour Yogyakarta', image: '/images/yogyakarta.webp', tag: 'Favorit',
    destinations: 'Borobudur · Malioboro', duration: '2–3 Hari', days: 3, facilities: 'Fasilitas Lengkap', fleetOptions: allFleetOptions(), active: true, order: 1,
    itinerary: ['Hari 1: Berangkat menuju Yogyakarta, kunjungan edukasi Candi Borobudur, check-in dan istirahat.', 'Hari 2: Kunjungan edukasi sesuai agenda sekolah, dilanjutkan kawasan Malioboro.', 'Hari 3 (opsional): Sarapan, waktu bebas/pusat oleh-oleh, perjalanan pulang.'],
    includes: ['Bus pariwisata dan pengemudi', 'BBM dan tol sesuai rute yang disepakati', 'Koordinasi jadwal perjalanan'],
    terms: ['Rute, tiket masuk, konsumsi, dan penginapan dikonfirmasi dalam penawaran tertulis.', 'Jadwal dapat disesuaikan dengan kebutuhan rombongan dan kondisi lapangan.']
  },
  {
    id: 'wisata-alam-dieng', name: 'Paket Wisata Alam Dieng', image: '/images/dieng.webp', tag: '',
    destinations: 'Dieng · Telaga Warna', duration: '2–3 Hari', days: 3, facilities: 'Fasilitas Lengkap', fleetOptions: allFleetOptions(), active: true, order: 2,
    itinerary: ['Hari 1: Perjalanan ke kawasan Dieng, check-in dan istirahat.', 'Hari 2: Eksplorasi Telaga Warna dan destinasi alam Dieng sesuai kondisi cuaca.', 'Hari 3 (opsional): Sarapan, kunjungan terakhir/pusat oleh-oleh, perjalanan pulang.'],
    includes: ['Bus pariwisata dan pengemudi', 'BBM dan tol sesuai rute yang disepakati', 'Pengaturan waktu kunjungan'],
    terms: ['Tiket wisata, penginapan, konsumsi, dan biaya lokal dikonfirmasi di penawaran.', 'Destinasi alam dapat berubah mengikuti cuaca dan akses setempat.']
  },
  {
    id: 'wisata-keluarga', name: 'Paket Wisata Keluarga', image: '/images/family.webp', tag: 'Liburan',
    destinations: 'Pantai · Taman Rekreasi', duration: '2–3 Hari', days: 3, facilities: 'Fasilitas Lengkap', fleetOptions: allFleetOptions(), active: true, order: 3,
    itinerary: ['Hari 1: Penjemputan dan perjalanan ke destinasi pilihan keluarga.', 'Hari 2: Kunjungan pantai atau taman rekreasi sesuai rencana perjalanan.', 'Hari 3 (opsional): Waktu santai, perjalanan pulang dan pengantaran.'],
    includes: ['Bus/Hiace sesuai jumlah peserta', 'Pengemudi dan koordinasi perjalanan', 'Rencana kunjungan yang dapat disesuaikan'],
    terms: ['Destinasi, tiket, konsumsi, dan akomodasi dipilih serta dikonfirmasi sebelum keberangkatan.', 'Harga akhir mengikuti rute, tanggal, durasi, dan jumlah peserta.']
  },
  {
    id: 'city-tour-jakarta', name: 'Paket City Tour Jakarta', image: '/images/jakarta.webp', tag: '',
    destinations: 'Monas · Kota Tua · Ancol', duration: '2–3 Hari', days: 3, facilities: 'Fasilitas Lengkap', fleetOptions: allFleetOptions(), active: true, order: 4,
    itinerary: ['Hari 1: Penjemputan dan city tour Monas serta kawasan Kota Tua.', 'Hari 2: Kunjungan Ancol atau destinasi kota sesuai minat rombongan.', 'Hari 3 (opsional): Agenda tambahan, perjalanan pulang.'],
    includes: ['Bus pariwisata dan pengemudi', 'BBM dan tol sesuai rute yang disepakati', 'Koordinasi urutan destinasi'],
    terms: ['Tiket masuk, parkir, konsumsi, dan penginapan dikonfirmasi pada penawaran.', 'Urutan kunjungan dapat berubah sesuai lalu lintas dan jam operasional.']
  }
];
const DEFAULT_SETTINGS = {
  waNumber: '6282234567890', phoneDisplay: '0822-3456-7890', email: 'lautanpasirtravel@gmail.com',
  address: 'Jl. Raya Madiun No. 123, Malang', dpPercent: 50, paymentNote: '', demoPayment: false, autoCancel: true,
  banks: [], qris: { enabled: false, image: '' }
};

/* ---------------------------------------------- armada, paket, ketersediaan */
const fleetUnits = f => Math.max(1, Number(f.units) || 1);
const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(String(b.name), 'id');

/** Paket lama (tanpa fleetOptions) tetap bisa dipakai: semua armada, harga lama per armada. */
function normPackage(p, fleets) {
  const options = Array.isArray(p.fleetOptions) ? p.fleetOptions : fleets.map(f => ({ fleetId: f.id, price: Number(p.price) || 0 }));
  return { ...p, days: toInt(p.days, 1, 30, 1), fleetOptions: options.filter(o => fleets.some(f => f.id === o.fleetId)) };
}
const getFleet = () => readJson('fleet.json', DEFAULT_FLEET);
const getBlocks = () => readJson('blocks.json', []);
async function getPackages() { const [p, f] = await Promise.all([readJson('packages.json', DEFAULT_PACKAGES), getFleet()]); return p.map(x => normPackage(x, f)); }

const isActiveStatus = s => s !== 'Dibatalkan';
/** Peta tanggal -> { booked, blocked } untuk satu armada pada rentang [from, to]. */
function usage(bookings, blocks, fleetId, from, to, excludeId) {
  const map = new Map();
  const bump = (d, key, n) => { const e = map.get(d) || { booked: 0, blocked: 0 }; e[key] += n; map.set(d, e); };
  const span = (start, end, key, n) => {
    const a = start > from ? start : from, b = end < to ? end : to;
    for (let d = a; d <= b; d = addDays(d, 1)) bump(d, key, n);
  };
  for (const b of bookings) {
    if (b.fleetId !== fleetId || !isActiveStatus(b.status) || b.id === excludeId || !validDate(b.date)) continue;
    const end = addDays(b.date, Math.max(1, Number(b.days) || 1) - 1);
    if (end < from || b.date > to) continue;
    span(b.date, end, 'booked', Math.max(1, Number(b.fleetCount) || 1));
  }
  for (const k of blocks) {
    if (k.fleetId !== fleetId || k.to < from || k.from > to) continue;
    span(k.from, k.to, 'blocked', Math.max(1, Number(k.units) || 1));
  }
  return map;
}
const freeOf = (fleet, e) => Math.max(0, fleetUnits(fleet) - (e ? e.booked + e.blocked : 0));

/** null jika tersedia; selain itu penjelasan konflik pertama. */
function availabilityConflict(fleet, bookings, blocks, date, days, count, excludeId) {
  const units = fleetUnits(fleet);
  if (count > units) return { reason: 'units', units, message: `${fleet.name} hanya tersedia ${units} unit, sedangkan Anda membutuhkan ${count}. Kurangi jumlah armada atau pilih armada lain.` };
  const u = usage(bookings, blocks, fleet.id, date, addDays(date, days - 1), excludeId);
  for (const d of eachDay(date, days)) {
    const free = freeOf(fleet, u.get(d));
    if (free < count) return { reason: 'full', date: d, free, message: `${fleet.name} tidak tersedia pada ${longDate(d)} (tersisa ${free} unit, dibutuhkan ${count}). Pilih tanggal lain atau kurangi jumlah armada.` };
  }
  return null;
}

/* ------------------------------------------------------------ pemesanan */
function paidTotal(b) { return (b.payments || []).filter(p => p.status === 'Terverifikasi').reduce((s, p) => s + (Number(p.amount) || 0), 0); }
function computePaymentStatus(b) {
  if (b.refunded) return 'Dikembalikan';
  if ((b.payments || []).some(p => p.status === 'Menunggu verifikasi')) return 'Menunggu verifikasi';
  const paid = paidTotal(b);
  if (b.price > 0 && paid >= b.price) return 'Lunas';
  if (paid > 0) return 'DP';
  if (b.legacyPayment) return b.legacyPayment; // data dari versi lama, sebelum pembayaran dicatat per transaksi
  return b.price > 0 ? 'Menunggu pembayaran' : 'Menunggu penawaran harga';
}
function addTimeline(b, label, note = '', by = 'sistem') {
  b.timeline = b.timeline || [];
  b.timeline.push({ at: nowIso(), label, note, by });
}
function newId(rows) {
  const d = new Date(Date.now() + TZ_OFFSET_HOURS * 3600e3);
  const prefix = `LP-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}-`;
  let id;
  do { id = prefix + crypto.randomInt(0, 10000).toString().padStart(4, '0'); } while (rows.some(r => r.id === id));
  return id;
}
function findBooking(rows, id) {
  const row = rows.find(r => r.id === id);
  if (!row) throw new HttpError(404, 'Pemesanan tidak ditemukan.');
  return row;
}
/** Tampilan untuk pelanggan: tanpa catatan internal, nama berkas bukti, atau email. */
/* Kebijakan batas bayar (ditampilkan ke pelanggan; pembatalan dilakukan admin):
   - DP paling lambat 3 hari sebelum tanggal berangkat (sampai 23.59 WIB).
   - Pelunasan paling lambat 24 jam sebelum keberangkatan; acuan = pukul 00.00 WIB tanggal berangkat, jadi sampai 23.59 WIB dua hari sebelumnya. */
const DP_DEADLINE_DAYS = 3;
const GRACE_MS = 24 * 3600e3; // pelanggan minimal punya 24 jam sejak pesanan dibuat / harga ditetapkan sebelum bisa dibatalkan otomatis
/** 'dp' | 'full' | null — apakah batas bayar terlewat (dengan masa tenggang & pengecualian). */
function payOverdue(b, paid = paidTotal(b)) {
  if (!validDate(b.date) || !(b.price > 0) || b.legacyPayment || b.autoCancelExempt) return null;
  if (!['Pending', 'Dikonfirmasi'].includes(b.status)) return null;
  const anchors = [Date.parse(b.createdAt) || 0, ...(b.timeline || []).filter(t => /^(Harga|Tanggal keberangkatan)/.test(t.label)).map(t => Date.parse(t.at) || 0)];
  if (Date.now() < Math.max(...anchors) + GRACE_MS) return null;
  const today = todayWib();
  if (paid === 0 && today > addDays(b.date, -DP_DEADLINE_DAYS)) return 'dp';
  if (paid < b.price && today > addDays(b.date, -2)) return 'full';
  return null;
}
function deadlines(b, paid = paidTotal(b)) {
  if (!validDate(b.date)) return null;
  const o = payOverdue(b, paid);
  return { dpBy: addDays(b.date, -DP_DEADLINE_DAYS), fullBy: addDays(b.date, -2), dpOverdue: o === 'dp', fullOverdue: o === 'full' };
}
const adm = b => ({ ...b, overdue: payOverdue(b) });
/** Pembatalan otomatis: DP tidak dibayar sebelum H-3, atau belum lunas sebelum 24 jam keberangkatan (DP hangus). */
async function sweepOverdue() {
  const settings = await readJson('settings.json', DEFAULT_SETTINGS);
  if (settings.autoCancel === false) return 0;
  let n = 0;
  await update('bookings.json', [], rows => {
    for (const b of rows) {
      const o = payOverdue(b); if (!o) continue;
      const paid = paidTotal(b);
      b.status = 'Dibatalkan'; n++;
      if (o === 'full') {
        b.dpForfeited = true;
        addTimeline(b, 'Dibatalkan otomatis', `Pelunasan tidak dibayar paling lambat 1 × 24 jam sebelum keberangkatan. Pemesanan dibatalkan dan DP (Rp ${rupiah(paid)}) hangus sesuai ketentuan.`);
      } else addTimeline(b, 'Dibatalkan otomatis', 'DP tidak dibayar paling lambat 3 hari sebelum keberangkatan. Pemesanan dibatalkan sesuai ketentuan.');
      b.paymentStatus = computePaymentStatus(b);
    }
    return rows;
  });
  if (n) console.log(`[otomatis] ${n} pemesanan dibatalkan karena melewati batas pembayaran.`);
  return n;
}
function publicBooking(b) {
  const paid = paidTotal(b);
  const days = Math.max(1, Number(b.days) || 1);
  return {
    id: b.id, customerName: b.customerName, package: b.package || '', fleet: b.fleet || 'Belum ditentukan', fleetCount: b.fleetCount || 1,
    date: b.date, days, endDate: validDate(b.date) ? addDays(b.date, days - 1) : b.date, guests: b.guests, destination: b.destination || '', price: b.price || 0,
    status: b.status, paymentStatus: b.paymentStatus, paid, deadlines: deadlines(b, paid), balance: Math.max(0, (b.price || 0) - paid), createdAt: b.createdAt,
    timeline: (b.timeline || []).map(t => ({ at: t.at, label: t.label, note: t.note || '' })),
    payments: (b.payments || []).map(p => ({ id: p.id, at: p.at, method: p.method, demo: Boolean(p.demo), amount: p.amount, status: p.status, note: p.status === 'Ditolak' ? (p.note || '') : '' }))
  };
}
/** Harga SELALU dihitung server. Paket: harga per armada (sudah termasuk armada). Tanpa paket: tarif armada per hari. */
function quote(pkg, fleet, days, count) {
  if (pkg) { const o = pkg.fleetOptions.find(x => x.fleetId === fleet.id); return o && o.price > 0 ? o.price * count : 0; }
  return fleet.pricePerDay > 0 ? fleet.pricePerDay * days * count : 0;
}

/* ------------------------------------------------------------ gambar */
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
function decodeImage(dataUrl, maxBytes) {
  const m = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw new HttpError(400, 'Gambar harus berformat JPG, PNG, atau WebP.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > maxBytes) throw new HttpError(413, `Ukuran gambar maksimal ${Math.round(maxBytes / 1048576)} MB.`);
  const ext = sniffImage(buf); // jangan percaya header dari klien, cek isi berkasnya
  if (!ext) throw new HttpError(400, 'Isi berkas bukan gambar JPG, PNG, atau WebP yang valid.');
  return { buf, ext };
}

/* ------------------------------------------------------------ autentikasi */
let admin = null; // { username, salt, hash, mustChange }
const sessions = new Map(); // sha256(token) -> { exp }
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
async function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  return { salt: salt.toString('hex'), hash: (await scrypt(password, salt, 64)).toString('hex') };
}
async function checkPassword(password, rec) {
  const { hash } = await hashPassword(password, rec.salt);
  const a = Buffer.from(hash, 'hex'); const b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function ensureAdmin() {
  admin = await readJson('admin.json', null);
  if (admin) return;
  const username = cleanText(process.env.ADMIN_USER, 60) || 'admin';
  const given = process.env.ADMIN_PASSWORD;
  const strong = typeof given === 'string' && given.length >= 10 && given !== 'lautansandi';
  const password = strong ? given : crypto.randomBytes(9).toString('base64url');
  admin = { username, ...(await hashPassword(password)), mustChange: !strong, createdAt: nowIso() };
  await writeJson('admin.json', admin);
  if (!strong) {
    console.log('\n==================================================================');
    console.log(' AKUN ADMIN DIBUAT (muncul sekali ini saja)');
    console.log(`   Username : ${username}`);
    console.log(`   Password : ${password}`);
    console.log(' Anda wajib menggantinya saat login pertama.');
    console.log('==================================================================\n');
  }
}
const persistSessions = () => withLock('sessions.json', () => writeJson('sessions.json', Object.fromEntries(sessions)));
function pruneSessions() { const now = Date.now(); for (const [k, v] of sessions) if (v.exp <= now) sessions.delete(k); }
function bearer(req) { return (req.get('authorization') || '').replace(/^Bearer\s+/i, ''); }
function adminGuard({ allowMustChange = false } = {}) {
  return (req, res, next) => {
    const token = bearer(req);
    const s = token && sessions.get(sha(token));
    if (!s || s.exp <= Date.now()) return res.status(401).json({ error: 'Sesi admin tidak valid atau telah berakhir.' });
    if (admin.mustChange && !allowMustChange) return res.status(403).json({ error: 'Ganti password awal terlebih dahulu.', mustChange: true });
    req.sessionKey = sha(token);
    next();
  };
}
const adminOnly = adminGuard();
const adminAny = adminGuard({ allowMustChange: true });

/* ------------------------------------------------------ pembatas permintaan */
const buckets = new Map();
function limiter(name, max, windowMs, message) {
  max *= RL;
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; buckets.set(key, b); }
    b.count += 1;
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: message || 'Terlalu banyak permintaan. Coba lagi beberapa saat.' });
    }
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (now - v.start > 3600e3) buckets.delete(k); pruneSessions(); }, 10 * 60e3).unref();
const loginFails = new Map();
function loginBlocked(ip) { const f = loginFails.get(ip); return f && Date.now() - f.start < 15 * 60e3 && f.count >= 8; }
function loginFailed(ip) {
  const now = Date.now(); let f = loginFails.get(ip);
  if (!f || now - f.start >= 15 * 60e3) f = { start: now, count: 0 };
  f.count += 1; loginFails.set(ip, f);
}

/* ------------------------------------------------------------------ app */
const app = express();
app.disable('x-powered-by');
// Di hosting cloud, semua lalu lintas lewat proxy platform: percayai X-Forwarded-For agar pembatas laju & login memakai IP pengunjung asli.
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
const trust = cfg('TRUST_PROXY') !== '' ? Number(cfg('TRUST_PROXY')) : (loopback ? 0 : 1);
if (trust) app.set('trust proxy', trust);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// Parser khusus untuk unggahan gambar harus lebih dulu dari parser global.
app.use(['/api/track/payments', '/api/admin/upload'], express.json({ limit: '7mb' }));
app.use(express.json({ limit: '100kb' }));

/* ---- publik: katalog ---- */
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/packages', asyncRoute(async (_req, res) => {
  const fleets = (await getFleet()).filter(f => f.active !== false);
  const packages = (await getPackages()).filter(p => p.active !== false)
    .map(p => ({ ...p, fleetOptions: p.fleetOptions.filter(o => fleets.some(f => f.id === o.fleetId)) }))
    .filter(p => p.fleetOptions.length)
    .sort(byOrder);
  res.json({ packages });
}));
app.get('/api/fleet', asyncRoute(async (_req, res) => {
  res.json({ fleet: (await getFleet()).filter(f => f.active !== false).map(f => ({ ...f, units: fleetUnits(f) })).sort(byOrder) });
}));
app.get('/api/settings', asyncRoute(async (_req, res) => {
  res.json({ settings: await readJson('settings.json', DEFAULT_SETTINGS) });
}));

/* ---- publik: kalender ketersediaan ---- */
function rangeFromQuery(req, maxDays) {
  const from = req.query.from, to = req.query.to;
  if (!validDate(from) || !validDate(to) || to < from) throw new HttpError(400, 'Rentang tanggal tidak valid.');
  if (dayDiff(from, to) + 1 > maxDays) throw new HttpError(400, `Rentang tanggal maksimal ${maxDays} hari.`);
  return { from, to };
}
app.get('/api/availability', limiter('avail', 120, 10 * 60e3), asyncRoute(async (req, res) => {
  const { from, to } = rangeFromQuery(req, 93);
  const [fleets, bookings, blocks] = await Promise.all([getFleet(), readJson('bookings.json', []), getBlocks()]);
  const out = {};
  for (const f of fleets.filter(x => x.active !== false && (!req.query.fleetId || x.id === req.query.fleetId))) {
    const u = usage(bookings, blocks, f.id, from, to);
    const free = {};
    for (const d of eachDay(from, dayDiff(from, to) + 1)) free[d] = freeOf(f, u.get(d));
    out[f.id] = { name: f.name, seats: f.seats, units: fleetUnits(f), free };
  }
  res.json({ from, to, today: todayWib(), fleets: out });
}));

/* ---- publik: pemesanan, tracking, pembayaran ---- */
app.post('/api/bookings', limiter('book', 10, 3600e3, 'Terlalu banyak pemesanan dari jaringan ini. Coba lagi nanti atau hubungi kami via WhatsApp.'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  if (body.website) throw new HttpError(400, 'Permintaan tidak valid.'); // kolom jebakan untuk bot
  const customerName = cleanText(body.customerName, 120);
  const customerPhone = normalizePhone(body.customerPhone);
  const customerEmail = cleanText(body.customerEmail, 180);
  const destination = cleanText(body.destination, 200);
  const notes = cleanText(body.notes, 500);
  const date = body.date;
  const guests = toInt(body.guests, 1, 500, null);
  const fleetCount = toInt(body.fleetCount ?? 1, 1, 20, null);
  if (!customerName || customerPhone.length < 10 || customerPhone.length > 15) throw new HttpError(400, 'Isi nama dan nomor WhatsApp yang valid (contoh 08123456789).');
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new HttpError(400, 'Format email tidak valid.');
  if (!validDate(date) || date < todayWib()) throw new HttpError(400, 'Tanggal berangkat tidak valid atau sudah lewat.');
  if (date > addDays(todayWib(), MAX_AHEAD_DAYS)) throw new HttpError(400, 'Tanggal berangkat terlalu jauh. Hubungi kami untuk pemesanan jangka panjang.');
  if (!guests || !fleetCount) throw new HttpError(400, 'Jumlah peserta dan armada harus berupa angka yang wajar.');
  if (!destination) throw new HttpError(400, 'Isi titik penjemputan.');

  const [packages, fleets] = await Promise.all([getPackages(), getFleet()]);
  const fleet = fleets.find(f => f.id === body.fleetId && f.active !== false);
  if (!fleet) throw new HttpError(400, 'Pilih armada yang tersedia.');
  let pkg = null;
  if (body.packageId) {
    pkg = packages.find(p => p.id === body.packageId && p.active !== false);
    if (!pkg) throw new HttpError(400, 'Paket wisata tidak ditemukan.');
    if (!pkg.fleetOptions.some(o => o.fleetId === fleet.id)) throw new HttpError(400, `${fleet.name} tidak termasuk dalam ${pkg.name}. Pilih salah satu armada yang tersedia untuk paket ini.`);
  }
  const days = pkg ? pkg.days : toInt(body.days, 1, 30, null); // paket menentukan lama perjalanan
  if (!days) throw new HttpError(400, 'Lama sewa harus 1–30 hari.');
  if (guests > fleet.seats * fleetCount) throw new HttpError(400, `Jumlah peserta (${guests}) melebihi kapasitas ${fleetCount} × ${fleet.name} (${fleet.seats * fleetCount} kursi). Tambah jumlah armada atau pilih armada lebih besar.`);

  const price = quote(pkg, fleet, days, fleetCount); // harga dihitung server, bukan dari browser
  const booking = await update('bookings.json', [], async rows => {
    // Cek ketersediaan di dalam kunci yang sama dengan penulisan, supaya dua pemesan tidak bisa merebut unit terakhir bersamaan.
    const conflict = availabilityConflict(fleet, rows, await getBlocks(), date, days, fleetCount);
    if (conflict) throw new HttpError(409, conflict.message, { conflict });
    const id = newId(rows);
    const b = {
      id, customerName, customerPhone, customerEmail,
      packageId: pkg ? pkg.id : '', package: pkg ? pkg.name : 'Sewa armada saja',
      fleetId: fleet.id, fleet: fleet.name, fleetCount,
      date, days, guests, destination, price,
      status: 'Pending', paymentStatus: '', refunded: false,
      adminNotes: notes ? `Catatan pemesan: ${notes}` : '',
      createdAt: nowIso(), payments: [], timeline: []
    };
    b.paymentStatus = computePaymentStatus(b);
    addTimeline(b, 'Pemesanan diterima', `${fleetCount} × ${fleet.name}, ${longDate(date)}${days > 1 ? ` – ${longDate(addDays(date, days - 1))}` : ''}. ${price > 0 ? `Total estimasi Rp ${rupiah(price)}.` : 'Tim kami menyiapkan penawaran harga untuk perjalanan Anda.'}`);
    rows.push(b);
    return b;
  });
  res.status(201).json({ success: true, bookingCode: booking.id, code: booking.id, booking: publicBooking(booking) });
}));

function matchBooking(rows, code, phone) {
  const id = cleanText(code, 30).toUpperCase();
  const digits = String(phone || '').replace(/\D/g, '');
  const row = digits.length >= 4 ? rows.find(r => r.id === id) : null;
  if (!row || normalizePhone(row.customerPhone).slice(-4) !== digits.slice(-4)) throw new HttpError(404, 'Kode pemesanan atau nomor WhatsApp tidak cocok.');
  return row;
}
app.get('/api/track', limiter('track', 30, 10 * 60e3), asyncRoute(async (req, res) => {
  const rows = await readJson('bookings.json', []);
  res.json({ booking: publicBooking(matchBooking(rows, req.query.code, req.query.phone)) });
}));
app.post('/api/track/payments', limiter('pay', 20, 3600e3), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const settings = await readJson('settings.json', DEFAULT_SETTINGS);
  const method = body.method === 'qris' ? 'qris' : body.method === 'transfer' ? 'transfer' : null;
  if (!method) throw new HttpError(400, 'Pilih metode pembayaran.');
  if (method === 'transfer' && !(settings.banks || []).length) throw new HttpError(400, 'Rekening tujuan belum diatur. Hubungi kami via WhatsApp.');
  if (method === 'qris' && !(settings.qris && settings.qris.enabled && settings.qris.image)) throw new HttpError(400, 'Pembayaran QRIS belum tersedia.');
  const senderName = cleanText(body.senderName, 100);
  if (!senderName) throw new HttpError(400, 'Isi nama pengirim/pemilik rekening agar pembayaran mudah dicocokkan.');
  const { buf, ext } = decodeImage(body.proof, 4 * 1048576);

  const result = await update('bookings.json', [], async rows => {
    const b = matchBooking(rows, body.code, body.phone);
    if (['Dibatalkan', 'Selesai'].includes(b.status)) throw new HttpError(400, `Pemesanan berstatus ${b.status}, pembayaran tidak dapat ditambahkan.`);
    if (!(b.price > 0)) throw new HttpError(400, 'Harga belum ditetapkan. Tunggu penawaran dari tim kami.');
    if ((b.payments || []).some(p => p.status === 'Menunggu verifikasi')) throw new HttpError(409, 'Masih ada pembayaran yang menunggu verifikasi.');
    const outstanding = b.price - paidTotal(b);
    if (outstanding <= 0) throw new HttpError(400, 'Pemesanan ini sudah lunas.');
    const dp = Math.min(outstanding, Math.ceil((b.price * (Number(settings.dpPercent) || 50)) / 100 / 1000) * 1000);
    const amount = body.option === 'dp' && paidTotal(b) === 0 ? dp : outstanding;
    const file = `${b.id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    await fs.writeFile(path.join(PROOF_DIR, file), buf, { flag: 'wx' });
    try { await persist.save(`proofs/${file}`, buf); } catch (e) { await fs.rm(path.join(PROOF_DIR, file), { force: true }); throw e; }
    b.payments = b.payments || [];
    b.payments.push({
      id: `PAY-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, at: nowIso(), method,
      bank: cleanText(body.bank, 60), senderName, amount, status: 'Menunggu verifikasi', proof: file, note: ''
    });
    b.paymentStatus = computePaymentStatus(b);
    addTimeline(b, 'Bukti pembayaran diunggah', `Rp ${rupiah(amount)} via ${method === 'qris' ? 'QRIS' : 'transfer bank'} — menunggu verifikasi admin.`);
    return b;
  });
  res.status(201).json({ success: true, booking: publicBooking(result) });
}));

/* ---- simulasi pembayaran (hanya bila admin mengaktifkan Mode Demo) ---- */
app.post('/api/track/payments/demo', limiter('pay', 20, 3600e3), asyncRoute(async (req, res) => {
  const settings = await readJson('settings.json', DEFAULT_SETTINGS);
  if (!settings.demoPayment) throw new HttpError(403, 'Simulasi pembayaran sedang tidak aktif.');
  const result = await update('bookings.json', [], rows => {
    const b = matchBooking(rows, req.body?.code, req.body?.phone);
    if (['Dibatalkan', 'Selesai'].includes(b.status)) throw new HttpError(400, `Pemesanan berstatus ${b.status}, pembayaran tidak dapat ditambahkan.`);
    if (!(b.price > 0)) throw new HttpError(400, 'Harga belum ditetapkan.');
    if ((b.payments || []).some(p => p.status === 'Menunggu verifikasi')) throw new HttpError(409, 'Masih ada pembayaran yang menunggu verifikasi.');
    const outstanding = b.price - paidTotal(b);
    if (outstanding <= 0) throw new HttpError(400, 'Pemesanan ini sudah lunas.');
    const dp = Math.min(outstanding, Math.ceil((b.price * (Number(settings.dpPercent) || 50)) / 100 / 1000) * 1000);
    const amount = req.body?.option === 'dp' && paidTotal(b) === 0 ? dp : outstanding;
    b.payments = b.payments || [];
    b.payments.push({ id: `PAY-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, at: nowIso(), method: 'demo', demo: true, bank: '', senderName: 'Simulasi', amount, status: 'Terverifikasi', proof: '', note: 'Simulasi pembayaran (demo)' });
    b.paymentStatus = computePaymentStatus(b);
    addTimeline(b, 'Pembayaran simulasi (DEMO)', `Rp ${rupiah(amount)} — bukan pembayaran sungguhan.`);
    return b;
  });
  res.status(201).json({ success: true, booking: publicBooking(result) });
}));

/* ---- admin: login ---- */
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  if (loginBlocked(req.ip)) return res.status(429).json({ error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' });
  const username = cleanText(req.body?.username, 100);
  const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
  const ok = username === admin.username && await checkPassword(password, admin);
  if (!ok) { loginFailed(req.ip); return res.status(401).json({ error: 'Username atau kata sandi salah.' }); }
  loginFails.delete(req.ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(sha(token), { exp: Date.now() + SESSION_TTL });
  await persistSessions();
  res.json({ success: true, token, username: admin.username, mustChange: Boolean(admin.mustChange) });
}));
app.post('/api/auth/logout', adminAny, asyncRoute(async (req, res) => { sessions.delete(req.sessionKey); await persistSessions(); res.json({ success: true }); }));
app.get('/api/admin/me', adminAny, (_req, res) => res.json({ username: admin.username, mustChange: Boolean(admin.mustChange) }));
app.post('/api/admin/password', adminAny, asyncRoute(async (req, res) => {
  const current = typeof req.body?.current === 'string' ? req.body.current : '';
  const next = typeof req.body?.next === 'string' ? req.body.next : '';
  if (!(await checkPassword(current, admin))) throw new HttpError(400, 'Password saat ini salah.');
  if (next.length < 10 || next.length > 100) throw new HttpError(400, 'Password baru minimal 10 karakter.');
  if (next === current || next.toLowerCase() === 'lautansandi') throw new HttpError(400, 'Pilih password baru yang berbeda dan tidak mudah ditebak.');
  await withLock('admin.json', async () => {
    admin = { ...admin, ...(await hashPassword(next)), mustChange: false, changedAt: nowIso() };
    await writeJson('admin.json', admin);
  });
  for (const k of [...sessions.keys()]) if (k !== req.sessionKey) sessions.delete(k); // keluarkan sesi lain
  await persistSessions();
  res.json({ success: true });
}));

/* ---- admin: pemesanan ---- */
app.get('/api/bookings', adminOnly, asyncRoute(async (req, res) => {
  let rows = await readJson('bookings.json', []);
  const status = cleanText(req.query.status, 40);
  const query = cleanText(req.query.q || req.query.search, 120).toLocaleLowerCase('id');
  if (status && status !== 'Semua') rows = rows.filter(r => r.status === status);
  if (query) rows = rows.filter(r => [r.id, r.customerName, r.customerPhone, r.customerEmail, r.package, r.fleet, r.date].some(v => String(v || '').toLocaleLowerCase('id').includes(query)));
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ bookings: rows.map(adm), total: rows.length });
}));
app.patch('/api/bookings/:id', adminOnly, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const fleets = await getFleet();
  const booking = await update('bookings.json', [], async rows => {
    const b = findBooking(rows, req.params.id);
    const before = { status: b.status, fleetId: b.fleetId, date: b.date, days: b.days, fleetCount: b.fleetCount };
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) throw new HttpError(400, 'Status tidak dikenal.');
      if (b.status !== body.status) { b.status = body.status; addTimeline(b, STATUS_LABEL[body.status]); }
    }
    if (body.adminNotes !== undefined) b.adminNotes = cleanText(body.adminNotes, 2000);
    if (body.price !== undefined) {
      const price = toInt(body.price, 0, 10_000_000_000, null);
      if (price === null) throw new HttpError(400, 'Harga tidak valid.');
      if (price !== b.price) { b.price = price; addTimeline(b, 'Harga diperbarui', price > 0 ? `Total: Rp ${rupiah(price)}.` : 'Harga sedang disiapkan.', 'admin'); }
    }
    if (body.fleetId !== undefined) {
      if (body.fleetId === '') { b.fleetId = ''; b.fleet = 'Belum ditentukan'; }
      else {
        const f = fleets.find(x => x.id === body.fleetId);
        if (!f) throw new HttpError(400, 'Armada tidak ditemukan.');
        if (b.fleetId !== f.id) { b.fleetId = f.id; b.fleet = f.name; addTimeline(b, 'Armada ditetapkan', f.name, 'admin'); }
      }
    }
    if (body.date !== undefined) { if (!validDate(body.date)) throw new HttpError(400, 'Tanggal tidak valid.'); if (b.date !== body.date) { b.date = body.date; addTimeline(b, 'Tanggal keberangkatan diubah', longDate(body.date), 'admin'); } }
    if (body.guests !== undefined) { const g = toInt(body.guests, 1, 500, null); if (!g) throw new HttpError(400, 'Jumlah peserta tidak valid.'); b.guests = g; }
    if (body.days !== undefined) { const d = toInt(body.days, 1, 30, null); if (!d) throw new HttpError(400, 'Jumlah hari tidak valid.'); b.days = d; }
    if (body.fleetCount !== undefined) { const c = toInt(body.fleetCount, 1, 20, null); if (!c) throw new HttpError(400, 'Jumlah armada tidak valid.'); b.fleetCount = c; }
    if (body.refunded !== undefined) { b.refunded = Boolean(body.refunded); if (b.refunded) addTimeline(b, 'Dana dikembalikan', '', 'admin'); }
    // Periksa ketersediaan bila hal yang memengaruhi jadwal berubah (atau pesanan dibatalkan lalu diaktifkan lagi).
    const scheduleChanged = ['fleetId', 'date', 'days', 'fleetCount'].some(k => before[k] !== b[k]) || (before.status === 'Dibatalkan' && b.status !== 'Dibatalkan');
    if (scheduleChanged && b.fleetId && isActiveStatus(b.status) && validDate(b.date) && !body.force) {
      const f = fleets.find(x => x.id === b.fleetId);
      const conflict = f && availabilityConflict(f, rows, await getBlocks(), b.date, Math.max(1, Number(b.days) || 1), Math.max(1, Number(b.fleetCount) || 1), b.id);
      if (conflict) throw new HttpError(409, conflict.message, { conflict });
    }
    if (before.status === 'Dibatalkan' && b.status !== 'Dibatalkan') { b.autoCancelExempt = true; b.dpForfeited = false; } // admin mengaktifkan lagi: jangan dibatalkan otomatis lagi
    b.paymentStatus = computePaymentStatus(b);
    return b;
  });
  res.json({ booking: adm(booking) });
}));
app.post('/api/bookings/:id/timeline', adminOnly, asyncRoute(async (req, res) => {
  const label = cleanText(req.body?.label, 80) || 'Update perjalanan';
  const note = cleanText(req.body?.note, 300);
  if (!note) throw new HttpError(400, 'Tulis isi update untuk pelanggan.');
  const booking = await update('bookings.json', [], rows => { const b = findBooking(rows, req.params.id); addTimeline(b, label, note, 'admin'); return b; });
  res.json({ booking: adm(booking) });
}));
app.post('/api/bookings/:id/payments', adminOnly, asyncRoute(async (req, res) => {
  const amount = toInt(req.body?.amount, 1, 10_000_000_000, null);
  if (!amount) throw new HttpError(400, 'Nominal pembayaran tidak valid.');
  const method = ['tunai', 'transfer', 'qris', 'lainnya'].includes(req.body?.method) ? req.body.method : 'lainnya';
  const booking = await update('bookings.json', [], rows => {
    const b = findBooking(rows, req.params.id);
    b.payments = b.payments || [];
    b.payments.push({ id: `PAY-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, at: nowIso(), method, bank: '', senderName: '', amount, status: 'Terverifikasi', proof: '', note: cleanText(req.body?.note, 200) });
    b.paymentStatus = computePaymentStatus(b);
    addTimeline(b, 'Pembayaran dicatat', `Rp ${rupiah(amount)} (${method}).`, 'admin');
    return b;
  });
  res.status(201).json({ booking: adm(booking) });
}));
app.patch('/api/bookings/:id/payments/:pid', adminOnly, asyncRoute(async (req, res) => {
  const status = req.body?.status;
  if (!['Terverifikasi', 'Ditolak'].includes(status)) throw new HttpError(400, 'Status pembayaran harus Terverifikasi atau Ditolak.');
  const booking = await update('bookings.json', [], rows => {
    const b = findBooking(rows, req.params.id);
    const p = (b.payments || []).find(x => x.id === req.params.pid);
    if (!p) throw new HttpError(404, 'Data pembayaran tidak ditemukan.');
    p.status = status; p.note = cleanText(req.body?.note, 200); p.decidedAt = nowIso();
    b.paymentStatus = computePaymentStatus(b);
    addTimeline(b, status === 'Terverifikasi' ? 'Pembayaran diverifikasi' : 'Pembayaran ditolak', status === 'Terverifikasi' ? `Rp ${rupiah(p.amount)} diterima.` : (p.note || 'Bukti pembayaran belum sesuai, silakan unggah ulang.'), 'admin');
    return b;
  });
  res.json({ booking: adm(booking) });
}));
app.delete('/api/bookings/:id', adminOnly, asyncRoute(async (req, res) => {
  const deleted = await update('bookings.json', [], rows => {
    const i = rows.findIndex(r => r.id === req.params.id);
    if (i < 0) throw new HttpError(404, 'Pemesanan tidak ditemukan.');
    return rows.splice(i, 1)[0];
  });
  for (const p of deleted.payments || []) if (p.proof && /^[\w-]+\.(jpg|png|webp)$/.test(p.proof)) { await fs.rm(path.join(PROOF_DIR, p.proof), { force: true }); await persist.remove(`proofs/${p.proof}`).catch(() => {}); }
  res.json({ success: true, booking: deleted });
}));
app.get('/api/admin/proofs/:file', adminOnly, (req, res, next) => {
  if (!/^[\w-]+\.(jpg|png|webp)$/.test(req.params.file)) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(req.params.file, { root: PROOF_DIR, dotfiles: 'deny' }, err => { if (err) next(err.code === 'ENOENT' ? new HttpError(404, 'Berkas tidak ditemukan.') : err); });
});
app.get('/api/stats', adminOnly, asyncRoute(async (_req, res) => {
  const rows = await readJson('bookings.json', []);
  const active = rows.filter(r => r.status !== 'Dibatalkan');
  const statusCounts = Object.fromEntries(STATUSES.map(s => [s, rows.filter(r => r.status === s).length]));
  const fleetUsage = {};
  for (const r of active) if (r.fleet && r.fleet !== 'Belum ditentukan') fleetUsage[r.fleet] = (fleetUsage[r.fleet] || 0) + 1;
  res.json({
    totalBookings: rows.length, statusCounts, fleetUsage, fleetUsed: Object.keys(fleetUsage).length,
    revenueEstimate: active.reduce((s, r) => s + (Number(r.price) || 0), 0),
    revenueVerified: rows.reduce((s, r) => s + (r.payments || []).filter(p => p.status === 'Terverifikasi' && !p.demo).reduce((t, p) => t + (Number(p.amount) || 0), 0), 0),
    pendingPayments: rows.reduce((s, r) => s + (r.payments || []).filter(p => p.status === 'Menunggu verifikasi').length, 0),
    awaitingQuote: active.filter(r => !(r.price > 0)).length
  });
}));

/* ---- admin: kalender & blokir tanggal ---- */
app.get('/api/admin/calendar', adminOnly, asyncRoute(async (req, res) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.month || ''));
  if (!m || +m[2] < 1 || +m[2] > 12) throw new HttpError(400, 'Bulan harus berformat YYYY-MM.');
  const from = `${m[1]}-${m[2]}-01`;
  const to = addDays(fmtD(Date.UTC(+m[1], +m[2], 1)), -1); // hari terakhir bulan itu
  const [fleets, bookings, blocks] = await Promise.all([getFleet(), readJson('bookings.json', []), getBlocks()]);
  const inRange = (s, e) => !(e < from || s > to);
  res.json({
    from, to, today: todayWib(),
    fleets: fleets.sort(byOrder).map(f => ({ id: f.id, name: f.name, seats: f.seats, units: fleetUnits(f), active: f.active !== false })),
    bookings: bookings.filter(b => b.fleetId && isActiveStatus(b.status) && validDate(b.date) && inRange(b.date, addDays(b.date, Math.max(1, Number(b.days) || 1) - 1)))
      .map(b => ({ id: b.id, customerName: b.customerName, fleetId: b.fleetId, fleetCount: b.fleetCount || 1, date: b.date, days: b.days || 1, guests: b.guests, status: b.status, package: b.package, paymentStatus: b.paymentStatus })),
    blocks: blocks.filter(k => inRange(k.from, k.to))
  });
}));
app.get('/api/admin/blocks', adminOnly, asyncRoute(async (_req, res) => {
  res.json({ items: (await getBlocks()).sort((a, b) => a.from.localeCompare(b.from)) });
}));
app.post('/api/admin/blocks', adminOnly, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const fleets = await getFleet();
  const fleet = fleets.find(f => f.id === b.fleetId);
  if (!fleet) throw new HttpError(400, 'Pilih armada yang akan diblokir.');
  if (!validDate(b.from) || !validDate(b.to) || b.to < b.from) throw new HttpError(400, 'Tanggal mulai/selesai tidak valid.');
  if (dayDiff(b.from, b.to) + 1 > 366) throw new HttpError(400, 'Rentang blokir maksimal 366 hari.');
  const units = toInt(b.units ?? 1, 1, fleetUnits(fleet), null);
  if (!units) throw new HttpError(400, `Jumlah unit harus 1–${fleetUnits(fleet)}.`);
  const item = await update('blocks.json', [], rows => {
    const k = { id: `BLK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, fleetId: fleet.id, from: b.from, to: b.to, units, note: cleanText(b.note, 200), createdAt: nowIso() };
    rows.push(k);
    return k;
  });
  res.status(201).json({ item });
}));
app.delete('/api/admin/blocks/:id', adminOnly, asyncRoute(async (req, res) => {
  await update('blocks.json', [], rows => {
    const i = rows.findIndex(r => r.id === req.params.id);
    if (i < 0) throw new HttpError(404, 'Blokir tidak ditemukan.');
    rows.splice(i, 1);
  });
  res.json({ success: true });
}));

/* ---- admin: paket & armada ---- */
function packageFromBody(body, existing = {}, fleets = []) {
  const name = cleanText(body.name ?? existing.name, 120);
  if (!name) throw new HttpError(400, 'Nama paket wajib diisi.');
  let fleetOptions = existing.fleetOptions || [];
  if (body.fleetOptions !== undefined) {
    if (!Array.isArray(body.fleetOptions)) throw new HttpError(400, 'Pilihan armada tidak valid.');
    fleetOptions = [];
    for (const o of body.fleetOptions) {
      if (!fleets.some(f => f.id === o?.fleetId)) throw new HttpError(400, 'Ada armada pada paket yang tidak ditemukan.');
      if (fleetOptions.some(x => x.fleetId === o.fleetId)) continue;
      const price = toInt(o.price ?? 0, 0, 10_000_000_000, null);
      if (price === null) throw new HttpError(400, 'Harga paket untuk salah satu armada tidak valid.');
      fleetOptions.push({ fleetId: o.fleetId, price });
    }
  }
  if (!fleetOptions.length) throw new HttpError(400, 'Pilih minimal satu armada yang termasuk dalam paket ini.');
  const days = body.days === undefined ? toInt(existing.days, 1, 30, 1) : toInt(body.days, 1, 30, null);
  if (!days) throw new HttpError(400, 'Lama paket harus 1–30 hari.');
  const { price: _legacy, ...rest } = existing;
  return {
    ...rest, name, days, fleetOptions,
    image: body.image === undefined ? (existing.image || '') : imagePath(body.image),
    tag: cleanText(body.tag ?? existing.tag, 30),
    destinations: cleanText(body.destinations ?? existing.destinations, 160),
    duration: cleanText(body.duration ?? existing.duration, 60) || `${days} Hari`,
    facilities: cleanText(body.facilities ?? existing.facilities, 80),
    itinerary: body.itinerary === undefined ? (existing.itinerary || []) : cleanList(body.itinerary, 20, 300),
    includes: body.includes === undefined ? (existing.includes || []) : cleanList(body.includes, 20, 200),
    terms: body.terms === undefined ? (existing.terms || []) : cleanList(body.terms, 20, 300),
    active: body.active === undefined ? existing.active !== false : Boolean(body.active),
    order: body.order === undefined ? (existing.order ?? 99) : toInt(body.order, 0, 999, 99)
  };
}
function fleetFromBody(body, existing = {}) {
  const name = cleanText(body.name ?? existing.name, 120);
  if (!name) throw new HttpError(400, 'Nama armada wajib diisi.');
  const seats = body.seats === undefined ? existing.seats : toInt(body.seats, 1, 100, null);
  if (!seats) throw new HttpError(400, 'Jumlah kursi harus 1–100.');
  const units = body.units === undefined ? fleetUnits(existing) : toInt(body.units, 1, 200, null);
  if (!units) throw new HttpError(400, 'Jumlah unit armada harus 1–200.');
  const pricePerDay = body.pricePerDay === undefined ? (existing.pricePerDay || 0) : toInt(body.pricePerDay, 0, 10_000_000_000, null);
  if (pricePerDay === null) throw new HttpError(400, 'Tarif per hari tidak valid.');
  return {
    ...existing, name, seats, units, pricePerDay,
    image: body.image === undefined ? (existing.image || '') : imagePath(body.image),
    features: body.features === undefined ? (existing.features || []) : cleanList(body.features, 12, 40),
    active: body.active === undefined ? existing.active !== false : Boolean(body.active),
    order: body.order === undefined ? (existing.order ?? 99) : toInt(body.order, 0, 999, 99)
  };
}
/** CRUD generik. `build(body, existing, ctx)` memvalidasi; `ctx` memuat armada saat ini. */
function crud(route, file, fallback, build, notFound, { onDelete } = {}) {
  app.get(`/api/admin/${route}`, adminOnly, asyncRoute(async (_req, res) => {
    const rows = await readJson(file, fallback);
    res.json({ items: (route === 'packages' ? await getPackages() : rows.map(f => ({ ...f, units: fleetUnits(f) }))).sort(byOrder) });
  }));
  app.post(`/api/admin/${route}`, adminOnly, asyncRoute(async (req, res) => {
    const fleets = await getFleet();
    const item = await update(file, fallback, rows => {
      const built = build(req.body || {}, {}, fleets);
      built.id = uniqueId(slugify(built.name), rows);
      rows.push(built);
      return built;
    });
    res.status(201).json({ item });
  }));
  app.put(`/api/admin/${route}/:id`, adminOnly, asyncRoute(async (req, res) => {
    const fleets = await getFleet();
    const item = await update(file, fallback, rows => {
      const i = rows.findIndex(r => r.id === req.params.id);
      if (i < 0) throw new HttpError(404, notFound);
      rows[i] = build(req.body || {}, route === 'packages' ? normPackage(rows[i], fleets) : rows[i], fleets);
      return rows[i];
    });
    res.json({ item });
  }));
  app.delete(`/api/admin/${route}/:id`, adminOnly, asyncRoute(async (req, res) => {
    await update(file, fallback, rows => {
      const i = rows.findIndex(r => r.id === req.params.id);
      if (i < 0) throw new HttpError(404, notFound);
      rows.splice(i, 1);
    });
    if (onDelete) await onDelete(req.params.id);
    res.json({ success: true });
  }));
}
crud('packages', 'packages.json', DEFAULT_PACKAGES, packageFromBody, 'Paket tidak ditemukan.');
crud('fleet', 'fleet.json', DEFAULT_FLEET, fleetFromBody, 'Armada tidak ditemukan.', {
  onDelete: async id => { await update('blocks.json', [], rows => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].fleetId === id) rows.splice(i, 1); }); }
});

/* ---- admin: pengaturan & unggah gambar ---- */
app.put('/api/admin/settings', adminOnly, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const banks = (Array.isArray(b.banks) ? b.banks : []).slice(0, 6).map(x => ({
    bank: cleanText(x?.bank, 60), number: cleanText(x?.number, 40).replace(/[^\d .\-]/g, ''), holder: cleanText(x?.holder, 80)
  })).filter(x => x.bank && x.number && x.holder);
  const wa = normalizePhone(b.waNumber);
  if (wa && (wa.length < 10 || wa.length > 15)) throw new HttpError(400, 'Nomor WhatsApp tidak valid.');
  const email = cleanText(b.email, 180);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Format email tidak valid.');
  const qrisImage = imagePath(b.qris?.image);
  const settings = await update('settings.json', DEFAULT_SETTINGS, current => {
    Object.assign(current, {
      waNumber: wa || current.waNumber, phoneDisplay: cleanText(b.phoneDisplay, 40), email, address: cleanText(b.address, 200),
      dpPercent: toInt(b.dpPercent, 10, 100, 50), paymentNote: cleanText(b.paymentNote, 500), banks, demoPayment: Boolean(b.demoPayment), autoCancel: b.autoCancel !== false,
      qris: { enabled: Boolean(b.qris?.enabled) && Boolean(qrisImage), image: qrisImage }
    });
    return current;
  });
  res.json({ settings });
}));
app.post('/api/admin/upload', adminOnly, asyncRoute(async (req, res) => {
  const { buf, ext } = decodeImage(req.body?.image, 5 * 1048576);
  const file = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, file), buf, { flag: 'wx' });
  try { await persist.save(`uploads/${file}`, buf); } catch (e) { await fs.rm(path.join(UPLOAD_DIR, file), { force: true }); throw e; }
  res.status(201).json({ url: `/uploads/${file}` });
}));

app.get('/api/admin/storage', adminOnly, (_req, res) => res.json({ persistent: persist.enabled }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint API tidak ditemukan.' }));

/* ---- berkas statis ---- */
const staticHeaders = (res, file) => { res.setHeader('Cache-Control', /\.(webp|png|jpe?g|svg|ico)$/i.test(file) ? 'public, max-age=604800' : 'no-cache'); };
app.use('/uploads', express.static(UPLOAD_DIR, { index: false, dotfiles: 'deny', setHeaders: staticHeaders }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], dotfiles: 'deny', setHeaders: staticHeaders }));
app.use((req, res) => {
  if (req.accepts('html')) return res.status(404).sendFile(path.join(ROOT, 'public', '404.html'));
  res.status(404).end();
});
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Ukuran data terlalu besar.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Format data tidak valid.' });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
});

/* ---------------------------------------------------------------- start */
/** Data dari versi lama (satu berkas bookings.json sederhana) dilengkapi agar cocok dengan struktur baru. */
async function migrate() {
  await update('bookings.json', [], rows => {
    for (const b of rows) {
      if (Array.isArray(b.payments)) continue;
      b.payments = [];
      b.days = b.days || 1; b.fleetCount = b.fleetCount || 1; b.refunded = b.refunded || false;
      if (b.paymentStatus && b.paymentStatus !== 'Menunggu pembayaran') b.legacyPayment = b.paymentStatus;
      b.timeline = [{ at: b.createdAt || nowIso(), label: 'Pemesanan diterima', note: 'Data dari versi sebelumnya.', by: 'sistem' }];
      if (b.status && b.status !== 'Pending') b.timeline.push({ at: nowIso(), label: STATUS_LABEL[b.status] || b.status, note: '', by: 'sistem' });
      b.paymentStatus = computePaymentStatus(b);
    }
  });
}
async function boot() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await persist.init(DATA_DIR);
  await fs.mkdir(PROOF_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  for (const [file, value] of [['packages.json', DEFAULT_PACKAGES], ['fleet.json', DEFAULT_FLEET], ['settings.json', DEFAULT_SETTINGS], ['bookings.json', []], ['blocks.json', []]]) {
    try { await fs.access(path.join(DATA_DIR, file)); } catch { await writeJson(file, value); }
  }
  await migrate();
  await ensureAdmin();
  await sweepOverdue().catch(e => console.error('sweep gagal:', e.message));
  setInterval(() => sweepOverdue().catch(e => console.error('sweep gagal:', e.message)), 10 * 60e3).unref();
  const saved = await readJson('sessions.json', {});
  const now = Date.now();
  for (const [k, v] of Object.entries(saved)) if (v && v.exp > now) sessions.set(k, v);
  app.listen(PORT, HOST, () => console.log(`Lautan Pasir berjalan di http://${HOST}:${PORT}  (data: ${DATA_DIR})`));
}
boot().catch(error => { console.error('Gagal memulai server:', error); process.exit(1); });
