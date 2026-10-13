# 데이터베이스 변경 기록
Supabase에 적용된 변경은 Supabase 대시보드 → Database → Migrations에서 볼 수 있어요.
- `stock_requests` — 재고(보유) 요청 테이블, 요청·취소·처리 함수, 입고 시 자동 입고완료
- `orderable_rules` — 품절(재고 0 또는 일시 품절) 품목 주문 차단, 입고 시 일시 품절 해제
