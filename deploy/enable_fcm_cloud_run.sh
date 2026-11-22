#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Otlobha -> Enable Background Push Notifications (FCM) on Cloud Run
# Zero-touch on database, storage, or existing secrets/env vars.
#
# Usage (Google Cloud Shell):
#   Option A (Recommended - works even if Firebase & Cloud Run are different projects):
#     bash deploy/enable_fcm_cloud_run.sh /path/to/firebase-adminsdk.json
#
#   Option B (Same GCP/Firebase project - IAM only, no JSON key needed):
#     bash deploy/enable_fcm_cloud_run.sh
# ==============================================================================

FIREBASE_SA_JSON_FILE="${1:-${FIREBASE_SA_JSON_PATH:-}}"
GCP_PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-europe-west2}"
SERVICE_NAME="${SERVICE_NAME:-otlobha}"
SECRET_NAME="otlobha-firebase-sa-json"

if [ -z "$GCP_PROJECT_ID" ] || [ "$GCP_PROJECT_ID" = "(unset)" ]; then
  echo "ERROR: GCP_PROJECT_ID is not set. Run: gcloud config set project <YOUR_GCP_PROJECT_ID>"
  exit 1
fi

echo "==> Project:      $GCP_PROJECT_ID"
echo "==> Region:       $REGION"
echo "==> Cloud Run:    $SERVICE_NAME"

# Discover the exact runtime Service Account attached to the live Cloud Run service
RUNTIME_SA_EMAIL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
if [ -z "$RUNTIME_SA_EMAIL" ]; then
  PROJECT_NUM="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
  RUNTIME_SA_EMAIL="${PROJECT_NUM}-compute@developer.gserviceaccount.com"
fi
echo "==> Runtime SA:   $RUNTIME_SA_EMAIL"

echo "==> Step 1: Enabling Firebase Cloud Messaging & Secret Manager APIs..."
gcloud services enable fcm.googleapis.com secretmanager.googleapis.com --project "$GCP_PROJECT_ID" >/dev/null

if [ -n "$FIREBASE_SA_JSON_FILE" ]; then
  if [ ! -f "$FIREBASE_SA_JSON_FILE" ]; then
    echo "ERROR: File not found: $FIREBASE_SA_JSON_FILE"
    exit 1
  fi

  # Validate JSON contains required Firebase service account fields
  python3 - "$FIREBASE_SA_JSON_FILE" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    data = json.load(f)
missing = [k for k in ('project_id', 'client_email', 'private_key') if not data.get(k)]
if missing:
    raise SystemExit(f"ERROR: Invalid Firebase Service Account JSON. Missing keys: {missing}")
print(f"   [OK] Validated Firebase SA JSON for project_id={data['project_id']} ({data['client_email']})")
PY

  echo "==> Step 2: Creating/Updating Secret Manager secret '${SECRET_NAME}'..."
  if ! gcloud secrets describe "$SECRET_NAME" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$SECRET_NAME" --replication-policy="automatic" --project "$GCP_PROJECT_ID" >/dev/null
  fi
  gcloud secrets versions add "$SECRET_NAME" --data-file="$FIREBASE_SA_JSON_FILE" --project "$GCP_PROJECT_ID" >/dev/null

  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --project "$GCP_PROJECT_ID" \
    --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
  echo "   [OK] Granted secretAccessor on '${SECRET_NAME}' to ${RUNTIME_SA_EMAIL}."

  echo "==> Step 3: Binding '${SECRET_NAME}' to Cloud Run service '${SERVICE_NAME}' (preserving all existing env vars & DB)..."
  gcloud run services update "$SERVICE_NAME" \
    --project "$GCP_PROJECT_ID" \
    --region "$REGION" \
    --update-secrets "FIREBASE_SERVICE_ACCOUNT_JSON=${SECRET_NAME}:latest" >/dev/null
else
  echo "==> Step 2: Granting roles/firebasecloudmessaging.admin to ${RUNTIME_SA_EMAIL}..."
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
    --role="roles/firebasecloudmessaging.admin" >/dev/null
  echo "   [OK] Granted roles/firebasecloudmessaging.admin on project '${GCP_PROJECT_ID}'."
fi

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$REGION" --format='value(status.url)')"
echo ""
echo "=============================================================================="
echo "FCM Cloud Run configuration completed cleanly (zero DB changes)!"
echo "Service URL: ${SERVICE_URL}"
echo ""
echo "Verify live FCM auth right now (with an Admin Bearer token):"
echo "  GET ${SERVICE_URL}/api/notifications/fcm-status?probe=1"
echo "=============================================================================="
