import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { scrapeCareersPage } from "./scrapers/genericScraper.js";
import { connect, upsertJob, getNewJobs, countJobs, close } from "../db/database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const targets = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "scrapeTargets.json"), "utf-8")
);

const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS || 2000);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function run() {
  await connect();

  const before = await countJobs();
  const browser = await chromium.launch({ headless: true });

  for (const target of targets) {
    console.log(`\n[scrape] ${target.company}: visiting ${target.url}`);
    const jobs = await scrapeCareersPage(browser, target);
    for (const job of jobs) await upsertJob(job);
    console.log(`[scrape] ${target.company}: ${jobs.length} job(s) kept`);
    await sleep(DELAY_MS);
  }

  await browser.close();

  const after = await countJobs();
  console.log(`\nDone. ${after} total jobs in db (${after - before} net new).`);

  const pending = await getNewJobs();
  console.log(`${pending.length} jobs awaiting scoring.`);

  await close();
}

run().catch(async (err) => {
  console.error("Scrape run failed:", err);
  await close();
  process.exit(1);
});
