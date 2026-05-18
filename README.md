# Cadence

A daily-rhythm tracker for job prep. Three tabs: daily log, applications pipeline, and a prep checklist.

## Architecture

- **Frontend:** vanilla HTML/CSS/JS, served as a static site
- **Backend:** Supabase (Postgres + Auth + auto-generated REST API)
- **Hosting:** Vercel (free tier)

The frontend talks directly to Supabase. There's no separate Node server — Supabase's auto-generated API plus Row Level Security policies enforce that users can only see their own data.

## Project structure

```
cadence/
├── schema.sql           # Run once in Supabase SQL editor
├── package.json
├── vite.config.js
└── src/
    ├── index.html
    ├── app.js           # UI logic, calls db.js
    ├── db.js            # Supabase client + data access
    └── styles.css
```

---

## Setup

### 1. Create a Supabase project

1. Go to https://supabase.com → New project
2. Pick a name and a strong database password (you won't need it day-to-day)
3. Wait ~2 min for provisioning

### 2. Run the schema

1. In your Supabase project, open **SQL Editor → New query**
2. Paste the contents of `schema.sql` and run it
3. This creates the three tables, RLS policies, and the signup trigger that seeds default prep tasks

### 3. Configure email auth

1. **Authentication → Providers → Email**: make sure Email is enabled
2. For development you can disable email confirmation under **Authentication → Settings** so you don't have to confirm an email each time you create a test account. Re-enable before going public.

### 4. Wire up the frontend

1. **Settings → API**, copy your **Project URL** and **anon public key**
2. Open `src/db.js` and replace the two placeholder constants:
   ```js
   const SUPABASE_URL      = 'https://YOUR-PROJECT.supabase.co';
   const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
   ```
3. The anon key is safe to ship in client code — RLS prevents users from accessing each other's data.

### 5. Run locally

```bash
npm install
npm run dev
```

Visit the URL Vite prints. Create an account, sign in, start logging.

---

## Deploy to Vercel

The easiest path:

1. Push this folder to a new GitHub repo
2. Go to https://vercel.com → New Project → import the repo
3. Vercel auto-detects Vite. Defaults work; deploy.
4. Open the URL Vercel gives you. Done.

Updates: push to `main`, Vercel rebuilds automatically.

---

## Data model

**entries** — daily log

| column | type | notes |
|---|---|---|
| id | uuid | primary key |
| user_id | uuid | FK to auth.users, set by app |
| text | text | the entry description |
| category | text | apply / learn / network / interview / cook / other |
| duration | int | minutes (0 if unset) |
| entry_date | date | local date the entry counts toward |
| created_at | timestamptz | for sort order and timestamps |

**applications** — job pipeline

| column | type | notes |
|---|---|---|
| id | uuid | primary key |
| user_id | uuid | FK |
| company | text | |
| role | text | nullable |
| status | text | applied / phone / onsite / offer / rejected |
| created_at | timestamptz | |

**prep_tasks** — checklist items

| column | type | notes |
|---|---|---|
| id | uuid | primary key |
| user_id | uuid | FK |
| group_name | text | foundation / skills / outreach / logistics |
| text | text | |
| done | boolean | |
| sort_order | int | for stable ordering |
| created_at | timestamptz | |

---

## Security notes

- The anon key is meant to be public. It only gives access via the REST API, gated by RLS.
- RLS policies enforce `auth.uid() = user_id` on every operation, so a user can never read or modify another user's rows.
- The signup trigger uses `security definer` so the schema seed runs with elevated privileges at exactly the moment a user is created.

---

## What's intentionally simple

- No realtime sync (Supabase supports it; not wired up). If you want multi-device live updates, subscribe to changes via `supabase.channel(...)` in `db.js`.
- No optimistic UI. Every write hits the network before the UI updates. Fine for personal use; trivial to upgrade.
- No tests. This is a personal tracker; if you want to harden it, start with Playwright for the auth + add-entry flows.

---

## Possible next steps

- CSV export (entries and applications)
- Weekly summary view with category breakdown
- Notes / contacts per application
- Reminder when streak is about to break
- PWA so it installs on your phone home screen
