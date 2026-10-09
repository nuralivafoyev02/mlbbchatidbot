-- Shaxsiy kabinet → Balans (hamyon).
--
--  wallets              — har bir foydalanuvchining joriy balansi (so'm, butun son).
--                         balance >= 0 CHECK — manfiyga tushib bo'lmaydi.
--  wallet_transactions  — balansdagi HAR BIR o'zgarish bitta qator (ledger):
--                           topup    — karta orqali to'ldirildi (+)
--                           purchase — do'kondan xarid (−)
--                           refund   — xarid qaytarildi (+)
--                           admin    — admin qo'lda o'zgartirdi (±)
--                         balance_after — shu harakatdan keyingi qoldiq.
--  wallet_topups        — to'ldirish so'rovi: foydalanuvchi summani tanlaydi,
--                         server unga NOYOB `pay_amount` beradi (10 000 → 10 347),
--                         ELDER PAY'da shu summaga buyurtma ochiladi
--                         (`provider_order`), to'langani `check` bilan
--                         aniqlanib, balansga yoziladi.
--
-- Pul bilan ishlaydigan har bir amal — bitta Postgres funksiyasi (bitta
-- tranzaksiya): yechish + mahsulotni berish + buyurtma + ledger yo birga
-- bajariladi, yo umuman bajarilmaydi. Shuning uchun "pul yechildi-yu mahsulot
-- berilmadi" holati bo'lmaydi. Keyin aniqlangan xatoliklar uchun
-- wallet_refund_order — pulni qaytaradi (ikki marta qaytarib bo'lmaydi).
--
-- Jadvallarga faqat server (service_role) yozadi.

begin;

-- ---------------------------------------------------------------------------
-- Jadvallar
-- ---------------------------------------------------------------------------
create table if not exists public.wallets (
  user_id bigint primary key,
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_topups (
  id bigserial primary key,
  user_id bigint not null,
  amount bigint not null check (amount > 0),
  pay_amount bigint not null check (pay_amount >= amount),
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled')),
  provider text,
  provider_order text,
  pay_url text,
  provider_txn_id text,
  paid_amount bigint,
  paid_at timestamptz,
  expires_at timestamptz not null,
  confirmed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migratsiya qayta ishga tushirilsa ham ustunlar bo'lsin.
alter table public.wallet_topups add column if not exists provider_order text;
alter table public.wallet_topups add column if not exists pay_url text;

create unique index if not exists wallet_topups_provider_order_uniq
  on public.wallet_topups (provider_order)
  where provider_order is not null;

-- Bitta bank tranzaksiyasi faqat bitta to'ldirishga yoziladi.
create unique index if not exists wallet_topups_provider_txn_uniq
  on public.wallet_topups (provider, provider_txn_id)
  where provider_txn_id is not null;

-- Bir vaqtda kutilayotgan ikki so'rov bir xil summaga ega bo'lmaydi.
create unique index if not exists wallet_topups_pending_amount_uniq
  on public.wallet_topups (pay_amount)
  where status = 'pending';

create index if not exists wallet_topups_user_idx
  on public.wallet_topups (user_id, created_at desc);

create table if not exists public.wallet_transactions (
  id bigserial primary key,
  user_id bigint not null,
  delta bigint not null check (delta <> 0),
  balance_after bigint not null check (balance_after >= 0),
  kind text not null check (kind in ('topup', 'purchase', 'refund', 'admin')),
  order_id bigint,
  topup_id bigint,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_user_idx
  on public.wallet_transactions (user_id, created_at desc);

-- Idempotentlik: bitta to'ldirish bir marta, bitta buyurtma bir marta qaytariladi.
create unique index if not exists wallet_transactions_topup_uniq
  on public.wallet_transactions (topup_id)
  where kind = 'topup';

create unique index if not exists wallet_transactions_refund_uniq
  on public.wallet_transactions (order_id)
  where kind = 'refund';

-- shop_orders: balansdan to'langan xaridlar uchun ustunlar.
alter table public.shop_orders add column if not exists paid_amount bigint;
alter table public.shop_orders add column if not exists delivery jsonb;
alter table public.shop_orders add column if not exists refunded_at timestamptz;
alter table public.shop_orders add column if not exists note text;

alter table public.shop_orders drop constraint if exists shop_orders_status_check;
alter table public.shop_orders
  add constraint shop_orders_status_check
  check (status in ('pending', 'done', 'cancelled', 'refunded'));

alter table public.wallets enable row level security;
alter table public.wallet_topups enable row level security;
alter table public.wallet_transactions enable row level security;

revoke all on public.wallets from anon, authenticated;
revoke all on public.wallet_topups from anon, authenticated;
revoke all on public.wallet_transactions from anon, authenticated;

-- Funksiyalar SECURITY INVOKER — service_role yozish huquqiga ega bo'lishi
-- kerak. Server kodi balansni faqat quyidagi funksiyalar orqali o'zgartiradi.
grant select, insert, update on public.wallets to service_role;
grant select, insert, update on public.wallet_topups to service_role;
grant select, insert on public.wallet_transactions to service_role;
grant usage, select on sequence public.wallet_topups_id_seq to service_role;
grant usage, select on sequence public.wallet_transactions_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Ichki yordamchi: balansni o'zgartirish + ledger. Chaqiruvchi tranzaksiyasida.
-- Yetarli mablag' bo'lmasa NULL qaytaradi (hech narsa o'zgarmaydi).
-- ---------------------------------------------------------------------------
create or replace function public._wallet_apply(
  p_user_id bigint,
  p_delta bigint,
  p_kind text,
  p_order_id bigint default null,
  p_topup_id bigint default null,
  p_note text default null
)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_balance bigint;
begin
  insert into public.wallets (user_id) values (p_user_id) on conflict (user_id) do nothing;

  update public.wallets
  set balance = balance + p_delta,
      updated_at = now()
  where user_id = p_user_id
    and balance + p_delta >= 0
  returning balance into v_balance;

  if v_balance is null then
    return null;
  end if;

  insert into public.wallet_transactions (user_id, delta, balance_after, kind, order_id, topup_id, note)
  values (p_user_id, p_delta, v_balance, p_kind, p_order_id, p_topup_id, left(p_note, 300));

  return v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- Balans
-- ---------------------------------------------------------------------------
create or replace function public.wallet_get(p_user_id bigint)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('ok', true, 'balance', coalesce((select balance from public.wallets where user_id = p_user_id), 0));
$$;

-- Admin qo'lda balans qo'shadi/ayiradi (izoh majburiy emas).
create or replace function public.wallet_admin_adjust(
  p_user_id bigint,
  p_delta bigint,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  v_balance := public._wallet_apply(p_user_id, p_delta, 'admin', null, null, p_note);

  if v_balance is null then
    return jsonb_build_object('ok', false, 'error', 'insufficient_funds',
      'balance', coalesce((select balance from public.wallets where user_id = p_user_id), 0));
  end if;

  return jsonb_build_object('ok', true, 'balance', v_balance);
end;
$$;

-- ---------------------------------------------------------------------------
-- To'ldirish (top-up)
-- ---------------------------------------------------------------------------

-- Yangi so'rov: foydalanuvchining eski kutilayotgan so'rovi bekor qilinadi,
-- unga noyob pay_amount = amount + (1..999) beriladi. Muddati o'tgan yoki
-- bekor qilingan so'rov summasi `p_grace_minutes` davomida qayta berilmaydi —
-- kechikib kelgan to'lov boshqa foydalanuvchiga yozilib ketmasligi uchun.
create or replace function public.wallet_create_topup(
  p_user_id bigint,
  p_amount bigint,
  p_ttl_minutes integer default 30,
  p_grace_minutes integer default 60
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_offset integer;
  v_pay bigint;
  v_row public.wallet_topups;
  v_try integer := 0;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  -- Muddati o'tganlarni yopamiz.
  update public.wallet_topups
  set status = 'expired', updated_at = now()
  where status = 'pending' and expires_at < now();

  update public.wallet_topups
  set status = 'cancelled', updated_at = now()
  where user_id = p_user_id and status = 'pending';

  loop
    v_try := v_try + 1;
    if v_try > 60 then
      return jsonb_build_object('ok', false, 'error', 'busy');
    end if;

    v_offset := 1 + floor(random() * 999)::integer;
    v_pay := p_amount + v_offset;

    continue when exists (
      select 1 from public.wallet_topups t
      where t.pay_amount = v_pay
        and (
          t.status = 'pending'
          or (t.status in ('expired', 'cancelled') and t.expires_at > now() - make_interval(mins => p_grace_minutes))
        )
    );

    begin
      insert into public.wallet_topups (user_id, amount, pay_amount, expires_at)
      values (p_user_id, p_amount, v_pay, now() + make_interval(mins => p_ttl_minutes))
      returning * into v_row;
      exit;
    exception when unique_violation then
      -- Parallel so'rov xuddi shu summani oldi — boshqasini tanlaymiz.
      null;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'topup', to_jsonb(v_row));
end;
$$;

create or replace function public.wallet_cancel_topup(p_user_id bigint, p_topup_id bigint)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  update public.wallet_topups
  set status = 'cancelled', updated_at = now()
  where id = p_topup_id and user_id = p_user_id and status = 'pending';

  return jsonb_build_object('ok', found);
end;
$$;

-- Kelgan to'lovni so'rovga bog'lab balansga yozadi. Idempotent:
--   * shu bank tranzaksiyasi allaqachon yozilgan bo'lsa — 'duplicate' (ok=true);
--   * so'rov allaqachon to'langan bo'lsa — 'already_paid'.
-- p_topup_id berilmasa — summa va vaqt bo'yicha qidiriladi: tushum vaqti
-- so'rov oynasida [created_at, expires_at + grace] bo'lishi shart.
create or replace function public.wallet_credit_topup(
  p_provider text,
  p_txn_id text,
  p_amount bigint,
  p_paid_at timestamptz default now(),
  p_topup_id bigint default null,
  p_confirmed_by text default null,
  p_grace_minutes integer default 60
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_topup public.wallet_topups;
  v_balance bigint;
  v_txn text := nullif(trim(coalesce(p_txn_id, '')), '');
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if v_txn is not null and exists (
    select 1 from public.wallet_topups where provider = p_provider and provider_txn_id = v_txn
  ) then
    return jsonb_build_object('ok', true, 'status', 'duplicate');
  end if;

  if p_topup_id is not null then
    select * into v_topup from public.wallet_topups where id = p_topup_id for update;
  else
    select * into v_topup
    from public.wallet_topups
    where pay_amount = p_amount
      and status <> 'paid'
      and coalesce(p_paid_at, now()) >= created_at - interval '2 minutes'
      and coalesce(p_paid_at, now()) <= expires_at + make_interval(mins => p_grace_minutes)
    order by created_at desc
    limit 1
    for update;
  end if;

  if v_topup.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_matched');
  end if;

  if v_topup.status = 'paid' then
    return jsonb_build_object('ok', true, 'status', 'already_paid', 'topup_id', v_topup.id, 'user_id', v_topup.user_id);
  end if;

  update public.wallet_topups
  set status = 'paid',
      provider = p_provider,
      provider_txn_id = v_txn,
      paid_amount = p_amount,
      paid_at = coalesce(p_paid_at, now()),
      confirmed_by = left(p_confirmed_by, 64),
      updated_at = now()
  where id = v_topup.id;

  v_balance := public._wallet_apply(v_topup.user_id, p_amount, 'topup', null, v_topup.id, p_provider);

  return jsonb_build_object(
    'ok', true,
    'status', 'credited',
    'topup_id', v_topup.id,
    'user_id', v_topup.user_id,
    'amount', p_amount,
    'balance', v_balance
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Xaridlar (atomik)
-- ---------------------------------------------------------------------------

-- Limit paketi: shop_lp:<id> dan narx o'qiladi, balansdan yechiladi, limit
-- qo'shiladi, buyurtma "done" bo'ladi va limitlar tarixiga yoziladi.
create or replace function public.wallet_buy_limit(p_user_id bigint, p_package_id text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_pkg jsonb;
  v_kind text;
  v_amount integer;
  v_price bigint;
  v_balance bigint;
  v_order_id bigint;
  v_remaining integer;
begin
  select value into v_pkg from public.bot_settings where key = 'shop_lp:' || p_package_id;

  v_kind := v_pkg ->> 'kind';
  if v_pkg is null or v_kind not in ('full_info', 'reset_pw')
     or coalesce(v_pkg ->> 'amount', '') !~ '^\d{1,6}$'
     or coalesce(v_pkg ->> 'price', '') !~ '^\d{1,12}$' then
    return jsonb_build_object('ok', false, 'error', 'not_available');
  end if;

  v_amount := (v_pkg ->> 'amount')::integer;
  v_price := (v_pkg ->> 'price')::bigint;
  if v_amount <= 0 or v_price <= 0 then
    return jsonb_build_object('ok', false, 'error', 'not_available');
  end if;

  insert into public.shop_orders (user_id, kind, item_id, title, price, paid_amount, status)
  values (p_user_id, 'limit', p_package_id, v_kind || ':' || v_amount, v_price, v_price, 'done')
  returning id into v_order_id;

  v_balance := public._wallet_apply(p_user_id, -v_price, 'purchase', v_order_id, null, v_kind || ':' || v_amount);

  if v_balance is null then
    -- Butun tranzaksiya bekor (buyurtma ham yozilmaydi).
    raise exception using errcode = 'P0001', message = 'insufficient_funds';
  end if;

  insert into public.bot_users (user_id) values (p_user_id) on conflict (user_id) do nothing;

  if v_kind = 'full_info' then
    update public.bot_users
    set full_info_quota = least(coalesce(full_info_quota, 0)::bigint + v_amount, 2147483647)::integer,
        updated_at = now()
    where user_id = p_user_id
    returning full_info_quota into v_remaining;
  else
    update public.bot_users
    set reset_pw_quota = least(coalesce(reset_pw_quota, 0)::bigint + v_amount, 2147483647)::integer,
        updated_at = now()
    where user_id = p_user_id
    returning reset_pw_quota into v_remaining;
  end if;

  insert into public.quota_usage_events (user_id, kind, delta, source, remaining)
  values (p_user_id, v_kind, v_amount, 'purchase', v_remaining);

  update public.shop_orders
  set delivery = jsonb_build_object('kind', v_kind, 'amount', v_amount, 'remaining', v_remaining)
  where id = v_order_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'balance', v_balance,
    'kind', v_kind,
    'amount', v_amount,
    'price', v_price,
    'remaining', v_remaining
  );
exception
  when raise_exception then
    if sqlerrm = 'insufficient_funds' then
      return jsonb_build_object('ok', false, 'error', 'insufficient_funds', 'price', v_price,
        'balance', coalesce((select balance from public.wallets where user_id = p_user_id), 0));
    end if;
    raise;
end;
$$;

-- Firstmail: qator FOR UPDATE bilan qulflanadi — ikki xaridor bitta pochtani
-- ololmaydi. Narx faqat raqam bo'lsa ("15000", "15 000") balansdan sotiladi,
-- aks holda 'price_not_set' (eski so'rov yo'li).
create or replace function public.wallet_buy_firstmail(p_user_id bigint, p_item_id text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_key text := 'shop_fm:' || p_item_id;
  v_item jsonb;
  v_price_text text;
  v_price bigint;
  v_balance bigint;
  v_order_id bigint;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_email text;
  v_masked text;
begin
  select value into v_item from public.bot_settings where key = v_key for update;

  if v_item is null or coalesce(v_item ->> 'status', 'available') <> 'available' then
    return jsonb_build_object('ok', false, 'error', 'not_available');
  end if;

  v_price_text := regexp_replace(coalesce(v_item ->> 'price', ''), '\s', '', 'g');
  if v_price_text !~ '^\d{1,12}$' or v_price_text::bigint <= 0 then
    return jsonb_build_object('ok', false, 'error', 'price_not_set');
  end if;
  v_price := v_price_text::bigint;

  v_email := coalesce(v_item ->> 'email', '');
  v_masked := case
    when position('@' in v_email) > 1 then
      left(split_part(v_email, '@', 1), case when length(split_part(v_email, '@', 1)) <= 3 then 1 else 3 end)
      || '•••@' || split_part(v_email, '@', 2)
    else left(v_email, 2) || '•••'
  end;

  insert into public.shop_orders (user_id, kind, item_id, title, price, paid_amount, status, delivery)
  values (
    p_user_id, 'firstmail', p_item_id, v_masked, v_price, v_price, 'done',
    jsonb_build_object('email', v_email, 'password', coalesce(v_item ->> 'password', ''))
  )
  returning id into v_order_id;

  v_balance := public._wallet_apply(p_user_id, -v_price, 'purchase', v_order_id, null, 'firstmail ' || v_masked);

  if v_balance is null then
    raise exception using errcode = 'P0001', message = 'insufficient_funds';
  end if;

  update public.bot_settings
  set value = v_item || jsonb_build_object(
        'status', 'sold', 'sold_at', v_now, 'updated_at', v_now,
        'buyer_id', p_user_id::text, 'order_id', v_order_id
      ),
      updated_at = now()
  where key = v_key;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'balance', v_balance,
    'price', v_price,
    'email', v_email,
    'password', coalesce(v_item ->> 'password', '')
  );
exception
  when raise_exception then
    if sqlerrm = 'insufficient_funds' then
      return jsonb_build_object('ok', false, 'error', 'insufficient_funds', 'price', v_price,
        'balance', coalesce((select balance from public.wallets where user_id = p_user_id), 0));
    end if;
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- Qaytarish (refund)
-- ---------------------------------------------------------------------------

-- Balansdan to'langan buyurtma pulini qaytaradi. Idempotent (ikkinchi
-- chaqiruv 'already_refunded'). p_reverse_goods = true bo'lsa mahsulot ham
-- qaytariladi: pochta yana sotuvga chiqadi / berilgan limit olib qo'yiladi.
create or replace function public.wallet_refund_order(
  p_order_id bigint,
  p_reason text default null,
  p_reverse_goods boolean default false
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_order public.shop_orders;
  v_balance bigint;
  v_kind text;
  v_amount integer;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into v_order from public.shop_orders where id = p_order_id for update;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_order.status = 'refunded' then
    return jsonb_build_object('ok', true, 'status', 'already_refunded', 'user_id', v_order.user_id);
  end if;

  if coalesce(v_order.paid_amount, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'not_paid');
  end if;

  v_balance := public._wallet_apply(
    v_order.user_id, v_order.paid_amount, 'refund', v_order.id, null,
    coalesce(nullif(trim(p_reason), ''), 'refund')
  );

  update public.shop_orders
  set status = 'refunded', refunded_at = now(), note = left(p_reason, 300), updated_at = now()
  where id = v_order.id;

  if p_reverse_goods then
    if v_order.kind = 'firstmail' and v_order.item_id is not null then
      update public.bot_settings
      set value = (value - 'buyer_id' - 'order_id') || jsonb_build_object('status', 'available', 'sold_at', null, 'updated_at', v_now),
          updated_at = now()
      where key = 'shop_fm:' || v_order.item_id
        and value ->> 'order_id' = v_order.id::text;
    elsif v_order.kind = 'limit' then
      v_kind := v_order.delivery ->> 'kind';
      v_amount := coalesce((v_order.delivery ->> 'amount')::integer, 0);
      if v_amount > 0 and v_kind = 'full_info' then
        update public.bot_users set full_info_quota = greatest(full_info_quota - v_amount, 0), updated_at = now()
        where user_id = v_order.user_id;
      elsif v_amount > 0 and v_kind = 'reset_pw' then
        update public.bot_users set reset_pw_quota = greatest(reset_pw_quota - v_amount, 0), updated_at = now()
        where user_id = v_order.user_id;
      end if;
      if v_amount > 0 and v_kind in ('full_info', 'reset_pw') then
        insert into public.quota_usage_events (user_id, kind, delta, source)
        values (v_order.user_id, v_kind, -v_amount, 'admin');
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'refunded',
    'user_id', v_order.user_id,
    'amount', v_order.paid_amount,
    'balance', v_balance
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Ruxsatlar
-- ---------------------------------------------------------------------------
revoke all on function public._wallet_apply(bigint, bigint, text, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.wallet_get(bigint) from public, anon, authenticated;
revoke all on function public.wallet_admin_adjust(bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.wallet_create_topup(bigint, bigint, integer, integer) from public, anon, authenticated;
revoke all on function public.wallet_cancel_topup(bigint, bigint) from public, anon, authenticated;
revoke all on function public.wallet_credit_topup(text, text, bigint, timestamptz, bigint, text, integer) from public, anon, authenticated;
revoke all on function public.wallet_buy_limit(bigint, text) from public, anon, authenticated;
revoke all on function public.wallet_buy_firstmail(bigint, text) from public, anon, authenticated;
revoke all on function public.wallet_refund_order(bigint, text, boolean) from public, anon, authenticated;

grant execute on function public._wallet_apply(bigint, bigint, text, bigint, bigint, text) to service_role;
grant execute on function public.wallet_get(bigint) to service_role;
grant execute on function public.wallet_admin_adjust(bigint, bigint, text) to service_role;
grant execute on function public.wallet_create_topup(bigint, bigint, integer, integer) to service_role;
grant execute on function public.wallet_cancel_topup(bigint, bigint) to service_role;
grant execute on function public.wallet_credit_topup(text, text, bigint, timestamptz, bigint, text, integer) to service_role;
grant execute on function public.wallet_buy_limit(bigint, text) to service_role;
grant execute on function public.wallet_buy_firstmail(bigint, text) to service_role;
grant execute on function public.wallet_refund_order(bigint, text, boolean) to service_role;

commit;
