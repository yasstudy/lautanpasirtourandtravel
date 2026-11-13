LAUTAN PASIR TOUR & TRAVEL - Website, pemesanan, pembayaran & panel admin
=========================================================================

JALANKAN DI KOMPUTER (Windows)
1. Pasang Node.js 20 atau lebih baru (nodejs.org), lalu klik 2x "start.bat".
2. Saat PERTAMA kali jalan, jendela hitam menampilkan username & password admin
   (hanya sekali). Catat, lalu login di http://localhost:3000/admin/
   dan ganti password saat diminta.
3. Jangan tutup jendela hitam selama web dipakai.

FITUR
- Beranda, Paket Wisata, Armada, Cara Pesan, Lacak Pesanan (halaman terpisah).
- Paket wisata sudah termasuk armada. Pelanggan memilih armada sesuai kapasitas
  (jumlah bus dihitung otomatis dari jumlah peserta).
- Halaman Armada: pilih tanggal, lama sewa (hari), dan jumlah peserta;
  ketersediaan per unit tampil langsung + kalender ketersediaan.
- Pembayaran: transfer bank dan QRIS (unggah bukti, admin verifikasi), DP/lunas.
- Lacak pesanan: kode pemesanan + 4 digit akhir WhatsApp.
- Panel admin: Pemesanan, Kalender (blokir tanggal), Paket, Armada,
  Pembayaran & Kontak, Akun.

YANG HARUS ANDA ISI DI PANEL ADMIN SEBELUM DIBUKA UNTUK UMUM
- Armada > "Jumlah unit": bawaan 2 unit per tipe. Ubah sesuai bus yang dimiliki.
  Ketersediaan dihitung dari angka ini.
- Paket > harga per armada. Bawaan 0 = "hubungi kami" (admin menetapkan harga
  di pemesanan). Paket bawaan berdurasi 3 hari; sesuaikan.
- Armada > "Tarif sewa saja" untuk sewa tanpa paket (0 = ditawarkan manual).
- Pembayaran & Kontak: rekening bank, QRIS, DP %, nomor WhatsApp.
CATATAN: pemesanan berstatus Pending ikut menahan kapasitas sampai
dikonfirmasi atau dibatalkan (ubah status ke "Dibatalkan" untuk melepaskan unit).

ISI FOLDER
 server.js   server Express (hanya butuh paket "express")
 public/     halaman web & panel admin
 data/       dibuat otomatis: pemesanan, paket, armada, pengaturan, bukti bayar
             (BACKUP folder ini secara rutin; jangan dibagikan)
 .env        port, username admin, dll.

Panduan membuka ke internet dengan domain: lihat DEPLOY.md
Catatan: skrip lama "seikouverse ... .ps1" TIDAK dipakai lagi.
