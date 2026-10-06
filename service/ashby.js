import axios from "axios";

/**
 * Ashby's public job board API — no auth needed. `boardName` is the slug in
 * https://jobs.ashbyhq.com/<boardName>. Increasingly common among younger,
 * well-funded startups (it's a newer ATS, so adoption skews toward smaller
 * / more recently founded companies than Greenhouse/Lever).
 */
export async function fetchAshbyJobs(boardName) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${boardName}`;

  let data;
  try {
    ({ data } = await axios.get(url));
  } catch (err) {
    console.warn(`[ashby] ${boardName}: ${err.response?.status || err.message}, skipping`);
    return [];
  }

  return (data.jobs || []).map((job) => ({
    id: `ashby:${boardName}:${job.id}`,
    source: "ashby",
    company: boardName,
    title: job.title,
    location: job.location || job.address?.postalAddress?.addressLocality || null,
    url: job.jobUrl || job.applyUrl,
    description: stripHtml(job.descriptionHtml || job.description || ""),
    posted_at: job.publishedAt || null,
  }));
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// No dedicated form filler here — Ashby's application form markup isn't as
// stable/documented as Greenhouse/Lever's, so apply.js's existing fallback
// (fillGenericForm's label-matching heuristic) handles it instead.
