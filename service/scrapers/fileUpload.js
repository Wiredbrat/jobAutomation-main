/**
 * Shared by all fillers (greenhouse/lever/generic). Every ATS exposes resume
 * upload as a plain <input type="file">, but none use a consistent name/id
 * for it, and Greenhouse's own markup has changed across embed versions —
 * matching by nearby label text is more durable than a hardcoded selector.
 */
const RESUME_PATTERNS = [/resume/i, /\bcv\b/i, /curriculum\s*vitae/i];

export async function uploadResumeIfPresent(page, resumeFilePath) {
  if (!resumeFilePath) return false;

  const fileInputs = await page.$$eval('input[type="file"]', (els) =>
    els.map((el, index) => {
      const label = (() => {
        if (el.id) {
          const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (byFor?.innerText) return byFor.innerText;
        }
        const wrapping = el.closest("label");
        if (wrapping?.innerText) return wrapping.innerText;
        const container = el.closest("div, li, fieldset, tr, section");
        return container?.querySelector("label")?.innerText || "";
      })();
      return {
        index,
        name: el.name || "",
        id: el.id || "",
        ariaLabel: el.getAttribute("aria-label") || "",
        label,
      };
    })
  );

  const match = fileInputs.find((f) =>
    RESUME_PATTERNS.some((p) => p.test([f.name, f.id, f.ariaLabel, f.label].join(" ")))
  );
  // No labeled match but exactly one file field on the page? Almost always the resume.
  const target = match || (fileInputs.length === 1 ? fileInputs[0] : null);
  if (!target) return false;

  try {
    await page.locator('input[type="file"]').nth(target.index).setInputFiles(resumeFilePath);
    console.log(`Uploaded resume from ${resumeFilePath}.`);
    return true;
  } catch (err) {
    console.warn(`Couldn't upload resume automatically: ${err.message}. Attach it manually.`);
    return false;
  }
}
