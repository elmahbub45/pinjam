/* Pinjam PWA - konfigurasi publik. Isi setelah deploy Apps Script + Firebase. */
(() => {
  const cfg = {
    APP_VERSION: '1.0.1',
    API_URL: '', // contoh: https://script.google.com/macros/s/AKfycb.../exec
    FIREBASE: {
      apiKey: '',
      authDomain: '',
      projectId: '',
      storageBucket: '',
      messagingSenderId: '',
      appId: ''
    },
    VAPID_KEY: ''
  };
  if (typeof window !== 'undefined') window.PINJAM_CONFIG = cfg;
  if (typeof self !== 'undefined') self.PINJAM_CONFIG = cfg;
})();
