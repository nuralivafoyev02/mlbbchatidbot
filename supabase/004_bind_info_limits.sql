begin;

alter table public.bot_users 
add column if not exists bind_info_checks_today integer not null default 0,
add column if not exists last_bind_info_check_date date default current_date;

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
begin
  select * into v_user from public.bot_users where user_id = p_user_id for update;
  
  if not found then
    -- If user doesn't exist yet, insert with 1 usage
    insert into public.bot_users (
      user_id, bind_info_checks_today, last_bind_info_check_date
    ) values (
      p_user_id, 1, v_today
    );
    return jsonb_build_object('allowed', true, 'remaining', p_limit - 1);
  end if;

  if v_user.last_bind_info_check_date is distinct from v_today then
    v_checks := 0;
  else
    v_checks := coalesce(v_user.bind_info_checks_today, 0);
  end if;

  if v_checks >= p_limit then
    return jsonb_build_object('allowed', false, 'remaining', 0);
  end if;

  update public.bot_users
  set 
    bind_info_checks_today = v_checks + 1,
    last_bind_info_check_date = v_today,
    updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object('allowed', true, 'remaining', p_limit - (v_checks + 1));
end;
$$;

revoke all on function public.check_and_consume_bind_limit(bigint, integer) from public, anon, authenticated;
grant execute on function public.check_and_consume_bind_limit(bigint, integer) to service_role;

commit;
