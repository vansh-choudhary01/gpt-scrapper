import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs";
import { Locator, Page } from "playwright";
import { ChatRequest } from ".";

chromium.use(StealthPlugin());

const SESSION_PATH = path.resolve(__dirname, "../auth/deepseekSession.json");
const DEEPSEEK_URL = "https://chat.deepseek.com";

const NAVIGATION_TIMEOUT = 30000;
const INPUT_TIMEOUT = 20000;
const RESPONSE_TIMEOUT = 120000;

function log(...args: unknown[]): void {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function ensureSessionExists(): void {
  if (!fs.existsSync(SESSION_PATH)) {
    throw new Error(`Session file missing: ${SESSION_PATH}`);
  }
}

async function findLocatorByHTML(locators: Locator[], text: string): Promise<Locator | undefined> {
  for (const el of locators) {
    const html = await el.innerHTML();
    if (html.includes(text)) return el;
  }
  return undefined;
}

export async function deepseekCompletions(prompt: string, onChunk: (chunk: string) => void, metadata?: ChatRequest["metadata"]): Promise<string> {
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
    log("Opening DeepSeek...");
    await page.goto(DEEPSEEK_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
    await page.waitForLoadState("networkidle");
    log("Page loaded:", page.url());

    if (page.url().toLowerCase().includes("log in") || page.url().toLowerCase().includes("sign_in")) {
      throw new Error("Not logged in to DeepSeek (session expired)");
    }

    const isLoginModal = await page.$('button:has-text("Log in")');
    if (isLoginModal) {
      log("NOT LOGGED IN — session expired");
      throw new Error("Not logged in to DeepSeek (session expired)");
    }

    log("Locating input box...");
    const inputEl = page.getByRole("textbox");
    await inputEl.waitFor({ state: "visible", timeout: INPUT_TIMEOUT });
    log("Input box found");

    const models = ["instant", "reasoning", "vision"];

    const modelDivs = await page.locator('div[class*="_9f2341b _18572c1"]').all();
    const toolDivs = await page.locator('div[class*="f79352dc ds-toggle-button ds-toggle-button--m"]').all();

    async function toolSelection(button: Locator | undefined, allowedTool: boolean | undefined, type: "tool" | "model") {
      if (!button) {
        log("Tool button not found");
        throw new Error("Tool button not found");
      }

      const isPressed = await button.getAttribute(type === "tool" ? "aria-pressed": "aria-checked");

      if (allowedTool && isPressed === "false") {
        log("Activating button...");
        await button.click();
      } else if (!allowedTool && isPressed === "true") {
        log("Deactivating button...");
        await button.click();
      } else {
        log("Button state already correct");
      }
    }

    // ── Tool buttons ──
    const deepThinkButton = await findLocatorByHTML(toolDivs, "DeepThink");
    const searchButton = await findLocatorByHTML(toolDivs, "Search");

    const allowedDeepThink = metadata?.allowedTools?.includes("DeepThink");
    const allowedSearch = metadata?.allowedTools?.includes("Search");

    await toolSelection(deepThinkButton, allowedDeepThink, "tool");
    await toolSelection(searchButton, allowedSearch, "tool");

    // ── Model button ──
    const modelTypeButtonIndex = models.indexOf(metadata?.modelType ?? "instant");
    const modelTypeButton = modelDivs[modelTypeButtonIndex];

    await toolSelection(modelTypeButton, modelTypeButtonIndex !== -1, "model");
    log("Typing prompt...");
    await inputEl.click();
    await inputEl.fill(prompt);
    log("Prompt filled.");

    const typedValue = await inputEl.evaluate((el: Element) => (el as HTMLInputElement).value);
    if (typedValue !== prompt) throw new Error("Failed to fill the prompt correctly.");

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

    await page.waitForLoadState("networkidle").catch(() => { });
    await page.screenshot({ path: "debug_after_send.png" });

    log("Waiting for assistant response...");
    await page.waitForSelector(".ds-markdown-paragraph", { timeout: RESPONSE_TIMEOUT });
    log("Assistant message appeared");

    const response = await waitForCompleteResponse(page, onChunk);
    log("Final response length:", response.length);
    return response;

  } catch (err) {
    log("ERROR:", (err as Error).message);
    await page.screenshot({ path: "error.png" }).catch(() => { });
    throw err;
  } finally {
    await context.close();
    await browser.close();
    log("Browser closed");
  }
}

async function waitForCompleteResponse(page: Page, onChunk: (chunk: string) => void): Promise<string> {
  const ANSWER_SEL = ".ds-markdown-paragraph";
  let lastText = "";
  let stableCount = 0;

  log("Tracking response stream...");

  const totalWaitTime = 120;
  const speed = 1;

  for (let i = 0; i < totalWaitTime; i++) {
    if (page.isClosed()) throw new Error("Page closed during response");

    await page.waitForTimeout(1000 / speed);

    const isGenerating = await page.evaluate(() => {
      const stopBtn = document.querySelector('[class*="stop"], button[aria-label*="Stop"], button[aria-label*="stop"]');
      const thinkingChain = document.querySelector('[class*="e1675d8b"]');
      const thinkingStopedChain = document.querySelector('[class*="_5ab5d64"]');
      return !!(stopBtn || (thinkingChain && !thinkingStopedChain));
    }).catch(() => false);

    const text = await page.$$eval(ANSWER_SEL, (nodes: Element[]) => {
      const last = nodes[nodes.length - 1] as HTMLElement;
      return last ? last.innerText.trim() : "";
    }).catch(() => "");

    log(`Tick ${i} | Length: ${text.length} | Generating: ${isGenerating}`);
    if (!text) continue;

    if (text !== lastText) {
      text.startsWith(lastText) ? onChunk(text.slice(lastText.length)) : onChunk(text);
      stableCount = 0;
      lastText = text;
      log("New content detected");
    } else {
      stableCount++;
      log("No change (stable):", stableCount);
    }

    if (stableCount >= 3 * speed && !isGenerating) {
      log("Response stabilized");
      return text;
    }
  }

  log("Returning partial response (timeout)");
  return lastText;
}
