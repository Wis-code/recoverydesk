RECOVERYDESK V2
WISCODE INNOVATIONS LTD — RC 9656932

Start here:
- RELEASE_NOTES.txt: what V2 contains
- DEPLOYMENT_CHECKLIST.txt: safe order for replacing the live V1 app
- database.rules.json: Realtime Database rules to publish BEFORE the V2 app
- firestore.rules: access-mirror rules for the later Storage setup
- storage.rules: secure photo/PDF rules for the later Storage setup

The live web application itself is static HTML/CSS/JavaScript. There is no npm build step.

The V2 business application works with the existing Authentication + Realtime Database setup. Device/signed-document uploads are intentionally tolerant of Storage not being configured yet; those controls activate after Blaze + default Firestore + Firebase Storage are enabled and their included rules are published.

Do not use RecoveryDesk Storage for customers' recovered data/files.
