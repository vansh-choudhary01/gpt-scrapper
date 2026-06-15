/**
 * Run this script ONCE (locally, with a screen) to log in to ChatGPT
 * and save the authenticated session to auth/session.json.
 *
 * Usage:
 *   npm run save-session
 *
 * A real browser window will open. Log in manually, then press Enter
 * in the terminal and the session will be saved.
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

const SESSION_PATH = path.resolve(__dirname, "../auth/session.json");

async function main() {
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });

  const browser = await chromium.launch({
    headless: false, // Must be headed so you can log in
    slowMo: 50,
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" });

  console.log("\n========================================");
  console.log("A browser window has opened.");
  console.log("Log in to ChatGPT normally.");
  console.log("Once you're on the main chat page,");
  console.log("come back here and press ENTER.");
  console.log("========================================\n");

  await waitForEnter();

  // Save session (cookies + localStorage + sessionStorage)
  await context.storageState({ path: SESSION_PATH });
  console.log(`\n✅ Session saved to: ${SESSION_PATH}`);
  console.log("Copy this file to your EC2 instance at the same path.\n");

  await browser.close();
}

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.question("Press ENTER when logged in > ", () => {
      rl.close();
      resolve();
    });
  });
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
