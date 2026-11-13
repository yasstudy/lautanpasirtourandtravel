const express = require('express');
const cors = require('cors');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bookings.json');
// Payment configuration: BANK_NAME, BANK_ACCOUNT_NUMBER, BANK_ACCOUNT_HOLDER
const BANK_NAME = process.env.BANK_NAME || 'BCA';
const BANK_ACCOUNT_NUMBER = process.env.BANK_ACCOUNT_NUMBER || '5047811161';
const BANK_ACCOUNT_HOLDER = process.env.BANK_ACCOUNT_HOLDER || 'Lautan Pasir Tour & Travel';
const paymentInfo = { bankName: BANK_NAME, accountNumber: BANK_ACCOUNT_NUMBER, accountHolder: BANK_ACCOUNT_HOLDER, deadlineHours: 24, whatsapp: '6282234567890' };
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'lautansandi';
const sessions = new Set();

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(ROOT, 'public')));

const seed = [
  { id: 'LP-202610-1001', customerName: 'Rina Prameswari', customerPhone: '6281234567801', customerEmail: 'rina@example.com', package: 'Bromo Sunrise', date: '2026-11-08', guests: 2, price: 850000, status: 'Dikonfirmasi', paymentStatus: 'Lunas', adminNotes: '', createdAt: '2026-10-23T08:30:00.000Z', fleet: 'Jeep 01' },
  { id: 'LP-202610-1002', customerName: 'Dimas Saputra', customerPhone: '6281234567802', customerEmail: 'dimas@example.com', package: 'Midnight', date: '2026-11-12', guests: 3, price: 1050000, status: 'Pending', paymentStatus: 'Menunggu pembayaran', adminNotes: '', createdAt: '2026-10-24T11:15:00.000Z', fleet: 'Jeep 02' },
  { id: 'LP-202610-1003', customerName: 'Nadia Putri', customerPhone: '6281234567803', customerEmail: 'nadia@example.com', package: 'Jeep Adventure', date: '2026-10-28', guests: 4, price: 1400000, status: 'Selesai', paymentStatus: 'Lunas', adminNotes: 'Perjalanan selesai dengan baik.', createdAt: '2026-10-19T05:45:00.000Z', fleet: 'Jeep 03' },
  { id: 'LP-202610-1004', customerName: 'Arif Wicaksono', customerPhone: '6281234567804', customerEmail: 'arif@example.com', package: 'Bromo Milky Way', date: '2026-11-15', guests: 2, price: 1250000, status: 'Dibatalkan', paymentStatus: 'Dikembalikan', adminNotes: '', createdAt: '2026-10-22T14:05:00.000Z', fleet: 'Jeep 01' },
  { id: 'LP-202610-1005', customerName: 'Siti Rahma', customerPhone: '6281234567805', customerEmail: 'siti@example.com', package: 'Bromo Sunrise', date: '2026-11-20', guests: 5, price: 2125000, status: 'Pending', paymentStatus: 'DP', adminNotes: 'Menunggu konfirmasi jumlah peserta.', createdAt: '2026-10-26T09:20:00.000Z', fleet: 'Jeep 02' }
];

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(DATA_FILE); }
  catch { await fs.writeFile(DATA_FILE, `${JSON.stringify(seed, null, 2)}\n`, { flag: 'wx' }); }
}
async function readBookings() {
  await ensureStore();
  const rows = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('Booking store must be a JSON array');
  return rows;
}
async function writeBookings(rows) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(rows, null, 2)}\n`);
  await fs.rename(temp, DATA_FILE);
}
function cleanText(value, max = 300) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function newId(rows) {
  const now = new Date();
  const prefix = `LP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  let id;
  do { id = prefix + crypto.randomInt(0, 10000).toString().padStart(4, '0'); } while (rows.some(row => row.id === id));
  return id;
}
function requireAdmin(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Sesi admin tidak valid atau telah berakhir.' });
  next();
}
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

app.post('/api/auth/login', (req, res) => {
  const username = cleanText(req.body?.username, 100);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Username atau kata sandi salah.' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.add(token);
  res.json({ success: true, token, username });
});

app.get('/api/bookings', requireAdmin, asyncRoute(async (req, res) => {
  let rows = await readBookings();
  const status = cleanText(req.query.status, 40);
  const query = cleanText(req.query.q || req.query.search, 120).toLocaleLowerCase('id');
  if (status && status !== 'Semua') rows = rows.filter(row => row.status === status);
  if (query) rows = rows.filter(row => [row.id, row.customerName, row.customerPhone, row.customerEmail, row.package, row.date].some(value => String(value || '').toLocaleLowerCase('id').includes(query)));
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ bookings: rows, total: rows.length });
}));

app.get('/api/payment-info', (_req, res) => res.json(paymentInfo));

app.get('/api/invoice/:id', asyncRoute(async (req, res) => {
  const phone = String(req.query.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'Nomor WhatsApp wajib diisi.' });
  const rows = await readBookings();
  const booking = rows.find(row => row.id === req.params.id);
  const stored = String(booking?.customerPhone || '').replace(/\D/g, '');
  if (!booking || stored.slice(-9) !== phone.slice(-9)) return res.status(404).json({ error: 'Invoice tidak ditemukan.' });
  res.json({ booking, payment: paymentInfo });
}));

app.post('/api/bookings', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const customerName = cleanText(body.customerName || body.name, 120);
  const customerPhone = cleanText(body.customerPhone || body.phone, 30).replace(/[\s()+-]/g, '');
  const customerEmail = cleanText(body.customerEmail || body.email, 180);
  const packageName = cleanText(body.package || body.packageName || body.service, 100);
  const dateStr = body.date || body.departureDate;
  const guests = Number(body.guests || body.participants || body.people || 1);
  let price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) {
    // Estimasi harga default berdasarkan paket atau armada
    if (/yogyakarta/i.test(packageName)) price = 850000;
    else if (/dieng/i.test(packageName)) price = 750000;
    else if (/keluarga/i.test(packageName)) price = 950000;
    else if (/jakarta/i.test(packageName)) price = 1100000;
    else if (/medium/i.test(packageName)) price = 2500000;
    else if (/big bus/i.test(packageName)) price = 3500000;
    else price = 500000;
  }
  // Sewa armada dihitung per unit; paket wisata per orang.
  const isFleet = /bus|armada|hiace|elf/i.test(packageName);
  const destination = cleanText(body.destination, 200);
  const notes = cleanText(body.notes, 500);

  if (!customerName || customerPhone.length < 9 || !packageName || !validDate(dateStr) || !Number.isInteger(guests) || guests < 1 || guests > 100) {
    return res.status(400).json({ error: 'Data wajib tidak valid. Pastikan nama, nomor telepon/WhatsApp, paket/armada, tanggal berangkat, dan jumlah peserta sudah terisi dengan benar.' });
  }

  const rows = await readBookings();
  const id = newId(rows);
  const booking = {
    id,
    customerName,
    customerPhone,
    customerEmail,
    package: packageName,
    date: dateStr,
    guests,
    price,
    priceUnit: isFleet ? 'unit' : 'orang',
    total: isFleet ? price : price * guests,
    destination,
    status: 'Pending',
    paymentStatus: 'Menunggu pembayaran',
    adminNotes: notes ? `Catatan pemesan: ${notes}` : '',
    createdAt: new Date().toISOString(),
    fleet: cleanText(body.fleet, 60) || 'Belum ditentukan'
  };
  rows.push(booking);
  await writeBookings(rows);
  res.status(201).json({ success: true, booking, bookingCode: id, code: id, total: booking.total, payment: paymentInfo });
}));

app.patch('/api/bookings/:id', requireAdmin, asyncRoute(async (req, res) => {
  const rows = await readBookings();
  const row = rows.find(item => item.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Pemesanan tidak ditemukan.' });
  const body = req.body || {};
  if (body.status !== undefined) {
    if (!['Pending', 'Dikonfirmasi', 'Selesai', 'Dibatalkan'].includes(body.status)) return res.status(400).json({ error: 'Status tidak dikenal.' });
    row.status = body.status;
  }
  if (body.paymentStatus !== undefined) {
    const value = cleanText(body.paymentStatus, 60);
    if (!value) return res.status(400).json({ error: 'Status pembayaran tidak boleh kosong.' });
    row.paymentStatus = value;
  }
  if (body.adminNotes !== undefined) row.adminNotes = cleanText(body.adminNotes, 2000);
  await writeBookings(rows);
  res.json({ booking: row });
}));

app.delete('/api/bookings/:id', requireAdmin, asyncRoute(async (req, res) => {
  const rows = await readBookings();
  const index = rows.findIndex(item => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Pemesanan tidak ditemukan.' });
  const [deleted] = rows.splice(index, 1);
  await writeBookings(rows);
  res.json({ success: true, booking: deleted });
}));

app.get('/api/stats', requireAdmin, asyncRoute(async (_req, res) => {
  const rows = await readBookings();
  const active = rows.filter(row => row.status !== 'Dibatalkan');
  const statusCounts = Object.fromEntries(['Pending', 'Dikonfirmasi', 'Selesai', 'Dibatalkan'].map(status => [status, rows.filter(row => row.status === status).length]));
  const fleetUsage = {};
  for (const row of active) if (row.fleet && row.fleet !== 'Belum ditentukan') fleetUsage[row.fleet] = (fleetUsage[row.fleet] || 0) + 1;
  const revenueEstimate = active.reduce((sum, row) => sum + (Number(row.total ?? row.price) || 0), 0);
  res.json({ totalBookings: rows.length, revenueEstimate, statusCounts, fleetUsage, fleetUsed: Object.keys(fleetUsage).length });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint API tidak ditemukan.' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
});

ensureStore().then(() => app.listen(PORT, () => console.log(`Lautan Pasir API listening on port ${PORT}`))).catch(error => {
  console.error('Gagal menyiapkan penyimpanan booking:', error);
  process.exit(1);
});
