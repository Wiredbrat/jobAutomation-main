/**
 * Greenhouse and Lever have predictable field names (input[name="first_name"],
 * etc.) because every company on those platforms shares the same form
 * markup. A scraped job could be on Workday, Ashby, iCIMS, SmartRecruiters,
 * Recruitee, BambooHR, or a totally custom in-house form — there's no single
 * selector that works across all of them.
 *
 * What *is* fairly consistent across ATS platforms is that a field has some
 * human-readable label near it (a <label>, a placeholder, an aria-label) and
 * that label uses ordinary words like "First Name" or "Email". So instead of
 * matching selectors, this filler reads each field's label-ish text and
 * matches it against keyword patterns per resume field, same spirit as the
 * keyword-link heuristic genericScraper.js already uses for finding jobs.
 *
 * This is a best-effort heuristic, not a guarantee — same disclaimer as the
 * scraper itself. Unusual forms (multi-step wizards, fields rendered inside
 * shadow DOM, unlabeled custom widgets) may need a human to fill them in by
 * hand, same as before.
 */

const FILLABLE_SELECTOR =
  "input:not([type=hidden]):not([type=file]):not([type=checkbox])" +
  ":not([type=radio]):not([type=submit]):not([type=button]):not([type=image])," +
  "textarea";

// Order matters: more specific patterns first, so e.g. "first name" is
// claimed before the generic "name" pattern gets a chance at it.
const FIELD_PATTERNS = [
  { key: "firstName", patterns: [/first\s*name/i, /given\s*name/i, /\bfname\b/i] },
  { key: "lastName", patterns: [/last\s*name/i, /family\s*name/i, /surname/i, /\blname\b/i] },
  { key: "email", patterns: [/e-?\s*mail/i] },
  { key: "phone", patterns: [/phone/i, /mobile/i, /telephone/i] },
  { key: "linkedin", patterns: [/linked\s*in/i] },
  { key: "github", patterns: [/git\s*hub/i] },
  {
    key: "portfolio",
    patterns: [/portfolio/i, /personal\s*(site|website)/i, /\bwebsite\b/i],
  },
  { key: "location", patterns: [/current\s*location/i, /^city$/i, /city,?\s*state/i] },
  {
    key: "coverLetter",
    patterns: [/cover\s*letter/i, /additional\s*information/i, /why\s*(are\s*you|do\s*you)/i],
  },
  // Checked last so it doesn't swallow "first name" / "last name" fields.
  { key: "fullName", patterns: [/^\s*full\s*name\s*$/i, /^\s*name\s*$/i, /your\s*name/i] },
];

function buildValues(resume, coverLetterText) {
  const [firstName, ...rest] = (resume.name || "").split(" ");
  return {
    firstName,
    lastName: rest.join(" "),
    fullName: resume.name,
    email: resume.contact?.email,
    phone: resume.contact?.phone,
    linkedin: resume.contact?.linkedin,
    github: resume.contact?.github,
    portfolio: resume.contact?.portfolio,
    location: resume.contact?.location,
    coverLetter: coverLetterText,
  };
}

/**
 * Fills whatever it can recognize on an arbitrary application form and
 * leaves everything else untouched. Returns a summary the caller can log.
 */
export async function fillGenericForm(page, { resume, coverLetterText }) {
  const values = buildValues(resume, coverLetterText);

  const fields = await page.$$eval(FILLABLE_SELECTOR, (els) =>
    els.map((el, index) => {
      const labelText = (() => {
        if (el.id) {
          const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (byFor?.innerText) return byFor.innerText;
        }
        const wrapping = el.closest("label");
        if (wrapping?.innerText) return wrapping.innerText;
        const container = el.closest("div, li, fieldset, tr");
        const nearbyLabel = container?.querySelector("label");
        if (nearbyLabel?.innerText) return nearbyLabel.innerText;
        return "";
      })();

      return {
        index,
        name: el.name || "",
        id: el.id || "",
        placeholder: el.placeholder || "",
        ariaLabel: el.getAttribute("aria-label") || "",
        autocomplete: el.getAttribute("autocomplete") || "",
        label: labelText,
        alreadyFilled: Boolean(el.value && el.value.trim()),
      };
    })
  );

  const usedIndexes = new Set();
  const filled = [];

  for (const { key, patterns } of FIELD_PATTERNS) {
    const value = values[key];
    if (!value) continue;

    const match = fields.find((f) => {
      if (usedIndexes.has(f.index) || f.alreadyFilled) return false;
      const haystack = [f.name, f.id, f.placeholder, f.ariaLabel, f.autocomplete, f.label]
        .join(" ")
        .trim();
      if (!haystack) return false;
      return patterns.some((p) => p.test(haystack));
    });

    if (!match) continue;

    usedIndexes.add(match.index);
    try {
      await page.locator(FILLABLE_SELECTOR).nth(match.index).fill(String(value));
      filled.push(key);
    } catch {
      // Field might be readonly, covered by an overlay, etc. — leave it for
      // the human reviewing the form rather than failing the whole run.
    }
  }

  const skipped = FIELD_PATTERNS.map((f) => f.key).filter(
    (key) => values[key] && !filled.includes(key)
  );

  console.log(
    filled.length
      ? `Filled: ${filled.join(", ")}. This is an unrecognized ATS, so double-check every field before submitting.`
      : "Couldn't confidently match any fields on this form — it may use a layout this heuristic doesn't recognize. Fill it in by hand."
  );
  if (skipped.length) {
    console.log(`Not found on this form: ${skipped.join(", ")}.`);
  }

  return { filled, skipped };
}
