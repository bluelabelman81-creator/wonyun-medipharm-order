// 식약처 공공데이터(공공데이터포털) 응답 → 사이트에서 쓰는 형태로 정리하는 함수 모음.
// 네트워크를 쓰지 않는 순수 함수라서 실제 응답 샘플로 바로 시험할 수 있다.

export const PRODUCT_EP = 'https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnDtlInq06'; // 제품 허가정보 상세
export const EASY_EP = 'https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList'; // e약은요
export const PILL_EP = 'https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03'; // 낱알식별

type Row = Record<string, unknown>;

export const str = (v: unknown): string => {
  if (v == null) return '';
  const s = String(v).trim();
  return s === 'None' || s === 'null' ? '' : s;
};
const pick = (r: Row, ...keys: string[]) => { for (const k of keys) { const v = str(r[k]); if (v) return v; } return ''; };

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', times: '×', le: '≤', ge: '≥', plusmn: '±', deg: '°', micro: 'µ' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const clean = (s: string) => decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li)>/gi, '\n').replace(/<\/t[dh]>/gi, ' ').replace(/<[^>]+>/g, ''))
  .replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// 허가 문서(EE 효능효과 / UD 용법용량 / NB 주의사항) XML → 읽기 쉬운 글
export function docText(xml: unknown, max = 4000): string {
  const s = str(xml);
  if (!s) return '';
  if (!/<DOC[\s>]/i.test(s)) return cut(clean(s), max);
  const out: string[] = [];
  const re = /<ARTICLE\b[^>]*?title="([^"]*)"[^>]*>|<PARAGRAPH\b[^>]*>([\s\S]*?)<\/PARAGRAPH>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1] != null) { const t = clean(m[1]); if (t) out.push(t); }
    else { const body = (m[2] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'); const t = clean(body); if (t) out.push(t); }
  }
  return cut(out.join('\n'), max);
}
export function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const at = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('. '));
  return (at > max * 0.6 ? head.slice(0, at + 1) : head).trim() + ' …';
}

// "[M040353]아세트아미노펜|[M0...]카페인" → "아세트아미노펜 · 카페인"
export const ingredients = (s: unknown) => str(s).split(/[|;]/).map(x => x.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean).join(' · ');

// MATERIAL_NAME: "총량 : 1정615.04밀리그램|성분명 : 아세트아미노펜|분량 : 500|단위 : 밀리그램|..." (성분이 여럿이면 ;로 이어짐)
export function strength(material: unknown): string {
  const parts = str(material).split(';').map(seg => {
    const kv: Record<string, string> = {};
    for (const p of seg.split('|')) { const i = p.indexOf(':'); if (i > 0) kv[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
    const name = kv['성분명'] || ''; const amt = kv['분량'] || ''; const unit = kv['단위'] || '';
    return name ? `${name}${amt ? ' ' + amt : ''}${unit ? unit : ''}` : '';
  }).filter(Boolean);
  return parts.slice(0, 6).join(' · ');
}

export const ediList = (s: unknown) => [...new Set(str(s).split(/[,\s]+/).map(x => x.replace(/\D/g, '')).filter(x => x.length >= 8).map(x => x.padStart(9, '0')))];

export const nedrugUrl = (seq: string) => `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${encodeURIComponent(seq)}`;

export interface DrugFull {
  seq: string; name: string; eng: string; company: string; kind: string; chart: string;
  ingr: string; ingr_eng: string; strength: string; edi: string[]; atc: string;
  pack: string; storage: string; valid: string; status: string;
  efficacy: string; usage: string; caution: string; image: string; link: string;
  easy: null | { efcy: string; use: string; warn: string; atpn: string; intrc: string; se: string; deposit: string };
  cls?: string; form?: string; // 낱알식별: 분류(효능군)·제형
}
export type DrugBrief = Pick<DrugFull, 'seq' | 'name' | 'company' | 'kind' | 'ingr' | 'strength' | 'edi' | 'image' | 'link'> & { summary: string; status: string };

export function mapProduct(r: Row): DrugFull {
  const seq = pick(r, 'ITEM_SEQ', 'itemSeq', 'item_seq');
  return {
    seq,
    name: pick(r, 'ITEM_NAME', 'itemName'),
    eng: pick(r, 'ITEM_ENG_NAME'),
    company: pick(r, 'ENTP_NAME', 'entpName'),
    kind: pick(r, 'ETC_OTC_CODE', 'etcOtcCode'),
    chart: cut(pick(r, 'CHART'), 300),
    ingr: ingredients(pick(r, 'MAIN_ITEM_INGR', 'mainItemIngr')),
    ingr_eng: pick(r, 'MAIN_INGR_ENG'),
    strength: strength(pick(r, 'MATERIAL_NAME')),
    edi: ediList(pick(r, 'EDI_CODE', 'ediCode')),
    atc: pick(r, 'ATC_CODE'),
    pack: cut(pick(r, 'PACK_UNIT'), 300),
    storage: pick(r, 'STORAGE_METHOD'),
    valid: pick(r, 'VALID_TERM'),
    status: pick(r, 'CANCEL_NAME') || '정상',
    efficacy: docText(r['EE_DOC_DATA'], 3000),
    usage: docText(r['UD_DOC_DATA'], 3000),
    caution: docText(r['NB_DOC_DATA'], 5000),
    image: '',
    link: seq ? nedrugUrl(seq) : '',
    easy: null,
  };
}

export function mapEasy(r: Row) {
  return {
    seq: pick(r, 'itemSeq', 'ITEM_SEQ'), name: pick(r, 'itemName', 'ITEM_NAME'), company: pick(r, 'entpName', 'ENTP_NAME'),
    image: pick(r, 'itemImage', 'ITEM_IMAGE'),
    easy: {
      efcy: clean(pick(r, 'efcyQesitm')), use: clean(pick(r, 'useMethodQesitm')), warn: clean(pick(r, 'atpnWarnQesitm')),
      atpn: clean(pick(r, 'atpnQesitm')), intrc: clean(pick(r, 'intrcQesitm')), se: clean(pick(r, 'seQesitm')), deposit: clean(pick(r, 'depositMethodQesitm')),
    },
  };
}

export const mapPill = (r: Row) => ({ seq: pick(r, 'ITEM_SEQ', 'itemSeq'), image: pick(r, 'ITEM_IMAGE', 'itemImage') });

// 제품명 끝 괄호 속 성분: "뉴론틴캡슐100밀리그램(가바펜틴)" → "가바펜틴"
export const parenIngr = (name: string) => { const m = str(name).match(/\(([^()]*)\)\s*$/); return m ? m[1].replace(/[,/]/g, ' · ').trim() : ''; };

// 낱알식별만 있는 품목(허가정보를 아직 못 받을 때 등) → 기본 정보로 채우기
export function fromPill(r: Row): DrugFull {
  const seq = pick(r, 'ITEM_SEQ', 'itemSeq'); const name = pick(r, 'ITEM_NAME', 'itemName');
  return {
    seq, name, eng: pick(r, 'ITEM_ENG_NAME'), company: pick(r, 'ENTP_NAME', 'entpName'), kind: pick(r, 'ETC_OTC_NAME', 'ETC_OTC_CODE'),
    chart: cut(pick(r, 'CHART'), 300), ingr: parenIngr(name), ingr_eng: '', strength: '', edi: ediList(pick(r, 'EDI_CODE', 'ediCode')), atc: '',
    pack: '', storage: '', valid: '', status: '정상', efficacy: '', usage: '', caution: '', image: pick(r, 'ITEM_IMAGE', 'itemImage'),
    link: seq ? nedrugUrl(seq) : '', easy: null, cls: pick(r, 'CLASS_NAME'), form: pick(r, 'FORM_CODE_NAME'),
  };
}

// 공공데이터포털 공통 응답에서 items 꺼내기. 오류면 사람이 읽을 이유를 던진다.
export function extractItems(text: string): { items: Row[]; total: number } {
  let j: any;
  try { j = JSON.parse(text); }
  catch {
    const code = (text.match(/<returnReasonCode>(\d+)<\/returnReasonCode>/) || [])[1] || '';
    const msg = (text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/) || text.match(/<errMsg>([^<]+)<\/errMsg>/) || [])[1] || text.slice(0, 120);
    throw new Error(reason(code, msg));
  }
  const header = j?.response?.header ?? j?.header ?? {};
  const code = str(header.resultCode);
  if (code && code !== '00' && code !== '0' && code !== '03') throw new Error(reason(code, str(header.resultMsg)));
  const body = j?.response?.body ?? j?.body ?? {};
  let items = body.items;
  if (items == null || items === '') return { items: [], total: 0 };
  if (!Array.isArray(items)) items = items.item ?? [];
  if (!Array.isArray(items)) items = [items];
  items = items.map((x: any) => (x && typeof x === 'object' && Object.keys(x).length === 1 && x.item) ? x.item : x);
  return { items, total: Number(body.totalCount ?? items.length) || items.length };
}
function reason(code: string, msg: string): string {
  const c = String(Number(code) || '');
  if (c === '30' || /SERVICE_KEY_IS_NOT_REGISTERED/.test(msg)) return '이 API는 아직 활용신청이 승인되지 않았어요';
  if (c === '22' || /LIMITED_NUMBER/.test(msg)) return '오늘 조회 한도를 넘었어요';
  if (c === '32' || /UNREGISTERED_IP/.test(msg)) return '등록되지 않은 IP예요';
  if (c === '20' || /SERVICE_ACCESS_DENIED/.test(msg)) return '접근이 거부됐어요 (활용신청 확인)';
  return msg || `오류 코드 ${code}`;
}

export const normName = (s: string) => str(s).replace(/\([^)]*\)/g, '').replace(/[\s·.,/_-]/g, '').toLowerCase();

// 허가정보 + e약은요 + 낱알식별을 품목기준코드로 합치기
export function merge(prod: Row[], easy: Row[], pills: Row[]): DrugFull[] {
  const byEasy = new Map(easy.map(mapEasy).filter(e => e.seq).map(e => [e.seq, e]));
  const byPill = new Map(pills.map(mapPill).filter(p => p.seq && p.image).map(p => [p.seq, p.image]));
  const pillRow = new Map(pills.map(r => [pick(r, 'ITEM_SEQ', 'itemSeq'), r]).filter(([k]) => k) as [string, Row][]);
  const out: DrugFull[] = [];
  const seen = new Set<string>();
  for (const r of prod) {
    const d = mapProduct(r);
    if (!d.seq || seen.has(d.seq)) continue;
    if (d.status && d.status !== '정상') continue; // 취하·취소된 품목은 빼기
    seen.add(d.seq);
    const e = byEasy.get(d.seq);
    if (e) { d.easy = e.easy; d.image = e.image || ''; }
    if (!d.image) d.image = byPill.get(d.seq) || '';
    const pr = pillRow.get(d.seq); if (pr) { d.cls = pick(pr, 'CLASS_NAME'); d.form = pick(pr, 'FORM_CODE_NAME'); }
    out.push(d);
  }
  // 허가정보에는 없고 e약은요에만 있는 품목도 보여 주기
  for (const e of byEasy.values()) {
    if (seen.has(e.seq)) continue;
    seen.add(e.seq);
    const pr = pillRow.get(e.seq); const base = pr ? fromPill(pr) : null;
    out.push({ seq: e.seq, name: e.name, eng: base?.eng || '', company: e.company, kind: base?.kind || '일반의약품', chart: base?.chart || '', ingr: base?.ingr || parenIngr(e.name), ingr_eng: '', strength: '', edi: base?.edi || [], atc: '', pack: '', storage: e.easy.deposit, valid: '', status: '정상', efficacy: '', usage: '', caution: '', image: e.image || byPill.get(e.seq) || '', link: nedrugUrl(e.seq), easy: e.easy, cls: base?.cls || '', form: base?.form || '' });
  }
  // 낱알식별에만 있는 품목 (전문의약품 등)
  for (const [seq, r] of pillRow) {
    if (seen.has(seq)) continue;
    seen.add(seq); out.push(fromPill(r));
  }
  return out;
}

export function brief(d: DrugFull): DrugBrief {
  const src = d.easy?.efcy || d.efficacy || (d.cls ? `분류: ${d.cls}${d.chart ? ' · ' + d.chart : ''}` : '');
  return { seq: d.seq, name: d.name, company: d.company, kind: d.kind, ingr: d.ingr, strength: d.strength, edi: d.edi, image: d.image, link: d.link, status: d.status, summary: cut(src.replace(/\n+/g, ' '), 160) };
}
