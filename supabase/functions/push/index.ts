// 원윤메디팜 주문관리 — 사이트 푸시 알림 보내기 (Web Push)
// - deliver: DB 트리거가 알림을 기록하면 pg_net으로 호출 (x-push-secret = app_secrets.PUSH_HOOK_SECRET)
// - key: 로그인한 사람에게 VAPID 공개키 (없으면 서버에서 만들어 app_secrets에 저장 — 비밀키는 밖으로 안 나감)
// - test: 내 기기로 테스트 알림
// - broadcast: 관리자가 거래처에 공지 알림
// 배포: verify_jwt = false (DB 트리거 호출 때문). 사람이 부르는 동작은 아래에서 직접 로그인 확인
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { generateVapidKeys, sendPush, type VapidKeys } from './webpush.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
function secretKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); if (k.default) return k.default; } catch (_) { /* fall back */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const SUBJECT = 'https://bluelabelman81-creator.github.io/wonyun-medipharm-order/';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();
const URGENT = new Set(['order_new', 'order_cust_cancel', 'req_new', 'order_shipped']);

// deno-lint-ignore no-explicit-any
type DB = any;

async function vapid(db: DB, create: boolean): Promise<VapidKeys | null> {
  const read = async () => { const { data } = await db.from('app_secrets').select('value').eq('name', 'VAPID_KEYS').maybeSingle(); return data?.value ? JSON.parse(data.value) as VapidKeys : null; };
  const k = await read(); if (k || !create) return k;
  const fresh = await generateVapidKeys();
  await db.from('app_secrets').upsert({ name: 'VAPID_KEYS', value: JSON.stringify(fresh) }, { onConflict: 'name', ignoreDuplicates: true });
  return await read();
}

async function hookSecret(db: DB): Promise<string> {
  const { data } = await db.from('app_secrets').select('value').eq('name', 'PUSH_HOOK_SECRET').maybeSingle();
  return String(data?.value || '');
}
const same = (a: string, b: string) => { if (!a || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

type Payload = { title: string; body: string; url: string; tag: string; ts: number };

// 사람들(user_id)의 기기로 보내기. event를 끈 사람은 뺌(test는 항상 보냄)
async function deliverTo(db: DB, keys: VapidKeys, userIds: string[], event: string, payload: Payload, onlyEndpoint = '') {
  const res = { people: 0, devices: 0, sent: 0, failed: 0, removed: 0, errors: [] as string[] };
  if (!userIds.length) return res;
  let targets = userIds;
  if (event !== 'test') {
    const { data: prefs } = await db.from('notify_prefs').select('user_id, off').in('user_id', userIds);
    const off = new Map<string, string[]>((prefs || []).map((p: { user_id: string; off: string[] }) => [p.user_id, p.off || []]));
    targets = userIds.filter(u => !(off.get(u) || []).includes(event));
  }
  res.people = targets.length; if (!targets.length) return res;
  let q = db.from('push_subs').select('id, user_id, endpoint, p256dh, auth, fails').in('user_id', targets);
  if (onlyEndpoint) q = q.eq('endpoint', onlyEndpoint);
  const { data: subs } = await q;
  res.devices = (subs || []).length;
  const body = JSON.stringify(payload);
  await Promise.all((subs || []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string; fails: number }) => {
    try {
      const r = await sendPush(s, body, keys, SUBJECT, { ttl: 3 * 86400, urgency: URGENT.has(event) ? 'high' : 'normal' });
      if (r.status >= 200 && r.status < 300) { res.sent++; await db.from('push_subs').update({ last_ok_at: new Date().toISOString(), fails: 0 }).eq('id', s.id); }
      else if (r.status === 404 || r.status === 410) { res.failed++; res.removed++; await db.from('push_subs').delete().eq('id', s.id); }
      else { res.failed++; res.errors.push(`${r.status} ${r.text}`.trim()); await db.from('push_subs').update({ fails: (s.fails || 0) + 1 }).eq('id', s.id); }
    } catch (e) { res.failed++; res.errors.push((e as Error).message); }
  }));
  return res;
}

// 알림 기록 한 건 → 받는 사람
async function recipients(db: DB, n: { audience: string; account_id: string | null; user_id: string | null }): Promise<string[]> {
  if (n.audience === 'account') {
    if (!n.account_id) return [];
    const { data: acc } = await db.from('accounts').select('active').eq('id', n.account_id).maybeSingle();
    if (!acc || acc.active === false) return [];
  }
  let q = db.from('profiles').select('user_id').eq('active', true);
  if (n.audience === 'admin') q = q.eq('role', 'admin');
  else if (n.audience === 'account') q = q.eq('role', 'customer').eq('account_id', n.account_id);
  else q = q.eq('user_id', n.user_id);
  const { data } = await q;
  return (data || []).map((r: { user_id: string }) => r.user_id);
}

async function deliverNotification(db: DB, keys: VapidKeys | null, id: string) {
  const { data: n } = await db.from('notifications').select('*').eq('id', id).maybeSingle();
  if (!n) return { error: '알림을 찾을 수 없어요' };
  if (n.sent_at) return { skipped: true };
  // 오래된 알림(10분 넘게 밀린 것)은 보내지 않음
  if (Date.now() - new Date(n.created_at).getTime() > 10 * 60 * 1000) {
    await db.from('notifications').update({ sent: 0, failed: 0, sent_at: new Date().toISOString(), error: '늦어서 보내지 않음' }).eq('id', id);
    return { skipped: true };
  }
  const users = await recipients(db, n);
  const r = keys ? await deliverTo(db, keys, users, n.event, { title: n.title, body: n.body, url: n.url, tag: n.tag, ts: new Date(n.created_at).getTime() }) : { sent: 0, failed: 0, errors: [] as string[] };
  await db.from('notifications').update({ sent: r.sent, failed: r.failed, sent_at: new Date().toISOString(), error: r.errors.length ? r.errors.slice(0, 3).join(' / ').slice(0, 300) : null }).eq('id', id);
  return r;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST만 받아요' }, 405);
  const db = createClient(SUPABASE_URL, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }
  const action = str(body.action);

  try {
    // DB 트리거 → 발송
    if (action === 'deliver') {
      const secret = await hookSecret(db);
      if (!same(req.headers.get('x-push-secret') || '', secret)) return json({ error: '권한이 없어요' }, 401);
      const id = str(body.id); if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: '알림 번호가 올바르지 않아요' }, 400);
      return json(await deliverNotification(db, await vapid(db, false), id));
    }

    // 여기부터는 로그인한 사람만
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: '로그인이 필요해요' }, 401);
    const { data: u, error: ue } = await db.auth.getUser(token);
    if (ue || !u?.user) return json({ error: '로그인이 만료됐어요. 다시 로그인해 주세요.' }, 401);
    const { data: me } = await db.from('profiles').select('role, active, account_id').eq('user_id', u.user.id).maybeSingle();
    if (!me || !me.active) return json({ error: '사용할 수 없는 계정이에요' }, 403);

    if (action === 'key') {
      const k = await vapid(db, true);
      return json({ publicKey: k?.publicKey || null });
    }

    if (action === 'test') {
      const keys = await vapid(db, true); if (!keys) return json({ error: '알림 키를 만들지 못했어요' }, 500);
      const r = await deliverTo(db, keys, [u.user.id], 'test', { title: '원윤메디팜 알림 테스트', body: '이 기기로 알림이 잘 와요.', url: '', tag: 'test', ts: Date.now() }, str(body.endpoint));
      return json(r);
    }

    if (action === 'broadcast') {
      if (me.role !== 'admin') return json({ error: '관리자만 보낼 수 있어요' }, 403);
      const title = str(body.title).slice(0, 60); const text = str(body.body).slice(0, 200);
      if (title.length < 2) return json({ error: '제목을 2자 이상 적어 주세요' }, 400);
      let q = db.from('accounts').select('id, name').eq('active', true);
      const ids = Array.isArray(body.accounts) ? (body.accounts as unknown[]).map(str).filter(x => /^[0-9a-f-]{36}$/.test(x)) : [];
      if (ids.length) q = q.in('id', ids);
      const { data: accs } = await q;
      if (!accs?.length) return json({ error: '보낼 거래처가 없어요' }, 400);
      const keys = await vapid(db, true); if (!keys) return json({ error: '알림 키를 만들지 못했어요' }, 500);
      const rows = accs.map((a: { id: string }) => ({ event: 'notice', audience: 'account', account_id: a.id, title, body: text, url: '#shop', tag: 'notice-' + Date.now() }));
      const { data: ins, error: ie } = await db.from('notifications').insert(rows).select('id');
      if (ie) throw ie;
      const tot = { accounts: accs.length, sent: 0, failed: 0 };
      for (const n of ins || []) { const r = await deliverNotification(db, keys, n.id) as { sent?: number; failed?: number }; tot.sent += r.sent || 0; tot.failed += r.failed || 0; }
      return json(tot);
    }

    return json({ error: '알 수 없는 요청이에요' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error)?.message || '알림을 보내지 못했어요' }, 500);
  }
});
