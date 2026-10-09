-- Shaxsiy kabinet: limitlar tarixi.
--
--  quota_usage_events — har bir limit harakati bitta qator:
--    * source = 'use'      — foydalanuvchi limitni ishlatdi (delta = -1);
--                            qaysi akkaunt (account_id/zone_id) yoki pochta
--                            (target, yashirilgan) uchun ketgani yoziladi
--    * source = 'admin'    — admin qo'shdi (+N) yoki kamaytirdi (-N)
--    * source = 'purchase' — xarid orqali qo'shildi (to'lov ulanganda)
--  kind: full_info | reset_pw | bind_info (bind_info — kunlik limit).
--
-- Jadvalga faqat bot va server (service_role) yozadi; Mini App o'z egasining
-- qatorlarini server orqali o'qiydi.

begin;

create table if not exists public.quota_usage_events (
  id bigserial primary key,
  user_id bigint not null,
  kind text not null check (kind in ('full_info', 'reset_pw', 'bind_info')),
  delta integer not null,
  source text not null default 'use' check (source in ('use', 'admin', 'purchase')),
  account_id text,
  zone_id text,
  target text,
  remaining integer,
  created_at timestamptz not null default now()
);

create index if not exists quota_usage_events_user_idx
  on public.quota_usage_events (user_id, created_at desc);

alter table public.quota_usage_events enable row level security;

revoke all on public.quota_usage_events from anon, authenticated;
grant select, insert on public.quota_usage_events to service_role;
grant usage, select on sequence public.quota_usage_events_id_seq to service_role;

commit;
