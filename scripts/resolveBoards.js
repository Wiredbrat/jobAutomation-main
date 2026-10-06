import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CHECKERS } from "../utils/atsProbe.js";

/**
 * Board tokens/slugs are exact and there's no public directory of "which
 * company uses which ATS" — guessing wrong just silently 404s forever in
 * discover.js. This script does the guessing FOR you (see
 * data/indiaBoardCandidates.json) and verifies each candidate against the
 * live API for its platform (see utils/atsProbe.js) before it goes
 * anywhere near companies.json.
 *
 * Most candidates in that file are speculative — expect a lot of "not
 * found" lines. That's the point: nothing gets merged in on the strength
 * of a guess. For companies discovered automatically instead of guessed,
 * see `npm run discover-companies`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const candidatesPath = join(__dirname, "..", "data", "indiaBoardCandidates.json");
const companiesPath = join(__dirname, "..", "data", "companies.json");
const candidates = JSON.parse(readFileSync(candidatesPath, "utf-8"));

async function run() {
  const verified = {};

  for (const platform of Object.keys(CHECKERS)) {
    verified[platform] = [];
    for (const slug of candidates[platform] || []) {
      const ok = await CHECKERS[platform](slug);
      console.log(`[${platform}] ${slug}: ${ok ? "✓ live board" : "✗ not found"}`);
      if (ok) verified[platform].push(slug);
    }
  }

  const summary = Object.keys(CHECKERS)
    .map((platform) => `${verified[platform].length} ${platform}`)
    .join(", ");
  console.log(`\nVerified: ${summary}.`);

  const existing = JSON.parse(readFileSync(companiesPath, "utf-8"));
  const merged = {};
  for (const platform of Object.keys(CHECKERS)) {
    merged[platform] = Array.from(new Set([...(existing[platform] || []), ...verified[platform]]));
  }

  writeFileSync(companiesPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  console.log(`\ndata/companies.json updated with verified boards only.`);
}

run().catch((err) => {
  console.error("Resolve run failed:", err.message);
  process.exit(1);
});
