// 원윤메디팜 주문관리 — 전자세금계산서 발행 (볼타 API). 관리자 전용.
// 필요한 비밀값: BOLTA_API_KEY (test_… 또는 live_…)
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
function secretKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); if (k.default) return k.default; } catch (_) { /* fall back */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const BOLTA = 'https://xapi.bolta.io';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const nz = (s: unknown) => { const v = String(s ?? '').trim(); return v ? v : undefined; };

function boltaKey(): string | null { const k = (Deno.env.get('BOLTA_API_KEY') || '').trim(); return k || null; }
function modeOf(k: string | null) { return !k ? null : k.startsWith('live_') ? 'live' : 'test'; }

async function bolta(path: string, init: { method?: string; body?: unknown; ref?: string } = {}) {
  const key = boltaKey();
  if (!key) throw new Error('볼타 API 키(BOLTA_API_KEY)가 아직 등록되지 않았어요');
  const headers: Record<string, string> = { Authorization: 'Basic ' + btoa(key + ':'), 'Content-Type': 'application/json' };
  if (init.ref) headers['Bolta-Client-Reference-Id'] = init.ref;
  const res = await fetch(BOLTA + path, { method: init.method || 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined });
  const text = await res.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
  return { status: res.status, data, retryAfter: res.headers.get('Retry-After') };
}
const boltaErr = (r: { status: number; data: any }) => (r.data && (r.data.message || r.data.code)) ? `${r.data.message || ''}${r.data.code ? ` (${r.data.code})` : ''}` : `볼타 응답 ${r.status}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST만 받아요' }, 405);
  const db = createClient(SUPABASE_URL, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch (_) { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }

  // 관리자 확인
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: '로그인이 필요해요' }, 401);
  const { data: u, error: ue } = await db.auth.getUser(token);
  if (ue || !u?.user) return json({ error: '로그인이 만료됐어요. 다시 로그인해 주세요.' }, 401);
  const { data: me } = await db.from('profiles').select('role, active').eq('user_id', u.user.id).maybeSingle();
  if (!me || me.role !== 'admin' || !me.active) return json({ error: '관리자만 할 수 있어요' }, 403);

  const action = String(body.action || '');
  try {
    const { data: cfg } = await db.from('tax_config').select('*').eq('id', 1).single();
    const { data: st } = await db.from('settings').select('*').eq('id', 1).single();

    if (action === 'status') {
      let cert = null;
      if (cfg?.issuer_id && boltaKey()) {
        const r = await bolta(`/v1/issuers/${encodeURIComponent(cfg.issuer_id)}`);
        if (r.status === 200) {
          cert = r.data?.certificate || null;
          await db.from('tax_config').update({ cert_issued_at: cert?.issuedAt || null, cert_expires_at: cert?.expiresAt || null, updated_at: new Date().toISOString() }).eq('id', 1);
        }
      }
      return json({ hasKey: !!boltaKey(), mode: modeOf(boltaKey()), issuerId: cfg?.issuer_id || null, certificate: cert || (cfg?.cert_expires_at ? { issuedAt: cfg.cert_issued_at, expiresAt: cfg.cert_expires_at } : null) });
    }

    if (action === 'register_issuer') {
      const id = digits(st?.biz_no);
      if (id.length !== 10) return json({ error: '설정에 원윤메디팜 사업자등록번호(10자리)를 먼저 입력해 주세요' }, 400);
      if (!nz(st?.ceo)) return json({ error: '설정에 대표자 이름을 먼저 입력해 주세요' }, 400);
      const r = await bolta('/v1/issuers', { method: 'POST', body: { identificationNumber: id, organizationName: st.name, representativeName: st.ceo } });
      if (r.status !== 200 || !r.data?.issuerId) return json({ error: '발급자 등록 실패: ' + boltaErr(r) }, 400);
      await db.from('tax_config').update({ issuer_id: r.data.issuerId, updated_at: new Date().toISOString() }).eq('id', 1);
      return json({ ok: true, issuerId: r.data.issuerId });
    }

    if (action === 'cert_url') {
      if (!cfg?.issuer_id) return json({ error: '발급자 등록을 먼저 해 주세요' }, 400);
      const r = await bolta(`/v1/issuers/${encodeURIComponent(cfg.issuer_id)}/certificates/url`);
      if (r.status !== 200 || !r.data?.url) return json({ error: '인증서 등록 화면을 열지 못했어요: ' + boltaErr(r) }, 400);
      return json({ url: r.data.url });
    }

    const invId = String(body.id || '');
    const { data: inv } = await db.from('tax_invoices').select('*').eq('id', invId).maybeSingle();
    if (!inv) return json({ error: '계산서를 찾을 수 없어요' }, 404);

    if (action === 'issue') {
      if (!['대기', '실패'].includes(inv.status)) return json({ error: '이미 발행 요청한 계산서예요' }, 400);
      const supplierId = digits(st?.biz_no);
      const problems: string[] = [];
      if (supplierId.length !== 10) problems.push('원윤메디팜 사업자등록번호');
      if (!nz(st?.ceo)) problems.push('원윤메디팜 대표자');
      if (!nz(st?.tax_email)) problems.push('원윤메디팜 세금계산서 담당 이메일');
      const sp = inv.supplied || {};
      const spId = digits(sp.identificationNumber);
      if (spId.length !== 10 && spId.length !== 13) problems.push('거래처 사업자등록번호');
      if (!nz(sp.representativeName)) problems.push('거래처 대표자');
      if (!sp.managers?.[0]?.email) problems.push('거래처 세금계산서 이메일');
      if (problems.length) return json({ error: '빠진 정보가 있어요: ' + problems.join(', ') }, 400);

      // 실패 후 재시도는 새 요청번호로 (볼타는 같은 번호 재사용을 거부)
      let ref = inv.client_ref;
      if (inv.status === '실패') ref = 'WY' + crypto.randomUUID().replace(/-/g, '');
      const payload = {
        date: inv.write_date,
        purpose: inv.purpose || 'CLAIM',
        taxType: 'TAXABLE',
        supplier: {
          identificationNumber: supplierId,
          organizationName: st.name,
          representativeName: st.ceo,
          address: nz(st.addr),
          businessType: nz(st.biz_type),
          businessItem: nz(st.biz_item),
          manager: { email: st.tax_email, name: nz(st.tax_manager) },
        },
        supplied: {
          identificationNumber: spId,
          organizationName: sp.organizationName,
          representativeName: sp.representativeName,
          address: nz(sp.address), businessType: nz(sp.businessType), businessItem: nz(sp.businessItem),
          managers: sp.managers,
        },
        items: inv.items,
        description: nz(inv.memo),
      };
      await db.from('tax_invoices').update({ status: '발행중', client_ref: ref, mode: modeOf(boltaKey()), error: null, updated_at: new Date().toISOString() }).eq('id', inv.id);
      let r;
      try { r = await bolta('/v1/taxInvoices/issue', { method: 'POST', body: payload, ref }); }
      catch (e) {
        await db.from('tax_invoices').update({ error: '볼타 응답이 없어요. 잠시 후 ‘상태 확인’을 눌러 주세요.' }).eq('id', inv.id);
        return json({ status: '발행중', error: (e as Error).message });
      }
      if (r.status !== 200 || !r.data?.issuanceKey) {
        const msg = boltaErr(r);
        await db.from('tax_invoices').update({ status: '실패', error: msg, updated_at: new Date().toISOString() }).eq('id', inv.id);
        return json({ status: '실패', error: msg });
      }
      const key = r.data.issuanceKey;
      await db.from('tax_invoices').update({ issuance_key: key, updated_at: new Date().toISOString() }).eq('id', inv.id);
      const g = await bolta(`/v1/taxInvoices/${encodeURIComponent(key)}`);
      if (g.status === 200 && g.data?.ntsTransactionId) {
        await db.from('tax_invoices').update({ status: '발행완료', nts_id: g.data.ntsTransactionId, issued_at: g.data.issuedAt || new Date().toISOString(), error: null, updated_at: new Date().toISOString() }).eq('id', inv.id);
        return json({ status: '발행완료', nts_id: g.data.ntsTransactionId });
      }
      return json({ status: '발행중', issuanceKey: key });
    }

    if (action === 'refresh') {
      let key = inv.issuance_key;
      let message = '';
      if (!key) {
        const s = await bolta(`/v1/taxInvoices/issue/status?clientReferenceId=${encodeURIComponent(inv.client_ref)}`);
        if (s.status === 200) { key = s.data?.issuanceKey; message = s.data?.message || ''; if (key) await db.from('tax_invoices').update({ issuance_key: key }).eq('id', inv.id); }
        else {
          const msg = boltaErr(s);
          if (inv.status === '발행중') await db.from('tax_invoices').update({ status: '실패', error: '볼타에 발행 요청이 없어요. 다시 발행해 주세요. ' + msg }).eq('id', inv.id);
          return json({ status: '실패', error: msg });
        }
      }
      if (key) {
        const g = await bolta(`/v1/taxInvoices/${encodeURIComponent(key)}`);
        if (g.status === 200 && g.data?.ntsTransactionId) {
          await db.from('tax_invoices').update({ status: '발행완료', nts_id: g.data.ntsTransactionId, issued_at: g.data.issuedAt || new Date().toISOString(), error: null, updated_at: new Date().toISOString() }).eq('id', inv.id);
          return json({ status: '발행완료', nts_id: g.data.ntsTransactionId });
        }
        if (!message) {
          const s = await bolta(`/v1/taxInvoices/issue/status?clientReferenceId=${encodeURIComponent(inv.client_ref)}`);
          message = s.data?.message || '';
        }
      }
      return json({ status: inv.status, message: message || '아직 처리 중이에요' });
    }

    if (action === 'pdf') {
      if (!inv.issuance_key) return json({ error: '발행된 계산서가 아니에요' }, 400);
      const r = await bolta(`/v1/taxInvoices/${encodeURIComponent(inv.issuance_key)}/pdf`);
      if (r.status === 202) return json({ pending: true, retryAfter: Number(r.retryAfter || 3) });
      if (r.status !== 200 || !r.data?.downloadUrl) return json({ error: 'PDF를 가져오지 못했어요: ' + boltaErr(r) }, 400);
      return json({ url: r.data.downloadUrl, filename: r.data.filename });
    }

    return json({ error: '알 수 없는 요청이에요' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
