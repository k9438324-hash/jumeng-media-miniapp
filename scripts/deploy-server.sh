#!/usr/bin/env bash
# 聚梦传媒小程序 - 服务器一键部署脚本
# 用途：在全新 Ubuntu/Debian 服务器上自动完成：环境安装 -> 拉取代码 -> 配置环境变量 -> 构建 -> HTTPS(Nginx) -> 启动
# 运行方式（在服务器上，root 或 sudo）：
#   curl -fsSL https://你的仓库/raw/main/scripts/deploy-server.sh | bash
# 或本地 scp 后：bash deploy-server.sh
# 请先准备好：域名、AppSecret、DeepSeek Key、学员 OpenID 名单、服务器公网 IP
set -euo pipefail

# ============ 可配置变量（运行前按需修改，或用环境变量覆盖）============
# 你的域名，例如 api.jumeng.com
DOMAIN="${DOMAIN:-}"
# 你的邮箱（Let's Encrypt 证书通知用，可选）
EMAIL="${EMAIL:-admin@example.com}"
# 代码仓库地址（默认私有仓库，需要服务器有访问权限）
REPO_URL="${REPO_URL:-https://github.com/k9438324-hash/jumeng-media-miniapp.git}"
# 部署目录
APP_DIR="${APP_DIR:-/opt/jumeng}"
# 环境变量文件（密钥由你在服务器填写，不经聊天）
ENV_FILE="${ENV_FILE:-/opt/jumeng.env}"

echo "=============================================="
echo " 聚梦传媒小程序 服务器部署脚本"
echo "=============================================="

# ---------- 1. 基础检查 ----------
if [ "$(id -u)" -ne 0 ]; then
  echo "❌ 请以 root 运行，或使用 sudo bash $0"
  exit 1
fi

if [ -z "$DOMAIN" ]; then
  echo "❌ 请先设置 DOMAIN 变量：DOMAIN=api.你的域名.com bash $0"
  echo "   或先编辑本脚本顶部的 DOMAIN= 字段。"
  exit 1
fi

echo "✅ 目标域名：$DOMAIN"

# ---------- 2. 安装基础环境（Node 24 + Nginx + certbot + git）----------
echo ""
echo ">>> [1/6] 安装 Node.js 24、Nginx、certbot、git ..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y curl ca-certificates gnupg nginx git >/dev/null

# 安装 Node 24（通过 NodeSource）
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
fi
node -v
echo "✅ 基础环境就绪"

# ---------- 3. 拉取代码并构建 ----------
echo ""
echo ">>> [2/6] 拉取代码并构建 ..."
if [ ! -d "$APP_DIR" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
git pull origin main 2>/dev/null || true
npm ci
npm run build
echo "✅ 代码构建完成"

# ---------- 4. 生成环境变量文件（密钥你在这里填）----------
echo ""
echo ">>> [3/6] 生成环境变量文件 ..."
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
AUTH_MODE=wechat
AI_MODE=deepseek
DB_PATH=/app/data/jumeng.sqlite
WECHAT_APP_ID=在这里填AppID
WECHAT_APP_SECRET=在这里填AppSecret（不要提交到仓库）
WECHAT_ALLOWED_OPENIDS=学员openid1,学员openid2
DEEPSEEK_API_KEY=在这里填DeepSeekKey
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
DAILY_REQUEST_LIMIT=30
EOF
  chmod 600 "$ENV_FILE"
  echo "⚠️  已生成环境变量文件：$ENV_FILE"
  echo "   请现在用编辑器填入真实密钥："
  echo "   nano $ENV_FILE"
  echo ""
  read -r -p "   填好并保存后，按回车继续（或 Ctrl+C 退出先填写）..." _
fi
echo "✅ 环境变量文件就绪"

# ---------- 5. 配置 Nginx 反向代理 + HTTPS ----------
echo ""
echo ">>> [4/6] 配置 Nginx 反向代理 ..."
cat > "/etc/nginx/sites-available/jumeng" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 120s;
    }
}
EOF
ln -sf "/etc/nginx/sites-available/jumeng" /etc/nginx/sites-enabled/jumeng
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "✅ Nginx 已配置"

echo ""
echo ">>> [5/6] 签发 HTTPS 证书 ..."
# 安装 certbot
apt-get install -y certbot python3-certbot-nginx >/dev/null
certbot --nginx -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --redirect || {
  echo "⚠️  证书签发失败，请确认域名已解析到本服务器 IP，再手动运行："
  echo "   certbot --nginx -d $DOMAIN --redirect"
}
echo "✅ HTTPS 配置完成"

# ---------- 6. 启动服务（用 systemd 常驻）----------
echo ""
echo ">>> [6/6] 配置并启动服务 ..."
cat > /etc/systemd/system/jumeng.service <<EOF
[Unit]
Description=Jumeng Media Mini Program Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $APP_DIR/dist/server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable jumeng
systemctl restart jumeng
sleep 2
systemctl status jumeng --no-pager || true

echo ""
echo "=============================================="
echo " ✅ 部署完成！"
echo "=============================================="
echo " 健康检查：curl https://$DOMAIN/health"
echo " 查看日志：journalctl -u jumeng -f"
echo " 重启服务：systemctl restart jumeng"
echo ""
echo " 后续待办："
echo "  1. 到微信小程序后台配置 request 合法域名：https://$DOMAIN"
echo "  2. 上传视频到对象存储/CDN，并更新 miniprogram/config.ts 的 mediaBase"
echo "  3. 收集学员 openid 写入 $ENV_FILE 的 WECHAT_ALLOWED_OPENIDS"
echo "=============================================="
