-- 사이트 푸시 알림 (Web Push)
create extension if not exists pg_net;

-- 알림을 받을 기기 (브라우저 구독). 기기는 마지막으로 알림을 켠 사람의 것
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device text not null default '',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fails int not null default 0
);
create index if not exists push_subs_user on public.push_subs(user_id);
alter table public.push_subs enable row level security;
create policy push_subs_own_select on public.push_subs for select to authenticated using (user_id = (select auth.uid()));
create policy push_subs_own_delete on public.push_subs for delete to authenticated using (user_id = (select auth.uid()));

-- 사람마다 끈 알림 항목 (기본은 모두 켜짐)
create table if not exists public.notify_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  off text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.notify_prefs enable row level security;
create policy notify_prefs_own on public.notify_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 보낸 알림 기록 (발송 대기열 겸용)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  audience text not null check (audience in ('admin', 'account', 'user')),
  account_id uuid references public.accounts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  url text not null default '',
  tag text not null default '',
  ref text,
  created_at timestamptz not null default now(),
  sent int,
  failed int,
  sent_at timestamptz,
  error text
);
create index if not exists notifications_created on public.notifications(created_at desc);
create index if not exists notifications_account on public.notifications(account_id, created_at desc);
alter table public.notifications enable row level security;
create policy notifications_read on public.notifications for select to authenticated using (
  public.is_admin()
  or (audience = 'account' and account_id = public.my_account())
  or (audience = 'user' and user_id = (select auth.uid()))
);

-- 기기 등록: 같은 기기를 다른 사람이 켜면 그 사람 것으로 넘어감
create or replace function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text, p_device text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then raise exception '로그인이 필요해요'; end if;
  if not exists (select 1 from public.profiles where user_id = v_uid and active) then raise exception '사용할 수 없는 계정이에요'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 then raise exception '알림 주소가 올바르지 않아요'; end if;
  if length(coalesce(p_p256dh, '')) < 40 or length(coalesce(p_auth, '')) < 10 then raise exception '알림 키가 올바르지 않아요'; end if;
  insert into public.push_subs (user_id, endpoint, p256dh, auth, device)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(coalesce(p_device, ''), 120))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    device = excluded.device, fails = 0, created_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.save_push_sub(text, text, text, text) from public, anon;
grant execute on function public.save_push_sub(text, text, text, text) to authenticated;

-- 알림 한 건을 기록하고 발송 함수 호출 (실패해도 주문 처리는 그대로 진행)
create or replace function public._notify(p_event text, p_audience text, p_account uuid, p_title text, p_body text, p_url text, p_tag text, p_ref text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_secret text;
begin
  insert into public.notifications (event, audience, account_id, title, body, url, tag, ref)
  values (p_event, p_audience, p_account, left(p_title, 120), left(coalesce(p_body, ''), 300), coalesce(p_url, ''), coalesce(p_tag, ''), p_ref)
  returning id into v_id;
  select value into v_secret from public.app_secrets where name = 'PUSH_HOOK_SECRET';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://zdgvsjncdotdjtitbitq.supabase.co/functions/v1/push',
    body := jsonb_build_object('action', 'deliver', 'id', v_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 15000);
exception when others then
  raise warning '알림 기록 실패: %', sqlerrm;
end $$;
revoke execute on function public._notify(text, text, uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function public._won(n numeric) returns text language sql immutable set search_path = '' as $$
  select to_char(coalesce(n, 0), 'FM999,999,999,990') || '원'
$$;

-- 주문: 새 주문(관리자), 확인·출고·배송 완료·취소(거래처), 거래처 취소(관리자)
create or replace function public._orders_notify() returns trigger language plpgsql security definer set search_path = '' as $$
declare n int := coalesce(jsonb_array_length(new.lines), 0); v_items text;
begin
  v_items := coalesce(new.lines -> 0 ->> 'name', '주문') || case when n > 1 then ' 외 ' || (n - 1) || '품목' else '' end;
  if tg_op = 'INSERT' then
    perform public._notify('order_new', 'admin', new.account_id, '새 주문 · ' || new.cust_name,
      v_items || ' · ' || public._won(new.total) || case when new.want_date is not null then ' · 희망 ' || to_char(new.want_date, 'MM/DD') else '' end,
      '#orders', 'order-' || new.id, new.id::text);
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  if new.status = '확인' and old.status = '접수' then
    perform public._notify('order_confirmed', 'account', new.account_id, '주문을 확인했어요', v_items || ' · 주문번호 ' || new.no, '#history', 'order-' || new.id, new.id::text);
  elsif new.status = '출고' then
    perform public._notify('order_shipped', 'account', new.account_id, '주문이 출고됐어요', v_items || ' · 주문번호 ' || new.no, '#history', 'order-' || new.id, new.id::text);
  elsif new.status = '완료' then
    perform public._notify('order_delivered', 'account', new.account_id, '배송이 완료됐어요', v_items || ' · 주문번호 ' || new.no, '#history', 'order-' || new.id, new.id::text);
  elsif new.status = '취소' then
    if new.cancelled_by = '거래처' then
      perform public._notify('order_cust_cancel', 'admin', new.account_id, '주문 취소 · ' || new.cust_name, v_items || ' · ' || new.no, '#orders', 'order-' || new.id, new.id::text);
    else
      perform public._notify('order_canceled', 'account', new.account_id, '주문이 취소됐어요',
        v_items || ' · 주문번호 ' || new.no || case when coalesce(new.admin_memo, '') <> '' then ' · ' || new.admin_memo else '' end, '#history', 'order-' || new.id, new.id::text);
    end if;
  end if;
  return new;
end $$;
create trigger orders_notify after insert or update of status on public.orders for each row execute function public._orders_notify();

-- 재고·보유 요청: 새 요청(관리자), 입고 완료·보유 불가(거래처)
create or replace function public._reqs_notify() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public._notify('req_new', 'admin', new.account_id,
      case when new.kind = '신규' then '보유 요청 · ' else '재고 요청 · ' end || new.cust_name,
      new.name || case when coalesce(new.qty, '') <> '' then ' · ' || new.qty else '' end, '#reqs', 'req-' || new.id, new.id::text);
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  if new.status = '입고완료' then
    perform public._notify('req_done', 'account', new.account_id, '요청하신 품목이 입고됐어요', new.name || ' · 지금 주문할 수 있어요', '#reqs', 'req-' || new.id, new.id::text);
  elsif new.status = '불가' then
    perform public._notify('req_done', 'account', new.account_id, '요청 결과를 알려 드려요',
      new.name || ' · 보유가 어려워요' || case when coalesce(new.admin_memo, '') <> '' then ' · ' || new.admin_memo else '' end, '#reqs', 'req-' || new.id, new.id::text);
  end if;
  return new;
end $$;
create trigger reqs_notify after insert or update of status on public.stock_requests for each row execute function public._reqs_notify();

-- 세금계산서 발행 완료(거래처, 실제 발행만)
create or replace function public._invoices_notify() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = '발행완료' and old.status is distinct from '발행완료' and coalesce(new.mode, '') <> 'test' then
    perform public._notify('invoice_issued', 'account', new.account_id, '세금계산서가 발행됐어요',
      coalesce(new.period, '') || ' 공급분 · 작성일 ' || to_char(new.write_date, 'YYYY.MM.DD'), '#invoices', 'inv-' || new.id, new.id::text);
  end if;
  return new;
end $$;
create trigger invoices_notify after update of status on public.tax_invoices for each row execute function public._invoices_notify();

-- 재고: 품절·안전재고 미만으로 떨어질 때(관리자)
create or replace function public._stock_notify() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not new.track or not new.active then return new; end if;
  if coalesce(old.stock, 0) > 0 and coalesce(new.stock, 0) <= 0 then
    perform public._notify('stock_low', 'admin', null, '품절 · ' || new.name, '재고가 0이 됐어요. 거래처 주문이 막혀요.', '#stock', 'stock-' || new.id, new.id);
  elsif coalesce(new.safety, 0) > 0 and coalesce(old.stock, 0) >= new.safety and coalesce(new.stock, 0) < new.safety and coalesce(new.stock, 0) > 0 then
    perform public._notify('stock_low', 'admin', null, '재고 부족 · ' || new.name,
      '남은 재고 ' || to_char(new.stock, 'FM999,999,990') || coalesce(new.unit, '') || ' (안전재고 ' || to_char(new.safety, 'FM999,999,990') || ')', '#stock', 'stock-' || new.id, new.id);
  end if;
  return new;
end $$;
create trigger products_stock_notify after update of stock on public.products for each row execute function public._stock_notify();

revoke execute on function public._orders_notify() from public, anon, authenticated;
revoke execute on function public._reqs_notify() from public, anon, authenticated;
revoke execute on function public._invoices_notify() from public, anon, authenticated;
revoke execute on function public._stock_notify() from public, anon, authenticated;
revoke execute on function public._won(numeric) from public, anon;

-- 발송 함수가 호출을 확인할 비밀값 (DB 안에서 만들어 바깥에 나가지 않음)
insert into public.app_secrets (name, value) values ('PUSH_HOOK_SECRET', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;
