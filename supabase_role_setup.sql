-- ═══════════════════════════════════════════════════════════════════
-- FLOW — Trader / Operator role-based access control
-- ───────────────────────────────────────────────────────────────────
-- Run this ONCE in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste all of this → Run).
--
-- It is safe to re-run: every statement either uses IF NOT EXISTS /
-- CREATE OR REPLACE, or drops-then-recreates the same policy, so
-- running it twice won't error or duplicate anything.
--
-- WHAT THIS DOES
--   1. Creates a `user_roles` table — one row per Supabase Auth
--      account, saying whether that account is an 'operator' or a
--      'trader'.
--   2. Turns on Row Level Security (RLS) on both `user_roles` and
--      your existing `abps_workspace` table.
--   3. Adds policies so:
--        - Only signed-in accounts that HAVE A ROLE (operator or trader)
--          can READ the workspace (Dashboard, etc.)
--        - Only 'operator' accounts can write to it directly
--          (Push, barge edits, checklist, ROB, wipe/reset — anything
--          that goes through the normal save path or the admin
--          buttons).
--        - Trader accounts get NO direct write access to the table
--          at all — not even if someone opens dev tools and calls
--          the Supabase client directly.
--   4. Adds ONE function, trader_update_vessels(), which is the only
--      way a trader account can write anything. It only ever touches
--      the `vessels` key inside the workspace JSON — nothing else in
--      the row can change through it, no matter what's passed in —
--      and on vessels that already exist it keeps the operator-owned
--      planning fields (barge assignment, barge-refuelling slot).
--
-- ┌─────────────────────────────────────────────────────────────────┐
-- │ !! IMPORTANT — TURN OFF PUBLIC SIGN-UPS !!                       │
-- │ Supabase Dashboard → Authentication → Sign In / Providers        │
-- │ (older dashboards: Authentication → Settings) →                  │
-- │ "Allow new users to sign up"  →  OFF.                            │
-- │ Your project's anon key is visible in the app's page source, so  │
-- │ with sign-ups on, anyone could create an account. The read       │
-- │ policy below only admits accounts you've given a role, but you   │
-- │ should still not let strangers create logins at all.             │
-- └─────────────────────────────────────────────────────────────────┘
--
-- RE-RUN THIS FILE after updating the app: the app now sends an
-- expected_version with every trader save (so a trader can't silently
-- overwrite a colleague's newer change). Until you re-run it, the app
-- falls back to the old function automatically — nothing breaks, you
-- just don't get that protection for trader saves.
-- ═══════════════════════════════════════════════════════════════════


-- ── 1. Role table ────────────────────────────────────────────────────
create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('operator', 'trader')),
  email      text,                          -- just for your own reference in the dashboard
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

-- Every signed-in user can read ONLY their own role row.
-- (They cannot see anyone else's role, and cannot write to this table
-- at all — roles are only ever set by you, below, as the project owner.)
drop policy if exists "read own role" on public.user_roles;
create policy "read own role"
  on public.user_roles
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policies are created for `authenticated` on
-- purpose — that means no logged-in user (trader or operator) can
-- change ANY role, including their own, through the app. You manage
-- roles yourself by running INSERT/UPDATE statements in the SQL
-- Editor (examples at the bottom of this file), which runs as the
-- project owner and bypasses RLS.


-- ── 2. Helper: what role is the currently-signed-in account? ─────────
create or replace function public.current_user_role()
returns text
language sql
security invoker
stable
as $$
  select role from public.user_roles where user_id = auth.uid();
$$;


-- ── 3. Lock down abps_workspace with RLS ──────────────────────────────
alter table public.abps_workspace enable row level security;

-- Read: signed-in accounts that have a role (trader or operator) can
-- view the workspace — this is what powers the Dashboard and read-only
-- pages. It used to be `using (true)`: ANY signed-in account, so with
-- public sign-ups enabled a stranger could register and read everything.
-- (See the "TURN OFF PUBLIC SIGN-UPS" box at the top — do that too.)
drop policy if exists "workspace read all authenticated" on public.abps_workspace;
drop policy if exists "workspace read role holders" on public.abps_workspace;
create policy "workspace read role holders"
  on public.abps_workspace
  for select
  to authenticated
  using (public.current_user_role() is not null);

-- Write: only accounts with role = 'operator' may INSERT.
drop policy if exists "workspace insert operators only" on public.abps_workspace;
create policy "workspace insert operators only"
  on public.abps_workspace
  for insert
  to authenticated
  with check (public.current_user_role() = 'operator');

-- Write: only accounts with role = 'operator' may UPDATE.
drop policy if exists "workspace update operators only" on public.abps_workspace;
create policy "workspace update operators only"
  on public.abps_workspace
  for update
  to authenticated
  using (public.current_user_role() = 'operator')
  with check (public.current_user_role() = 'operator');

-- Delete: only accounts with role = 'operator' may DELETE
-- (this is what "Wipe Cloud" and "Clear All Data" ultimately call).
drop policy if exists "workspace delete operators only" on public.abps_workspace;
create policy "workspace delete operators only"
  on public.abps_workspace
  for delete
  to authenticated
  using (public.current_user_role() = 'operator');

-- IMPORTANT: an account with NO row in user_roles gets
-- current_user_role() = NULL, which fails every check above — so an
-- un-role-assigned account can neither READ nor WRITE anything. Existing team members who already use the shared login
-- need an 'operator' row added (see step 5) or their writes will stop
-- working the moment you run this file.


-- ── 4. The ONLY write path available to trader accounts ──────────────
-- SECURITY DEFINER means this function runs with the privileges of
-- whoever owns it (you, as project owner) rather than the calling
-- trader — so it can update abps_workspace even though the RLS
-- policies above block traders from the table directly. But the
-- function's own body is the only thing deciding what gets written:
--   • it only ever touches the `vessels` key (plus the version stamp);
--   • expected_version: when given and the row's version differs, it
--     raises 'version_conflict' instead of overwriting a newer save —
--     the app then pulls, merges the vessels and retries;
--   • vessels are matched by nomUid: a trader may add, edit and remove
--     nominations, but on a vessel that already exists the
--     operator-owned planning fields (bargeId, refuelChk, rfv, rfm,
--     rfvr, rfmr) are taken from the stored row, never the payload.

-- The old 2-argument version must be dropped, otherwise a 2-argument
-- call would be ambiguous between it and the new 3-argument one (whose
-- third argument defaults to NULL, so old app builds keep working).
drop function if exists public.trader_update_vessels(jsonb, bigint);

create or replace function public.trader_update_vessels(
  new_vessels      jsonb,
  new_version      bigint,
  expected_version bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role   text;
  cur_payload   jsonb;
  cur_version   bigint;
  old_vessels   jsonb;
  merged        jsonb;
  protected     text[] := array['bargeId', 'refuelChk', 'rfv', 'rfm', 'rfvr', 'rfmr'];
begin
  select role into caller_role from public.user_roles where user_id = auth.uid();

  if caller_role is null or caller_role not in ('trader', 'operator') then
    raise exception 'Not authorized: this account has no assigned role';
  end if;

  if new_vessels is null or jsonb_typeof(new_vessels) <> 'array' then
    raise exception 'new_vessels must be a JSON array';
  end if;

  -- Lock the row so the version check and the write are atomic.
  select payload, version::bigint into cur_payload, cur_version
    from public.abps_workspace
   where id = 'main'
   for update;

  if not found then
    raise exception 'Workspace row not found — ask an operator to save at least once first';
  end if;

  if cur_payload is null or jsonb_typeof(cur_payload -> 'state') is distinct from 'object' then
    -- jsonb_set() can't create a missing parent key, so this used to be a
    -- silent no-op that still reported success.
    raise exception 'Workspace payload has no state object — ask an operator to save once first';
  end if;

  if expected_version is not null and cur_version is distinct from expected_version then
    raise exception 'version_conflict';
  end if;

  old_vessels := coalesce(cur_payload -> 'state' -> 'vessels', '[]'::jsonb);
  if jsonb_typeof(old_vessels) <> 'array' then old_vessels := '[]'::jsonb; end if;

  -- Per vessel (in the trader's order): if a stored vessel has the same
  -- non-empty nomUid, keep its operator-owned fields; otherwise (a new
  -- nomination) take the trader's object as-is.
  select coalesce(jsonb_agg(
           case
             when ov.v is null then nv.v
             else (nv.v - protected) || coalesce(
                    (select jsonb_object_agg(e.key, e.value)
                       from jsonb_each(ov.v) e
                      where e.key = any(protected)),
                    '{}'::jsonb)
           end
           order by nv.ord), '[]'::jsonb)
    into merged
    from jsonb_array_elements(new_vessels) with ordinality as nv(v, ord)
    left join lateral (
      select o.v
        from jsonb_array_elements(old_vessels) with ordinality as o(v, ord)
       where jsonb_typeof(nv.v) = 'object'
         and coalesce(nv.v ->> 'nomUid', '') <> ''
         and o.v ->> 'nomUid' = nv.v ->> 'nomUid'
       order by o.ord
       limit 1
    ) ov on true;

  update public.abps_workspace
  set payload    = jsonb_set(
                      jsonb_set(jsonb_set(payload, '{state,vessels}', merged, true),
                                '{state,version}', to_jsonb(new_version), true),
                      '{version}', to_jsonb(new_version), true
                    ),
      version    = new_version,
      updated_at = now()
  where id = 'main';
end;
$$;

-- Only signed-in accounts may call it at all; the role check inside
-- the function is what actually gates who succeeds.
revoke all on function public.trader_update_vessels(jsonb, bigint, bigint) from public;
revoke all on function public.trader_update_vessels(jsonb, bigint, bigint) from anon;
grant execute on function public.trader_update_vessels(jsonb, bigint, bigint) to authenticated;

-- Make the API pick up the new function signature immediately.
notify pgrst, 'reload schema';


-- ── 4b. Nomination / cancellation email "already sent" logs ───────────
-- Each log is its own abps_workspace row (id 'nomination_email_log' or
-- 'nomination_cancel_email_log') whose payload is { "<nomUid>": {…} }.
-- The app records each sent email through this function instead of
-- upserting the whole row, because:
--   - it sets (or, with entry = null, removes) ONE key atomically, so two
--     devices sending at once can't overwrite each other's entries;
--   - traders send nomination emails too, but RLS (section 3) blocks
--     them from writing abps_workspace directly.
-- It can only touch those two rows and only one key per call — the main
-- workspace row ('main') is never reachable through it.
create or replace function public.log_nomination_email(log_id text, nom_uid text, entry jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  clearing    boolean := (entry is null or jsonb_typeof(entry) = 'null');
begin
  select role into caller_role from public.user_roles where user_id = auth.uid();
  if caller_role is null or caller_role not in ('trader', 'operator') then
    raise exception 'Not authorized: this account has no assigned role';
  end if;

  if log_id is null or log_id not in ('nomination_email_log', 'nomination_cancel_email_log') then
    raise exception 'Invalid log id';
  end if;
  if nom_uid is null or length(nom_uid) = 0 or length(nom_uid) > 200 then
    raise exception 'Invalid nomination id';
  end if;
  if not clearing and jsonb_typeof(entry) <> 'object' then
    raise exception 'Log entry must be a JSON object';
  end if;

  -- Same columns/shape the app's own upsert writes: version = epoch ms.
  insert into public.abps_workspace as w (id, payload, version, updated_at)
  values (
    log_id,
    case when clearing then '{}'::jsonb else jsonb_build_object(nom_uid, entry) end,
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    now()
  )
  on conflict (id) do update
  set payload = case
                  when clearing then
                    (case when jsonb_typeof(w.payload) = 'object' then w.payload else '{}'::jsonb end) - nom_uid
                  else
                    jsonb_set(case when jsonb_typeof(w.payload) = 'object' then w.payload else '{}'::jsonb end,
                              array[nom_uid], entry, true)
                end,
      version    = excluded.version,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.log_nomination_email(text, text, jsonb) from public, anon;
grant execute on function public.log_nomination_email(text, text, jsonb) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 5. SETTING UP PEOPLE — do this for every teammate
-- ═══════════════════════════════════════════════════════════════════
--
-- STEP A — Create their login (once per person):
--   Supabase Dashboard → Authentication → Users → Add User
--   → enter their email + a password → check "Auto Confirm User".
--
-- STEP B — Find their user_id:
--   Authentication → Users → click their row → copy the "UID" shown.
--
-- STEP C — Assign their role by running ONE of these in the SQL
-- Editor (replace the UID and email):
--
--   -- Make someone an OPERATOR (full access, same as today):
--   insert into public.user_roles (user_id, role, email)
--   values ('00000000-0000-0000-0000-000000000000', 'operator', 'sara@example.com')
--   on conflict (user_id) do update set role = excluded.role, email = excluded.email;
--
--   -- Make someone a TRADER (dashboard view + nominations only):
--   insert into public.user_roles (user_id, role, email)
--   values ('00000000-0000-0000-0000-000000000000', 'trader', 'ahmed@example.com')
--   on conflict (user_id) do update set role = excluded.role, email = excluded.email;
--
-- To change someone's role later, just re-run the same statement with
-- the new role — no app changes needed, takes effect next time they
-- load the page (or sign out/in).
--
-- To see everyone's current role:
--   select u.email as auth_email, r.role, r.created_at
--   from public.user_roles r
--   join auth.users u on u.id = r.user_id
--   order by r.role, auth_email;
--
-- ═══════════════════════════════════════════════════════════════════
-- 6. DO NOT FORGET — your existing shared login
-- ═══════════════════════════════════════════════════════════════════
-- The current shared login (abpsops@gmail.com) has NO row in
-- user_roles yet. After running this file, that account can still
-- READ everything but CANNOT SAVE anything until you give it an
-- 'operator' row (Step A/B/C above, using its existing user_id —
-- find it in Authentication → Users, it already exists, don't
-- recreate it). Do this before your team's next shift, or saves will
-- silently start failing for anyone still using the old shared login.
-- ═══════════════════════════════════════════════════════════════════
