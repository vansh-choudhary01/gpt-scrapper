#!/bin/bash
set -e

DOMAIN="chat.naaspeeti.xyz"

echo "==> Updating system..."
sudo apt-get update -y && sudo apt-get upgrade -y

echo "==> Installing dependencies..."
sudo apt-get install -y docker.io docker-compose git curl certbot

sudo systemctl start docker
sudo systemctl enable docker

echo "==> Cloning repo..."
cd ~

if [ ! -d "gpt-scrapper" ]; then
  git clone https://github.com/vansh-choudhary01/gpt-scrapper.git
fi

cd gpt-scrapper

echo "==> Creating certbot directories..."
mkdir -p certbot/www
mkdir -p certbot/conf

echo ""
echo "⚠️ Make sure domain points to this server:"
echo "chat.naaspeeti.xyz → $(curl -s ifconfig.me)"
echo ""
read -p "Press ENTER to continue if DNS is correct..."

# ========================
# START NGINX TEMP (HTTP)
# ========================

echo "==> Starting nginx for SSL challenge..."
sudo docker-compose up -d nginx

sleep 5

# ========================
# RUN CERTBOT
# ========================

echo "==> Requesting SSL certificate..."

sudo certbot certonly --webroot \
  -w ./certbot/www \
  -d $DOMAIN \
  --email your@email.com \
  --agree-tos \
  --no-eff-email

echo "==> Restarting full stack..."
sudo docker-compose down
sudo docker-compose up -d --build

# ========================
# SESSION STEP
# ========================

echo ""
echo "Copy session file:"
echo "scp -i key.pem auth/session.json ubuntu@$(curl -s ifconfig.me):~/gpt-scrapper/auth/"
read -p "Press ENTER after copying..."

sudo docker-compose restart

echo ""
echo "=========================================="
echo "✅ HTTPS READY 🚀"
echo ""
echo "🌐 https://$DOMAIN/chat"
echo ""
echo "=========================================="