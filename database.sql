create extension if not exists pgcrypto;
create table if not exists customers (
 id uuid primary key default gen_random_uuid(), name text not null default '', phone text not null unique,
 telegram_chat_id text unique, link_code text unique, created_at timestamptz not null default now()
);
create table if not exists wash_orders (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references customers(id),
 plate text not null, vehicle text not null default '', service text not null default 'Комплексная мойка',
 price numeric(10,2) not null default 0,
 status text not null default 'arrived' check(status in ('arrived','washing','drying','ready','closed')),
 notify_customer boolean not null default true, voided boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists wash_orders_created_idx on wash_orders(created_at desc);
create index if not exists wash_orders_status_idx on wash_orders(status);
-- Supabase service role key is used by Express only; never expose it to browser code.

alter table wash_orders add column if not exists voided boolean not null default false;
alter table customers add column if not exists telegram_pending_chat_id text;
alter table wash_orders add column if not exists telegram_message_id bigint;

-- Online reservations and reminder delivery tracking
alter table wash_orders add column if not exists scheduled_for timestamptz;
alter table wash_orders add column if not exists reminder_day_sent_at timestamptz;
alter table wash_orders add column if not exists reminder_today_sent_at timestamptz;
alter table wash_orders drop constraint if exists wash_orders_status_check;
alter table wash_orders add constraint wash_orders_status_check check(status in ('booked','arrived','washing','drying','ready','closed'));
create index if not exists wash_orders_booking_idx on wash_orders(scheduled_for) where status='booked' and voided=false;
create extension if not exists pg_cron;
create extension if not exists pg_net;