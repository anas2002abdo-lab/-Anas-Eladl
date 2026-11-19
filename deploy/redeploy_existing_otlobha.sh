#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Safe Redeploy Script for EXISTING Cloud Run Service: otlobha (europe-west2)
# - Inspects current service config (env var names, secrets, GCS volume) FIRST.
# - Preserves ALL existing SMTP settings, secrets, and service account.
# - NEVER replaces gs://<bucket>/otlobha.db and REFUSES to create an empty DB.
# - Saves an automatic pre-deploy backup copy in GCS before deploying.
# ==============================================================================

GCP_PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-europe-west2}"
SERVICE_NAME="${SERVICE_NAME:-otlobha}"
GCS_BUCKET="${GCS_BUCKET:-}"

if [ -z "$GCP_PROJECT_ID" ] || [ "$GCP_PROJECT_ID" = "(unset)" ]; then
  echo "ERROR: GCP_PROJECT_ID is not set. Run: export GCP_PROJECT_ID=<your-project-id>"
  exit 1
fi

gcloud config set project "$GCP_PROJECT_ID" >/dev/null

echo "==> Step 1: Inspecting existing Cloud Run service '${SERVICE_NAME}' in '${REGION}'..."
if ! gcloud run services describe "$SERVICE_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "ERROR: Service '${SERVICE_NAME}' was not found in region '${REGION}'."
  exit 1
fi

EXISTING_SA="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(spec.template.spec.serviceAccountName)' || true)"
EXISTING_BUCKET="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(spec.template.spec.volumes[0].csi.volumeAttributes.bucketName)' || true)"
EXISTING_MOUNT="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(spec.template.spec.containers[0].volumeMounts[0].mountPath)' || true)"

echo "   Existing Service Account: ${EXISTING_SA:-<default compute SA>}"
echo "   Existing GCS Volume:      ${EXISTING_BUCKET:-<NONE>}"
echo "   Existing Mount Path:      ${EXISTING_MOUNT:-<NONE>}"
echo "   Existing Env Var Names (values hidden):"
gcloud run services describe "$SERVICE_NAME" --region "$REGION" \
  --format='table(spec.template.spec.containers[0].env[].name)' || true
echo ""

TARGET_BUCKET="${GCS_BUCKET:-$EXISTING_BUCKET}"
if [ -z "$TARGET_BUCKET" ]; then
  echo "ABORTED FOR DATA SAFETY:"
  echo "  The existing Cloud Run service '${SERVICE_NAME}' has NO Cloud Storage volume mounted yet,"
  echo "  and GCS_BUCKET was not provided."
  echo "  Redeploying right now would NOT have a persistent gs://<bucket>/otlobha.db to hydrate."
  echo ""
  echo "  Next steps:"
  echo "    1) Run ./deploy/setup_gcp_secrets.sh to create the versioned bucket & Secret Manager secrets."
  echo "    2) Upload your verified backup once via ./deploy/restore_sqlite_to_gcs.sh .backups/<backup>.db"
  echo "    3) Re-run this script with: export GCS_BUCKET=<your-bucket-name>"
  exit 1
fi

echo "==> Step 2: Verifying gs://${TARGET_BUCKET}/otlobha.db exists and saving pre-deploy backup..."
if ! gcloud storage ls "gs://${TARGET_BUCKET}/otlobha.db" >/dev/null 2>&1; then
  echo "ABORTED FOR DATA SAFETY:"
  echo "  gs://${TARGET_BUCKET}/otlobha.db does NOT exist."
  echo "  Refusing to deploy with an empty database."
  echo "  Upload your verified backup explicitly first: ./deploy/restore_sqlite_to_gcs.sh .backups/<backup>.db"
  exit 1
fi

gcloud storage buckets update "gs://${TARGET_BUCKET}" --versioning >/dev/null
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
PRE_BACKUP="gs://${TARGET_BUCKET}/pre-deploy-backups/otlobha-before-redeploy-${STAMP}.db"
gcloud storage cp "gs://${TARGET_BUCKET}/otlobha.db" "$PRE_BACKUP" >/dev/null
echo "   [OK] Saved automatic pre-deploy backup: $PRE_BACKUP"

echo ""
echo "Ready to redeploy '${SERVICE_NAME}' in '${REGION}' from current git commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
echo "  - Preserves ALL existing SMTP settings, env vars, and secrets (--update-env-vars)"
echo "  - Mounts gs://${TARGET_BUCKET} at /mnt/gcs-data for verified atomic SQLite persistence"
echo "  - Enforces OTLOBHA_REQUIRE_EXISTING_PERSISTED_DB=1 (will NEVER create an empty DB)"
read -r -p "Type DEPLOY to confirm redeploying '${SERVICE_NAME}': " CONFIRM_DEPLOY
if [ "$CONFIRM_DEPLOY" != "DEPLOY" ]; then
  echo "ABORTED by user."
  exit 1
fi

DEPLOY_ARGS=(
  run deploy "$SERVICE_NAME"
  --source .
  --region "$REGION"
  --platform managed
  --allow-unauthenticated
  --execution-environment gen2
  --port 8080
  --max-instances 1
  --session-affinity
  --timeout 3600
  --add-volume "name=otlobha-data,type=cloud-storage,bucket=${TARGET_BUCKET}"
  --add-volume-mount "volume=otlobha-data,mount-path=/mnt/gcs-data"
  --update-env-vars "NODE_ENV=production,DISABLE_VITE=1,OTLOBHA_DB_PATH=/tmp/otlobha-local/otlobha.db,OTLOBHA_GCS_PERSIST_DIR=/mnt/gcs-data,OTLOBHA_SQLITE_JOURNAL_MODE=WAL,OTLOBHA_SQLITE_SYNC_INTERVAL_MS=15000,OTLOBHA_REQUIRE_EXISTING_PERSISTED_DB=1"
)

if [ -n "$EXISTING_SA" ]; then
  DEPLOY_ARGS+=(--service-account "$EXISTING_SA")
fi

echo "==> Step 3: Redeploying '${SERVICE_NAME}'..."
gcloud "${DEPLOY_ARGS[@]}"

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
echo ""
echo "==> Step 4: Verifying live JSON endpoints on ${SERVICE_URL}..."
HEALTH_STATUS="$(curl -sS -o /tmp/otlobha_health.json -w '%{http_code}' -H 'Accept: application/json' "${SERVICE_URL}/api/health")"
echo "GET ${SERVICE_URL}/api/health -> HTTP ${HEALTH_STATUS}"
cat /tmp/otlobha_health.json
echo ""

GUEST_STATUS="$(curl -sS -o /tmp/otlobha_guest.json -w '%{http_code}' -H 'Accept: application/json' "${SERVICE_URL}/api/mobile/customer/guest-bootstrap")"
echo "GET ${SERVICE_URL}/api/mobile/customer/guest-bootstrap -> HTTP ${GUEST_STATUS}"
head -c 250 /tmp/otlobha_guest.json
echo ""

if [ "$HEALTH_STATUS" != "200" ] || [ "$GUEST_STATUS" != "200" ]; then
  echo "ERROR: Verification failed (health=${HEALTH_STATUS}, guest-bootstrap=${GUEST_STATUS})."
  exit 1
fi

echo ""
echo "=============================================================================="
echo "SUCCESS! Service '${SERVICE_NAME}' updated with latest code while preserving data & secrets."
echo "Public URL: ${SERVICE_URL}"
echo "You can now run GitHub Actions -> 'Build Otlobha Android & iOS Apps' on main."
echo "=============================================================================="
