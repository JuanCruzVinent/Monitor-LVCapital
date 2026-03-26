// LV Capital - LECAP y BONCAP desde data912.com
// Netlify serverless function: /.netlify/functions/lecaps

const https = require('https');

const NOTES_URL = 'https://data912.com/live/arg_notes';
const BONDS_URL = 'https://data912.com/live/arg_bonds';

const LECAP_TICKERS = ['S17A6','S30A6','S15Y6','S29Y6','S31L6','S31G6','S30S6','S30O6','S30N6'];
const BONCAP_TICKERS = ['T30J6','T15E7','T30A7','T31Y7','T30J7'];

// Fechas de vencimiento por ticker (DD/MM/YYYY)
const MATURITY = {
  'S17A6': '2026-04-17', 'S30A6': '2026-04-30', 'S15Y6': '2026-05-15',
  'S29Y6': '2026-05-29', 'S31L6': '2026-07-31', 'S31G6': '2026-08-31',
  'S30S6': '2026-09-30', 'S30O6': '2026-10-30', 'S30N6': '2026-11-28',
  'T30J6': '2026-06-30', 'T15E7': '2027-01-15', 'T30A7': '2027-04-30',
  'T31Y7': '2027-05-31', 'T30J7': '2027-06-30',
};

// TIR bullet bond: (VN/precio)^(365/dias) - 1
// Las LECAP/BONCAP cotizan como precio en ARS, VN = 1000 ARS pero
// el precio en la API ya viene en terminos de 100 (tipo bono)
function calcTIR(price, matDate) {
  if (!price || price <= 0) { return null; }
  const today = new Date();
  const mat   = new Date(matDate);
  const days  = Math.round((mat - today) / (1000 * 60 * 60 * 24));
  if (days <= 0) { return null; }
  // precio viene normalizado a 100 VN -> rendimiento = (100/precio)^(365/days) - 1
  const tir = (Math.pow(100 / price, 365 / days) - 1) * 100;
  return Math.round(tir * 100) / 100;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from ' + url)); }
      });
    }).on('error', reject);
  });
}

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60',
  };

  try {
    const [notes, bonds] = await Promise.all([fetchJSON(NOTES_URL), fetchJSON(BONDS_URL)]);
    const result = [];

    for (const item of notes) {
      if (!LECAP_TICKERS.includes(item.symbol)) { continue; }
      const price = parseFloat(item.c) || 0;
      if (price <= 0) { continue; }
      const mat   = MATURITY[item.symbol];
      const tir   = mat ? calcTIR(price, mat) : null;
      const change = parseFloat(item.pct_change) || 0;
      result.push({
        symbol:    item.symbol,
        price,
        change,
        tir,
        maturity:  mat,
        type:      'LECAP',
      });
    }

    for (const item of bonds) {
      if (!BONCAP_TICKERS.includes(item.symbol)) { continue; }
      const price = parseFloat(item.c) || 0;
      if (price <= 0) { continue; }
      const mat   = MATURITY[item.symbol];
      const tir   = mat ? calcTIR(price, mat) : null;
      const change = parseFloat(item.pct_change) || 0;
      result.push({
        symbol:    item.symbol,
        price,
        change,
        tir,
        maturity:  mat,
        type:      'BONCAP',
      });
    }

    // Ordenar por fecha de vencimiento
    result.sort((a, b) => {
      if (!a.maturity) { return 1; }
      if (!b.maturity) { return -1; }
      return new Date(a.maturity) - new Date(b.maturity);
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ data: result, updated: new Date().toISOString() }),
    };
  } catch (e) {
    console.error('lecaps fetch error:', e);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
