import axios from "axios";

/**
 * Fetches all open jobs for a company on Greenhouse's public job board API.
 * `boardToken` is the company's slug, e.g. "stripe" in
 * https://boards.greenhouse.io/stripe
 */
export async function fetchGreenhouseJobs(boardToken) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`;

  let data;
  try {
    ({ data } = await axios.get(url));
  } catch (err) {
    console.warn(`[greenhouse] ${boardToken}: ${err.response?.status || err.message}, skipping`);
    return [];
  }

  return (data.jobs || []).map((job) => ({
    id: `greenhouse:${boardToken}:${job.id}`,
    source: "greenhouse",
    company: boardToken,
    title: job.title,
    location: job.location?.name || null,
    url: job.absolute_url,
    description: stripHtml(job.content || ""),
    posted_at: job.updated_at || null,
  }));
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export async function fillGreenhouseForm(page, { resume, coverLetterText }) {
  const [firstName, ...rest] = resume.name.split(" ");
  const lastName = rest.join(" ");
 
  const trySet = async (selector, value) => {
    if (!value) return;
    const el = page.locator(selector).first();
    if (await el.count()) {
      await el.fill(value).catch(() => {});
    }
  };
 
  await trySet('input[name="first_name"]', firstName);
  await trySet('input[name="last_name"]', lastName);
  await trySet('input[name="email"]', resume.contact?.email);
  await trySet('input[name="phone"]', resume.contact?.phone);
  await trySet('input[autocomplete="url"]', resume.contact?.portfolio);
 
  // Greenhouse often exposes a free-text cover letter box; not always present.
  const coverLetterBox = page.locator("textarea").filter({ hasText: "" });
  if (coverLetterText) {
    const textareas = await page.locator("textarea").all();
    for (const ta of textareas) {
      const label = (await ta.getAttribute("aria-label")) || "";
      if (/cover/i.test(label)) {
        await ta.fill(coverLetterText).catch(() => {});
      }
    }
  }
 
  console.log(
    "Filled name/email/phone where fields were found. Resume upload, LinkedIn/GitHub links, and any custom questions still need your review before submitting."
  );
}