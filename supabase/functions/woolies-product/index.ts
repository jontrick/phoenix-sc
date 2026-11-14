// Supabase Edge Function — woolies-product (v4.9.418)
// Fetches ONE Woolworths product's data for the Phoenix "add a food from a link" box.
// Browsers cannot read woolworths.com.au from projectphoenix-app.com (cross-site), so this
// runs server-side and hands the JSON back. It accepts NOTHING but a numeric stockcode and
// only ever calls www.woolworths.com.au — it is not a general proxy.
//
// UNVERIFIED (written without network access to Woolworths): the endpoint path and whether
// Woolworths' bot protection lets a server request through. The app reads the reply
// defensively and says plainly when no nutrition panel is found.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via editor →
// name: woolies-product → paste this file → Deploy.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const code = new URL(req.url).searchParams.get('stockcode') || '';
  if (!/^\d{1,10}$/.test(code)) return json({ ok: false, error: 'bad_stockcode' }, 400);
  try {
    // Woolworths sets session cookies on the home page; the product API is refused without them.
    const home = await fetch('https://www.woolworths.com.au/', { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    const set = (home.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
    const cookie = set.map((c) => c.split(';')[0]).join('; ');
    const r = await fetch(`https://www.woolworths.com.au/apis/ui/product/detail/${code}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: cookie, Referer: `https://www.woolworths.com.au/shop/productdetails/${code}` },
    });
    const text = await r.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* not JSON — blocked or changed */ }
    return json({ ok: r.ok && body !== null, status: r.status, body });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 200) });
  }
});
