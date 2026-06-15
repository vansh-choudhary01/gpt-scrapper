const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");

chromium.use(StealthPlugin());

const SESSION_PATH = path.resolve(__dirname, "../auth/session.json");
const CHATGPT_URL = "https://chatgpt.com";

// Timeouts
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

async function sendMessage(prompt) {
  ensureSessionExists();

  log("🚀 Launching browser...");

  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    storageState: SESSION_PATH,
  });

  const page = await context.newPage();

  // 🔍 GLOBAL DEBUG LISTENERS
  page.on("console", (msg) => log("🧠 Browser console:", msg.text()));
  page.on("requestfailed", (req) =>
    log("❌ Request failed:", req.url())
  );
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      log("🔄 Navigated to:", frame.url());
    }
  });
  page.on("close", () => log("❌ Page closed!"));

  try {
    // ─────────────── NAVIGATE ───────────────
    log("🌍 Opening ChatGPT...");
    await page.goto(CHATGPT_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT,
    });

    await page.waitForLoadState("networkidle");
    log("✅ Page loaded:", page.url());

    if (page.url().includes("login")) {
      throw new Error("❌ Not logged in (session expired)");
    }

    const isLoginModal = await page.$('[data-testid="modal-no-auth-login"]');

    if (isLoginModal) {
      // throw new Error("❌ NOT LOGGED IN — session expired");
      console.log("❌ NOT LOGGED IN — session expired");
      // try to login manually
      console.log("👉 Login manually, then press ENTER here...");
      process.stdin.once("data", async () => {
        await context.storageState({ path: "session.json" });
        console.log("✅ Session saved!");
        await browser.close();
      });
      await new Promise(resolve => setTimeout(resolve, 60000));

      if (await page.$('[data-testid="modal-no-auth-login"]')) return "❌ NOT LOGGED IN — session expired";
    }

    // ─────────────── INPUT DETECTION ───────────────
    log("🔎 Locating input box...");

    const inputEl = page.getByRole("textbox").first();

    await inputEl.waitFor({
      state: "visible",
      timeout: INPUT_TIMEOUT,
    });

    log("✅ Input box found");

    // ─────────────── TYPE PROMPT ───────────────
    log("⌨️ Typing prompt...");
    await inputEl.click();
    await inputEl.fill("");
    await inputEl.type(prompt, { delay: 20 });

    const typedValue = await inputEl.inputValue().catch(() => "N/A");
    log("📥 Typed value:", typedValue);

    if (!typedValue || typedValue.trim() === "") {
      throw new Error("❌ Input typing failed");
    }

    // ─────────────── SEND MESSAGE ───────────────
    log("📤 Attempting to send message...");

    const beforeUrl = page.url();

    const sendBtn = await page.$(
      'button[data-testid="send-button"], button:has(svg)'
    );

    if (sendBtn) {
      log("🟢 Send button found → clicking");

      await Promise.all([
        page.waitForURL(/\/c\//, { timeout: 10000 }).catch(() => null),
        sendBtn.click(),
      ]);

      log("📨 Sent via button");
    } else {
      log("🟡 Send button not found → using Enter");

      await Promise.all([
        page.waitForURL(/\/c\//, { timeout: 10000 }).catch(() => null),
        inputEl.press("Enter"),
      ]);

      log("📨 Sent via Enter");
    }

    const afterUrl = page.url();
    log("🌐 URL after send:", afterUrl);

    if (beforeUrl !== afterUrl) {
      log("🔄 Redirect detected");

      await page.waitForLoadState("domcontentloaded");
      await page.waitForLoadState("networkidle");
    }

    // 📸 Screenshot for debugging
    await page.screenshot({ path: "debug_after_send.png" });
    log("📸 Screenshot saved: debug_after_send.png");

    // ─────────────── VERIFY MESSAGE SENT ───────────────
    const userMsgCount = await page.$$eval(
      'div[data-message-author-role="user"]',
      (nodes) => nodes.length
    );

    log("👤 User messages on page:", userMsgCount);

    if (userMsgCount === 0) {
      throw new Error("❌ Message NOT sent (no user message detected)");
    }

    // ─────────────── WAIT FOR ASSISTANT MESSAGE ───────────────
    log("⏳ Waiting for assistant message...");

    await page.waitForFunction(() => {
      return document.querySelectorAll(
        'div[data-message-author-role="assistant"]'
      ).length > 0;
    }, { timeout: 30000 });

    log("✅ Assistant message appeared");

    // ─────────────── EXTRACT RESPONSE ───────────────
    const response = await waitForCompleteResponse(page);

    log("✅ Final response length:", response.length);

    return response;

  } catch (err) {
    log("💥 ERROR:", err.message);

    await page.screenshot({ path: "error.png" });
    log("📸 Error screenshot saved: error.png");

    throw err;
  } finally {
    await context.close();
    await browser.close();
    log("🧹 Browser closed");
  }
}

// 🔥 RESPONSE TRACKER WITH LOGGING
async function waitForCompleteResponse(page) {
  const selector = 'div[data-message-author-role="assistant"]';

  let lastText = "";
  let stableCount = 0;

  log("📡 Tracking response stream...");

  for (let i = 0; i < 60; i++) {
    if (page.isClosed()) {
      throw new Error("Page closed during response");
    }

    await page.waitForTimeout(1000);

    const text = await page.$$eval(selector, (nodes) =>
      nodes.map(n => n.innerText.trim()).join("\n\n")
    );

    log(`🧩 Tick ${i} | Length: ${text.length}`);

    if (!text) continue;

    if (text === lastText) {
      stableCount++;
      log("⏸️ No change (stable):", stableCount);
    } else {
      stableCount = 0;
      lastText = text;
      log("🔄 New content detected");
    }

    if (stableCount >= 3) {
      log("✅ Response stabilized");
      return text;
    }
  }

  log("⚠️ Returning partial response (timeout)");
  return lastText;
}

module.exports = { sendMessage };