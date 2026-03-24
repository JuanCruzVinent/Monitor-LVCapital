// LV Capital - Proxy Yahoo Finance para mercados globales
// Netlify serverless function: /.netlify/functions/mundo

const https = require('https');

const SYMBOLS = [
  { id: 'sp500',    symbol: '%5EGSPC',    name: 'S&P 500',        icon: 'US' },
  { id: 'nasdaq',   symbol: '%5EIXIC',    name: 'NASDAQ',          icon: 'US' },
  { id: 'merval',   symbol: '%5EMERV',    name: 'MERVAL',          icon: 'AR' },
  { id: 'gold',     symbol: 'GC%3DF',     name: 'ORO',             icon: 'AU' },
  { id: 'oil',      symbol: 'CL%3DF',     name: 'PETROLEO WTI',    icon: 'OI' },
  { id: 'tnx',      symbol: '%5ETNX',     name: 'TASA 10Y',        icon: 'BD' },
  { id: 'bitcoin',  symbol: 'BTC-USD',    name: 'BITCOIN',         icon: 'BT' },
  { id: 'ethereum', symbol: 'ETH-USD',    name: 'ETHEREUM',        icon: 'ET' },
];

// Fetch precio + sparkline intradiaria
// Intenta 5m/1d primero; si hay menos de 10 puntos (mercado cerrado) usa 15m/5d
function fetchYahoo(symbolEncoded) {
  return fetchYahooRaw(symbolEncoded, '5m', '1d')
    .then(result => {
      if (result.sparkline.length < 10) {
        return fetchYahooRaw(symbolEncoded, '15m', '5d');
      }
      return result;
    });
}

function fetchYahooRaw(symbolEncoded, interval, range) {
  return new Promise((resolve, reject) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbolEncoded}?interval=${interval}&range=${range}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json     = JSON.parse(data);
          const result   = json.chart.result[0];
          const meta     = result.meta;
          const price    = meta.regularMarketPrice;
          const prev     = meta.previousClose || meta.chartPreviousClose || price;
          const change   = prev ? ((price - prev) / prev) * 100 : 0;
          const closes   = (result.indicators.quote[0].close) || [];
          const sparkline = closes.filter(v => v !== null && !isNaN(v));
          resolve({
            price:     price,
            prev:      prev,
            change:    Math.round(change * 100) / 100,
            sparkline: sparkline,
          });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

exports.handler = async () => {
  try {
    const results = await Promise.allSettled(
      SYMBOLS.map(s => fetchYahoo(s.symbol))
    );

    const data = SYMBOLS.map((s, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') {
        return {
          id:     s.id,
          name:   s.name,
          icon:   s.icon,
          price:     r.value.price,
          prev:      r.value.prev,
          change:    r.value.change,
          sparkline: r.value.sparkline,
          error:     false,
        };
      }
      return { id: s.id, name: s.name, icon: s.icon, price: null, prev: null, change: null, sparkline: [], error: true };
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
      body: JSON.stringify({ data, updated: new Date().toISOString() }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
