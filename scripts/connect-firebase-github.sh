#!/usr/bin/env bash
set -euo pipefail

# Run once as the Google Cloud project owner in Cloud Shell.
# No service-account key is generated or copied to GitHub.
rd_project='wiscodery-forensic'
rd_project_number='1032205659317'
rd_service_account="recoverydesk-deploy@${rd_project}.iam.gserviceaccount.com"
rd_pool='recoverydesk-github'
rd_condition="assertion.repository_id == '1329999612' && assertion.repository_owner_id == '173819186' && assertion.ref == 'refs/heads/main'"
rd_mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id'

rd_actual_number="$(gcloud projects describe "$rd_project" --format='value(projectNumber)')"
if [[ "$rd_actual_number" != "$rd_project_number" ]]; then
  echo 'Project verification failed; no permissions were changed.' >&2
  exit 1
fi

gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com firebasehosting.googleapis.com cloudresourcemanager.googleapis.com --project="$rd_project" --quiet

if ! gcloud iam service-accounts describe "$rd_service_account" --project="$rd_project" >/dev/null 2>&1; then
  gcloud iam service-accounts create recoverydesk-deploy --project="$rd_project" --display-name='RecoveryDesk GitHub website deploy' --quiet
fi

for rd_role in roles/firebasehosting.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$rd_project" --member="serviceAccount:${rd_service_account}" --role="$rd_role" --condition=None --quiet >/dev/null
done

if ! gcloud iam workload-identity-pools describe "$rd_pool" --project="$rd_project" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$rd_pool" --project="$rd_project" --location=global --display-name='RecoveryDesk GitHub' --quiet
fi

if gcloud iam workload-identity-pools providers describe github --project="$rd_project" --location=global --workload-identity-pool="$rd_pool" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc github --project="$rd_project" --location=global --workload-identity-pool="$rd_pool" --issuer-uri='https://token.actions.githubusercontent.com' --attribute-mapping="$rd_mapping" --attribute-condition="$rd_condition" --quiet
else
  gcloud iam workload-identity-pools providers create-oidc github --project="$rd_project" --location=global --workload-identity-pool="$rd_pool" --display-name='RecoveryDesk main branch' --issuer-uri='https://token.actions.githubusercontent.com' --attribute-mapping="$rd_mapping" --attribute-condition="$rd_condition" --quiet
fi

gcloud iam service-accounts add-iam-policy-binding "$rd_service_account" --project="$rd_project" --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/${rd_project_number}/locations/global/workloadIdentityPools/${rd_pool}/attribute.repository_id/1329999612" --quiet >/dev/null

echo 'RecoveryDesk deployment connection is ready.'
echo 'Only Wis-code/recoverydesk on its main branch can use this deployment identity.'
echo 'It can publish Firebase website files; it has not been granted access to customer databases or uploaded files.'
echo 'Return to ChatGPT and say: connection done. The failed GitHub deployment can then be re-run.'
