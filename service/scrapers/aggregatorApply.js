import { fillGenericForm } from "./genericFormFiller.js";

const APPLY_BUTTON_PATTERNS = [/quick apply/i, /^apply$/i, /apply now/i, /apply for this job/i];

/**
 * Aggregator-native postings (Wellfound/Instahyre/Cutshort) usually put
 * the actual application form behind an "Apply" / "Quick Apply" button or
 * modal rather than showing it inline on the page — click that first,
 * THEN run the same label-matching generic filler used for every other
 * unfamiliar form. If no matching button is found, falls straight through
 * to filling whatever's already on the page (some postings do show the
 * form directly, or redirect to the company's own ATS, which apply.js
 * handles separately).
 */
export async function fillAggregatorApplication(page, { resume, coverLetterText, resumeFilePath }) {
  const clickable = await page.$$("button, a");

  for (const el of clickable) {
    const text = (await el.innerText().catch(() => "")) || "";
    if (!APPLY_BUTTON_PATTERNS.some((p) => p.test(text.trim()))) continue;

    try {
      await el.click({ timeout: 5000 });
      await page.waitForTimeout(1500); // let the form/modal finish rendering
      console.log(`Clicked "${text.trim()}".`);
      break;
    } catch {
      // Not actually clickable (hidden, off-screen, overlay) — keep looking.
    }
  }

  return fillGenericForm(page, { resume, coverLetterText, resumeFilePath });
}