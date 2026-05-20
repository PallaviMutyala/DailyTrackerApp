// =====================================================================
// app.js — Cadence UI logic, backed by Supabase
// =====================================================================

import {
  signUp, signIn, signOut, getUser, onAuthChange,
  listEntries, addEntry, deleteEntry,
  listApplications, addApplication, updateApplicationStatus, updateApplicationFeedback, deleteApplication,
  listPrepTasks, addPrepTask, togglePrepTask, deletePrepTask
} from './db.js';

const QUOTES = [
  { q: "Discipline equals freedom.", a: "Jocko Willink" },
  { q: "The cure for anything is salt water — sweat, tears, or the sea.", a: "Isak Dinesen" },
  { q: "Do the work. Do the work. Do the work.", a: "Anonymous" },
  { q: "The obstacle is the way.", a: "Marcus Aurelius" },
  { q: "Action is the antidote to despair.", a: "Joan Baez" },
  { q: "What you do every day matters more than what you do once in a while.", a: "Gretchen Rubin" },
  { q: "The way out is through.", a: "Robert Frost" }
];

let state = { entries: [], applications: [], prep: { foundation: [], skills: [], outreach: [], logistics: [] } };
const expandedDays = new Set([todayKey()]);
const dayCharts = {};

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
  if (!min) return `0<span class="unit">min</span>`;
  if (min < 60) return `${min}<span class="unit">min</span>`;
  const h = Math.floor(min / 60), m = min % 60;
  return m === 0 ? `${h}<span class="unit">hr</span>` : `${h}<span class="unit">h</span> ${m}<span class="unit">m</span>`;
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
  document.getElementById('streak').innerHTML = `${computeStreak()}<span class="unit">days</span>`;
  document.getElementById('totalCount').textContent = state.entries.length;
  document.getElementById('overDayWarning').style.display = todayMin > 1440 ? 'block' : 'none';
}

function renderEntries() {
  Object.values(dayCharts).forEach(c => c.destroy());
  for (const k of Object.keys(dayCharts)) delete dayCharts[k];

  const container = document.getElementById('entriesList');
  if (state.entries.length === 0) {
    container.innerHTML = `<div class="empty"><div class="empty-quote">"Begin where you are."</div><div class="empty-sub">No entries yet — log your first above</div></div>`;
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

    return `<div class="day-section" data-date="${date}">
      <div class="day-header" data-toggle-day="${date}">
        <div class="day-header-left">
          <span class="day-label${isToday ? ' today' : ''}">${label}</span>
          <span class="day-meta">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${totalMin ? ` · ${formatDuration(totalMin)}` : ''}${sessionSummary ? ` · ${sessionSummary}` : ''}</span>
        </div>
        <span class="day-chevron">${isExpanded ? '▴' : '▾'}</span>
      </div>
      <div class="day-body"${isExpanded ? '' : ' style="display:none"'}>
        <ul class="entries-inner">
          ${entries.map(e => `<li class="entry">
            <span class="entry-cat ${e.category}">${{resume:'résumé',entertainment:'leisure',family:'family'}[e.category] ?? e.category}</span>
            <span class="entry-text">${escapeHtml(e.text)}</span>
            <span class="entry-meta">
              ${e.start_time && e.end_time
                ? `<span class="entry-timerange">${formatTimeStr(e.start_time)} – ${formatTimeStr(e.end_time)}</span>`
                : e.duration ? `<span class="entry-duration">${formatDuration(e.duration)}</span>` : ''}
              <button class="icon-btn" data-del-entry="${e.id}" aria-label="Delete">✕</button>
            </span>
          </li>`).join('')}
        </ul>
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
}

async function onAddEntry() {
  const input = document.getElementById('entryText');
  const startInput = document.getElementById('entryStartTime');
  const endInput = document.getElementById('entryEndTime');
  const cat = document.getElementById('entryCat');
  const text = input.value.trim();
  if (!text) return;
  const start = startInput.value, end = endInput.value;
  let duration = 0;
  if (start && end) {
    duration = timeToMinutes(end) - timeToMinutes(start);
    if (duration < 0) duration += 1440;
  }
  try {
    const row = await addEntry({ text, category: cat.value, duration, entry_date: todayKey(), start_time: start, end_time: end });
    state.entries.unshift(row);
    input.value = ''; startInput.value = ''; endInput.value = '';
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
  if (state.applications.length === 0) {
    list.innerHTML = `<div class="empty"><div class="empty-quote">"The pipeline awaits."</div><div class="empty-sub">Add your first application above</div></div>`;
    return;
  }
  list.innerHTML = state.applications.map(a => `
    <li class="app-item${a.status === 'rejected' ? ' rejected' : ''}">
      <div class="app-item-main">
        <div>
          <div class="app-name">${escapeHtml(a.company)}</div>
          <div class="app-role">${escapeHtml(a.role || 'No role specified')}</div>
        </div>
        <span class="app-date">${formatDateShort(a.created_at)}</span>
        <select class="status-select ${a.status}" data-status="${a.id}">
          <option value="applied" ${a.status==='applied'?'selected':''}>Applied</option>
          <option value="phone" ${a.status==='phone'?'selected':''}>Phone</option>
          <option value="onsite" ${a.status==='onsite'?'selected':''}>Onsite</option>
          <option value="offer" ${a.status==='offer'?'selected':''}>Offer</option>
          <option value="rejected" ${a.status==='rejected'?'selected':''}>Rejected</option>
        </select>
        <button class="icon-btn" data-del-app="${a.id}" aria-label="Delete">✕</button>
      </div>
      ${a.status === 'rejected' ? `
      <div class="app-feedback">
        <div class="app-feedback-label">What to improve next time</div>
        <textarea class="app-feedback-input" data-feedback="${a.id}" placeholder="What went well, what didn't, what to do differently next time...">${escapeHtml(a.feedback || '')}</textarea>
        <div class="app-feedback-saved" id="saved-${a.id}"></div>
      </div>` : ''}
    </li>`).join('');

  list.querySelectorAll('[data-status]').forEach(sel => {
    sel.addEventListener('change', () => onUpdateAppStatus(sel.dataset.status, sel.value));
  });
  list.querySelectorAll('[data-del-app]').forEach(btn => {
    btn.addEventListener('click', () => onDeleteApp(btn.dataset.delApp));
  });
  list.querySelectorAll('[data-feedback]').forEach(ta => {
    ta.addEventListener('blur', () => onSaveFeedback(ta.dataset.feedback, ta.value));
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
      ul.innerHTML = `<div class="empty" style="padding:20px 0"><div class="empty-sub">No tasks — add one below</div></div>`;
      continue;
    }
    ul.innerHTML = items.map(item => `
      <li class="prep-item ${item.done ? 'done' : ''}">
        <input type="checkbox" class="prep-checkbox" data-toggle="${group}:${item.id}" ${item.done ? 'checked' : ''}>
        <label class="prep-label" data-toggle-label="${group}:${item.id}">${escapeHtml(item.text)}</label>
        <button class="icon-btn" data-del-prep="${group}:${item.id}" aria-label="Delete">✕</button>
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

// ---------- RENDER: per-day pie chart ----------
function renderDayChart(date, entries) {
  const CATS = ['apply', 'learn', 'network', 'interview', 'cook', 'resume', 'entertainment', 'family', 'other'];
  const COLORS = {
    apply: '#e8614a', learn: '#7ab55a', network: '#e8b84a',
    interview: '#5a7abf', cook: '#e89a5a', resume: '#a07abf',
    entertainment: '#c06abf', family: '#4aaa78', other: '#b0a890'
  };
  const LABELS = {
    apply: 'Apply', learn: 'Learn', network: 'Network',
    interview: 'Interview', cook: 'Cook', resume: 'Resume/LinkedIn',
    entertainment: 'Entertainment', family: 'Family Time', other: 'Other'
  };

  const canvas = document.getElementById(`chart-${date}`);
  if (!canvas) return;

  const totals = Object.fromEntries(CATS.map(c => [c, 0]));
  entries.forEach(e => { if (e.duration) totals[e.category] = (totals[e.category] || 0) + e.duration; });

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
            font: { family: 'Fraunces', size: 12 },
            color: '#1a1a1a',
            padding: 14,
            generateLabels: (chart) => chart.data.labels.map((lbl, i) => ({
              text: `${lbl} — ${formatDuration(chart.data.datasets[0].data[i])}`,
              fillStyle: chart.data.datasets[0].backgroundColor[i],
              strokeStyle: '#f4ede1',
              lineWidth: 1,
              hidden: false,
              index: i
            }))
          }
        },
        tooltip: {
          callbacks: { label: (ctx) => ` ${formatDuration(ctx.parsed)}` }
        }
      }
    }
  });
}

// ---------- ORCHESTRATION ----------
function renderAll() {
  renderLogStats(); renderEntries();
  renderAppStats(); renderApps();
  renderPrep();
}

async function loadAllData() {
  const [entries, applications, prep] = await Promise.all([
    listEntries(), listApplications(), listPrepTasks()
  ]);
  state.entries = entries;
  state.applications = applications;
  state.prep = prep;
}

function setQuote() {
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  document.getElementById('quote').textContent = `"${q.q}"`;
  document.querySelector('.footer-author').textContent = q.a;
}

function bindAppEvents() {
  document.getElementById('addEntry').addEventListener('click', onAddEntry);
  ['entryText', 'entryStartTime', 'entryEndTime'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') onAddEntry(); });
  });

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
}

function showAuth() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';
  // Reset state so signing out of one account clears the previous user's data.
  state = { entries: [], applications: [], prep: { foundation: [], skills: [], outreach: [], logistics: [] } };
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
