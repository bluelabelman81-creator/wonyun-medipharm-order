/* 원윤메디팜 주문관리 사이트 — 거래처 주문 + 관리자 처리 + 전자세금계산서(볼타) */
(() => {
'use strict';

const CFG = {
  url: 'https://zdgvsjncdotdjtitbitq.supabase.co',
  key: 'sb_publishable_KOJtK65tf7mz5tfwJKDjSw_tLS0mKEc',
  loginDomain: 'login.wonyunmedipharm.kr',
  secretsUrl: 'https://supabase.com/dashboard/project/zdgvsjncdotdjtitbitq/functions/secrets'
};

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal');
const toastRoot = document.getElementById('toast');

if (!window.supabase || !window.supabase.createClient) {
  app.innerHTML = '<div class="gate"><div class="gate-card"><h1>사이트를 불러오지 못했어요</h1><p class="lead">인터넷 연결을 확인한 뒤 새로 고쳐 주세요.</p></div></div>';
  return;
}
const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'wymp-auth' } });

/* ---------- utils ---------- */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { if (typeof v === 'number') return isFinite(v) ? v : 0; const n = parseFloat(String(v ?? '').replace(/[,\s원%]/g, '')); return isFinite(n) ? n : 0; };
const won = n => Math.round(num(n)).toLocaleString('ko-KR');
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const thisMonth = () => today().slice(0, 7);
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return ymd(d).slice(0, 7); };
const fmtDT = iso => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; return `${d.getFullYear() % 100}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtD = s => s ? String(s).slice(0, 10).replace(/-/g, '.') : '';
const daysUntil = s => { if (!s) return Infinity; const t = new Date(String(s).slice(0, 10) + 'T00:00:00'); if (isNaN(t)) return Infinity; return Math.round((t - new Date(today() + 'T00:00:00')) / 86400000); };
const ko = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ko');
const digits = s => String(s ?? '').replace(/\D/g, '');
const LS = {
  get(k, d) { try { const v = localStorage.getItem('wymp:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('wymp:' + k, JSON.stringify(v)); } catch {} }
};
const getPath = (o, p) => p.split('.').reduce((a, k) => a == null ? undefined : a[k], o);
function setPath(o, p, v) { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) { const k = ks[i]; if (a[k] == null) a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[k]; } a[ks[ks.length - 1]] = v; }
const opt = (v, cur, label) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(label ?? v)}</option>`;
function normCode(v) { let s = String(v ?? '').trim().replace(/\.0+$/, ''); if (/^\d{1,8}$/.test(s)) s = s.padStart(9, '0'); return s; }
const safeId = s => String(s).replace(/[^A-Za-z0-9_-]/g, '');
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function guessUnit(spec) { const last = String(spec || '').split('/').pop(); if (/캡슐$/.test(last)) return '캡슐'; if (/정$/.test(last)) return '정'; if (/m[lL]$/.test(last)) return '병'; if (/포$/.test(last)) return '포'; return '개'; }
function monthEnd(m) { const [y, mo] = m.split('-').map(Number); return ymd(new Date(y, mo, 0)); }
function invoiceDeadline(m) { const [y, mo] = m.split('-').map(Number); return ymd(new Date(y, mo, 10)); }
function bizFmt(s) { const d = digits(s); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : (s || ''); }
function tempPassword() { const a = 'abcdefghjkmnpqrstuvwxyz', n = '23456789'; let s = ''; const r = crypto.getRandomValues(new Uint32Array(10)); for (let i = 0; i < 10; i++) s += (i < 4 ? a : n)[r[i] % (i < 4 ? a.length : n.length)]; return s; }

const ST = { '접수': ['st-new', '접수'], '확인': ['st-conf', '주문확인'], '출고': ['st-ship', '출고완료'], '완료': ['st-done', '배송완료'], '취소': ['st-cancel', '취소'] };
const pill = s => `<span class="pill ${ST[s]?.[0] || ''}">${esc(ST[s]?.[1] || s)}</span>`;
const RQ = { '요청': ['st-new', '요청'], '확인': ['st-conf', '확인 중'], '입고완료': ['st-ship', '입고 완료'], '불가': ['st-cancel', '보유 불가'], '취소': ['st-done', '취소'] };
const rqPill = s => `<span class="pill ${RQ[s]?.[0] || ''}">${esc(RQ[s]?.[1] || s)}</span>`;
const TI = { '대기': ['st-new', '발행 대기'], '발행중': ['st-conf', '발행 중'], '발행완료': ['st-ship', '발행 완료'], '실패': ['st-cancel', '실패'], '취소': ['st-done', '취소됨'] };
const tiPill = s => `<span class="pill ${TI[s]?.[0] || ''}">${esc(TI[s]?.[1] || s)}</span>`;
const KINDS = ['의약품', '의료소모품', '의약외품'];
const ACC_TYPES = ['약국', '치과', '의원', '병원', '한의원', '기타'];
const PAY_METHODS = ['계좌이체', '카드', '현금', '어음', '상계'];

/* ---------- state ---------- */
const S = {
  phase: 'loading', user: null, profile: null,
  settings: {}, products: new Map(), rx: new Map(), accounts: new Map(), profiles: new Map(), special: new Map(),
  orders: new Map(), shipments: new Map(), payments: new Map(), moves: new Map(), invoices: new Map(), reqs: new Map(), taxcfg: {}, tax: null,
  myAccount: null, busy: false, view: LS.get('view', 'dash'), cview: 'shop',
  ui: {
    lg: { id: '', pw: '' }, su: {}, np: {},
    ostatus: '접수', oq: '', pq: '', pkind: '', pgroup: '', aq: '',
    shopQ: '', shopChip: '전체', shopGroup: '',
    exFrom: thisMonth() + '-01', exTo: today(), settleMonth: thisMonth(),
    invMonth: (new Date().getDate() <= 10 ? prevMonth() : thisMonth()), invStatus: '',
    rqStatus: '대기', rqq: '', drugMore: false, drugTestQ: '타이레놀', setd: null, open: {}, armed: '', lastCreds: null
  },
  cart: {}, favs: new Set(LS.get('favs', [])),
  drugOn: null, dq: {}, drugCache: new Map(), drugItems: new Map()
};
const M = { kind: null, data: null, draft: {}, live: false, size: '', busy: false, armed: '' };

/* ---------- render plumbing ---------- */
let raf = 0;
function schedule() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); if (M.kind && M.live) renderModal(); }); }
function withFocus(root, fn) {
  const a = document.activeElement; const id = a && a.id && root.contains(a) ? a.id : null; let s0 = null, s1 = null;
  try { s0 = a.selectionStart; s1 = a.selectionEnd; } catch {}
  const keep = [...root.querySelectorAll('[data-keep]')].map(el => [el.dataset.keep, el.scrollTop, el.scrollLeft]);
  fn();
  for (const [k, t, l] of keep) { const el = root.querySelector(`[data-keep="${k}"]`); if (el) { el.scrollTop = t; el.scrollLeft = l; } }
  if (id) { const el = document.getElementById(id); if (el) { el.focus({ preventScroll: true }); try { if (s0 != null) el.setSelectionRange(s0, s1); } catch {} } }
}
function render() { withFocus(app, () => { app.innerHTML = view(); }); }
function renderModal() {
  if (!M.kind) { modalRoot.innerHTML = ''; document.body.classList.remove('modal-open'); return; }
  document.body.classList.add('modal-open');
  withFocus(modalRoot, () => { modalRoot.innerHTML = `<div class="scrim" data-act="closeModal"></div><div class="dlg ${M.size}" role="dialog" aria-modal="true" aria-labelledby="dlg-t">${MODALS[M.kind]()}</div>`; });
}
function openModal(kind, data = {}, draft = {}, opts = {}) {
  M.kind = kind; M.data = data; M.draft = draft; M.live = !!opts.live; M.size = opts.size || ''; M.busy = false; M.armed = '';
  renderModal();
  setTimeout(() => { const f = modalRoot.querySelector('[autofocus]') || modalRoot.querySelector('.dlg-b input, .dlg-b select, .dlg-b textarea') || modalRoot.querySelector('.x'); f?.focus(); }, 0);
}
function closeModal() { M.kind = null; M.data = null; M.draft = {}; renderModal(); }
function toast(msg, kind = '') {
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg; toastRoot.appendChild(el);
  while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3200);
}
const fail = msg => { const e = new Error(msg); e.userMsg = msg; return e; };
function errMsg(e) {
  if (!e) return '처리하지 못했어요';
  if (e.userMsg) return e.userMsg;
  const m = String(e.message || e.error_description || e.msg || e);
  if (/row-level security|permission denied/i.test(m)) return '권한이 없어요';
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(m)) return '인터넷 연결을 확인해 주세요';
  if (/JWT|refresh token|not authenticated/i.test(m)) return '로그인이 만료됐어요. 다시 로그인해 주세요.';
  if (/duplicate key/i.test(m)) return '이미 있는 값이에요';
  return m.length <= 140 ? m : '처리하지 못했어요. 다시 시도해 주세요.';
}

/* ---------- data access ---------- */
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
const rpc = (name, args) => q(sb.rpc(name, args));
async function fn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) { let msg = error.message; try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch {} throw fail(msg || '서버에 연결하지 못했어요'); }
  if (data && data.error) throw fail(data.error);
  return data;
}
function mapInto(map, rows, key = 'id') { map.clear(); for (const r of rows || []) map.set(r[key], r); }
const L = {
  settings: async () => { S.settings = (await q(sb.from('settings').select('*').eq('id', 1).maybeSingle())) || {}; },
  products: async () => mapInto(S.products, await q(sb.from('products').select('*').order('name'))),
  rx: async () => mapInto(S.rx, await q(sb.from('product_rx').select('*')), 'product_id'),
  accounts: async () => { mapInto(S.accounts, await q(sb.from('accounts').select('*').order('name'))); if (S.profile?.role === 'customer') S.myAccount = [...S.accounts.values()][0] || null; },
  profiles: async () => mapInto(S.profiles, await q(sb.from('profiles').select('*').order('created_at')), 'user_id'),
  special: async () => { const rows = await q(sb.from('special_prices').select('*')); S.special = new Map(); for (const r of rows) { if (!S.special.has(r.account_id)) S.special.set(r.account_id, {}); S.special.get(r.account_id)[r.product_id] = num(r.price); } },
  orders: async () => mapInto(S.orders, await q(sb.from('orders').select('*').order('created_at', { ascending: false }).limit(1000))),
  shipments: async () => mapInto(S.shipments, await q(sb.from('shipments').select('*').order('date', { ascending: false }).limit(3000)), 'order_id'),
  payments: async () => mapInto(S.payments, await q(sb.from('payments').select('*').order('date', { ascending: false }).limit(2000))),
  moves: async () => mapInto(S.moves, await q(sb.from('stock_moves').select('*').order('created_at', { ascending: false }).limit(300))),
  invoices: async () => mapInto(S.invoices, await q(sb.from('tax_invoices').select('*').order('created_at', { ascending: false }).limit(1000))),
  reqs: async () => mapInto(S.reqs, await q(sb.from('stock_requests').select('*').order('created_at', { ascending: false }).limit(1000))),
  taxcfg: async () => { S.taxcfg = (await q(sb.from('tax_config').select('*').eq('id', 1).maybeSingle())) || {}; }
};
async function reload(...names) {
  try { await Promise.all(names.map(n => L[n] && L[n]())); } catch (e) { console.warn('reload', names, e); toast(errMsg(e), 'bad'); }
  schedule();
}
let rtTimer = 0; const rtPending = new Set(); let channel = null;
function subscribeRealtime() {
  if (channel) return;
  const map = S.profile.role === 'admin' ? { orders: ['orders', 'shipments'], products: ['products'], tax_invoices: ['invoices', 'shipments'], stock_requests: ['reqs'] } : { orders: ['orders'], products: ['products'], tax_invoices: ['invoices'], stock_requests: ['reqs'] };
  channel = sb.channel('wymp-live');
  for (const t of Object.keys(map)) channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => { map[t].forEach(n => rtPending.add(n)); clearTimeout(rtTimer); rtTimer = setTimeout(() => { const ns = [...rtPending]; rtPending.clear(); reload(...ns); }, 500); });
  channel.subscribe();
  setInterval(() => { if (document.visibilityState === 'visible') reload(...(S.profile.role === 'admin' ? ['orders', 'shipments', 'invoices', 'reqs'] : ['orders', 'invoices', 'reqs', 'products'])); }, 90000);
}

/* ---------- auth flow ---------- */
const emailOf = id => `${String(id).trim().toLowerCase()}@${CFG.loginDomain}`;
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && S.phase !== 'login' && S.phase !== 'setup') location.reload(); });
  if (!session) return toLogin();
  await enter(session.user);
}
async function toLogin() {
  S.phase = 'loading'; render();
  let exists = true;
  try { exists = await rpc('admin_exists'); } catch (e) { console.warn(e); }
  S.phase = exists === false ? 'setup' : 'login'; render();
  setTimeout(() => document.getElementById(S.phase === 'setup' ? 'su-id' : 'lg-id')?.focus(), 0);
}
async function enter(user) {
  S.user = user; S.phase = 'loading'; render();
  try {
    S.profile = await q(sb.from('profiles').select('*').eq('user_id', user.id).maybeSingle());
    if (!S.profile) { S.phase = 'nolink'; render(); return; }
    if (!S.profile.active) { await sb.auth.signOut(); S.phase = 'login'; render(); toast('사용이 중지된 계정이에요. 원윤메디팜에 문의해 주세요.', 'bad'); return; }
    if (S.profile.temp_pw) { S.phase = 'temppw'; render(); return; }
    if (S.profile.role === 'admin') {
      await Promise.all([L.settings(), L.products(), L.rx(), L.accounts(), L.profiles(), L.special(), L.orders(), L.shipments(), L.payments(), L.moves(), L.invoices(), L.reqs(), L.taxcfg()]);
      S.phase = 'admin';
      loadTaxStatus(false);
    } else {
      await Promise.all([L.settings(), L.products(), L.accounts(), L.special(), L.orders(), L.invoices(), L.reqs()]);
      if (!S.myAccount) { S.phase = 'nolink'; render(); return; }
      S.phase = 'customer';
    }
    subscribeRealtime();
    loadDrugStatus(false);
  } catch (e) { console.error(e); S.phase = 'error'; S.err = errMsg(e); }
  render();
}
async function loadTaxStatus(showErr) {
  try { S.tax = await fn('tax-invoice', { action: 'status' }); schedule(); }
  catch (e) { S.tax = { error: errMsg(e) }; if (showErr) toast(errMsg(e), 'bad'); schedule(); }
}

/* ---------- 식약처 의약품 정보 ---------- */
async function loadDrugStatus(showErr) {
  try { const r = await fn('drug-info', { action: 'status' }); S.drugOn = !!r.hasKey; }
  catch (e) { S.drugOn = false; if (showErr) toast(errMsg(e), 'bad'); }
  schedule();
}
const normN = s => String(s || '').replace(/\([^)]*\)/g, '').replace(/[\s·.,/_-]/g, '').toLowerCase();
function catalogMatch(d) {
  const ps = products().filter(p => p.active !== false);
  return (d.edi?.length && ps.find(p => p.code && d.edi.includes(normCode(p.code)))) || ps.find(p => normN(p.name) === normN(d.name)) || null;
}
let drugTimer = 0;
function drugSoon(target = 'shop') { clearTimeout(drugTimer); drugTimer = setTimeout(() => runDrug(target === 'test' ? S.ui.drugTestQ : S.ui.shopQ, target), 650); }
async function runDrug(q, target = 'shop') {
  if (!S.drugOn) return;
  q = String(q || '').replace(/\s+/g, ' ').trim();
  if (q.replace(/\s/g, '').length < 2) { S.dq[target] = null; schedule(); return; }
  const hit = S.drugCache.get(q);
  if (hit) { S.dq[target] = { q, status: 'done', ...hit }; schedule(); return; }
  S.dq[target] = { q, status: 'loading' }; S.ui.drugMore = false; schedule();
  try {
    const r = await fn('drug-info', { action: 'search', q });
    if (r.needsKey) { S.drugOn = false; S.dq[target] = null; schedule(); return; }
    const res = { items: r.items || [], total: r.total || 0, warnings: r.warnings || [] };
    S.drugCache.set(q, res); for (const d of res.items) if (!S.drugItems.has(d.seq)) S.drugItems.set(d.seq, d);
    if (S.dq[target]?.q === q) S.dq[target] = { q, status: 'done', ...res };
  } catch (e) { if (S.dq[target]?.q === q) S.dq[target] = { q, status: 'error', err: errMsg(e) }; }
  schedule();
}
const kindTag = k => /전문/.test(k || '') ? '<span class="tag info">전문</span>' : /일반/.test(k || '') ? '<span class="tag">일반</span>' : '';
function drugAction(d, p, where) {
  const admin = S.profile?.role === 'admin';
  if (p) {
    if (admin) return orderable(p) ? '<span class="avail ok">우리 상품</span>' : '<span class="avail out">우리 상품 · 품절</span>';
    if (orderable(p)) {
      if (where === 'modal') return `<button class="btn primary" data-act="drugAdd" data-id="${esc(p.id)}">장바구니에 담기</button>`;
      const key = S.myAccount.id; const qv = cartOf(key).lines[p.id] || 0; const step = Math.max(1, num(p.step) || 1);
      return `<div class="qty"><button data-act="qty" data-key="${esc(key)}" data-id="${esc(p.id)}" data-d="-${step}" aria-label="${esc(p.name)} 수량 빼기">−</button><input id="dq-${esc(p.id)}" inputmode="numeric" autocomplete="off" data-cartqty="${esc(p.id)}" data-key="${esc(key)}" value="${qv || ''}" placeholder="0" aria-label="${esc(p.name)} 주문 수량"><button data-act="qty" data-key="${esc(key)}" data-id="${esc(p.id)}" data-d="${step}" aria-label="${esc(p.name)} 수량 더하기">+</button></div>`;
    }
    return myOpenReq(p.id) ? '<span class="tag gold">재고 요청함</span>' : `<button class="btn${where === 'modal' ? ' primary' : ' sm'}" data-act="reqStock" data-id="${esc(p.id)}">재고 요청</button>`;
  }
  if (admin) return `<button class="btn${where === 'modal' ? ' primary' : ' sm'}" data-act="newFromDrug" data-seq="${esc(d.seq)}">상품으로 등록</button>`;
  return [...S.reqs.values()].some(r => r.ext_seq === d.seq && isOpenReq(r)) ? '<span class="tag gold">보유 요청함</span>' : `<button class="btn${where === 'modal' ? ' primary' : ' sm'}" data-act="reqDrug" data-seq="${esc(d.seq)}">보유 요청</button>`;
}
function drugPanel(target) {
  const st = S.dq[target]; if (!S.drugOn || !st) return '';
  const head = `<div class="dinfo-h"><h3>식약처 의약품 정보</h3><span class="hint">'${esc(st.q)}' 검색 결과 · 식품의약품안전처 공공데이터</span></div>`;
  if (st.status === 'loading') return `<section class="dinfo">${head}<div class="loading dinfo-pad"><i></i>식약처 자료를 찾는 중</div></section>`;
  if (st.status === 'error') return `<section class="dinfo">${head}<p class="dinfo-pad muted">식약처 자료를 불러오지 못했어요. ${esc(st.err || '')}</p></section>`;
  const warn = S.profile?.role === 'admin' && st.warnings?.length ? `<div class="note warn" style="margin:14px 20px 0"><b>확인이 필요해요</b>${st.warnings.map(esc).join(' / ')}</div>` : '';
  if (!st.items.length) return `<section class="dinfo">${head}${warn}<p class="dinfo-pad muted">식약처 자료에서도 찾지 못했어요. 제품명이나 성분명을 다르게 적어 보세요.</p></section>`;
  const rank = x => x.p ? (orderable(x.p) ? 0 : 1) : 2;
  const list = st.items.map(d => ({ d, p: catalogMatch(d) })).sort((a, b) => rank(a) - rank(b));
  const shown = S.ui.drugMore ? list : list.slice(0, 6);
  return `<section class="dinfo">${head}${warn}${shown.map(({ d, p }) => `<article class="dcard">
      <button class="dimg" data-act="drugDetail" data-seq="${esc(d.seq)}" aria-label="${esc(d.name)} 자세히">${d.image ? `<img src="${esc(d.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span>사진 없음</span>'}</button>
      <div class="dmain"><div class="dname"><button class="dlink" data-act="drugDetail" data-seq="${esc(d.seq)}">${esc(d.name)}</button> ${kindTag(d.kind)}</div>
        <div class="dmeta">${meta(esc(d.company || ''), esc(d.ingr || d.strength || ''))}</div>
        ${d.summary ? `<p class="dsum">${esc(d.summary)}</p>` : ''}
        ${p ? `<div class="dmatch">원윤메디팜 취급 품목 · ${esc(p.name)}${p.spec ? ' ' + esc(p.spec) : ''}</div>` : ''}</div>
      <div class="dact">${drugAction(d, p, 'card')}</div></article>`).join('')}
    ${list.length > shown.length ? `<div class="dinfo-pad"><button class="btn sm ghost" data-act="drugMore">${list.length - shown.length}개 더 보기</button></div>` : ''}
    ${st.total > st.items.length ? `<p class="dinfo-pad hint">식약처 자료 ${won(st.total)}건 중 ${st.items.length}건만 보여요. 제품명을 더 자세히 적으면 정확해져요.</p>` : ''}
  </section>`;
}
function openDrug(seq, pid) {
  openModal('drug', { seq: seq || null, pid: pid || null, item: seq ? S.drugItems.get(seq + ':full') || null : null, err: '' }, {}, { size: 'wide' });
  loadDrug();
}
async function loadDrug() {
  const m = M.data; if (!m || M.kind !== 'drug' || m.item) return;
  try {
    if (!m.seq && m.pid) {
      const p = S.products.get(m.pid);
      const r = await fn('drug-info', { action: 'match', code: p?.code || '', name: p?.name || '' });
      if (M.data !== m) return;
      if (!r.seq) { m.err = '식약처 자료에서 이 품목을 정확히 찾지 못했어요. 주문하기 검색창에 이름을 넣으면 비슷한 품목을 볼 수 있어요.'; renderModal(); return; }
      m.seq = r.seq;
    }
    const r = await fn('drug-info', { action: 'detail', seq: m.seq });
    if (M.data !== m) return;
    m.item = r.item; S.drugItems.set(m.seq + ':full', r.item); renderModal();
  } catch (e) { if (M.data === m) { m.err = errMsg(e); renderModal(); } }
}
const findDrug = seq => S.drugItems.get(seq + ':full') || S.drugItems.get(seq);

/* ---------- derived ---------- */
const products = () => [...S.products.values()];
const allOrders = () => [...S.orders.values()];
const pendingReqCount = () => [...S.reqs.values()].filter(r => r.status === '요청').length;
const isOpenReq = r => r.status === '요청' || r.status === '확인';
const myOpenReq = pid => [...S.reqs.values()].find(r => r.product_id === pid && isOpenReq(r));
const orderable = p => !!p && p.active !== false && !p.soldout && (!p.track || num(p.stock) > 0);
const reqSeenKey = () => 'reqSeen:' + (S.profile?.user_id || '');
const newlyResolved = () => { const seen = Date.parse(LS.get(reqSeenKey(), '') || '') || 0; return [...S.reqs.values()].filter(r => (r.status === '입고완료' || r.status === '불가') && r.resolved_at && Date.parse(r.resolved_at) > seen); };
function availTag(p) {
  if (!orderable(p)) return `<span class="avail out">주문 불가</span><small>${p.soldout ? '일시 품절' : '품절'}</small>`;
  if (p.track && num(p.safety) > 0 && num(p.stock) < num(p.safety)) return '<span class="avail low">주문 가능</span><small>재고 적음</small>';
  return '<span class="avail ok">주문 가능</span>';
}
const vatIncl = () => S.settings.vat_included !== false;
function vatSplit(total) { total = Math.round(num(total)); if (vatIncl()) { const supply = Math.round(total / 1.1); return { supply, vat: total - supply, sum: total }; } const vat = Math.round(total * 0.1); return { supply: total, vat, sum: total + vat }; }
function priceFor(p, ctx) { const sp = ctx?.special?.[p.id]; if (sp != null && sp !== '') return num(sp); const d = num(ctx?.discount); return Math.round(num(p.price) * (1 - d / 100)); }
const sumLines = ls => ls.reduce((a, l) => a + num(l.qty) * num(l.price), 0);
function balanceOf(aid) { let ship = 0, paid = 0; for (const s of S.shipments.values()) if (s.account_id === aid) ship += num(s.total); for (const p of S.payments.values()) if (p.account_id === aid) paid += num(p.amount); return { ship, paid, bal: ship - paid }; }
function liveLots(p) { return (p.lots || []).filter(l => num(l.qty) > 0).sort((a, b) => ko(a.exp || '9999', b.exp || '9999')); }
function stockTag(p, forCustomer) {
  if (p.soldout) return '<span class="tag bad">일시 품절</span>';
  if (!p.track) return forCustomer ? '' : '<span class="tag">미관리</span>';
  const s = num(p.stock);
  if (s <= 0) return '<span class="tag bad">품절</span>';
  if (num(p.safety) > 0 && s < num(p.safety)) return forCustomer ? '<span class="tag warn">재고 적음</span>' : `<span class="tag warn tabnum">${won(s)}</span>`;
  return forCustomer ? '<span class="tag ok">재고 있음</span>' : `<span class="tag ok tabnum">${won(s)}</span>`;
}
function stockAlerts() {
  const out = [];
  for (const p of products()) {
    if (p.active === false || !p.track) continue;
    const s = num(p.stock), need = num(S.rx.get(p.id)?.qty);
    if (s <= 0) out.push({ p, tone: 'bad', label: '품절', sub: need ? `월 처방량 ${won(need)}${p.unit || ''}` : '재고 0' });
    else if (num(p.safety) && s < num(p.safety)) out.push({ p, tone: 'warn', label: '안전재고 미만', sub: `재고 ${won(s)} / 안전 ${won(p.safety)}` });
    else if (need && s < need) out.push({ p, tone: 'warn', label: '한 달 치 부족', sub: `재고 ${won(s)} / 월 처방 ${won(need)}` });
    const lot = liveLots(p)[0];
    if (lot && daysUntil(lot.exp) <= 180) out.push({ p, tone: daysUntil(lot.exp) <= 60 ? 'bad' : 'warn', label: daysUntil(lot.exp) < 0 ? '유효기간 지남' : `유효기간 D-${daysUntil(lot.exp)}`, sub: `로트 ${lot.lot || '-'} · ${won(lot.qty)}${p.unit || ''}` });
  }
  return out.sort((a, b) => (a.tone === 'bad' ? 0 : 1) - (b.tone === 'bad' ? 0 : 1));
}
function custCtx() { const a = S.myAccount || {}; return { account_id: a.id, name: a.name, discount: num(a.discount), special: S.special.get(a.id) || {} }; }
function cartOf(key) { if (!S.cart[key]) { const c = LS.get('cart:' + key, null); S.cart[key] = c && c.lines ? c : { lines: {}, want_date: '', memo: '' }; } return S.cart[key]; }
const saveCart = key => LS.set('cart:' + key, S.cart[key]);
function setQty(key, pid, qv) { const c = cartOf(key); qv = Math.max(0, Math.floor(num(qv))); if (qv > 0) c.lines[pid] = qv; else delete c.lines[pid]; saveCart(key); }
const cartCount = key => key ? Object.keys(cartOf(key).lines).length : 0;
function invoiceProblems(t) {
  const st = S.settings, sp = t?.supplied || {}, out = [];
  if (digits(st.biz_no).length !== 10) out.push(['설정', '원윤메디팜 사업자등록번호']);
  if (!String(st.ceo || '').trim()) out.push(['설정', '원윤메디팜 대표자']);
  if (!String(st.tax_email || '').trim()) out.push(['설정', '원윤메디팜 세금계산서 이메일']);
  const sid = digits(sp.identificationNumber);
  if (t && sid.length !== 10 && sid.length !== 13) out.push(['거래처', '거래처 사업자등록번호']);
  if (t && !String(sp.representativeName || '').trim()) out.push(['거래처', '거래처 대표자']);
  if (t && !sp.managers?.[0]?.email) out.push(['거래처', '거래처 세금계산서 이메일']);
  return out;
}

/* ---------- top-level views ---------- */
const MARK = '<svg viewBox="0 0 100 95.79" fill="currentColor" aria-hidden="true" focusable="false"><rect x="1.73" y="1.73" width="96.54" height="92.33" rx="6.97" fill="none" stroke="currentColor" stroke-width="3.46"/><path d="M45.09 22.36 L63.52 50.33 L63.52 73.81 L67.26 73.90 L67.54 50.05 L85.69 22.54 L81.01 22.64 L65.39 46.02 L49.49 22.45 Z M21.05 22.45 L20.95 73.43 L22.08 73.90 L39.01 52.67 L54.72 73.62 L59.49 73.90 L39.01 46.49 L24.60 63.61 L24.70 22.64 Z"/></svg>';
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" stroke-linejoin="round"/></svg>';
const markImg = (size = 36) => `<span class="mark" style="width:${size}px">${MARK}</span>`;
const brand = (sub) => `<div class="brand">${markImg(34)}<div><div class="wm">WONYUN MEDIPHARM</div><div class="wm-sub">${esc(sub || '거래처 주문')}</div></div></div>`;
const gate = (body) => `<div class="gate"><aside class="gate-brand"><div class="gate-motif" aria-hidden="true">${MARK}</div><div class="gate-id">${markImg(60)}<div class="wm">WONYUN MEDIPHARM</div><div class="tagline">Pharmaceutical Wholesale</div></div><p class="gate-note">약국·병의원 거래처 전용<br>의약품·의료소모품 주문</p></aside><main class="gate-main"><div class="gate-card">${body}</div></main></div>`;
function view() {
  switch (S.phase) {
    case 'login': return loginView();
    case 'setup': return setupView();
    case 'temppw': return tempPwView();
    case 'nolink': return gate(`<h1>주문 권한이 없는 계정이에요</h1><p class="lead">이 계정은 거래처와 연결되어 있지 않아요. 원윤메디팜에 문의해 주세요.</p><button class="btn block" data-act="logout">다른 아이디로 로그인</button>`);
    case 'error': return gate(`<h1>불러오지 못했어요</h1><p class="lead">${esc(S.err || '')}</p><button class="btn primary block" data-act="reloadPage">새로 고침</button><button class="btn ghost block" data-act="logout">로그아웃</button>`);
    case 'admin': return adminView();
    case 'customer': return customerView();
    default: return gate(`<div class="loading"><i></i>불러오는 중</div>`);
  }
}
function loginView() {
  const d = S.ui.lg;
  return gate(`<h1>거래처 로그인</h1><p class="lead">원윤메디팜에서 받은 아이디로 들어오세요.</p>
    <form class="stack" style="gap:12px" data-form="login" novalidate>
      <label class="fld" for="lg-id"><span>아이디</span><input class="inp lg" id="lg-id" data-bind="lg.id" data-norender autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(d.id)}"></label>
      <label class="fld" for="lg-pw"><span>비밀번호</span><input class="inp lg" id="lg-pw" type="password" data-bind="lg.pw" data-norender autocomplete="current-password" value="${esc(d.pw)}"></label>
      <button class="btn primary lg block" type="submit"${S.busy ? ' disabled' : ''}>${S.busy ? '로그인하는 중…' : '로그인'}</button>
    </form>
    <p class="gate-foot">비밀번호를 잊었다면 원윤메디팜에 재설정을 요청해 주세요.</p>`);
}
function setupView() {
  const d = S.ui.su;
  return gate(`<h1>관리자 계정 만들기</h1><p class="lead">처음 한 번만 나오는 화면이에요. 원윤메디팜 관리자가 쓸 아이디와 비밀번호를 정해 주세요.</p>
    <form class="stack" style="gap:12px" data-form="setup" novalidate>
      <label class="fld" for="su-id"><span>관리자 아이디 (영문 소문자·숫자)</span><input class="inp lg" id="su-id" data-bind="su.id" data-norender autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(d.id || '')}" placeholder="예: wonyun"></label>
      <label class="fld" for="su-name"><span>이름</span><input class="inp" id="su-name" data-bind="su.name" data-norender value="${esc(d.name || '')}"></label>
      <label class="fld" for="su-pw"><span>비밀번호 (8자 이상)</span><input class="inp lg" id="su-pw" type="password" data-bind="su.pw" data-norender autocomplete="new-password"></label>
      <label class="fld" for="su-pw2"><span>비밀번호 확인</span><input class="inp lg" id="su-pw2" type="password" data-bind="su.pw2" data-norender autocomplete="new-password"></label>
      <button class="btn primary lg block" type="submit"${S.busy ? ' disabled' : ''}>${S.busy ? '만드는 중…' : '관리자 계정 만들고 시작하기'}</button>
    </form>`);
}
function tempPwView() {
  return gate(`<h1>새 비밀번호를 정해 주세요</h1><p class="lead">임시 비밀번호로 로그인했어요. 계속하려면 나만 아는 비밀번호로 바꿔 주세요.</p>
    <form class="stack" style="gap:12px" data-form="temppw" novalidate>
      <label class="fld" for="np-1"><span>새 비밀번호 (8자 이상)</span><input class="inp lg" id="np-1" type="password" data-bind="np.a" data-norender autocomplete="new-password"></label>
      <label class="fld" for="np-2"><span>새 비밀번호 확인</span><input class="inp lg" id="np-2" type="password" data-bind="np.b" data-norender autocomplete="new-password"></label>
      <button class="btn primary lg block" type="submit"${S.busy ? ' disabled' : ''}>${S.busy ? '바꾸는 중…' : '비밀번호 바꾸고 계속'}</button>
    </form><button class="btn ghost block" data-act="logout">로그아웃</button>`);
}
const meta = (...xs) => `<span class="meta">${xs.filter(Boolean).map(x => `<span>${x}</span>`).join('')}</span>`;
const head = (title, sub = '', actions = '') => `<header class="ph"><div><h1>${title}</h1>${sub ? `<p class="ph-sub">${sub}</p>` : ''}</div>${actions ? `<div class="ph-act">${actions}</div>` : ''}</header>`;

/* ---------- admin ---------- */
const NAV = [['dash', '현황'], ['orders', '주문 처리'], ['products', '상품·재고'], ['reqs', '재고 요청'], ['accounts', '거래처'], ['invoices', '세금계산서'], ['settle', '정산·미수'], ['export', '엑셀 내려받기'], ['settings', '설정']];
function adminView() {
  const all = allOrders();
  const invWait = [...S.invoices.values()].filter(t => t.status === '대기' || t.status === '실패' || t.status === '발행중').length;
  const counts = { orders: all.filter(o => o.status === '접수' || o.status === '확인').length, invoices: invWait, reqs: pendingReqCount() };
  const v = NAV.some(n => n[0] === S.view) ? S.view : 'dash';
  const body = { dash: dashView, orders: ordersView, products: productsView, reqs: reqsView, accounts: accountsView, invoices: invoicesView, settle: settleView, export: exportView, settings: settingsView }[v]();
  return `<div class="shell"><aside class="side"><div class="side-top">${brand('관리자')}<button class="btn sm m-logout" data-act="logout">로그아웃</button></div><nav class="nav" aria-label="관리 메뉴">${NAV.map(([k, l]) => `<button class="nav-i${v === k ? ' on' : ''}" data-act="go" data-v="${k}"${v === k ? ' aria-current="page"' : ''}>${l}${counts[k] ? `<span class="cnt">${counts[k]}</span>` : ''}</button>`).join('')}</nav><div class="side-foot"><span><b>${esc(S.profile.name || S.profile.login_id)}</b> 관리자</span><button class="linkbtn" data-act="logout">로그아웃</button></div></aside><main class="main">${body}</main></div>`;
}

function dashView() {
  const all = allOrders();
  const nNew = all.filter(o => o.status === '접수'), nConf = all.filter(o => o.status === '확인');
  const m = thisMonth(); const Sh = [...S.shipments.values()];
  const monAmt = Sh.filter(s => (s.date || '').startsWith(m)).reduce((a, s) => a + num(s.total), 0);
  const monCnt = Sh.filter(s => (s.date || '').startsWith(m)).length;
  let totalBal = 0, overCnt = 0; for (const a of S.accounts.values()) { const b = balanceOf(a.id).bal; totalBal += b; if (num(a.credit_limit) > 0 && b > num(a.credit_limit)) overCnt++; }
  const queue = [...nNew, ...nConf].sort((a, b) => ko(a.created_at, b.created_at)).slice(0, 8);
  const alerts = stockAlerts();
  const pm = prevMonth(); const dl = invoiceDeadline(pm);
  const uninv = Sh.filter(s => (s.date || '').startsWith(pm) && !s.invoice_id).length;
  const custLogins = [...S.profiles.values()].filter(p => p.role === 'customer').length;
  const setupItems = [
    [digits(S.settings.biz_no).length === 10 && S.settings.ceo, '설정에서 회사 정보(사업자번호·대표자·입금 계좌)를 입력해요.', 'settings'],
    [S.accounts.size > 0, '거래처를 등록하고 사업자번호·세금계산서 이메일을 넣어요.', 'accounts'],
    [custLogins > 0, '거래처 화면의 로그인 계정에서 아이디를 발급해 거래처에 전달해요.', 'accounts'],
    [S.tax?.hasKey && S.taxcfg?.issuer_id, '설정 → 세금계산서 연동에서 볼타 키, 발급자, 공동인증서를 등록해요.', 'settings']
  ];
  const setup = setupItems.some(x => !x[0]) ? `<section class="panel"><div class="panel-h"><h2>처음 시작할 때</h2><span class="muted">${setupItems.filter(x => x[0]).length}/${setupItems.length} 완료</span></div><ul class="list">${setupItems.map(([ok, t, v]) => `<li class="li${ok ? '' : ' click'}"${ok ? '' : ` data-act="go" data-v="${v}" role="button" tabindex="0"`}><span class="tag ${ok ? 'ok' : 'warn'}">${ok ? '완료' : '할 일'}</span><div class="li-main" style="white-space:normal">${t}</div></li>`).join('')}</ul></section>` : '';
  return head('오늘의 주문 현황', meta(`${fmtD(today())} 기준`, `상품 ${S.products.size}개`, `거래처 ${S.accounts.size}곳`), `<button class="btn primary" data-act="go" data-v="orders">주문 처리</button>`) + `
  <div class="stack">
    <div class="kpis">
      <button class="kpi${nNew.length ? ' alert' : ''}" data-act="goOrders" data-s="접수"><span class="k">확인 대기</span><span class="v">${nNew.length}<small>건</small></span><span class="s">거래처가 새로 넣은 주문</span></button>
      <button class="kpi" data-act="goOrders" data-s="확인"><span class="k">출고 대기</span><span class="v">${nConf.length}<small>건</small></span><span class="s">확인 끝, 출고 전</span></button>
      <div class="kpi"><span class="k">이번 달 출고액</span><span class="v">${won(monAmt)}<small>원</small></span><span class="s">${monCnt}건 출고</span></div>
      <button class="kpi${overCnt ? ' alert' : ''}" data-act="go" data-v="settle"><span class="k">미수 잔액</span><span class="v">${won(totalBal)}<small>원</small></span><span class="s">${overCnt ? `여신한도 초과 ${overCnt}곳` : '거래처 전체 합계'}</span></button>
    </div>
    ${setup}
    ${pendingReqCount() ? `<div class="note info"><b>재고 요청 ${pendingReqCount()}건</b>거래처가 품절이거나 취급하지 않는 약품을 요청했어요. <button class="btn sm" data-act="go" data-v="reqs">재고 요청 보기</button></div>` : ''}
    ${uninv && daysUntil(dl) >= 0 ? `<div class="note warn"><b>${pm.slice(5)}월분 세금계산서</b>출고 ${uninv}건이 아직 계산서로 묶이지 않았어요. 월합계 발행 기한은 ${fmtD(dl)}이에요. <button class="btn sm" data-act="goInvoices" data-m="${pm}">세금계산서로 이동</button></div>` : ''}
    <div class="dgrid">
      <div class="stack">
        <section class="panel"><div class="panel-h"><h2>지금 처리할 주문</h2><button class="btn sm ghost" data-act="go" data-v="orders">전체 보기</button></div>
          ${queue.length ? `<ul class="list">${queue.map(o => `<li class="li click" data-act="openOrder" data-id="${esc(o.id)}" role="button" tabindex="0"><div class="li-main"><div class="li-t">${esc(o.cust_name)} <span class="muted mono">${esc(o.no)}</span></div><div class="li-s">${meta(fmtDT(o.created_at), `${(o.lines || []).length}품목`, o.want_date ? `희망 ${fmtD(o.want_date)}` : '')}</div></div><span class="num">${won(o.total)}원</span>${pill(o.status)}</li>`).join('')}</ul>` : `<div class="empty"><b>밀린 주문이 없어요</b>거래처가 주문하면 여기에 먼저 보여요.</div>`}
        </section>
        <section class="panel"><div class="panel-h"><h2>이번 달 일별 출고액</h2><span class="muted tabnum">${m.replace('-', '.')}</span></div><div class="panel-b">${monthChart()}</div></section>
      </div>
      <section class="panel"><div class="panel-h"><h2>재고·유효기간 점검</h2><button class="btn sm ghost" data-act="go" data-v="products">상품·재고</button></div>
        ${alerts.length ? `<ul class="list">${alerts.slice(0, 8).map(a => `<li class="li click" data-act="editStock" data-id="${esc(a.p.id)}" role="button" tabindex="0"><div class="li-main"><div class="li-t">${esc(a.p.name)}</div><div class="li-s">${esc(a.sub)}</div></div><span class="tag ${a.tone}">${esc(a.label)}</span></li>`).join('')}</ul>`
          : `<div class="empty"><b>${products().some(p => p.track) ? '점검할 품목이 없어요' : '재고를 관리하는 품목이 아직 없어요'}</b>${products().some(p => p.track) ? '품절·안전재고 미만·유효기간 180일 이내 품목이 여기에 떠요.' : '상품·재고에서 입고를 등록하면 재고와 유효기간을 추적해요.'}</div>`}
      </section>
    </div>
  </div>`;
}
function monthChart() {
  const t = new Date(); const y = t.getFullYear(), mo = t.getMonth(); const days = new Date(y, mo + 1, 0).getDate(); const key = `${y}-${pad(mo + 1)}`;
  const vals = Array(days).fill(0);
  for (const s of S.shipments.values()) if ((s.date || '').startsWith(key)) { const d = +String(s.date).slice(8, 10); if (d >= 1 && d <= days) vals[d - 1] += num(s.total); }
  const max = Math.max(...vals);
  if (!max) return `<p class="empty-s">출고 처리를 하면 일별 출고액이 막대로 쌓여요.</p>`;
  const W = 640, H = 160, pl = 6, pr = 6, pt = 22, pb = 24, bw = (W - pl - pr) / days;
  const bars = vals.map((v, i) => { const h = v ? Math.max(2, (H - pt - pb) * v / max) : 0; return `<rect class="bar${i + 1 === t.getDate() ? ' today' : ''}" x="${(pl + i * bw + bw * .16).toFixed(1)}" y="${(H - pb - h).toFixed(1)}" width="${(bw * .68).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"><title>${mo + 1}월 ${i + 1}일 ${won(v)}원</title></rect>`; }).join('');
  const ticks = [1, 8, 15, 22, days].map(d => `<text class="tick" x="${(pl + (d - .5) * bw).toFixed(1)}" y="${H - 7}" text-anchor="middle">${d}일</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="이번 달 일별 출고액, 최고 ${won(max)}원"><text class="tick" x="${pl}" y="13">최고 ${won(max)}원</text><line class="base" x1="${pl}" x2="${W - pr}" y1="${H - pb + .5}" y2="${H - pb + .5}"/>${bars}${ticks}</svg>`;
}

function ordersView() {
  const all = allOrders(); const tabs = ['접수', '확인', '출고', '완료', '취소', '전체'];
  const cnt = s => s === '전체' ? all.length : all.filter(o => o.status === s).length;
  const st = S.ui.ostatus;
  let list = st === '전체' ? all : all.filter(o => o.status === st);
  const qq = S.ui.oq.trim().toLowerCase();
  if (qq) list = list.filter(o => [o.no, o.cust_name, o.memo, ...(o.lines || []).map(l => l.name + ' ' + l.code)].join(' ').toLowerCase().includes(qq));
  const oldestFirst = st === '접수' || st === '확인';
  list.sort((a, b) => oldestFirst ? ko(a.created_at, b.created_at) : ko(b.created_at, a.created_at));
  return head('주문 처리', '거래처가 사이트에서 넣은 주문을 확인하고 출고까지 처리해요. 행을 누르면 상세가 열려요.') + `
  <div class="stack">
    <div class="row"><div class="seg" role="tablist">${tabs.map(s => `<button role="tab" aria-selected="${st === s}" class="${st === s ? 'on' : ''}" data-act="ostatus" data-s="${s}">${s === '전체' ? '전체' : ST[s][1]}<span class="c">${cnt(s)}</span></button>`).join('')}</div>
      <div class="search"><label class="sr" for="oq">주문 검색</label><input class="inp" id="oq" data-bind="oq" value="${esc(S.ui.oq)}" placeholder="주문번호·거래처·품목 검색"></div></div>
    ${list.length ? `<div class="tbl-wrap" data-keep="otbl"><table><thead><tr><th>주문번호</th><th>접수 일시</th><th>거래처</th><th>품목</th><th class="num">금액</th><th>희망 배송</th><th>상태</th></tr></thead><tbody>
      ${list.map(o => `<tr class="click" data-act="openOrder" data-id="${esc(o.id)}" role="button" tabindex="0"><td class="mono nowrap">${esc(o.no)}</td><td class="nowrap tabnum">${fmtDT(o.created_at)}</td><td class="nowrap"><div class="t">${esc(o.cust_name)}</div></td><td><div class="s" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((o.lines || [])[0]?.name || '')}${(o.lines || []).length > 1 ? ` 외 ${(o.lines || []).length - 1}건` : ''}</div></td><td class="num">${won(o.total)}</td><td class="nowrap tabnum">${fmtD(o.want_date) || '<span class="muted">-</span>'}</td><td>${pill(o.status)}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="panel"><div class="empty"><b>${qq ? '검색 결과가 없어요' : `${st === '전체' ? '' : ST[st][1] + ' 상태인 '}주문이 없어요`}</b>${qq ? '다른 검색어로 찾아 보세요.' : '거래처가 로그인해 주문하면 여기에 쌓여요.'}</div></div>`}
  </div>`;
}

function reqsView() {
  const all = [...S.reqs.values()];
  const tabs = [['대기', '처리 대기'], ['입고완료', '입고 완료'], ['불가', '보유 불가'], ['취소', '취소'], ['전체', '전체']];
  const match = (r, k) => k === '전체' || (k === '대기' ? isOpenReq(r) : r.status === k);
  const st = S.ui.rqStatus || '대기';
  let list = all.filter(r => match(r, st));
  const qq = S.ui.rqq.trim().toLowerCase();
  if (qq) list = list.filter(r => [r.name, r.spec, r.maker, r.cust_name, r.memo].join(' ').toLowerCase().includes(qq));
  list.sort((a, b) => st === '대기' ? ko(a.created_at, b.created_at) : ko(b.created_at, a.created_at));
  const same = new Map(); for (const r of all) if (isOpenReq(r)) { const k = reqKey(r); same.set(k, (same.get(k) || 0) + 1); }
  return head('재고 요청', '거래처가 품절 품목의 재입고나 목록에 없는 약품의 보유를 요청한 내역이에요. 입고를 등록하거나 일시 품절을 풀면 그 품목 요청은 자동으로 입고 완료돼요.') + `
  <div class="stack">
    <div class="row"><div class="seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${st === k}" class="${st === k ? 'on' : ''}" data-act="rqStatus" data-s="${k}">${l}<span class="c">${all.filter(r => match(r, k)).length}</span></button>`).join('')}</div>
      <div class="search"><label class="sr" for="rqq">요청 검색</label><input class="inp" id="rqq" data-bind="rqq" value="${esc(S.ui.rqq)}" placeholder="품목·거래처 검색"></div></div>
    ${list.length ? `<div class="tbl-wrap" data-keep="rqtbl"><table><thead><tr><th>요청일</th><th>거래처</th><th>품목</th><th>필요 수량</th><th class="num">같은 요청</th><th>상태</th></tr></thead><tbody>
      ${list.map(r => { const n = isOpenReq(r) ? same.get(reqKey(r)) || 1 : 0; return `<tr class="click" data-act="openReq" data-id="${esc(r.id)}" role="button" tabindex="0"><td class="nowrap tabnum">${fmtDT(r.created_at)}</td><td class="nowrap"><div class="t">${esc(r.cust_name)}</div></td><td><div class="t">${esc(r.name)} ${r.kind === '신규' ? '<span class="tag gold">신규 취급</span>' : '<span class="tag">재입고</span>'}</div><div class="s">${meta(esc(r.spec || ''), esc(r.maker || ''), r.memo ? esc(r.memo) : '')}</div></td><td class="nowrap">${esc(r.qty || '-')}</td><td class="num">${n > 1 ? `<span class="tag warn tabnum">${n}곳</span>` : '<span class="muted">-</span>'}</td><td>${rqPill(r.status)}</td></tr>`; }).join('')}
    </tbody></table></div>` : `<div class="panel"><div class="empty"><b>${qq ? '검색 결과가 없어요' : st === '대기' ? '처리할 재고 요청이 없어요' : '해당하는 요청이 없어요'}</b>${qq ? '다른 검색어로 찾아 보세요.' : '거래처가 품절 품목이나 취급하지 않는 약품을 요청하면 여기에 쌓여요.'}</div></div>`}
  </div>`;
}
const reqKey = r => r.product_id || ('n:' + String(r.name || '').replace(/\s/g, '').toLowerCase());

function productsView() {
  let list = products();
  const qq = S.ui.pq.trim().toLowerCase();
  if (qq) list = list.filter(p => [p.name, p.spec, p.code, p.std, p.grp, p.maker].join(' ').toLowerCase().includes(qq));
  if (S.ui.pkind) list = list.filter(p => (p.kind || '의약품') === S.ui.pkind);
  if (S.ui.pgroup) list = list.filter(p => p.grp === S.ui.pgroup);
  list.sort((a, b) => num(S.rx.get(b.id)?.qty) - num(S.rx.get(a.id)?.qty) || ko(a.name, b.name));
  const groups = [...new Set(products().map(p => p.grp).filter(Boolean))].sort(ko);
  const rxMonth = [...S.rx.values()][0]?.month;
  return head('상품·재고', meta(`${S.products.size}개 품목`, rxMonth ? `처방량은 ${rxMonth.replace('-', '년 ')}월 원외처방 통계 기준 (관리자만 보여요)` : ''), `<button class="btn" data-act="importXlsx">엑셀 올리기</button><button class="btn" data-act="exProducts">엑셀 내려받기</button><button class="btn primary" data-act="newProduct">상품 추가</button>`) + `
  <div class="stack">
    <div class="row">
      <div class="search"><label class="sr" for="pq">상품 검색</label><input class="inp" id="pq" data-bind="pq" value="${esc(S.ui.pq)}" placeholder="제품명·성분·보험코드 검색"></div>
      <label class="sr" for="pkind">구분</label><select class="inp" id="pkind" data-bind="pkind" style="width:auto"><option value="">구분 전체</option>${KINDS.map(k => opt(k, S.ui.pkind)).join('')}</select>
      <label class="sr" for="pgroup">효능군</label><select class="inp" id="pgroup" data-bind="pgroup" style="width:auto;max-width:240px"><option value="">효능군 전체</option>${groups.map(g => opt(g, S.ui.pgroup)).join('')}</select>
    </div>
    ${list.length ? `<div class="tbl-wrap" data-keep="ptbl"><table><thead><tr><th>보험코드</th><th>제품명 · 규격</th><th>효능군</th><th class="num">판매가</th><th>재고</th><th class="num">월 처방량</th><th class="num">한 달 치 부족</th><th>가까운 유효기간</th><th></th></tr></thead><tbody>
      ${list.map(p => { const lot = liveLots(p)[0]; const need = num(S.rx.get(p.id)?.qty); const short = p.track && need ? Math.max(0, need - num(p.stock)) : 0; const dd = lot ? daysUntil(lot.exp) : Infinity;
        return `<tr${p.active === false ? ' style="opacity:.55"' : ''}><td class="mono nowrap">${esc(p.code || '-')}</td><td><div class="t">${esc(p.name)}${p.active === false ? ' <span class="tag">판매중지</span>' : ''}${(p.kind && p.kind !== '의약품') ? ` <span class="tag gold">${esc(p.kind)}</span>` : ''}</div><div class="s">${esc(p.spec || '')}${p.maker ? ' · ' + esc(p.maker) : ''}${num(p.step) > 1 ? ` · ${num(p.step)}${esc(p.unit || '')} 단위 주문` : ''}</div></td><td class="s"><div class="cw">${esc(p.grp || '')}</div></td><td class="num"><b>${won(p.price)}</b><div class="s">/${esc(p.unit || '개')}${num(p.base_price) && num(p.base_price) !== num(p.price) ? ` · 기준 ${won(p.base_price)}` : ''}</div></td><td>${stockTag(p)}</td><td class="num">${need ? won(need) : '<span class="muted">-</span>'}</td><td class="num">${short ? `<span class="tag warn tabnum">${won(short)}</span>` : (p.track && need ? '<span class="muted">충분</span>' : '<span class="muted">-</span>')}</td><td class="nowrap">${lot ? `<span class="tag ${dd <= 60 ? 'bad' : dd <= 180 ? 'warn' : ''} tabnum">${fmtD(lot.exp) || '미입력'}</span>` : '<span class="muted">-</span>'}</td><td class="nowrap"><button class="btn sm" data-act="editStock" data-id="${esc(p.id)}">입출고</button> <button class="btn sm ghost" data-act="editProduct" data-id="${esc(p.id)}">수정</button></td></tr>`; }).join('')}
    </tbody></table></div>` : `<div class="panel"><div class="empty"><b>${S.products.size ? '조건에 맞는 상품이 없어요' : '등록된 상품이 없어요'}</b>${S.products.size ? '검색어나 필터를 바꿔 보세요.' : '상품 추가나 엑셀 올리기로 상품을 등록하세요.'}</div></div>`}
    <p class="hint">엑셀 올리기: 매달 받는 원외처방 통계 엑셀(구분·코드·약제명·단가·총 처방량)을 그대로 올리면 처방량과 기준가가 갱신되고, 없는 품목은 새로 추가돼요. 의료소모품은 제품명·규격·판매가 열이 있는 엑셀도 올릴 수 있어요.</p>
  </div>`;
}

function accountsView() {
  let accs = [...S.accounts.values()].sort((a, b) => ko(a.name, b.name));
  const qq = S.ui.aq.trim().toLowerCase();
  if (qq) accs = accs.filter(a => [a.name, a.ykiho, a.biz_no, a.manager, a.tel, a.addr].join(' ').toLowerCase().includes(qq));
  const logins = aid => [...S.profiles.values()].filter(p => p.account_id === aid);
  return head('거래처', '거래처 정보, 할인율·특가, 여신한도, 로그인 아이디를 관리해요.', `<button class="btn primary" data-act="newAccount">거래처 등록</button>`) + `
  <div class="stack">
    <div class="row"><div class="search"><label class="sr" for="aq">거래처 검색</label><input class="inp" id="aq" data-bind="aq" value="${esc(S.ui.aq)}" placeholder="상호·요양기관기호·연락처 검색"></div></div>
    ${accs.length ? `<div class="tbl-wrap" data-keep="atbl"><table><thead><tr><th>거래처</th><th>요양기관기호</th><th>담당 · 연락처</th><th class="num">할인</th><th class="num">여신한도</th><th class="num">미수 잔액</th><th>로그인 아이디</th><th>계산서</th></tr></thead><tbody>
    ${accs.map(a => { const b = balanceOf(a.id).bal; const over = num(a.credit_limit) > 0 && b > num(a.credit_limit); const lg = logins(a.id); const sp = Object.keys(S.special.get(a.id) || {}).length; const taxOk = digits(a.biz_no).length === 10 && a.ceo && a.tax_email;
      return `<tr class="click" data-act="editAccount" data-id="${esc(a.id)}" role="button" tabindex="0"${a.active === false ? ' style="opacity:.55"' : ''}><td><div class="t">${esc(a.name)}</div><div class="s">${esc(a.type || '')}${a.biz_no ? ' · ' + esc(bizFmt(a.biz_no)) : ''}</div></td><td class="mono">${esc(a.ykiho || '-')}</td><td><div>${esc(a.manager || '-')}</div><div class="s tabnum">${esc(a.tel || a.mobile || '')}</div></td><td class="num">${num(a.discount) ? num(a.discount) + '%' : '-'}${sp ? `<div class="s">특가 ${sp}</div>` : ''}</td><td class="num">${num(a.credit_limit) ? won(a.credit_limit) : '<span class="muted">없음</span>'}</td><td class="num">${over ? `<span class="tag bad tabnum">${won(b)}</span>` : won(b)}</td><td>${lg.length ? lg.map(p => `<span class="tag ${p.active ? 'ok' : ''} mono">${esc(p.login_id)}</span>`).join(' ') : '<span class="tag warn">미발급</span>'}</td><td>${taxOk ? `<span class="tag">${esc(a.invoice_cycle)}</span>` : '<span class="tag warn">정보 부족</span>'}</td></tr>`; }).join('')}
    </tbody></table></div>` : `<div class="panel"><div class="empty"><b>${S.accounts.size ? '검색 결과가 없어요' : '등록된 거래처가 없어요'}</b>${S.accounts.size ? '' : '거래처를 등록한 뒤 로그인 아이디를 발급하면, 거래처가 직접 사이트에 들어와 주문해요.'}</div></div>`}
  </div>`;
}

function invoicesView() {
  const m = S.ui.invMonth || thisMonth();
  const ships = [...S.shipments.values()].filter(s => (s.date || '').startsWith(m));
  const uninv = ships.filter(s => !s.invoice_id);
  const uninvAmt = uninv.reduce((a, s) => a + num(s.total), 0);
  let invs = [...S.invoices.values()].filter(t => t.period === m);
  const stF = S.ui.invStatus;
  const counts = { '': invs.filter(t => t.status !== '취소').length }; for (const k of Object.keys(TI)) counts[k] = invs.filter(t => t.status === k).length;
  invs = stF ? invs.filter(t => t.status === stF) : invs.filter(t => t.status !== '취소');
  invs.sort((a, b) => ko(a.supplied?.organizationName, b.supplied?.organizationName));
  const dl = invoiceDeadline(m); const dleft = daysUntil(dl);
  const t = S.tax; const ready = t && t.hasKey && S.taxcfg.issuer_id;
  const waiting = invs.filter(x => x.status === '대기' || x.status === '실패').length;
  const setProblems = invoiceProblems(null);
  return head('세금계산서', `출고내역으로 전자세금계산서를 만들고 볼타를 통해 국세청에 발행해요. 월합계는 다음 달 10일(${fmtD(dl)})까지 발행해야 해요.`, `<button class="btn" data-act="makeDrafts"${uninv.length ? '' : ' disabled'}>계산서 만들기${uninv.length ? ` (${uninv.length}건)` : ''}</button><button class="btn primary" data-act="issueAll"${waiting && ready ? '' : ' disabled'}>대기 ${waiting}건 모두 발행</button>`) + `
  <div class="stack">
    ${!t ? `<div class="note"><span class="loading" style="justify-content:flex-start"><i></i>발행 연동 상태를 확인하는 중</span></div>` : t.error ? `<div class="note bad"><b>연동 확인 실패</b>${esc(t.error)} <button class="btn sm" data-act="taxStatus">다시 확인</button></div>` : !t.hasKey ? `<div class="note warn"><b>아직 발행할 수 없어요</b>볼타 API 키가 등록되지 않았어요. <button class="btn sm" data-act="go" data-v="settings">설정 → 세금계산서 연동</button></div>` : !S.taxcfg.issuer_id ? `<div class="note warn"><b>발급자 등록이 필요해요</b>설정의 세금계산서 연동에서 발급자 등록과 공동인증서 등록을 마쳐 주세요. <button class="btn sm" data-act="go" data-v="settings">설정으로</button></div>` : `<div class="note ${t.mode === 'live' ? 'ok' : 'info'}"><b>${t.mode === 'live' ? '실제 발행 모드' : '테스트 모드'}</b>${t.mode === 'live' ? '발행하면 국세청에 전송되고 건당 요금이 차감돼요.' : '테스트 키라 국세청에 전송되지 않아요. 연습용으로 마음껏 발행해 보세요.'}${t.certificate?.expiresAt ? ` · 인증서 만료 ${fmtD(t.certificate.expiresAt)}` : ''}</div>`}
    ${setProblems.length ? `<div class="note warn"><b>회사 정보 부족</b>${setProblems.map(x => esc(x[1])).join(', ')}를 설정에 입력해 주세요.</div>` : ''}
    <div class="row">
      <label class="fld" for="invMonth"><span>공급 월</span><input class="inp" type="month" id="invMonth" data-bind="invMonth" value="${esc(m)}" style="width:auto"></label>
      <div class="kpis" style="flex:1 1 420px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="kpi"><span class="k">${m.slice(5)}월 출고</span><span class="v">${ships.length}<small>건</small></span><span class="s">${won(ships.reduce((a, s) => a + num(s.total), 0))}원</span></div>
        <div class="kpi${uninv.length ? ' alert' : ''}"><span class="k">계산서 미작성</span><span class="v">${uninv.length}<small>건</small></span><span class="s">${won(uninvAmt)}원</span></div>
        <div class="kpi${dleft >= 0 && dleft <= 3 && waiting ? ' alert' : ''}"><span class="k">발행 기한</span><span class="v" style="font-size:20px">${fmtD(dl)}</span><span class="s">${dleft >= 0 ? `D-${dleft}` : '기한 지남'} (월합계)</span></div>
      </div>
    </div>
    <div class="row"><div class="seg">${['', '대기', '발행중', '발행완료', '실패', '취소'].map(k => `<button class="${stF === k ? 'on' : ''}" data-act="invStatus" data-s="${k}">${k ? TI[k][1] : '전체'}<span class="c">${counts[k] || 0}</span></button>`).join('')}</div></div>
    ${invs.length ? `<div class="tbl-wrap"><table><thead><tr><th>거래처</th><th>구분</th><th>작성일자</th><th class="num">품목</th><th class="num">공급가액</th><th class="num">세액</th><th class="num">합계</th><th>상태</th><th>국세청 승인번호</th></tr></thead><tbody>
      ${invs.map(x => `<tr class="click" data-act="openInvoice" data-id="${esc(x.id)}" role="button" tabindex="0"><td><div class="t">${esc(x.supplied?.organizationName || '')}</div><div class="s mono">${esc(bizFmt(x.supplied?.identificationNumber))}</div></td><td><span class="tag">${esc(x.kind)}</span></td><td class="tabnum nowrap">${fmtD(x.write_date)}</td><td class="num">${(x.items || []).length}</td><td class="num">${won(x.supply)}</td><td class="num">${won(x.vat)}</td><td class="num"><b>${won(x.total)}</b></td><td>${tiPill(x.status)}${x.mode === 'test' && x.status !== '대기' ? ' <span class="tag">테스트</span>' : ''}</td><td class="mono">${esc(x.nts_id || (x.status === '실패' ? '' : ''))}${x.status === '실패' ? `<span class="s" style="color:var(--bad)">${esc((x.error || '').slice(0, 40))}</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="panel"><div class="empty"><b>${m.slice(5)}월 계산서가 없어요</b>${uninv.length ? '‘계산서 만들기’를 누르면 거래처별로 묶어 발행 대기 상태로 만들어요. 월합계 거래처는 한 장, 건별 거래처는 출고마다 한 장씩 만들어요.' : '이 달에 출고한 내역이 없거나 모두 계산서로 만들었어요.'}</div></div>`}
  </div>`;
}

function settleView() {
  const m = S.ui.settleMonth || thisMonth();
  const accs = [...S.accounts.values()].sort((a, b) => ko(a.name, b.name));
  const rows = accs.map(a => { let mShip = 0, mPaid = 0; for (const s of S.shipments.values()) if (s.account_id === a.id && (s.date || '').startsWith(m)) mShip += num(s.total); for (const p of S.payments.values()) if (p.account_id === a.id && (p.date || '').startsWith(m)) mPaid += num(p.amount); return { a, mShip, mPaid, ...balanceOf(a.id) }; });
  const tot = rows.reduce((t, r) => ({ mShip: t.mShip + r.mShip, mPaid: t.mPaid + r.mPaid, bal: t.bal + r.bal }), { mShip: 0, mPaid: 0, bal: 0 });
  const pays = [...S.payments.values()].sort((a, b) => ko(b.date, a.date) || ko(b.created_at, a.created_at)).slice(0, 50);
  return head('정산·미수', '출고 금액에서 입금액을 뺀 잔액을 미수로 계산해요.', `<button class="btn primary" data-act="newPayment">입금 등록</button>`) + `
  <div class="stack">
    <div class="row"><label class="fld" for="settleMonth"><span>기준 월</span><input class="inp" type="month" id="settleMonth" data-bind="settleMonth" value="${esc(m)}" style="width:auto"></label></div>
    <div class="kpis"><div class="kpi"><span class="k">${m.slice(5)}월 출고</span><span class="v">${won(tot.mShip)}<small>원</small></span></div><div class="kpi"><span class="k">${m.slice(5)}월 입금</span><span class="v">${won(tot.mPaid)}<small>원</small></span></div><div class="kpi${tot.bal > 0 ? ' alert' : ''}"><span class="k">현재 미수 잔액</span><span class="v">${won(tot.bal)}<small>원</small></span></div></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>거래처</th><th>결제 조건</th><th class="num">${m.slice(5)}월 출고</th><th class="num">${m.slice(5)}월 입금</th><th class="num">미수 잔액</th><th class="num">여신한도</th><th>한도 사용</th><th></th></tr></thead><tbody>
      ${rows.map(r => { const lim = num(r.a.credit_limit); const pct = lim ? Math.min(100, Math.max(0, r.bal / lim * 100)) : 0; const tone = !lim ? '' : r.bal > lim ? 'bad' : pct >= 80 ? 'warn' : '';
        return `<tr><td class="t">${esc(r.a.name)}</td><td class="s">${esc(r.a.pay_terms || '-')}</td><td class="num">${won(r.mShip)}</td><td class="num">${won(r.mPaid)}</td><td class="num"><b>${won(r.bal)}</b></td><td class="num">${lim ? won(lim) : '<span class="muted">없음</span>'}</td><td>${lim ? `<div class="meter ${tone}" title="${Math.round(r.bal / lim * 100)}%"><i style="width:${pct.toFixed(0)}%"></i></div>` : '<span class="muted">-</span>'}</td><td><button class="btn sm" data-act="newPayment" data-c="${esc(r.a.id)}">입금</button></td></tr>`; }).join('')}
    </tbody></table></div>` : `<div class="panel"><div class="empty"><b>거래처가 없어요</b>거래처를 등록하고 출고하면 미수가 계산돼요.</div></div>`}
    <section class="panel"><div class="panel-h"><h2>최근 입금</h2><span class="muted">${pays.length}건</span></div>
      ${pays.length ? `<div class="tbl-wrap"><table><thead><tr><th>입금일</th><th>거래처</th><th class="num">금액</th><th>방법</th><th>메모</th><th></th></tr></thead><tbody>${pays.map(p => `<tr><td class="tabnum nowrap">${fmtD(p.date)}</td><td>${esc(S.accounts.get(p.account_id)?.name || '')}</td><td class="num">${won(p.amount)}</td><td>${esc(p.method || '')}</td><td class="s">${esc(p.memo || '')}</td><td><button class="btn sm danger${S.ui.armed === 'pay:' + p.id ? ' armed' : ''}" data-act="delPayment" data-id="${esc(p.id)}">${S.ui.armed === 'pay:' + p.id ? '한 번 더 누르면 삭제' : '삭제'}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">입금을 등록하면 여기에 쌓여요.</div>`}
    </section>
  </div>`;
}

function exportView() {
  const ok = !!window.XLSX;
  const card = (act, t, d, primary) => `<div class="panel"><div class="panel-b" style="display:grid;gap:10px"><h2 style="font-size:15px">${t}</h2><p class="muted" style="font-size:13px">${d}</p><div><button class="btn${primary ? ' primary' : ''}" data-act="${act}"${ok ? '' : ' disabled'}>엑셀 내려받기</button></div></div></div>`;
  return head('엑셀 내려받기', '기간을 고르고 필요한 자료를 엑셀로 내려받아요.') + `
  <div class="stack">
    ${ok ? '' : `<div class="note warn">엑셀 도구를 불러오지 못했어요. 새로 고친 뒤 다시 시도해 주세요.</div>`}
    <div class="row"><label class="fld" for="exFrom"><span>시작일</span><input class="inp" type="date" id="exFrom" data-bind="exFrom" value="${esc(S.ui.exFrom)}"></label><label class="fld" for="exTo"><span>종료일</span><input class="inp" type="date" id="exTo" data-bind="exTo" value="${esc(S.ui.exTo)}"></label></div>
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))">
      ${card('exLedger', '출고내역 (공급내역 정리용)', '출고일·거래처·요양기관기호·보험코드·표준코드·수량·단가·로트·유효기간을 품목 줄 단위로 정리해요. 심평원 공급내역 보고 자료를 옮겨 적을 때 쓰세요.', true)}
      ${card('exAccounts', '거래처별 매출·미수', '기간 출고액·입금액과 현재 미수 잔액, 여신한도를 거래처별로 모아요.')}
      ${card('exOrders', '주문 목록', '기간에 접수된 모든 주문의 상태·금액·요청사항을 한 줄씩 모아요.')}
      ${card('exInvoices', '세금계산서 목록', '기간에 작성된 계산서의 공급가액·세액·상태·국세청 승인번호를 모아요.')}
      ${card('exProducts', '상품·재고 목록', '전체 상품의 판매가·재고·처방량·로트별 유효기간을 모아요.')}
    </div>
  </div>`;
}

function settingsView() {
  if (!S.ui.setd) S.ui.setd = { name: '원윤메디팜', biz_no: '', ceo: '', tel: '', fax: '', addr: '', bank: '', biz_type: '', biz_item: '', tax_email: '', tax_manager: '', cutoff: '', notice: '', vat_included: true, ...S.settings };
  const d = S.ui.setd;
  const f = (label, k, ph = '', full = false) => `<label class="fld${full ? ' full' : ''}" for="set-${k}"><span>${label}</span><input class="inp" id="set-${k}" data-bind="setd.${k}" data-norender value="${esc(d[k] ?? '')}" placeholder="${esc(ph)}"></label>`;
  const t = S.tax || {}; const cfg = S.taxcfg || {};
  const admins = [...S.profiles.values()].filter(p => p.role === 'admin');
  const step = (done, title, body) => `<li class="li" style="align-items:flex-start"><span class="tag ${done ? 'ok' : 'warn'}" style="margin-top:2px">${done ? '완료' : '할 일'}</span><div class="li-main" style="white-space:normal;display:grid;gap:6px"><div class="li-t" style="white-space:normal">${title}</div>${body}</div></li>`;
  return head('설정', '거래명세서·세금계산서와 거래처 주문 화면에 쓰이는 정보예요.', `<button class="btn primary" data-act="saveSettings">저장</button>`) + `
  <div class="stack">
    <section class="panel"><div class="panel-h"><h2>회사 정보 (공급자)</h2></div><div class="panel-b"><div class="fgrid">
      ${f('상호', 'name', '원윤메디팜')}${f('사업자등록번호', 'biz_no', '000-00-00000')}${f('대표자', 'ceo')}${f('업태', 'biz_type', '도매 및 소매업')}${f('종목', 'biz_item', '의약품 도매')}${f('전화', 'tel', '043-000-0000')}${f('팩스', 'fax')}${f('입금 계좌', 'bank', '은행 계좌번호 예금주')}${f('세금계산서 담당자', 'tax_manager')}${f('세금계산서 이메일', 'tax_email', 'tax@example.com')}${f('주소', 'addr', '', true)}
    </div></div></section>
    <section class="panel"><div class="panel-h"><h2>거래처 화면 안내</h2></div><div class="panel-b"><div class="fgrid">
      ${f('주문 마감 안내', 'cutoff', '예: 오후 3시 전 주문 당일 출고')}
      <label class="fld full" for="set-notice"><span>공지</span><textarea class="inp" id="set-notice" data-bind="setd.notice" data-norender placeholder="예: 추석 연휴 배송 일정 안내">${esc(d.notice || '')}</textarea></label>
      <label class="check full"><input type="checkbox" id="set-vat" data-bind="setd.vat_included" data-norender${d.vat_included !== false ? ' checked' : ''}> 판매가에 부가세가 포함되어 있어요 (계산서에서 공급가액·세액을 나눠 계산)</label>
    </div></div></section>
    <section class="panel"><div class="panel-h"><h2>세금계산서 연동 (볼타)</h2><button class="btn sm ghost" data-act="taxStatus">상태 새로 고침</button></div>
      <ol class="list" style="padding:0">
        ${step(t.hasKey, `볼타 가입 후 API 키 발급 ${t.hasKey ? `<span class="tag ${t.mode === 'live' ? 'ok' : 'info'}">${t.mode === 'live' ? '실제 발행 키' : '테스트 키'}</span>` : ''}`, `<p class="hint">bolta.io에 가입하고 개발자센터에서 API 키를 만들어요. 먼저 테스트 키(test_)로 연습하고, 준비되면 라이브 키(live_)로 바꿔요. 키는 이 사이트가 아니라 Supabase 비밀값(BOLTA_API_KEY)에 넣어야 안전해요.</p><div class="row"><a class="btn sm" href="https://bolta.io" target="_blank" rel="noopener">볼타 열기</a><a class="btn sm" href="${CFG.secretsUrl}" target="_blank" rel="noopener">Supabase 비밀값 등록</a></div>`)}
        ${step(!!cfg.issuer_id, '발급자 등록', `<p class="hint">위 회사 정보(사업자번호·상호·대표자)를 저장한 뒤 눌러요. 볼타에 원윤메디팜을 발급자로 등록해요.</p><div class="row"><button class="btn sm" data-act="registerIssuer"${t.hasKey ? '' : ' disabled'}>${cfg.issuer_id ? '다시 등록' : '발급자 등록'}</button>${cfg.issuer_id ? `<span class="hint mono">${esc(cfg.issuer_id)}</span>` : ''}</div>`)}
        ${step(!!t.certificate?.expiresAt, '공동인증서 등록', `<p class="hint">법인 공동인증서(전자세금계산서용 또는 범용)를 볼타 화면에서 등록해요. 테스트 키일 때는 볼타가 안내하는 테스트 인증서를 써요.</p><div class="row"><button class="btn sm" data-act="certUrl"${cfg.issuer_id ? '' : ' disabled'}>인증서 등록 화면 열기</button>${t.certificate?.expiresAt ? `<span class="hint">만료 ${fmtD(t.certificate.expiresAt)}</span>` : ''}</div>`)}
      </ol>
    </section>
    <section class="panel"><div class="panel-h"><h2>의약품 정보 연동 (식약처)</h2><button class="btn sm ghost" data-act="drugCheck">상태 새로 고침</button></div>
      <ol class="list" style="padding:0">
        ${step(!!S.drugOn, `공공데이터포털 인증키 등록 ${S.drugOn == null ? '<span class="tag">확인 중</span>' : ''}`, `<p class="hint">거래처가 주문 화면에서 약품명을 검색하면 식약처 자료(성분·효능·용법·주의사항·사진)를 함께 보여 줘요. data.go.kr에 가입해 아래 API를 활용신청하고, 마이페이지의 일반 인증키(Decoding)를 Supabase 비밀값 <b>DATA_GO_KR_KEY</b>로 등록해요. 무료예요.</p>
          <div class="row"><a class="btn sm" href="https://www.data.go.kr/data/15095677/openapi.do" target="_blank" rel="noopener">제품 허가정보 (필수)</a><a class="btn sm" href="https://www.data.go.kr/data/15075057/openapi.do" target="_blank" rel="noopener">e약은요 (선택)</a><a class="btn sm" href="https://www.data.go.kr/data/15057639/openapi.do" target="_blank" rel="noopener">낱알식별 (선택)</a><a class="btn sm ghost" href="${CFG.secretsUrl}" target="_blank" rel="noopener">비밀값 등록 화면</a></div>`)}
        ${step(!!(S.dq.test?.status === 'done' && S.dq.test.items.length && !(S.dq.test.warnings || []).length), '조회 시험', `<p class="hint">키를 등록하고 승인이 반영되면(보통 수십 분~몇 시간) 여기서 시험해 보세요.</p><div class="row"><label class="sr" for="drugTestQ">시험 검색어</label><input class="inp" id="drugTestQ" data-bind="drugTestQ" data-norender value="${esc(S.ui.drugTestQ)}" style="max-width:240px"><button class="btn sm" data-act="drugTest"${S.drugOn ? '' : ' disabled'}>찾아보기</button></div>${drugPanel('test')}`)}
      </ol>
    </section>
    <section class="panel"><div class="panel-h"><h2>관리자 계정</h2><button class="btn sm" data-act="newAdmin">관리자 추가</button></div>
      <ul class="list">${admins.map(p => `<li class="li"><div class="li-main"><div class="li-t"><span class="mono">${esc(p.login_id)}</span> ${esc(p.name || '')}${p.user_id === S.user.id ? ' <span class="tag gold">나</span>' : ''}${p.active ? '' : ' <span class="tag bad">잠김</span>'}</div><div class="li-s">${fmtDT(p.created_at)} 생성</div></div>${p.user_id === S.user.id ? `<button class="btn sm" data-act="myPassword">내 비밀번호 변경</button>` : `<button class="btn sm ghost" data-act="loginMenu" data-u="${esc(p.user_id)}">관리</button>`}</li>`).join('')}</ul>
    </section>
  </div>`;
}

/* ---------- customer ---------- */
function customerView() {
  const a = S.myAccount; const ctx = custCtx(); const v = S.cview;
  const nr = newlyResolved().length;
  const tabs = [['shop', '주문하기' + (cartCount(a.id) ? ` (${cartCount(a.id)})` : '')], ['history', '주문내역'], ['reqs', '재고 요청' + (nr ? `<span class="cnt">${nr}</span>` : '')], ['invoices', '세금계산서'], ['me', '내 정보']];
  const n = S.settings.notice || S.settings.cutoff;
  const body = v === 'history' ? historyView(ctx) : v === 'reqs' ? custReqsView() : v === 'invoices' ? custInvoicesView() : v === 'me' ? meView() : shopView(ctx);
  return `<div class="cshell"><header class="ctop"><div class="ctop-in">${brand('거래처 주문')}<nav class="ctabs">${tabs.map(([k, l]) => `<button class="${v === k ? 'on' : ''}" data-act="cview" data-v="${k}">${l}</button>`).join('')}</nav><div class="ctop-who"><span class="muted">거래처</span> <b>${esc(a.name)}</b>${num(a.discount) ? ` <span class="tag gold">할인 ${num(a.discount)}%</span>` : ''}<button class="btn sm ghost" data-act="logout">로그아웃</button></div></div></header>
    <main class="cmain${v === 'shop' && cartCount(a.id) ? ' has-cartbar' : ''}">${n && v === 'shop' ? `<div class="banner">${S.settings.notice ? `<span><b>공지</b> ${esc(S.settings.notice)}</span>` : ''}${S.settings.cutoff ? `<span><b>마감</b> ${esc(S.settings.cutoff)}</span>` : ''}</div>` : ''}${body}</main></div>`;
}
function shopView(ctx) {
  const key = ctx.account_id; const cart = cartOf(key);
  let items = products().filter(p => p.active !== false);
  const groups = [...new Set(items.map(p => p.grp).filter(Boolean))].sort(ko);
  const myOrders = allOrders().filter(o => o.status !== '취소').sort((a, b) => ko(b.created_at, a.created_at));
  const freq = new Map(); for (const o of myOrders) for (const l of o.lines || []) freq.set(l.pid, (freq.get(l.pid) || 0) + 1);
  const chip = S.ui.shopChip;
  if (chip === '즐겨찾기') items = items.filter(p => S.favs.has(p.id));
  else if (chip === '자주 주문') items = items.filter(p => freq.has(p.id)).sort((a, b) => freq.get(b.id) - freq.get(a.id));
  else if (KINDS.includes(chip)) items = items.filter(p => (p.kind || '의약품') === chip);
  if (S.ui.shopGroup) items = items.filter(p => p.grp === S.ui.shopGroup);
  const qq = S.ui.shopQ.trim().toLowerCase();
  if (qq) items = items.filter(p => [p.name, p.spec, p.code, p.grp, p.maker].join(' ').toLowerCase().includes(qq));
  if (chip !== '자주 주문') items.sort((a, b) => ko(a.name, b.name));
  const kindsPresent = KINDS.filter(k => products().some(p => (p.kind || '의약품') === k && p.active !== false));
  const chips = ['전체', '즐겨찾기', '자주 주문', ...(kindsPresent.length > 1 ? kindsPresent : [])];
  const last = myOrders[0];
  const rows = items.map(p => {
    const qv = cart.lines[p.id] || 0; const pr = priceFor(p, ctx); const step = Math.max(1, num(p.step) || 1); const ok = orderable(p); const rq = ok ? null : myOpenReq(p.id);
    return `<div class="prow${qv && ok ? ' in' : ''}${ok ? '' : ' out'}"><button class="fav${S.favs.has(p.id) ? ' on' : ''}" data-act="fav" data-id="${esc(p.id)}" aria-label="${esc(p.name)} 즐겨찾기" aria-pressed="${S.favs.has(p.id)}">${STAR}</button>
      <div class="pinfo"><div class="pname">${esc(p.name)}</div><div class="pmeta">${p.spec ? `<span>${esc(p.spec)}</span>` : ''}${p.code ? `<span class="mono">${esc(p.code)}</span>` : ''}${p.grp ? `<span>${esc(p.grp)}</span>` : ''}${step > 1 ? `<span>${step}${esc(p.unit || '')} 단위</span>` : ''}${S.drugOn && (p.kind || '의약품') === '의약품' ? `<button class="plink" data-act="drugOf" data-id="${esc(p.id)}">약품 정보</button>` : ''}</div></div>
      <div class="pprice"><span><b>${won(pr)}</b><span class="u">원/${esc(p.unit || '개')}</span></span>${pr !== num(p.price) ? `<s>${won(p.price)}원</s>` : ''}</div>
      <div class="pstock">${availTag(p)}</div>
      ${ok ? `<div class="qty"><button data-act="qty" data-key="${esc(key)}" data-id="${esc(p.id)}" data-d="-${step}" aria-label="${esc(p.name)} 수량 빼기">−</button><input id="q-${esc(p.id)}" inputmode="numeric" autocomplete="off" data-cartqty="${esc(p.id)}" data-key="${esc(key)}" value="${qv || ''}" placeholder="0" aria-label="${esc(p.name)} 주문 수량"><button data-act="qty" data-key="${esc(key)}" data-id="${esc(p.id)}" data-d="${step}" aria-label="${esc(p.name)} 수량 더하기">+</button></div>` : rq ? `<div class="pact"><span class="tag gold">재고 요청함</span><span class="s">${fmtD(rq.created_at)} ${RQ[rq.status][1]}</span></div>` : `<div class="pact"><button class="btn sm" data-act="reqStock" data-id="${esc(p.id)}">재고 요청</button></div>`}</div>`;
  }).join('');
  const emptyMsg = chip === '즐겨찾기' ? ['즐겨찾기한 품목이 없어요', '품목 이름 왼쪽의 별을 누르면 자주 찾는 품목을 모아 볼 수 있어요.'] : chip === '자주 주문' ? ['아직 주문 기록이 없어요', '주문하면 자주 주문한 품목이 여기에 모여요.'] : qq ? ['찾는 약품이 목록에 없어요', '이름 일부나 보험코드로 다시 찾아 보거나, 원윤메디팜에 보유를 요청해 주세요.'] : ['판매 중인 품목이 없어요', ''];
  const arrived = newlyResolved().filter(r => r.status === '입고완료');
  const reqCta = `<button class="btn sm" data-act="reqNew">약품 보유 요청</button>`;
  return `<div class="shop">
    <div class="stack" style="gap:12px;min-width:0">
      ${arrived.length ? `<div class="note ok"><b>재고 요청하신 품목이 입고됐어요</b>${esc(arrived[0].name)}${arrived.length > 1 ? ` 외 ${arrived.length - 1}건` : ''} <button class="btn sm" data-act="cview" data-v="reqs">확인하기</button></div>` : ''}
      ${last ? `<div class="again">${meta(`최근 주문 <b class="mono">${esc(last.no)}</b>`, fmtD(last.created_at), `${(last.lines || []).length}품목 ${won(last.total)}원`)}<button class="btn sm" data-act="reorder" data-id="${esc(last.id)}">그대로 다시 담기</button></div>` : ''}
      <div class="shop-tools">
        <div class="row"><div class="search" style="max-width:none"><label class="sr" for="shopQ">품목 검색</label><input class="inp" id="shopQ" data-bind="shopQ" value="${esc(S.ui.shopQ)}" placeholder="제품명·성분·보험코드로 찾기" autocomplete="off"></div>
          <label class="sr" for="shopGroup">효능군</label><select class="inp" id="shopGroup" data-bind="shopGroup" style="width:auto;max-width:220px"><option value="">효능군 전체</option>${groups.map(g => opt(g, S.ui.shopGroup)).join('')}</select></div>
        <div class="chips">${chips.map(c => `<button class="chip${chip === c ? ' on' : ''}" data-act="shopChip" data-c="${c}">${c}</button>`).join('')}</div>
      </div>
      ${items.length ? `<div class="plist">${rows}</div>` : `<div class="panel"><div class="empty"><b>${emptyMsg[0]}</b>${emptyMsg[1]}${qq ? `<div style="margin-top:14px">${reqCta}</div>` : ''}</div></div>`}
      ${qq ? drugPanel('shop') : ''}
      ${items.length && qq ? `<div class="reqline"><span>찾는 약품이 목록에 없나요? 원윤메디팜에 보유를 요청할 수 있어요.</span>${reqCta}</div>` : ''}
    </div>
    ${cartPanel(ctx)}
  </div>`;
}
function cartPanel(ctx) {
  const key = ctx.account_id; const cart = cartOf(key);
  const all = Object.entries(cart.lines).map(([pid, qv]) => { const p = S.products.get(pid); return p && p.active !== false ? { p, qty: qv, price: priceFor(p, ctx), ok: orderable(p) } : null; }).filter(Boolean);
  const lines = all.filter(l => l.ok); const outs = all.filter(l => !l.ok);
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0); const v = vatSplit(total);
  const bar = lines.length ? `<div class="cartbar"><span class="cb-t">${meta(`${lines.length}품목`, `${won(v.sum)}원`)}</span><button class="btn primary" data-act="toCart">장바구니 보기</button></div>` : '';
  return `<aside class="cart" id="cart" aria-label="장바구니"><div class="cart-h"><h2>장바구니</h2><span class="muted">${lines.length}품목</span></div>
    <div class="cart-lines" data-keep="cartl">${outs.map(l => `<div class="cl out"><span class="cl-n">${esc(l.p.name)}</span><span class="tag bad">품절</span><span class="cl-q">주문에서 빠져요</span><button class="cl-x" data-act="rmLine" data-key="${esc(key)}" data-id="${esc(l.p.id)}">빼기</button></div>`).join('')}${lines.length ? lines.map(l => `<div class="cl"><span class="cl-n">${esc(l.p.name)}</span><span class="cl-a">${won(l.qty * l.price)}</span><span class="cl-q">${won(l.qty)}${esc(l.p.unit || '')} × ${won(l.price)}원</span><button class="cl-x" data-act="rmLine" data-key="${esc(key)}" data-id="${esc(l.p.id)}">빼기</button></div>`).join('') : outs.length ? '' : `<div class="empty" style="padding:22px 16px">목록에서 수량을 입력하면<br>여기에 담겨요.</div>`}</div>
    <div class="cart-f">
      <label class="fld" for="cart-date"><span>희망 배송일</span><input class="inp" type="date" id="cart-date" data-cart="want_date" data-key="${esc(key)}" value="${esc(cart.want_date || '')}" min="${today()}"></label>
      <label class="fld" for="cart-memo"><span>요청사항</span><textarea class="inp" id="cart-memo" data-cart="memo" data-key="${esc(key)}" rows="2" placeholder="예: 오전 중 배송 부탁드려요">${esc(cart.memo || '')}</textarea></label>
      <div class="sum">${vatIncl() ? `<div><span>공급가액</span><span>${won(v.supply)}원</span></div><div><span>부가세</span><span>${won(v.vat)}원</span></div>` : `<div><span>상품 금액</span><span>${won(v.supply)}원</span></div><div><span>부가세 (10%)</span><span>${won(v.vat)}원</span></div>`}<div class="tot"><span>합계</span><span>${won(v.sum)}원</span></div></div>
      <button class="btn primary lg block" data-act="submitOrder"${lines.length && !S.busy ? '' : ' disabled'}>${S.busy ? '접수하는 중…' : '주문 접수하기'}</button>
      ${S.settings.cutoff ? `<p class="hint" style="text-align:center">${esc(S.settings.cutoff)}</p>` : ''}
    </div></aside>${bar}`;
}
function historyView() {
  const list = allOrders().sort((a, b) => ko(b.created_at, a.created_at));
  if (!list.length) return `<div class="panel"><div class="empty"><b>주문내역이 없어요</b>주문하기에서 첫 주문을 넣어 보세요.<div style="margin-top:12px"><button class="btn primary" data-act="cview" data-v="shop">주문하기</button></div></div></div>`;
  const flow = ['접수', '확인', '출고', '완료'];
  return `<div class="stack" style="gap:12px">${list.map(o => {
    const open = !!S.ui.open[o.id]; const idx = flow.indexOf(o.status); const shipped = o.status === '출고' || o.status === '완료';
    const steps = o.status === '취소' ? pill('취소') : `<div class="steps">${flow.map((s, i) => `<span class="${i <= idx ? 'done' : ''}"><i></i>${ST[s][1]}</span>`).join('')}</div>`;
    return `<article class="ocard"><div class="ocard-h"><div style="min-width:0;flex:1 1 220px"><div class="t oc-no">${esc(o.no)}</div><div class="muted" style="font-size:13px">${meta(fmtDT(o.created_at), `${(o.lines || []).length}품목 ${won(o.total)}원`, o.want_date ? `희망 ${fmtD(o.want_date)}` : '')}</div></div>${steps}
      <div class="row"><button class="btn sm ghost" data-act="toggleOpen" data-id="${esc(o.id)}" aria-expanded="${open}">${open ? '접기' : '상세'}</button><button class="btn sm" data-act="reorder" data-id="${esc(o.id)}">다시 담기</button>${shipped && window.XLSX ? `<button class="btn sm" data-act="statement" data-id="${esc(o.id)}">거래명세서</button>` : ''}${o.status === '접수' ? `<button class="btn sm danger${S.ui.armed === 'cx:' + o.id ? ' armed' : ''}" data-act="custCancel" data-id="${esc(o.id)}">${S.ui.armed === 'cx:' + o.id ? '한 번 더 누르면 취소' : '주문 취소'}</button>` : ''}</div></div>
      ${open ? `<div class="ocard-b"><div class="tbl-wrap" style="border:0;border-radius:0"><table><thead><tr><th>품목</th><th class="num">수량</th><th class="num">단가</th><th class="num">금액</th>${shipped ? '<th>로트 · 유효기간</th>' : ''}</tr></thead><tbody>${(o.lines || []).map(l => `<tr><td><div class="t">${esc(l.name)}</div><div class="s">${esc(l.spec || '')} ${l.code ? '· ' + esc(l.code) : ''}</div></td><td class="num">${l.oqty != null && num(l.oqty) !== num(l.qty) ? `<span class="muted"><s>${won(l.oqty)}</s></span> ` : ''}${won(l.qty)}${esc(l.unit || '')}</td><td class="num">${won(l.price)}</td><td class="num">${won(num(l.qty) * num(l.price))}</td>${shipped ? `<td class="s">${esc(l.lot || '-')} ${l.exp ? '· ' + fmtD(l.exp) : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>${o.memo || o.admin_memo ? `<div class="panel-b" style="display:grid;gap:4px;font-size:13px">${o.memo ? `<div><span class="muted">요청사항</span> ${esc(o.memo)}</div>` : ''}${o.admin_memo ? `<div><span class="muted">원윤메디팜 안내</span> ${esc(o.admin_memo)}</div>` : ''}</div>` : ''}</div>` : ''}
    </article>`; }).join('')}</div>`;
}
function custReqsView() {
  const list = [...S.reqs.values()].sort((a, b) => (isOpenReq(b) - isOpenReq(a)) || ko(b.created_at, a.created_at));
  const top = `<div class="row" style="justify-content:space-between;align-items:flex-start"><p class="muted" style="flex:1 1 320px">품절 품목의 재입고나 목록에 없는 약품의 보유를 요청한 내역이에요. 입고되면 여기와 주문하기 화면에 바로 표시돼요.</p><button class="btn" data-act="reqNew">약품 보유 요청</button></div>`;
  if (!list.length) return `<div class="stack">${top}<div class="panel"><div class="empty"><b>재고 요청이 없어요</b>주문하기에서 품절 품목의 '재고 요청'을 누르거나, 찾는 약품이 없을 때 보유를 요청해 보세요.</div></div></div>`;
  return `<div class="stack" style="gap:12px">${top}${list.map(r => {
    const p = r.product_id ? S.products.get(r.product_id) : null; const armed = S.ui.armed === 'rq:' + r.id;
    const act = isOpenReq(r) ? `<button class="btn sm danger${armed ? ' armed' : ''}" data-act="cancelReq" data-id="${esc(r.id)}">${armed ? '한 번 더 누르면 취소' : '요청 취소'}</button>`
      : r.status === '입고완료' && orderable(p) ? `<button class="btn sm primary" data-act="orderReq" data-id="${esc(r.id)}">주문하기</button>` : '';
    return `<article class="ocard"><div class="ocard-h"><div style="min-width:0;flex:1 1 260px"><div class="t">${esc(r.name)} ${r.kind === '신규' ? '<span class="tag gold">신규 취급</span>' : ''}</div><div class="muted" style="font-size:13px">${meta(esc(r.spec || ''), esc(r.maker || ''), r.qty ? '필요 ' + esc(r.qty) : '', '요청 ' + fmtD(r.created_at))}</div>${r.admin_memo ? `<div class="rq-memo"><span class="muted">원윤메디팜 안내</span> ${esc(r.admin_memo)}</div>` : ''}</div>${rqPill(r.status)}${act ? `<div class="row">${act}</div>` : ''}</div></article>`;
  }).join('')}</div>`;
}
function custInvoicesView() {
  const list = [...S.invoices.values()].sort((a, b) => ko(b.write_date, a.write_date));
  return `<div class="stack"><p class="muted">발행이 끝난 전자세금계산서예요. 원본은 등록하신 이메일과 홈택스에서도 확인할 수 있어요.</p>${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>작성일자</th><th>구분</th><th class="num">공급가액</th><th class="num">세액</th><th class="num">합계</th><th>국세청 승인번호</th></tr></thead><tbody>${list.map(t => `<tr><td class="tabnum">${fmtD(t.write_date)}</td><td><span class="tag">${esc(t.kind)}</span></td><td class="num">${won(t.supply)}</td><td class="num">${won(t.vat)}</td><td class="num"><b>${won(t.total)}</b></td><td class="mono">${esc(t.nts_id || '')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="panel"><div class="empty"><b>발행된 세금계산서가 없어요</b>출고된 주문은 원윤메디팜이 정해진 날짜에 계산서로 발행해요.</div></div>`}</div>`;
}
function meView() {
  const a = S.myAccount; const d = S.ui.np;
  return `<div class="stack" style="max-width:720px">
    <section class="panel"><div class="panel-h"><h2>거래처 정보</h2></div><div class="panel-b"><div class="kv">
      <div><span>상호</span><b>${esc(a.name)}</b></div><div><span>요양기관기호</span><b class="mono">${esc(a.ykiho || '-')}</b></div><div><span>사업자등록번호</span><b class="mono">${esc(bizFmt(a.biz_no) || '-')}</b></div><div><span>대표자</span><b>${esc(a.ceo || '-')}</b></div><div><span>세금계산서 이메일</span><b>${esc(a.tax_email || '-')}</b></div><div><span>배송 주소</span><b>${esc(a.addr || '-')}</b></div><div><span>결제 조건</span><b>${esc(a.pay_terms || '-')}</b></div><div><span>로그인 아이디</span><b class="mono">${esc(S.profile.login_id)}</b></div>
    </div><p class="hint" style="margin-top:12px">정보가 바뀌었으면 원윤메디팜${S.settings.tel ? `(${esc(S.settings.tel)})` : ''}에 알려 주세요.${S.settings.bank ? ` 입금 계좌: ${esc(S.settings.bank)}` : ''}</p></div></section>
    <section class="panel"><div class="panel-h"><h2>비밀번호 변경</h2></div><div class="panel-b"><form class="fgrid" data-form="mypw" novalidate>
      <label class="fld" for="mp-1"><span>새 비밀번호 (8자 이상)</span><input class="inp" id="mp-1" type="password" data-bind="np.a" data-norender autocomplete="new-password"></label>
      <label class="fld" for="mp-2"><span>새 비밀번호 확인</span><input class="inp" id="mp-2" type="password" data-bind="np.b" data-norender autocomplete="new-password"></label>
      <div class="fld full"><button class="btn primary" type="submit" style="justify-self:start"${S.busy ? ' disabled' : ''}>비밀번호 바꾸기</button></div>
    </form></div></section>
  </div>`;
}

/* ---------- modals ---------- */
const frame = (title, sub, body, foot) => `<div class="dlg-h"><div><h2 id="dlg-t">${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div><button class="x" data-act="closeModal" aria-label="닫기">×</button></div><div class="dlg-b" data-keep="dlgb">${body}</div>${foot ? `<div class="dlg-f">${foot}</div>` : ''}`;
function mf(label, path, o = {}) {
  const v = getPath(M.draft, path) ?? ''; const id = 'm-' + path.replace(/\./g, '-');
  return `<label class="fld${o.full ? ' full' : ''}" for="${id}"><span>${esc(label)}${o.req ? ' <em>*</em>' : ''}</span><input class="inp${o.num ? ' num' : ''}${o.mono ? ' mono' : ''}" id="${id}" type="${o.type || 'text'}" data-m="${path}"${o.live ? ' data-live' : ''} value="${esc(v)}" placeholder="${esc(o.ph || '')}"${o.num ? ' inputmode="decimal"' : ''}${o.list ? ` list="${o.list}"` : ''}${o.af ? ' autofocus' : ''}${o.ac ? ` autocomplete="${o.ac}"` : ''}></label>`;
}
function msel(label, path, options, o = {}) {
  const v = getPath(M.draft, path) ?? ''; const id = 'm-' + path.replace(/\./g, '-');
  return `<label class="fld${o.full ? ' full' : ''}" for="${id}"><span>${esc(label)}</span><select class="inp" id="${id}" data-m="${path}"${o.live ? ' data-live' : ''}>${options.map(x => Array.isArray(x) ? opt(x[0], v, x[1]) : opt(x, v)).join('')}</select></label>`;
}
const mchk = (label, path) => `<label class="check"><input type="checkbox" id="m-${path}" data-m="${path}" data-live${getPath(M.draft, path) ? ' checked' : ''}> ${esc(label)}</label>`;
const busyAttr = () => M.busy ? ' disabled' : '';
function armBtn(key, label, armedLabel, cls = 'danger') { const on = M.armed === key; return `<button class="btn ${cls}${on ? ' armed' : ''}" data-act="arm" data-a="${key}"${busyAttr()}>${on ? armedLabel : label}</button>`; }
function credsBox(c) { return `<div class="secret"><span>아이디 <code>${esc(c.login_id)}</code></span><span>임시 비밀번호 <code>${esc(c.password)}</code></span><button class="btn sm" data-act="copyCreds">복사</button><span class="hint" style="flex-basis:100%">이 비밀번호는 지금만 보여요. 거래처에 전달하면, 첫 로그인 때 새 비밀번호로 바꾸게 돼요.</span></div>`; }

const MODALS = {
  order() {
    const o = S.orders.get(M.data.id);
    if (!o) return frame('주문', '', '<p class="muted">주문을 찾을 수 없어요.</p>');
    const acc = S.accounts.get(o.account_id); const d = M.draft; const editable = o.status === '접수' || o.status === '확인'; const shipStage = o.status === '확인';
    const lines = (o.lines || []).map((l, i) => ({ l, dl: d.lines[i] || {}, p: S.products.get(l.pid) }));
    const total = editable ? lines.reduce((a, x) => a + Math.max(0, Math.floor(num(x.dl.qty))) * num(x.dl.price), 0) : num(o.total);
    const v = vatSplit(total);
    const bal = acc ? balanceOf(acc.id).bal : 0; const lim = num(acc?.credit_limit);
    const warnCredit = editable && lim > 0 && bal + total > lim;
    const shortList = shipStage ? lines.filter(x => x.p?.track && num(x.dl.qty) > num(x.p.stock)) : [];
    const lotLists = shipStage ? lines.filter(x => x.p && liveLots(x.p).length).map(x => `<datalist id="lots-${esc(x.p.id)}">${liveLots(x.p).map(lt => `<option value="${esc(lt.lot)}">${esc(fmtD(lt.exp))} · ${won(lt.qty)}${esc(x.p.unit || '')}</option>`).join('')}</datalist>`).join('') : '';
    const shipped = o.status === '출고' || o.status === '완료';
    const body = `
      <div class="kv"><div><span>거래처</span><b>${esc(acc?.name || o.cust_name)}</b></div><div><span>요양기관기호</span><b class="mono">${esc(acc?.ykiho || '-')}</b></div><div><span>접수</span><b>${fmtDT(o.created_at)}</b></div><div><span>희망 배송일</span><b>${fmtD(o.want_date) || '-'}</b></div>${o.ship_date ? `<div><span>출고일</span><b>${fmtD(o.ship_date)}</b></div>` : ''}</div>
      ${o.memo ? `<div class="note"><b>요청사항</b>${esc(o.memo)}</div>` : ''}
      ${warnCredit ? `<div class="note warn"><b>여신한도 초과</b>현재 미수 ${won(bal)}원 + 이번 주문 ${won(total)}원이 한도 ${won(lim)}원을 넘어요.</div>` : ''}
      ${shortList.length ? `<div class="note bad"><b>재고 부족</b>${shortList.map(x => `${esc(x.l.name)} (재고 ${won(x.p.stock)})`).join(', ')}</div>` : ''}
      <div class="tbl-wrap" data-keep="olines"><table><thead><tr><th>품목</th><th class="num">주문</th><th class="num">${editable ? '확정 수량' : '수량'}</th><th class="num">단가</th><th class="num">금액</th>${shipStage ? '<th>로트번호</th><th>유효기간</th>' : (shipped ? '<th>로트 · 유효기간</th>' : '')}</tr></thead><tbody>
        ${lines.map((x, i) => { const qv = editable ? Math.max(0, Math.floor(num(x.dl.qty))) : num(x.l.qty); const pr = editable ? num(x.dl.price) : num(x.l.price);
          return `<tr><td><div class="t">${esc(x.l.name)}</div><div class="s">${esc(x.l.spec || '')}${x.l.code ? ' · <span class="mono">' + esc(x.l.code) + '</span>' : ''}${x.p?.track ? ` · 재고 ${won(x.p.stock)}` : ''}</div></td>
          <td class="num">${won(x.l.oqty ?? x.l.qty)}<span class="s">${esc(x.l.unit || '')}</span></td>
          <td class="num">${editable ? `<input class="inp sm num" style="width:84px" id="m-lines-${i}-qty" data-m="lines.${i}.qty" data-live inputmode="numeric" value="${esc(x.dl.qty)}" aria-label="${esc(x.l.name)} 확정 수량">` : won(qv)}</td>
          <td class="num">${editable ? `<input class="inp sm num" style="width:92px" id="m-lines-${i}-price" data-m="lines.${i}.price" data-live inputmode="numeric" value="${esc(x.dl.price)}" aria-label="${esc(x.l.name)} 단가">` : won(pr)}</td>
          <td class="num">${won(qv * pr)}</td>
          ${shipStage ? `<td><input class="inp sm" style="width:120px" id="m-lines-${i}-lot" data-m="lines.${i}.lot" data-lotfor="${i}" ${x.p && liveLots(x.p).length ? `list="lots-${esc(x.p.id)}"` : ''} value="${esc(x.dl.lot || '')}" placeholder="${x.p?.track ? '비우면 자동' : ''}" aria-label="${esc(x.l.name)} 로트번호"></td><td><input class="inp sm" type="date" style="width:140px" id="m-lines-${i}-exp" data-m="lines.${i}.exp" value="${esc(x.dl.exp || '')}" aria-label="${esc(x.l.name)} 유효기간"></td>` : (shipped ? `<td class="s nowrap">${esc(x.l.lot || '-')}${x.l.exp ? ' · ' + fmtD(x.l.exp) : ''}</td>` : '')}</tr>`; }).join('')}
      </tbody></table></div>${lotLists}
      <div class="row" style="align-items:flex-start;gap:16px">
        <label class="fld" style="flex:1 1 280px" for="m-admin_memo"><span>거래처에 보일 안내 (선택)</span>${editable ? `<input class="inp" id="m-admin_memo" data-m="admin_memo" value="${esc(d.admin_memo || '')}" placeholder="예: 가스탄정 결품으로 200정만 출고">` : `<div>${esc(o.admin_memo || '-')}</div>`}</label>
        <div class="sum" style="flex:0 1 240px;min-width:200px"><div><span>공급가액</span><span>${won(v.supply)}원</span></div><div><span>부가세</span><span>${won(v.vat)}원</span></div><div class="tot"><span>합계</span><span>${won(v.sum)}원</span></div></div>
      </div>
      ${shipStage && shortList.length ? mchk('재고가 부족해도 출고 처리 (재고가 음수로 바뀌어요)', 'force') : ''}
      ${shipStage ? `<p class="hint">로트를 비워 두면 재고 관리 품목은 유효기간이 빠른 로트부터 차감해요. 출고하면 재고가 줄고, 정산·세금계산서에 쓰이는 출고내역이 생겨요.</p>` : ''}
      <div class="hint">${(o.log || []).map(s => `${ST[s.s]?.[1] || s.s} ${fmtDT(s.at)}`).join(' → ')}</div>`;
    let foot = '';
    if (o.status === '접수') foot = `${armBtn('cancel', '주문 취소', '한 번 더 누르면 취소')}<span class="spacer"></span><button class="btn" data-act="saveOrderEdits"${busyAttr()}>수정 저장</button><button class="btn primary" data-act="confirmOrder"${busyAttr()}>주문 확인</button>`;
    else if (o.status === '확인') foot = `${armBtn('cancel', '주문 취소', '한 번 더 누르면 취소')}<button class="btn ghost" data-act="backToNew"${busyAttr()}>접수로 되돌리기</button><span class="spacer"></span><button class="btn" data-act="saveOrderEdits"${busyAttr()}>수정 저장</button><button class="btn primary" data-act="shipOrder"${busyAttr()}${shortList.length && !d.force ? ' disabled' : ''}>출고 처리</button>`;
    else if (o.status === '출고') foot = `<button class="btn" data-act="statement" data-id="${esc(o.id)}">거래명세서 엑셀</button><span class="spacer"></span><button class="btn primary" data-act="deliverOrder"${busyAttr()}>배송 완료</button>`;
    else if (o.status === '완료') foot = `<button class="btn" data-act="statement" data-id="${esc(o.id)}">거래명세서 엑셀</button><span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button>`;
    else foot = `<span class="spacer"></span><button class="btn" data-act="restoreOrder"${busyAttr()}>접수 상태로 복구</button>`;
    return frame(`<span class="mono" style="font-size:16px">${esc(o.no)}</span> ${pill(o.status)}`, `${(o.lines || []).length}품목`, body, foot);
  },
  drug() {
    const m = M.data; const d = m.item; const admin = S.profile?.role === 'admin';
    if (!d) return frame('약품 정보', m.err ? '' : '식약처 자료를 불러오는 중', m.err ? `<div class="note">${esc(m.err)}</div>` : '<div class="loading"><i></i>불러오는 중</div>', `<span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button>`);
    const p = (m.pid && S.products.get(m.pid)) || catalogMatch(d);
    const e = d.easy || {};
    const sec = (title, text, long) => text ? `<div class="dsec"><div class="sec-t">${title}</div><div class="dtext${long ? ' long' : ''}">${esc(text)}</div></div>` : '';
    const body = `
      <div class="dhead">${d.image ? `<img class="dphoto" src="${esc(d.image)}" alt="${esc(d.name)} 사진" referrerpolicy="no-referrer">` : ''}
        <div class="kv" style="flex:1">
          <div><span>업체</span><b>${esc(d.company || '-')}</b></div><div><span>구분</span><b>${esc(d.kind || '-')}</b></div>
          <div><span>주성분</span><b>${esc(d.ingr || '-')}</b></div><div><span>성분·함량</span><b>${esc(d.strength || '-')}</b></div>
          <div><span>보험코드</span><b class="mono">${esc((d.edi || []).join(', ') || '-')}</b></div><div><span>ATC 코드</span><b class="mono">${esc(d.atc || '-')}</b></div>
          ${d.cls ? `<div><span>분류</span><b>${esc(d.cls)}</b></div>` : ''}${d.form ? `<div><span>제형</span><b>${esc(d.form)}</b></div>` : ''}
          <div><span>저장방법</span><b>${esc(d.storage || '-')}</b></div><div><span>유효기간</span><b>${esc(d.valid || '-')}</b></div>
        </div></div>
      ${p ? `<div class="note ${orderable(p) ? 'ok' : 'warn'}"><b>원윤메디팜 취급 품목</b>${esc(p.name)}${p.spec ? ' ' + esc(p.spec) : ''} · ${orderable(p) ? '지금 주문할 수 있어요' : '지금은 품절이에요'}</div>` : `<div class="note"><b>원윤메디팜에서 아직 취급하지 않는 약품이에요</b>${admin ? '상품으로 등록하면 거래처가 주문할 수 있어요.' : '보유 요청을 남기면 원윤메디팜이 확인해서 안내해 드려요.'}</div>`}
      ${d.chart ? sec('성상', d.chart) : ''}
      ${sec('효능·효과 (쉬운 설명)', e.efcy)}
      ${sec('효능·효과', d.efficacy)}
      ${sec('용법·용량', d.usage || e.use)}
      ${sec('사용상의 주의사항', d.caution || [e.warn, e.atpn].filter(Boolean).join('\n'), true)}
      ${sec('함께 주의할 약·음식', e.intrc)}
      ${sec('이상반응', e.se)}
      ${d.pack ? sec('포장단위', d.pack) : ''}
      ${!d.efficacy && !e.efcy ? `<div class="note">효능·효과, 용법·용량, 주의사항은 아래 <b>의약품안전나라 원문</b>에서 볼 수 있어요.</div>` : ''}
      <p class="hint">출처: 식품의약품안전처 의약품 허가정보·e약은요·낱알식별 (공공데이터포털). 참고용 요약이에요. 최신 허가사항은 의약품안전나라 원문을 확인하세요.</p>`;
    const foot = `${d.link ? `<a class="btn ghost" href="${esc(d.link)}" target="_blank" rel="noopener">의약품안전나라 원문</a>` : ''}<span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button>${drugAction(d, p, 'modal')}`;
    return frame(`${esc(d.name)} ${kindTag(d.kind)}`, '', body, foot);
  },
  stockReq() {
    const p = M.data.pid ? S.products.get(M.data.pid) : null; const ext = M.data.ext;
    const body = p ? `<div class="note"><b>지금 주문할 수 없는 품목이에요</b>요청을 남기면 원윤메디팜이 확인하고, 입고되면 '재고 요청' 탭과 주문하기 화면에 바로 표시돼요.</div>
      <div class="fgrid">${mf('필요 수량 (선택)', 'qty', { af: true, ph: `예: 한 달 300${p.unit && p.unit !== '개' ? p.unit : '개'}` })}${mf('메모 (선택)', 'memo', { ph: '예: 다음 주까지 필요해요' })}</div>`
      : `${ext ? `<div class="note"><b>식약처 품목</b>${meta(esc(ext.name), esc(ext.company || ''), '품목기준코드 ' + esc(ext.seq), ext.code ? '보험코드 ' + esc(ext.code) : '')}</div>` : ''}<p class="hint">찾는 약품이 목록에 없으면 알려 주세요. 원윤메디팜이 확인해서 보유 여부를 안내해 드려요.</p>
      <div class="fgrid">${mf('약품 이름', 'name', { req: true, full: true, af: true, ph: '예: 리피토정 10mg' })}${mf('규격 (선택)', 'spec', { ph: '예: 10mg/1정' })}${mf('제조사 (선택)', 'maker')}${mf('필요 수량 (선택)', 'qty', { ph: '예: 한 달 300정' })}${mf('메모 (선택)', 'memo', { ph: '예: 보험코드, 대체약 가능 여부' })}</div>`;
    return frame(p ? '재고 요청' : '약품 보유 요청', p ? meta(esc(p.name), esc(p.spec || '')) : '', body, `<span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button><button class="btn primary" data-act="sendReq"${busyAttr()}>요청 보내기</button>`);
  },
  reqAdmin() {
    const r = S.reqs.get(M.data.id); if (!r) return frame('재고 요청', '', '<p class="muted">요청을 찾을 수 없어요.</p>');
    const p = r.product_id ? S.products.get(r.product_id) : null; const open = isOpenReq(r);
    const others = [...S.reqs.values()].filter(x => x.id !== r.id && isOpenReq(x) && reqKey(x) === reqKey(r));
    const body = `
      <div class="kv"><div><span>거래처</span><b>${esc(r.cust_name)}</b></div><div><span>요청일</span><b>${fmtDT(r.created_at)}</b></div><div><span>구분</span><b>${r.kind === '신규' ? '신규 취급 요청' : '품절 재입고 요청'}</b></div><div><span>필요 수량</span><b>${esc(r.qty || '-')}</b></div></div>
      <div class="note"><b>${esc(r.name)}</b>${meta(esc(r.spec || ''), esc(r.maker || ''), p ? (p.code ? esc(p.code) : '') : '목록에 없는 약품')}${p ? ` ${stockTag(p)}` : ''}</div>
      ${r.memo ? `<div class="note"><b>거래처 메모</b>${esc(r.memo)}</div>` : ''}
      ${r.ext_seq ? `<div class="row"><span class="hint">${meta('식약처 품목기준코드 ' + esc(r.ext_seq), r.ext_code ? '보험코드 ' + esc(r.ext_code) : '')}</span>${S.drugOn ? `<button class="btn sm" data-act="drugDetail" data-seq="${esc(r.ext_seq)}">식약처 정보 보기</button>` : ''}</div>` : ''}
      ${others.length ? `<div class="note warn"><b>같은 품목 요청 ${others.length + 1}곳</b>${others.map(x => esc(x.cust_name)).join(', ')}도 기다리고 있어요.</div>` : ''}
      ${open ? `${mf('거래처에 보일 안내 (선택)', 'admin_memo', { full: true, ph: '예: 10월 20일 입고 예정이에요' })}
        <div class="row">${p ? `<button class="btn sm" data-act="reqToStock" data-id="${esc(p.id)}">입고 등록</button>${p.soldout ? `<button class="btn sm" data-act="reqUnsoldout" data-id="${esc(p.id)}">일시 품절 풀기</button>` : ''}<span class="hint">입고를 등록하거나 일시 품절을 풀면 이 품목 요청이 모두 자동으로 입고 완료돼요.</span>` : `<button class="btn sm" data-act="reqToProduct">상품으로 등록</button><span class="hint">상품으로 등록한 뒤 '입고 완료'를 누르면 거래처가 바로 주문할 수 있어요.</span>`}</div>`
      : `<div class="kv"><div><span>처리</span><b>${RQ[r.status][1]}${r.resolved_at ? ' · ' + fmtDT(r.resolved_at) : ''}</b></div><div><span>거래처에 보인 안내</span><b>${esc(r.admin_memo || '-')}</b></div></div>`}`;
    const foot = open ? `<button class="btn danger" data-act="setReq" data-s="불가"${busyAttr()}>보유 불가</button><span class="spacer"></span>${r.status === '요청' ? `<button class="btn" data-act="setReq" data-s="확인"${busyAttr()}>확인 중으로 표시</button>` : `<button class="btn" data-act="setReq" data-s="확인"${busyAttr()}>안내만 저장</button>`}<button class="btn primary" data-act="setReq" data-s="입고완료"${busyAttr()}>입고 완료</button>`
      : r.status === '취소' ? `<span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button>` : `<button class="btn ghost" data-act="setReq" data-s="요청"${busyAttr()}>처리 대기로 되돌리기</button><span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button>`;
    return frame(`재고 요청 ${rqPill(r.status)}`, meta(esc(r.cust_name), esc(r.name)), body, foot);
  },
  product() {
    const ex = M.data.id ? S.products.get(M.data.id) : null; const rx = ex ? S.rx.get(ex.id) : null;
    const body = `<div class="fgrid">
      ${msel('구분', 'kind', KINDS)}${mf('효능군·분류', 'grp', { ph: '예: 해열진통소염제', list: 'grp-list' })}
      ${mf('제품명', 'name', { req: true, full: true, af: true })}
      ${mf('규격', 'spec', { ph: '예: 68.1mg/1정' })}${mf('제조사', 'maker')}
      ${mf('보험코드 (EDI)', 'code', { ph: '9자리', mono: true })}${mf('표준코드 (바코드)', 'std', { ph: '13자리', mono: true })}
      ${mf('판매단위', 'unit', { ph: '정·캡슐·병·박스·개' })}${mf('주문 배수', 'step', { num: true, ph: '1' })}
      ${mf('기준가 (보험 상한)', 'base_price', { num: true })}${mf('판매가', 'price', { num: true, req: true })}
      ${mf('안전재고', 'safety', { num: true, ph: '이 수량 밑이면 알림' })}
      <div class="fld" style="align-content:end;gap:8px">${mchk('재고 관리', 'track')}${mchk('판매 중 (끄면 거래처 화면에서 숨겨요)', 'active')}${mchk('일시 품절 (거래처가 주문할 수 없고 재고 요청을 받아요)', 'soldout')}</div>
    </div><datalist id="grp-list">${[...new Set(products().map(p => p.grp).filter(Boolean))].sort(ko).map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist>
    ${rx ? `<p class="hint">${esc(rx.month)} 원외처방: ${won(rx.count)}회 · ${won(rx.qty)}${esc(ex.unit || '')} (급여 ${won(rx.ins_qty)} / 비급여 ${won(rx.non_qty)})</p>` : ''}`;
    return frame(ex ? '상품 수정' : '상품 추가', ex ? esc(ex.name) : '의약품·의료소모품을 등록해요', body, `<span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button><button class="btn primary" data-act="saveProduct"${busyAttr()}>저장</button>`);
  },
  stock() {
    const p = S.products.get(M.data.id); if (!p) return frame('입출고', '', '<p class="muted">상품을 찾을 수 없어요.</p>');
    const d = M.draft; const lots = liveLots(p); const rx = S.rx.get(p.id);
    const mv = [...S.moves.values()].filter(m => m.product_id === p.id).sort((a, b) => ko(b.created_at, a.created_at)).slice(0, 8);
    const body = `
      <div class="kv"><div><span>현재 재고</span><b class="tabnum">${p.track ? won(p.stock) + (p.unit || '') : '관리 안 함'}</b></div><div><span>월 처방량</span><b class="tabnum">${rx?.qty ? won(rx.qty) + (p.unit || '') : '-'}</b></div><div><span>안전재고</span><b class="tabnum">${num(p.safety) ? won(p.safety) : '-'}</b></div></div>
      <div class="fgrid">
        ${msel('구분', 'type', [['입고', '입고'], ['반품 입고', '반품 입고'], ['폐기', '폐기·파손 (차감)'], ['실사 조정', '실사 조정 (실제 수량으로 맞춤)']], { live: true })}
        ${mf(d.type === '실사 조정' ? '실제 재고 수량' : '수량', 'qty', { num: true, req: true, af: true })}
        ${d.type !== '실사 조정' ? mf('로트번호', 'lot', { list: 'lot-dl' }) + (d.type === '폐기' ? '' : mf('유효기간', 'exp', { type: 'date' })) : ''}
        ${mf('일자', 'date', { type: 'date' })}${mf('메모', 'memo', { ph: '매입처·사유 등' })}
      </div>
      <datalist id="lot-dl">${lots.map(l => `<option value="${esc(l.lot)}">${esc(fmtD(l.exp))} · ${won(l.qty)}</option>`).join('')}</datalist>
      ${lots.length ? `<div><div class="sec-t" style="margin-bottom:6px">로트별 재고</div><div class="tbl-wrap"><table><thead><tr><th>로트</th><th>유효기간</th><th class="num">수량</th></tr></thead><tbody>${lots.map(l => `<tr><td class="mono">${esc(l.lot || '(미입력)')}</td><td>${l.exp ? `<span class="tag ${daysUntil(l.exp) <= 60 ? 'bad' : daysUntil(l.exp) <= 180 ? 'warn' : ''}">${fmtD(l.exp)}</span>` : '-'}</td><td class="num">${won(l.qty)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${mv.length ? `<div><div class="sec-t" style="margin-bottom:6px">최근 입출고</div><div class="tbl-wrap"><table><tbody>${mv.map(m => `<tr><td class="tabnum nowrap">${fmtD(m.date)}</td><td>${esc(m.type)}</td><td class="num">${num(m.qty) > 0 ? '+' : ''}${won(m.qty)}</td><td class="s">${esc(m.lot || '')} ${esc(m.ref || m.memo || '')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
    return frame('입출고 등록', meta(esc(p.name), esc(p.spec || '')), body, `<span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button><button class="btn primary" data-act="saveStock"${busyAttr()}>등록</button>`);
  },
  account() {
    const ex = M.data.id ? S.accounts.get(M.data.id) : null; const d = M.draft;
    const plist = products().filter(p => p.active !== false).sort((a, b) => ko(a.name, b.name));
    const sp = (d.special || []).map((s, i) => { const p = S.products.get(s.pid); return `<div class="sp-row"><select class="inp sm" id="m-special-${i}-pid" data-m="special.${i}.pid" data-live aria-label="특가 품목"><option value="">품목 선택</option>${plist.map(x => opt(x.id, s.pid, x.name + (x.spec ? ` (${x.spec})` : ''))).join('')}</select><input class="inp sm num" id="m-special-${i}-price" data-m="special.${i}.price" inputmode="numeric" value="${esc(s.price ?? '')}" placeholder="${p ? won(p.price) : '단가'}" aria-label="특가 단가"><button class="btn sm ghost" data-act="rmSpecial" data-i="${i}">빼기</button></div>`; }).join('');
    const logins = ex ? [...S.profiles.values()].filter(p => p.account_id === ex.id) : [];
    const creds = S.ui.lastCreds && ex && S.ui.lastCreds.account_id === ex.id ? credsBox(S.ui.lastCreds) : '';
    const body = `
      ${ex ? `<div><div class="row" style="margin-bottom:8px"><span class="sec-t">로그인 아이디</span><span class="hint">거래처가 이 아이디로 사이트에 들어와 직접 주문해요</span></div>
        ${creds}
        ${logins.length ? `<ul class="list panel" style="margin-bottom:8px">${logins.map(p => `<li class="li"><div class="li-main"><div class="li-t"><span class="mono">${esc(p.login_id)}</span> ${esc(p.name || '')} ${p.active ? '' : '<span class="tag bad">잠김</span>'}${p.temp_pw ? ' <span class="tag warn">임시 비밀번호</span>' : ''}</div><div class="li-s">${fmtDT(p.created_at)} 발급</div></div><button class="btn sm" data-act="resetPw" data-u="${esc(p.user_id)}"${busyAttr()}>비밀번호 재설정</button><button class="btn sm ghost" data-act="toggleLogin" data-u="${esc(p.user_id)}"${busyAttr()}>${p.active ? '잠그기' : '풀기'}</button>${armBtn('rmLogin:' + p.user_id, '삭제', '한 번 더 누르면 삭제', 'danger sm')}</li>`).join('')}</ul>` : ''}
        <div class="row"><label class="sr" for="m-newLogin">새 아이디</label><input class="inp mono" id="m-newLogin" data-m="newLogin" value="${esc(d.newLogin || '')}" placeholder="새 아이디 (영문 소문자·숫자)" style="max-width:240px" autocapitalize="none" spellcheck="false"><input class="inp" id="m-newLoginName" data-m="newLoginName" value="${esc(d.newLoginName || '')}" placeholder="담당자 이름 (선택)" style="max-width:180px"><button class="btn" data-act="createLogin"${busyAttr()}>아이디 발급</button></div>
      </div>` : `<div class="note info">거래처를 먼저 저장하면 로그인 아이디를 발급할 수 있어요.</div>`}
      <div class="fgrid">
        ${mf('상호', 'name', { req: true, af: !ex })}${msel('종류', 'type', ACC_TYPES)}
        ${mf('요양기관기호', 'ykiho', { ph: '8자리', mono: true })}${mf('사업자등록번호', 'biz_no', { ph: '000-00-00000', mono: true })}
        ${mf('대표자', 'ceo')}${mf('담당자', 'manager')}${mf('전화', 'tel')}${mf('휴대폰 (계산서 알림톡)', 'mobile', { ph: '010-0000-0000' })}
        ${mf('세금계산서 이메일', 'tax_email', { ph: 'tax@example.com' })}${msel('계산서 발행', 'invoice_cycle', [['월합계', '월합계 (다음 달 10일까지 한 장)'], ['건별', '건별 (출고마다)']])}
        ${mf('업태', 'biz_type', { ph: '보건업' })}${mf('종목', 'biz_item', { ph: '약국' })}
        ${mf('배송 주소 (사업장 주소)', 'addr', { full: true })}
        ${mf('할인율 (%)', 'discount', { num: true, ph: '0' })}${mf('여신한도 (원)', 'credit_limit', { num: true, ph: '0이면 한도 없음' })}
        ${mf('결제 조건', 'pay_terms', { ph: '예: 월말 마감, 익월 10일 입금' })}${mf('메모', 'memo')}
        <div class="fld full">${mchk('거래 중 (끄면 이 거래처 아이디로 주문할 수 없어요)', 'active')}</div>
      </div>
      <div><div class="row" style="margin-bottom:8px"><span class="sec-t">거래처 특가</span><span class="hint">할인율 대신 이 단가를 써요</span><span class="spacer"></span><button class="btn sm" data-act="addSpecial">특가 추가</button></div>${sp || '<p class="hint">특가 품목이 없어요.</p>'}</div>`;
    return frame(ex ? '거래처 수정' : '거래처 등록', ex ? esc(ex.name) : '', body, `<span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button><button class="btn primary" data-act="saveAccount"${busyAttr()}>저장</button>`);
  },
  payment() {
    const accs = [...S.accounts.values()].sort((a, b) => ko(a.name, b.name)); const d = M.draft;
    const b = d.account_id ? balanceOf(d.account_id).bal : null;
    const body = `<div class="fgrid">${msel('거래처', 'account_id', [['', '거래처 선택'], ...accs.map(a => [a.id, a.name])], { live: true })}${mf('입금일', 'date', { type: 'date' })}${mf('금액 (원)', 'amount', { num: true, req: true, af: true })}${msel('방법', 'method', PAY_METHODS)}${mf('메모', 'memo', { full: true, ph: '예: 9월분' })}</div>${b != null ? `<p class="hint">현재 미수 잔액 ${won(b)}원</p>` : ''}`;
    return frame('입금 등록', '', body, `<span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button><button class="btn primary" data-act="savePayment"${busyAttr()}>등록</button>`);
  },
  importx() {
    const d = M.draft; const res = M.data;
    const upd = res.items.filter(x => x.match).length, add = res.items.length - upd;
    const body = `<div class="note info">${esc(res.file)} · ${res.items.length}개 품목을 읽었어요. 기존 상품 ${upd}개는 갱신하고, 새 상품 ${add}개를 추가해요.</div>
      <div class="fgrid">${res.hasRx ? mf('처방 통계 월', 'month', { type: 'month' }) : ''}${msel('새 상품 구분', 'kind', KINDS)}</div>
      <div class="tbl-wrap" style="max-height:300px;overflow:auto"><table><thead><tr><th></th><th>코드</th><th>제품명</th><th>규격</th><th class="num">단가</th>${res.hasRx ? '<th class="num">총 처방량</th>' : ''}</tr></thead><tbody>${res.items.slice(0, 300).map(x => `<tr><td><span class="tag ${x.match ? '' : 'gold'}">${x.match ? '갱신' : '추가'}</span></td><td class="mono">${esc(x.code || '-')}</td><td>${esc(x.name)}</td><td class="s">${esc(x.spec)}</td><td class="num">${x.base != null ? won(x.base) : (x.price != null ? won(x.price) : '-')}</td>${res.hasRx ? `<td class="num">${won(x.rx?.qty)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
      <p class="hint">갱신할 때 처방량과 기준가만 바꿔요. 판매가는 기준가와 같게 쓰던 품목만 새 기준가로 따라 바뀌고, 따로 정한 판매가는 그대로 둬요.</p>
      ${M.busy ? `<div class="loading" style="justify-content:flex-start"><i></i>저장하는 중</div>` : ''}`;
    return frame('엑셀 올리기', '', body, `<span class="spacer"></span><button class="btn" data-act="closeModal"${busyAttr()}>닫기</button><button class="btn primary" data-act="applyImport"${busyAttr()}>${res.items.length}개 반영</button>`);
  },
  invoice() {
    const t = S.invoices.get(M.data.id); if (!t) return frame('세금계산서', '', '<p class="muted">계산서를 찾을 수 없어요.</p>');
    const st = S.settings; const sp = t.supplied || {}; const editable = t.status === '대기' || t.status === '실패';
    const probs = invoiceProblems(t);
    const ready = S.tax?.hasKey && S.taxcfg.issuer_id;
    const cell = (v) => esc(v || '');
    const items = t.items || [];
    const body = `
      ${t.status === '실패' ? `<div class="note bad"><b>발행 실패</b>${esc(t.error || '')}</div>` : ''}
      ${t.status === '발행중' ? `<div class="note info"><b>볼타가 처리하는 중</b>${esc(t.error || '잠시 뒤 상태 확인을 눌러 주세요.')}</div>` : ''}
      ${t.status === '발행완료' ? `<div class="note ok"><b>${t.mode === 'test' ? '테스트 발행 완료' : '국세청 발행 완료'}</b>승인번호 <span class="mono">${esc(t.nts_id || '')}</span> · ${fmtDT(t.issued_at)}</div>` : ''}
      ${editable && probs.length ? `<div class="note warn"><b>발행 전에 채울 정보</b>${probs.map(p => esc(p[1])).join(', ')}${probs.some(p => p[0] === '거래처') ? ` <button class="btn sm" data-act="editAccountFromInv" data-id="${esc(t.account_id)}">거래처 정보 수정</button>` : ''}${probs.some(p => p[0] === '설정') ? ` <button class="btn sm" data-act="goSettingsFromInv">설정으로</button>` : ''}</div>` : ''}
      <div class="ti"><table>
        <tr><td colspan="9" class="ti-title">전자세금계산서</td></tr>
        <tr><th rowspan="5" class="side-h">공급자</th><th>등록번호</th><td colspan="2" class="mono">${cell(bizFmt(st.biz_no))}</td><th rowspan="5" class="side-h">공급받는자</th><th>등록번호</th><td colspan="3" class="mono">${cell(bizFmt(sp.identificationNumber))}</td></tr>
        <tr><th>상호</th><td colspan="2">${cell(st.name)} <span class="muted">/ ${cell(st.ceo)}</span></td><th>상호</th><td colspan="3">${cell(sp.organizationName)} <span class="muted">/ ${cell(sp.representativeName)}</span></td></tr>
        <tr><th>주소</th><td colspan="2">${cell(st.addr)}</td><th>주소</th><td colspan="3">${cell(sp.address)}</td></tr>
        <tr><th>업태·종목</th><td colspan="2">${cell(st.biz_type)} ${st.biz_item ? '· ' + cell(st.biz_item) : ''}</td><th>업태·종목</th><td colspan="3">${cell(sp.businessType)} ${sp.businessItem ? '· ' + cell(sp.businessItem) : ''}</td></tr>
        <tr><th>이메일</th><td colspan="2">${cell(st.tax_email)}</td><th>이메일</th><td colspan="3">${cell(sp.managers?.[0]?.email)}</td></tr>
        <tr><th colspan="2">작성일자</th><td colspan="2" class="tabnum">${fmtD(t.write_date)}</td><th colspan="2">공급가액</th><td class="num">${won(t.supply)}</td><th>세액</th><td class="num">${won(t.vat)}</td></tr>
        <tr><th>월·일</th><th colspan="3">품목</th><th>규격</th><th>수량</th><th>단가</th><th>공급가액</th><th>세액</th></tr>
        ${items.map(it => `<tr><td class="tabnum nowrap">${String(it.date || '').slice(5).replace('-', '.')}</td><td colspan="3">${cell(it.name)}</td><td class="s">${cell(it.specification)}</td><td class="num">${it.quantity != null ? won(it.quantity) : ''}</td><td class="num">${it.unitPrice != null ? won(it.unitPrice) : ''}</td><td class="num">${won(it.supplyCost)}</td><td class="num">${won(it.tax)}</td></tr>`).join('')}
        <tr><th colspan="2">합계금액</th><td colspan="3" class="num"><b>${won(t.total)}</b></td><td colspan="4">이 금액을 <b>${t.purpose === 'RECEIPT' ? '영수' : '청구'}</b> 함</td></tr>
      </table></div>
      ${editable ? `<div class="fgrid">${msel('영수/청구', 'purpose', [['CLAIM', '청구 (외상 · 나중에 입금)'], ['RECEIPT', '영수 (이미 입금됨)']], { live: true })}${mf('비고 (선택)', 'memo', { ph: '계산서에 표시할 메모' })}</div><p class="hint">거래처 정보를 고쳤다면 ‘받는 쪽 정보 새로 반영’을 눌러 계산서에 다시 담아요. 품목은 출고내역에서 만들어져요.</p>` : ''}
      <p class="hint">${meta(esc(t.kind), `${esc(t.period)} 공급분`, `출고 ${[...S.shipments.values()].filter(s => s.invoice_id === t.id).length}건 묶음`, t.mode ? (t.mode === 'live' ? '실제 발행' : '테스트') : '')}</p>`;
    let foot = '';
    if (editable) foot = `${armBtn('voidInv', '이 계산서 취소', '한 번 더 누르면 취소')}<button class="btn ghost" data-act="refreshRecipient"${busyAttr()}>받는 쪽 정보 새로 반영</button><span class="spacer"></span><button class="btn primary" data-act="issueInvoice"${busyAttr()}${probs.length || !ready ? ' disabled' : ''}>${S.tax?.mode === 'live' ? '국세청에 발행' : '테스트 발행'}</button>`;
    else if (t.status === '발행중') foot = `<span class="spacer"></span><button class="btn primary" data-act="refreshInvoice"${busyAttr()}>상태 확인</button>`;
    else if (t.status === '발행완료') foot = `<button class="btn ghost" data-act="refreshInvoice"${busyAttr()}>상태 확인</button><span class="spacer"></span><button class="btn primary" data-act="invoicePdf"${busyAttr()}>PDF 열기</button>`;
    else foot = `<span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button>`;
    return frame(`세금계산서 ${tiPill(t.status)}`, meta(esc(sp.organizationName || ''), `${won(t.total)}원`), body, foot);
  },
  login() {
    const p = S.profiles.get(M.data.uid); if (!p) return frame('계정', '', '<p class="muted">계정을 찾을 수 없어요.</p>');
    const creds = S.ui.lastCreds && S.ui.lastCreds.user_id === p.user_id ? credsBox(S.ui.lastCreds) : '';
    return frame(`<span class="mono">${esc(p.login_id)}</span>`, `${p.role === 'admin' ? '관리자' : '거래처'} 계정${p.active ? '' : ' · 잠김'}`, `${creds}<p class="hint">비밀번호를 재설정하면 임시 비밀번호가 만들어지고, 다음 로그인 때 새 비밀번호로 바꾸게 돼요.</p>`,
      `${armBtn('rmLogin:' + p.user_id, '계정 삭제', '한 번 더 누르면 삭제', 'danger')}<button class="btn ghost" data-act="toggleLogin" data-u="${esc(p.user_id)}"${busyAttr()}>${p.active ? '잠그기' : '풀기'}</button><span class="spacer"></span><button class="btn primary" data-act="resetPw" data-u="${esc(p.user_id)}"${busyAttr()}>비밀번호 재설정</button>`);
  },
  newAdmin() {
    const creds = S.ui.lastCreds && S.ui.lastCreds.role === 'admin' ? credsBox(S.ui.lastCreds) : '';
    return frame('관리자 추가', '원윤메디팜 직원이 쓸 관리자 아이디를 만들어요', `${creds}<div class="fgrid">${mf('아이디', 'login_id', { af: true, mono: true, ph: '영문 소문자·숫자' })}${mf('이름', 'name')}</div><p class="hint">관리자는 모든 거래처 주문·단가·미수·세금계산서를 볼 수 있어요.</p>`,
      `<span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button><button class="btn primary" data-act="createAdmin"${busyAttr()}>관리자 만들기</button>`);
  },
  myPw() {
    return frame('내 비밀번호 변경', '', `<div class="fgrid">${mf('새 비밀번호 (8자 이상)', 'a', { type: 'password', af: true, ac: 'new-password' })}${mf('새 비밀번호 확인', 'b', { type: 'password', ac: 'new-password' })}</div>`, `<span class="spacer"></span><button class="btn" data-act="closeModal">닫기</button><button class="btn primary" data-act="saveMyPw"${busyAttr()}>바꾸기</button>`);
  }
};

/* ---------- actions ---------- */
async function run(fnc, okMsg, modal = true) {
  if (modal) { M.busy = true; renderModal(); } else { S.busy = true; schedule(); }
  try { const r = await fnc(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok'); return r == null ? true : r; }
  catch (e) { console.warn(e); toast(errMsg(e), 'bad'); return false; }
  finally { if (modal) { M.busy = false; if (M.kind) renderModal(); } else { S.busy = false; schedule(); } }
}
function draftLines(o) { return (o.lines || []).map((l, i) => { const d = M.draft.lines[i] || {}; return { qty: Math.max(0, Math.floor(num(d.qty))), price: Math.max(0, num(d.price)), lot: String(d.lot || '').trim(), exp: d.exp || '' }; }); }
function openWindow() { try { return window.open('about:blank', '_blank'); } catch { return null; } }

const A = {
  go(d) { S.view = d.v; LS.set('view', d.v); if (d.v === 'settings') { S.ui.setd = null; loadTaxStatus(false); } S.ui.armed = ''; render(); window.scrollTo(0, 0); },
  goOrders(d) { S.ui.ostatus = d.s; A.go({ v: 'orders' }); },
  goInvoices(d) { S.ui.invMonth = d.m; A.go({ v: 'invoices' }); },
  ostatus(d) { S.ui.ostatus = d.s; render(); },
  invStatus(d) { S.ui.invStatus = d.s; render(); },
  cview(d) { S.cview = d.v; S.ui.np = {}; if (d.v === 'reqs') LS.set(reqSeenKey(), new Date().toISOString()); render(); window.scrollTo(0, 0); },
  rqStatus(d) { S.ui.rqStatus = d.s; render(); },
  reqStock(d) { const p = S.products.get(d.id); if (!p) return; openModal('stockReq', { pid: p.id }, { qty: '', memo: '' }); },
  reqNew() { openModal('stockReq', {}, { name: S.ui.shopQ.trim(), spec: '', maker: '', qty: '', memo: '' }); },
  async sendReq() {
    const d = M.draft; const pid = M.data.pid || null; const name = String(d.name || '').trim();
    if (!pid && name.length < 2) return toast('약품 이름을 2자 이상 입력해 주세요', 'bad');
    const ext = M.data.ext || {};
    const ok = await run(() => rpc('request_stock2', { p_product_id: pid, p_name: name, p_spec: String(d.spec || '').trim(), p_maker: String(d.maker || '').trim(), p_qty: String(d.qty || '').trim(), p_memo: String(d.memo || '').trim(), p_ext_seq: ext.seq || '', p_ext_code: ext.code || '' }), pid ? '재고를 요청했어요. 입고되면 바로 알려 드려요' : '보유를 요청했어요. 확인 후 안내해 드려요');
    if (ok) { closeModal(); reload('reqs', 'products'); }
  },
  async cancelReq(d) {
    if (S.ui.armed !== 'rq:' + d.id) { S.ui.armed = 'rq:' + d.id; render(); return; }
    S.ui.armed = '';
    if (await run(() => rpc('cancel_stock_request', { p_id: d.id }), '요청을 취소했어요', false)) reload('reqs');
  },
  orderReq(d) {
    const r = S.reqs.get(d.id); if (!r) return;
    Object.assign(S.ui, { shopQ: r.name, shopChip: '전체', shopGroup: '' }); S.cview = 'shop'; render(); window.scrollTo(0, 0);
    setTimeout(() => document.getElementById('q-' + r.product_id)?.focus(), 0); drugSoon('shop');
  },
  openReq(d) { const r = S.reqs.get(d.id); if (!r) return; openModal('reqAdmin', { id: r.id }, { admin_memo: r.admin_memo || '' }); },
  async setReq(d) {
    const r = S.reqs.get(M.data.id); if (!r) return;
    const msg = { '확인': '저장했어요. 거래처 화면에도 바로 보여요', '입고완료': '입고 완료로 처리했어요', '불가': '보유 불가로 처리했어요', '요청': '처리 대기로 되돌렸어요' }[d.s];
    if (await run(() => rpc('set_stock_request', { p_id: r.id, p_status: d.s, p_admin_memo: String(M.draft.admin_memo || '').trim() }), msg)) { closeModal(); reload('reqs'); }
  },
  reqToStock(d) { closeModal(); A.editStock({ id: d.id }); },
  async reqUnsoldout(d) { if (await run(() => q(sb.from('products').update({ soldout: false, updated_at: new Date().toISOString() }).eq('id', d.id)), '일시 품절을 풀었어요. 이 품목 요청은 입고 완료됐어요')) { closeModal(); reload('products', 'reqs'); } },
  reqToProduct() { const r = S.reqs.get(M.data.id); if (!r) return; closeModal(); A.newProduct(); Object.assign(M.draft, { name: r.name, spec: r.spec || '', maker: r.maker || '', code: r.ext_code || '' }); renderModal(); },
  drugDetail(d) { openDrug(d.seq); },
  drugOf(d) { openDrug(null, d.id); },
  drugMore() { S.ui.drugMore = true; render(); },
  drugTest() { S.drugCache.delete(String(S.ui.drugTestQ || '').replace(/\s+/g, ' ').trim()); runDrug(S.ui.drugTestQ, 'test'); },
  drugCheck() { S.drugOn = null; render(); loadDrugStatus(true); },
  drugAdd(d) {
    const p = S.products.get(d.id); if (!p || !orderable(p) || !S.myAccount) return; const key = S.myAccount.id; const step = Math.max(1, num(p.step) || 1);
    setQty(key, p.id, (cartOf(key).lines[p.id] || 0) + step); closeModal(); toast(`${p.name} ${step}${p.unit || ''}를 담았어요. 수량은 장바구니에서 바꿀 수 있어요`, 'ok'); render();
  },
  reqDrug(d) {
    const x = findDrug(d.seq); if (!x) return;
    openModal('stockReq', { ext: { seq: x.seq, code: (x.edi || [])[0] || '', name: x.name, company: x.company } }, { name: x.name, spec: String(x.strength || '').slice(0, 60), maker: x.company || '', qty: '', memo: '' });
  },
  newFromDrug(d) {
    const x = findDrug(d.seq); if (!x) return; closeModal(); A.newProduct();
    Object.assign(M.draft, { name: x.name, spec: String(x.strength || '').slice(0, 60), maker: x.company || '', code: (x.edi || [])[0] || '' }); renderModal();
  },
  shopChip(d) { S.ui.shopChip = d.c; render(); },
  fav(d) { S.favs.has(d.id) ? S.favs.delete(d.id) : S.favs.add(d.id); LS.set('favs', [...S.favs]); render(); },
  qty(d) { const c = cartOf(d.key); setQty(d.key, d.id, (c.lines[d.id] || 0) + num(d.d)); render(); },
  rmLine(d) { setQty(d.key, d.id, 0); render(); },
  toCart() { document.getElementById('cart')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  toggleOpen(d) { S.ui.open[d.id] = !S.ui.open[d.id]; render(); },
  reloadPage() { location.reload(); },
  async logout() { try { await sb.auth.signOut(); } catch {} location.reload(); },
  reorder(d) {
    const o = S.orders.get(d.id); if (!o || !S.myAccount) return; let n = 0, miss = 0; const key = S.myAccount.id;
    for (const l of o.lines || []) { const p = S.products.get(l.pid); if (p && p.active !== false) { setQty(key, l.pid, num(l.oqty ?? l.qty) || num(l.qty)); n++; } else miss++; }
    S.cview = 'shop';
    toast(`${n}품목을 장바구니에 담았어요${miss ? ` (판매 중지 ${miss}품목 제외)` : ''}`, 'ok'); render();
  },
  async submitOrder() {
    const ctx = custCtx(); const key = ctx.account_id; const c = cartOf(key);
    const inCart = Object.entries(c.lines).filter(([pid, qv]) => S.products.get(pid) && qv > 0);
    const items = inCart.filter(([pid]) => orderable(S.products.get(pid))).map(([pid, qv]) => ({ product_id: pid, qty: qv }));
    if (!items.length) return toast(inCart.length ? '담은 품목이 모두 품절이에요. 재고 요청을 남겨 주세요.' : '담은 품목이 없어요', 'bad');
    const skipped = inCart.length - items.length;
    const r = await run(() => rpc('place_order', { p_items: items, p_want_date: c.want_date || null, p_memo: String(c.memo || '').trim() }), r => `주문 ${r.no} 접수했어요${skipped ? ` (품절 ${skipped}품목 제외)` : ''}`, false);
    if (!r) { reload('products'); return; }
    if (r) { S.cart[key] = { lines: {}, want_date: '', memo: '' }; saveCart(key); S.cview = 'history'; S.ui.open[r.id] = true; await reload('orders'); window.scrollTo(0, 0); }
  },
  async custCancel(d) {
    if (S.ui.armed !== 'cx:' + d.id) { S.ui.armed = 'cx:' + d.id; render(); return; }
    S.ui.armed = '';
    if (await run(() => rpc('cancel_my_order', { p_order_id: d.id }), '주문을 취소했어요', false)) reload('orders');
  },
  openOrder(d) { const o = S.orders.get(d.id); if (!o) return; openModal('order', { id: d.id }, { lines: (o.lines || []).map(l => ({ qty: l.qty, price: l.price, lot: l.lot || '', exp: l.exp || '' })), admin_memo: o.admin_memo || '', force: false }, { live: true, size: 'wide' }); },
  closeModal() { if (!M.busy) { closeModal(); S.ui.lastCreds = null; } },
  arm(d) {
    if (M.armed !== d.a) { M.armed = d.a; renderModal(); return; }
    M.armed = ''; const k = d.a;
    if (k === 'cancel') return A.orderStatus('취소', '주문을 취소했어요');
    if (k === 'voidInv') return A.voidInvoice();
    if (k.startsWith('rmLogin:')) return A.removeLogin(k.slice(8));
  },
  async orderStatus(status, msg, withLines) {
    const o = S.orders.get(M.data.id); if (!o) return;
    const args = { p_order_id: o.id, p_status: status, p_lines: withLines ? draftLines(o) : null, p_admin_memo: withLines ? String(M.draft.admin_memo || '').trim() : null };
    if (await run(() => rpc('set_order_status', args), msg)) await reload('orders');
  },
  saveOrderEdits() { const o = S.orders.get(M.data.id); if (o) A.orderStatus(o.status, '수정 내용을 저장했어요', true); },
  confirmOrder() { A.orderStatus('확인', '주문을 확인했어요. 거래처 화면에도 바로 반영돼요', true); },
  backToNew() { A.orderStatus('접수', '접수 상태로 되돌렸어요'); },
  restoreOrder() { A.orderStatus('접수', '접수 상태로 복구했어요'); },
  deliverOrder() { A.orderStatus('완료', '배송 완료로 바꿨어요'); },
  async shipOrder() {
    const o = S.orders.get(M.data.id); if (!o || o.status !== '확인') return;
    const lines = draftLines(o);
    const r = await run(() => rpc('ship_order', { p_order_id: o.id, p_lines: lines, p_admin_memo: String(M.draft.admin_memo || '').trim(), p_force: !!M.draft.force }), r => `출고 처리했어요 · ${won(r.total)}원`);
    if (r) await reload('orders', 'shipments', 'products', 'moves');
  },
  newProduct() { openModal('product', {}, { kind: '의약품', grp: '', name: '', spec: '', maker: '', code: '', std: '', unit: '개', step: 1, base_price: '', price: '', safety: '', track: false, active: true, soldout: false }); },
  editProduct(d) { const p = S.products.get(d.id); if (!p) return; openModal('product', { id: p.id }, { kind: p.kind || '의약품', grp: p.grp || '', name: p.name || '', spec: p.spec || '', maker: p.maker || '', code: p.code || '', std: p.std || '', unit: p.unit || '', step: p.step || 1, base_price: p.base_price ?? '', price: p.price ?? '', safety: p.safety || '', track: !!p.track, active: p.active !== false, soldout: !!p.soldout }); },
  async saveProduct() {
    const d = M.draft; const ex = M.data.id ? S.products.get(M.data.id) : null;
    if (!String(d.name).trim()) return toast('제품명을 입력하세요', 'bad');
    if (String(d.price).trim() === '' || num(d.price) < 0) return toast('판매가를 입력하세요', 'bad');
    const code = normCode(d.code);
    const id = ex ? ex.id : (code ? 'p' + safeId(code) : 'p' + rid());
    if (!ex && S.products.has(id)) return toast('같은 보험코드 상품이 이미 있어요', 'bad');
    const body = { kind: d.kind, grp: String(d.grp).trim(), code, std: String(d.std).trim(), name: String(d.name).trim(), spec: String(d.spec).trim(), maker: String(d.maker).trim(), unit: String(d.unit).trim() || '개', step: Math.max(1, Math.floor(num(d.step)) || 1), base_price: String(d.base_price).trim() === '' ? num(d.price) : num(d.base_price), price: num(d.price), safety: Math.max(0, num(d.safety)), track: !!d.track, active: !!d.active, soldout: !!d.soldout, updated_at: new Date().toISOString() };
    const ok = await run(() => ex ? q(sb.from('products').update(body).eq('id', id)) : q(sb.from('products').insert({ id, ...body })), '상품을 저장했어요');
    if (ok) { closeModal(); reload('products', 'reqs'); }
  },
  editStock(d) { const p = S.products.get(d.id); if (!p) return; openModal('stock', { id: p.id }, { type: '입고', qty: '', lot: '', exp: '', date: today(), memo: '' }); },
  async saveStock() {
    const p = S.products.get(M.data.id); if (!p) return; const d = M.draft; const qv = Math.floor(num(d.qty));
    if (d.type === '실사 조정' ? (String(d.qty).trim() === '' || qv < 0) : qv <= 0) return toast('수량을 확인하세요', 'bad');
    const r = await run(() => rpc('adjust_stock', { p_product_id: p.id, p_type: d.type, p_qty: qv, p_lot: String(d.lot || '').trim(), p_exp: d.type === '실사 조정' || d.type === '폐기' ? null : (d.exp || null), p_date: d.date || today(), p_memo: String(d.memo || '').trim() }), r => `재고 ${won(r.stock)}${p.unit || ''}로 맞췄어요`);
    if (r) { M.draft = { type: d.type, qty: '', lot: '', exp: '', date: d.date, memo: '' }; await reload('products', 'moves', 'reqs'); renderModal(); }
  },
  newAccount() { S.ui.lastCreds = null; openModal('account', {}, { name: '', type: '약국', ykiho: '', biz_no: '', ceo: '', manager: '', tel: '', mobile: '', tax_email: '', biz_type: '', biz_item: '', invoice_cycle: '월합계', addr: '', pay_terms: '월말 마감', discount: '', credit_limit: '', memo: '', active: true, special: [] }, { live: true }); },
  editAccount(d) { const a = S.accounts.get(d.id); if (!a) return; if (!(S.ui.lastCreds && S.ui.lastCreds.account_id === a.id)) S.ui.lastCreds = null; openModal('account', { id: a.id }, { ...a, discount: a.discount || '', credit_limit: a.credit_limit || '', active: a.active !== false, special: Object.entries(S.special.get(a.id) || {}).map(([pid, price]) => ({ pid, price })) }, { live: true }); },
  editAccountFromInv(d) { closeModal(); A.editAccount(d); },
  goSettingsFromInv() { closeModal(); A.go({ v: 'settings' }); },
  addSpecial() { M.draft.special = [...(M.draft.special || []), { pid: '', price: '' }]; renderModal(); },
  rmSpecial(d) { M.draft.special.splice(+d.i, 1); renderModal(); },
  async saveAccount() {
    const d = M.draft; const ex = M.data.id ? S.accounts.get(M.data.id) : null;
    if (!String(d.name || '').trim()) return toast('상호를 입력하세요', 'bad');
    const body = { name: String(d.name).trim(), type: d.type, ykiho: String(d.ykiho || '').trim(), biz_no: String(d.biz_no || '').trim(), ceo: String(d.ceo || '').trim(), manager: String(d.manager || '').trim(), tel: String(d.tel || '').trim(), mobile: String(d.mobile || '').trim(), tax_email: String(d.tax_email || '').trim(), biz_type: String(d.biz_type || '').trim(), biz_item: String(d.biz_item || '').trim(), invoice_cycle: d.invoice_cycle || '월합계', addr: String(d.addr || '').trim(), pay_terms: String(d.pay_terms || '').trim(), discount: Math.min(100, Math.max(0, num(d.discount))), credit_limit: Math.max(0, num(d.credit_limit)), memo: String(d.memo || '').trim(), active: !!d.active, updated_at: new Date().toISOString() };
    if (body.biz_no && digits(body.biz_no).length !== 10) return toast('사업자등록번호는 숫자 10자리예요', 'bad');
    if (body.tax_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.tax_email)) return toast('세금계산서 이메일 형식을 확인하세요', 'bad');
    const specials = (d.special || []).filter(s => s.pid && String(s.price ?? '').trim() !== '').map(s => ({ product_id: s.pid, price: Math.max(0, num(s.price)) }));
    const saved = await run(async () => {
      let id = ex?.id;
      if (ex) await q(sb.from('accounts').update(body).eq('id', id));
      else id = (await q(sb.from('accounts').insert(body).select('id').single())).id;
      const keep = specials.map(s => s.product_id);
      const del = sb.from('special_prices').delete().eq('account_id', id);
      await q(keep.length ? del.not('product_id', 'in', `(${keep.map(k => `"${k}"`).join(',')})`) : del);
      if (specials.length) await q(sb.from('special_prices').upsert(specials.map(s => ({ account_id: id, ...s }))));
      return id;
    }, ex ? '거래처를 저장했어요' : '거래처를 등록했어요. 이제 로그인 아이디를 발급하세요');
    if (saved) { await reload('accounts', 'special'); if (!ex) { M.data = { id: saved }; M.draft = { ...S.accounts.get(saved), discount: body.discount || '', credit_limit: body.credit_limit || '', special: specials.map(s => ({ pid: s.product_id, price: s.price })) }; renderModal(); setTimeout(() => document.getElementById('m-newLogin')?.focus(), 0); } else closeModal(); }
  },
  async createLogin() {
    const a = S.accounts.get(M.data.id); if (!a) return; const loginId = String(M.draft.newLogin || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(loginId)) return toast('아이디는 영문 소문자·숫자 3~30자예요', 'bad');
    const pw = tempPassword();
    const r = await run(() => fn('admin-users', { action: 'create', role: 'customer', account_id: a.id, login_id: loginId, password: pw, name: String(M.draft.newLoginName || '').trim() }), '아이디를 발급했어요');
    if (r) { S.ui.lastCreds = { login_id: loginId, password: pw, account_id: a.id, user_id: r.user_id }; M.draft.newLogin = ''; M.draft.newLoginName = ''; await reload('profiles'); renderModal(); }
  },
  async resetPw(d) {
    const p = S.profiles.get(d.u); if (!p) return; const pw = tempPassword();
    const r = await run(() => fn('admin-users', { action: 'reset_password', user_id: p.user_id, password: pw }), '임시 비밀번호를 만들었어요');
    if (r) { S.ui.lastCreds = { login_id: p.login_id, password: pw, account_id: p.account_id, user_id: p.user_id, role: p.role }; await reload('profiles'); renderModal(); }
  },
  async toggleLogin(d) {
    const p = S.profiles.get(d.u); if (!p) return;
    if (await run(() => fn('admin-users', { action: 'set_active', user_id: p.user_id, active: !p.active }), p.active ? '로그인을 잠갔어요' : '잠금을 풀었어요')) { await reload('profiles'); renderModal(); }
  },
  async removeLogin(uid) {
    if (await run(() => fn('admin-users', { action: 'remove', user_id: uid }), '계정을 삭제했어요')) { if (S.ui.lastCreds?.user_id === uid) S.ui.lastCreds = null; await reload('profiles'); if (M.kind === 'login') closeModal(); else renderModal(); }
  },
  loginMenu(d) { if (!(S.ui.lastCreds && S.ui.lastCreds.user_id === d.u)) S.ui.lastCreds = null; openModal('login', { uid: d.u }); },
  newAdmin() { S.ui.lastCreds = null; openModal('newAdmin', {}, { login_id: '', name: '' }); },
  async createAdmin() {
    const loginId = String(M.draft.login_id || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(loginId)) return toast('아이디는 영문 소문자·숫자 3~30자예요', 'bad');
    const pw = tempPassword();
    const r = await run(() => fn('admin-users', { action: 'create', role: 'admin', login_id: loginId, password: pw, name: String(M.draft.name || '').trim() }), '관리자 아이디를 만들었어요');
    if (r) { S.ui.lastCreds = { login_id: loginId, password: pw, user_id: r.user_id, role: 'admin' }; M.draft = { login_id: '', name: '' }; await reload('profiles'); renderModal(); }
  },
  async copyCreds() {
    const c = S.ui.lastCreds; if (!c) return; const text = `원윤메디팜 주문 사이트\n주소: ${location.origin + location.pathname}\n아이디: ${c.login_id}\n임시 비밀번호: ${c.password}\n(첫 로그인 때 새 비밀번호로 바꿔 주세요)`;
    try { await navigator.clipboard.writeText(text); toast('안내 문구를 복사했어요', 'ok'); } catch { toast('복사하지 못했어요. 직접 적어 주세요', 'bad'); }
  },
  myPassword() { openModal('myPw', {}, { a: '', b: '' }); },
  async saveMyPw() {
    const { a, b } = M.draft; if (String(a).length < 8) return toast('비밀번호는 8자 이상이에요', 'bad'); if (a !== b) return toast('두 비밀번호가 달라요', 'bad');
    if (await run(async () => { const { error } = await sb.auth.updateUser({ password: a }); if (error) throw error; }, '비밀번호를 바꿨어요')) closeModal();
  },
  newPayment(d) { openModal('payment', {}, { account_id: d.c || '', date: today(), amount: '', method: '계좌이체', memo: '' }); },
  async savePayment() {
    const d = M.draft; const a = S.accounts.get(d.account_id);
    if (!a) return toast('거래처를 고르세요', 'bad'); if (num(d.amount) <= 0) return toast('금액을 입력하세요', 'bad');
    if (await run(() => q(sb.from('payments').insert({ account_id: a.id, date: d.date || today(), amount: Math.round(num(d.amount)), method: d.method, memo: String(d.memo || '').trim() })), '입금을 등록했어요')) { closeModal(); reload('payments'); }
  },
  async delPayment(d) {
    if (S.ui.armed !== 'pay:' + d.id) { S.ui.armed = 'pay:' + d.id; render(); return; }
    S.ui.armed = ''; if (await run(() => q(sb.from('payments').delete().eq('id', d.id)), '입금 기록을 삭제했어요', false)) reload('payments');
  },
  async saveSettings() {
    const d = S.ui.setd; if (!d) return;
    if (d.biz_no && digits(d.biz_no).length !== 10) return toast('사업자등록번호는 숫자 10자리예요', 'bad');
    const body = {}; for (const k of ['name', 'biz_no', 'ceo', 'tel', 'fax', 'addr', 'bank', 'biz_type', 'biz_item', 'tax_email', 'tax_manager', 'cutoff', 'notice']) body[k] = String(d[k] || '').trim();
    body.name = body.name || '원윤메디팜'; body.vat_included = d.vat_included !== false; body.updated_at = new Date().toISOString();
    if (await run(() => q(sb.from('settings').update(body).eq('id', 1)), '설정을 저장했어요', false)) { await reload('settings'); S.ui.setd = null; render(); }
  },
  taxStatus() { S.tax = null; render(); loadTaxStatus(true); },
  async registerIssuer() { if (await run(() => fn('tax-invoice', { action: 'register_issuer' }), '볼타에 발급자로 등록했어요', false)) { await reload('taxcfg'); loadTaxStatus(false); } },
  async certUrl() {
    const w = openWindow();
    const r = await run(() => fn('tax-invoice', { action: 'cert_url' }), null, false);
    if (r && r.url) { if (w) w.location.href = r.url; else toast('팝업이 막혔어요. 팝업 허용 후 다시 눌러 주세요', 'bad'); } else if (w) w.close();
  },
  async makeDrafts() {
    const m = S.ui.invMonth;
    const n = await run(() => rpc('create_invoice_drafts', { p_period: m, p_account_id: null }), n => n ? `계산서 ${n}장을 만들었어요. 내용을 확인하고 발행하세요` : '새로 만들 계산서가 없어요', false);
    if (n !== false) reload('invoices', 'shipments');
  },
  openInvoice(d) { const t = S.invoices.get(d.id); if (!t) return; openModal('invoice', { id: t.id }, { purpose: t.purpose, memo: t.memo || '' }, { live: true, size: 'wide' }); },
  async saveInvoiceMeta() { const t = S.invoices.get(M.data.id); if (!t) return; await q(sb.from('tax_invoices').update({ purpose: M.draft.purpose, memo: String(M.draft.memo || '').trim().slice(0, 150), updated_at: new Date().toISOString() }).eq('id', t.id)); },
  async issueInvoice() {
    const t = S.invoices.get(M.data.id); if (!t) return;
    const r = await run(async () => { if (M.draft.purpose !== t.purpose || String(M.draft.memo || '') !== String(t.memo || '')) await A.saveInvoiceMeta(); return fn('tax-invoice', { action: 'issue', id: t.id }); });
    if (r) { toast(r.status === '발행완료' ? '발행을 마쳤어요' : r.status === '실패' ? '발행하지 못했어요: ' + (r.error || '') : '발행을 요청했어요. 잠시 뒤 상태를 확인해 주세요', r.status === '실패' ? 'bad' : 'ok'); await reload('invoices'); }
  },
  async issueAll() {
    const m = S.ui.invMonth; const list = [...S.invoices.values()].filter(t => t.period === m && (t.status === '대기' || t.status === '실패') && !invoiceProblems(t).length);
    const skipped = [...S.invoices.values()].filter(t => t.period === m && (t.status === '대기' || t.status === '실패')).length - list.length;
    if (!list.length) return toast(skipped ? `정보가 빠진 계산서 ${skipped}장은 열어서 고친 뒤 발행해 주세요` : '발행할 계산서가 없어요', 'bad');
    S.busy = true; render(); let ok = 0, bad = 0;
    for (const t of list) { try { const r = await fn('tax-invoice', { action: 'issue', id: t.id }); if (r.status === '실패') bad++; else ok++; } catch (e) { bad++; console.warn(e); } }
    S.busy = false; await reload('invoices');
    toast(`${ok}장 발행 요청${bad ? `, ${bad}장 실패` : ''}${skipped ? `, 정보 부족 ${skipped}장 제외` : ''}`, bad ? 'bad' : 'ok');
  },
  async refreshInvoice() { const t = S.invoices.get(M.data.id); if (!t) return; const r = await run(() => fn('tax-invoice', { action: 'refresh', id: t.id })); if (r) { toast(r.status === '발행완료' ? '발행 완료를 확인했어요' : (r.message || r.error || '아직 처리 중이에요'), r.status === '실패' ? 'bad' : 'ok'); await reload('invoices'); } },
  async invoicePdf() {
    const t = S.invoices.get(M.data.id); if (!t) return; const w = openWindow();
    let r = await run(() => fn('tax-invoice', { action: 'pdf', id: t.id }));
    for (let i = 0; r && r.pending && i < 4; i++) { await new Promise(res => setTimeout(res, (r.retryAfter || 3) * 1000)); r = await run(() => fn('tax-invoice', { action: 'pdf', id: t.id })); }
    if (r && r.url) { if (w) w.location.href = r.url; else toast('팝업이 막혔어요. 팝업 허용 후 다시 눌러 주세요', 'bad'); } else { if (w) w.close(); if (r && r.pending) toast('PDF를 만드는 중이에요. 잠시 뒤 다시 눌러 주세요'); }
  },
  async refreshRecipient() { const t = S.invoices.get(M.data.id); if (!t) return; if (await run(() => rpc('refresh_invoice_recipient', { p_id: t.id }), '거래처 정보를 다시 담았어요')) reload('invoices'); },
  async voidInvoice() { const t = S.invoices.get(M.data.id); if (!t) return; if (await run(() => rpc('void_invoice_draft', { p_id: t.id }), '계산서를 취소했어요. 묶였던 출고는 다시 계산서로 만들 수 있어요')) { closeModal(); reload('invoices', 'shipments'); } },
  importXlsx() { if (!window.XLSX) return toast('엑셀 도구를 불러오지 못했어요. 새로 고쳐 주세요', 'bad'); const el = document.getElementById('xlsx-in'); el.value = ''; el.click(); },
  async applyImport() {
    const res = M.data; const d = M.draft; const month = d.month || thisMonth(); const now = new Date().toISOString();
    const ok = await run(async () => {
      const ups = [], rxs = [];
      for (const x of res.items) {
        if (x.match) {
          const p = S.products.get(x.match); if (!p) continue;
          const row = { ...p, updated_at: now };
          if (x.base != null) { row.base_price = x.base; if (num(p.price) === num(p.base_price)) row.price = x.base; }
          if (x.price != null) row.price = x.price;
          if (!p.grp && x.group) row.grp = x.group;
          ups.push(row);
          if (x.rx) rxs.push({ product_id: p.id, month, count: x.rx.count, qty: x.rx.qty, ins_count: x.rx.insCount, ins_qty: x.rx.insQty, non_count: x.rx.nonCount, non_qty: x.rx.nonQty });
        } else {
          const id = x.code ? 'p' + safeId(x.code) : 'p' + rid(); const price = x.price ?? x.base ?? 0;
          ups.push({ id, kind: x.kind || d.kind || '의약품', grp: x.group || '', code: x.code || '', std: x.std || '', name: x.name, spec: x.spec || '', maker: x.maker || '', unit: x.unit || guessUnit(x.spec), step: 1, base_price: x.base ?? price, price, track: false, stock: 0, safety: 0, lots: [], active: true, updated_at: now });
          if (x.rx) rxs.push({ product_id: id, month, count: x.rx.count, qty: x.rx.qty, ins_count: x.rx.insCount, ins_qty: x.rx.insQty, non_count: x.rx.nonCount, non_qty: x.rx.nonQty });
        }
      }
      for (let i = 0; i < ups.length; i += 200) await q(sb.from('products').upsert(ups.slice(i, i + 200)));
      for (let i = 0; i < rxs.length; i += 200) await q(sb.from('product_rx').upsert(rxs.slice(i, i + 200)));
    }, `${res.items.length}개 품목을 반영했어요`);
    if (ok) { closeModal(); reload('products', 'rx'); }
  },
  exProducts() { exportProducts(); }, exLedger() { exportLedger(); }, exAccounts() { exportAccounts(); }, exOrders() { exportOrders(); }, exInvoices() { exportInvoices(); },
  statement(d) { exportStatement(S.orders.get(d.id)); }
};

/* ---------- forms ---------- */
const FORMS = {
  async login() {
    const id = String(S.ui.lg.id || '').trim().toLowerCase(); const pw = S.ui.lg.pw || '';
    if (!id || !pw) return toast('아이디와 비밀번호를 입력하세요', 'bad');
    S.busy = true; render();
    const { data, error } = await sb.auth.signInWithPassword({ email: emailOf(id), password: pw });
    S.busy = false;
    if (error) { render(); return toast(/banned/i.test(error.message) ? '사용이 중지된 계정이에요. 원윤메디팜에 문의해 주세요' : /fetch|network/i.test(error.message) ? '인터넷 연결을 확인해 주세요' : '아이디 또는 비밀번호가 맞지 않아요', 'bad'); }
    S.ui.lg = { id: '', pw: '' };
    await enter(data.user);
  },
  async setup() {
    const d = S.ui.su; const id = String(d.id || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(id)) return toast('아이디는 영문 소문자·숫자 3~30자예요', 'bad');
    if (String(d.pw || '').length < 8) return toast('비밀번호는 8자 이상이에요', 'bad');
    if (d.pw !== d.pw2) return toast('두 비밀번호가 달라요', 'bad');
    S.busy = true; render();
    try {
      await fn('admin-users', { action: 'bootstrap', login_id: id, password: d.pw, name: String(d.name || '').trim() });
      const { data, error } = await sb.auth.signInWithPassword({ email: emailOf(id), password: d.pw });
      if (error) throw error;
      S.busy = false; S.ui.su = {}; toast('관리자 계정을 만들었어요', 'ok'); S.view = 'dash';
      await enter(data.user);
    } catch (e) { S.busy = false; render(); toast(errMsg(e), 'bad'); }
  },
  async temppw() {
    const { a, b } = S.ui.np; if (String(a || '').length < 8) return toast('비밀번호는 8자 이상이에요', 'bad'); if (a !== b) return toast('두 비밀번호가 달라요', 'bad');
    S.busy = true; render();
    try { const { error } = await sb.auth.updateUser({ password: a }); if (error) throw error; await rpc('clear_temp_pw'); S.busy = false; S.ui.np = {}; toast('비밀번호를 바꿨어요', 'ok'); await enter(S.user); }
    catch (e) { S.busy = false; render(); toast(/different from the old|same/i.test(e.message || '') ? '기존과 다른 비밀번호를 써 주세요' : errMsg(e), 'bad'); }
  },
  async mypw() {
    const { a, b } = S.ui.np; if (String(a || '').length < 8) return toast('비밀번호는 8자 이상이에요', 'bad'); if (a !== b) return toast('두 비밀번호가 달라요', 'bad');
    S.busy = true; render();
    try { const { error } = await sb.auth.updateUser({ password: a }); if (error) throw error; S.ui.np = {}; toast('비밀번호를 바꿨어요', 'ok'); }
    catch (e) { toast(/different from the old|same/i.test(e.message || '') ? '기존과 다른 비밀번호를 써 주세요' : errMsg(e), 'bad'); }
    finally { S.busy = false; render(); }
  }
};

/* ---------- excel ---------- */
function parseRows(rows, file) {
  const hi = rows.findIndex(r => Array.isArray(r) && r.some(c => /약제명|제품명|품목명|상품명/.test(String(c ?? ''))));
  if (hi < 0) return { error: '제목 줄(약제명 또는 제품명)을 찾지 못했어요.' };
  const H = rows[hi].map(c => String(c ?? '').replace(/\s/g, ''));
  const col = (...n) => H.findIndex(h => n.includes(h));
  const c = { group: col('구분', '분류', '효능군', '효능군·분류'), code: col('코드', '보험코드', 'EDI코드', '제품코드', '보험코드(EDI)'), std: col('표준코드', '표준코드(바코드)'), name: col('약제명', '제품명', '품목명', '상품명'), spec: col('규격'), maker: col('제조사', '업체명'), unit: col('판매단위', '단위'), price: col('판매가'), base: col('단가', '기준가', '상한금액', '보험가', '기준가(보험상한)'), kind: col('상품구분', '종류'), cnt: col('총처방횟수'), qty: col('총처방량'), insC: col('급여처방횟수'), insQ: col('급여처방량'), nonC: col('비급여처방횟수'), nonQ: col('비급여처방량') };
  const hasRx = c.qty >= 0; let prev = ''; const items = [];
  const byCode = new Map(), byName = new Map(); for (const p of products()) { if (p.code) byCode.set(p.code, p.id); byName.set((p.name + '|' + (p.spec || '')).toLowerCase(), p.id); }
  for (const r of rows.slice(hi + 1)) {
    if (!r || r[c.name] == null || String(r[c.name]).trim() === '') continue;
    let g = c.group >= 0 ? String(r[c.group] ?? '').trim() : '';
    if (!g || /^["“”〃″']+$/.test(g)) g = prev; prev = g;
    const full = String(r[c.name]).trim(); let name = full, spec = c.spec >= 0 ? String(r[c.spec] ?? '').trim() : '';
    const m = full.match(/^(.*)_\((.*)\)$/); if (m) { name = m[1].trim(); if (!spec) spec = m[2].trim(); }
    const code = c.code >= 0 ? normCode(r[c.code]) : '';
    const kindV = c.kind >= 0 ? String(r[c.kind] ?? '').trim() : '';
    const x = { group: g, code, std: c.std >= 0 ? String(r[c.std] ?? '').trim() : '', name, spec, maker: c.maker >= 0 ? String(r[c.maker] ?? '').trim() : '', unit: c.unit >= 0 ? String(r[c.unit] ?? '').trim() : '', base: c.base >= 0 && String(r[c.base] ?? '').trim() !== '' ? num(r[c.base]) : null, price: c.price >= 0 && String(r[c.price] ?? '').trim() !== '' ? num(r[c.price]) : null, kind: KINDS.includes(kindV) ? kindV : '', rx: hasRx ? { count: num(r[c.cnt]), qty: num(r[c.qty]), insCount: num(r[c.insC]), insQty: num(r[c.insQ]), nonCount: num(r[c.nonC]), nonQty: num(r[c.nonQ]) } : null };
    x.match = (code && byCode.get(code)) || byName.get((name + '|' + spec).toLowerCase()) || null;
    items.push(x);
  }
  if (!items.length) return { error: '읽을 품목 줄이 없어요.' };
  return { items, hasRx, file };
}
document.getElementById('xlsx-in').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const wb = XLSX.read(new Uint8Array(rd.result), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      const res = parseRows(rows, f.name); if (res.error) return toast(res.error, 'bad');
      const mm = f.name.match(/(20\d{2})[_.\-\s년]*(\d{1,2})/); const month = mm ? `${mm[1]}-${pad(+mm[2])}` : thisMonth();
      openModal('importx', res, { month, kind: '의약품' }, { size: 'wide' });
    } catch (err) { console.warn(err); toast('엑셀 파일을 읽지 못했어요', 'bad'); }
  };
  rd.readAsArrayBuffer(f);
});
function saveXlsx(filename, sheets) {
  if (!window.XLSX) return toast('엑셀 도구를 불러오지 못했어요', 'bad');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) { const ws = XLSX.utils.aoa_to_sheet(s.rows); if (s.cols) ws['!cols'] = s.cols.map(w => ({ wch: w })); if (s.merges) ws['!merges'] = s.merges; XLSX.utils.book_append_sheet(wb, ws, s.name); }
  XLSX.writeFile(wb, filename);
}
const inRange = s => { const v = String(s || '').slice(0, 10); return v && v >= S.ui.exFrom && v <= S.ui.exTo; };
const fnameRange = () => `${S.ui.exFrom.replace(/-/g, '')}-${S.ui.exTo.replace(/-/g, '')}`;
function exportLedger() {
  const rows = [['출고일', '주문번호', '거래처명', '요양기관기호', '사업자등록번호', '보험코드', '표준코드', '제품명', '규격', '단위', '수량', '단가', '금액', '로트번호', '유효기간']];
  const Ls = [...S.shipments.values()].filter(s => inRange(s.date)).sort((a, b) => ko(a.date, b.date) || ko(a.order_no, b.order_no));
  for (const s of Ls) for (const x of s.lines || []) rows.push([s.date, s.order_no, s.cust_name, s.ykiho, bizFmt(s.biz_no), x.code, x.std, x.name, x.spec, x.unit, num(x.qty), num(x.price), num(x.qty) * num(x.price), x.lot, x.exp]);
  if (rows.length === 1) return toast('기간에 출고 기록이 없어요', 'bad');
  saveXlsx(`원윤메디팜_출고내역_${fnameRange()}.xlsx`, [{ name: '출고내역', rows, cols: [11, 14, 18, 12, 14, 11, 15, 30, 16, 6, 8, 9, 11, 12, 11] }]);
}
function exportAccounts() {
  const rows = [['거래처명', '종류', '요양기관기호', '사업자등록번호', '담당자', '연락처', '기간 출고액', '기간 입금액', '누적 출고', '누적 입금', '미수 잔액', '여신한도', '결제 조건']];
  for (const a of [...S.accounts.values()].sort((x, y) => ko(x.name, y.name))) { let s = 0, p = 0; for (const l of S.shipments.values()) if (l.account_id === a.id && inRange(l.date)) s += num(l.total); for (const y of S.payments.values()) if (y.account_id === a.id && inRange(y.date)) p += num(y.amount); const b = balanceOf(a.id); rows.push([a.name, a.type, a.ykiho, bizFmt(a.biz_no), a.manager, a.tel || a.mobile, s, p, b.ship, b.paid, b.bal, num(a.credit_limit), a.pay_terms]); }
  if (rows.length === 1) return toast('등록된 거래처가 없어요', 'bad');
  saveXlsx(`원윤메디팜_거래처매출미수_${fnameRange()}.xlsx`, [{ name: '거래처별', rows, cols: [20, 7, 12, 14, 10, 14, 12, 12, 12, 12, 12, 12, 20] }]);
}
function exportOrders() {
  const rows = [['주문번호', '접수일시', '거래처', '상태', '품목 수', '금액', '희망 배송일', '출고일', '요청사항', '품목']];
  for (const o of allOrders().filter(o => inRange(ymd(new Date(o.created_at)))).sort((a, b) => ko(a.created_at, b.created_at))) rows.push([o.no, fmtDT(o.created_at), o.cust_name, ST[o.status]?.[1] || o.status, (o.lines || []).length, num(o.total), o.want_date || '', o.ship_date || '', o.memo, (o.lines || []).map(l => `${l.name} ${l.qty}${l.unit || ''}`).join(', ')]);
  if (rows.length === 1) return toast('기간에 접수된 주문이 없어요', 'bad');
  saveXlsx(`원윤메디팜_주문목록_${fnameRange()}.xlsx`, [{ name: '주문', rows, cols: [14, 15, 18, 9, 7, 11, 11, 11, 24, 60] }]);
}
function exportInvoices() {
  const rows = [['작성일자', '구분', '거래처', '사업자등록번호', '공급가액', '세액', '합계', '영수/청구', '상태', '국세청 승인번호', '모드']];
  for (const t of [...S.invoices.values()].filter(t => inRange(t.write_date)).sort((a, b) => ko(a.write_date, b.write_date))) rows.push([t.write_date, t.kind, t.supplied?.organizationName, bizFmt(t.supplied?.identificationNumber), num(t.supply), num(t.vat), num(t.total), t.purpose === 'RECEIPT' ? '영수' : '청구', TI[t.status]?.[1] || t.status, t.nts_id || '', t.mode || '']);
  if (rows.length === 1) return toast('기간에 작성된 계산서가 없어요', 'bad');
  saveXlsx(`원윤메디팜_세금계산서_${fnameRange()}.xlsx`, [{ name: '세금계산서', rows, cols: [11, 7, 20, 14, 12, 10, 12, 8, 9, 26, 6] }]);
}
function exportProducts() {
  const rows = [['구분', '효능군·분류', '보험코드', '표준코드', '제품명', '규격', '제조사', '판매단위', '주문 배수', '기준가', '판매가', '재고 관리', '재고', '안전재고', '처방 통계 월', '총 처방량', '가까운 유효기간', '판매 중']];
  for (const p of products().sort((a, b) => ko(a.name, b.name))) { const lot = liveLots(p)[0]; const rx = S.rx.get(p.id); rows.push([p.kind || '의약품', p.grp, p.code, p.std, p.name, p.spec, p.maker, p.unit, num(p.step) || 1, num(p.base_price), num(p.price), p.track ? 'Y' : 'N', p.track ? num(p.stock) : '', num(p.safety) || '', rx?.month || '', rx ? num(rx.qty) : '', lot?.exp || '', p.active === false ? 'N' : 'Y']); }
  saveXlsx(`원윤메디팜_상품재고_${today().replace(/-/g, '')}.xlsx`, [{ name: '상품', rows, cols: [9, 18, 11, 15, 32, 16, 12, 7, 7, 8, 8, 7, 8, 8, 10, 9, 12, 6] }]);
}
function exportStatement(o) {
  if (!o) return; const acc = S.accounts.get(o.account_id) || S.myAccount || {}; const s = S.settings;
  const lines = (o.lines || []).filter(l => num(l.qty) > 0); const v = vatSplit(sumLines(lines));
  const rows = [
    ['거 래 명 세 서'], [],
    ['공급자', s.name || '원윤메디팜', '', '공급받는자', acc.name || o.cust_name],
    ['사업자등록번호', bizFmt(s.biz_no), '', '요양기관기호', acc.ykiho || ''],
    ['대표자', s.ceo || '', '', '사업자등록번호', bizFmt(acc.biz_no)],
    ['주소', s.addr || '', '', '주소', acc.addr || ''],
    ['전화', s.tel || '', '', '주문번호', o.no],
    ['입금 계좌', s.bank || '', '', '출고일', o.ship_date || ''], [],
    ['No', '품목', '규격', '보험코드', '수량', '단위', '단가', '금액', '로트번호', '유효기간']
  ];
  lines.forEach((l, i) => rows.push([i + 1, l.name, l.spec, l.code, num(l.qty), l.unit, num(l.price), num(l.qty) * num(l.price), l.lot || '', l.exp || '']));
  rows.push([], ['', '', '', '', '', '', '공급가액', v.supply], ['', '', '', '', '', '', '세액', v.vat], ['', '', '', '', '', '', '합계', v.sum]);
  saveXlsx(`거래명세서_${o.no}_${(acc.name || o.cust_name || '').replace(/[\\/:*?"<>|]/g, '')}.xlsx`, [{ name: '거래명세서', rows, cols: [12, 30, 16, 12, 16, 8, 10, 12, 12, 11], merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }] }]);
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const f = A[t.dataset.act]; if (!f) return;
  if (t.tagName === 'A') e.preventDefault();
  if (S.ui.armed && !['delPayment', 'custCancel', 'cancelReq'].includes(t.dataset.act)) S.ui.armed = '';
  if (M.armed && t.dataset.act !== 'arm') M.armed = '';
  f(t.dataset, t, e);
});
document.addEventListener('submit', e => { const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault(); if (S.busy) return; FORMS[f.dataset.form]?.(); });
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Escape' && M.kind && !M.busy) { closeModal(); S.ui.lastCreds = null; }
});
document.addEventListener('input', e => {
  const el = e.target; if (!el.dataset) return; const val = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.m != null) {
    setPath(M.draft, el.dataset.m, val);
    if (el.dataset.lotfor != null) { const o = S.orders.get(M.data?.id); const i = +el.dataset.lotfor; const p = o && S.products.get(o.lines[i]?.pid); const lt = p && (p.lots || []).find(l => l.lot === val); if (lt && lt.exp) { M.draft.lines[i].exp = lt.exp; renderModal(); } return; }
    if (el.dataset.live != null) renderModal();
    return;
  }
  if (el.dataset.bind != null) { setPath(S.ui, el.dataset.bind, val); if (el.dataset.bind === 'shopQ') drugSoon('shop'); if (el.dataset.norender == null) schedule(); return; }
  if (el.dataset.cartqty != null) { setQty(el.dataset.key, el.dataset.cartqty, val); schedule(); return; }
  if (el.dataset.cart != null) { const c = cartOf(el.dataset.key); c[el.dataset.cart] = val; saveCart(el.dataset.key); }
});

boot().catch(e => { console.error(e); S.phase = 'error'; S.err = errMsg(e); render(); });
})();
