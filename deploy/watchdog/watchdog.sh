#!/bin/bash
# LUNA Watchdog — Capa C: monitoreo externo al container
# Corre como cron job del host. Si LUNA no responde 3 veces → alerta Telegram.
#
# Setup:
#   1. Editar variables abajo
#   2. chmod +x watchdog.sh
#   3. crontab -e → */1 * * * * /path/to/watchdog.sh
#
# Requiere: curl, jq (opcional)

# ─── Config ─────────────────────────────

LUNA_URL="${LUNA_HEALTH_URL:-http://localhost:3000/console/api/cortex/health}"
TELEGRAM_BOT_TOKEN="${WATCHDOG_TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${WATCHDOG_TELEGRAM_CHAT_ID:-}"
HEALTHCHECKS_URL="${WATCHDOG_HEALTHCHECKS_URL:-}"  # healthchecks.io ping URL
FAIL_FILE="/tmp/luna-watchdog-fails"
MAX_FAILS=3
TIMEOUT=5

# ─── Functions ──────────────────────────

send_telegram() {
  local message="$1"
  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    echo "[watchdog] Telegram not configured, logging only: $message"
    return
  fi
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":\"${message}\",\"disable_web_page_preview\":true}" \
    > /dev/null 2>&1
}

# ─── Health check ───────────────────────

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout "$TIMEOUT" --max-time "$TIMEOUT" "$LUNA_URL" 2>/dev/null)

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ] 2>/dev/null; then
  # LUNA is responding
  if [ -f "$FAIL_FILE" ]; then
    PREV_FAILS=$(cat "$FAIL_FILE")
    rm -f "$FAIL_FILE"
    if [ "$PREV_FAILS" -ge "$MAX_FAILS" ] 2>/dev/null; then
      send_telegram "✅ LUNA recuperada — respondiendo en $LUNA_URL"
    fi
  fi

  # Ping healthchecks.io
  if [ -n "$HEALTHCHECKS_URL" ]; then
    curl -s --max-time 5 "$HEALTHCHECKS_URL" > /dev/null 2>&1
  fi
else
  # LUNA is NOT responding
  CURRENT_FAILS=0
  if [ -f "$FAIL_FILE" ]; then
    CURRENT_FAILS=$(cat "$FAIL_FILE")
  fi
  CURRENT_FAILS=$((CURRENT_FAILS + 1))
  echo "$CURRENT_FAILS" > "$FAIL_FILE"

  if [ "$CURRENT_FAILS" -eq "$MAX_FAILS" ]; then
    HOSTNAME=$(hostname)
    send_telegram "🔴 WATCHDOG — LUNA no responde (${MAX_FAILS} intentos fallidos)\nHost: ${HOSTNAME}\nURL: ${LUNA_URL}\nHTTP: ${HTTP_CODE}"
  fi
fi
