import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyAtsUrl, CHECKERS } from "../utils/atsProbe.js";
import { scrapeAggregatorJobs } from "./scrapers/aggregatorScraper.js";
import { isLocationEligible } from "../utils/match.js";
import { connect, upsertJob, close } from "../db/database.js";
import { openSession } from "./session.js";

/**
 * This is the "feed itself" half of discovery. For each aggregator seed
 * page (data/discoverySeeds.json) it does THREE things, because a single
 * aggregator page mixes all three kinds of leads at once:
 *
 *   1. JOBS, DIRECTLY — most postings on Wellfound/Instahyre/Cutshort/
 *      RemoteOK never link out to an ATS at all; they're hosted natively
 *      on the aggregator. scrapeAggregatorJobs() pulls title/company/
 *      location/url straight off the listing page and these go into the
 *      jobs DB immediately, same as discover.js/scrape.js — this is the
 *      actual goal, finding jobs, not just finding ATS boards.
 *   2. ATS BOARDS — a link that DOES point at a known ATS host
 *      (boards.greenhouse.io/x, jobs.lever.co/x, ...) gets its slug
 *      verified against the live API and added to companies.json, so
 *      future `npm run discover` runs pick up that company's full board,
 *      not just the one posting seen today.
 *   3. CAREERS PAGES — a link to some other company's own domain gets a
 *      handful of common careers-page paths probed; a hit is added to
 *      scrapeTargets.json for the generic scraper to revisit later.
 *
 * Nothing in (2) or (3) is written on a guess — every entry was actually
 * fetched and checked. (1) is heuristic pattern-matching (see
 * aggregatorScraper.js) rather than a guaranteed-clean parse, so expect
 * some noise (an "(unknown)" company, an occasional non-job link) — it
 * still passes through the same strict location gate as every other
 * source before being saved.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedsPath = join(__dirname, "..", "data", "discoverySeeds.json");
const companiesPath = join(__dirname, "..", "data", "companies.json");
const targetsPath = join(__dirname, "..", "data", "scrapeTargets.json");

const seeds = JSON.parse(readFileSync(seedsPath, "utf-8"));

const CAREERS_PATHS = ["/careers", "/jobs", "/join-us", "/company/careers", "/about/careers"];
const JOB_TITLE_HINTS = ["engineer", "developer", "frontend", "backend", "full stack", "sde"];
// Aggregator/social hosts we never want to mistake for a company's own site.
const IGNORE_HOST_FRAGMENTS = ["linkedin.", "twitter.", "x.com", "facebook.", "instagram.", "wellfound.", "remoteok.", "cutshort.", "instahyre.", "naukri.", "google."];

async function extractLinks(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    return await page.$$eval("a[href]", (els) => els.map((el) => el.href));
  } catch (err) {
    console.warn(`[discover-companies] couldn't load ${url}: ${err.message}`);
    return [];
  } finally {
    await page.close();
  }
}

async function probeCareersPage(browser, domain) {
  for (const path of CAREERS_PATHS) {
    const url = `https://${domain}${path}`;
    const page = await browser.newPage();
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      if (!res || res.status() >= 400) continue;
      const text = await page.evaluate(() => document.body.innerText.toLowerCase());
      if (JOB_TITLE_HINTS.some((kw) => text.includes(kw))) return url;
    } catch {
      // try the next path
    } finally {
      await page.close();
    }
  }
  return null;
}

async function run() {
  await connect();
  const browser = await chromium.launch();

  const atsCandidates = new Map(); // platform -> Set(slug)
  const domainLeads = new Set();
  let jobsSaved = 0;
  let jobsExcludedByLocation = 0;

  for (const seed of seeds.aggregators || []) {
    const seedUrl = seed.url;
    const seedSource = seed.source || new URL(seedUrl).hostname;

    console.log(`\n[discover-companies] scanning ${seedUrl} (source: ${seedSource})`);

    const { context, loggedIn } = await openSession(browser, seedSource);
    if (!loggedIn) {
      console.log(`  no saved login for "${seedSource}" — scanning logged out (run "npm run login -- ${seedSource}" if this platform hides listings without one)`);
    }

    // --- 1. Jobs, directly off the aggregator's own listing page ---
    const jobs = await scrapeAggregatorJobs(context, { url: seedUrl, source: seedSource });
    let savedThisSeed = 0;
    let excludedThisSeed = 0;
    for (const job of jobs) {
      if (!isLocationEligible(job)) {
        excludedThisSeed++;
        continue;
      }
      await upsertJob(job);
      savedThisSeed++;
    }
    jobsSaved += savedThisSeed;
    jobsExcludedByLocation += excludedThisSeed;
    console.log(`  ${jobs.length} job(s) parsed, ${savedThisSeed} saved, ${excludedThisSeed} excluded for location`);

    // --- 2 & 3. ATS links and other company domains, for future runs ---
    const seedHost = new URL(seedUrl).host;
    const links = await extractLinks(context, seedUrl);
    await context.close();

    for (const href of links) {
      let parsed;
      try {
        parsed = new URL(href);
      } catch {
        continue;
      }

      const classified = classifyAtsUrl(href);
      if (classified) {
        if (!atsCandidates.has(classified.platform)) atsCandidates.set(classified.platform, new Set());
        atsCandidates.get(classified.platform).add(classified.slug);
        continue;
      }

      const host = parsed.host.replace(/^www\./, "");
      const isIgnored = host === seedHost.replace(/^www\./, "") || IGNORE_HOST_FRAGMENTS.some((f) => host.includes(f));
      if (!isIgnored) domainLeads.add(host);
    }
  }

  console.log(
    `\nJobs: ${jobsSaved} saved directly, ${jobsExcludedByLocation} excluded for location.`
  );

  // --- Verify ATS candidates against live APIs, merge into companies.json ---
  const companies = JSON.parse(readFileSync(companiesPath, "utf-8"));
  let atsAdded = 0;
  for (const [platform, slugs] of atsCandidates.entries()) {
    const checker = CHECKERS[platform];
    if (!checker) continue;
    companies[platform] = companies[platform] || [];
    for (const slug of slugs) {
      if (companies[platform].includes(slug)) continue;
      const ok = await checker(slug);
      console.log(`[${platform}] ${slug}: ${ok ? "✓ verified, added" : "✗ not a live board"}`);
      if (ok) {
        companies[platform].push(slug);
        atsAdded++;
      }
    }
  }
  writeFileSync(companiesPath, JSON.stringify(companies, null, 2) + "\n", "utf-8");

  // --- Probe plain company domains for a working careers page ---
  const targets = JSON.parse(readFileSync(targetsPath, "utf-8"));
  const existingUrls = new Set(targets.map((t) => t.url));
  let targetsAdded = 0;
  for (const domain of domainLeads) {
    const url = await probeCareersPage(browser, domain);
    if (url && !existingUrls.has(url)) {
      console.log(`[careers-page] ${domain}: found ${url}`);
      targets.push({ company: domain, url });
      existingUrls.add(url);
      targetsAdded++;
    } else {
      console.log(`[careers-page] ${domain}: no jobs-like page found at common paths`);
    }
  }
  writeFileSync(targetsPath, JSON.stringify(targets, null, 2) + "\n", "utf-8");

  await browser.close();
  await close();

  console.log(
    `\nDone. ${jobsSaved} job(s) saved directly, ${atsAdded} new ATS board(s) added to companies.json, ${targetsAdded} new careers page(s) added to scrapeTargets.json.`
  );
  console.log(`Run "npm run score" next to score the newly-saved jobs, and "npm run discover" to pull the full boards for any newly-added companies.`);
}

run().catch(async (err) => {
  console.error("Company discovery run failed:", err);
  await close();
  process.exit(1);
});


// import { chromium } from "playwright";
// import { readFileSync, writeFileSync } from "node:fs";
// import { fileURLToPath } from "node:url";
// import { dirname, join } from "node:path";
// import { classifyAtsUrl, CHECKERS } from "../utils/atsProbe.js";
// import { scrapeAggregatorJobs } from "./scrapers/aggregatorScraper.js";
// import { isLocationEligible } from "../utils/match.js";
// import { connect, upsertJob, close } from "../db/database.js";

// const __dirname = dirname(fileURLToPath(import.meta.url));
// const seedsPath = join(__dirname, "..", "data", "discoverySeeds.json");
// const companiesPath = join(__dirname, "..", "data", "companies.json");
// const targetsPath = join(__dirname, "..", "data", "scrapeTargets.json");
// const seeds = JSON.parse(readFileSync(seedsPath, "utf-8"));

// const CAREERS_PATHS = ["/careers", "/jobs", "/join-us", "/company/careers", "/about/careers"];
// const JOB_TITLE_HINTS = ["engineer", "developer", "frontend", "backend", "full stack", "sde"];
// const IGNORE_HOST_FRAGMENTS = ["linkedin.", "twitter.", "x.com", "facebook.", "instagram.", "wellfound.", "remoteok.", "cutshort.", "instahyre.", "naukri.", "google."];

// async function extractLinks(browser, url) {
//   const page = await browser.newPage();
//   try {
//     await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
//     return await page.$$eval("a[href]", (els) => els.map((el) => el.href));
//   } catch (err) {
//     console.warn(`[discover-companies] couldn't load ${url}: ${err.message}`);
//     return [];
//   } finally {
//     await page.close();
//   }
// }

// async function probeCareersPage(browser, domain) {
//   for (const path of CAREERS_PATHS) {
//     const url = `https://${domain}${path}`;
//     const page = await browser.newPage();
//     try {
//       const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
//       if (!res || res.status() >= 400) continue;
//       const text = await page.evaluate(() => document.body.innerText.toLowerCase());
//       if (JOB_TITLE_HINTS.some((kw) => text.includes(kw))) return url;
//     } catch {
//       // try the next path
//     } finally {
//       await page.close();
//     }
//   }
//   return null;
// }

// async function run() {
//   await connect();
//   const browser = await chromium.launch();

//   const atsCandidates = new Map();
//   const domainLeads = new Set();
//   let jobsSaved = 0;
//   let jobsExcludedByLocation = 0;

//   for (const seed of seeds.aggregators || []) {
//     const seedUrl = seed.url;
//     const seedSource = seed.source || new URL(seedUrl).hostname;
//     console.log(`\n[discover-companies] scanning ${seedUrl} (source: ${seedSource})`);

//     // 1. Jobs, directly off the aggregator's own listing page
//     const jobs = await scrapeAggregatorJobs(browser, { url: seedUrl, source: seedSource });
//     let savedThisSeed = 0;
//     let excludedThisSeed = 0;
//     for (const job of jobs) {
//       if (!isLocationEligible(job)) { excludedThisSeed++; continue; }
//       await upsertJob(job);
//       savedThisSeed++;
//     }
//     jobsSaved += savedThisSeed;
//     jobsExcludedByLocation += excludedThisSeed;
//     console.log(`  ${jobs.length} job(s) parsed, ${savedThisSeed} saved, ${excludedThisSeed} excluded for location`);

//     // 2 & 3. ATS links and other company domains, for future runs
//     const seedHost = new URL(seedUrl).host;
//     const links = await extractLinks(browser, seedUrl);

//     for (const href of links) {
//       let parsed;
//       try { parsed = new URL(href); } catch { continue; }

//       const classified = classifyAtsUrl(href);
//       if (classified) {
//         if (!atsCandidates.has(classified.platform)) atsCandidates.set(classified.platform, new Set());
//         atsCandidates.get(classified.platform).add(classified.slug);
//         continue;
//       }

//       const host = parsed.host.replace(/^www\./, "");
//       const isIgnored = host === seedHost.replace(/^www\./, "") || IGNORE_HOST_FRAGMENTS.some((f) => host.includes(f));
//       if (!isIgnored) domainLeads.add(host);
//     }
//   }

//   console.log(`\nJobs: ${jobsSaved} saved directly, ${jobsExcludedByLocation} excluded for location.`);

//   const companies = JSON.parse(readFileSync(companiesPath, "utf-8"));
//   let atsAdded = 0;
//   for (const [platform, slugs] of atsCandidates.entries()) {
//     const checker = CHECKERS[platform];
//     if (!checker) continue;
//     companies[platform] = companies[platform] || [];
//     for (const slug of slugs) {
//       if (companies[platform].includes(slug)) continue;
//       const ok = await checker(slug);
//       console.log(`[${platform}] ${slug}: ${ok ? "✓ verified, added" : "✗ not a live board"}`);
//       if (ok) { companies[platform].push(slug); atsAdded++; }
//     }
//   }
//   writeFileSync(companiesPath, JSON.stringify(companies, null, 2) + "\n", "utf-8");

//   const targets = JSON.parse(readFileSync(targetsPath, "utf-8"));
//   const existingUrls = new Set(targets.map((t) => t.url));
//   let targetsAdded = 0;
//   for (const domain of domainLeads) {
//     const url = await probeCareersPage(browser, domain);
//     if (url && !existingUrls.has(url)) {
//       console.log(`[careers-page] ${domain}: found ${url}`);
//       targets.push({ company: domain, url });
//       existingUrls.add(url);
//       targetsAdded++;
//     } else {
//       console.log(`[careers-page] ${domain}: no jobs-like page found at common paths`);
//     }
//   }
//   writeFileSync(targetsPath, JSON.stringify(targets, null, 2) + "\n", "utf-8");

//   await browser.close();
//   await close();

//   console.log(`\nDone. ${jobsSaved} job(s) saved directly, ${atsAdded} new ATS board(s) added to companies.json, ${targetsAdded} new careers page(s) added to scrapeTargets.json.`);
//   console.log(`Run "npm run score" next to score the newly-saved jobs, and "npm run discover" to pull the full boards for any newly-added companies.`);
// }

// run().catch(async (err) => {
//   console.error("Company discovery run failed:", err);
//   await close();
//   process.exit(1);
// });