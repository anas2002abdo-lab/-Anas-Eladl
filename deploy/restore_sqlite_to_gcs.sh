#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Otlobha -> Safe, Confirmation-Gated SQLite Backup Upload / Restore to GCS
# NEVER runs automatically during deployment.
# Verifies local SHA-256 + SQLite integrity_check before touching GCS,
# and archives any existing live DB into pre-restore-backups/ before replacing.
# ==============================================================================

BACKUP_FILE="${1:-}"
ALLOW_OVERWRITE="false"
if [ "${2:-}" = "--allow-overwrite" ]; then
  ALLOW_OVERWRITE="true"
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: ./deploy/restore_sqlite_to_gcs.sh <path-to-verified-backup.db> [--allow-overwrite]"
  exit 1
fi

GCP_PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
GCS_BUCKET="${GCS_BUCKET:-${GCP_PROJECT_ID}-otlobha-data}"

if [ -z "$GCP_PROJECT_ID" ] || [ "$GCP_PROJECT_ID" = "(unset)" ]; then
  echo "ERROR: GCP_PROJECT_ID is not set."
  exit 1
fi

echo "==> Step 1: Verifying local backup checksum and SQLite PRAGMA integrity_check..."
npx tsx scripts/checkpoint-sqlite.ts --verify "$BACKUP_FILE"

TARGET_URI="gs://${GCS_BUCKET}/otlobha.db"
echo ""
echo "==> Step 2: Checking destination $TARGET_URI..."

if gcloud storage ls "$TARGET_URI" >/dev/null 2>&1; then
  echo "WARNING: A production database ALREADY EXISTS at $TARGET_URI!"
  if [ "$ALLOW_OVERWRITE" != "true" ]; then
    echo "ABORTED: Refusing to overwrite existing production database."
    echo "If you truly intend to replace it, re-run with --allow-overwrite."
    exit 1
  fi
  echo ""
  echo "To prevent accidental data loss, please type exactly: REPLACE PRODUCTION DB"
  read -r CONFIRM_TEXT
  if [ "$CONFIRM_TEXT" != "REPLACE PRODUCTION DB" ]; then
    echo "ABORTED: Confirmation phrase did not match."
    exit 1
  fi

  STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  PRE_BACKUP_URI="gs://${GCS_BUCKET}/pre-restore-backups/otlobha-before-restore-${STAMP}.db"
  echo "==> Archiving existing production DB to $PRE_BACKUP_URI before replacement..."
  gcloud storage cp "$TARGET_URI" "$PRE_BACKUP_URI"
else
  echo "Destination $TARGET_URI does not exist yet (initial seed upload)."
  if [ "${CONFIRM_UPLOAD:-}" != "YES" ]; then
    read -r -p "Confirm uploading '$BACKUP_FILE' to '$TARGET_URI'? Type YES to continue: " CONFIRM_INIT
    if [ "$CONFIRM_INIT" != "YES" ]; then
      echo "ABORTED by user."
      exit 1
    fi
  fi
fi

echo "==> Step 3: Uploading verified snapshot to $TARGET_URI..."
gcloud storage cp "$BACKUP_FILE" "$TARGET_URI"
if [ -f "${BACKUP_FILE}.sha256" ]; then
  gcloud storage cp "${BACKUP_FILE}.sha256" "gs://${GCS_BUCKET}/otlobha.db.sha256"
fi

echo ""
echo "=============================================================================="
echo "Upload complete: $TARGET_URI"
echo "NOTE: If Cloud Run is already running, deploy or restart the revision so the"
echo "container hydrates the newly restored snapshot cleanly on startup."
echo "=============================================================================="
