/**
 * Run this script ONCE (locally, with a screen) to log in to ChatGPT
 * and save the authenticated session to auth/session.json.
 *
 * Uses playwright-extra + stealth plugin to bypass Cloudflare bot detection.
 *
 * Usage:
 *   npm run save-session
 */

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

// Apply stealth — must be done before launch
chromium.use(StealthPlugin());

const SESSION_PATH = path.resolve(__dirname, "../auth/session.json");

async function main() {
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: [
      // Makes Playwright look like a real Chrome install
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
  });

  const context = await browser.newContext({
    // Match a real Windows Chrome fingerprint (less suspicious than Linux on a desktop login)
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  const page = await context.newPage();

  // Remove the webdriver flag that Cloudflare specifically checks
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" });

  console.log("\n========================================");
  console.log("A browser window has opened.");
  console.log("If you see a Cloudflare check, click it manually.");
  console.log("Then log in to ChatGPT normally.");
  console.log("Once you are on the main chat page,");
  console.log("come back here and press ENTER.");
  console.log("========================================\n");

  await waitForEnter();

  // Verify we're actually logged in before saving
  const url = page.url();
  if (url.includes("/auth/login") || url.includes("/api/auth/error")) {
    console.error("❌ Doesn't look like you're logged in yet (URL: " + url + ")");
    console.error("   Make sure you're on the main chat page before pressing Enter.");
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: SESSION_PATH });
  console.log(`\n✅ Session saved to: ${SESSION_PATH}`);
  console.log("Copy this file to your EC2 instance:\n");
  console.log(`  scp -i your-key.pem ${SESSION_PATH} ubuntu@<EC2_IP>:~/chatgpt-scraper/auth/\n`);

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