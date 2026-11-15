// Supabase Edge Function — recipe-import (v4.9.425)
// Jon 15 Nov: "if I shared a link for a url with a recipe I want to try can you turn this into
// nutrition information". Browsers cannot read other sites from projectphoenix-app.com, so this
// fetches the page server-side and returns ONLY the recipe's structured data (schema.org
// Recipe, published by nearly every recipe site): name, yield, ingredient lines. It never
// returns the page itself, so it is not a general proxy.
//
// Guards: https only; no IP-address or local hostnames; 10 s timeout; 3 MB cap.
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via editor →
// name: recipe-import → paste this file → Deploy.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// deno-lint-ignore no-explicit-any
function findRecipe(node: any, depth = 0): any {
  if (!node || depth > 8) return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n, depth + 1); if (r) return r; } return null; }
  if (typeof node !== 'object') return null;
  const t = node['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node;
  for (const k of ['@graph', 'mainEntity', 'itemListElement']) { const r = findRecipe(node[k], depth + 1); if (r) return r; }
  return null;
}
const text = (v: unknown): string => typeof v === 'string' ? v : (Array.isArray(v) ? text(v[0]) : (v && typeof v === 'object' && 'text' in (v as Record<string, unknown>) ? String((v as Record<string, unknown>).text) : ''));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  let u: URL;
  try { u = new URL(new URL(req.url).searchParams.get('url') || ''); } catch { return json({ ok: false, error: 'bad_url' }, 400); }
  if (u.protocol !== 'https:' || /^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname) || /^[\d.]+$|:/.test(u.hostname)) return json({ ok: false, error: 'bad_url' }, 400);
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(u.toString(), { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: ctl.signal, redirect: 'follow' });
    clearTimeout(to);
    const finalHost = new URL(r.url).hostname;
    if (/^[\d.]+$|:/.test(finalHost) || /^localhost$/i.test(finalHost)) return json({ ok: false, error: 'bad_redirect' }, 400);
    const html = (await r.text()).slice(0, 3_000_000);
    const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    let recipe = null;
    for (const b of blocks) { try { recipe = findRecipe(JSON.parse(b.trim())); } catch { /* skip bad block */ } if (recipe) break; }
    if (!recipe) return json({ ok: false, error: 'no_recipe_data', status: r.status });
    const ing = (recipe.recipeIngredient || recipe.ingredients || []).map((x: unknown) => String(x).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 80);
    return json({ ok: true, name: text(recipe.name).slice(0, 120), yield: text(recipe.recipeYield) || String(recipe.recipeYield ?? ''), ingredients: ing, source: u.hostname });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 200) });
  }
});
