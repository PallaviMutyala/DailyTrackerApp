cd ~/DailyTrackerApp
cat > CLAUDE.md << 'EOF'
# Cadence — Project Context for Claude Code

## What this is
A job-prep tracker for someone recently laid off. Three tabs:
- **Daily Log** — log activities with category (apply/learn/network/interview/cook/other) and duration in minutes
- **Applications** — pipeline tracker (applied → phone → onsite → offer/closed)
- **Job Search Status** — prep checklist grouped into foundation, skills, outreach, logistics

## Stack
- Frontend: vanilla HTML/CSS/JS, no framework, built with Vite
- Backend: Supabase (Postgres + Auth + auto-generated REST API)
- Security: Row Level Security policies enforce per-user data isolation
- Hosting: Vercel (free tier), static site

## Key files
- `schema.sql` — database schema, RLS policies, signup trigger. Run once in Supabase SQL editor.
- `src/db.js` — Supabase client + data access layer. Holds SUPABASE_URL and SUPABASE_ANON_KEY constants that need to be filled in.
- `src/app.js` — UI logic, calls into db.js
- `src/index.html` — markup with auth screen + main app
- `src/styles.css` — editorial cream/rust/moss design system
- `README.md` — full setup and deployment guide

## Design system
Editorial aesthetic. Cream background (#f4ede1), deep ink text, rust accents (#b54a2c), moss green, gold. Fonts: Fraunces (serif headings, italic for emphasis), Inter Tight (body), JetBrains Mono (labels/timestamps).

## Setup steps remaining
1. Create Supabase project, run schema.sql in SQL editor
2. Disable email confirmation in Supabase Auth settings (for dev)
3. Paste Supabase URL + anon key into src/db.js
4. npm install && npm run dev — test locally
5. Commit and push, then deploy on Vercel

## Conventions
- Keep the editorial design language — don't introduce generic SaaS styling
- Use vanilla JS, no frameworks
- All data access goes through db.js, never call Supabase directly from app.js
EOF
