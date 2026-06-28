const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");

chromium.use(StealthPlugin());

const SESSION_PATH = path.resolve(__dirname, "../auth/deepseekSession.json");
const DEEPSEEK_URL = "https://chat.deepseek.com";

const NAVIGATION_TIMEOUT = 30000;
const INPUT_TIMEOUT = 20000;
const RESPONSE_TIMEOUT = 120000;

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function ensureSessionExists() {
  if (!fs.existsSync(SESSION_PATH)) {
    throw new Error(`Session file missing: ${SESSION_PATH}`);
  }
}

async function deepseekCompletions(prompt, onChunk) {
  ensureSessionExists();

  log("Launching browser...");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    storageState: SESSION_PATH,
  });

  const page = await context.newPage();

  page.on("console", (msg) => log("Browser console:", msg.text()));
  page.on("requestfailed", (req) => log("Request failed:", req.url()));
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) log("Navigated to:", frame.url());
  });
  page.on("close", () => log("Page closed!"));

  try {
    // ─────────────── NAVIGATE ───────────────
    log("Opening DeepSeek...");
    await page.goto(DEEPSEEK_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT,
    });

    await page.waitForLoadState("networkidle");
    log("Page loaded:", page.url());

    if (
      page.url().toLowerCase().includes("log in") ||
      page.url().toLowerCase().includes("sign_in")
    ) {
      throw new Error("Not logged in to DeepSeek (session expired)");
    }

    const isLoginModal = await page.$('button:has-text("Log in")');
    if (isLoginModal) {
      log("NOT LOGGED IN — session expired");
      throw new Error("Not logged in to DeepSeek (session expired)");
    }

    // ─────────────── INPUT ───────────────
    log("Locating input box...");
    const inputEl = page.getByRole("textbox");
    await inputEl.waitFor({ state: "visible", timeout: INPUT_TIMEOUT });
    log("Input box found");

    log("Typing prompt...");
    await inputEl.click();
    await inputEl.fill(prompt);
    log("Prompt filled.");

    const typedValue = await inputEl.evaluate((el) => el.value);
    if (typedValue !== prompt) {
      throw new Error("Failed to fill the prompt correctly.");
    }

    // ─────────────── SEND ───────────────
    // ─────────────── SEND ───────────────
    log("Submitting prompt...");

    const submitButton = page.locator('button[class*="ds-button--primary"]');
    const submitExists = await submitButton.count();

    if (submitExists > 0) {
      await submitButton.click();
      log("Sent via submit button");
    } else {
      await inputEl.press("Enter");
      log("Sent via Enter key");
    }

    // URL changed to /a/chat/s/... = message sent, wait for page to settle
    await page.waitForLoadState("networkidle").catch(() => {});

    await page.screenshot({ path: "debug_after_send.png" });
    log("Screenshot saved: debug_after_send.png");

    // ─────────────── WAIT FOR ASSISTANT RESPONSE ───────────────
    // Skip user message check — URL redirect already confirms send
    log("Waiting for assistant response...");

    await page.waitForSelector(".ds-markdown-paragraph", {
      timeout: RESPONSE_TIMEOUT,
    });
    log("Assistant message appeared");

    // ─────────────── STREAM & COLLECT RESPONSE ───────────────
    const response = await waitForCompleteResponse(page, onChunk);
    log("Final response length:", response.length);

    return response;

  } catch (err) {
    log("ERROR:", err.message);
    await page.screenshot({ path: "error.png" }).catch(() => {});
    log("Error screenshot saved: error.png");
    throw err;
  } finally {
    await context.close();
    await browser.close();
    log("Browser closed");
  }
}

async function waitForCompleteResponse(page, onChunk) {
  // Confirmed selectors:
  //   final answer   → .ds-markdown-paragraph
  //   thinking chain → [class*="e1675d8b"]  (R1 reasoning, shown while thinking)
  //   ai container   → [class*="edb250b1"]
  const ANSWER_SEL = ".ds-markdown-paragraph";

  let lastText = "";
  let stableCount = 0;

  log("Tracking response stream...");

  for (let i = 0; i < 120; i++) {
    if (page.isClosed()) throw new Error("Page closed during response");

    await page.waitForTimeout(1000);

    // Still generating if: stop button visible OR thinking chain present
    const isGenerating = await page.evaluate(() => {
      const stopBtn = document.querySelector(
        '[class*="stop"], button[aria-label*="Stop"], button[aria-label*="stop"]'
      );
      const thinkingChain = document.querySelector('[class*="e1675d8b"]');
      return !!(stopBtn || thinkingChain);
    }).catch(() => false);

    // Grab the last ds-markdown--block = current reply
    const text = await page
      .$$eval(ANSWER_SEL, (nodes) => {
        const last = nodes[nodes.length - 1];
        return last ? last.innerText.trim() : "";
      })
      .catch(() => "");

    log(`Tick ${i} | Length: ${text.length} | Generating: ${isGenerating}`);

    if (!text) continue;

    if (text !== lastText) {
      if (onChunk) {
        text.startsWith(lastText)
          ? onChunk(text.slice(lastText.length))
          : onChunk(text);
      }
      stableCount = 0;
      lastText = text;
      log("New content detected");
    } else {
      stableCount++;
      log("No change (stable):", stableCount);
    }

    // Done: text stable 3 ticks AND no generation signal
    if (stableCount >= 3 && !isGenerating) {
      log("Response stabilized");
      return text;
    }
  }

  log("Returning partial response (timeout)");
  return lastText;
}

module.exports = { deepseekCompletions };