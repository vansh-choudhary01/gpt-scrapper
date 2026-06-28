require("dotenv").config();
const express = require("express");
const path = require("path");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { chatGptCompletions } = require("./chatgpt");
const { deepseekCompletions } = require("./deepseek");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// modelType = {
// instant: "Instant responses for daily conversations"
// reasoning: "For complex problems, limited resource, no search or file uploads."
// vision: "Image understanding"

// toolType = {
// Search: "Search the web for information"
// DeepThink: "Think before responding to solve reasoning problems"

// Main chat endpoint
app.post("/chat", async (req, res) => {
  const { prompt, provider = "deepseek", metadata = {}} = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return res.status(400).json({
      success: false,
      error: "prompt is required and must be a non-empty string",
    });
  }

  if (!provider || (provider !== "chatgpt" && provider !== "deepseek")) {
    return res.status(400).json({
      success: false,
      error: "provider is required and must be either 'chatgpt' or 'deepseek'",
    });
  }

  console.log(`[${new Date().toISOString()}] Received prompt: "${prompt.slice(0, 80)}..."`);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    if (provider === "chatgpt") {
      await chatGptCompletions(prompt.trim(), (chunk) => {
        res.write(`${JSON.stringify({ text: chunk })}\n\n`);
      });
    } else if (provider === "deepseek") {
      await deepseekCompletions(prompt.trim(), (chunk) => {
        res.write(`${JSON.stringify({ text: chunk })}\n\n`);
      });
    } else {
      res.status(400).json({
        success: false,
        error: "Invalid provider. Must be 'chatgpt' or 'deepseek'.",
      });
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, err.message);
    res.write(`${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`LLM scraper backend running on port ${PORT}`);
});

// const { chromium } = require("playwright");
// const fs = require("fs");

// (async () => {
//   const browser = await chromium.launch({ headless: false });
//   const context = await browser.newContext();
//   const page = await context.newPage();

//   await page.goto("https://chatgpt.com");

//   console.log("👉 Login manually, then press ENTER here...");
//   process.stdin.once("data", async () => {
//     await context.storageState({ path: "session.json" });
//     console.log("✅ Session saved!");
//     await browser.close();
//   });
// })();

setInterval(async () => {
  try {
    const SESSION_PATH = path.resolve(__dirname, "../auth/chatGptSession.json");
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext({
      storageState: SESSION_PATH,
    });
    const page = await context.newPage();
    await page.goto("https://chatgpt.com/");
    console.log("Session refreshed");
    await page.close();
  } catch (e) {
    console.log("Keep-alive failed: ", e);
  }
}, 5 * 60 * 1000); // every 5 min
