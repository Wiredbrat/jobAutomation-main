// const TITLE_HINTS = ["engineer", "developer", "frontend", "front-end", "backend",
  // "back-end", "full stack", "fullstack", "sde", "software", "programmer"];
// 
// const LOCATION_HINTS = ["india", "remote", "delhi", "ncr", "gurugram", "gurgaon",
  // "noida", "bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "chennai",
  // "kolkata", "ahmedabad", "jaipur", "kochi", "indore", "anywhere"];
// 
// function looksLikeTitle(text) {
  // const t = (text || "").trim().toLowerCase();
  // if (t.length < 4 || t.length > 100) return false;
  // return TITLE_HINTS.some((kw) => t.includes(kw));
// }
// 
// function looksLikeLocation(text) {
  // const t = (text || "").trim().toLowerCase();
  // if (!t || t.length > 60) return false;
  // return LOCATION_HINTS.some((kw) => t.includes(kw));
// }
// 
// export async function scrapeAggregatorJobs(browser, { url, source }) {
  // const page = await browser.newPage();
  // const jobs = [];
// 
  // try {
    // await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
// 
    // for (let i = 0; i < 5; i++) {
      // await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // await page.waitForTimeout(800);
    // }
// 
    // const rawCards = await page.$$eval("a[href]", (anchors) =>
      // anchors
        // .map((a) => {
          // const title = (a.innerText || "").trim();
          // if (!title) return null;
          // let container = a;
          // for (let depth = 0; depth < 4 && container.parentElement; depth++) {
            // container = container.parentElement;
            // const len = (container.innerText || "").length;
            // if (len > 20 && len < 600) break;
          // }
          // return { href: a.href, title, surroundingText: (container.innerText || "").trim() };
        // })
        // .filter(Boolean)
    // );
// 
    // for (const card of rawCards) {
      // if (!looksLikeTitle(card.title)) continue;
// 
      // const lines = card.surroundingText.split("\n").map((l) => l.trim()).filter(Boolean);
      // const location = lines.find((l) => looksLikeLocation(l)) || null;
      // const company =
        // lines.find((l) => l !== card.title && l.length < 60 && !looksLikeLocation(l) && !/^\d+$/.test(l)) || null;
// 
      // jobs.push({
        // id: `${source}:${Buffer.from(card.href).toString("base64").slice(0, 32)}`,
        // source,
        // company: company || "(unknown)",
        // title: card.title,
        // location,
        // url: card.href,
        // description: card.surroundingText.slice(0, 1000),
        // posted_at: null,
      // });
    // }
  // } catch (err) {
    // console.warn(`[aggregator] ${url}: ${err.message}`);
  // } finally {
    // await page.close();
  // }
// 
  // const seen = new Set();
  // return jobs.filter((j) => { if (seen.has(j.url)) return false; seen.add(j.url); return true; });
// }



/**
 * Generic job-listing scraper for aggregator/search-result pages — as
 * opposed to genericScraper.js, which is built for a single company's own
 * careers page. Aggregators list MANY companies' jobs on one page, often
 * without ever linking out to an ATS at all, so ATS-URL detection alone
 * misses most of what's actually there. This extracts job postings
 * directly: title, company, location, and the posting's own URL (even
 * when that URL never leaves the aggregator's domain).
 *
 * Heuristic, not exact-selector-based, since markup differs per site and
 * changes over time: for every link on the page whose text looks like a
 * job title, walk up to the smallest ancestor container and pull the
 * nearby text that looks like a company name / location. Expect noise —
 * this is a best-effort net, not a guaranteed-clean parse. A posting
 * missing a clear title is dropped rather than kept with a guessed one.
 */

const TITLE_HINTS = ["engineer", "developer", "frontend", "front-end", "backend",
  "back-end", "full stack", "fullstack", "sde", "software", "programmer"];

const LOCATION_HINTS = ["india", "remote", "delhi", "ncr", "gurugram", "gurgaon",
  "noida", "bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "chennai",
  "kolkata", "ahmedabad", "jaipur", "kochi", "indore", "anywhere"];

function looksLikeTitle(text) {
  const t = (text || "").trim().toLowerCase();
  if (t.length < 4 || t.length > 100) return false;
  return TITLE_HINTS.some((kw) => t.includes(kw));
}

function looksLikeLocation(text) {
  const t = (text || "").trim().toLowerCase();
  if (!t || t.length > 60) return false;
  return LOCATION_HINTS.some((kw) => t.includes(kw));
}

export async function scrapeAggregatorJobs(context, { url, source }) {
  const page = await context.newPage();
  const jobs = [];

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // Most aggregators lazy-load additional results on scroll.
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);
    }

    const rawCards = await page.$$eval("a[href]", (anchors) =>
      anchors
        .map((a) => {
          const title = (a.innerText || "").trim();
          if (!title) return null;

          // Walk up to a reasonably small container that likely represents
          // "one job card", so nearby text (company/location) stays scoped
          // to THIS posting rather than the whole page.
          let container = a;
          for (let depth = 0; depth < 4 && container.parentElement; depth++) {
            container = container.parentElement;
            const len = (container.innerText || "").length;
            if (len > 20 && len < 600) break;
          }

          return { href: a.href, title, surroundingText: (container.innerText || "").trim() };
        })
        .filter(Boolean)
    );

    for (const card of rawCards) {
      if (!looksLikeTitle(card.title)) continue;

      const lines = card.surroundingText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const location = lines.find((l) => looksLikeLocation(l)) || null;
      const company =
        lines.find(
          (l) => l !== card.title && l.length < 60 && !looksLikeLocation(l) && !/^\d+$/.test(l)
        ) || null;

      jobs.push({
        id: `${source}:${Buffer.from(card.href).toString("base64").slice(0, 32)}`,
        source,
        company: company || "(unknown)",
        title: card.title,
        location,
        url: card.href,
        description: card.surroundingText.slice(0, 1000),
        posted_at: null,
      });
    }
  } catch (err) {
    console.warn(`[aggregator] ${url}: ${err.message}`);
  } finally {
    await page.close();
  }

  // Dedup by URL within this page's own results.
  const seen = new Set();
  return jobs.filter((j) => {
    if (seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });
}