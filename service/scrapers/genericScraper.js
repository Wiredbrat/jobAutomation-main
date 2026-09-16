import { createHash } from "node:crypto";

/**
 * Why this is generic instead of per-site: Greenhouse and Lever give us a
 * clean JSON API because every company on that platform shares the same
 * page structure. A random company's own careers page has none of that
 * consistency, and JS-rendered listings mean a plain axios GET (like
 * greenhouse.js/lever.js use) often returns an empty shell. Playwright
 * renders the real page, so we can read whatever ends up in the DOM
 * regardless of how the company built their site.
 *
 * Approach: grab every link on the page, keep the ones whose visible text
 * looks like a job title (same TITLE_FILTER keyword approach discover.js
 * already uses), then visit each surviving link once to pull its body text
 * as the job description. No site-specific CSS selectors to maintain —
 * add a URL to data/scrapeTargets.json and it works the same way every
 * other target does.
 */

const NAV_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS || 30000);
const MAX_DETAIL_FETCHES = Number(process.env.SCRAPE_MAX_DETAILS || 15);

const TITLE_FILTER = [
  "engineer",
  "developer",
  "frontend",
  "front-end",
  "backend",
  "back-end",
  "full stack",
  "fullstack",
  "software",
  "swe",
];

function looksLikeJobLink(text) {
  const lower = text.toLowerCase();
  return TITLE_FILTER.some((kw) => lower.includes(kw));
}

function hashUrl(url) {
  return createHash("sha1").update(url).digest("hex").slice(0, 12);
}

function slugifyCompany(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Scrapes one company's careers page for job-like links, then fetches each
 * candidate's own page for a description. Returns job objects in the same
 * shape upsertJob() already expects from greenhouse.js/lever.js.
 */
export async function scrapeCareersPage(browser, { company, url }) {
  const page = await browser.newPage();
  const jobs = [];
  const companySlug = slugifyCompany(company);

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });

    const links = await page.$$eval("a", (anchors) =>
      anchors
        .map((a) => ({
          text: (a.innerText || "").trim().replace(/\s+/g, " "),
          href: a.href,
        }))
        .filter((l) => l.text.length >= 4 && l.text.length <= 140 && l.href)
    );

    const seen = new Set();
    const candidates = links.filter((l) => {
      if (!looksLikeJobLink(l.text)) return false;
      if (seen.has(l.href)) return false;
      seen.add(l.href);
      return true;
    });

    console.log(`[scrape] ${company}: ${candidates.length} candidate link(s) found`);

    for (const candidate of candidates.slice(0, MAX_DETAIL_FETCHES)) {
      let description = "";
      const detailPage = await browser.newPage();
      try {
        await detailPage.goto(candidate.href, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        });
        description = (await detailPage.locator("body").innerText()).slice(0, 6000);
      } catch (err) {
        console.warn(`[scrape] ${company}: couldn't load ${candidate.href}: ${err.message}`);
      } finally {
        await detailPage.close();
      }

      jobs.push({
        id: `scrape:${companySlug}:${hashUrl(candidate.href)}`,
        source: "scrape",
        company,
        title: candidate.text,
        location: null,
        url: candidate.href,
        description,
        posted_at: null,
      });
    }
  } catch (err) {
    console.warn(`[scrape] ${company}: failed to load ${url}: ${err.message}`);
  } finally {
    await page.close();
  }

  return jobs;
}
