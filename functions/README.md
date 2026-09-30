# RecoveryDesk notifications

Staff and clients can enable browser push in Settings → Notifications (or Notifications in the client portal). Permission is requested only from the Enable button. Sign-out removes the subscription. Alerts use generic text on the lock screen; records still require sign-in and current case permissions.

New intakes save `notificationVersion: 1` and the client's requested channel/WhatsApp consent. A Realtime Database trigger queues an intake confirmation PDF. Existing intakes are not replayed. Status changes, task assignments and reassignment queue push alerts. Ready-for-collection cases get reminders after seven days; overdue tasks are checked at 09:00 Africa/Lagos.

The private Firestore outbox tracks pending, blocked, sending, accepted, retry, failed, cancelled, skipped and review states. Provider acceptance is not proof of delivery or reading. Email uses Resend idempotency keys. Uncertain/interrupted WhatsApp sends require manual provider review and are not automatically repeated. Intake delivery in each case shows the tracked state. No payment, case or device records are migrated or deleted.

## Deploy

Use your own signed-in Google Cloud Shell with the existing Firebase project. Cloud Functions requires the project's Blaze billing plan. The existing GitHub workflow deploys Hosting only; it has not been granted backend deployment permissions.

```bash
git clone https://github.com/Wis-code/recoverydesk.git
cd recoverydesk
bash scripts/deploy-notifications.sh
```

The script enables the backend APIs, creates the secret once with a VAPID keypair, tests the code and deploys only the `notifications` function codebase plus Hosting. Existing VAPID keys are preserved on subsequent deploys. Firebase CLI may ask to sign in or grant the runtime service account access to the secret; complete those prompts in your terminal.

## Connect sending account

```bash
node scripts/connect-notification-provider.cjs
bash scripts/deploy-notifications.sh
```

Choose `email` and supply a verified Resend sender and API key, or choose `whatsapp` and supply the Meta WhatsApp Business phone number ID, supported Graph API version, approved template language/names and access token. Secret entries are hidden in the terminal. Do not paste credentials into chat or commit them. Re-run to connect the second channel; existing keys and the other channel are preserved.

WhatsApp intake template: document header and two body parameters (client name, case number). Collection template: two body parameters (client name, case number), no document header. Both must be approved in the selected language. WhatsApp sends require the intake's consent checkbox. Email is preferred for Auto when a valid email was supplied; missing email provider configuration leaves it blocked rather than silently using WhatsApp.

Connect providers before enabling staff production intake delivery. Queued blocked messages become eligible after deployment of the updated secret. Review queued records if activation is delayed. The current implementation does not ingest provider delivery/read webhooks.

## Verify

`npm ci --prefix functions && npm test --prefix functions` checks recipient filtering, seven-day reminders, consent, endpoint restrictions and PDF generation. After backend deployment, enable push on a test account and select Send test alert (allow up to one minute). Use a designated test client and approved address/number for an actual intake delivery test; no live customer messages are sent by automated tests. Archived and test-marked cases never generate client notices.
