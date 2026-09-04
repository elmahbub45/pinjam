export class PinjamApi {
  constructor(getIdToken) { this.getIdToken = getIdToken; }
  async call(action, payload = {}) {
    const cfg = window.PINJAM_CONFIG || {};
    if (!cfg.API_URL) throw new Error('API_URL belum diisi di config.js');
    const idToken = await this.getIdToken();
    if (!idToken) throw new Error('Sesi login tidak tersedia.');
    const body = JSON.stringify({ action, idToken, payload, clientVersion: cfg.APP_VERSION || '1.0.0' });
    const response = await fetch(cfg.API_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body, redirect:'follow' });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Respons backend tidak valid. Periksa deployment Apps Script.'); }
    if (!data.ok) throw new Error(data.error || 'Permintaan gagal.');
    return data.data;
  }
}
