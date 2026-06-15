#!/bin/bash
set -e

echo "==> Updating system..."
sudo apt-get update -y && sudo apt-get upgrade -y

echo "==> Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "==> Installing dependencies..."
npm install

echo "==> Installing Playwright + system deps..."
npx playwright install
npx playwright install-deps

echo "==> Installing PM2..."
sudo npm install -g pm2

echo ""
echo "=========================================="
echo "Setup complete!"
echo ""
echo "IMPORTANT:"
echo "1. Copy session.json from local machine:"
echo "   scp -i key.pem auth/session.json ubuntu@<EC2_IP>:~/chatgpt-scraper/auth/"
echo ""
echo "2. Start server with PM2:"
echo "   pm2 start server.js --name chatgpt-bot"
echo "   pm2 save"
echo ""
echo "3. Test:"
echo "   curl -X POST http://localhost:3000/chat \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"prompt\": \"hello\"}'"
echo "=========================================="