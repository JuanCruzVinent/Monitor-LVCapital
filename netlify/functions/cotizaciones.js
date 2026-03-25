// LV Capital - Proxy cotizaciones FX + Riesgo Pais
// Netlify serverless function: /.netlify/functions/cotizaciones

const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

exports.handler = async () => {
  try {
    const [dolares, riesgoArr] = await Promise.all([
      fetchJson('https://dolarapi.com/v1/dolares'),
      fetchJson('https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais'),
    ]);

    // Nombres exactos del campo "casa" en dolarapi.com
    const find = (casa) => dolares.find(d => d.casa === casa) || null;

    const oficial = find('oficial');
    const ccl     = find('contadoconliqui');
    const mep     = find('bolsa');
    const blue    = find('blue');

    // Riesgo pais: array ordenado por fecha, tomar el ultimo
    const riesgoPais = Array.isArray(riesgoArr) && riesgoArr.length > 0
      ? riesgoArr[riesgoArr.length - 1].valor
      : null;

    // Brecha CCL vs Oficial
    const brecha = (oficial && ccl && oficial.venta && ccl.venta)
      ? Math.round(((ccl.venta - oficial.venta) / oficial.venta) * 1000) / 10
      : null;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120',
      },
      body: JSON.stringify({
        oficial,
        ccl,
        mep,
        blue,
        brecha,
        riesgoPais,
        updated: new Date().toISOString(),
      }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
