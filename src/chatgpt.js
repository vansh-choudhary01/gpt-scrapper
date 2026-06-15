const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");

chromium.use(StealthPlugin());

const SESSION_PATH = path.resolve(__dirname, "../auth/session.json");
const CHATGPT_URL = "https://chatgpt.com";

// Timeouts (ms)
const NAVIGATION_TIMEOUT = 30_000;
const INPUT_TIMEOUT = 15_000;
const RESPONSE_TIMEOUT = 120_000; // ChatGPT can be slow
const RESPONSE_IDLE_MS = 3_000;   // Wait this long with no DOM changes before assuming done

function ensureSessionExists() {
  if (!fs.existsSync(SESSION_PATH)) {
    throw new Error(
      `Session file not found at ${SESSION_PATH}. ` +
      `Run: npm run save-session  to log in and save your session.`
    );
  }
}

/**
 * Sends a prompt to ChatGPT via browser automation and returns the response text.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function sendMessage(prompt) {
  ensureSessionExists();

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    storageState: SESSION_PATH,
    // Match same UA used when saving the session
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  const page = await context.newPage();

  // Belt-and-suspenders: remove webdriver flag even in headless mode
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  try {
    // ── 1. Navigate to ChatGPT ──────────────────────────────────────────────
    await page.goto(CHATGPT_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT,
    });

    // If redirected to login page, session has expired
    const currentUrl = page.url();
    if (currentUrl.includes("/auth/login") || currentUrl.includes("login")) {
      throw new Error(
        "Session expired or invalid. Re-run: npm run save-session"
      );
    }

    // ── 2. Wait for the input box ───────────────────────────────────────────
    // ChatGPT uses a contenteditable div or a <textarea> depending on version
    const inputSelector = [
      '#prompt-textarea',
      'div[contenteditable="true"][data-id="root"]',
      'textarea[placeholder]',
    ].join(", ");

    const inputEl = await page.waitForSelector(inputSelector, {
      timeout: INPUT_TIMEOUT,
      state: "visible",
    });

    // ── 3. Type the prompt ──────────────────────────────────────────────────
    await inputEl.click();
    await inputEl.fill("");           // clear any leftover text
    await inputEl.type(prompt, { delay: 20 }); // slight delay = more human-like

    // ── 4. Submit ───────────────────────────────────────────────────────────
    // Try the send button first; fall back to Enter key
    const sendButtonSelector = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send prompt"]',
    ].join(", ");

    const sendBtn = await page.$(sendButtonSelector);
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await inputEl.press("Enter");
    }

    // ── 5. Wait for response to complete ───────────────────────────────────
    const responseText = await waitForCompleteResponse(page);

    return formatResponse(responseText);
  } finally {
    await context.close();
    await browser.close();
  }
}

/**
 * Polls the page until ChatGPT has finished generating its response.
 * Strategy: wait for the "Stop generating" button to disappear,
 * then grab the last assistant message block.
 */
async function waitForCompleteResponse(page) {
  const stopButtonSelector = [
    'button[aria-label="Stop generating"]',
    'button[data-testid="stop-button"]',
  ].join(", ");

  const assistantMsgSelector = [
    '[data-message-author-role="assistant"]',
    '.markdown.prose',
    '[class*="agent-turn"] .markdown',
  ].join(", ");

  // Wait for the stop button to appear (means generation started)
  try {
    await page.waitForSelector(stopButtonSelector, { timeout: 15_000 });
  } catch {
    // Sometimes it appears and disappears very fast for short answers — that's fine
    console.warn("Stop button never appeared; ChatGPT may have responded instantly.");
  }

  // Wait for the stop button to disappear (means generation finished)
  await page.waitForFunction(
    (sel) => !document.querySelector(sel),
    stopButtonSelector,
    { timeout: RESPONSE_TIMEOUT }
  );

  // Extra idle wait — DOM sometimes still updating
  await page.waitForTimeout(1_000);

  // ── Extract the last assistant message ────────────────────────────────────
  const text = await page.evaluate((sel) => {
    const nodes = document.querySelectorAll(sel);
    if (!nodes.length) return null;
    // Last element = most recent assistant turn
    return nodes[nodes.length - 1].innerText.trim();
  }, assistantMsgSelector);

  if (!text) {
    throw new Error("Could not extract response text from page.");
  }

  return text;
}

/**
 * Light formatting pass on extracted text.
 */
function formatResponse(raw) {
  return raw
    .replace(/\n{3,}/g, "\n\n") // collapse excessive blank lines
    .trim();
}

module.exports = { sendMessage };