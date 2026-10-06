import axios from "axios";

/**
 * Workable's public widget API — no auth needed. `account` is the subdomain
 * in https://apply.workable.com/<account>. Widely used by small/early-stage
 * startups because it's cheap and quick to set up.
 */
export async function fetchWorkableJobs(account) {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${account}?details=true`;

  let data;
  try {
    ({ data } = await axios.get(url));
  } catch (err) {
    console.warn(`[workable] ${account}: ${err.response?.status || err.message}, skipping`);
    return [];
  }

  return (data.jobs || []).map((job) => ({
    id: `workable:${account}:${job.shortcode}`,
    source: "workable",
    company: account,
    title: job.title,
    location: [job.city, job.country].filter(Boolean).join(", ") || null,
    url: job.url || job.application_url,
    description: stripHtml(job.description || ""),
    posted_at: job.published_on || null,
  }));
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// No dedicated form filler — falls back to fillGenericForm in apply.js.
