# RecoveryDesk V2.5 — Pricing + Shareable PDFs + Firebase Hosting

This patch is designed for the current `Wis-code/recoverydesk` V2.4.5 main branch.

## Adds
- Fixed ₦2,000 default diagnostic fee.
- Wiscode Forensics Pricing Engine v1.0 on Job Controls.
- R0–R3 automatic pricing; R4/R5 specialist escalation stop.
- P1–P5 recovery prognosis stored separately from price.
- Formula: base recovery + imaging/media workload + independent complexity + urgency + external costs.
- Diagnostic fee is credited into the total quote; `recoveryQuote` stores the recovery portion after that credit so existing RecoveryDesk finance/invoice totals remain correct.
- Critical/priority data and pricing notes stored with the pricing record.
- Repricing clears old quote approval so changed prices must be approved again.
- Invoice checkout before generation: Subtotal → editable Admin discount → Final Total → Paid → Balance Due.
- Discount edits are limited to Owner/Admin/Sub-Admin, saved to the job, and audit-logged before invoice generation.
- Real PDF generation for invoices, receipts and agreements.
- Share PDF through the Web Share API where supported; otherwise the app downloads the PDF for manual sharing.
- Firebase Hosting configuration for `wiscodery-forensic.web.app` / `wiscodery-forensic.firebaseapp.com`.

## Cloud Shell deployment
1. Open Firebase Console for project `wiscodery-forensic` and launch Cloud Shell.
2. Clone the repository and make a deployment branch:

   git clone https://github.com/Wis-code/recoverydesk.git
   cd recoverydesk
   git checkout -b v2.5-pricing

3. Upload `recoverydesk-v2.5-patch.zip` to Cloud Shell (More > Upload), then run:

   mkdir -p /tmp/rd-v25
   unzip -o ~/recoverydesk-v2.5-patch.zip -d /tmp/rd-v25
   python3 /tmp/rd-v25/apply_v2_5_patch.py .

4. Validate syntax:

   node --check app.js
   node --check pricing-engine.js
   node --check documents.js
   node --check sw.js

5. Optional local preview in Cloud Shell:

   firebase emulators:start --only hosting

6. Deploy Hosting:

   firebase deploy --only hosting -m "RecoveryDesk V2.5 pricing and shareable PDFs"

7. Open the Hosting URL printed by Firebase. It should use the Firebase project domains instead of GitHub Pages.

8. If Google sign-in says the domain is unauthorized, add the printed `*.web.app` hostname under Firebase Authentication > Settings > Authorized domains.

## Test before live customer use
- Open a job > Job Controls > Pricing engine.
- Verify R0/R1/R2/R3 calculations and ₦2,000 diagnostic credit.
- Verify R4/R5 save as specialist escalation and do not issue an in-house recovery quote.
- Generate invoice; verify Invoice Checkout, discount and final totals. Then generate receipt and agreement.
- Download each as PDF on desktop.
- Share each PDF on Android/iPhone where Web Share file support is available.
- Confirm the invoice total equals diagnostic + recovery charge after credit - discount.
- Confirm changing a quote requires customer approval again.
- Hard refresh desktop and fully close/reopen the installed PWA after deploy.
