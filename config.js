/* Pinjam PWA - konfigurasi publik. Isi setelah deploy Apps Script + Firebase. */
(() => {
  const cfg = {
    APP_VERSION: '1.0.1',
    API_URL: 'https://script.google.com/macros/s/AKfycbzfPMu-9y78u4NsreADg5r9uHBnTFoT1Jz4Ul2HdwotDmtcMJgCLowPOm7Cz4khdE2-/exec', // contoh: https://script.google.com/macros/s/AKfycb.../exec
    FIREBASE: {
  apiKey: "AIzaSyCG649DoHo7N8y_dWADVsu6NVYBhZG6MQ4",
  authDomain: "pinjam-a50c6.firebaseapp.com",
  projectId: "pinjam-a50c6",
  storageBucket: "pinjam-a50c6.firebasestorage.app",
  messagingSenderId: "251960459303",
  appId: "1:251960459303:web:bf89d6aeef139f489f4e02",
  measurementId: "G-13M5L4YH1Y"
    },
    VAPID_KEY: 'BPu0MSkHcf3C1Jc_ZFrt10xU89pbGmn36qk2DEOXmN9qtQDG35x_EwwtLVVJU6LPvWzY4GBchF9DwCOK3S_tlKI'
  };
  if (typeof window !== 'undefined') window.PINJAM_CONFIG = cfg;
  if (typeof self !== 'undefined') self.PINJAM_CONFIG = cfg;
})();
