/**
 * Inventory — static server (data disimpan di Firebase: Auth, Firestore, Storage).
 * Jalankan: npm start  (default http://localhost:3000)
 */
const express = require('express');
const path = require('node:path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback — hash routing, semua GET HTML diarahkan ke index.html
app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html')) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  next();
});

app.listen(PORT, HOST, () => {
  console.log(`✅ Inventory berjalan di http://${HOST}:${PORT}`);
});
