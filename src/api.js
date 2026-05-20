// api.js — external data sources

// ---- HN Who's Hiring ----

export async function fetchLatestHNHiringPost() {
  const res = await fetch(
    'https://hn.algolia.com/api/v1/search_by_date?query=Ask%20HN%3A%20Who%20is%20Hiring%3F&tags=story&hitsPerPage=5'
  );
  const data = await res.json();
  return data.hits.find(h => h.title?.includes('Who is Hiring'));
}

export async function searchHNJobs(storyId, keyword) {
  const params = new URLSearchParams({ tags: `comment,story_${storyId}`, hitsPerPage: 30 });
  if (keyword) params.set('query', keyword);
  const res = await fetch(`https://hn.algolia.com/api/v1/search?${params}`);
  const data = await res.json();
  return data.hits;
}

// ---- Remotive ----

export async function searchRemotiveJobs(keyword) {
  const params = new URLSearchParams({ search: keyword, limit: 20 });
  const res = await fetch(`https://remotive.com/api/remote-jobs?${params}`);
  const data = await res.json();
  return data.jobs || [];
}
