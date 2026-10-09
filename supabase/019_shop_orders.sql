-- Shaxsiy kabinet → Do'kon → Tarix: xaridlar tarixi.
--
--  shop_orders — kabinetdan yuborilgan har bir xarid so'rovi bitta qator:
--    kind     — firstmail | limit | donat
--    item_id  — do'kon mahsuloti / limit paketi ID'si
--    title    — ko'rsatiladigan nom (pochta yashirilgan holda, "To'liq ma'lumot × 10" ...)
--    price    — narx, so'm (kelishiladigan bo'lsa null, price_text da matn)
--    status   — pending (so'rov yuborildi) | done (bajarildi) | cancelled
--
-- Jadvalga faqat server (service_role) yozadi; Mini App o'z egasining
-- qatorlarini server orqali o'qiydi.

begin;

create table if not exists public.shop_orders (
  id bigserial primary key,
  user_id bigint not null,
  kind text not null check (kind in ('firstmail', 'limit', 'donat')),
  item_id text,
  title text not null default '',
  price bigint,
  price_text text,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_orders_user_idx
  on public.shop_orders (user_id, created_at desc);

alter table public.shop_orders enable row level security;

revoke all on public.shop_orders from anon, authenticated;
grant select, insert, update on public.shop_orders to service_role;
grant usage, select on sequence public.shop_orders_id_seq to service_role;

commit;
