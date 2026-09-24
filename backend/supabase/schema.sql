-- ============================================================================
-- NER Smart Logistics & Accessibility Intelligence Platform
-- Supabase (Postgres) schema, indexes, and Row Level Security policies
-- Run this once in the Supabase SQL editor (or via `supabase db push`) on a
-- fresh project. Safe to re-run: guarded with IF NOT EXISTS / DROP POLICY.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- ENUM TYPES
-- ----------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('primary', 'secondary', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type shipment_priority as enum ('normal', 'high', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type shipment_status as enum (
    'assigned', 'ready_to_start', 'in_transit', 'delayed',
    'rerouting', 'arrived', 'delivered', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type vehicle_status as enum ('available', 'assigned', 'in_transit', 'maintenance');
exception when duplicate_object then null; end $$;

do $$ begin
  create type connectivity_status as enum ('online', 'offline', 'syncing', 'synced');
exception when duplicate_object then null; end $$;

do $$ begin
  create type alert_severity as enum ('low', 'moderate', 'high', 'very_high', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type road_status as enum ('open', 'at_risk', 'blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type data_source as enum ('real', 'demo');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- ORGANIZATIONS  (Primary Users belong to one organization)
-- ----------------------------------------------------------------------------
create table if not exists organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- PROFILES  (extends auth.users with app-specific role/org data)
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  full_name text not null,
  phone text,
  organization_id uuid references organizations(id) on delete set null,
  primary_user_id uuid references profiles(id) on delete set null, -- for secondary users: which primary user manages them
  status user_status not null default 'active',
  created_at timestamptz not null default now(),
  photo_url text
);

create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_profiles_org on profiles(organization_id);
create index if not exists idx_profiles_primary_user on profiles(primary_user_id);

-- ----------------------------------------------------------------------------
-- VEHICLES
-- ----------------------------------------------------------------------------
create table if not exists vehicles (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  registration_no text not null,
  vehicle_type text not null default 'truck',
  capacity_kg numeric,
  status vehicle_status not null default 'available',
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicles_org on vehicles(organization_id);
create index if not exists idx_vehicles_status on vehicles(status);

-- ----------------------------------------------------------------------------
-- SHIPMENTS
-- ----------------------------------------------------------------------------
create table if not exists shipments (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by uuid not null references profiles(id),
  driver_id uuid references profiles(id),
  vehicle_id uuid references vehicles(id),

  source_name text not null,
  source_lat double precision not null,
  source_lng double precision not null,
  destination_name text not null,
  destination_lat double precision not null,
  destination_lng double precision not null,

  goods_type text not null,
  priority shipment_priority not null default 'normal',
  status shipment_status not null default 'assigned',

  route_json jsonb,              -- recommended route (encoded polyline / legs) from maps service
  alternate_route_json jsonb,    -- alternate route candidate
  distance_km numeric,

  risk_score int not null default 0 check (risk_score between 0 and 100),
  risk_level text,
  risk_explanation text,

  eta_original timestamptz,
  eta_current timestamptz,
  delay_minutes int not null default 0,
  delay_reason text,

  connectivity connectivity_status not null default 'online',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  delivered_at timestamptz
);

create index if not exists idx_shipments_org on shipments(organization_id);
create index if not exists idx_shipments_driver on shipments(driver_id);
create index if not exists idx_shipments_status on shipments(status);
create index if not exists idx_shipments_priority on shipments(priority);

-- ----------------------------------------------------------------------------
-- GPS LOCATIONS  (append-only ping log per shipment/driver)
-- ----------------------------------------------------------------------------
create table if not exists gps_locations (
  id uuid primary key default uuid_generate_v4(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  driver_id uuid not null references profiles(id),
  lat double precision not null,
  lng double precision not null,
  speed_kmh numeric,
  heading numeric,
  accuracy_m numeric,
  source data_source not null default 'real',
  recorded_at timestamptz not null default now(),
  synced_at timestamptz not null default now() -- when it hit the server (for offline-queued points, differs from recorded_at)
);

create index if not exists idx_gps_shipment on gps_locations(shipment_id, recorded_at desc);
create index if not exists idx_gps_driver on gps_locations(driver_id, recorded_at desc);

-- ----------------------------------------------------------------------------
-- WEATHER CONDITIONS  (system-sourced, never manually entered by end users)
-- ----------------------------------------------------------------------------
create table if not exists weather_conditions (
  id uuid primary key default uuid_generate_v4(),
  region text not null,
  lat double precision not null,
  lng double precision not null,
  condition text not null,          -- e.g. clear, rain, heavy_rain, storm
  rainfall_mm numeric default 0,
  temperature_c numeric,
  source data_source not null default 'demo',
  recorded_at timestamptz not null default now()
);

create index if not exists idx_weather_recorded on weather_conditions(recorded_at desc);

-- ----------------------------------------------------------------------------
-- ROAD CONDITIONS
-- ----------------------------------------------------------------------------
create table if not exists road_conditions (
  id uuid primary key default uuid_generate_v4(),
  road_segment text not null,
  lat double precision not null,
  lng double precision not null,
  status road_status not null default 'open',
  reason text,
  source data_source not null default 'demo',
  recorded_at timestamptz not null default now()
);

create index if not exists idx_road_status on road_conditions(status);

-- ----------------------------------------------------------------------------
-- INCIDENTS  (landslide, flood, accident, disaster reports)
-- ----------------------------------------------------------------------------
create table if not exists incidents (
  id uuid primary key default uuid_generate_v4(),
  type text not null,               -- landslide, flood, accident, road_block, other
  description text,
  lat double precision not null,
  lng double precision not null,
  severity alert_severity not null default 'moderate',
  source data_source not null default 'demo',
  status text not null default 'active', -- active, resolved
  reported_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_incidents_status on incidents(status);

-- ----------------------------------------------------------------------------
-- ALERTS
-- ----------------------------------------------------------------------------
create table if not exists alerts (
  id uuid primary key default uuid_generate_v4(),
  shipment_id uuid references shipments(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  type text not null,               -- road_blocked, high_risk, rainfall, flood, landslide, deviation, delay, critical_delay, inaccessible
  what text not null,
  where_text text not null,
  severity alert_severity not null default 'moderate',
  recommended_action text not null,
  acknowledged boolean not null default false,
  acknowledged_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_alerts_shipment on alerts(shipment_id);
create index if not exists idx_alerts_org on alerts(organization_id);
create index if not exists idx_alerts_ack on alerts(acknowledged);

-- ----------------------------------------------------------------------------
-- RISK SCORE HISTORY  (time series so the dashboard can chart risk over time)
-- ----------------------------------------------------------------------------
create table if not exists risk_score_history (
  id uuid primary key default uuid_generate_v4(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  score int not null check (score between 0 and 100),
  factors_json jsonb,
  explanation text,
  created_at timestamptz not null default now()
);

create index if not exists idx_risk_history_shipment on risk_score_history(shipment_id, created_at desc);

-- ----------------------------------------------------------------------------
-- updated_at trigger for shipments
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_shipments_updated_at on shipments;
create trigger trg_shipments_updated_at
  before update on shipments
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user signs up.
-- Expects role / full_name / organization_name (for primary signups) or
-- primary_user_id (for secondary/driver signups) in raw_user_meta_data,
-- passed from the client at signUp() time. See src/lib/authService.js
-- ----------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger as $$
declare
  v_org_id uuid;
  v_role user_role;
begin
  v_role := coalesce((new.raw_user_meta_data->>'role')::user_role, 'primary');

  if v_role = 'primary' then
    insert into organizations (name, created_by)
    values (coalesce(new.raw_user_meta_data->>'organization_name', 'Unnamed Organization'), new.id)
    returning id into v_org_id;
  elsif v_role = 'secondary' then
    select organization_id into v_org_id
    from profiles where id = (new.raw_user_meta_data->>'primary_user_id')::uuid;
  end if; -- admin: no organization

  insert into profiles (id, role, full_name, phone, organization_id, primary_user_id)
  values (
    new.id,
    v_role,
    coalesce(new.raw_user_meta_data->>'full_name', 'Unnamed User'),
    new.raw_user_meta_data->>'phone',
    v_org_id,
    nullif(new.raw_user_meta_data->>'primary_user_id', '')::uuid
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- Public lookup used ONLY by the driver signup form: resolves a transport
-- manager's email to their profile id + display name so a driver can attach
-- themselves to the right organization at signup, without exposing the full
-- profiles table to anonymous users.
-- ----------------------------------------------------------------------------
create or replace function get_primary_user_by_email(p_email text)
returns table(id uuid, full_name text, organization_name text) as $$
  select p.id, p.full_name, o.name
  from profiles p
  join auth.users u on u.id = p.id
  left join organizations o on o.id = p.organization_id
  where u.email = p_email and p.role = 'primary' and p.status = 'active';
$$ language sql security definer stable;

grant execute on function get_primary_user_by_email(text) to anon, authenticated;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table vehicles enable row level security;
alter table shipments enable row level security;
alter table gps_locations enable row level security;
alter table weather_conditions enable row level security;
alter table road_conditions enable row level security;
alter table incidents enable row level security;
alter table alerts enable row level security;
alter table risk_score_history enable row level security;

-- Helper: current user's role / org, read from profiles without recursive RLS
-- (security definer function bypasses RLS on the lookup itself)
create or replace function my_role() returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable;

create or replace function my_org() returns uuid as $$
  select organization_id from profiles where id = auth.uid();
$$ language sql security definer stable;

-- ---- profiles ----
drop policy if exists "profiles_select" on profiles;
create policy "profiles_select" on profiles for select
  using (
    id = auth.uid()
    or my_role() = 'admin'
    or (my_role() = 'primary' and organization_id = my_org())
    or (my_role() = 'secondary' and primary_user_id = auth.uid())
  );

drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self" on profiles for update
  using (id = auth.uid() or my_role() = 'admin');

drop policy if exists "profiles_insert_admin" on profiles;
create policy "profiles_insert_admin" on profiles for insert
  with check (true); -- inserts happen via handle_new_user() trigger (security definer)

-- ---- organizations ----
drop policy if exists "orgs_select" on organizations;
create policy "orgs_select" on organizations for select
  using (my_role() = 'admin' or id = my_org());

-- ---- vehicles ----
drop policy if exists "vehicles_select" on vehicles;
create policy "vehicles_select" on vehicles for select
  using (my_role() = 'admin' or organization_id = my_org());

drop policy if exists "vehicles_write" on vehicles;
create policy "vehicles_write" on vehicles for all
  using (my_role() = 'admin' or (my_role() = 'primary' and organization_id = my_org()))
  with check (my_role() = 'admin' or (my_role() = 'primary' and organization_id = my_org()));

-- ---- shipments ----
drop policy if exists "shipments_select" on shipments;
create policy "shipments_select" on shipments for select
  using (
    my_role() = 'admin'
    or (my_role() = 'primary' and organization_id = my_org())
    or (my_role() = 'secondary' and driver_id = auth.uid())
  );

drop policy if exists "shipments_write_primary" on shipments;
create policy "shipments_write_primary" on shipments for insert
  with check (my_role() = 'primary' and organization_id = my_org());

drop policy if exists "shipments_update" on shipments;
create policy "shipments_update" on shipments for update
  using (
    my_role() = 'admin'
    or (my_role() = 'primary' and organization_id = my_org())
    or (my_role() = 'secondary' and driver_id = auth.uid())
  );

-- ---- gps_locations ----
drop policy if exists "gps_select" on gps_locations;
create policy "gps_select" on gps_locations for select
  using (
    my_role() = 'admin'
    or driver_id = auth.uid()
    or exists (
      select 1 from shipments s
      where s.id = gps_locations.shipment_id and s.organization_id = my_org()
    )
  );

drop policy if exists "gps_insert" on gps_locations;
create policy "gps_insert" on gps_locations for insert
  with check (driver_id = auth.uid());

-- ---- weather / road / incidents: readable by any authenticated user ----
drop policy if exists "weather_select" on weather_conditions;
create policy "weather_select" on weather_conditions for select using (auth.role() = 'authenticated');
drop policy if exists "weather_write" on weather_conditions;
create policy "weather_write" on weather_conditions for insert with check (my_role() = 'admin');

drop policy if exists "road_select" on road_conditions;
create policy "road_select" on road_conditions for select using (auth.role() = 'authenticated');
drop policy if exists "road_write" on road_conditions;
create policy "road_write" on road_conditions for insert with check (my_role() = 'admin');

drop policy if exists "incidents_select" on incidents;
create policy "incidents_select" on incidents for select using (auth.role() = 'authenticated');
drop policy if exists "incidents_write" on incidents;
create policy "incidents_write" on incidents for insert with check (auth.role() = 'authenticated');

-- ---- alerts ----
drop policy if exists "alerts_select" on alerts;
create policy "alerts_select" on alerts for select
  using (
    my_role() = 'admin'
    or organization_id = my_org()
    or exists (select 1 from shipments s where s.id = alerts.shipment_id and s.driver_id = auth.uid())
  );

drop policy if exists "alerts_insert" on alerts;
create policy "alerts_insert" on alerts for insert with check (auth.role() = 'authenticated');

drop policy if exists "alerts_update" on alerts;
create policy "alerts_update" on alerts for update
  using (my_role() = 'admin' or organization_id = my_org());

-- ---- risk_score_history ----
drop policy if exists "risk_select" on risk_score_history;
create policy "risk_select" on risk_score_history for select
  using (
    my_role() = 'admin'
    or exists (
      select 1 from shipments s
      where s.id = risk_score_history.shipment_id
      and (s.organization_id = my_org() or s.driver_id = auth.uid())
    )
  );

drop policy if exists "risk_insert" on risk_score_history;
create policy "risk_insert" on risk_score_history for insert with check (auth.role() = 'authenticated');

-- ============================================================================
-- REALTIME: expose relevant tables via Supabase Realtime (Postgres changes)
-- ============================================================================
alter publication supabase_realtime add table shipments;
alter publication supabase_realtime add table gps_locations;
alter publication supabase_realtime add table alerts;
alter publication supabase_realtime add table incidents;
alter publication supabase_realtime add table road_conditions;
alter publication supabase_realtime add table risk_score_history;

-- ============================================================================
-- SEED: create the first Admin manually after signing up via the app, then run:
--   update profiles set role = 'admin', organization_id = null where id = '<uuid>';
-- (Admins are not self-service signups — see README "Creating the first Admin")
-- ============================================================================

-- ============================================================================
-- ADDITIONS: multi-language driver preference, image-analyzed hazard reports,
-- admin-marked danger zones, and call logs (route-change driver notification).
-- Safe to re-run.
-- ============================================================================

-- ---- Driver language preference (English / Hindi / Tamil) ----
alter table profiles add column if not exists preferred_language text not null default 'en'
  check (preferred_language in ('en', 'hi', 'ta'));

-- ---- Extend incidents to double as hazard reports + admin danger zones ----
-- status now also takes: 'pending_review' (freshly reported, awaiting admin),
-- 'active' (confirmed danger zone or ongoing incident), 'dismissed', 'resolved'.
alter table incidents add column if not exists image_url text;
alter table incidents add column if not exists ai_analysis jsonb;
alter table incidents add column if not exists is_danger_zone boolean not null default false;
alter table incidents add column if not exists radius_km numeric not null default 5;
alter table incidents add column if not exists reviewed_by uuid references profiles(id);
alter table incidents add column if not exists reviewed_at timestamptz;

alter table incidents add column if not exists voice_url text;

create index if not exists idx_incidents_danger_zone on incidents(is_danger_zone) where is_danger_zone = true;

-- ---- Call logs (driver notification calls triggered by route changes) ----
create table if not exists call_logs (
  id uuid primary key default uuid_generate_v4(),
  shipment_id uuid references shipments(id) on delete cascade,
  driver_id uuid references profiles(id),
  initiated_by uuid references profiles(id),
  reason text not null,             -- e.g. 'route_changed', 'danger_zone_marked', 'manual'
  message text not null,
  language text not null default 'en',
  status text not null default 'simulated', -- 'simulated' (demo) | 'placed' | 'failed'
  source data_source not null default 'demo',
  created_at timestamptz not null default now()
);

create index if not exists idx_call_logs_shipment on call_logs(shipment_id);
create index if not exists idx_call_logs_driver on call_logs(driver_id);

alter table call_logs enable row level security;

drop policy if exists "call_logs_select" on call_logs;
create policy "call_logs_select" on call_logs for select
  using (
    my_role() = 'admin'
    or driver_id = auth.uid()
    or exists (select 1 from shipments s where s.id = call_logs.shipment_id and s.organization_id = my_org())
  );

drop policy if exists "call_logs_insert" on call_logs;
create policy "call_logs_insert" on call_logs for insert with check (auth.role() = 'authenticated');

alter publication supabase_realtime add table call_logs;

-- ---- Allow admins to update incidents (review / mark danger zone) ----
drop policy if exists "incidents_update_admin" on incidents;
create policy "incidents_update_admin" on incidents for update
  using (my_role() = 'admin')
  with check (my_role() = 'admin');

-- ---- Storage bucket for hazard report images and audio (public read, authenticated write) ----
insert into storage.buckets (id, name, public)
values ('hazard-images', 'hazard-images', true), ('hazard-audio', 'hazard-audio', true)
on conflict (id) do nothing;

drop policy if exists "hazard_images_read" on storage.objects;
create policy "hazard_images_read" on storage.objects for select
  using (bucket_id in ('hazard-images', 'hazard-audio'));

drop policy if exists "hazard_images_insert" on storage.objects;
create policy "hazard_images_insert" on storage.objects for insert
  with check (bucket_id in ('hazard-images', 'hazard-audio') and auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- NAVIGATION_USERS (SQL Table for Public / Guest Navigation Users)
-- ----------------------------------------------------------------------------
create table if not exists navigation_users (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text not null,
  last_known_lat double precision,
  last_known_lng double precision,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_navigation_users_phone on navigation_users(phone);
create index if not exists idx_navigation_users_active on navigation_users(last_active_at);

alter table navigation_users enable row level security;

drop policy if exists "navigation_users_public_select" on navigation_users;
create policy "navigation_users_public_select" on navigation_users for select using (true);

drop policy if exists "navigation_users_public_insert" on navigation_users;
create policy "navigation_users_public_insert" on navigation_users for insert with check (true);

drop policy if exists "navigation_users_public_update" on navigation_users;
create policy "navigation_users_public_update" on navigation_users for update using (true);

-- ----------------------------------------------------------------------------
-- SOS_ALERTS (Offline & Realtime SOS Emergency System)
-- ----------------------------------------------------------------------------
create table if not exists sos_alerts (
  id uuid primary key default uuid_generate_v4(),
  driver_id uuid references profiles(id) on delete set null,
  driver_name text not null,
  driver_phone text,
  vehicle_id uuid references vehicles(id) on delete set null,
  vehicle_no text,
  company_id uuid references organizations(id) on delete set null,
  company_name text,
  shipment_id uuid references shipments(id) on delete set null,
  route_id text,

  emergency_type text not null default 'Other Emergency',
  message text,

  latitude double precision,
  longitude double precision,
  location_accuracy numeric,
  location_timestamp timestamptz,

  network_status text not null default 'online',
  communication_provider text not null default 'internet',

  status text not null default 'ACTIVE',

  created_at timestamptz not null default now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  resolved_at timestamptz,

  acknowledged_by uuid references profiles(id),
  resolved_by uuid references profiles(id),
  resolution_notes text,

  retry_count int not null default 0,
  external_message_id text
);

create index if not exists idx_sos_alerts_status on sos_alerts(status);
create index if not exists idx_sos_alerts_driver on sos_alerts(driver_id);
create index if not exists idx_sos_alerts_created on sos_alerts(created_at desc);

alter table sos_alerts enable row level security;

drop policy if exists "sos_alerts_select" on sos_alerts;
create policy "sos_alerts_select" on sos_alerts for select using (true);

drop policy if exists "sos_alerts_insert" on sos_alerts;
create policy "sos_alerts_insert" on sos_alerts for insert with check (true);

drop policy if exists "sos_alerts_update" on sos_alerts;
create policy "sos_alerts_update" on sos_alerts for update using (true);

alter publication supabase_realtime add table sos_alerts;

-- ----------------------------------------------------------------------------
-- DRIVER_CONNECTIVITY_ALERTS (Inactivity & Disaster Detection System)
-- ----------------------------------------------------------------------------
create table if not exists driver_connectivity_alerts (
  id uuid primary key default uuid_generate_v4(),
  driver_id uuid references profiles(id) on delete set null,
  driver_name text not null,
  driver_phone text,
  vehicle_id uuid references vehicles(id) on delete set null,
  vehicle_no text,
  company_id uuid references organizations(id) on delete set null,
  company_name text,
  shipment_id uuid references shipments(id) on delete set null,
  route_id text,

  last_ping_at timestamptz not null,
  offline_started_at timestamptz not null,
  offline_duration_minutes numeric not null default 0,

  latitude double precision,
  longitude double precision,
  location_accuracy numeric,
  last_speed_kmh numeric,

  weather_risk numeric default 0,
  hazard_risk numeric default 0,
  danger_zone_risk numeric default 0,
  road_risk numeric default 0,
  inactivity_risk numeric default 0,
  final_risk_score int not null default 0,

  alert_level text not null default 'COMMUNICATION_LOST',
  status text not null default 'COMMUNICATION_LOST',

  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  acknowledged_by uuid references profiles(id),
  resolved_by uuid references profiles(id),
  resolution_notes text
);

create index if not exists idx_driver_conn_alerts_status on driver_connectivity_alerts(status);
create index if not exists idx_driver_conn_alerts_driver on driver_connectivity_alerts(driver_id);
create index if not exists idx_driver_conn_alerts_created on driver_connectivity_alerts(created_at desc);

alter table driver_connectivity_alerts enable row level security;

drop policy if exists "driver_conn_alerts_select" on driver_connectivity_alerts;
create policy "driver_conn_alerts_select" on driver_connectivity_alerts for select using (true);

drop policy if exists "driver_conn_alerts_insert" on driver_connectivity_alerts;
create policy "driver_conn_alerts_insert" on driver_connectivity_alerts for insert with check (true);

drop policy if exists "driver_conn_alerts_update" on driver_connectivity_alerts;
create policy "driver_conn_alerts_update" on driver_connectivity_alerts for update using (true);

alter publication supabase_realtime add table driver_connectivity_alerts;

