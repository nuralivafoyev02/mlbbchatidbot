-- Balansni to'ldirish: imkon qadar foydalanuvchi tanlagan ANIQ summa.
--
-- 020 da har bir so'rovga tasodifiy +1..999 so'm qo'shilardi (5 000 → 5 920).
-- ELDER PAY bir kassada bir xil summadagi ikkita faol to'lovga o'zi ruxsat
-- bermaydi (409), shuning uchun endi:
--   p_exact = true  → avval aynan summa, band bo'lsa +1, +2, ... so'm;
--   p_exact = false → eskicha tasodifiy +1..999 (ElderPay ulanmagan, admin
--                     qo'lda tasdiqlaydigan rejim — summa yagona belgi).
-- Imzo o'zgargani uchun eski funksiya o'chirilib, yangisi yaratiladi.

begin;

drop function if exists public.wallet_create_topup(bigint, bigint, integer, integer);

create or replace function public.wallet_create_topup(
  p_user_id bigint,
  p_amount bigint,
  p_ttl_minutes integer default 30,
  p_grace_minutes integer default 60,
  p_exact boolean default false
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

  update public.wallet_topups
  set status = 'expired', updated_at = now()
  where status = 'pending' and expires_at < now();

  update public.wallet_topups
  set status = 'cancelled', updated_at = now()
  where user_id = p_user_id and status = 'pending';

  loop
    v_try := v_try + 1;
    if v_try > 999 then
      return jsonb_build_object('ok', false, 'error', 'busy');
    end if;

    -- Aniq rejim: 0, 1, 2, ... ; tasodifiy rejim: 1..999 (60 urinish).
    if p_exact then
      v_offset := v_try - 1;
    else
      if v_try > 60 then
        return jsonb_build_object('ok', false, 'error', 'busy');
      end if;
      v_offset := 1 + floor(random() * 999)::integer;
    end if;
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
      null;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'topup', to_jsonb(v_row));
end;
$$;

revoke all on function public.wallet_create_topup(bigint, bigint, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.wallet_create_topup(bigint, bigint, integer, integer, boolean) to service_role;

commit;
