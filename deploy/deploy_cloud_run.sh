#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Otlobha Unified Backend -> Google Cloud Run Production Deployment Script
# Region: europe-west2
# Security: All sensitive credentials mounted from Google Secret Manager.
# Data Safety: SQLite runs on local POSIX disk (WAL + synchronous=FULL) and
#   syncs integrity-verified atomic snapshots to versioned GCS (/mnt/gcs-data).
#   This script NEVER uploads or overwrites gs://<bucket>/otlobha.db.
# ==============================================================================

GCP_PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-europe-west2}"
SERVICE_NAME="${SERVICE_NAME:-otlobha}"
GCS_BUCKET="${GCS_BUCKET:-${GCP_PROJECT_ID}-otlobha-data}"
RUNTIME_SA_NAME="${RUNTIME_SA_NAME:-otlobha-backend-runner}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
REQUIRE_EXISTING_DB="${REQUIRE_EXISTING_DB:-1}"

if [ -z "$GCP_PROJECT_ID" ] || [ "$GCP_PROJECT_ID" = "(unset)" ]; then
  echo "ERROR: GCP_PROJECT_ID is not set."
  echo "Run: export GCP_PROJECT_ID=your-gcp-project-id"
  exit 1
fi

RUNTIME_SA_EMAIL="${RUNTIME_SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Project:      $GCP_PROJECT_ID"
echo "==> Region:       $REGION"
echo "==> Service:      $SERVICE_NAME"
echo "==> Runtime SA:   $RUNTIME_SA_EMAIL"
echo "==> GCS Bucket:   gs://$GCS_BUCKET (mounted at /mnt/gcs-data for atomic verified snapshots)"
echo "==> Min/Max:      min=${MIN_INSTANCES}, max=1"
echo "==> Require DB:   $REQUIRE_EXISTING_DB"
echo ""

gcloud config set project "$GCP_PROJECT_ID" >/dev/null

echo "==> Step 1: Verifying runtime Service Account, Versioned GCS Bucket, and Secret Manager secrets..."
if ! gcloud iam service-accounts describe "$RUNTIME_SA_EMAIL" >/dev/null 2>&1; then
  echo "ERROR: Runtime service account $RUNTIME_SA_EMAIL does not exist."
  echo "Run ./deploy/setup_gcp_secrets.sh first."
  exit 1
fi

if ! gcloud storage buckets describe "gs://${GCS_BUCKET}" >/dev/null 2>&1; then
  echo "ERROR: Bucket gs://${GCS_BUCKET} does not exist."
  echo "Run ./deploy/setup_gcp_secrets.sh first."
  exit 1
fi

# Guarantee Object Versioning stays enabled on the persistence bucket
gcloud storage buckets update "gs://${GCS_BUCKET}" --versioning >/dev/null

if [ "$REQUIRE_EXISTING_DB" = "1" ]; then
  if ! gcloud storage ls "gs://${GCS_BUCKET}/otlobha.db" >/dev/null 2>&1; then
    echo "ERROR: gs://${GCS_BUCKET}/otlobha.db not found and REQUIRE_EXISTING_DB=1."
    echo "Refusing to start with an empty database. Upload your verified backup first with ./deploy/restore_sqlite_to_gcs.sh."
    exit 1
  fi
  STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  gcloud storage cp "gs://${GCS_BUCKET}/otlobha.db" "gs://${GCS_BUCKET}/pre-deploy-backups/otlobha-before-deploy-${STAMP}.db" >/dev/null
  echo "   [OK] Saved automatic pre-deploy backup to gs://${GCS_BUCKET}/pre-deploy-backups/otlobha-before-deploy-${STAMP}.db"
fi

REQUIRED_SECRETS=(
  "otlobha-smtp-pass"
  "otlobha-jwt-access-secret"
  "otlobha-jwt-refresh-secret"
  "otlobha-super-admin-password"
)
for secret_name in "${REQUIRED_SECRETS[@]}"; do
  if ! gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
    echo "ERROR: Required Secret Manager secret '$secret_name' not found."
    echo "Run ./deploy/setup_gcp_secrets.sh first."
    exit 1
  fi
done

SECRET_BINDINGS="SMTP_PASS=otlobha-smtp-pass:latest,JWT_ACCESS_SECRET=otlobha-jwt-access-secret:latest,JWT_REFRESH_SECRET=otlobha-jwt-refresh-secret:latest,SUPER_ADMIN_PASSWORD=otlobha-super-admin-password:latest"
if gcloud secrets describe "otlobha-gemini-api-key" >/dev/null 2>&1; then
  SECRET_BINDINGS="${SECRET_BINDINGS},GEMINI_API_KEY=otlobha-gemini-api-key:latest"
fi

# Non-sensitive runtime configuration ONLY (uses --update-env-vars so existing vars are preserved)
ENV_VARS="NODE_ENV=production,DISABLE_VITE=1,OTLOBHA_DB_PATH=/tmp/otlobha-local/otlobha.db,OTLOBHA_GCS_PERSIST_DIR=/mnt/gcs-data,OTLOBHA_SQLITE_JOURNAL_MODE=WAL,OTLOBHA_SQLITE_SYNC_INTERVAL_MS=15000,OTLOBHA_REQUIRE_EXISTING_PERSISTED_DB=${REQUIRE_EXISTING_DB}"

append_non_secret_env() {
  local key="$1"
  local val="${!key:-}"
  if [ -n "$val" ]; then
    ENV_VARS="${ENV_VARS},${key}=${val}"
  fi
}

SMTP_HOST="${SMTP_HOST:-smtp.gmail.com}"
SMTP_PORT="${SMTP_PORT:-465}"
SMTP_SECURE="${SMTP_SECURE:-true}"

append_non_secret_env "SMTP_HOST"
append_non_secret_env "SMTP_PORT"
append_non_secret_env "SMTP_SECURE"
append_non_secret_env "SMTP_USER"
append_non_secret_env "SMTP_FROM"
append_non_secret_env "SUPER_ADMIN_EMAIL"
append_non_secret_env "SUPER_ADMIN_NAME"
append_non_secret_env "OSRM_BASE_URL"

echo "==> Step 2: Deploying $SERVICE_NAME to Cloud Run ($REGION) with Secret Manager bindings..."
echo "    (Production DB gs://${GCS_BUCKET}/otlobha.db is NOT modified or overwritten by this deploy.)"

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --service-account "$RUNTIME_SA_EMAIL" \
  --execution-environment gen2 \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances "$MIN_INSTANCES" \
  --max-instances 1 \
  --session-affinity \
  --timeout 3600 \
  --add-volume "name=otlobha-data,type=cloud-storage,bucket=${GCS_BUCKET}" \
  --add-volume-mount "volume=otlobha-data,mount-path=/mnt/gcs-data" \
  --update-env-vars "$ENV_VARS" \
  --update-secrets "$SECRET_BINDINGS"

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
echo ""
echo "==> Step 3: Updating APP_URL to $SERVICE_URL..."
gcloud run services update "$SERVICE_NAME" \
  --region "$REGION" \
  --update-env-vars "APP_URL=${SERVICE_URL}" >/dev/null

echo "==> Step 4: Verifying public JSON API endpoints (no Cookie Check / no HTML)..."
HEALTH_STATUS="$(curl -sS -o /tmp/otlobha_health.json -w '%{http_code}' -H 'Accept: application/json' "${SERVICE_URL}/api/health")"
HEALTH_CT="$(curl -sS -I "${SERVICE_URL}/api/health" | tr -d '\r' | grep -i '^content-type:' | head -n1 || true)"
echo "GET ${SERVICE_URL}/api/health -> HTTP ${HEALTH_STATUS} | ${HEALTH_CT}"
cat /tmp/otlobha_health.json
echo ""

if [ "$HEALTH_STATUS" != "200" ]; then
  echo "ERROR: Health check returned HTTP $HEALTH_STATUS instead of 200."
  exit 1
fi

GUEST_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Accept: application/json' "${SERVICE_URL}/api/mobile/customer/guest-bootstrap")"
echo "GET ${SERVICE_URL}/api/mobile/customer/guest-bootstrap -> HTTP ${GUEST_STATUS}"
if [ "$GUEST_STATUS" != "200" ]; then
  echo "ERROR: Guest bootstrap check returned HTTP $GUEST_STATUS instead of 200."
  exit 1
fi

echo ""
echo "=============================================================================="
echo "PUBLIC BACKEND URL READY FOR FLUTTER (CUSTOMER & CAPTAIN APPS):"
echo "  ${SERVICE_URL}"
echo ""
echo "Next Step:"
echo "  Set GitHub Repository Variable OTLOBHA_API_BASE_URL = ${SERVICE_URL}"
echo "  Then run 'Build Otlobha Android & iOS Apps' in GitHub Actions."
echo "=============================================================================="
