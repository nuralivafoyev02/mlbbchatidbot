-- Mening profilim: foydalanuvchi o'z MLBB akkauntlarini kiritadi (5 tagacha),
-- akkauntni uzadi va kimlar tekshirganini ko'radi.
--
--  user_accounts          — akkaunt egalari (owner -> account_id/zone_id)
--  account_check_events   — akkaunt tekshirilganda yozilib boradigan jurnal
--
--  record_account_check: bir query — egasini topadi, (egasi tekshiruvchi
--  bo'lmasa) jurnalga yozadi va notify qilish uchun owner_user_id qaytaradi.
--  Shunday qilib bot tekshiruv natijasini birinchi o'rinda userga yuboradi,
--  keyin boshqa query orqali egasini aniqlaydi (tezlikka ta'sir qilmaydi).

begin;

create table if not exists public.user_accounts (
  id bigserial primary key,
  user_id bigint not null,
  account_id text not null,
  zone_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id, zone_id)
);

create index if not exists user_accounts_lookup_idx
  on public.user_accounts (account_id, zone_id);

create table if not exists public.account_check_events (
  id bigserial primary key,
  owner_user_id bigint not null,
  account_id text not null,
  zone_id text not null,
  checker_user_id bigint not null,
  checker_username text,
  checker_first_name text,
  action text not null default 'server_check',
  created_at timestamptz not null default now()
);

create index if not exists account_check_events_owner_idx
  on public.account_check_events (owner_user_id, created_at desc);

alter table public.user_accounts enable row level security;
alter table public.account_check_events enable row level security;

revoke all on public.user_accounts from anon, authenticated;
revoke all on public.account_check_events from anon, authenticated;

grant select, insert, update, delete on public.user_accounts to service_role;
grant select, insert on public.account_check_events to service_role;
grant usage, select on sequence public.user_accounts_id_seq to service_role;
grant usage, select on sequence public.account_check_events_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Yangi akkaunt qo'shish. Tekshiruvchi tomonidan kiritilgan ID formatini
-- bot kabi tekshiramiz. Cheklovlar:
--   * har bir user uchun ko'pi bilan 5 ta akkaunt
--   * bitta (account_id, zone_id) faqat bitta egaga tegishli bo'lishi mumkin
-- ---------------------------------------------------------------------------
create or replace function public.add_user_account(
  p_user_id bigint,
  p_account_id text,
  p_zone_id text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
  v_new_id bigint;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_user');
  end if;

  if p_account_id is null or p_zone_id is null
     or p_account_id !~ '^\d{5,12}$' or p_zone_id !~ '^\d{1,8}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select count(*) into v_count
  from public.user_accounts
  where user_id = p_user_id;

  if v_count >= 5 then
    return jsonb_build_object('ok', false, 'error', 'limit_reached', 'count', v_count);
  end if;

  if exists (
    select 1 from public.user_accounts
    where account_id = p_account_id and zone_id = p_zone_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_exists');
  end if;

  insert into public.user_accounts (user_id, account_id, zone_id)
  values (p_user_id, p_account_id, p_zone_id)
  returning id into v_new_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_new_id,
    'account_id', p_account_id,
    'zone_id', p_zone_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Akkauntni uzish (o'chirish).
-- ---------------------------------------------------------------------------
create or replace function public.remove_user_account(
  p_user_id bigint,
  p_account_id text,
  p_zone_id text
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  delete from public.user_accounts
  where user_id = p_user_id
    and account_id = p_account_id
    and zone_id = p_zone_id;

  if found then
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'not_found');
end;
$$;

-- ---------------------------------------------------------------------------
-- Userning barcha akkauntlari.
-- ---------------------------------------------------------------------------
create or replace function public.list_user_accounts(
  p_user_id bigint
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'account_id', account_id,
        'zone_id', zone_id,
        'created_at', created_at
      ) order by created_at
    ),
    '[]'::jsonb
  ) into v_result
  from public.user_accounts
  where user_id = p_user_id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Akkaunt kimga tegishli ekanligini aniqlash (notify uchun, log yozilmaydi).
-- ---------------------------------------------------------------------------
create or replace function public.find_account_owner(
  p_account_id text,
  p_zone_id text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_owner bigint;
begin
  select user_id into v_owner
  from public.user_accounts
  where account_id = p_account_id and zone_id = p_zone_id
  limit 1;

  if v_owner is null then
    return jsonb_build_object('ok', true, 'owner_user_id', null, 'notify', false);
  end if;

  return jsonb_build_object('ok', true, 'owner_user_id', v_owner, 'notify', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tekshiruvni qayd qilish + notify uchun egasini qaytarish.
-- Egasining O'ZIGA tegishli akkauntni tekshirishi qayd etilmaydi va notify
-- yuborilmaydi (owner == checker bo'lsa skip).
-- ---------------------------------------------------------------------------
create or replace function public.record_account_check(
  p_account_id text,
  p_zone_id text,
  p_checker_user_id bigint,
  p_checker_username text,
  p_checker_first_name text,
  p_action text default 'server_check'
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_owner bigint;
begin
  select user_id into v_owner
  from public.user_accounts
  where account_id = p_account_id and zone_id = p_zone_id
  limit 1;

  if v_owner is null then
    return jsonb_build_object('ok', true, 'owner_user_id', null, 'notify', false);
  end if;

  if v_owner = p_checker_user_id then
    return jsonb_build_object('ok', true, 'owner_user_id', null, 'notify', false);
  end if;

  insert into public.account_check_events (
    owner_user_id,
    account_id,
    zone_id,
    checker_user_id,
    checker_username,
    checker_first_name,
    action
  )
  values (
    v_owner,
    p_account_id,
    p_zone_id,
    p_checker_user_id,
    nullif(p_checker_username, ''),
    nullif(p_checker_first_name, ''),
    coalesce(nullif(p_action, ''), 'server_check')
  );

  return jsonb_build_object(
    'ok', true,
    'owner_user_id', v_owner,
    'account_id', p_account_id,
    'zone_id', p_zone_id,
    'notify', true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Egasining akkauntlarini kimlar tekshirgani (oxirgi p_limit ta).
-- ---------------------------------------------------------------------------
create or replace function public.get_account_check_history(
  p_user_id bigint,
  p_limit integer default 10
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_result jsonb;
begin
  p_limit := greatest(1, least(coalesce(p_limit, 10), 50));

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'account_id', e.account_id,
        'zone_id', e.zone_id,
        'checker_user_id', e.checker_user_id,
        'checker_username', e.checker_username,
        'checker_first_name', e.checker_first_name,
        'action', e.action,
        'created_at', e.created_at
      ) order by e.created_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from (
    select *
    from public.account_check_events e2
    where e2.owner_user_id = p_user_id
    order by e2.created_at desc
    limit p_limit
  ) e;

  return v_result;
end;
$$;

revoke all on function public.add_user_account(bigint, text, text) from public, anon, authenticated;
grant execute on function public.add_user_account(bigint, text, text) to service_role;

revoke all on function public.remove_user_account(bigint, text, text) from public, anon, authenticated;
grant execute on function public.remove_user_account(bigint, text, text) to service_role;

revoke all on function public.list_user_accounts(bigint) from public, anon, authenticated;
grant execute on function public.list_user_accounts(bigint) to service_role;

revoke all on function public.find_account_owner(text, text) from public, anon, authenticated;
grant execute on function public.find_account_owner(text, text) to service_role;

revoke all on function public.record_account_check(text, text, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.record_account_check(text, text, bigint, text, text, text) to service_role;

revoke all on function public.get_account_check_history(bigint, integer) from public, anon, authenticated;
grant execute on function public.get_account_check_history(bigint, integer) to service_role;

commit;