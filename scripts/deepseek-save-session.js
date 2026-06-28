const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");

// Use the stealth plugin to avoid detection
chromium.use(StealthPlugin());

const SESSION_PATH = path.resolve(__dirname, "../auth/deepseekSession.json");

async function main() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Please login to DeepSeek at the opened browser...");
  await page.goto("https://chat.deepseek.com/");

  let loggedIn = false;
  for (let i = 0; i < 30; i++) {
    const url = page.url();
    const inputBox = await page.$(
      'textarea[name="search"], div[class="ds-scroll-area__gutters"]'
    );
    const loginButton = await page.$('button:has-text("Log in")');

    console.log("URL:", url);
    console.log("inputBox:", !!inputBox);
    console.log("loginButton:", !!loginButton);

    if (inputBox && !loginButton && !url.includes("/sign_in")) {
      console.log("Fully logged in!");
      loggedIn = true;
      break;
    }

    console.log("Still not logged in...");
    console.log("Complete login in browser");

    await page.waitForTimeout(3000);
  }

  if (!loggedIn) {
    console.log("Login failed or timed out.");
    await browser.close();
    return;
  }

  // Extra stability wait
  await page.waitForTimeout(2000);

  await context.storageState({ path: SESSION_PATH });

  console.log(`\nSession saved to: ${SESSION_PATH}`);

  await browser.close();
}

main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});