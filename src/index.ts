import "dotenv/config";
import express, { Request, Response } from "express";
import path from "path";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { chatGptCompletions } from "./chatgpt";
import { deepseekCompletions } from "./deepseek";

chromium.use(StealthPlugin());

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

type Provider = "chatgpt" | "deepseek";

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// modelType = {
// instant: "Instant responses for daily conversations"
// reasoning: "For complex problems, limited resource, no search or file uploads."
// vision: "Image understanding"

// toolType = {
// Search: "Search the web for information"
// DeepThink: "Think before responding to solve reasoning problems"

type Tool = "Search" | "DeepThink"

export interface ChatRequest {
  prompt: string;
  provider: Provider;
  metadata?: {
    modelType?: "instant" | "reasoning" | "vision";
    allowedTools?: Tool[];
  };
}

app.post("/chat", async (req: Request, res: Response) => {
  const { prompt, provider = "deepseek", metadata = {
    modelType: "instant",
    allowedTools: ["Search"]
  }}: ChatRequest = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return res.status(400).json({ success: false, error: "prompt is required and must be a non-empty string" });
  }

  if (provider !== "chatgpt" && provider !== "deepseek") {
    return res.status(400).json({ success: false, error: "provider must be 'chatgpt' or 'deepseek'" });
  }

  if (metadata && typeof metadata !== "object") {
    return res.status(400).json({ success: false, error: "metadata must be an object" });
  }

  if (metadata.modelType && !["instant", "reasoning", "vision"].includes(metadata.modelType)) {
    return res.status(400).json({ success: false, error: "modelType must be 'instant', 'reasoning', or 'vision'" });
  }

  if (metadata.allowedTools && !metadata.allowedTools.every(tool => ["Search", "DeepThink"].includes(tool))) {
    return res.status(400).json({ success: false, error: "allowedTools must be an array containing 'Search' and/or 'DeepThink'" });
  }

  console.log(`[${new Date().toISOString()}] Received prompt: "${prompt.slice(0, 80)}..."`);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const onChunk = (chunk: string) => res.write(`${JSON.stringify({ text: chunk })}\n\n`);

  try {
    if (provider === "chatgpt") {
      await chatGptCompletions(prompt.trim(), onChunk);
    } else if (provider === "deepseek") {
      await deepseekCompletions(prompt.trim(), onChunk, metadata);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, (err as Error).message);
    res.write(`${JSON.stringify({ error: (err as Error).message })}\n\n`);
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`LLM scraper backend running on port ${PORT}`);
});

const SESSION_PATH = path.resolve(__dirname, "../auth/chatGptSession.json");

setInterval(async () => {
  try {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext({ storageState: SESSION_PATH });
    const page = await context.newPage();
    await page.goto("https://chatgpt.com/");
    console.log("Session refreshed");
    await page.close();
    await context.close();
    await browser.close();
  } catch (e) {
    console.log("Keep-alive failed:", e);
  }
}, 5 * 60 * 1000);
