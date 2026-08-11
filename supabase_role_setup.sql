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
--        - Anyone signed in can READ the workspace (Dashboard, etc.)
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
--      the row can change through it, no matter what's passed in.
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

-- Read: any signed-in account (trader or operator) can view the
-- workspace — this is what powers the Dashboard and read-only pages.
drop policy if exists "workspace read all authenticated" on public.abps_workspace;
create policy "workspace read all authenticated"
  on public.abps_workspace
  for select
  to authenticated
  using (true);

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
-- current_user_role() = NULL, which fails every `= 'operator'` check
-- above — so an un-role-assigned account can READ but cannot WRITE
-- anything. Existing team members who already use the shared login
-- need an 'operator' row added (see step 5) or their writes will stop
-- working the moment you run this file.


-- ── 4. The ONLY write path available to trader accounts ──────────────
-- SECURITY DEFINER means this function runs with the privileges of
-- whoever owns it (you, as project owner) rather than the calling
-- trader — so it can update abps_workspace even though the RLS
-- policies above block traders from the table directly. But the
-- function's own body is the only thing deciding what gets written,
-- and it only ever touches the `vessels` key — nothing else.
create or replace function public.trader_update_vessels(new_vessels jsonb, new_version bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  row_found   boolean;
begin
  select role into caller_role from public.user_roles where user_id = auth.uid();

  if caller_role is null or caller_role not in ('trader', 'operator') then
    raise exception 'Not authorized: this account has no assigned role';
  end if;

  update public.abps_workspace
  set payload    = jsonb_set(
                      jsonb_set(payload, '{state,vessels}', coalesce(new_vessels, '[]'::jsonb), true),
                      '{version}', to_jsonb(new_version), true
                    ),
      version    = new_version,
      updated_at = now()
  where id = 'main';

  get diagnostics row_found = row_count;
  if not row_found then
    raise exception 'Workspace row not found — ask an operator to save at least once first';
  end if;
end;
$$;

-- Only signed-in accounts may call it at all; the role check inside
-- the function is what actually gates who succeeds.
revoke all on function public.trader_update_vessels(jsonb, bigint) from public;
grant execute on function public.trader_update_vessels(jsonb, bigint) to authenticated;


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
