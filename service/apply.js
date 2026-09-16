import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium } from "playwright";
import { fillGreenhouseForm } from "./greenhouse.js";
import { fillLeverForm } from "./lever.js";
import { fillGenericForm } from "./scrapers/genericFormFiller.js";
import { connect, getTailoredJobs, markApplied, markSkipped, close } from "../db/database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resume = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "resume.json"), "utf-8")
);

// "scrape" jobs (data/scrapeTargets.json) can land on any ATS — Workday,
// Ashby, iCIMS, a custom form, whatever that company happens to use — so
// there's no fixed selector set for them like there is for greenhouse/lever.
// fillGenericForm() falls back to label/placeholder keyword matching instead
// of exact selectors, and doubles as the fallback for any other source we
// don't have a dedicated filler for.
const FILLERS = {
  greenhouse: fillGreenhouseForm,
  lever: fillLeverForm,
  scrape: fillGenericForm,
};

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function run() {
  await connect();

  const jobs = await getTailoredJobs();
  console.log(`${jobs.length} job(s) ready for application.\n`);

  if (jobs.length === 0) {
    await rl.close();
    await close();
    return;
  }

  const browser = await chromium.launch({ headless: false });

  for (const job of jobs) {
    console.log(`\n=== ${job.title} @ ${job.company} (score ${job.score}/10) ===`);
    console.log(job.url);

    // Fall back to the generic heuristic filler for any source we don't have
    // a dedicated one for, rather than leaving the form untouched.
    const filler = FILLERS[job.source] || fillGenericForm;
    if (!FILLERS[job.source]) {
      console.log(`No dedicated filler for source "${job.source}" — trying the generic heuristic filler.`);
    }

    const page = await browser.newPage();
    await page.goto(job.url, { waitUntil: "domcontentloaded" });

    let coverLetterText = "";
    try {
      coverLetterText = readFileSync(join(job.output_dir, "cover-letter.md"), "utf-8");
    } catch {
      // no tailored cover letter on disk — that's fine, just skip pre-filling it
    }

    if (filler) {
      await filler(page, { resume, coverLetterText });
    }

    console.log(
      "\nReview the pre-filled form in the browser window, attach your resume file, and submit manually."
    );
    const answer = await rl.question(
      "Type 'done' once submitted, 's' to skip this job, or Enter to leave it pending: "
    );

    if (answer.trim().toLowerCase() === "done") {
      await markApplied(job._id);
      console.log("Marked as applied.");
    } else if (answer.trim().toLowerCase() === "s") {
      await markSkipped(job._id);
      console.log("Marked as skipped.");
    } else {
      console.log("Left as 'tailored' — it'll show up again next run.");
    }

    await page.close();
  }

  await browser.close();
  await rl.close();
  await close();
}

run().catch(async (err) => {
  console.error("Apply run failed:", err);
  await rl.close();
  await close();
  process.exit(1);
});
