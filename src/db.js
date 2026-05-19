// =====================================================================
// db.js — Supabase data access layer for Cadence
// =====================================================================
// Replaces the window.storage calls from the artifact version.
// All queries are scoped to the authenticated user by RLS — you don't
// need to filter by user_id manually.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ⚠️ Replace these with your project's values from Supabase → Settings → API
const SUPABASE_URL      = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- AUTH ----------
export async function signUp(email, password) {
  return supabase.auth.signUp({ email, password });
}
export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}
export async function signOut() {
  return supabase.auth.signOut();
}
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}
export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_event, session) => cb(session?.user || null));
}

// ---------- ENTRIES ----------
export async function listEntries() {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addEntry({ text, category, duration, entry_date }) {
  const user = await getUser();
  const { data, error } = await supabase
    .from('entries')
    .insert({ user_id: user.id, text, category, duration, entry_date })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEntry(id) {
  const { error } = await supabase.from('entries').delete().eq('id', id);
  if (error) throw error;
}

// ---------- APPLICATIONS ----------
export async function listApplications() {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addApplication({ company, role }) {
  const user = await getUser();
  const { data, error } = await supabase
    .from('applications')
    .insert({ user_id: user.id, company, role: role || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateApplicationStatus(id, status) {
  const { error } = await supabase.from('applications').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function deleteApplication(id) {
  const { error } = await supabase.from('applications').delete().eq('id', id);
  if (error) throw error;
}

// ---------- PREP TASKS ----------
export async function listPrepTasks() {
  const { data, error } = await supabase
    .from('prep_tasks')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  // Group by group_name for the UI's convenience
  const grouped = { foundation: [], skills: [], outreach: [], logistics: [] };
  for (const row of data) {
    if (grouped[row.group_name]) grouped[row.group_name].push(row);
  }
  return grouped;
}

export async function addPrepTask({ group_name, text }) {
  const user = await getUser();
  const { data, error } = await supabase
    .from('prep_tasks')
    .insert({ user_id: user.id, group_name, text, sort_order: Date.now() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function togglePrepTask(id, done) {
  const { error } = await supabase.from('prep_tasks').update({ done }).eq('id', id);
  if (error) throw error;
}

export async function deletePrepTask(id) {
  const { error } = await supabase.from('prep_tasks').delete().eq('id', id);
  if (error) throw error;
}
