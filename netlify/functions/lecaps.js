// LV Capital - LECAP, BONCAP y TY30P desde data912.com
// Netlify serverless function: /.netlify/functions/lecaps

const https = require('https');

const NOTES_URL = 'https://data912.com/live/arg_notes';
const BONDS_URL = 'https://data912.com/live/arg_bonds';

const LECAP_TICKERS  = ['S17A6','S30A6','S29Y6','S31L6','S31G6','S30O6','S30N6'];
const BONCAP_TICKERS = ['T30J6','T15E7','T30A7','T31Y7','T30J7','TY30P'];

// Fechas de vencimiento
const MATURITY = {
  'S17A6': '2026-04-17',
  'S30A6': '2026-04-30',
  'S29Y6': '2026-05-29',
  'S31L6': '2026-07-31',
  'S31G6': '2026-08-31',
  'S30O6': '2026-10-30',
  'S30N6': '2026-11-30',
  'T30J6': '2026-06-30',
  'T15E7': '2027-01-15',
  'T30A7': '2027-04-30',
  'T31Y7': '2027-05-31',
  'T30J7': '2027-06-30',
  'TY30P': '2030-05-30',
};

// Px Finish = valor tecnico al vencimiento por VN=1 (Secretaria de Finanzas)
// Fuente: tabla provista por LV Capital 26/03/2026
const VT_VTO = {
  'S17A6': 1.1013,
  'S30A6': 1.2749,
  'S29Y6': 1.3203,
  'S31L6': 1.1768,
  'S31G6': 1.2706,
  'S30O6': 1.3528,
  'S30N6': 1.2989,
  'T30J6': 1.4490,
  'T15E7': 1.6110,
  'T30A7': 1.5734,
  'T31Y7': 1.5156,
  'T30J7': 1.5604,
};

// Flujos TY30P por VN=1 (semi-anual, cupon 14.75%)
const TY30P_FLOWS = [
  { date: '2026-05-30', flow: 0.1475 },
  { date: '2026-11-30', flow: 0.1475 },
  { date: '2027-05-30', flow: 0.1475 },
  { date: '2027-11-30', flow: 0.1475 },
  { date: '2028-05-30', flow: 0.1475 },
  { date: '2028-11-30', flow: 0.1475 },
  { date: '2029-05-30', flow: 0.1475 },
  { date: '2029-11-30', flow: 0.1475 },
  { date: '2030-05-30', flow: 1.1475 },
];

// TNA y TEM para instrumentos bullet (LECAP/BONCAP con VT_vto conocido)
// TNA = (Precio_vto / Precio_mercado - 1) / Dias_al_vto * 365
// TEM = (1 + TNA/365)^30 - 1
function calcRatesBullet(price, matDate, vtVto) {
  if (!price || price <= 0 || !vtVto) { return { tna: null, tem: null }; }
  const today = new Date();
  const mat   = new Date(matDate);
  const days  = Math.round((mat - today) / (1000 * 60 * 60 * 24));
  if (days <= 0) { return { tna: null, tem: null }; }

  const tna = ((vtVto / price) - 1) / days * 365 * 100;
  const tem = (Math.pow(1 + (tna / 100) / 365, 30) - 1) * 100;
  return {
    tna: Math.round(tna * 100) / 100,
    tem: Math.round(tem * 100) / 100,
  };
}

// TIR por Newton-Raphson para TY30P (flujos irregulares)
function calcTIR_flows(price, flows) {
  if (!price || price <= 0 || !flows || flows.length === 0) { return null; }
  const today = new Date().getTime();
  const cf = flows
    .map(f => ({ t: (new Date(f.date).getTime() - today) / (365.25 * 24 * 3600 * 1000), flow: f.flow }))
    .filter(f => f.t > 0);
  if (cf.length === 0) { return null; }

  const pv  = y => cf.reduce((a, c) => a + c.flow / Math.pow(1 + y, c.t), 0);
  const dpv = y => cf.reduce((a, c) => a - c.t * c.flow / Math.pow(1 + y, c.t + 1), 0);

  let y = 0.25;
  for (let i = 0; i < 100; i++) {
    const f = pv(y) - price;
    const d = dpv(y);
    if (Math.abs(d) < 1e-14) { break; }
    const yn = Math.max(-0.99, Math.min(10, y - f / d));
    if (Math.abs(yn - y) < 1e-10) { y = yn; break; }
    y = yn;
  }
  if (isNaN(y) || y < -0.99 || y > 10) { return null; }
  return Math.round(y * 10000) / 100; // como %
}

// Dias al vencimiento desde hoy
function daysTo(matDate) {
  const today = new Date();
  const mat   = new Date(matDate);
  return Math.round((mat - today) / (1000 * 60 * 60 * 24));
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
      const price  = parseFloat(item.c) || 0;
      if (price <= 0) { continue; }
      const mat    = MATURITY[item.symbol];
      const vt     = VT_VTO[item.symbol];
      const rates  = calcRatesBullet(price, mat, vt);
      const change = parseFloat(item.pct_change) || 0;
      result.push({
        symbol:   item.symbol,
        price,
        change,
        tna:      rates.tna,
        tem:      rates.tem,
        tir:      null,
        maturity: mat,
        days:     mat ? daysTo(mat) : null,
        type:     'LECAP',
      });
    }

    for (const item of bonds) {
      if (!BONCAP_TICKERS.includes(item.symbol)) { continue; }
      const price  = parseFloat(item.c) || 0;
      if (price <= 0) { continue; }
      const mat    = MATURITY[item.symbol];
      const change = parseFloat(item.pct_change) || 0;

      let tna = null, tem = null, tir = null;

      if (item.symbol === 'TY30P') {
        // Bono con flujos: calcular TIR por Newton-Raphson
        tir = calcTIR_flows(price, TY30P_FLOWS);
      } else {
        const vt = VT_VTO[item.symbol];
        const r  = calcRatesBullet(price, mat, vt);
        tna = r.tna;
        tem = r.tem;
      }

      result.push({
        symbol:   item.symbol,
        price,
        change,
        tna,
        tem,
        tir,
        maturity: mat,
        days:     mat ? daysTo(mat) : null,
        type:     'BONCAP',
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
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message }) };
  }
};
