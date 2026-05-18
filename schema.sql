-- =====================================================================
-- Cadence — Supabase schema
-- Run this in the Supabase SQL Editor (Project → SQL → New query)
-- =====================================================================

-- ---------------------------------------------------------------------
-- TABLE: entries (daily log)
-- ---------------------------------------------------------------------
create table public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  text        text not null,
  category    text not null check (category in ('apply','learn','network','interview','cook','other')),
  duration    int  not null default 0 check (duration >= 0),
  entry_date  date not null,
  created_at  timestamptz not null default now()
);

create index entries_user_date_idx on public.entries (user_id, entry_date desc);
create index entries_user_created_idx on public.entries (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- TABLE: applications (job pipeline)
-- ---------------------------------------------------------------------
create table public.applications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  company     text not null,
  role        text,
  status      text not null default 'applied'
              check (status in ('applied','phone','onsite','offer','rejected')),
  created_at  timestamptz not null default now()
);

create index applications_user_idx on public.applications (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- TABLE: prep_tasks (job search status checklist)
-- ---------------------------------------------------------------------
create table public.prep_tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  group_name  text not null
              check (group_name in ('foundation','skills','outreach','logistics')),
  text        text not null,
  done        boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index prep_tasks_user_group_idx on public.prep_tasks (user_id, group_name, sort_order);

-- =====================================================================
-- ROW LEVEL SECURITY
-- Without this, anyone with the anon key could read everyone's data.
-- =====================================================================

alter table public.entries       enable row level security;
alter table public.applications  enable row level security;
alter table public.prep_tasks    enable row level security;

-- entries: users see/modify only their own rows
create policy "entries: select own"  on public.entries
  for select using (auth.uid() = user_id);
create policy "entries: insert own"  on public.entries
  for insert with check (auth.uid() = user_id);
create policy "entries: update own"  on public.entries
  for update using (auth.uid() = user_id);
create policy "entries: delete own"  on public.entries
  for delete using (auth.uid() = user_id);

-- applications
create policy "apps: select own"  on public.applications
  for select using (auth.uid() = user_id);
create policy "apps: insert own"  on public.applications
  for insert with check (auth.uid() = user_id);
create policy "apps: update own"  on public.applications
  for update using (auth.uid() = user_id);
create policy "apps: delete own"  on public.applications
  for delete using (auth.uid() = user_id);

-- prep_tasks
create policy "prep: select own"  on public.prep_tasks
  for select using (auth.uid() = user_id);
create policy "prep: insert own"  on public.prep_tasks
  for insert with check (auth.uid() = user_id);
create policy "prep: update own"  on public.prep_tasks
  for update using (auth.uid() = user_id);
create policy "prep: delete own"  on public.prep_tasks
  for delete using (auth.uid() = user_id);

-- =====================================================================
-- SEED DEFAULT PREP TASKS ON SIGNUP
-- A trigger creates the starter checklist whenever a new auth user appears.
-- =====================================================================

create or replace function public.seed_prep_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.prep_tasks (user_id, group_name, text, sort_order) values
    (new.id, 'foundation', 'Update resume with latest role', 1),
    (new.id, 'foundation', 'Tailor resume for target roles', 2),
    (new.id, 'foundation', 'Refresh LinkedIn profile', 3),
    (new.id, 'foundation', 'Update portfolio / GitHub', 4),
    (new.id, 'foundation', 'Write a strong cover letter template', 5),
    (new.id, 'foundation', 'Prepare references list', 6),

    (new.id, 'skills', 'Behavioral / STAR stories prep', 1),
    (new.id, 'skills', 'System design review', 2),
    (new.id, 'skills', 'Coding practice (DSA)', 3),
    (new.id, 'skills', 'Mock interview x3', 4),
    (new.id, 'skills', 'Prepare questions to ask interviewers', 5),

    (new.id, 'outreach', 'List 20 target companies', 1),
    (new.id, 'outreach', 'Reach out to 5 former colleagues', 2),
    (new.id, 'outreach', 'Reconnect with 3 mentors', 3),
    (new.id, 'outreach', 'Post on LinkedIn that I''m open', 4),
    (new.id, 'outreach', 'Attend 1 industry meetup / event', 5),

    (new.id, 'logistics', 'File for unemployment', 1),
    (new.id, 'logistics', 'Review COBRA / health insurance', 2),
    (new.id, 'logistics', 'Set a weekly job-search routine', 3),
    (new.id, 'logistics', 'Block daily time for exercise', 4),
    (new.id, 'logistics', 'Plan a weekly social check-in', 5);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.seed_prep_tasks();
