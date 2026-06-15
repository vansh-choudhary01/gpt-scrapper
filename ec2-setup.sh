#!/bin/bash
set -e

echo "==> Updating system..."
sudo apt-get update -y && sudo apt-get upgrade -y

echo "==> Installing Docker & Git..."
sudo apt-get install -y docker.io docker-compose git

echo "==> Starting Docker..."
sudo systemctl start docker
sudo systemctl enable docker

echo "==> Cloning repository..."
cd ~

if [ ! -d "gpt-scrapper" ]; then
  git clone https://github.com/vansh-choudhary01/gpt-scrapper.git
else
  echo "Repo already exists, pulling latest..."
  cd gpt-scrapper && git pull
  cd ..
fi

cd gpt-scrapper

echo ""
echo "=========================================="
echo "⚠️  IMPORTANT MANUAL STEP"
echo ""
echo "Copy your session file BEFORE starting:"
echo ""
echo "scp -i key.pem auth/session.json ubuntu@<EC2_IP>:~/gpt-scrapper/auth/"
echo ""
echo "Then press ENTER to continue..."
echo "=========================================="
read

echo "==> Building & starting containers..."
sudo docker-compose up -d --build

echo ""
echo "==> Waiting for containers..."
sleep 5

echo "==> Container status:"
sudo docker ps

echo ""
echo "=========================================="
echo "✅ DEPLOYMENT COMPLETE"
echo ""
echo "🌐 Test API:"
echo ""
echo "curl -X POST http://<EC2_IP>/chat \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"prompt\":\"hello\"}'"
echo ""
echo "📊 Logs:"
echo "docker logs gpt-app"
echo "docker logs gpt-nginx"
echo ""
echo "🔄 Restart:"
echo "docker-compose restart"
echo "=========================================="