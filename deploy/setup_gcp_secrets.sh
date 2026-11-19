#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Otlobha -> Google Cloud Secret Manager, Runtime SA & Versioned GCS Bucket Setup
# Run interactively in Google Cloud Shell BEFORE the first Cloud Run deployment.
# Never commits or prints secret values.
# ==============================================================================

GCP_PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-europe-west2}"
GCS_BUCKET="${GCS_BUCKET:-${GCP_PROJECT_ID}-otlobha-data}"
RUNTIME_SA_NAME="${RUNTIME_SA_NAME:-otlobha-backend-runner}"

if [ -z "$GCP_PROJECT_ID" ] || [ "$GCP_PROJECT_ID" = "(unset)" ]; then
  echo "ERROR: GCP_PROJECT_ID is not set."
  echo "Run: export GCP_PROJECT_ID=your-gcp-project-id"
  exit 1
fi

RUNTIME_SA_EMAIL="${RUNTIME_SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Project:         $GCP_PROJECT_ID"
echo "==> Region:          $REGION"
echo "==> GCS Bucket:      gs://$GCS_BUCKET"
echo "==> Runtime SA:      $RUNTIME_SA_EMAIL"
echo ""

gcloud config set project "$GCP_PROJECT_ID" >/dev/null

echo "==> 1/4 Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com

echo "==> 2/4 Creating dedicated least-privilege runtime Service Account..."
if ! gcloud iam service-accounts describe "$RUNTIME_SA_EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$RUNTIME_SA_NAME" \
    --display-name="Otlobha Cloud Run Runtime SA"
else
  echo "Service account already exists: $RUNTIME_SA_EMAIL"
fi

echo "==> 3/4 Ensuring GCS bucket exists in $REGION with Object Versioning + Lifecycle Policy..."
if ! gcloud storage buckets describe "gs://${GCS_BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${GCS_BUCKET}" \
    --location="$REGION" \
    --uniform-bucket-level-access
fi

# Enable Object Versioning so every atomic SQLite snapshot has immutable point-in-time recovery
gcloud storage buckets update "gs://${GCS_BUCKET}" --versioning

LIFECYCLE_JSON="$(mktemp)"
cat > "$LIFECYCLE_JSON" <<'EOF'
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "numNewerVersions": 30, "isLive": false }
    }
  ]
}
EOF
gcloud storage buckets update "gs://${GCS_BUCKET}" --lifecycle-file="$LIFECYCLE_JSON"
rm -f "$LIFECYCLE_JSON"

# Least-privilege bucket-scoped storage access for the Cloud Run runtime SA
gcloud storage buckets add-iam-policy-binding "gs://${GCS_BUCKET}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/storage.objectAdmin" >/dev/null

echo "==> 4/4 Creating/Updating secrets in Google Secret Manager..."

upsert_secret() {
  local secret_name="$1"
  local secret_value="$2"

  if ! gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
    gcloud secrets create "$secret_name" --replication-policy="automatic" >/dev/null
  fi
  printf '%s' "$secret_value" | gcloud secrets versions add "$secret_name" --data-file=- >/dev/null
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
  echo "   [OK] Stored secret '$secret_name' and granted accessor role to runtime SA."
}

prompt_secret() {
  local var_name="$1"
  local label="$2"
  local allow_auto_hex="${3:-false}"
  local optional="${4:-false}"
  local val="${!var_name:-}"

  if [ -z "$val" ]; then
    if [ "$allow_auto_hex" = "true" ]; then
      read -r -s -p "Enter ${label} (leave empty to auto-generate strong 64-char hex): " val
      echo ""
      if [ -z "$val" ]; then
        val="$(openssl rand -hex 32)"
        echo "   -> Auto-generated cryptographically strong random value for ${label}."
      fi
    elif [ "$optional" = "true" ]; then
      read -r -s -p "Enter ${label} (optional, press Enter to skip): " val
      echo ""
    else
      while [ -z "$val" ]; do
        read -r -s -p "Enter ${label} (required): " val
        echo ""
      done
    fi
  fi
  printf -v "$var_name" '%s' "$val"
}

prompt_secret SMTP_PASS "Gmail SMTP App Password (otlobha-smtp-pass)" false false
prompt_secret JWT_ACCESS_SECRET "JWT Access Secret (otlobha-jwt-access-secret)" true false
prompt_secret JWT_REFRESH_SECRET "JWT Refresh Secret (otlobha-jwt-refresh-secret)" true false
prompt_secret SUPER_ADMIN_PASSWORD "Super Admin Password (otlobha-super-admin-password)" false false
prompt_secret GEMINI_API_KEY "Gemini API Key (otlobha-gemini-api-key)" false true

upsert_secret "otlobha-smtp-pass" "$SMTP_PASS"
upsert_secret "otlobha-jwt-access-secret" "$JWT_ACCESS_SECRET"
upsert_secret "otlobha-jwt-refresh-secret" "$JWT_REFRESH_SECRET"
upsert_secret "otlobha-super-admin-password" "$SUPER_ADMIN_PASSWORD"

if [ -n "${GEMINI_API_KEY:-}" ]; then
  upsert_secret "otlobha-gemini-api-key" "$GEMINI_API_KEY"
fi

echo ""
echo "=============================================================================="
echo "Google Secret Manager & Versioned Storage Setup Complete!"
echo "  Project:          $GCP_PROJECT_ID"
echo "  Region:           $REGION"
echo "  Runtime SA:       $RUNTIME_SA_EMAIL"
echo "  Versioned Bucket: gs://$GCS_BUCKET"
echo ""
echo "Next steps (manual, requires your explicit confirmation):"
echo "  1. (Optional first-time data migration) ./deploy/restore_sqlite_to_gcs.sh <backup.db>"
echo "  2. Deploy backend service:              ./deploy/deploy_cloud_run.sh"
echo "=============================================================================="
