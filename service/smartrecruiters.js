import axios from "axios";

/**
 * SmartRecruiters' public postings API — no auth needed. `company` is the
 * companyIdentifier in https://jobs.smartrecruiters.com/<company>. Popular
 * with mid-size Indian companies and some fast-growing startups.
 */
export async function fetchSmartRecruitersJobs(company) {
  const url = `https://api.smartrecruiters.com/v1/companies/${company}/postings`;

  let data;
  try {
    ({ data } = await axios.get(url));
  } catch (err) {
    console.warn(`[smartrecruiters] ${company}: ${err.response?.status || err.message}, skipping`);
    return [];
  }

  return (data.content || []).map((job) => ({
    id: `smartrecruiters:${company}:${job.id}`,
    source: "smartrecruiters",
    company,
    title: job.name,
    location: [job.location?.city, job.location?.country].filter(Boolean).join(", ") || null,
    url: job.postingUrl,
    description: stripHtml(
      [job.jobAd?.sections?.jobDescription?.text, job.jobAd?.sections?.qualifications?.text]
        .filter(Boolean)
        .join("\n\n")
    ),
    posted_at: job.releasedDate || null,
  }));
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// No dedicated form filler — falls back to fillGenericForm in apply.js.
