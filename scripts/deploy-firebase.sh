#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check public/app.js
node --check public/pricing-engine.js
node --check public/invoice-checkout.js
node --check public/sw.js
# Hosting/rules deployment does not modify or erase customer records.
npx --yes firebase-tools@latest deploy --project wiscodery-forensic --only hosting,firestore:rules,storage
