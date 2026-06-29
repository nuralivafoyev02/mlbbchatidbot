begin;

alter table public.bot_users 
add column if not exists custom_bind_limit integer default null;

-- Update check_and_consume_bind_limit
create or replace function public.check_and_consume_bind_limit(
  p_user_id bigint,
  p_limit integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  -- Use Tashkent timezone for strict 00:00 resets locally.
  v_today date := (current_timestamp at time zone 'Asia/Tashkent')::date;
  v_user record;
  v_checks integer;
  v_actual_limit integer;
begin
  select * into v_user from public.bot_users where user_id = p_user_id for update;
  
  if not found then
    -- If user doesn't exist yet, insert with 1 usage
    insert into public.bot_users (
      user_id, bind_info_checks_today, last_bind_info_check_date, custom_bind_limit
    ) values (
      p_user_id, 1, v_today, null
    );
    return jsonb_build_object('allowed', true, 'remaining', p_limit - 1, 'total_limit', p_limit);
  end if;

  v_actual_limit := coalesce(v_user.custom_bind_limit, p_limit);

  if v_user.last_bind_info_check_date is distinct from v_today then
    v_checks := 0;
  else
    v_checks := coalesce(v_user.bind_info_checks_today, 0);
  end if;

  if v_checks >= v_actual_limit then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'total_limit', v_actual_limit);
  end if;

  update public.bot_users
  set 
    bind_info_checks_today = v_checks + 1,
    last_bind_info_check_date = v_today,
    updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object('allowed', true, 'remaining', v_actual_limit - (v_checks + 1), 'total_limit', v_actual_limit);
end;
$$;

-- Update check_bind_limit_only
create or replace function public.check_bind_limit_only(
  p_user_id bigint,
  p_limit integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_today date := (current_timestamp at time zone 'Asia/Tashkent')::date;
  v_user record;
  v_checks integer;
  v_actual_limit integer;
begin
  select * into v_user from public.bot_users where user_id = p_user_id;
  
  if not found then
    return jsonb_build_object('allowed', true, 'remaining', p_limit, 'total_limit', p_limit);
  end if;

  v_actual_limit := coalesce(v_user.custom_bind_limit, p_limit);

  if v_user.last_bind_info_check_date is distinct from v_today then
    v_checks := 0;
  else
    v_checks := coalesce(v_user.bind_info_checks_today, 0);
  end if;

  if v_checks >= v_actual_limit then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'total_limit', v_actual_limit);
  end if;

  return jsonb_build_object('allowed', true, 'remaining', v_actual_limit - v_checks, 'total_limit', v_actual_limit);
end;
$$;

-- Add set_custom_bind_limit function
create or replace function public.set_custom_bind_limit(
  p_target_user_id bigint,
  p_new_limit integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  update public.bot_users
  set custom_bind_limit = p_new_limit,
      updated_at = now()
  where user_id = p_target_user_id;

  if not found then
    -- Insert user if they don't exist yet so we can store the limit
    insert into public.bot_users (
      user_id, bind_info_checks_today, last_bind_info_check_date, custom_bind_limit
    ) values (
      p_target_user_id, 0, current_date, p_new_limit
    );
  end if;

  return jsonb_build_object('ok', true, 'target_user_id', p_target_user_id, 'new_limit', p_new_limit);
end;
$$;

revoke all on function public.check_and_consume_bind_limit(bigint, integer) from public, anon, authenticated;
grant execute on function public.check_and_consume_bind_limit(bigint, integer) to service_role;

revoke all on function public.check_bind_limit_only(bigint, integer) from public, anon, authenticated;
grant execute on function public.check_bind_limit_only(bigint, integer) to service_role;

revoke all on function public.set_custom_bind_limit(bigint, integer) from public, anon, authenticated;
grant execute on function public.set_custom_bind_limit(bigint, integer) to service_role;

commit;
