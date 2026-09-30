#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=wiscodery-forensic
gcloud config set project "$PROJECT"
gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com pubsub.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com --project "$PROJECT"
npm ci --prefix functions
npm test --prefix functions
if ! gcloud secrets describe RECOVERYDESK_NOTIFICATIONS --project "$PROJECT" >/dev/null 2>&1; then
  CONFIG_FILE=$(mktemp)
  chmod 600 "$CONFIG_FILE"
  trap 'rm -f "$CONFIG_FILE"' EXIT
  node - <<'JS' > "$CONFIG_FILE"
const webpush=require('./functions/node_modules/web-push');
console.log(JSON.stringify({vapid:{...webpush.generateVAPIDKeys(),subject:'https://wiscodery-forensic.web.app'}}));
JS
  gcloud secrets create RECOVERYDESK_NOTIFICATIONS --project "$PROJECT" --replication-policy automatic --data-file "$CONFIG_FILE"
fi
npx --yes firebase-tools@latest deploy --project "$PROJECT" --only functions:notifications,hosting
