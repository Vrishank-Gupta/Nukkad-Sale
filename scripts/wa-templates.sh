#!/usr/bin/env bash
# Creates the two WhatsApp message templates NukkadSale uses, then shows their review status.
#   bash scripts/wa-templates.sh            → create both + show status
#   bash scripts/wa-templates.sh status     → only show status
# Asks for the permanent WhatsApp token (the one stored as WA_TOKEN); it is not shown or saved.
set -euo pipefail
WABA=1847941553220655
API=https://graph.facebook.com/v23.0
# Token from ~/.config/nukkadsale/secrets.env (WA_TOKEN=…) if it's there, otherwise asked for.
SECRETS="$HOME/.config/nukkadsale/secrets.env"
TOKEN=$( [ -f "$SECRETS" ] && grep -m1 '^WA_TOKEN=' "$SECRETS" | cut -d= -f2- || true )
[ -n "$TOKEN" ] || { read -rsp "Paste the WhatsApp token once (hidden) and press Enter: " TOKEN; echo; }
TOKEN=${TOKEN//[[:space:]]/}
auth=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

if [ "${1:-}" != "status" ]; then
  # Errors from Meta can repeat the token back; hide it.
  echo "Creating order_confirmed (Utility)…"
  curl -s "${auth[@]}" -X POST "$API/$WABA/message_templates" -d '{
    "name": "order_confirmed", "language": "en", "category": "UTILITY",
    "components": [{ "type": "BODY",
      "text": "Hi {{1}}, your order for {{2}} ({{3}}) from {{4}} is confirmed. Order no. {{5}}. You can track it from the link the shop shared with you.",
      "example": { "body_text": [["Priya", "Cotton kurta", "₹798.52", "Meera Boutique", "A1B2C3"]] } }]
  }' | sed "s/${TOKEN}/[token hidden]/g"; echo
  echo "Creating pin_code (Authentication, copy-code button)…"
  curl -s "${auth[@]}" -X POST "$API/$WABA/message_templates" -d '{
    "name": "pin_code", "language": "en", "category": "AUTHENTICATION",
    "components": [
      { "type": "BODY", "add_security_recommendation": true },
      { "type": "FOOTER", "code_expiration_minutes": 10 },
      { "type": "BUTTONS", "buttons": [{ "type": "OTP", "otp_type": "COPY_CODE", "text": "Copy code" }] }
    ]
  }' | sed "s/${TOKEN}/[token hidden]/g"; echo
fi
echo "Status:"
curl -s "${auth[@]}" "$API/$WABA/message_templates?fields=name,status,category,language,rejected_reason&limit=50" \
  | python3 -c 'import json,sys
d = json.load(sys.stdin)
if "error" in d: print("  ", d["error"].get("message"))
for t in d.get("data", []): print("  ", t["name"].ljust(18), t["language"].ljust(6), t["category"].ljust(15), t["status"], t.get("rejected_reason") or "")'
