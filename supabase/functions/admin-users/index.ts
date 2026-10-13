// 원윤메디팜 주문관리 — 로그인 계정 관리 (관리자 전용, 최초 관리자 1회 생성)
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
function secretKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); if (k.default) return k.default; } catch (_) { /* fall back */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
// 거래처는 이메일 대신 아이디로 로그인한다. 내부적으로 아이디@이 도메인 형태로 저장한다(메일은 보내지 않음).
const LOGIN_DOMAIN = 'login.wonyunmedipharm.kr';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const idOk = (s: unknown) => typeof s === 'string' && /^[a-z0-9][a-z0-9._-]{2,29}$/.test(s);
const pwOk = (s: unknown) => typeof s === 'string' && s.length >= 8 && s.length <= 72;
const emailOf = (id: string) => `${id}@${LOGIN_DOMAIN}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST만 받아요' }, 405);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch (_) { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }
  const admin = createClient(SUPABASE_URL, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const action = String(body.action || '');

  try {
    if (action === 'bootstrap') {
      const { count, error: ce } = await admin.from('profiles').select('user_id', { count: 'exact', head: true }).eq('role', 'admin');
      if (ce) throw ce;
      if ((count || 0) > 0) return json({ error: '이미 관리자 계정이 있어요. 로그인해 주세요.' }, 403);
      const loginId = String(body.login_id || '').trim().toLowerCase();
      if (!idOk(loginId)) return json({ error: '아이디는 영문 소문자·숫자 3~30자로 정해 주세요' }, 400);
      if (!pwOk(body.password)) return json({ error: '비밀번호는 8자 이상으로 정해 주세요' }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email: emailOf(loginId), password: body.password, email_confirm: true, user_metadata: { login_id: loginId } });
      if (error || !data.user) return json({ error: '계정을 만들지 못했어요: ' + (error?.message || '') }, 400);
      const { error: pe } = await admin.from('profiles').insert({ user_id: data.user.id, role: 'admin', login_id: loginId, name: String(body.name || '').slice(0, 40) });
      if (pe) { await admin.auth.admin.deleteUser(data.user.id); throw pe; }
      return json({ ok: true, login_id: loginId });
    }

    // 이하 모든 동작은 로그인한 관리자만
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: '로그인이 필요해요' }, 401);
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u?.user) return json({ error: '로그인이 만료됐어요. 다시 로그인해 주세요.' }, 401);
    const { data: me } = await admin.from('profiles').select('role, active').eq('user_id', u.user.id).maybeSingle();
    if (!me || me.role !== 'admin' || !me.active) return json({ error: '관리자만 할 수 있어요' }, 403);

    if (action === 'create') {
      const loginId = String(body.login_id || '').trim().toLowerCase();
      const role = body.role === 'admin' ? 'admin' : 'customer';
      if (!idOk(loginId)) return json({ error: '아이디는 영문 소문자·숫자 3~30자로 정해 주세요' }, 400);
      if (!pwOk(body.password)) return json({ error: '비밀번호는 8자 이상이어야 해요' }, 400);
      if (role === 'customer') {
        const { data: acc } = await admin.from('accounts').select('id').eq('id', body.account_id || '00000000-0000-0000-0000-000000000000').maybeSingle();
        if (!acc) return json({ error: '거래처를 찾을 수 없어요' }, 400);
      }
      const { data: dup } = await admin.from('profiles').select('user_id').eq('login_id', loginId).maybeSingle();
      if (dup) return json({ error: '이미 쓰고 있는 아이디예요' }, 409);
      const { data, error } = await admin.auth.admin.createUser({ email: emailOf(loginId), password: body.password, email_confirm: true, user_metadata: { login_id: loginId } });
      if (error || !data.user) return json({ error: '계정을 만들지 못했어요: ' + (error?.message || '') }, 400);
      const { error: pe } = await admin.from('profiles').insert({ user_id: data.user.id, role, account_id: role === 'customer' ? body.account_id : null, login_id: loginId, name: String(body.name || '').slice(0, 40), temp_pw: true });
      if (pe) { await admin.auth.admin.deleteUser(data.user.id); throw pe; }
      return json({ ok: true, user_id: data.user.id, login_id: loginId });
    }

    if (action === 'reset_password') {
      if (!pwOk(body.password)) return json({ error: '비밀번호는 8자 이상이어야 해요' }, 400);
      const { error } = await admin.auth.admin.updateUserById(String(body.user_id), { password: body.password });
      if (error) return json({ error: '비밀번호를 바꾸지 못했어요: ' + error.message }, 400);
      if (body.user_id !== u.user.id) await admin.from('profiles').update({ temp_pw: true }).eq('user_id', body.user_id);
      return json({ ok: true });
    }

    if (action === 'set_active') {
      if (body.user_id === u.user.id) return json({ error: '내 계정은 잠글 수 없어요' }, 400);
      const active = !!body.active;
      const { error } = await admin.auth.admin.updateUserById(String(body.user_id), { ban_duration: active ? 'none' : '876000h' });
      if (error) return json({ error: '바꾸지 못했어요: ' + error.message }, 400);
      await admin.from('profiles').update({ active }).eq('user_id', body.user_id);
      return json({ ok: true });
    }

    if (action === 'remove') {
      if (body.user_id === u.user.id) return json({ error: '내 계정은 지울 수 없어요' }, 400);
      const { error } = await admin.auth.admin.deleteUser(String(body.user_id));
      if (error) return json({ error: '지우지 못했어요: ' + error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: '알 수 없는 요청이에요' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: '처리 중 오류가 났어요: ' + ((e as Error)?.message || String(e)) }, 500);
  }
});
