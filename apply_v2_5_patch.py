#!/usr/bin/env python3
from pathlib import Path
import shutil, sys

repo = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
patch = Path(__file__).resolve().parent

required = ["app.js", "index.html", "documents.js", "sw.js", "firebase.js"]
missing = [name for name in required if not (repo/name).exists()]
if missing:
    raise SystemExit(f"Not a RecoveryDesk repo root; missing: {', '.join(missing)}")

# Back up only files this patch replaces/edits.
backup = repo / ".v2.4.5-before-v2.5"
backup.mkdir(exist_ok=True)
for name in ["app.js", "index.html", "documents.js", "sw.js"]:
    shutil.copy2(repo/name, backup/name)

# Exact app.js edit: make ₦2,000 the default diagnostic fee for future intakes.
app_path = repo / "app.js"
text = app_path.read_text(encoding="utf-8")
old = '  defaultAssessmentFee: "",\n  requireIntakePhotos: false'
new = '  defaultAssessmentFee: "2000",\n  requireIntakePhotos: false'
if old not in text:
    raise SystemExit("Safety stop: expected V2.4.5 DEFAULT_COMPANY block was not found in app.js. No app.js edit applied.")
text = text.replace(old, new, 1)
app_path.write_text(text, encoding="utf-8")

# Replace small known files and add the new subsystem/config.
for name in ["index.html", "documents.js", "sw.js", "pricing-engine.js", "invoice-checkout.js", "firebase.json", ".firebaserc"]:
    shutil.copy2(patch/name, repo/name)

print("RecoveryDesk V2.5 patch applied successfully.")
print("Changed: app.js default diagnostic fee -> ₦2,000")
print("Added: pricing-engine.js")
print("Added: invoice-checkout.js with admin discount checkout")
print("Upgraded: documents.js PDF download/share")
print("Updated: index.html, sw.js")
print("Added: firebase.json, .firebaserc for Firebase Hosting")
print(f"Backup: {backup}")
