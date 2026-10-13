// 원윤메디팜 주문관리 — 식약처 의약품 정보 조회 (공공데이터포털). 로그인한 거래처·관리자만.
// 필요한 비밀값: DATA_GO_KR_KEY (공공데이터포털 일반 인증키. Decoding 키 권장, Encoding 키도 됨)
//   Supabase 비밀값이 없으면 app_secrets 표(서버만 읽음)의 같은 이름 값을 씀
// 쓰는 API: 의약품 제품 허가정보(필수) · 의약품개요정보 e약은요(선택) · 의약품 낱알식별(선택)
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { PRODUCT_EP, EASY_EP, PILL_EP, extractItems, merge, brief, mapProduct, fromPill, normName, str, type DrugFull } from './lib.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
function secretKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); if (k.default) return k.default; } catch (_) { /* fall back */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SEARCH_TTL = 7 * 24 * 3600 * 1000;   // 검색 결과 7일 보관
const ITEM_TTL = 30 * 24 * 3600 * 1000;    // 품목 상세 30일 보관

let keyCache: { v: string; at: number } | null = null;
// deno-lint-ignore no-explicit-any
async function apiKey(db: any): Promise<string | null> {
  const env = (Deno.env.get('DATA_GO_KR_KEY') || '').trim();
  if (env) return env;
  if (keyCache && Date.now() - keyCache.at < 60_000) return keyCache.v || null;
  const { data } = await db.from('app_secrets').select('value').eq('name', 'DATA_GO_KR_KEY').maybeSingle();
  keyCache = { v: String(data?.value || '').trim(), at: Date.now() };
  return keyCache.v || null;
}
const keyParam = (k: string) => (k.includes('%') ? k : encodeURIComponent(k));

async function call(k: string, ep: string, params: Record<string, string | number>): Promise<{ items: Record<string, unknown>[]; total: number }> {
  const qs = Object.entries(params).map(([a, b]) => `${a}=${encodeURIComponent(String(b))}`).join('&');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch(`${ep}?serviceKey=${keyParam(k)}&type=json&${qs}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new Error('이 API는 아직 활용신청이 승인되지 않았어요');
    if (!res.ok && !text.trim().startsWith('{')) throw new Error(`식약처 응답 ${res.status}`);
    return extractItems(text);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('식약처 응답이 늦어요');
    throw e;
  } finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST만 받아요' }, 405);
  const db = createClient(SUPABASE_URL, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }

  // 로그인한 거래처(거래 중) 또는 관리자만
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: '로그인이 필요해요' }, 401);
  const { data: u, error: ue } = await db.auth.getUser(token);
  if (ue || !u?.user) return json({ error: '로그인이 만료됐어요. 다시 로그인해 주세요.' }, 401);
  const { data: me } = await db.from('profiles').select('role, active, account_id').eq('user_id', u.user.id).maybeSingle();
  if (!me || !me.active) return json({ error: '사용할 수 없는 계정이에요' }, 403);
  if (me.role !== 'admin') {
    const { data: acc } = await db.from('accounts').select('active').eq('id', me.account_id).maybeSingle();
    if (!acc || acc.active === false) return json({ error: '사용할 수 없는 계정이에요' }, 403);
  }
  const isAdmin = me.role === 'admin';

  const action = str(body.action);
  const key = await apiKey(db);
  if (action === 'status') return json({ hasKey: !!key });
  if (!key) return json({ needsKey: true, items: [], total: 0 });

  try {
    if (action === 'search') {
      const q = str(body.q).replace(/\s+/g, ' ').slice(0, 40);
      if (q.replace(/\s/g, '').length < 2) return json({ items: [], total: 0 });
      const ck = 'q:' + q.toLowerCase();
      const { data: hit } = await db.from('drug_cache').select('data, fetched_at').eq('key', ck).maybeSingle();
      if (hit && Date.now() - new Date(hit.fetched_at).getTime() < SEARCH_TTL) return json({ ...hit.data, cached: true });

      const [p, e, g] = await Promise.allSettled([
        call(key, PRODUCT_EP, { item_name: q, numOfRows: 20, pageNo: 1 }),
        call(key, EASY_EP, { itemName: q, numOfRows: 20, pageNo: 1 }),
        call(key, PILL_EP, { item_name: q, numOfRows: 30, pageNo: 1 }),
      ]);
      if (p.status === 'rejected' && e.status === 'rejected') throw p.reason;
      const full = merge(p.status === 'fulfilled' ? p.value.items : [], e.status === 'fulfilled' ? e.value.items : [], g.status === 'fulfilled' ? g.value.items : []);
      const total = Math.max(p.status === 'fulfilled' ? p.value.total : 0, full.length);
      const warnings: string[] = [];
      if (p.status === 'rejected') warnings.push('제품 허가정보: ' + (p.reason as Error).message);
      if (e.status === 'rejected') warnings.push('e약은요: ' + (e.reason as Error).message);
      if (g.status === 'rejected') warnings.push('낱알식별: ' + (g.reason as Error).message);
      const out = { items: full.map(brief), total, warnings: isAdmin ? warnings : [] };
      // 캐시: 검색 결과 + 품목별 상세
      const now = new Date().toISOString();
      const rows = [{ key: ck, data: { items: out.items, total, warnings }, fetched_at: now }, ...full.map(d => ({ key: 'seq:' + d.seq, data: d, fetched_at: now }))];
      if (p.status === 'fulfilled') await db.from('drug_cache').upsert(rows);
      return json(out);
    }

    if (action === 'detail') {
      const seq = str(body.seq).replace(/\D/g, '').slice(0, 12);
      if (!seq) return json({ error: '품목을 찾을 수 없어요' }, 400);
      const ck = 'seq:' + seq;
      const { data: hit } = await db.from('drug_cache').select('data, fetched_at').eq('key', ck).maybeSingle();
      if (hit && Date.now() - new Date(hit.fetched_at).getTime() < ITEM_TTL) return json({ item: hit.data, cached: true });
      const [p, e, g] = await Promise.allSettled([
        call(key, PRODUCT_EP, { item_seq: seq, numOfRows: 1, pageNo: 1 }),
        call(key, EASY_EP, { itemSeq: seq, numOfRows: 1, pageNo: 1 }),
        call(key, PILL_EP, { item_seq: seq, numOfRows: 1, pageNo: 1 }),
      ]);
      const list = merge(p.status === 'fulfilled' ? p.value.items : [], e.status === 'fulfilled' ? e.value.items : [], g.status === 'fulfilled' ? g.value.items : []);
      const item: DrugFull | undefined = list.find(d => d.seq === seq) || list[0];
      if (!item) return json({ error: p.status === 'rejected' ? (p.reason as Error).message : '식약처 자료에서 찾지 못했어요' }, 404);
      await db.from('drug_cache').upsert({ key: ck, data: item, fetched_at: new Date().toISOString() });
      return json({ item });
    }

    // 우리 상품(보험코드·이름)으로 식약처 품목 찾기
    if (action === 'match') {
      const code = str(body.code).replace(/\D/g, '');
      const name = str(body.name).replace(/\([^)]*\)/g, '').trim().slice(0, 40);
      if (name.length < 2) return json({ error: '이름이 짧아요' }, 400);
      const ck = 'm:' + (code || '') + ':' + name.toLowerCase();
      const { data: hit } = await db.from('drug_cache').select('data, fetched_at').eq('key', ck).maybeSingle();
      if (hit && Date.now() - new Date(hit.fetched_at).getTime() < ITEM_TTL) return json({ ...hit.data, cached: true });
      // 보험코드가 같으면 확실, 아니면 이름(괄호 속 성분 제외)이 똑같을 때만 — 함량이 다른 품목으로 잘못 잇지 않게
      const pickHit = (full: DrugFull[]) => (code && full.find(d => d.edi.includes(code.padStart(9, '0')))) || full.find(d => normName(d.name) === normName(name)) || null;
      let hitd: DrugFull | null = null;
      try { const { items } = await call(key, PRODUCT_EP, { item_name: name, numOfRows: 20, pageNo: 1 }); hitd = pickHit(items.map(mapProduct).filter(d => d.seq && d.status === '정상')); }
      catch (_) { /* 허가정보를 못 받으면 낱알식별로 */ }
      if (!hitd) { try { const { items } = await call(key, PILL_EP, { item_name: name, numOfRows: 30, pageNo: 1 }); hitd = pickHit(items.map(fromPill).filter(d => d.seq)); } catch (_) { /* 없음 */ } }
      const out = { seq: hitd?.seq || null };
      await db.from('drug_cache').upsert({ key: ck, data: out, fetched_at: new Date().toISOString() });
      return json(out);
    }

    return json({ error: '알 수 없는 요청이에요' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error)?.message || '식약처 정보를 가져오지 못했어요' }, 502);
  }
});

