create extension if not exists pgcrypto;

create table if not exists customers (
 id uuid primary key default gen_random_uuid(),
 name text not null default '',
 phone text not null unique,
 telegram_chat_id text unique,
 link_code text unique,
 telegram_pending_chat_id text,
 announcements_opt_in boolean not null default false,
 created_at timestamptz not null default now()
);

create table if not exists cars (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references customers(id) on delete cascade,
 plate text not null unique,
 vehicle text not null default '',
 last_seen_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);

create table if not exists wash_orders (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references customers(id),
 car_id uuid references cars(id),
 plate text not null,
 vehicle text not null default '',
 service text not null default 'Комплексная мойка',
 service_details text not null default '',
 price numeric(10,2) not null default 0,
 wash_site text not null default 'akku',
 status text not null default 'arrived',
 notify_customer boolean not null default true,
 voided boolean not null default false,
 cancelled boolean not null default false,
 cancellation_reason text,
 cancelled_at timestamptz,
 cancelled_by text,
 scheduled_for timestamptz,
 reminder_day_sent_at timestamptz,
 reminder_today_sent_at timestamptz,
 telegram_message_id bigint,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint wash_orders_status_check check(status in ('booked','arrived','washing','drying','ready','closed')),
 constraint wash_orders_site_check check(wash_site in ('akku','premium'))
);

-- Safe migration for an existing Supabase project.
alter table customers add column if not exists telegram_pending_chat_id text;
alter table customers add column if not exists announcements_opt_in boolean not null default false;
alter table wash_orders add column if not exists car_id uuid references cars(id);
alter table wash_orders add column if not exists service_details text not null default '';
alter table wash_orders add column if not exists wash_site text not null default 'akku';
alter table wash_orders add column if not exists cancelled boolean not null default false;
alter table wash_orders add column if not exists cancellation_reason text;
alter table wash_orders add column if not exists cancelled_at timestamptz;
alter table wash_orders add column if not exists cancelled_by text;
alter table wash_orders add column if not exists telegram_message_id bigint;
alter table wash_orders add column if not exists scheduled_for timestamptz;
alter table wash_orders add column if not exists reminder_day_sent_at timestamptz;
alter table wash_orders add column if not exists reminder_today_sent_at timestamptz;
alter table wash_orders add column if not exists voided boolean not null default false;
alter table wash_orders add column if not exists updated_at timestamptz not null default now();

alter table wash_orders drop constraint if exists wash_orders_status_check;
alter table wash_orders add constraint wash_orders_status_check check(status in ('booked','arrived','washing','drying','ready','closed'));
alter table wash_orders drop constraint if exists wash_orders_site_check;
alter table wash_orders add constraint wash_orders_site_check check(wash_site in ('akku','premium'));

-- Build the vehicle directory from cars already present in the order history.
insert into cars(customer_id,plate,vehicle,last_seen_at)
select distinct on (upper(trim(plate))) customer_id,upper(trim(plate)),coalesce(vehicle,''),coalesce(created_at,now())
from wash_orders
where trim(coalesce(plate,''))<>'' 
order by upper(trim(plate)),created_at desc
on conflict (plate) do nothing;

update wash_orders o set car_id=c.id
from cars c
where o.car_id is null and upper(trim(o.plate))=c.plate;

create index if not exists wash_orders_created_idx on wash_orders(created_at desc);
create index if not exists wash_orders_status_idx on wash_orders(status);
create index if not exists wash_orders_booking_idx on wash_orders(scheduled_for) where status='booked' and voided=false and cancelled=false;
create index if not exists wash_orders_cancelled_idx on wash_orders(cancelled_at desc) where cancelled=true;
create index if not exists cars_customer_idx on cars(customer_id);
create index if not exists customers_announcements_idx on customers(announcements_opt_in) where announcements_opt_in=true;

-- The Express server uses SUPABASE_SERVICE_ROLE_KEY on the server only.
-- RLS remains enabled so anon/publishable clients cannot access vehicle data.
alter table cars enable row level security;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Booking requests from the Telegram bot. Staff approval creates a wash_order.
create table if not exists booking_requests (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references customers(id),
 car_id uuid references cars(id) on delete set null,
 plate text not null,
 vehicle text not null default '',
 service text not null default 'Комплексная мойка',
 wash_site text not null default 'akku' check(wash_site in ('akku','premium')),
 requested_for timestamptz not null,
 proposed_for timestamptz,
 state text not null default 'pending' check(state in ('pending','alternative','accepted','rejected')),
 rejection_reason text,
 wash_order_id uuid references wash_orders(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists telegram_booking_sessions (
 chat_id text primary key,
 customer_id uuid not null references customers(id) on delete cascade,
 car_id uuid references cars(id) on delete set null,
 plate text not null default '',
 vehicle text not null default '',
 wash_site text not null default 'akku' check(wash_site in ('akku','premium')),
 step text not null default 'car',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table wash_orders add column if not exists box text not null default '';
alter table wash_orders add column if not exists washer_name text not null default '';
alter table wash_orders add column if not exists arrived_at timestamptz;
alter table wash_orders add column if not exists wash_started_at timestamptz;
alter table wash_orders add column if not exists washed_at timestamptz;
alter table wash_orders add column if not exists issued_at timestamptz;
update wash_orders set arrived_at=created_at where arrived_at is null and status<>'booked';
update wash_orders set issued_at=updated_at where issued_at is null and status='closed';
create index if not exists booking_requests_state_idx on booking_requests(state,created_at desc);
create index if not exists booking_requests_requested_for_idx on booking_requests(requested_for);
alter table booking_requests enable row level security;
alter table telegram_booking_sessions enable row level security;


-- Booking metadata and service bay tracking.
alter table wash_orders add column if not exists booking_source text not null default 'walk_in';
alter table wash_orders add column if not exists box text not null default '';
alter table wash_orders add column if not exists washer_name text not null default '';
alter table wash_orders add column if not exists arrived_at timestamptz;
alter table wash_orders add column if not exists wash_started_at timestamptz;
alter table wash_orders add column if not exists washed_at timestamptz;
alter table wash_orders add column if not exists issued_at timestamptz;
update wash_orders set arrived_at=created_at where arrived_at is null and status <> 'booked';
update wash_orders set issued_at=updated_at where issued_at is null and status='closed';

alter table telegram_booking_sessions add column if not exists requested_date date;

-- Staff requests to permanently remove completed archive orders; admin review is required.
create table if not exists archive_delete_requests (
 id uuid primary key default gen_random_uuid(),
 order_id uuid references wash_orders(id) on delete set null,
 plate text not null,
 reason text not null,
 requested_by text not null default 'staff',
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by text
);
create index if not exists archive_delete_requests_pending_idx on archive_delete_requests(status,created_at desc);
alter table archive_delete_requests enable row level security;

alter table wash_orders add column if not exists stage_history jsonb not null default '[]'::jsonb;

alter table wash_orders add column if not exists drying_started_at timestamptz;

-- Seed a readable timeline for historical orders on first migration.
update wash_orders o set stage_history=coalesce((select jsonb_agg(jsonb_build_object('status',e.status,'at',e.event_at) order by e.event_at) from (
 select 'booked'::text as status,scheduled_for as event_at where o.scheduled_for is not null
 union all select 'arrived',arrived_at where o.arrived_at is not null
 union all select 'washing',wash_started_at where o.wash_started_at is not null
 union all select 'drying',drying_started_at where o.drying_started_at is not null
 union all select 'ready',washed_at where o.washed_at is not null
 union all select 'closed',issued_at where o.issued_at is not null
) e),'[]'::jsonb) where stage_history='[]'::jsonb;
