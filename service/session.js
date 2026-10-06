import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const AUTH_DIR = join(__dirname, "..", ".auth");

export function sessionPathFor(platform) {
  return join(AUTH_DIR, `${platform}.json`);
}

/**
 * Opens a browser context using a saved login session for `platform`, if
 * one exists (created via `npm run login -- <platform>`). Falls back to a
 * fresh, logged-out context otherwise — some pages work fine without
 * login, others will just show a login wall, which the caller should
 * handle (skip / flag / log a warning) rather than fail on.
 */
export async function openSession(browser, platform) {
  const path = sessionPathFor(platform);
  const loggedIn = existsSync(path);
  const context = await browser.newContext(loggedIn ? { storageState: path } : {});
  return { context, loggedIn };
}