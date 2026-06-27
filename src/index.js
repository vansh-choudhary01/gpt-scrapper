require("dotenv").config();
const express = require("express");
const { sendMessage } = require("./chatgpt");
const path = require("path");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Main chat endpoint
app.post("/chat", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return res.status(400).json({
      success: false,
      error: "prompt is required and must be a non-empty string",
    });
  }

  console.log(`[${new Date().toISOString()}] Received prompt: "${prompt.slice(0, 80)}..."`);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    await sendMessage(prompt.trim(), (chunk) => {
      res.write(`${JSON.stringify({text: chunk})}\n\n`);
    });
    // res.write(`${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, err.message);
    res.write(`${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`ChatGPT scraper backend running on port ${PORT}`);
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
    const SESSION_PATH = path.resolve(__dirname, "../auth/session.json");
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext({
      storageState: SESSION_PATH,
    });
    const page = await context.newPage();
    await page.goto("https://chatgpt.com/");
    console.log("🟢 Session refreshed");
    await page.close();
  } catch (e) {
    console.log("⚠️ Keep-alive failed: ", e);
  }
}, 5 * 60 * 1000); // every 5 min