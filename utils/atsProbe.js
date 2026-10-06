import axios from "axios";

/**
 * Every ATS we support exposes application links on a recognizable host —
 * this is what lets discoverCompanies.js recognize "this link on an
 * aggregator page is a Greenhouse/Lever/etc application" without knowing
 * the company name ahead of time.
 */
export const ATS_URL_PATTERNS = [
  { platform: "greenhouse", regex: /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9-]+)/i },
  { platform: "lever", regex: /jobs\.lever\.co\/([a-z0-9-]+)/i },
  { platform: "ashby", regex: /jobs\.ashbyhq\.com\/([a-z0-9-]+)/i },
  { platform: "smartrecruiters", regex: /jobs\.smartrecruiters\.com\/([a-zA-Z0-9-]+)/ },
  { platform: "recruitee", regex: /([a-z0-9-]+)\.recruitee\.com/i },
  { platform: "workable", regex: /apply\.workable\.com\/([a-z0-9-]+)/i },
];

/** Given any URL, return {platform, slug} if it matches a known ATS host pattern, else null. */
export function classifyAtsUrl(url) {
  for (const { platform, regex } of ATS_URL_PATTERNS) {
    const m = url.match(regex);
    if (m) return { platform, slug: m[1].toLowerCase() };
  }
  return null;
}

export async function checkGreenhouse(slug) {
  try {
    const { data } = await axios.get(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
      { timeout: 8000 }
    );
    return Array.isArray(data.jobs);
  } catch {
    return false;
  }
}

export async function checkLever(slug) {
  try {
    const { data } = await axios.get(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
      timeout: 8000,
    });
    return Array.isArray(data);
  } catch {
    return false;
  }
}

export async function checkAshby(slug) {
  try {
    const { data } = await axios.get(
      `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
      { timeout: 8000 }
    );
    return Array.isArray(data.jobs);
  } catch {
    return false;
  }
}

export async function checkSmartRecruiters(slug) {
  try {
    const { data } = await axios.get(
      `https://api.smartrecruiters.com/v1/companies/${slug}/postings`,
      { timeout: 8000 }
    );
    return Array.isArray(data.content);
  } catch {
    return false;
  }
}

export async function checkRecruitee(slug) {
  try {
    const { data } = await axios.get(`https://${slug}.recruitee.com/api/offers/`, {
      timeout: 8000,
    });
    return Array.isArray(data.offers);
  } catch {
    return false;
  }
}

export async function checkWorkable(slug) {
  try {
    const { data } = await axios.get(
      `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`,
      { timeout: 8000 }
    );
    return Array.isArray(data.jobs);
  } catch {
    return false;
  }
}

export const CHECKERS = {
  greenhouse: checkGreenhouse,
  lever: checkLever,
  ashby: checkAshby,
  smartrecruiters: checkSmartRecruiters,
  recruitee: checkRecruitee,
  workable: checkWorkable,
};
