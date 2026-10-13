# 원윤메디팜 주문 사이트

거래처(약국·병의원)가 아이디로 로그인해 의약품·의료소모품을 직접 주문하고, 원윤메디팜이 주문 확인 → 출고 → 정산 → 전자세금계산서 발행까지 처리하는 사이트입니다.

## 구성
- `index.html`, `app.js`, `assets/` — 화면 (GitHub Pages로 공개)
- 데이터·로그인 — Supabase 프로젝트 `wonyun-medipharm` (서울 리전)
- `supabase/functions/admin-users` — 거래처·관리자 아이디 발급, 비밀번호 재설정, 잠금
- `supabase/functions/tax-invoice` — 볼타 API로 전자세금계산서 발행·상태 확인·PDF

## 보안
- 이 저장소에는 공개용 키(publishable key)만 들어 있습니다. 데이터 접근은 Supabase 권한 규칙(RLS)으로 막혀 있어, 거래처는 자기 거래처의 주문·단가·세금계산서만 볼 수 있습니다.
- 주문 단가는 서버에서 다시 계산하므로 화면에서 바꿀 수 없습니다.
- 볼타 API 키는 Supabase Edge Function 비밀값 `BOLTA_API_KEY`에만 저장합니다. 이 저장소에 넣지 마세요.

## 세금계산서 연동 순서
1. bolta.io 가입 → 개발자센터에서 테스트 키(`test_…`) 발급
2. Supabase 대시보드 → Edge Functions → Secrets에 `BOLTA_API_KEY` 등록
3. 사이트 관리자 → 설정 → 회사 정보 저장 → 발급자 등록 → 공동인증서 등록
4. 테스트로 발행해 보고, 준비되면 라이브 키(`live_…`)로 바꾸기
