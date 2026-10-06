import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium } from "playwright";
import { fillGreenhouseForm } from "./greenhouse.js";
import { fillLeverForm } from "./lever.js";
import { fillGenericForm } from "./scrapers/genericFormFiller.js";
import { fillAggregatorApplication } from "./scrapers/aggregatorApply.js";
import { openSession } from "./session.js";
import { connect, getTailoredJobs, markApplied, markSkipped, close } from "../db/database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resume = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "resume.json"), "utf-8")
);
const resumeFilePath = resume.resumeFilePath
  ? join(__dirname, "..", resume.resumeFilePath)
  : null;

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

// These sources came from discoverCompanies.js (aggregator listing pages),
// not a company's own ATS — the posting URL stays on the aggregator's own
// site, often behind a login wall and an "Apply"/"Quick Apply" button
// rather than a plain form, so they need an authenticated session (if one
// was saved via `npm run login -- <platform>`) and the button-click-first
// applier instead of the plain fillers above.
const AGGREGATOR_SOURCES = new Set(["wellfound", "instahyre", "cutshort", "remoteok"]);

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
    const isAggregator = AGGREGATOR_SOURCES.has(job.source);
    const filler = isAggregator ? fillAggregatorApplication : FILLERS[job.source] || fillGenericForm;
    if (!isAggregator && !FILLERS[job.source]) {
      console.log(`No dedicated filler for source "${job.source}" — trying the generic heuristic filler.`);
    }

    let context = null;
    let page;
    if (isAggregator) {
      const session = await openSession(browser, job.source);
      context = session.context;
      if (!session.loggedIn) {
        console.log(`No saved login for "${job.source}" — applying logged out; you may hit a login wall. Run "npm run login -- ${job.source}" to fix that.`);
      }
      page = await context.newPage();
    } else {
      page = await browser.newPage();
    }
    await page.goto(job.url, { waitUntil: "domcontentloaded" });

    let coverLetterText = "";
    try {
      coverLetterText = readFileSync(join(job.output_dir, "cover-letter.md"), "utf-8");
    } catch {
      // no tailored cover letter on disk — that's fine, just skip pre-filling it
    }

    if (filler) {
      await filler(page, { resume, coverLetterText, resumeFilePath });
    }

    if (job.output_dir) {
      try {
        await page.screenshot({ path: join(job.output_dir, "applied-form.png"), fullPage: true });
      } catch {
        // non-fatal — just means you won't have a screenshot for this one
      }
    }

    console.log(
      resumeFilePath
        ? "\nReview the pre-filled form in the browser window, double-check the uploaded resume, and submit manually."
        : "\nReview the pre-filled form in the browser window, attach your resume file, and submit manually."
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
    if (context) await context.close();
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








// import { readFileSync } from "node:fs";
// import { fileURLToPath } from "node:url";
// import { dirname, join } from "node:path";
// import { createInterface } from "node:readline/promises";
// import { chromium } from "playwright";
// import { fillGreenhouseForm } from "./greenhouse.js";
// import { fillLeverForm } from "./lever.js";
// import { fillGenericForm } from "./scrapers/genericFormFiller.js";
// import { connect, getTailoredJobs, markApplied, markSkipped, close } from "../db/database.js";

// const __dirname = dirname(fileURLToPath(import.meta.url));
// const resume = JSON.parse(
//   readFileSync(join(__dirname, "..", "data", "resume.json"), "utf-8")
// );
// const resumeFilePath = resume.resumeFilePath
//   ? join(__dirname, "..", resume.resumeFilePath)
//   : null;

// // "scrape" jobs (data/scrapeTargets.json) can land on any ATS — Workday,
// // Ashby, iCIMS, a custom form, whatever that company happens to use — so
// // there's no fixed selector set for them like there is for greenhouse/lever.
// // fillGenericForm() falls back to label/placeholder keyword matching instead
// // of exact selectors, and doubles as the fallback for any other source we
// // don't have a dedicated filler for.
// const FILLERS = {
//   greenhouse: fillGreenhouseForm,
//   lever: fillLeverForm,
//   scrape: fillGenericForm,
// };

// const rl = createInterface({ input: process.stdin, output: process.stdout });

// async function run() {
//   await connect();

//   const jobs = await getTailoredJobs();
//   console.log(`${jobs.length} job(s) ready for application.\n`);

//   if (jobs.length === 0) {
//     await rl.close();
//     await close();
//     return;
//   }

//   const browser = await chromium.launch({ headless: false });

//   for (const job of jobs) {
//     console.log(`\n=== ${job.title} @ ${job.company} (score ${job.score}/10) ===`);
//     console.log(job.url);

//     // Fall back to the generic heuristic filler for any source we don't have
//     // a dedicated one for, rather than leaving the form untouched.
//     const filler = FILLERS[job.source] || fillGenericForm;
//     if (!FILLERS[job.source]) {
//       console.log(`No dedicated filler for source "${job.source}" — trying the generic heuristic filler.`);
//     }

//     const page = await browser.newPage();
//     await page.goto(job.url, { waitUntil: "domcontentloaded" });

//     let coverLetterText = "";
//     try {
//       coverLetterText = readFileSync(join(job.output_dir, "cover-letter.md"), "utf-8");
//     } catch {
//       // no tailored cover letter on disk — that's fine, just skip pre-filling it
//     }

//     if (filler) {
//       await filler(page, { resume, coverLetterText, resumeFilePath });
//     }

//     if (job.output_dir) {
//       try {
//         await page.screenshot({ path: join(job.output_dir, "applied-form.png"), fullPage: true });
//       } catch {
//         // non-fatal — just means you won't have a screenshot for this one
//       }
//     }

//     console.log(
//       resumeFilePath
//         ? "\nReview the pre-filled form in the browser window, double-check the uploaded resume, and submit manually."
//         : "\nReview the pre-filled form in the browser window, attach your resume file, and submit manually."
//     );
//     const answer = await rl.question(
//       "Type 'done' once submitted, 's' to skip this job, or Enter to leave it pending: "
//     );

//     if (answer.trim().toLowerCase() === "done") {
//       await markApplied(job._id);
//       console.log("Marked as applied.");
//     } else if (answer.trim().toLowerCase() === "s") {
//       await markSkipped(job._id);
//       console.log("Marked as skipped.");
//     } else {
//       console.log("Left as 'tailored' — it'll show up again next run.");
//     }

//     await page.close();
//   }

//   await browser.close();
//   await rl.close();
//   await close();
// }

// run().catch(async (err) => {
//   console.error("Apply run failed:", err);
//   await rl.close();
//   await close();
//   process.exit(1);
// });
