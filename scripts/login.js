import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { sessionPathFor, AUTH_DIR } from "../service/session.js";

/**
 * One-time (well, until the session expires) interactive login for a
 * platform that needs one — Wellfound, Instahyre, etc. This never sees or
 * stores your actual password: it opens a real, visible browser window,
 * YOU log in by hand (including any 2FA/CAPTCHA), and once you confirm
 * you're logged in it saves the resulting cookies/session to .auth/,
 * which discoverCompanies.js and apply.js then reuse automatically.
 *
 * Re-run this whenever a session expires — you'll start seeing login-wall
 * warnings in the console output when that happens.
 *
 * Usage: npm run login -- wellfound
 *        npm run login -- somesite https://somesite.com/login
 */
const PLATFORM_URLS = {
  wellfound: "https://wellfound.com/login",
  instahyre: "https://www.instahyre.com/login/",
  cutshort: "https://cutshort.io/login",
};

async function run() {
  const platform = process.argv[2];
  if (!platform) {
    console.error("Usage: npm run login -- <platform> [loginUrl]");
    console.error(`Known platforms: ${Object.keys(PLATFORM_URLS).join(", ")}`);
    process.exit(1);
  }

  const loginUrl = process.argv[3] || PLATFORM_URLS[platform];
  if (!loginUrl) {
    console.error(`No known login URL for "${platform}" — pass one explicitly: npm run login -- ${platform} <url>`);
    process.exit(1);
  }

  mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  console.log(`\nLog in to ${platform} in the browser window that just opened.`);
  console.log("Take your time — solve any CAPTCHA/2FA as needed. Nothing you type is sent anywhere but that site.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Once you're fully logged in, press Enter here to save the session... ");
  await rl.close();

  const path = sessionPathFor(platform);
  await context.storageState({ path });
  console.log(`Session saved to ${path}. Re-run this any time it expires.`);

  await browser.close();
}

run().catch((err) => {
  console.error("Login run failed:", err);
  process.exit(1);
});