(() => {
  'use strict';
  document.getElementById('quickTrack').addEventListener('submit', e => {
    e.preventDefault();
    const code = document.getElementById('qCode').value.trim().toUpperCase();
    const phone = document.getElementById('qPhone').value.replace(/\D/g, '');
    if (!code || phone.length < 4) return LP.toast('Isi kode pemesanan dan 4 digit terakhir nomor WhatsApp.');
    try { sessionStorage.setItem('lp_prefill', JSON.stringify({ code, phone })); } catch { /* abaikan */ }
    location.href = '/lacak';
  });
})();
