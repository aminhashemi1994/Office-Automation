#!/usr/bin/env bash
# =============================================================================
# اسکریپت راه‌اندازیِ یک‌بارهٔ «سامانه اتوماسیون توس‌کابل» + سرور LiveKit
#
# این اسکریپت idempotent است: هر بار اجرا شود فقط چیزهای نبود را نصب/درست می‌کند.
#   اجرا:  bash scripts/setup.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BIN_DIR="$ROOT/bin"
LK_BIN="$BIN_DIR/livekit-server"

say()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; }

# ---------- تشخیص پکیج‌منیجر ----------
PM=""
if   command -v pacman >/dev/null 2>&1; then PM=pacman
elif command -v apt-get >/dev/null 2>&1; then PM=apt
elif command -v dnf   >/dev/null 2>&1; then PM=dnf
fi

pkg_install() {
  case "$PM" in
    pacman) sudo pacman -S --needed --noconfirm "$@" ;;
    apt)    sudo apt-get update -y && sudo apt-get install -y "$@" ;;
    dnf)    sudo dnf install -y "$@" ;;
    *)      warn "پکیج‌منیجر شناخته نشد؛ لطفاً دستی نصب کنید: $*" ; return 1 ;;
  esac
}

# ---------- ۱) Node.js ----------
say "بررسی Node.js…"
if command -v node >/dev/null 2>&1; then
  ok "Node موجود است: $(node -v)"
else
  warn "Node نصب نیست — در حال نصب…"
  case "$PM" in
    pacman) pkg_install nodejs npm ;;
    apt)    pkg_install nodejs npm ;;
    dnf)    pkg_install nodejs npm ;;
    *)      err "Node را دستی نصب کنید (نسخهٔ ۲۰ به بالا) و دوباره اجرا کنید"; exit 1 ;;
  esac
  ok "Node نصب شد: $(node -v)"
fi

# ---------- ۲) وابستگی‌های پروژه ----------
say "نصب وابستگی‌های سرور و کلاینت…"
npm install --no-audit --no-fund
ok "وابستگی‌ها نصب شدند"

# ---------- ۳) بیلد فرانت‌اند ----------
say "بیلد فرانت‌اند…"
npm run build
ok "فرانت‌اند بیلد شد (client/dist)"

# ---------- ۴) باینری LiveKit ----------
say "بررسی باینری LiveKit…"
mkdir -p "$BIN_DIR"

lk_works() { [ -x "$LK_BIN" ] && "$LK_BIN" --version >/dev/null 2>&1; }

if lk_works; then
  ok "LiveKit موجود و سازگار است: $("$LK_BIN" --version)"
else
  warn "باینری LiveKit نبود یا با این سیستم سازگار نیست (معماری متفاوت؟) — تلاش برای دریافت…"
  # روش ۱: اگر روی سیستم نصب است، همان را کپی کن
  if command -v livekit-server >/dev/null 2>&1; then
    cp "$(command -v livekit-server)" "$LK_BIN"
  else
    # روش ۲: اسکریپت رسمی نصب (نیاز به اینترنت فقط همین یک‌بار)
    if command -v curl >/dev/null 2>&1; then
      curl -sSL https://get.livekit.io | bash || true
      command -v livekit-server >/dev/null 2>&1 && cp "$(command -v livekit-server)" "$LK_BIN"
    fi
  fi
  chmod +x "$LK_BIN" 2>/dev/null || true
  if lk_works; then
    ok "LiveKit آماده شد: $("$LK_BIN" --version)"
  else
    err "دریافت LiveKit ناموفق بود. باینریِ مناسبِ OS/معماریِ این سرور را از"
    err "https://github.com/livekit/livekit/releases دستی در $LK_BIN بگذارید و chmod +x کنید."
  fi
fi
chmod +x "$LK_BIN" 2>/dev/null || true

# ---------- ۵) فایل .env ----------
say "بررسی .env…"
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  warn ".env از روی نمونه ساخته شد — حتماً LIVEKIT_URL و کلیدها را ویرایش کنید."
else
  ok ".env موجود است"
fi

# ---------- ۶) کلید امنِ LiveKit (فقط اگر هنوز devkey است) ----------
if grep -q "^LIVEKIT_API_KEY=devkey" "$ROOT/.env" 2>/dev/null; then
  warn "کلید LiveKit هنوز devkey/secret تستی است."
  warn "برای محیط واقعی یک کلید امن بسازید و در .env و deploy/livekit-lan.yaml بگذارید:"
  echo  "    $LK_BIN generate-keys"
fi

# ---------- ۷) یادآوریِ فایروال ----------
say "یادآوری فایروال (مدیای تماس از این پورت‌ها عبور می‌کند):"
cat <<'EOF'
    - TCP  7880   : سیگنالینگ LiveKit (پشت nginx: مسیر /livekit)
    - TCP  7881   : فِال‌بکِ مدیا روی TCP
    - UDP  7882   : مدیای اصلی (صدا/تصویر) — تک‌پورت
  اگر فایروال دارید (ufw/firewalld) این‌ها را باز کنید، مثلاً:
    sudo ufw allow 7882/udp && sudo ufw allow 7881/tcp
EOF

echo
ok "راه‌اندازی کامل شد. برای اجرا:  npm start"
warn "یادتان باشد: مرورگر برای میکروفون/دوربین به HTTPS نیاز دارد و LIVEKIT_URL باید wss:// و از دامنه باشد."
