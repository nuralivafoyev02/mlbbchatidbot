-- Full-info paket tizimi: kunlik reset YO'Q. Har bir user boshlang'ich paket
-- sifatida 5 ta tekshirish oladi (ustun default'i). Admin qo'shimcha paket
-- beradi — qoldiq ustiga qo'shiladi. Har muvaffaqiyatli tekshirish 1 birlik
-- kamaytiradi; xatolik bo'lsa kamaymaydi.
--
-- Asosiy farq: bind-info'dagi "custom_bind_limit" limit o'rnini bosadi va kunlik
-- reset qilinadi. Bu yerda esa "full_info_quota" — foydalanuvchi olgan paket
-- qoldig'i; hech qachon avtomatik tiklanmaydi.

begin;

alter table public.bot_users
add column if not exists full_info_quota integer not null default 5;

create index if not exists bot_users_full_info_quota_idx
  on public.bot_users (user_id)
  where full_info_quota > 0;

-- Admin limit beradi: mavjud qoldiq USTIGA qo'shiladi.
-- Yangi user bo'lsa avval default boshlang'ich paket bilan yaratiladi,
-- keyin unga berilgan miqdor qo'shiladi.
create or replace function public.add_full_info_quota(
  p_user_id bigint,
  p_amount integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_quota integer;
  v_new_quota integer;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  insert into public.bot_users (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  update public.bot_users
  set full_info_quota = least(
        coalesce(full_info_quota, 0) + p_amount,
        2147483647
      ),
      updated_at = now()
  where user_id = p_user_id;

  select full_info_quota into v_quota from public.bot_users where user_id = p_user_id;
  v_new_quota := v_quota;

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'granted', p_amount,
    'remaining', v_new_quota
  );
end;
$$;

-- Foydalanuvchi statusi: limitlanganmi, qancha qoldi (kamaytirishsiz).
-- Bazada ro'yxatga olinmagan user uchun boshlang'ich paket bilan yaratiladi.
create or replace function public.get_full_info_quota(
  p_user_id bigint
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_quota integer;
begin
  insert into public.bot_users (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select coalesce(full_info_quota, 0) into v_quota
  from public.bot_users
  where user_id = p_user_id;

  return jsonb_build_object(
    'allowed', v_quota > 0,
    'remaining', v_quota,
    'total_limit', v_quota
  );
end;
$$;

-- Iste'mol qilish + qaytarish (refund) yordamchisi.
-- Tekshirish muvaffaqiyatli bo'lsa bot consume qiladi; xatolik bo'lsa qaytaradi.
create or replace function public.consume_full_info_quota(
  p_user_id bigint,
  p_action text,
  p_amount integer default 1
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_quota integer;
begin
  if p_action not in ('consume', 'refund') then
    return jsonb_build_object('ok', false, 'error', 'invalid_action');
  end if;

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  update public.bot_users
  set full_info_quota = greatest(
        case
          when p_action = 'consume'
            then coalesce(full_info_quota, 0) - p_amount
          else coalesce(full_info_quota, 0) + p_amount
        end,
        0
      ),
      updated_at = now()
  where user_id = p_user_id;

  if not found then
    return jsonb_build_object('ok', true, 'remaining', 0);
  end if;

  select full_info_quota into v_quota from public.bot_users where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'remaining', v_quota);
end;
$$;

revoke all on function public.add_full_info_quota(bigint, integer) from public, anon, authenticated;
grant execute on function public.add_full_info_quota(bigint, integer) to service_role;

revoke all on function public.get_full_info_quota(bigint) from public, anon, authenticated;
grant execute on function public.get_full_info_quota(bigint) to service_role;

revoke all on function public.consume_full_info_quota(bigint, text, integer) from public, anon, authenticated;
grant execute on function public.consume_full_info_quota(bigint, text, integer) to service_role;

commit;
