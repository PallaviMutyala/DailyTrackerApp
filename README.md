# SmartDayAI

A personal productivity assistant built for job seekers. Track your daily activities, manage your application pipeline, prep for interviews, log recruiter outreach, and review your progress — all in one place.

---

## Screenshots

### Daily Log
![Daily Log](./screenshots/daily-log.png)
Log activities by category (apply, learn, network, interview, cook, resume, entertainment, family, other) with optional time range. A pie chart shows today's breakdown. Expand any day to see its entries.

### Summary
![Summary](./screenshots/summary.png)
7, 14, or 30-day stats: total hours, streaks, top category, and an AI-generated narrative. Powered by Claude Haiku (optional — add your own Anthropic API key).

### Applications
![Applications](./screenshots/applications.png)
Track every job you've applied for. Update status (applied → phone → onsite → offer/rejected), leave rejection notes, and delete stale entries.

### Recruiter Emails
![Recruiter Emails](./screenshots/recruiter-emails.png)
Log inbound recruiter emails with company, contact info, and subject. Track follow-up status (new → replied → interviewing → passed / no response).

### Job Search Status
![Job Search Status](./screenshots/job-search-status.png)
Prep checklist with progress bars across four groups: Foundation, Skills, Outreach, Logistics. Add custom tasks and check them off as you go.

### Study Plan
![Study Plan](./screenshots/study-plan.png)
A week-by-week study tracker. Mark tasks done, add custom topics, and track your preparation week over week.

> **How to add screenshots:** Take a screenshot of each tab, save it as `screenshots/<tab-name>.png` (names above), then `git add screenshots/ && git push`.

---

## Features

| Feature | Details |
|---|---|
| Daily Log | Category + duration + optional start/end time |
| Pie chart | Count-based breakdown per day, updates live |
| Google Calendar sync | Read-only; shows events alongside your log entries |
| AI summary | Claude Haiku generates a narrative of your recent activity |
| Applications pipeline | Status tracking with rejection notes |
| Recruiter email log | Contact + follow-up status per email |
| Prep checklist | 4 groups, custom tasks, progress bars |
| Study plan | Week-by-week tasks, custom additions |
| PWA | Add to iPhone/Android home screen |
| Per-user isolation | Supabase RLS — users never see each other's data |

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — no framework |
| Build tool | Vite |
| CSS | Tailwind CSS v4 |
| Fonts | Geist (npm), Instrument Serif (Google Fonts) |
| Charts | Chart.js (CDN) |
| Backend | Supabase (Postgres + Auth + REST) |
| AI | Anthropic Claude Haiku (client-side, optional) |
| Calendar | Google Calendar API v3, read-only |
| Hosting | Vercel (static) |

---

## Project structure

```
smartdayai/
├── schema.sql           # Run once in Supabase SQL editor
├── package.json
├── vite.config.js
├── screenshots/         # Add tab screenshots here
└── src/
    ├── index.html       # Markup: auth screen + 6-tab app
    ├── app.js           # All UI logic, calls db.js only
    ├── db.js            # Supabase client + data access layer
    └── styles.css       # Tailwind + custom design tokens
```

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd smartdayai
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project
2. Pick a name and a strong database password
3. Wait ~2 min for provisioning

### 3. Run the schema

1. In your Supabase project, open **SQL Editor → New query**
2. Paste the contents of `schema.sql` and run it
3. This creates the five tables, RLS policies, and a signup trigger that seeds default prep tasks

### 4. Configure auth

**Authentication → Providers → Email**: ensure Email is enabled.

For local development, disable email confirmation under **Authentication → Settings** so you don't need to confirm each test account. Re-enable before going public.

### 5. Wire up the frontend

1. **Settings → API** — copy your **Project URL** and **anon public key**
2. Open `src/db.js` and set the two constants:
   ```js
   const SUPABASE_URL      = 'https://YOUR-PROJECT.supabase.co';
   const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
   ```
The anon key is safe to commit — RLS policies prevent users from touching each other's data.

### 6. Run locally

```bash
npm run dev
```

Visit the URL Vite prints, create an account, and start logging.

---

## Optional integrations

### Google Calendar sync

Show your calendar events alongside your daily log entries.

1. Go to [Google Cloud Console](https://console.cloud.google.com) → Create a project
2. Enable **Google Calendar API**
3. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `http://localhost:5173` (dev) and your Vercel URL (prod)
4. Copy the Client ID
5. Open `src/app.js` and paste it:
   ```js
   const GCAL_CLIENT_ID = 'YOUR-CLIENT-ID.apps.googleusercontent.com';
   ```
6. The "📅 Connect Calendar" button will appear in the Daily Log header. Click it to authorize.

### AI summary (Claude Haiku)

The Summary section can generate a narrative paragraph about your recent activity.

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. In the app, open the **Summary** tab and click the ⚙ icon next to "AI Summary"
3. Paste your API key — it's stored in `localStorage` and never sent anywhere except Anthropic's API

---

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → import the repo
3. Vercel auto-detects Vite — defaults work, just deploy
4. Open your Vercel URL — done

Updates: push to `main`, Vercel rebuilds automatically.

---

## Add to iPhone home screen (PWA)

1. Open the app in Safari on iPhone
2. Tap the **Share** button (box with arrow)
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add**

The app opens full-screen with no browser chrome, like a native app.

---

## Data model

**entries** — daily log

| column | type | notes |
|---|---|---|
| id | uuid | primary key |
| user_id | uuid | FK to auth.users |
| text | text | activity description |
| category | text | apply / learn / network / interview / cook / resume / entertainment / family / other |
| duration | int | minutes |
| entry_date | date | local date |
| start_time | time | optional |
| end_time | time | optional |
| created_at | timestamptz | |

**applications** — job pipeline

| column | type | notes |
|---|---|---|
| id | uuid | primary key |
| user_id | uuid | FK |
| company | text | |
| role | text | nullable |
| status | text | applied / phone / onsite / offer / rejected |
| feedback | text | rejection notes, nullable |
| created_at | timestamptz | |

**prep_tasks** — prep checklist

| column | type | notes |
|---|---|---|
| id | uuid | primary key |
| user_id | uuid | FK |
| group_name | text | foundation / skills / outreach / logistics |
| text | text | |
| done | boolean | |
| sort_order | int | stable ordering |
| created_at | timestamptz | |

**recruiter_emails** — inbound recruiter log

| column | type | notes |
|---|---|---|
| id | uuid | primary key |
| user_id | uuid | FK |
| company | text | |
| contact_name | text | nullable |
| contact_email | text | nullable |
| subject | text | nullable |
| received_date | date | |
| status | text | new / replied / interviewing / passed / no_response |
| notes | text | nullable |
| created_at | timestamptz | |

**study_tasks** — weekly study plan

| column | type | notes |
|---|---|---|
| id | uuid | primary key |
| user_id | uuid | FK |
| week | int | week number |
| category | text | |
| text | text | |
| done | boolean | |
| sort_order | int | |
| created_at | timestamptz | |

---

## Security notes

- The anon key is public by design — it only allows access via the REST API, gated by RLS
- All RLS policies enforce `auth.uid() = user_id`, so users are strictly isolated
- The signup trigger uses `SECURITY DEFINER` to seed default tasks at account creation
- Google Calendar access is read-only (`calendar.events.readonly` scope); no writes are made
- The Anthropic API key is stored only in the user's browser `localStorage` and sent directly to `api.anthropic.com` — it never touches any server you control
