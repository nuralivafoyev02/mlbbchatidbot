begin;

-- ---------------------------------------------------------------------------
-- Ommaviy API (/v1/check) foydalanish hisobi. Worker so'rovlarni RAM'da
-- yig'ib, ~30 s'da bir marta shu funksiya orqali qo'shadi (atomik).
-- ---------------------------------------------------------------------------
create or replace function public.api_token_hit(p_id bigint, p_hits integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.api_tokens
     set usage_count = usage_count + greatest(p_hits, 0),
         last_used_at = now()
   where id = p_id;
$$;

revoke all on function public.api_token_hit(bigint, integer) from public, anon, authenticated;
grant execute on function public.api_token_hit(bigint, integer) to service_role;

commit;
