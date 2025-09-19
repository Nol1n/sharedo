# Sharedo – Deployment Guide (VPS)

This guide helps you deploy the app on a Linux VPS (Ubuntu/Debian). It uses:
- Node.js LTS
- Nginx as reverse proxy
- PM2 (or systemd) to keep the server running

## 1) Prerequisites
- Domain or subdomain pointing to your VPS IP (optional but recommended)
- Node.js 18+ and npm installed
- Nginx installed

## 2) Clone the repo
```
cd /opt
sudo git clone <your-repo-url> sharedo
sudo chown -R $USER:$USER sharedo
cd sharedo
```

## 3) Install dependencies and build client
```
npm install
npm install --prefix server
npm install --prefix client
npm run build
```
This builds the client into `server/public/` so Express can serve it.

## 4) Configure environment
Create `server/.env` with at least:
```
PORT=4000
CLIENT_ORIGIN=https://your-domain.example
JWT_SECRET=your_super_secret
```
Note: In dev, CLIENT_ORIGIN is `http://localhost:5173`. In prod behind Nginx, set it to your website origin.

## 5) Start the server
### Option A: PM2 (simple)
```
npm install -g pm2
cd server
pm2 start server.js --name sharedo --update-env
pm2 save
pm2 startup
```

### Option B: systemd
Create `/etc/systemd/system/sharedo.service`:
```
[Unit]
Description=Sharedo server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/sharedo/server
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```
Then:
```
sudo systemctl daemon-reload
sudo systemctl enable sharedo
sudo systemctl start sharedo
```

## 6) Nginx reverse proxy
Create `/etc/nginx/sites-available/sharedo`:
```
server {
  listen 80;
  server_name your-domain.example;

  location /socket.io/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 600s;
  }

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
Enable and reload:
```
sudo ln -s /etc/nginx/sites-available/sharedo /etc/nginx/sites-enabled/sharedo
sudo nginx -t && sudo systemctl reload nginx
```

## 7) File uploads & persistence
- Uploaded files are stored under `server/uploads/` and served by Express at `/uploads/...`.
- SQLite database lives at `server/sharedo.db`.
- Make sure the server process user has write permissions on `server/`.

## 8) Update & redeploy
```
cd /opt/sharedo
git pull
npm run build
pm2 restart sharedo   # or: sudo systemctl restart sharedo
```

## Troubleshooting
- Set correct `CLIENT_ORIGIN` in `server/.env` (e.g., https://your-domain)
- Check server logs: `pm2 logs sharedo` or `journalctl -u sharedo -f`
- Ensure Nginx proxying `/socket.io/` with WebSocket upgrade headers
