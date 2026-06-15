const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");

chromium.use(StealthPlugin());

const SESSION_PATH = path.resolve(__dirname, "../auth/session.json");

async function main() {
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
  });

  await page.goto("https://chatgpt.com", {
    waitUntil: "domcontentloaded",
  });

  console.log("🧠 Waiting for REAL login (strict check)...");

  let loggedIn = false;

  while (!loggedIn) {
    const url = page.url();

    const inputBox = await page.$(
      '#prompt-textarea, textarea, div[contenteditable="true"]'
    );

    const loginButton = await page.$(
      'button:has-text("Log in"), a:has-text("Log in")'
    );

    console.log("🔍 URL:", url);
    console.log("➡️ inputBox:", !!inputBox);
    console.log("➡️ loginButton:", !!loginButton);

    // 🔥 STRICT CONDITION
    if (inputBox && !loginButton && !url.includes("/auth")) {
      console.log("✅ Fully logged in!");
      loggedIn = true;
      break;
    }

    console.log("⏳ Still not logged in...");
    console.log("👉 Complete login in browser");

    await page.waitForTimeout(3000);
  }

  // Extra stability wait
  await page.waitForTimeout(2000);

  await context.storageState({ path: SESSION_PATH });

  console.log(`\n✅ Session saved to: ${SESSION_PATH}`);

  await browser.close();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});