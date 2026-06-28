# ChatGPT Scraper Backend

A TypeScript/Node.js/Express API that drives a real Chromium browser via Playwright to interact with ChatGPT and DeepSeek — no official API key needed.

---

## How it works

```
POST /chat { "prompt": "...", "provider": "chatgpt" | "deepseek" }
        │
        ▼
  Playwright launches headless Chromium
        │
        ▼
  Loads chatgpt.com or chat.deepseek.com with your saved session (cookies)
        │
        ▼
  Types the prompt → submits → streams response chunks via SSE
        │
        ▼
  Returns streamed { "text": "..." } chunks (newline-delimited JSON)
```

---

## Step 1 — Save your session (run locally, once)

You need a machine with a screen (your laptop) for this step.

```bash
npm install
npm run login-chatgpt    # saves auth/chatGptSession.json
npm run login-deepseek   # saves auth/deepseekSession.json
```

A browser window opens. Log in normally. The script auto-detects login and saves the session.

> **Keep session files secret** — they contain your login cookies.

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

## Step 3 — Upload session files to EC2

```bash
scp -i your-key.pem auth/chatGptSession.json ubuntu@<EC2_IP>:~/chatgpt-scraper/auth/
scp -i your-key.pem auth/deepseekSession.json ubuntu@<EC2_IP>:~/chatgpt-scraper/auth/
```

---

## Step 4 — Build and start the server

```bash
npm run build   # compiles TypeScript → dist/
npm start       # runs dist/index.js
```

For development (no build step):
```bash
npm run dev     # runs via ts-node
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
{
  "prompt": "Explain recursion in one paragraph.",
  "provider": "deepseek"
}
```

`provider` is optional, defaults to `"deepseek"`. Accepted values: `"chatgpt"` | `"deepseek"`.

**Response** (streamed, newline-delimited JSON):
```
{"text":"Recursion is"}
{"text":" a technique..."}
```

**Error:**
```
{"error":"Not logged in (session expired)"}
```

---

## Project Structure

```
src/
  index.ts        # Express server & keep-alive
  chatgpt.ts      # ChatGPT browser automation
  deepseek.ts     # DeepSeek browser automation
scripts/
  chatgpt-save-session.ts
  deepseek-save-session.ts
auth/
  chatGptSession.json   # (git-ignored)
  deepseekSession.json  # (git-ignored)
dist/             # compiled output (after npm run build)
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| OOM kill on t2.micro | Add 2GB swap (see Step 2) or upgrade to t3.small |
| "Session expired" error | Re-run `npm run login-chatgpt` or `npm run login-deepseek`, re-upload session file |
| Chromium not found | Run `npx playwright install chromium` |
| Response times out | Increase `RESPONSE_TIMEOUT` in `src/chatgpt.ts` or `src/deepseek.ts` |
| Selector not found | Provider updated their UI; update selectors in `waitForCompleteResponse()` |
| TypeScript errors | Run `npx tsc --noEmit` to check; ensure `npm install` was run |

---

## EC2 Security Group

Make sure port **8080** (or your `PORT`) is open in your EC2 security group inbound rules, or put an Nginx reverse proxy in front.

---

## Notes

- Each request spins up a fresh Chromium instance and tears it down after. This is slower (~5–10s overhead) but avoids state leaking between requests.
- A keep-alive interval refreshes the ChatGPT session every 5 minutes to prevent cookie expiry.
- If you need concurrency, you can pool browser instances, but be careful about memory on small instances.
- Provider DOM selectors may change with UI updates. If things break, inspect the page and update the selectors in `src/chatgpt.ts` or `src/deepseek.ts`.
