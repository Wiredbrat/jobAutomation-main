import axios from "axios";
import { uploadResumeIfPresent } from "./scrapers/fileUpload.js";

export async function fetchLeverJobs(site) {
  const url = `https://api.lever.co/v0/postings/${site}?mode=json`;

  let data;
  try {
    ({ data } = await axios.get(url));
  } catch (err) {
    console.warn(`[lever] ${site}: ${err.response?.status || err.message}, skipping`);
    return [];
  }

  return (data || []).map((job) => ({
    id: `lever:${site}:${job.id}`,
    source: "lever",
    company: site,
    title: job.text,
    location: job.categories?.location || null,
    url: job.hostedUrl,
    description: stripHtml(
      [job.descriptionPlain, job.additionalPlain].filter(Boolean).join("\n\n")
    ),
    posted_at: job.createdAt ? new Date(job.createdAt).toISOString() : null,
  }));
}

function stripHtml(text) {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}


export async function fillLeverForm(page, { resume, coverLetterText, resumeFilePath }) {
  const trySet = async (selector, value) => {
    if (!value) return;
    const el = page.locator(selector).first();
    if (await el.count()) {
      await el.fill(value).catch(() => {});
    }
  };
 
  await trySet('input[name="name"]', resume.name);
  await trySet('input[name="email"]', resume.contact?.email);
  await trySet('input[name="phone"]', resume.contact?.phone);
  await trySet('input[name="org"]', ""); // current company, left blank intentionally
  await trySet('input[name="urls[LinkedIn]"]', resume.contact?.linkedin);
  await trySet('input[name="urls[GitHub]"]', resume.contact?.github);
  await trySet('input[name="urls[Portfolio]"]', resume.contact?.portfolio);
 
  await uploadResumeIfPresent(page, resumeFilePath);

  if (coverLetterText) {
    const additionalInfo = page.locator('textarea[name="comments"]');
    if (await additionalInfo.count()) {
      await additionalInfo.fill(coverLetterText).catch(() => {});
    }
  }
 
  console.log(
    "Filled name/email/phone/links where fields were found. Resume upload and any custom questions still need your review before submitting."
  );
}
 