-- To'lov tizimi jurnali: provayder (Hamyon/ElderPay) bilan har bir muhim
-- hodisa — callback, API xatosi, imzo xatosi, summa mos kelmasligi, balansga
-- yozilgan to'lov, admin sozlamasi. Admin panel → Feat → "Jurnal" va holat
-- kartalari shu jadvaldan o'qiydi.
--
-- Jadval bo'lmasa ham to'lovlar ishlayveradi (yozish xatosi faqat logga
-- tushadi). Qayta ishga tushirilsa xavfsiz.

begin;

create table if not exists public.wallet_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  -- info | warn | error
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  -- callback | create | check | cancel | credit | health | config | sync
  kind text not null,
  provider text,
  topup_id bigint,
  user_id bigint,
  message text not null default '',
  data jsonb not null default '{}'::jsonb
);

create index if not exists wallet_events_created_idx on public.wallet_events (created_at desc);
create index if not exists wallet_events_level_idx on public.wallet_events (level, created_at desc);
create index if not exists wallet_events_kind_idx on public.wallet_events (kind, created_at desc);

alter table public.wallet_events enable row level security;
revoke all on public.wallet_events from anon, authenticated;
grant select, insert, delete on public.wallet_events to service_role;
grant usage, select on sequence public.wallet_events_id_seq to service_role;

commit;

notify pgrst, 'reload schema';
