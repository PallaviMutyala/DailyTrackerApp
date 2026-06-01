// =====================================================================
// app.js — SmartDayAI UI logic, backed by Supabase
// =====================================================================

// Google Calendar OAuth — replace with your Google Cloud OAuth Client ID
// console.cloud.google.com → Credentials → OAuth 2.0 Client ID (Web Application)
const GCAL_CLIENT_ID = '';

import {
  signUp, signIn, signOut, getUser, onAuthChange,
  listEntries, addEntry, deleteEntry,
  listApplications, addApplication, updateApplicationStatus, updateApplicationFeedback, deleteApplication,
  updateApplicationMeta, listInterviewRounds, addInterviewRound, updateInterviewRound, deleteInterviewRound,
  listPrepTasks, addPrepTask, togglePrepTask, deletePrepTask,
  listRecruiterEmails, addRecruiterEmail, updateRecruiterEmailStatus, updateRecruiterEmailNotes, deleteRecruiterEmail,
  listStudyTasks, toggleStudyTask, addStudyTask, deleteStudyTask
} from './db.js';

import { fetchLatestHNHiringPost, searchHNJobs, searchRemotiveJobs } from './api.js';

const QUOTES = [
  { q: "Discipline equals freedom.", a: "Jocko Willink" },
  { q: "The cure for anything is salt water — sweat, tears, or the sea.", a: "Isak Dinesen" },
  { q: "Do the work. Do the work. Do the work.", a: "Anonymous" },
  { q: "The obstacle is the way.", a: "Marcus Aurelius" },
  { q: "Action is the antidote to despair.", a: "Joan Baez" },
  { q: "What you do every day matters more than what you do once in a while.", a: "Gretchen Rubin" },
  { q: "The way out is through.", a: "Robert Frost" }
];

const WEEK_TITLES = ['','Arrays & Fundamentals','Trees & Searching','Pattern Expansion','Dynamic Programming','Company Focus: Google','Company Focus: Microsoft','Review & Consolidation','Final Prep'];
const STUDY_CAT_BADGE  = { leetcode:'badge-learn', system_design:'badge-interview', behavioral:'badge-network', resume:'badge-resume', mock:'badge-apply', other:'badge-other' };
const STUDY_CAT_LABEL  = { leetcode:'LeetCode', system_design:'Sys Design', behavioral:'Behavioral', resume:'Resume', mock:'Mock', other:'Other' };

let state = { entries: [], applications: [], prep: { foundation: [], skills: [], outreach: [], logistics: [] }, recruiterEmails: [], studyTasks: [], interviewRounds: {} };
const expandedDays = new Set([todayKey()]);
const dayCharts = {};
let hnPostId = null;
const expandedWeeks = new Set([getCurrentStudyWeek()]);
let summaryPeriod = 7;
let gcalToken = null;
let gcalTokenExpiry = 0;
let gcalEvents = {};
let _gcalClient = null;
let appFilter = 'all';
let appSort   = 'date';
const expandedRounds = new Set();

// ---------- helpers ----------
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatDate() {
  return new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }).toUpperCase();
}
function formatShort() {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
}
function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function formatDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
function formatTimeStr(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function getTimeFromSelects(hourId, minId, ampmId) {
  const h = document.getElementById(hourId).value;
  const m = document.getElementById(minId).value;
  const ap = document.getElementById(ampmId).value;
  if (!h || !m || !ap) return '';
  let hour = parseInt(h);
  if (ap === 'AM' && hour === 12) hour = 0;
  if (ap === 'PM' && hour !== 12) hour += 12;
  return `${String(hour).padStart(2,'0')}:${m}`;
}
function computeSessions(entries) {
  const timed = entries
    .filter(e => e.start_time && e.end_time)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  if (!timed.length) return [];
  const sessions = [];
  let start = timed[0].start_time, end = timed[0].end_time;
  for (let i = 1; i < timed.length; i++) {
    const gap = timeToMinutes(timed[i].start_time) - timeToMinutes(end);
    if (gap > 60) { sessions.push({ start, end }); start = timed[i].start_time; end = timed[i].end_time; }
    else if (timed[i].end_time > end) end = timed[i].end_time;
  }
  sessions.push({ start, end });
  return sessions;
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
function formatMinutes(min) {
  const u = `class="text-sm font-normal text-gray-400 ml-1"`;
  if (!min) return `0<span ${u}>min</span>`;
  if (min < 60) return `${min}<span ${u}>min</span>`;
  const h = Math.floor(min / 60), m = min % 60;
  return m === 0 ? `${h}<span ${u}>hr</span>` : `${h}<span ${u}>h</span> ${m}<span ${u}>m</span>`;
}
function formatDuration(min) {
  if (!min) return '';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function computeStreak() {
  if (state.entries.length === 0) return 0;
  const days = new Set(state.entries.map(e => e.entry_date));
  let streak = 0;
  const d = new Date();
  while (true) {
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (days.has(key)) { streak++; d.setDate(d.getDate() - 1); }
    else {
      if (streak === 0 && key === todayKey()) { d.setDate(d.getDate() - 1); continue; }
      break;
    }
  }
  return streak;
}

// ---------- AUTH UI ----------
let authMode = 'signin';

function setupAuth() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      authMode = tab.dataset.authTab;
      document.getElementById('authSubmit').textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
      document.getElementById('authError').textContent = '';
      document.getElementById('authInfo').textContent = '';
    });
  });

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errEl = document.getElementById('authError');
    const infoEl = document.getElementById('authInfo');
    errEl.textContent = ''; infoEl.textContent = '';

    try {
      if (authMode === 'signin') {
        const { error } = await signIn(email, password);
        if (error) throw error;
      } else {
        const { data, error } = await signUp(email, password);
        if (error) throw error;
        if (data.user && !data.session) {
          infoEl.textContent = 'Check your email to confirm your account, then sign in.';
        }
      }
    } catch (err) {
      errEl.textContent = err.message || 'Something went wrong.';
    }
  });
}

// ---------- TAB UI ----------
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
  });
}

// ---------- RENDER: daily log ----------
function renderLogStats() {
  const today = todayKey();
  const todayEntries = state.entries.filter(e => e.entry_date === today);
  const todayMin = todayEntries.reduce((s,e) => s + (e.duration || 0), 0);
  document.getElementById('todayTime').innerHTML = formatMinutes(todayMin);
  document.getElementById('todayCount').textContent = todayEntries.length;
  document.getElementById('streak').innerHTML = `${computeStreak()}<span class="text-sm font-normal text-gray-400 ml-1">days</span>`;
  document.getElementById('totalCount').textContent = state.entries.length;
  document.getElementById('overDayWarning').style.display = todayMin > 1440 ? 'block' : 'none';
}

function renderEntries() {
  Object.values(dayCharts).forEach(c => c.destroy());
  for (const k of Object.keys(dayCharts)) delete dayCharts[k];

  const container = document.getElementById('entriesList');
  if (state.entries.length === 0) {
    container.innerHTML = `<div class="py-10 text-center"><p class="text-sm text-gray-400 italic mb-1">"Begin where you are."</p><p class="text-xs text-gray-300">No entries yet — log your first above</p></div>`;
    return;
  }

  const byDate = {};
  state.entries.forEach(e => { (byDate[e.entry_date] = byDate[e.entry_date] || []).push(e); });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const today = todayKey();

  container.innerHTML = dates.map(date => {
    const entries = byDate[date];
    const totalMin = entries.reduce((s, e) => s + (e.duration || 0), 0);
    const isToday = date === today;
    const isExpanded = expandedDays.has(date);
    const label = isToday ? 'Today' : formatDayLabel(date);

    const sessions = computeSessions(entries);
    const sessionSummary = sessions.map(s => `${formatTimeStr(s.start)} – ${formatTimeStr(s.end)}`).join(' · ');

    return `<div class="border-b border-gray-100 last:border-0" data-date="${date}">
      <div class="flex items-center justify-between py-3 cursor-pointer hover:bg-gray-50 rounded-lg -mx-2 px-2 transition-colors" data-toggle-day="${date}">
        <div class="flex items-center gap-3">
          <span class="${isToday ? 'text-sm font-semibold text-gray-900' : 'text-sm font-medium text-gray-600'}">${label}</span>
          <span class="text-xs text-gray-400 font-mono">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${totalMin ? ` · ${formatDuration(totalMin)}` : ''}${sessionSummary ? ` · ${sessionSummary}` : ''}</span>
        </div>
        <span class="text-xs text-gray-400">${isExpanded ? '▴' : '▾'}</span>
      </div>
      <div${isExpanded ? '' : ' style="display:none"'} class="pb-4">
        <ul>
          ${entries.map(e => `<li class="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
            <span class="badge badge-${e.category}">${{resume:'résumé',entertainment:'fun',family:'family'}[e.category] ?? e.category}</span>
            <span class="flex-1 text-sm text-gray-700">${escapeHtml(e.text)}</span>
            <span class="flex items-center gap-2 shrink-0">
              ${e.duration ? `<span class="text-xs text-gray-400 font-mono">${formatDuration(e.duration)}</span>` : ''}
              <a href="${buildCalendarUrl(e)}" target="_blank" title="Add to Google Calendar" class="text-xs text-gray-300 hover:text-gray-600 font-mono transition-colors">cal ↗</a>
              <button class="text-gray-300 hover:text-gray-600 text-lg leading-none transition-colors" data-del-entry="${e.id}" aria-label="Delete">×</button>
            </span>
          </li>`).join('')}
        </ul>
        <div id="gcal-${date}"></div>
        <div class="day-chart-wrap"><canvas id="chart-${date}"></canvas></div>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('[data-del-entry]').forEach(btn => {
    btn.addEventListener('click', () => onDeleteEntry(btn.dataset.delEntry));
  });
  container.querySelectorAll('[data-toggle-day]').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const d = hdr.dataset.toggleDay;
      if (expandedDays.has(d)) expandedDays.delete(d); else expandedDays.add(d);
      renderEntries();
    });
  });

  dates.forEach(date => { if (expandedDays.has(date)) renderDayChart(date, byDate[date]); });
  loadGcalForExpandedDays();
}

async function onAddEntry() {
  const input = document.getElementById('entryText');
  const cat = document.getElementById('entryCat');
  const dateInput = document.getElementById('entryDate');
  const errEl = document.getElementById('entryDateError');
  const text = input.value.trim();
  if (!text) return;

  const entryDate = dateInput.value;
  if (!entryDate) {
    errEl.textContent = 'Please select a date.';
    errEl.classList.remove('hidden');
    return;
  }
  if (entryDate > todayKey()) {
    errEl.textContent = "Can't log entries in the future.";
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');

  const start = getTimeFromSelects('entryStartHour', 'entryStartMin', 'entryStartAmpm');
  const end   = getTimeFromSelects('entryEndHour',   'entryEndMin',   'entryEndAmpm');
  let duration = 0;
  if (start && end) {
    duration = timeToMinutes(end) - timeToMinutes(start);
    if (duration < 0) duration += 1440;
  }
  try {
    const row = await addEntry({ text, category: cat.value, duration, entry_date: entryDate, start_time: start, end_time: end });
    state.entries.unshift(row);
    expandedDays.add(entryDate);
    input.value = '';
    ['entryStartHour','entryStartMin','entryStartAmpm','entryEndHour','entryEndMin','entryEndAmpm']
      .forEach(id => { document.getElementById(id).value = ''; });
    renderAll();
    input.focus();
  } catch (e) { alert('Could not save entry: ' + e.message); }
}

async function onDeleteEntry(id) {
  try {
    await deleteEntry(id);
    state.entries = state.entries.filter(e => e.id !== id);
    renderAll();
  } catch (e) { alert('Could not delete: ' + e.message); }
}

// ---------- RENDER: applications ----------
function renderAppStats() {
  const apps = state.applications;
  document.getElementById('appsTotal').textContent = apps.length;
  document.getElementById('appsPhone').textContent = apps.filter(a => a.status === 'phone').length;
  document.getElementById('appsOnsite').textContent = apps.filter(a => a.status === 'onsite').length;
  document.getElementById('appsOffers').textContent = apps.filter(a => a.status === 'offer').length;
}

function renderApps() {
  const list = document.getElementById('appsList');

  const counts = { all: state.applications.length };
  ['applied','phone','onsite','offer','rejected'].forEach(s => { counts[s] = state.applications.filter(a => a.status === s).length; });

  const filterBar = `<div class="flex items-center gap-1.5 flex-wrap mb-4">
    ${['all','applied','phone','onsite','offer','rejected'].map(s => {
      const lbl = { all:'All', applied:'Applied', phone:'Phone', onsite:'Onsite', offer:'Offer', rejected:'Rejected' }[s];
      const active = s === appFilter;
      return `<button class="app-filter text-xs rounded-full px-3 py-1 border transition-colors ${active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}" data-filter="${s}">${lbl} <span class="font-mono opacity-70">${counts[s]}</span></button>`;
    }).join('')}
    <div class="ml-auto flex items-center gap-1.5">
      <span class="text-xs text-gray-400">Sort:</span>
      <select id="appSortSel" class="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-gray-900 transition-colors">
        <option value="date" ${appSort==='date'?'selected':''}>Newest</option>
        <option value="company" ${appSort==='company'?'selected':''}>Company A–Z</option>
        <option value="priority" ${appSort==='priority'?'selected':''}>Priority</option>
      </select>
    </div>
  </div>`;

  let apps = [...state.applications];
  if (appFilter !== 'all') apps = apps.filter(a => a.status === appFilter);
  if (appSort === 'company') apps.sort((a,b) => a.company.localeCompare(b.company));
  else if (appSort === 'priority') apps.sort((a,b) => (b.priority||2) - (a.priority||2));

  if (apps.length === 0) {
    list.innerHTML = filterBar + `<div class="py-10 text-center"><p class="text-sm text-gray-400 italic mb-1">"The pipeline awaits."</p><p class="text-xs text-gray-300">${appFilter === 'all' ? 'Add your first application above' : `No ${appFilter} applications yet`}</p></div>`;
    bindFilterControls(list);
    return;
  }

  list.innerHTML = filterBar + `<ul>${apps.map(a => renderAppCard(a)).join('')}</ul>`;
  bindAppCardEvents(list);
}

function renderAppCard(a) {
  const rounds = state.interviewRounds[a.id] || [];
  const isExpanded = expandedRounds.has(a.id);
  const showInterviewFields = ['phone','onsite','offer','rejected'].includes(a.status);
  const prio = a.priority || 2;

  return `<li class="py-4 border-b border-gray-100 last:border-0">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-lg border border-gray-100 shrink-0 bg-gray-50 flex items-center justify-center text-xs font-bold text-gray-400 font-mono relative overflow-hidden">
        <img src="https://logo.clearbit.com/${getCompanyDomain(a.company)}" alt="" class="absolute inset-0 w-full h-full object-cover" onerror="this.remove()">
        <span>${getInitials(a.company)}</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-gray-900">${escapeHtml(a.company)}</div>
        <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(a.role || 'No role specified')}</div>
      </div>
      <div class="flex gap-0.5 shrink-0" data-priority-app="${a.id}">
        ${[1,2,3].map(n => `<button class="app-star text-base leading-none transition-colors ${prio >= n ? 'text-amber-400' : 'text-gray-200'} hover:text-amber-300" data-star="${n}">★</button>`).join('')}
      </div>
      <span class="text-xs text-gray-400 font-mono shrink-0">${formatDateShort(a.created_at)}</span>
      <select class="status-select ${a.status}" data-status="${a.id}">
        <option value="applied" ${a.status==='applied'?'selected':''}>Applied</option>
        <option value="phone" ${a.status==='phone'?'selected':''}>Phone</option>
        <option value="onsite" ${a.status==='onsite'?'selected':''}>Onsite</option>
        <option value="offer" ${a.status==='offer'?'selected':''}>Offer</option>
        <option value="rejected" ${a.status==='rejected'?'selected':''}>Rejected</option>
      </select>
      <button class="text-gray-300 hover:text-gray-600 text-lg leading-none transition-colors shrink-0" data-del-app="${a.id}" aria-label="Delete">×</button>
    </div>
    <div class="flex items-center gap-3 mt-2 pl-12 flex-wrap">
      <label class="flex items-center gap-1.5 cursor-pointer shrink-0">
        <input type="checkbox" class="w-3.5 h-3.5 rounded cursor-pointer" style="accent-color:#111827" data-referral="${a.id}" ${a.referral ? 'checked' : ''}>
        <span class="text-xs text-gray-500">Referred</span>
      </label>
      <input type="url" class="flex-1 min-w-40 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-gray-900 text-gray-600 placeholder-gray-300 transition-colors"
        placeholder="Job posting URL" value="${escapeHtml(a.job_url || '')}" data-job-url="${a.id}">
      <span class="text-xs text-emerald-600 font-mono min-h-4 shrink-0" id="meta-saved-${a.id}"></span>
    </div>
    <div class="flex items-center gap-2 mt-2 pl-12 flex-wrap">
      <span class="text-xs text-gray-400 font-mono shrink-0">Follow up</span>
      <input type="date" class="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 font-mono focus:outline-none focus:border-gray-900 transition-colors"
        value="${a.follow_up_date || ''}" data-followup-date="${a.id}">
      <input type="text" class="flex-1 min-w-32 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-gray-900 text-gray-600 placeholder-gray-300 transition-colors"
        placeholder="Next step / reminder..." maxlength="200" value="${escapeHtml(a.follow_up_note || '')}" data-followup-note="${a.id}">
    </div>
    ${showInterviewFields ? `
    <div class="mt-2 pl-12">
      <div class="flex items-center gap-2 flex-wrap mb-2">
        <span class="text-xs text-gray-400 font-mono shrink-0">Interview</span>
        <input type="date" class="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 font-mono focus:outline-none focus:border-gray-900 transition-colors"
          value="${a.interview_date || ''}" data-interview-date="${a.id}">
        <input type="text" class="flex-1 min-w-32 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-gray-900 text-gray-600 placeholder-gray-300 transition-colors"
          placeholder="Interviewer name(s)" maxlength="200" value="${escapeHtml(a.interviewer_names || '')}" data-interviewer="${a.id}">
      </div>
      <textarea class="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-gray-900 text-gray-600 placeholder-gray-300 resize-none transition-colors"
        rows="2" placeholder="Interview notes, impressions..." data-interview-notes="${a.id}">${escapeHtml(a.interview_notes || '')}</textarea>
    </div>` : ''}
    ${a.status === 'rejected' ? `
    <div class="app-feedback">
      <div class="app-feedback-label">What to improve next time</div>
      <textarea class="app-feedback-input" data-feedback="${a.id}" placeholder="What went well, what didn't, what to do differently next time...">${escapeHtml(a.feedback || '')}</textarea>
      <div class="app-feedback-saved" id="saved-${a.id}"></div>
    </div>` : ''}
    <div class="mt-3 pl-12">
      <button class="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 font-mono transition-colors" data-toggle-rounds="${a.id}">
        <span>Interview rounds</span>
        ${rounds.length > 0 ? `<span class="bg-gray-100 text-gray-600 rounded-full px-1.5 font-mono text-xs leading-tight">${rounds.length}</span>` : ''}
        <span>${isExpanded ? '▴' : '▾'}</span>
      </button>
      ${isExpanded ? `<div class="mt-3 space-y-3">
        ${rounds.map(r => renderRoundCard(r)).join('')}
        <div class="border border-dashed border-gray-200 rounded-xl p-4">
          <div class="text-xs text-gray-400 font-mono uppercase tracking-wide mb-3">Add round</div>
          <div class="flex gap-2 flex-wrap mb-3">
            <input type="text" id="newRoundName-${a.id}" placeholder="Round name (e.g. Phone Screen, Technical 1, Behavioral)" maxlength="80"
              class="flex-1 min-w-40 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-900 transition-colors">
            <input type="date" id="newRoundDate-${a.id}"
              class="text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-gray-900 transition-colors">
            <input type="text" id="newRoundInterviewer-${a.id}" placeholder="Interviewer (optional)" maxlength="100"
              class="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-900 transition-colors">
          </div>
          <button class="text-xs bg-gray-900 text-white rounded-lg px-4 py-1.5 hover:bg-gray-700 transition-colors font-semibold" data-add-round="${a.id}">Add Round</button>
        </div>
      </div>` : ''}
    </div>
  </li>`;
}

function renderRoundCard(r) {
  return `<div class="border border-gray-100 rounded-xl p-4">
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <input type="text" class="flex-1 min-w-32 text-sm font-semibold bg-transparent border-b border-transparent hover:border-gray-200 focus:border-gray-900 focus:outline-none text-gray-900 pb-0.5 transition-colors"
        value="${escapeHtml(r.round_name)}" placeholder="Round name" data-round-name="${r.id}">
      <input type="date" class="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 font-mono focus:outline-none focus:border-gray-900 transition-colors"
        value="${r.interview_date || ''}" data-round-date="${r.id}">
      <input type="text" class="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-gray-900 text-gray-600 placeholder-gray-300 transition-colors"
        placeholder="Interviewer" maxlength="100" value="${escapeHtml(r.interviewer || '')}" data-round-interviewer="${r.id}">
      <button class="text-gray-300 hover:text-red-400 text-lg leading-none transition-colors ml-auto shrink-0" data-del-round="${r.id}">×</button>
    </div>
    <div class="space-y-3">
      <div>
        <div class="text-xs text-gray-400 font-mono uppercase tracking-wide mb-1">Questions asked</div>
        <textarea class="w-full text-sm border border-gray-100 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-900 text-gray-700 placeholder-gray-300 resize-vertical bg-gray-50 transition-colors"
          rows="4" placeholder="List the questions you were asked..." data-round-questions="${r.id}">${escapeHtml(r.questions || '')}</textarea>
      </div>
      <div>
        <div class="text-xs text-gray-400 font-mono uppercase tracking-wide mb-1">Notes</div>
        <textarea class="w-full text-sm border border-gray-100 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-900 text-gray-700 placeholder-gray-300 resize-vertical bg-gray-50 transition-colors"
          rows="2" placeholder="How did it go? What to improve?" data-round-notes="${r.id}">${escapeHtml(r.notes || '')}</textarea>
      </div>
    </div>
    <div class="text-xs text-emerald-600 font-mono mt-1.5 min-h-4" id="round-saved-${r.id}"></div>
  </div>`;
}

function bindFilterControls(list) {
  list.querySelectorAll('.app-filter').forEach(btn => {
    btn.addEventListener('click', () => { appFilter = btn.dataset.filter; renderApps(); });
  });
  const sortSel = list.querySelector('#appSortSel');
  if (sortSel) sortSel.addEventListener('change', () => { appSort = sortSel.value; renderApps(); });
}

function bindAppCardEvents(list) {
  bindFilterControls(list);
  list.querySelectorAll('[data-status]').forEach(sel => {
    sel.addEventListener('change', () => onUpdateAppStatus(sel.dataset.status, sel.value));
  });
  list.querySelectorAll('[data-del-app]').forEach(btn => {
    btn.addEventListener('click', () => onDeleteApp(btn.dataset.delApp));
  });
  list.querySelectorAll('[data-feedback]').forEach(ta => {
    ta.addEventListener('blur', () => onSaveFeedback(ta.dataset.feedback, ta.value));
  });
  list.querySelectorAll('[data-priority-app]').forEach(container => {
    const id = container.dataset.priorityApp;
    container.querySelectorAll('.app-star').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const priority = parseInt(btn.dataset.star);
        container.querySelectorAll('.app-star').forEach((b, j) => {
          b.classList.toggle('text-amber-400', priority > j);
          b.classList.toggle('text-gray-200', priority <= j);
        });
        onUpdateAppMeta(id, { priority });
      });
    });
  });
  list.querySelectorAll('[data-referral]').forEach(cb => {
    cb.addEventListener('change', () => onUpdateAppMeta(cb.dataset.referral, { referral: cb.checked }));
  });
  list.querySelectorAll('[data-job-url]').forEach(inp => {
    inp.addEventListener('blur', () => onUpdateAppMeta(inp.dataset.jobUrl, { job_url: inp.value.trim() || null }, `meta-saved-${inp.dataset.jobUrl}`));
  });
  list.querySelectorAll('[data-followup-date]').forEach(inp => {
    inp.addEventListener('blur', () => onUpdateAppMeta(inp.dataset.followupDate, { follow_up_date: inp.value || null }, `meta-saved-${inp.dataset.followupDate}`));
  });
  list.querySelectorAll('[data-followup-note]').forEach(inp => {
    inp.addEventListener('blur', () => onUpdateAppMeta(inp.dataset.followupNote, { follow_up_note: inp.value.trim() || null }, `meta-saved-${inp.dataset.followupNote}`));
  });
  list.querySelectorAll('[data-interview-date]').forEach(inp => {
    inp.addEventListener('blur', () => onUpdateAppMeta(inp.dataset.interviewDate, { interview_date: inp.value || null }, `meta-saved-${inp.dataset.interviewDate}`));
  });
  list.querySelectorAll('[data-interviewer]').forEach(inp => {
    inp.addEventListener('blur', () => onUpdateAppMeta(inp.dataset.interviewer, { interviewer_names: inp.value.trim() || null }, `meta-saved-${inp.dataset.interviewer}`));
  });
  list.querySelectorAll('[data-interview-notes]').forEach(ta => {
    ta.addEventListener('blur', () => onUpdateAppMeta(ta.dataset.interviewNotes, { interview_notes: ta.value.trim() || null }, `meta-saved-${ta.dataset.interviewNotes}`));
  });
  list.querySelectorAll('[data-toggle-rounds]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleRounds;
      if (expandedRounds.has(id)) expandedRounds.delete(id); else expandedRounds.add(id);
      renderApps();
    });
  });
  list.querySelectorAll('[data-add-round]').forEach(btn => {
    btn.addEventListener('click', () => onAddRound(btn.dataset.addRound));
  });
  list.querySelectorAll('[data-del-round]').forEach(btn => {
    btn.addEventListener('click', () => onDeleteRound(btn.dataset.delRound));
  });
  list.querySelectorAll('[data-round-name]').forEach(inp => {
    inp.addEventListener('blur', () => { if (inp.value.trim()) onUpdateRound(inp.dataset.roundName, { round_name: inp.value.trim() }); });
  });
  list.querySelectorAll('[data-round-date]').forEach(inp => {
    inp.addEventListener('blur', () => onUpdateRound(inp.dataset.roundDate, { interview_date: inp.value || null }));
  });
  list.querySelectorAll('[data-round-interviewer]').forEach(inp => {
    inp.addEventListener('blur', () => onUpdateRound(inp.dataset.roundInterviewer, { interviewer: inp.value.trim() || null }));
  });
  list.querySelectorAll('[data-round-questions]').forEach(ta => {
    ta.addEventListener('blur', () => onUpdateRound(ta.dataset.roundQuestions, { questions: ta.value || null }));
  });
  list.querySelectorAll('[data-round-notes]').forEach(ta => {
    ta.addEventListener('blur', () => onUpdateRound(ta.dataset.roundNotes, { notes: ta.value || null }));
  });
}

async function onAddApp() {
  const company = document.getElementById('appCompany').value.trim();
  const role = document.getElementById('appRole').value.trim();
  if (!company) return;
  try {
    const row = await addApplication({ company, role });
    state.applications.unshift(row);
    document.getElementById('appCompany').value = '';
    document.getElementById('appRole').value = '';
    renderAll();
  } catch (e) { alert('Could not save: ' + e.message); }
}

async function onUpdateAppStatus(id, status) {
  try {
    await updateApplicationStatus(id, status);
    const app = state.applications.find(a => a.id === id);
    if (app) app.status = status;
    renderAll();
  } catch (e) { alert('Could not update: ' + e.message); }
}

async function onDeleteApp(id) {
  try {
    await deleteApplication(id);
    state.applications = state.applications.filter(a => a.id !== id);
    renderAll();
  } catch (e) { alert('Could not delete: ' + e.message); }
}

async function onSaveFeedback(id, feedback) {
  try {
    await updateApplicationFeedback(id, feedback);
    const app = state.applications.find(a => a.id === id);
    if (app) app.feedback = feedback;
    const savedEl = document.getElementById(`saved-${id}`);
    if (savedEl) { savedEl.textContent = 'Saved'; setTimeout(() => { savedEl.textContent = ''; }, 2000); }
  } catch (e) { alert('Could not save feedback: ' + e.message); }
}

async function onUpdateAppMeta(id, fields, savedElId) {
  try {
    await updateApplicationMeta(id, fields);
    const app = state.applications.find(a => a.id === id);
    if (app) Object.assign(app, fields);
    if (savedElId) {
      const el = document.getElementById(savedElId);
      if (el) { el.textContent = 'Saved'; setTimeout(() => { el.textContent = ''; }, 2000); }
    }
  } catch (e) { alert('Could not save: ' + e.message); }
}

async function onAddRound(appId) {
  const nameEl = document.getElementById(`newRoundName-${appId}`);
  const name = nameEl?.value.trim();
  if (!name) { if (nameEl) nameEl.focus(); return; }
  const date = document.getElementById(`newRoundDate-${appId}`)?.value;
  const interviewer = document.getElementById(`newRoundInterviewer-${appId}`)?.value.trim();
  try {
    const row = await addInterviewRound({ application_id: appId, round_name: name, interview_date: date || null, interviewer: interviewer || null });
    if (!state.interviewRounds[appId]) state.interviewRounds[appId] = [];
    state.interviewRounds[appId].push(row);
    expandedRounds.add(appId);
    renderApps();
  } catch (e) { alert('Could not add round: ' + e.message); }
}

async function onUpdateRound(id, fields) {
  try {
    await updateInterviewRound(id, fields);
    for (const rounds of Object.values(state.interviewRounds)) {
      const r = rounds.find(r => r.id === id);
      if (r) { Object.assign(r, fields); break; }
    }
    const el = document.getElementById(`round-saved-${id}`);
    if (el) { el.textContent = 'Saved'; setTimeout(() => { el.textContent = ''; }, 2000); }
  } catch (e) { alert('Could not save: ' + e.message); }
}

async function onDeleteRound(id) {
  try {
    await deleteInterviewRound(id);
    for (const [appId, rounds] of Object.entries(state.interviewRounds)) {
      const idx = rounds.findIndex(r => r.id === id);
      if (idx >= 0) { state.interviewRounds[appId].splice(idx, 1); break; }
    }
    renderApps();
  } catch (e) { alert('Could not delete: ' + e.message); }
}

// ---------- RENDER: recruiter inbox ----------
function renderRecruiterStats() {
  const e = state.recruiterEmails;
  document.getElementById('recTotal').textContent = e.length;
  document.getElementById('recReplied').textContent = e.filter(r => r.status === 'replied').length;
  document.getElementById('recInterviewing').textContent = e.filter(r => r.status === 'interviewing').length;
  document.getElementById('recPassed').textContent = e.filter(r => r.status === 'passed').length;
}

function renderRecruiterEmails() {
  const list = document.getElementById('recList');
  if (state.recruiterEmails.length === 0) {
    list.innerHTML = `<div class="py-10 text-center"><p class="text-sm text-gray-400 italic mb-1">"Your inbox is the starting line."</p><p class="text-xs text-gray-300">Add recruiter emails above to track them</p></div>`;
    return;
  }
  list.innerHTML = state.recruiterEmails.map(r => `
    <li class="py-4 border-b border-gray-100 last:border-0">
      <div class="flex items-center gap-4">
        <div class="w-9 h-9 rounded-lg border border-gray-100 shrink-0 bg-gray-50 flex items-center justify-center text-xs font-bold text-gray-400 font-mono relative overflow-hidden">
          <img src="https://logo.clearbit.com/${getCompanyDomain(r.company)}" alt="" class="absolute inset-0 w-full h-full object-cover" onerror="this.remove()">
          <span>${getInitials(r.company)}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold text-gray-900">${escapeHtml(r.company)}${r.contact_name ? ` — <span class="font-normal text-gray-500">${escapeHtml(r.contact_name)}</span>` : ''}</div>
          ${r.subject ? `<div class="text-xs text-gray-400 mt-0.5 truncate">${escapeHtml(r.subject)}</div>` : ''}
        </div>
        <span class="text-xs text-gray-400 font-mono shrink-0">${r.received_date ? formatDateShort(r.received_date + 'T12:00:00') : ''}</span>
        <select class="rec-status ${r.status}" data-rec-status="${r.id}">
          <option value="new" ${r.status==='new'?'selected':''}>New</option>
          <option value="replied" ${r.status==='replied'?'selected':''}>Replied</option>
          <option value="interviewing" ${r.status==='interviewing'?'selected':''}>Interviewing</option>
          <option value="passed" ${r.status==='passed'?'selected':''}>Passed</option>
          <option value="no_response" ${r.status==='no_response'?'selected':''}>No Response</option>
        </select>
        <button class="text-gray-300 hover:text-gray-600 text-lg leading-none transition-colors shrink-0" data-del-rec="${r.id}" aria-label="Delete">×</button>
      </div>
      <div class="app-feedback">
        <div class="app-feedback-label">Notes / next steps</div>
        <textarea class="app-feedback-input" data-rec-notes="${r.id}" placeholder="What did they say? What's your next step?">${escapeHtml(r.notes || '')}</textarea>
        <div class="app-feedback-saved" id="rec-saved-${r.id}"></div>
      </div>
    </li>`).join('');

  list.querySelectorAll('[data-rec-status]').forEach(sel => {
    sel.addEventListener('change', () => onUpdateRecruiterEmailStatus(sel.dataset.recStatus, sel.value));
  });
  list.querySelectorAll('[data-del-rec]').forEach(btn => {
    btn.addEventListener('click', () => onDeleteRecruiterEmail(btn.dataset.delRec));
  });
  list.querySelectorAll('[data-rec-notes]').forEach(ta => {
    ta.addEventListener('blur', () => onSaveRecruiterNotes(ta.dataset.recNotes, ta.value));
  });
}

async function onAddRecruiterEmail() {
  const company = document.getElementById('recCompany').value.trim();
  const contact = document.getElementById('recContact').value.trim();
  const subject = document.getElementById('recSubject').value.trim();
  const date = document.getElementById('recDate').value;
  if (!company) return;
  try {
    const row = await addRecruiterEmail({ company, contact_name: contact, subject, received_date: date || todayKey() });
    state.recruiterEmails.unshift(row);
    document.getElementById('recCompany').value = '';
    document.getElementById('recContact').value = '';
    document.getElementById('recSubject').value = '';
    document.getElementById('recDate').value = todayKey();
    renderRecruiterStats(); renderRecruiterEmails();
    document.getElementById('recCompany').focus();
  } catch (e) { alert('Could not save: ' + e.message); }
}

async function onUpdateRecruiterEmailStatus(id, status) {
  try {
    await updateRecruiterEmailStatus(id, status);
    const rec = state.recruiterEmails.find(r => r.id === id);
    if (rec) rec.status = status;
    renderRecruiterEmails();
  } catch (e) { alert('Could not update: ' + e.message); }
}

async function onSaveRecruiterNotes(id, notes) {
  try {
    await updateRecruiterEmailNotes(id, notes);
    const rec = state.recruiterEmails.find(r => r.id === id);
    if (rec) rec.notes = notes;
    const savedEl = document.getElementById(`rec-saved-${id}`);
    if (savedEl) { savedEl.textContent = 'Saved'; setTimeout(() => { savedEl.textContent = ''; }, 2000); }
  } catch (e) { alert('Could not save notes: ' + e.message); }
}

async function onDeleteRecruiterEmail(id) {
  try {
    await deleteRecruiterEmail(id);
    state.recruiterEmails = state.recruiterEmails.filter(r => r.id !== id);
    renderRecruiterStats(); renderRecruiterEmails();
  } catch (e) { alert('Could not delete: ' + e.message); }
}

// ---------- RENDER: study plan ----------
function getCurrentStudyWeek() {
  const start = localStorage.getItem('studyPlanStart');
  if (!start) return 1;
  const days = Math.floor((Date.now() - new Date(start).getTime()) / 86400000);
  return Math.min(Math.max(Math.floor(days / 7) + 1, 1), 8);
}

function renderStudyStats() {
  const tasks = state.studyTasks;
  const done = tasks.filter(t => t.done).length;
  const pct = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
  document.getElementById('studyTotal').textContent = tasks.length;
  document.getElementById('studyDone').textContent = done;
  document.getElementById('studyPct').textContent = pct;
  document.getElementById('studyFill').style.width = pct + '%';
}

function renderStudyPlan() {
  const container = document.getElementById('studyWeeks');
  const byWeek = {};
  for (let w = 1; w <= 8; w++) byWeek[w] = [];
  state.studyTasks.forEach(t => { if (byWeek[t.week]) byWeek[t.week].push(t); });
  const current = getCurrentStudyWeek();

  container.innerHTML = Array.from({ length: 8 }, (_, i) => i + 1).map(week => {
    const tasks = byWeek[week];
    const done = tasks.filter(t => t.done).length;
    const pct = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
    const isExpanded = expandedWeeks.has(week);
    const isCurrent = week === current;

    return `<div class="border-b border-gray-100 last:border-0">
      <div class="flex items-center justify-between py-3 cursor-pointer hover:bg-gray-50 rounded-lg -mx-2 px-2 transition-colors" data-toggle-week="${week}">
        <div class="flex items-center gap-3">
          <span class="${isCurrent ? 'text-sm font-bold text-gray-900' : 'text-sm font-medium text-gray-500'}">Week ${week}</span>
          ${isCurrent ? '<span class="text-xs bg-gray-900 text-white rounded-full px-2 py-0.5 font-mono leading-none">now</span>' : ''}
          <span class="text-xs text-gray-400">${WEEK_TITLES[week]}</span>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <span class="text-xs text-gray-400 font-mono">${done}/${tasks.length}</span>
          <div class="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full bg-gray-900 rounded-full" style="width:${pct}%"></div>
          </div>
          <span class="text-xs text-gray-400">${isExpanded ? '▴' : '▾'}</span>
        </div>
      </div>
      <div${isExpanded ? '' : ' style="display:none"'} class="pb-3">
        <ul>
          ${tasks.map(t => `<li class="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0 ${t.done ? 'prep-done' : ''}">
            <input type="checkbox" class="w-4 h-4 rounded border-gray-300 cursor-pointer shrink-0" style="accent-color:#111827" data-study-toggle="${t.id}" ${t.done ? 'checked' : ''}>
            <span class="badge ${STUDY_CAT_BADGE[t.category] || 'badge-other'}">${STUDY_CAT_LABEL[t.category] || t.category}</span>
            <label class="flex-1 text-sm cursor-pointer ${t.done ? 'line-through text-gray-400' : 'text-gray-700'}" data-study-toggle-label="${t.id}">${escapeHtml(t.text)}</label>
            <button class="text-gray-300 hover:text-gray-600 text-lg leading-none transition-colors shrink-0" data-del-study="${t.id}">×</button>
          </li>`).join('')}
        </ul>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('[data-toggle-week]').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const w = parseInt(hdr.dataset.toggleWeek);
      if (expandedWeeks.has(w)) expandedWeeks.delete(w); else expandedWeeks.add(w);
      renderStudyPlan();
    });
  });
  container.querySelectorAll('[data-study-toggle]').forEach(cb => {
    cb.addEventListener('change', () => onToggleStudyTask(cb.dataset.studyToggle, cb.checked));
  });
  container.querySelectorAll('[data-study-toggle-label]').forEach(lbl => {
    lbl.addEventListener('click', () => {
      const t = state.studyTasks.find(t => t.id === lbl.dataset.studyToggleLabel);
      if (t) onToggleStudyTask(t.id, !t.done);
    });
  });
  container.querySelectorAll('[data-del-study]').forEach(btn => {
    btn.addEventListener('click', () => onDeleteStudyTask(btn.dataset.delStudy));
  });
}

function setupStudyPlanStartDate() {
  const input = document.getElementById('studyStartDate');
  const saved = localStorage.getItem('studyPlanStart');
  if (saved) input.value = saved;
  input.addEventListener('change', () => {
    if (input.value) localStorage.setItem('studyPlanStart', input.value);
    else localStorage.removeItem('studyPlanStart');
    expandedWeeks.clear();
    expandedWeeks.add(getCurrentStudyWeek());
    renderStudyPlan();
  });
}

async function onAddStudyTask() {
  const week = parseInt(document.getElementById('studyWeekSel').value);
  const category = document.getElementById('studyCatSel').value;
  const text = document.getElementById('studyTaskInput').value.trim();
  if (!text) return;
  try {
    const row = await addStudyTask({ week, category, text });
    state.studyTasks.push(row);
    document.getElementById('studyTaskInput').value = '';
    expandedWeeks.add(week);
    renderStudyStats(); renderStudyPlan();
    document.getElementById('studyTaskInput').focus();
  } catch (e) { alert('Could not save: ' + e.message); }
}

async function onToggleStudyTask(id, done) {
  try {
    await toggleStudyTask(id, done);
    const t = state.studyTasks.find(t => t.id === id);
    if (t) t.done = done;
    renderStudyStats(); renderStudyPlan();
  } catch (e) { alert('Could not update: ' + e.message); }
}

async function onDeleteStudyTask(id) {
  try {
    await deleteStudyTask(id);
    state.studyTasks = state.studyTasks.filter(t => t.id !== id);
    renderStudyStats(); renderStudyPlan();
  } catch (e) { alert('Could not delete: ' + e.message); }
}

// ---------- RENDER: prep ----------
function renderPrep() {
  let total = 0, done = 0;
  for (const group of Object.keys(state.prep)) {
    const ul = document.querySelector(`[data-list="${group}"]`);
    if (!ul) continue;
    const items = state.prep[group];
    total += items.length;
    done += items.filter(i => i.done).length;
    if (items.length === 0) {
      ul.innerHTML = `<div class="py-4 text-center"><p class="text-xs text-gray-300">No tasks — add one below</p></div>`;
      continue;
    }
    ul.innerHTML = items.map(item => `
      <li class="prep-item flex items-center gap-3 py-2 border-b border-gray-100 last:border-0 ${item.done ? 'prep-done' : ''}">
        <input type="checkbox" class="w-4 h-4 rounded border-gray-300 cursor-pointer shrink-0" style="accent-color:#111827" data-toggle="${group}:${item.id}" ${item.done ? 'checked' : ''}>
        <label class="flex-1 text-sm cursor-pointer ${item.done ? 'line-through text-gray-400' : 'text-gray-700'}" data-toggle-label="${group}:${item.id}">${escapeHtml(item.text)}</label>
        <button class="text-gray-300 hover:text-gray-600 text-lg leading-none transition-colors shrink-0" data-del-prep="${group}:${item.id}" aria-label="Delete">×</button>
      </li>`).join('');
  }

  document.querySelectorAll('[data-toggle]').forEach(cb => {
    cb.addEventListener('change', () => onTogglePrep(cb.dataset.toggle, cb.checked));
  });
  document.querySelectorAll('[data-toggle-label]').forEach(lbl => {
    lbl.addEventListener('click', () => {
      const ref = lbl.dataset.toggleLabel;
      const [group, id] = ref.split(':');
      const item = state.prep[group].find(i => i.id === id);
      if (item) onTogglePrep(ref, !item.done);
    });
  });
  document.querySelectorAll('[data-del-prep]').forEach(btn => {
    btn.addEventListener('click', () => onDeletePrep(btn.dataset.delPrep));
  });

  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  document.getElementById('prepPct').textContent = pct;
  document.getElementById('prepFill').style.width = pct + '%';
}

async function onTogglePrep(ref, done) {
  const [group, id] = ref.split(':');
  try {
    await togglePrepTask(id, done);
    const item = state.prep[group].find(i => i.id === id);
    if (item) item.done = done;
    renderPrep();
  } catch (e) { alert('Could not update: ' + e.message); }
}

async function onDeletePrep(ref) {
  const [group, id] = ref.split(':');
  try {
    await deletePrepTask(id);
    state.prep[group] = state.prep[group].filter(i => i.id !== id);
    renderPrep();
  } catch (e) { alert('Could not delete: ' + e.message); }
}

async function onAddPrep(group) {
  const input = document.querySelector(`[data-add="${group}"]`);
  const text = input.value.trim();
  if (!text) return;
  try {
    const row = await addPrepTask({ group_name: group, text });
    state.prep[group].push(row);
    input.value = '';
    renderPrep();
    input.focus();
  } catch (e) { alert('Could not save: ' + e.message); }
}

// ---------- HELPERS: Find Jobs ----------
function parseHNComment(text) {
  const firstLine = text.split('\n')[0].trim();
  const parts = firstLine.split('|').map(p => p.trim());
  if (parts.length >= 2) return { company: parts[0].substring(0, 60), role: parts[1].substring(0, 80) };
  return { company: firstLine.substring(0, 60), role: '' };
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

function getCompanyDomain(company) {
  return company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
}

function getInitials(company) {
  return company.split(/\s+/).map(w => w[0] || '').join('').toUpperCase().substring(0, 2) || '?';
}

function buildCalendarUrl(entry) {
  const title = encodeURIComponent(`[${entry.category}] ${entry.text}`);
  const date = entry.entry_date.replace(/-/g, '');
  let dates;
  if (entry.start_time && entry.end_time) {
    const s = entry.start_time.replace(/:/g, '').substring(0, 4) + '00';
    const e = entry.end_time.replace(/:/g, '').substring(0, 4) + '00';
    dates = `${date}T${s}/${date}T${e}`;
  } else {
    const d = new Date(entry.entry_date + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    const next = d.toISOString().slice(0, 10).replace(/-/g, '');
    dates = `${date}/${next}`;
  }
  const details = encodeURIComponent(`Logged in SmartDayAI · ${entry.category}${entry.duration ? ` · ${formatDuration(entry.duration)}` : ''}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}`;
}

// ---------- FIND JOBS ----------
function jobResultCard(company, role, preview, hnId, remUrl) {
  const addAttr = hnId
    ? `data-add-company="${escapeHtml(company)}" data-add-role="${escapeHtml(role)}"`
    : `data-add-company="${escapeHtml(company)}" data-add-role="${escapeHtml(role)}"`;
  const linkHtml = hnId
    ? `<a href="https://news.ycombinator.com/item?id=${hnId}" target="_blank" class="text-xs text-gray-400 hover:text-gray-700 transition-colors">HN ↗</a>`
    : `<a href="${remUrl}" target="_blank" class="text-xs text-gray-400 hover:text-gray-700 transition-colors">View ↗</a>`;
  return `<div class="border border-gray-100 rounded-lg p-4">
    <div class="flex items-start justify-between gap-3">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-gray-900">${escapeHtml(company)}${role ? ` — <span class="font-normal text-gray-600">${escapeHtml(role)}</span>` : ''}</div>
        <p class="text-xs text-gray-400 mt-1 leading-relaxed line-clamp-3">${escapeHtml(preview)}</p>
      </div>
      <div class="flex flex-col gap-1.5 shrink-0 items-end">
        ${linkHtml}
        <button class="text-xs bg-gray-900 text-white rounded px-2.5 py-1 hover:bg-gray-700 transition-colors whitespace-nowrap" ${addAttr}>+ Add</button>
      </div>
    </div>
  </div>`;
}

async function renderHNResults(keyword) {
  const container = document.getElementById('hnResults');
  container.innerHTML = '<p class="text-sm text-gray-400 py-4 text-center">Loading…</p>';
  try {
    if (!hnPostId) {
      const post = await fetchLatestHNHiringPost();
      if (!post) { container.innerHTML = '<p class="text-sm text-red-400">Could not find the HN hiring post.</p>'; return; }
      hnPostId = post.objectID;
      document.getElementById('hnPostTitle').textContent = post.title;
    }
    const hits = await searchHNJobs(hnPostId, keyword);
    if (!hits.length) { container.innerHTML = '<p class="text-sm text-gray-400 py-4 text-center">No results — try a different keyword.</p>'; return; }
    container.innerHTML = hits.map(hit => {
      const text = stripHtml(hit.comment_text || '');
      const parsed = parseHNComment(text);
      return jobResultCard(parsed.company, parsed.role, text.substring(0, 220), hit.objectID, null);
    }).join('');
    bindAddButtons(container);
  } catch (e) {
    container.innerHTML = `<p class="text-sm text-red-400">Error: ${e.message}</p>`;
  }
}

async function renderRemotiveResults(keyword) {
  const container = document.getElementById('remotiveResults');
  if (!keyword) { container.innerHTML = '<p class="text-sm text-gray-400">Enter a keyword to search remote jobs.</p>'; return; }
  container.innerHTML = '<p class="text-sm text-gray-400 py-4 text-center">Loading…</p>';
  try {
    const jobs = await searchRemotiveJobs(keyword);
    if (!jobs.length) { container.innerHTML = '<p class="text-sm text-gray-400 py-4 text-center">No results — try a different keyword.</p>'; return; }
    container.innerHTML = jobs.map(job => {
      const meta = [job.job_type, job.candidate_required_location].filter(Boolean).join(' · ');
      return jobResultCard(job.company_name, job.title, meta, null, job.url);
    }).join('');
    bindAddButtons(container);
  } catch (e) {
    container.innerHTML = `<p class="text-sm text-red-400">Error: ${e.message}</p>`;
  }
}

function bindAddButtons(container) {
  container.querySelectorAll('[data-add-company]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const company = btn.dataset.addCompany, role = btn.dataset.addRole;
      try {
        const row = await addApplication({ company, role });
        state.applications.unshift(row);
        btn.textContent = '✓ Added';
        btn.disabled = true;
        renderAppStats();
      } catch (e) { alert('Could not add: ' + e.message); }
    });
  });
}

// ---------- RENDER: per-day pie chart ----------
function renderDayChart(date, entries) {
  const CATS = ['apply', 'learn', 'network', 'interview', 'cook', 'resume', 'entertainment', 'family', 'other'];
  const COLORS = {
    apply: '#e8614a', learn: '#7ab55a', network: '#e8b84a',
    interview: '#5a7abf', cook: '#e89a5a', resume: '#a07abf',
    entertainment: '#c06abf', family: '#2db0c8', other: '#b0a890'
  };
  const LABELS = {
    apply: 'Apply', learn: 'Learn', network: 'Network',
    interview: 'Interview', cook: 'Cook', resume: 'Resume/LinkedIn',
    entertainment: 'Entertainment', family: 'Family Time', other: 'Other'
  };

  const canvas = document.getElementById(`chart-${date}`);
  if (!canvas) return;

  const totals = Object.fromEntries(CATS.map(c => [c, 0]));
  entries.forEach(e => { totals[e.category] += (e.duration || 0); });

  // fall back to count-based if no entries have durations
  const hasDuration = entries.some(e => e.duration > 0);
  if (!hasDuration) {
    entries.forEach(e => { totals[e.category]++; });
  }

  const active = CATS.filter(c => totals[c] > 0);
  if (active.length === 0) { canvas.style.display = 'none'; return; }

  dayCharts[date] = new window.Chart(canvas, {
    type: 'pie',
    data: {
      labels: active.map(c => LABELS[c]),
      datasets: [{ data: active.map(c => totals[c]), backgroundColor: active.map(c => COLORS[c]), borderColor: '#f4ede1', borderWidth: 2 }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { family: 'Geist', size: 12 },
            color: '#1a1a1a',
            padding: 14,
            generateLabels: (chart) => chart.data.labels.map((lbl, i) => {
              const v = chart.data.datasets[0].data[i];
              const text = hasDuration ? `${lbl} — ${formatDuration(v)}` : `${lbl} — ${v} ${v === 1 ? 'entry' : 'entries'}`;
              return { text, fillStyle: chart.data.datasets[0].backgroundColor[i], strokeStyle: '#f4ede1', lineWidth: 1, hidden: false, index: i };
            })
          }
        },
        tooltip: {
          callbacks: { label: (ctx) => hasDuration ? ` ${formatDuration(ctx.raw)}` : ` ${ctx.raw} ${ctx.raw === 1 ? 'entry' : 'entries'}` }
        }
      }
    }
  });
}

// ---------- GOOGLE CALENDAR ----------
function initGcal() {
  updateGcalBtn();
  if (!GCAL_CLIENT_ID || typeof google === 'undefined' || !google.accounts) return;
  _gcalClient = google.accounts.oauth2.initTokenClient({
    client_id: GCAL_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
    callback: async resp => {
      if (resp.error) { console.error('GCal OAuth:', resp.error); return; }
      gcalToken = resp.access_token;
      gcalTokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      gcalEvents = {};
      updateGcalBtn();
      await loadGcalForExpandedDays();
    }
  });
  updateGcalBtn();
}

function updateGcalBtn() {
  const btn = document.getElementById('gcalConnectBtn');
  if (!btn) return;
  if (!GCAL_CLIENT_ID) { btn.style.display = 'none'; return; }
  const connected = gcalToken && Date.now() < gcalTokenExpiry;
  btn.textContent = connected ? '📅 Calendar synced' : '📅 Connect Calendar';
  btn.className = connected
    ? 'text-xs text-emerald-600 font-mono cursor-default'
    : 'text-xs text-blue-500 hover:text-blue-700 font-semibold transition-colors';
}

function connectGcal() {
  if (!GCAL_CLIENT_ID) return;
  if (!_gcalClient) {
    if (typeof google === 'undefined') { alert('Google script still loading — try again in a moment.'); return; }
    initGcal();
  }
  if (gcalToken && Date.now() < gcalTokenExpiry) return; // already connected
  _gcalClient?.requestAccessToken();
}

function gcalDateKey(ev) {
  if (ev.start.date) return ev.start.date;
  const d = new Date(ev.start.dateTime);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function loadGcalForExpandedDays() {
  if (!gcalToken || Date.now() > gcalTokenExpiry) return;
  const needed = [...expandedDays].filter(d => !(d in gcalEvents));
  if (needed.length) await fetchGcalRange(needed);
  [...expandedDays].forEach(renderGcalStrip);
}

async function fetchGcalRange(dates) {
  const sorted = [...dates].sort();
  const timeMin = encodeURIComponent(`${sorted[0]}T00:00:00`);
  const timeMax = encodeURIComponent(`${sorted[sorted.length-1]}T23:59:59`);
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=100`,
      { headers: { Authorization: `Bearer ${gcalToken}` } }
    );
    if (res.status === 401) { gcalToken = null; updateGcalBtn(); return; }
    if (!res.ok) throw new Error(`GCal ${res.status}`);
    const data = await res.json();
    dates.forEach(d => { gcalEvents[d] = []; });
    (data.items || []).forEach(ev => {
      const d = gcalDateKey(ev);
      if (gcalEvents[d]) gcalEvents[d].push(ev);
    });
  } catch (e) { console.error('GCal fetch:', e); }
}

function gcalFmtTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function renderGcalStrip(date) {
  const el = document.getElementById(`gcal-${date}`);
  if (!el) return;
  const evs = gcalEvents[date];
  if (!evs?.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="mt-3 pt-3 border-t border-blue-100">
      <div class="text-xs text-blue-400 font-mono uppercase tracking-wide mb-2">📅 Google Calendar</div>
      ${evs.map((ev, i) => {
        const allDay = !ev.start.dateTime;
        const timeStr = allDay ? 'All day' : `${gcalFmtTime(ev.start.dateTime)} – ${gcalFmtTime(ev.end.dateTime)}`;
        return `<div class="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0 rounded px-1 hover:bg-blue-50 transition-colors">
          <span class="text-xs text-gray-400 font-mono w-36 shrink-0">${timeStr}</span>
          <span class="flex-1 text-sm text-gray-600">${escapeHtml(ev.summary || 'Untitled')}</span>
          <button class="text-xs text-blue-400 hover:text-blue-700 font-mono shrink-0 transition-colors"
            data-gcal-date="${date}" data-gcal-idx="${i}">+ log it</button>
        </div>`;
      }).join('')}
    </div>`;
  el.querySelectorAll('[data-gcal-date]').forEach(btn => {
    btn.addEventListener('click', () => importGcalEvent(btn.dataset.gcalDate, parseInt(btn.dataset.gcalIdx)));
  });
}

function importGcalEvent(date, idx) {
  const ev = gcalEvents[date]?.[idx];
  if (!ev) return;
  document.getElementById('entryText').value = ev.summary || '';
  document.getElementById('entryDate').value = date;
  if (ev.start.dateTime) {
    const s = new Date(ev.start.dateTime), e = new Date(ev.end.dateTime);
    setGcalSelects('entryStart', s.getHours(), s.getMinutes());
    setGcalSelects('entryEnd',   e.getHours(), e.getMinutes());
  }
  document.getElementById('entryText').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('entryText').focus();
}

function setGcalSelects(prefix, h, m) {
  document.getElementById(`${prefix}Hour`).value  = String(h % 12 || 12);
  document.getElementById(`${prefix}Min`).value   = String(Math.round(m / 15) * 15 % 60).padStart(2, '0');
  document.getElementById(`${prefix}Ampm`).value  = h >= 12 ? 'PM' : 'AM';
}

// ---------- SUMMARY ----------
const SUMMARY_CAT_LABELS = { apply:'Apply', learn:'Learn', network:'Network', interview:'Interview', cook:'Cook', resume:'Resume', entertainment:'Fun', family:'Family', other:'Other' };

function renderSummary() {
  const el = document.getElementById('summaryContent');
  if (!el) return;

  const today = todayKey();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (summaryPeriod - 1));
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}-${String(cutoff.getDate()).padStart(2,'0')}`;
  const filtered = state.entries.filter(e => e.entry_date >= cutoffKey && e.entry_date <= today);

  document.querySelectorAll('.summary-period').forEach(btn => {
    const active = parseInt(btn.dataset.days) === summaryPeriod;
    btn.className = `summary-period px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`;
  });

  if (filtered.length === 0) {
    el.innerHTML = `<p class="text-sm text-gray-400 text-center py-4">No entries in the last ${summaryPeriod} days.</p>`;
    return;
  }

  const totalMin = filtered.reduce((s, e) => s + (e.duration || 0), 0);
  const activeDays = new Set(filtered.map(e => e.entry_date)).size;
  const byCat = {};
  filtered.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + 1; });
  const topCat = Object.entries(byCat).sort((a,b) => b[1]-a[1])[0];
  const maxCount = Math.max(...Object.values(byCat));

  const catBars = Object.entries(byCat).sort((a,b) => b[1]-a[1]).map(([cat, count]) => {
    const w = Math.round((count / maxCount) * 100);
    return `<div class="flex items-center gap-2.5 mb-2">
      <span class="w-20 text-xs text-gray-500 text-right shrink-0">${SUMMARY_CAT_LABELS[cat] || cat}</span>
      <div class="flex-1 bg-gray-100 rounded-full h-1.5">
        <div class="h-1.5 rounded-full bg-gray-800 transition-all" style="width:${w}%"></div>
      </div>
      <span class="text-xs text-gray-400 font-mono w-16 shrink-0">${count} ${count===1?'entry':'entries'}</span>
    </div>`;
  }).join('');

  const savedKey = localStorage.getItem('smartdayai_anthropic_key') || '';

  el.innerHTML = `
    <div class="grid grid-cols-4 gap-3 mb-5">
      <div class="bg-gray-50 rounded-xl p-4">
        <div class="text-xs text-gray-400 font-mono uppercase tracking-wide mb-1.5">Time logged</div>
        <div class="text-xl font-bold text-gray-900">${totalMin ? formatDuration(totalMin) : '—'}</div>
      </div>
      <div class="bg-gray-50 rounded-xl p-4">
        <div class="text-xs text-gray-400 font-mono uppercase tracking-wide mb-1.5">Active days</div>
        <div class="text-xl font-bold text-gray-900">${activeDays}<span class="text-sm font-normal text-gray-400 ml-1">/ ${summaryPeriod}</span></div>
      </div>
      <div class="bg-gray-50 rounded-xl p-4">
        <div class="text-xs text-gray-400 font-mono uppercase tracking-wide mb-1.5">Entries</div>
        <div class="text-xl font-bold text-gray-900">${filtered.length}</div>
      </div>
      <div class="bg-gray-50 rounded-xl p-4">
        <div class="text-xs text-gray-400 font-mono uppercase tracking-wide mb-1.5">Top focus</div>
        <div class="text-xl font-bold text-gray-900">${topCat ? (SUMMARY_CAT_LABELS[topCat[0]] || topCat[0]) : '—'}</div>
      </div>
    </div>
    <div class="mb-5">${catBars}</div>
    <div class="border-t border-gray-100 pt-4">
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs text-gray-400 font-mono uppercase tracking-wide">AI Summary</span>
        <div class="flex items-center gap-2">
          <button id="summaryKeyToggle" class="text-xs text-gray-400 hover:text-gray-600 transition-colors" title="API key">⚙</button>
          <button id="generateSummaryBtn" class="bg-gray-900 text-white rounded-lg px-4 py-1.5 text-xs font-semibold hover:bg-gray-700 transition-colors flex items-center gap-1.5">✦ Generate</button>
        </div>
      </div>
      <div id="summaryKeyRow" class="mb-3 hidden">
        <input type="password" id="summaryApiKey" placeholder="Anthropic API key — sk-ant-..." value="${escapeHtml(savedKey)}"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-gray-900 transition-colors">
        <button id="summaryKeySave" class="mt-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors">Save key →</button>
      </div>
      <div id="aiSummaryOutput" class="text-sm text-gray-700 leading-relaxed"></div>
    </div>`;

  document.getElementById('summaryKeyToggle').addEventListener('click', () => {
    document.getElementById('summaryKeyRow').classList.toggle('hidden');
    document.getElementById('summaryApiKey').focus();
  });
  document.getElementById('summaryKeySave').addEventListener('click', () => {
    const k = document.getElementById('summaryApiKey').value.trim();
    if (k) localStorage.setItem('smartdayai_anthropic_key', k);
    document.getElementById('summaryKeyRow').classList.add('hidden');
  });
  document.getElementById('generateSummaryBtn').addEventListener('click', generateAISummary);
}

async function generateAISummary() {
  const apiKey = localStorage.getItem('smartdayai_anthropic_key');
  const output = document.getElementById('aiSummaryOutput');
  const btn = document.getElementById('generateSummaryBtn');

  if (!apiKey) {
    document.getElementById('summaryKeyRow').classList.remove('hidden');
    document.getElementById('summaryApiKey').focus();
    return;
  }

  const today = todayKey();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (summaryPeriod - 1));
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}-${String(cutoff.getDate()).padStart(2,'0')}`;
  const filtered = state.entries.filter(e => e.entry_date >= cutoffKey && e.entry_date <= today);
  if (!filtered.length) return;

  const byDate = {};
  filtered.forEach(e => { (byDate[e.entry_date] = byDate[e.entry_date] || []).push(e); });
  const entriesText = Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b)).map(([date, es]) => {
    const [y,m,d] = date.split('-').map(Number);
    const label = new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    return `${label}:\n${es.map(e=>`  - [${e.category}] ${e.text}${e.duration?` (${formatDuration(e.duration)})`:''}` ).join('\n')}`;
  }).join('\n\n');

  btn.disabled = true;
  btn.textContent = 'Generating…';
  output.textContent = '';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{ role: 'user', content: `I'm on a job search after being laid off. Here are my activities for the last ${summaryPeriod} days:\n\n${entriesText}\n\nWrite a brief, warm 2-3 sentence summary of what I accomplished. Be specific and encouraging without being cheesy.` }]
      })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || `Error ${res.status}`); }
    const data = await res.json();
    output.textContent = data.content[0].text;
  } catch (e) {
    output.innerHTML = `<span class="text-red-500 text-xs">${escapeHtml(e.message)}</span>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✦ Generate';
  }
}

// ---------- ORCHESTRATION ----------
function renderAll() {
  renderLogStats(); renderEntries(); renderSummary();
  renderAppStats(); renderApps();
  renderPrep();
  renderRecruiterStats(); renderRecruiterEmails();
  renderStudyStats(); renderStudyPlan();
}

async function loadAllData() {
  const [entries, applications, prep, recruiterEmails, studyTasks] = await Promise.all([
    listEntries(), listApplications(), listPrepTasks(), listRecruiterEmails(), listStudyTasks()
  ]);
  state.entries = entries;
  state.applications = applications;
  state.prep = prep;
  state.recruiterEmails = recruiterEmails;
  state.studyTasks = studyTasks;
  state.interviewRounds = {};
  // interview_rounds table requires migration_v2.sql — fail silently if not run yet
  try {
    const rounds = await listInterviewRounds();
    rounds.forEach(r => {
      if (!state.interviewRounds[r.application_id]) state.interviewRounds[r.application_id] = [];
      state.interviewRounds[r.application_id].push(r);
    });
  } catch (_) {}
}

function setQuote() {
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  document.getElementById('quote').textContent = `"${q.q}"`;
  document.querySelector('.footer-author').textContent = q.a;
}

// ---------- TIME PICKER ----------
function bindAppEvents() {
  const entryDate = document.getElementById('entryDate');
  const today = todayKey();
  entryDate.value = today;
  entryDate.max = today;
  entryDate.addEventListener('change', () => {
    const errEl = document.getElementById('entryDateError');
    if (entryDate.value > today) {
      errEl.textContent = "Can't log entries in the future.";
      errEl.classList.remove('hidden');
    } else {
      errEl.classList.add('hidden');
    }
  });

  document.querySelectorAll('.summary-period').forEach(btn => {
    btn.addEventListener('click', () => { summaryPeriod = parseInt(btn.dataset.days); renderSummary(); });
  });

  document.getElementById('gcalConnectBtn').addEventListener('click', connectGcal);

  document.getElementById('addEntry').addEventListener('click', onAddEntry);
  document.getElementById('entryText').addEventListener('keydown', e => { if (e.key === 'Enter') onAddEntry(); });

  document.getElementById('addApp').addEventListener('click', onAddApp);
  ['appCompany', 'appRole'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') onAddApp(); });
  });

  document.querySelectorAll('[data-add-btn]').forEach(btn => {
    btn.addEventListener('click', () => onAddPrep(btn.dataset.addBtn));
  });
  document.querySelectorAll('[data-add]').forEach(inp => {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') onAddPrep(inp.dataset.add); });
  });

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await signOut();
  });

  // Study Plan
  setupStudyPlanStartDate();
  document.getElementById('addStudyTask').addEventListener('click', onAddStudyTask);
  document.getElementById('studyTaskInput').addEventListener('keydown', e => { if (e.key === 'Enter') onAddStudyTask(); });

  // Recruiter Inbox
  document.getElementById('addRecEmail').addEventListener('click', onAddRecruiterEmail);
  ['recCompany', 'recContact', 'recSubject'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') onAddRecruiterEmail(); });
  });
  document.getElementById('recDate').value = todayKey();

  // Find Jobs
  const hnSearchEl = document.getElementById('hnSearch');
  const remotiveSearchEl = document.getElementById('remotiveSearch');
  document.getElementById('hnSearchBtn').addEventListener('click', () => renderHNResults(hnSearchEl.value.trim()));
  hnSearchEl.addEventListener('keydown', e => { if (e.key === 'Enter') renderHNResults(hnSearchEl.value.trim()); });
  document.getElementById('remotiveSearchBtn').addEventListener('click', () => renderRemotiveResults(remotiveSearchEl.value.trim()));
  remotiveSearchEl.addEventListener('keydown', e => { if (e.key === 'Enter') renderRemotiveResults(remotiveSearchEl.value.trim()); });
  document.querySelector('[data-tab="find"]').addEventListener('click', () => { if (!hnPostId) renderHNResults(''); });
}

async function showApp(user) {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appContainer').style.display = 'block';
  document.getElementById('userEmail').textContent = user.email;
  document.getElementById('todayDate').textContent = formatDate();
  document.getElementById('todayShort').textContent = formatShort();
  setQuote();
  await loadAllData();
  renderAll();
  setTimeout(initGcal, 1500); // wait for GIS script to load
}

function showAuth() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';
  // Reset state so signing out of one account clears the previous user's data.
  state = { entries: [], applications: [], prep: { foundation: [], skills: [], outreach: [], logistics: [] }, recruiterEmails: [], studyTasks: [], interviewRounds: {} };
}

async function init() {
  setupAuth();
  setupTabs();
  bindAppEvents();

  // React to auth state changes (login, logout, token refresh)
  onAuthChange((user) => {
    if (user) showApp(user);
    else showAuth();
  });

  const user = await getUser();
  if (user) showApp(user);
  else showAuth();
}

init();
