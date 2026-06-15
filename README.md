# ChatGPT Scraper Backend

A Node.js/Express API that drives a real Chromium browser via Playwright to interact with ChatGPT — no official API key needed.

---

## How it works

```
POST /chat { "prompt": "..." }
        │
        ▼
  Playwright launches headless Chromium
        │
        ▼
  Loads chatgpt.com with your saved session (cookies)
        │
        ▼
  Types the prompt → submits → waits for full response
        │
        ▼
  Extracts & returns { "success": true, "response": "..." }
```

---

## Step 1 — Save your session (run locally, once)

You need a machine with a screen (your laptop) for this step.

```bash
npm install
npm run save-session
```

A browser window opens. Log in to ChatGPT normally (email/password, Google, etc.). Once you're on the main chat page, press **Enter** in the terminal. This saves `auth/session.json`.

> **Keep session.json secret** — it contains your login cookies.

---

## Step 2 — Provision your EC2 instance

Recommended: **t3.small** or larger (t2.micro is too tight for Chromium — you'll get OOM kills).

If you're on t2.micro, add swap:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

SSH into your instance, clone/upload the project, then:
```bash
bash scripts/ec2-setup.sh
```

---

## Step 3 — Upload session.json to EC2

```bash
scp -i your-key.pem auth/session.json ubuntu@<EC2_IP>:~/chatgpt-scraper/auth/
```

---

## Step 4 — Start the server

```bash
npm start
```

Or as a persistent background service:
```bash
sudo cp chatgpt-scraper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable chatgpt-scraper
sudo systemctl start chatgpt-scraper
sudo journalctl -u chatgpt-scraper -f   # view logs
```

---

## API

### `GET /health`
```json
{ "status": "ok" }
```

### `POST /chat`

**Request:**
```json
{ "prompt": "Explain recursion in one paragraph." }
```

**Response:**
```json
{
  "success": true,
  "response": "Recursion is a technique where a function calls itself..."
}
```

**Error (session expired):**
```json
{
  "success": false,
  "error": "Session expired or invalid. Re-run: npm run save-session"
}
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| OOM kill on t2.micro | Add 2GB swap (see Step 2) or upgrade to t3.small |
| "Session expired" error | Re-run `npm run save-session` locally, re-upload session.json |
| Chromium not found | Run `npx playwright install chromium` |
| Response times out | ChatGPT was slow; increase `RESPONSE_TIMEOUT` in `src/chatgpt.js` |
| Selector not found | ChatGPT updated their UI; update selectors in `waitForCompleteResponse()` |

---

## EC2 Security Group

Make sure port **3000** (or your `PORT`) is open in your EC2 security group inbound rules, or put an Nginx reverse proxy in front.

---

## Notes

- Each request spins up a fresh Chromium instance and tears it down after. This is slower (~5–10s overhead) but avoids state leaking between requests.
- If you need concurrency, you can pool browser instances, but be careful about memory on small instances.
- ChatGPT's DOM selectors may change with UI updates. If things break, inspect the page and update the selectors in `src/chatgpt.js`.
