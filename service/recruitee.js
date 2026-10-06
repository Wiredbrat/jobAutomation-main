import axios from "axios";

/**
 * Recruitee's public offers API — no auth needed. `subdomain` is the
 * company name in https://<subdomain>.recruitee.com. Common with small
 * European and Indian startups (cheaper/simpler than Greenhouse).
 */
export async function fetchRecruiteeJobs(subdomain) {
  const url = `https://${subdomain}.recruitee.com/api/offers/`;

  let data;
  try {
    ({ data } = await axios.get(url));
  } catch (err) {
    console.warn(`[recruitee] ${subdomain}: ${err.response?.status || err.message}, skipping`);
    return [];
  }

  return (data.offers || []).map((job) => ({
    id: `recruitee:${subdomain}:${job.id}`,
    source: "recruitee",
    company: subdomain,
    title: job.title,
    location: job.location || job.city || null,
    url: job.careers_url,
    description: stripHtml([job.description, job.requirements].filter(Boolean).join("\n\n")),
    posted_at: job.created_at || null,
  }));
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// No dedicated form filler — falls back to fillGenericForm in apply.js.
