#!/bin/bash
# EC2 setup script for Ubuntu 22.04 / 24.04
# Run once after SSHing into a fresh instance.
# Usage: bash scripts/ec2-setup.sh

set -e

echo "==> Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

echo "==> Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "==> Installing Playwright system dependencies..."
# These are needed for Chromium to run headless on a server
sudo apt-get install -y \
  libnss3 \
  libnspr4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libdbus-1-3 \
  libexpat1 \
  libxcb1 \
  libxkbcommon0 \
  libx11-6 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libcairo2 \
  libasound2 \
  libatspi2.0-0 \
  fonts-liberation \
  libappindicator3-1 \
  xdg-utils \
  wget \
  ca-certificates

echo "==> Installing npm dependencies..."
npm install

echo "==> Installing Playwright Chromium browser..."
npx playwright install chromium

echo ""
echo "=========================================="
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Copy auth/session.json to this machine:"
echo "     scp -i key.pem auth/session.json ubuntu@<EC2_IP>:~/chatgpt-scraper/auth/"
echo ""
echo "  2. Start the server:"
echo "     npm start"
echo ""
echo "  3. Test it:"
echo "     curl -X POST http://localhost:3000/chat \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"prompt\": \"What is 2+2?\"}'"
echo "=========================================="
