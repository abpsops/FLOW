-- ═══════════════════════════════════════════════════════════════════
-- FLOW — Live vessel positions (AIS) — database setup
-- ───────────────────────────────────────────────────────────────────
-- Run this in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste all of this → Run).
-- Run supabase_role_setup.sql first (it creates current_user_role()).
--
-- Safe to re-run: everything uses IF NOT EXISTS / CREATE OR REPLACE /
-- drop-then-create, so running it twice changes nothing.
--
-- ALREADY RAN AN EARLIER VERSION? Run this file again: the only change is
-- one new column, ais_status.last_cron_at (added with ADD COLUMN IF NOT
-- EXISTS — nothing else is touched, no data is lost).
--
-- WHAT THIS DOES
--   1. ais_positions — one row per ship (MMSI) with its latest AIS
--      position + static data. Written ONLY by the ais-poll Edge
--      Function (service role); the app just reads it.
--   2. ais_status — one row (id = 1) describing the last collection run
--      (when, ok?, how many vessels tracked/found, error text).
--   3. Row Level Security: any signed-in account WITH A ROLE (operator
--      or trader) may READ both tables; nobody can write them from the
--      app (there are no insert/update/delete policies — the Edge
--      Function uses the service role key, which bypasses RLS).
--   4. Adds both tables to Supabase Realtime, so open apps update as
--      soon as a run finishes.
--   5. (Optional, commented out) the pg_cron + pg_net way to run the
--      function every 10 minutes. The simpler way is the Dashboard:
--      Integrations → Cron → Create job → type "Supabase Edge Function"
--      (see README → "Live vessel positions (AIS)").
--
-- JWT VERIFICATION: the ais-poll function is deployed with JWT
-- verification OFF ("Enforce JWT verification" / "Verify JWT" switched
-- off, or `supabase functions deploy ais-poll --no-verify-jwt`). It
-- checks every call itself: the scheduler sends the x-cron-secret
-- header, the app sends the signed-in operator's own session token.
-- So the scheduled call below needs ONLY the x-cron-secret header — no
-- Authorization / anon key.
-- ═══════════════════════════════════════════════════════════════════


-- ── 1. Latest position per ship ──────────────────────────────────────
create table if not exists public.ais_positions (
  mmsi          text primary key,               -- 9-digit Maritime Mobile Service Identity
  imo           text,                           -- 7-digit IMO number (from static data)
  name          text,                           -- name as broadcast on AIS
  lat           double precision,
  lon           double precision,
  sog           numeric,                        -- speed over ground, knots
  cog           numeric,                        -- course over ground, degrees
  heading       integer,                        -- true heading, degrees
  nav_status    integer,                        -- AIS navigational status (1 = at anchor, 5 = moored …)
  destination   text,                           -- as typed by the ship's crew
  ais_eta       text,                           -- as broadcast, e.g. '10-16 14:00' (month-day UTC, no year)
  draught       numeric,                        -- metres
  matched_by    text check (matched_by in ('imo', 'mmsi', 'name')),
  position_time timestamptz,                    -- AIS time of the position (MetaData.time_utc)
  static_time   timestamptz,                    -- AIS time of the static data
  updated_at    timestamptz not null default now()
);
-- Columns added after a first version of this file (no-ops on a fresh install).
alter table public.ais_positions add column if not exists draught numeric;
alter table public.ais_positions add column if not exists static_time timestamptz;

create index if not exists ais_positions_imo_idx on public.ais_positions (imo);
create index if not exists ais_positions_updated_idx on public.ais_positions (updated_at);


-- ── 2. Last run summary (single row, id = 1) ────────────────────────
create table if not exists public.ais_status (
  id            integer primary key default 1 check (id = 1),
  last_run_at   timestamptz,                    -- end of the last run (ok or not)
  last_ok_at    timestamptz,                    -- end of the last SUCCESSFUL run
  running_since timestamptz,                    -- set while a run is collecting (lock, stale after 3 min)
  last_cron_at  timestamptz,                    -- when the last SCHEDULED call (x-cron-secret) arrived, run or skipped — the app warns operators when it gets old
  ok            boolean,
  tracked       integer,                        -- nominated vessels being tracked
  found         integer,                        -- of those, seen with a position in the last run
  messages      integer,                        -- AIS messages received in the last run
  error         text,
  duration_ms   integer
);
alter table public.ais_status add column if not exists last_ok_at timestamptz;
alter table public.ais_status add column if not exists running_since timestamptz;
-- Added later: re-running this file adds it to an existing install (the function
-- and the app also work without it — they just can't tell scheduled runs apart).
alter table public.ais_status add column if not exists last_cron_at timestamptz;
-- Coverage check: what aisstream delivered in the last run, and what was searched for.
alter table public.ais_status add column if not exists heard_count integer;  -- different ships heard in the last run
alter table public.ais_status add column if not exists heard jsonb;          -- details of the first 25 ships heard
alter table public.ais_status add column if not exists searched jsonb;       -- nominated vessels the run looked for (name / IMO / MMSI)

insert into public.ais_status (id) values (1) on conflict (id) do nothing;


-- ── 3. Row Level Security: read for role holders, no client writes ──
alter table public.ais_positions enable row level security;
alter table public.ais_status    enable row level security;

drop policy if exists "ais positions read role holders" on public.ais_positions;
create policy "ais positions read role holders"
  on public.ais_positions
  for select
  to authenticated
  using (public.current_user_role() is not null);

drop policy if exists "ais status read role holders" on public.ais_status;
create policy "ais status read role holders"
  on public.ais_status
  for select
  to authenticated
  using (public.current_user_role() is not null);

-- No insert/update/delete policies on purpose: with RLS on, that means
-- no app account (operator or trader) can change these tables. Belt and
-- braces: take the table privileges away too.
revoke insert, update, delete, truncate on public.ais_positions from anon, authenticated;
revoke insert, update, delete, truncate on public.ais_status    from anon, authenticated;
revoke all on public.ais_positions from anon;
revoke all on public.ais_status    from anon;
grant select on public.ais_positions to authenticated;
grant select on public.ais_status    to authenticated;
grant all on public.ais_positions to service_role;
grant all on public.ais_status    to service_role;


-- ── 4. Realtime: open apps refresh as soon as a run finishes ─────────
-- Realtime applies the SELECT policies above, so only role holders get
-- the events. If you skip this, the app still refreshes every 2 minutes.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ais_positions') then
    alter publication supabase_realtime add table public.ais_positions;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ais_status') then
    alter publication supabase_realtime add table public.ais_status;
  end if;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 5. SCHEDULE — run the function every 10 minutes
-- ═══════════════════════════════════════════════════════════════════
-- RECOMMENDED: Dashboard → Integrations → Cron → (enable it if asked) →
--   Create job → Name: ais-poll-every-10-min → Schedule: */10 * * * *
--   → Type: "Supabase Edge Function" → Method: POST → Function: ais-poll
--   → HTTP header: x-cron-secret = <the same value as the AIS_CRON_SECRET
--   secret> → Body: {} → Save.
--   (No Authorization header is needed: JWT verification is OFF for this
--   function — see the note at the top.)
--
-- ALTERNATIVE (SQL): first enable the pg_cron and pg_net extensions
-- (Dashboard → Database → Extensions → search "pg_cron" → enable, then
-- "pg_net" → enable). Then replace the two <…> placeholders and run the
-- block below (remove the leading "-- " from each line).
-- <PROJECT_REF> is the id in your project URL
--   (https://<PROJECT_REF>.supabase.co — FLOW's is siqntfkpdstikrqffmep).
-- The function answers at once (202) and keeps collecting in the
-- background, so a short timeout is fine.
--
-- select cron.schedule(
--   'ais-poll-every-10-min',
--   '*/10 * * * *',
--   $job$
--   select net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/ais-poll',
--     headers := jsonb_build_object(
--                  'Content-Type', 'application/json',
--                  'x-cron-secret', '<AIS_CRON_SECRET>'),
--     body    := '{}'::jsonb,
--     timeout_milliseconds := 10000
--   );
--   $job$
-- );
--
-- Check it:        select * from cron.job;
-- See the runs:    select * from cron.job_run_details order by start_time desc limit 10;
--                  ("succeeded" there only means the HTTP request was QUEUED by pg_net)
-- Did the call work? select created, status_code, error_msg, left(content::text, 200)
--                  from net._http_response order by created desc limit 5;
--                  → 202 = a run started; 200 = skipped because a run is still going or
--                    finished < 2 min ago (normal right after Refresh now in the app);
--                    401 = wrong/missing x-cron-secret, or JWT verification still ON.
-- See the result:  select last_cron_at, last_run_at, ok, found, tracked, error from public.ais_status;
--                  (last_cron_at moves on every scheduled call — every 10 minutes — even
--                   when that call was skipped; last_run_at ~1½ min later when it ran)
-- Stop it:         select cron.unschedule('ais-poll-every-10-min');
--
-- REMOVE THE FEATURE COMPLETELY: delete the cron job and the ais-poll
-- function, then run:
--   drop table if exists public.ais_positions, public.ais_status;
-- Operators then see "Live positions not set up yet" on the dashboard;
-- traders see nothing. (If you only stop the schedule, the app hides the
-- per-vessel positions after 24 h without an update and shows operators
-- "AIS feed not updating since …".)
-- ═══════════════════════════════════════════════════════════════════
