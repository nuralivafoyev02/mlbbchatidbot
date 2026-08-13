begin;

-- Funksiya darajasidagi action ustuni (faqat mazmunli foydalanishlar yoziladi)
alter table public.bot_usage_events
  add column if not exists action text;

create index if not exists bot_usage_events_action_created_at_idx
  on public.bot_usage_events (action, created_at desc);

-- track_bot_user: faqat p_action berilganda usage event yoziladi va updates_count oshiriladi
drop function if exists public.track_bot_user(
  bigint,
  bigint,
  text,
  text,
  text,
  text,
  text,
  boolean,
  bigint,
  text,
  text,
  text
);

create or replace function public.track_bot_user(
  p_user_id bigint,
  p_chat_id bigint default null,
  p_chat_type text default null,
  p_username text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_language_code text default null,
  p_is_bot boolean default null,
  p_update_id bigint default null,
  p_update_type text default null,
  p_message_text text default null,
  p_phone_number text default null,
  p_action text default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_updates_delta integer := 0;
  v_phone_number text := nullif(regexp_replace(coalesce(p_phone_number, ''), '\D', '', 'g'), '');
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.bot_users (
    user_id,
    chat_id,
    chat_type,
    username,
    first_name,
    last_name,
    language_code,
    is_bot,
    phone_number,
    updates_count,
    last_update_type,
    first_seen_at,
    last_seen_at,
    updated_at
  )
  values (
    p_user_id,
    p_chat_id,
    p_chat_type,
    p_username,
    p_first_name,
    p_last_name,
    p_language_code,
    p_is_bot,
    v_phone_number,
    0,
    p_update_type,
    now(),
    now(),
    now()
  )
  on conflict (user_id) do update
  set
    chat_id = case
      when excluded.chat_type = 'private' then excluded.chat_id
      when public.bot_users.chat_type = 'private' then public.bot_users.chat_id
      else coalesce(excluded.chat_id, public.bot_users.chat_id)
    end,
    chat_type = case
      when excluded.chat_type = 'private' then excluded.chat_type
      when public.bot_users.chat_type = 'private' then public.bot_users.chat_type
      else coalesce(excluded.chat_type, public.bot_users.chat_type)
    end,
    username = coalesce(excluded.username, public.bot_users.username),
    first_name = coalesce(excluded.first_name, public.bot_users.first_name),
    last_name = coalesce(excluded.last_name, public.bot_users.last_name),
    language_code = coalesce(excluded.language_code, public.bot_users.language_code),
    is_bot = coalesce(excluded.is_bot, public.bot_users.is_bot),
    phone_number = coalesce(excluded.phone_number, public.bot_users.phone_number),
    last_update_type = coalesce(excluded.last_update_type, public.bot_users.last_update_type),
    last_seen_at = now(),
    updated_at = now();

  -- Faqat mazmunli action bo'lsa usage event yoziladi va update hisoblanadi
  if p_action is not null and p_action <> '' then
    insert into public.bot_usage_events (
      user_id,
      chat_id,
      update_id,
      update_type,
      message_text,
      action,
      created_at
    )
    values (
      p_user_id,
      p_chat_id,
      p_update_id,
      coalesce(p_update_type, 'action'),
      p_message_text,
      p_action,
      now()
    )
    on conflict (update_id) do nothing;

    get diagnostics v_updates_delta = row_count;

    if v_updates_delta > 0 then
      update public.bot_users
      set
        updates_count = updates_count + v_updates_delta,
        last_seen_at = now(),
        updated_at = now()
      where user_id = p_user_id;
    end if;
  end if;
end;
$$;

-- Kunlik hisobot: funksiyalar bo'yicha nechta ishlatilgani + top 3 foydalanuvchi
create or replace function public.get_daily_usage_report(
  p_date date default (current_timestamp at time zone 'Asia/Tashkent')::date
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_start timestamptz := (p_date::timestamp at time zone 'Asia/Tashkent');
  v_end timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Tashkent');
  v_actions jsonb;
  v_top_users jsonb;
begin
  select coalesce(jsonb_agg(x order by x.count desc), '[]'::jsonb)
  into v_actions
  from (
    select e.action, count(*)::integer as count
    from public.bot_usage_events e
    where e.action is not null
      and e.created_at >= v_start
      and e.created_at < v_end
    group by e.action
  ) x;

  select coalesce(jsonb_agg(x order by x.count desc), '[]'::jsonb)
  into v_top_users
  from (
    select
      e.user_id,
      u.username,
      u.first_name,
      u.last_name,
      count(*)::integer as count
    from public.bot_usage_events e
    left join public.bot_users u on u.user_id = e.user_id
    where e.action is not null
      and e.created_at >= v_start
      and e.created_at < v_end
    group by e.user_id, u.username, u.first_name, u.last_name
    order by count(*) desc
    limit 3
  ) x;

  return jsonb_build_object(
    'date', to_char(p_date, 'YYYY-MM-DD'),
    'actions', v_actions,
    'top_users', v_top_users
  );
end;
$$;

revoke all on function public.track_bot_user(
  bigint,
  bigint,
  text,
  text,
  text,
  text,
  text,
  boolean,
  bigint,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.track_bot_user(
  bigint,
  bigint,
  text,
  text,
  text,
  text,
  text,
  boolean,
  bigint,
  text,
  text,
  text,
  text
) to service_role;

revoke all on function public.get_daily_usage_report(date) from public, anon, authenticated;
grant execute on function public.get_daily_usage_report(date) to service_role;

commit;
