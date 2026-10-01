-- Mening profilim → Mobile Legends'ga ulash (Rone Arena API, send-vc + login).
--
-- user_accounts qatoriga o'yin sessiyasi yoziladi:
--   ml_token      — Arena JWT, bot/miniapp tomonidan shifrlangan ("v1:..."),
--                   hech qachon clientga (Mini App brauzeriga) chiqmaydi
--   ml_nickname   — ulangan paytdagi o'yin nickname (profil ro'yxati uchun)
--   ml_linked_at  — ulangan vaqt
--
-- Ulanish o'yin ichidagi kod bilan tasdiqlanadi, ya'ni egalik isbotlangan.
-- list_user_accounts endi token emas, faqat ml_linked flagini qaytaradi.

begin;

alter table public.user_accounts add column if not exists ml_token text;
alter table public.user_accounts add column if not exists ml_nickname text;
alter table public.user_accounts add column if not exists ml_linked_at timestamptz;

-- ---------------------------------------------------------------------------
-- Userning barcha akkauntlari (+ ML ulanish holati, tokensiz).
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
        'created_at', created_at,
        'ml_linked', ml_token is not null,
        'ml_nickname', ml_nickname,
        'ml_linked_at', ml_linked_at
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
-- Sessiyani saqlash (login muvaffaqiyatli bo'lgach).
-- ---------------------------------------------------------------------------
create or replace function public.set_user_account_ml_link(
  p_user_id bigint,
  p_row_id bigint,
  p_token text,
  p_nickname text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  if p_user_id is null or p_row_id is null or coalesce(p_token, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  update public.user_accounts
  set ml_token = p_token,
      ml_nickname = nullif(left(coalesce(p_nickname, ''), 64), ''),
      ml_linked_at = now(),
      updated_at = now()
  where id = p_row_id and user_id = p_user_id;

  if found then
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'not_found');
end;
$$;

-- ---------------------------------------------------------------------------
-- Sessiya tokenini olish (faqat egasi uchun).
-- ---------------------------------------------------------------------------
create or replace function public.get_user_account_ml_link(
  p_user_id bigint,
  p_row_id bigint
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_row public.user_accounts%rowtype;
begin
  select * into v_row
  from public.user_accounts
  where id = p_row_id and user_id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'account_id', v_row.account_id,
    'zone_id', v_row.zone_id,
    'ml_token', v_row.ml_token,
    'ml_nickname', v_row.ml_nickname,
    'ml_linked_at', v_row.ml_linked_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Logout — sessiyani o'chirish (akkaunt profil ro'yxatida qoladi).
-- ---------------------------------------------------------------------------
create or replace function public.clear_user_account_ml_link(
  p_user_id bigint,
  p_row_id bigint
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  update public.user_accounts
  set ml_token = null,
      ml_nickname = null,
      ml_linked_at = null,
      updated_at = now()
  where id = p_row_id and user_id = p_user_id;

  if found then
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'not_found');
end;
$$;

revoke all on function public.list_user_accounts(bigint) from public, anon, authenticated;
grant execute on function public.list_user_accounts(bigint) to service_role;

revoke all on function public.set_user_account_ml_link(bigint, bigint, text, text) from public, anon, authenticated;
grant execute on function public.set_user_account_ml_link(bigint, bigint, text, text) to service_role;

revoke all on function public.get_user_account_ml_link(bigint, bigint) from public, anon, authenticated;
grant execute on function public.get_user_account_ml_link(bigint, bigint) to service_role;

revoke all on function public.clear_user_account_ml_link(bigint, bigint) from public, anon, authenticated;
grant execute on function public.clear_user_account_ml_link(bigint, bigint) to service_role;

commit;
