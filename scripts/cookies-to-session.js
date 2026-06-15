/**
 * Converts a Cookie-Editor JSON export into a Playwright session.json.
 *
 * Steps:
 *  1. Log in to chatgpt.com in your real Chrome browser
 *  2. Install Cookie-Editor extension
 *  3. On chatgpt.com, open Cookie-Editor → Export → "Export as JSON"
 *  4. Save that file as auth/cookies.json
 *  5. Run: node scripts/cookies-to-session.js
 *  6. auth/session.json will be created, ready for the backend
 */

const fs = require("fs");
const path = require("path");

const COOKIES_IN  = path.resolve(__dirname, "../auth/cookies.json");
const SESSION_OUT = path.resolve(__dirname, "../auth/session.json");

if (!fs.existsSync(COOKIES_IN)) {
  console.error(`❌ Not found: ${COOKIES_IN}`);
  console.error("   Export cookies from Cookie-Editor and save them there.");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(COOKIES_IN, "utf8"));

// Cookie-Editor format → Playwright storageState format
const converted = raw.map((c) => ({
  name:     c.name,
  value:    c.value,
  domain:   c.domain,
  path:     c.path     ?? "/",
  expires:  c.expirationDate ?? -1,
  httpOnly: c.httpOnly ?? false,
  secure:   c.secure   ?? false,
  sameSite: normalizeSameSite(c.sameSite),
}));

const session = {
  cookies: converted,
  origins: [],
};

fs.mkdirSync(path.dirname(SESSION_OUT), { recursive: true });
fs.writeFileSync(SESSION_OUT, JSON.stringify(session, null, 2));

console.log(`✅ Converted ${converted.length} cookies → ${SESSION_OUT}`);
console.log("   Copy this file to your EC2 instance:");
console.log(`   scp -i your-key.pem ${SESSION_OUT} ubuntu@<EC2_IP>:~/chatgpt-scraper/auth/\n`);

function normalizeSameSite(val) {
  if (!val) return "None";
  const v = val.toLowerCase();
  if (v === "strict") return "Strict";
  if (v === "lax")    return "Lax";
  return "None";
}