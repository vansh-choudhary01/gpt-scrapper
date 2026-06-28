import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs";
import { Page } from "playwright";

chromium.use(StealthPlugin());

const SESSION_PATH = path.resolve(__dirname, "../auth/chatGptSession.json");
const CHATGPT_URL = "https://chatgpt.com";

const NAVIGATION_TIMEOUT = 30000;
const INPUT_TIMEOUT = 20000;

function log(...args: unknown[]): void {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function ensureSessionExists(): void {
  if (!fs.existsSync(SESSION_PATH)) {
    throw new Error(`Session file missing: ${SESSION_PATH}`);
  }
}

export async function chatGptCompletions(prompt: string, onChunk: (chunk: string) => void): Promise<string> {
  ensureSessionExists();

  log("Launching browser...");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({ storageState: SESSION_PATH });
  const page = await context.newPage();

  page.on("console", (msg) => log("Browser console:", msg.text()));
  page.on("requestfailed", (req) => log("Request failed:", req.url()));
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) log("Navigated to:", frame.url());
  });
  page.on("close", () => log("Page closed!"));

  try {
    log("Opening ChatGPT...");
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
    await page.waitForLoadState("networkidle");
    log("Page loaded:", page.url());

    if (page.url().includes("login")) throw new Error("Not logged in (session expired)");

    const isLoginModal = await page.$('[data-testid="modal-no-auth-login"]');

    if (isLoginModal) {
      log("NOT LOGGED IN — session expired. Waiting for manual login...");

      await page.waitForFunction(() => {
        const loginModal = document.querySelector('[data-testid="modal-no-auth-login"]');
        const chatInput = document.querySelector('[contenteditable="true"], textarea');
        return !loginModal && chatInput;
      }, { timeout: 120000 });

      log("Login detected! Saving session...");
      await context.storageState({ path: SESSION_PATH });
      log("Session saved at:", SESSION_PATH);

      await page.reload({ waitUntil: "networkidle" });

      if (await page.$('[data-testid="modal-no-auth-login"]')) {
        throw new Error("Login failed — session not persisted");
      }
    }

    log("Locating input box...");
    const inputEl = page.getByRole("textbox").first();
    await inputEl.waitFor({ state: "visible", timeout: INPUT_TIMEOUT });
    log("Input box found");

    log("Filling prompt...");
    await inputEl.click();
    await inputEl.fill(prompt);

    const typedValue = await inputEl.evaluate((el: Element) => {
      if ("value" in el) return (el as HTMLInputElement).value;
      return (el as HTMLElement).innerText || (el as HTMLElement).textContent || "";
    });
    log("Typed value:", typedValue);

    if (!typedValue || typedValue.trim() === "") throw new Error("Input typing failed");

    log("Sending message via Enter...");
    const beforeUrl = page.url();
    await inputEl.click();
    await page.waitForTimeout(300);
    await inputEl.press("Enter");
    log("Message sent (Enter)");

    const afterUrl = page.url();
    if (beforeUrl !== afterUrl) {
      await page.waitForLoadState("domcontentloaded");
      await page.waitForLoadState("networkidle");
    }

    await page.screenshot({ path: "debug_after_send.png" });

    let maxSec = 30;
    while (maxSec-- > 0 && !(await page.$('div[data-message-author-role="assistant"]'))) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      log(`Waiting for response... ${maxSec}s left`);
    }

    const userMsgCount = await page.$$eval('div[data-message-author-role="user"]', (nodes) => nodes.length);
    if (userMsgCount === 0) throw new Error("Message NOT sent (no user message detected)");

    log("Waiting for assistant message...");
    await page.waitForFunction(
      () => document.querySelectorAll('div[data-message-author-role="assistant"]').length > 0,
      { timeout: 30000 }
    );

    const response = await waitForCompleteResponse(page, onChunk);
    log("Final response length:", response.length);
    return response;

  } catch (err) {
    log("ERROR:", (err as Error).message);
    await page.screenshot({ path: "error.png" });
    throw err;
  } finally {
    await context.close();
    await browser.close();
    log("Browser closed");
  }
}

async function waitForCompleteResponse(page: Page, onChunk: (chunk: string) => void): Promise<string> {
  const selector = 'div[data-message-author-role="assistant"]';
  let lastText = "";
  let stableCount = 0;

  log("Tracking response stream...");

  for (let i = 0; i < 60; i++) {
    if (page.isClosed()) throw new Error("Page closed during response");

    await page.waitForTimeout(1000);

    const text = await page.$$eval(selector, (nodes: Element[]) =>
      (nodes as HTMLElement[]).map((n) => n.innerText.trim()).join("\n\n")
    );

    log(`Tick ${i} | Length: ${text.length}`);
    if (!text) continue;

    if (text === lastText) {
      stableCount++;
      log("No change (stable):", stableCount);
    } else {
      if (text.startsWith(lastText)) {
        onChunk(text.slice(lastText.length));
      } else {
        onChunk(text);
      }
      stableCount = 0;
      lastText = text;
      log("New content detected");
    }

    if (stableCount >= 3) {
      log("Response stabilized");
      return text;
    }
  }

  log("Returning partial response (timeout)");
  return lastText;
}
