# Membuka Lautan Pasir ke Internet (lautanpasirtourandtravel.com)

## 1. Domain
Domain **tidak gratis** dan belum terdaftar. Beli di registrar (mis. Niagahoster,
Rumahweb, Namecheap, Cloudflare Registrar; `.com` sekitar Rp150–250 ribu/tahun).
Cek dulu apakah `lautanpasirtourandtravel.com` masih tersedia. Alternatif gratis
sementara: subdomain dari hosting/tunnel (mis. Cloudflare Tunnel), tapi bukan domain sendiri.

## 2. Server (pilih salah satu)
**A. VPS (disarankan)** – Ubuntu 22/24, 1 vCPU/1 GB cukup (Rp50–100 ribu/bulan).
**B. PaaS** (Railway, Render, Fly.io) – pastikan ada *persistent disk/volume*
   untuk folder data, dan set `DATA_DIR` ke path volume itu.
Situs ini menyimpan data dalam berkas JSON, jadi jalankan **satu instans saja**.

## 3. Pasang di VPS
```bash
sudo apt update && sudo apt install -y nodejs npm caddy   # Node 20+ (bila lama, pakai nodesource)
sudo mkdir -p /opt/lautan-pasir && sudo chown $USER /opt/lautan-pasir
# unggah isi zip ke /opt/lautan-pasir (scp/sftp), lalu:
cd /opt/lautan-pasir && npm install --omit=dev
```
Buat `/etc/systemd/system/lautan-pasir.service`:
```ini
[Unit]
Description=Lautan Pasir
After=network.target
[Service]
WorkingDirectory=/opt/lautan-pasir
Environment=PORT=3000 HOST=127.0.0.1 TRUST_PROXY=1 DATA_DIR=/var/lib/lautan-pasir
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
```
```bash
sudo mkdir -p /var/lib/lautan-pasir && sudo chown www-data /var/lib/lautan-pasir
sudo systemctl enable --now lautan-pasir
sudo journalctl -u lautan-pasir | grep -A3 "AKUN ADMIN"   # password admin awal (sekali)
```

## 4. HTTPS + domain dengan Caddy
Di DNS registrar, buat record **A** `@` dan `www` → IP VPS. Lalu `/etc/caddy/Caddyfile`:
```
lautanpasirtourandtravel.com, www.lautanpasirtourandtravel.com {
    reverse_proxy 127.0.0.1:3000
}
```
`sudo systemctl reload caddy` — sertifikat HTTPS dibuat otomatis.

## 5. Sebelum diumumkan
- Login `/admin/`, ganti password, isi unit armada, harga, rekening/QRIS, WhatsApp.
- Uji satu pemesanan sampai pembayaran, dari HP.
- Backup rutin folder data (mis. cron `tar` ke penyimpanan lain).
- Jangan pakai skrip lama `seikouverse.com/lautan-pasir.ps1` untuk server.

---

# Alternatif cepat: SnapDeploy (tanpa server sendiri)

Aplikasi ini sudah siap untuk SnapDeploy: membaca `PORT` dari platform, mendengarkan di
`0.0.0.0`, punya `/api/health`, dan `npm start` menjalankan `server.js`.
**Satu-satunya variabel yang perlu diisi: `ADMIN_USER` dan `ADMIN_PASSWORD`** (min. 10 karakter).
`PORT`/`HOST` diatur otomatis oleh SnapDeploy; jangan diisi.

1. Buat repo GitHub dan unggah isi folder ini (`.gitignore` sudah menyingkirkan `node_modules`, `data`, `.env`).
2. snapdeploy.dev → Deploy from GitHub → pilih repo & branch.
3. Di layar "Environment Variables", isi hanya `ADMIN_USER` dan `ADMIN_PASSWORD`. Deploy.
4. Buka URL yang diberikan, login ke `/admin/` dengan akun tadi, lalu isi unit armada, harga, rekening/QRIS.

Perlu diperhatikan:
- **Paket gratis tertidur** setelah 15 menit tanpa kunjungan (bangun ±60 detik). **Domain sendiri
  mensyaratkan paket Always-On** (sekitar $12/bulan per container). Untuk bisnis, pakai Always-On.
- **Penyimpanan data:** data (pemesanan, bukti bayar, foto) disimpan di disk container. Dokumentasi SnapDeploy
  yang saya baca tidak menyebut penyimpanan permanen, jadi **pastikan dulu** apakah disk bertahan setelah
  redeploy/restart (tanya support atau uji: buat pemesanan, deploy ulang, cek masih ada). Bila tidak
  bertahan, pemesanan bisa hilang saat deploy ulang, dan di situasi itu lebih aman memakai VPS (bagian atas).
- `ADMIN_PASSWORD` hanya dipakai saat akun admin pertama dibuat. Ganti password lewat tab Akun.
