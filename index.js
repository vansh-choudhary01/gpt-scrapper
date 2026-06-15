require("dotenv").config();
const express = require("express");
const { sendMessage } = require("./chatgpt");

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

  try {
    const response = await sendMessage(prompt.trim());
    console.log(`[${new Date().toISOString()}] Response received (${response.length} chars)`);
    res.json({ success: true, response });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ChatGPT scraper backend running on port ${PORT}`);
});
