#!/usr/bin/env bash
#
# deploy.sh — Deploy TCGStudio to Google Cloud Run
#
# Usage:
#   ./deploy.sh <project-id> [region]
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Project already created in GCP with billing enabled
#   - DNS zone tcgstudio.online ready (for custom domain)
#
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
PROJECT_ID="${1:?Usage: $0 <project-id> [region]}"
REGION="${2:-us-central1}"
REPOSITORY="tcgstudio"
TAG="${3:-latest}"
DB_INSTANCE="tcg-db"
DB_USER="postgres"
DB_PASSWORD="c2fb78c45e8370de7820c99d739618f1"
GCS_BUCKET="tcgstudio-assets-${PROJECT_ID}"
ROOT_DOMAIN="tcgstudio.online"

# For production, generate a real secret:
#   python3 -c "import secrets; print(secrets.token_hex(32))"
JWT_SECRET="f073cf1961b2b8dc58ea60bb53c851b7730daab6a55bd6dd47f2511618741107"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

blue()  { printf '\e[34m%s\e[0m\n' "$*"; }
green() { printf '\e[32m%s\e[0m\n' "$*"; }
yellow(){ printf '\e[33m%s\e[0m\n' "$*"; }

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  TCGStudio → Google Cloud Run                               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
blue "  Project:    ${PROJECT_ID}"
blue "  Region:     ${REGION}"
blue "  DB:         ${DB_INSTANCE}"
blue "  Bucket:     ${GCS_BUCKET}"
blue "  Domain:     ${ROOT_DOMAIN}"
echo ""

# ── Step 0: Preflight ──────────────────────────────────────────────
yellow "▸ Checking prerequisites..."

if ! command -v gcloud &>/dev/null; then
  echo "  ✗ gcloud not found → https://cloud.google.com/sdk/docs/install"
  exit 1
fi

CURRENT=$(gcloud config get-value project 2>/dev/null || true)
if [[ "${CURRENT}" != "${PROJECT_ID}" ]]; then
  gcloud config set project "${PROJECT_ID}"
fi

if ! gcloud projects describe "${PROJECT_ID}" &>/dev/null; then
  echo "  ✗ Project not found: ${PROJECT_ID}"
  echo "    Create it: gcloud projects create ${PROJECT_ID}"
  exit 1
fi
green "  ✓ Project verified"

# ── Step 1: Enable APIs ───────────────────────────────────────────
yellow "▸ Enabling GCP APIs..."
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  sqladmin.googleapis.com \
  storage-component.googleapis.com \
  --project "${PROJECT_ID}" 2>/dev/null || true
green "  ✓ APIs enabled"

# ── Step 2: Artifact Registry ─────────────────────────────────────
yellow "▸ Setting up Artifact Registry..."
if ! gcloud artifacts repositories describe "${REPOSITORY}" \
  --project "${PROJECT_ID}" --location "${REGION}" &>/dev/null; then
  gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="TCGStudio container images" \
    --project "${PROJECT_ID}"
fi
green "  ✓ Repository ready"

# ── Step 3: Cloud SQL ─────────────────────────────────────────────
yellow "▸ Setting up Cloud SQL..."
if ! gcloud sql instances describe "${DB_INSTANCE}" \
  --project "${PROJECT_ID}" &>/dev/null; then
  gcloud sql instances create "${DB_INSTANCE}" \
    --database-version=POSTGRES_16 \
    --tier=db-f1-micro \
    --region="${REGION}" \
    --root-password="${DB_PASSWORD}" \
    --project "${PROJECT_ID}"

  echo "  → Waiting for instance..."
  until [[ "$(gcloud sql instances describe "${DB_INSTANCE}" \
    --project "${PROJECT_ID}" --format='value(state)')" == "RUNNABLE" ]]; do
    sleep 10
  done

  gcloud sql databases create tcgstudio \
    --instance="${DB_INSTANCE}" --project "${PROJECT_ID}" 2>/dev/null || true
fi
green "  ✓ Cloud SQL ready"

# ── Step 4: GCS Bucket ────────────────────────────────────────────
yellow "▸ Setting up Cloud Storage..."
if ! gsutil ls -p "${PROJECT_ID}" "gs://${GCS_BUCKET}" &>/dev/null; then
  gsutil mb -l "${REGION}" "gs://${GCS_BUCKET}"
fi
SA="${PROJECT_ID}@appspot.gserviceaccount.com"
if ! gsutil iam get "gs://${GCS_BUCKET}" 2>/dev/null | grep -q "${SA}"; then
  gsutil iam ch "serviceAccount:${SA}:roles/storage.objectAdmin" "gs://${GCS_BUCKET}"
fi
green "  ✓ Bucket ready: gs://${GCS_BUCKET}"

# ── Step 5: Build & Push Images ───────────────────────────────────
yellow "▸ Building and pushing Docker images..."
gcloud builds submit --config "${SCRIPT_DIR}/cloudbuild.yaml" \
  --project "${PROJECT_ID}" \
  --substitutions="_PROJECT_ID=${PROJECT_ID},_REGION=${REGION},_REPOSITORY=${REPOSITORY},_TAG=${TAG}"
green "  ✓ Images pushed to Artifact Registry"

# ── Step 6: JWT Secret ────────────────────────────────────────────
yellow "▸ Managing secrets..."
if ! gcloud secrets describe tcg-jwt-secret --project "${PROJECT_ID}" &>/dev/null; then
  echo -n "${JWT_SECRET}" | gcloud secrets create tcg-jwt-secret \
    --project "${PROJECT_ID}" --data-file=-
  green "  ✓ Secret created: tcg-jwt-secret"
else
  green "  ✓ Secret exists: tcg-jwt-secret"
fi

# ── Step 7: Deploy API ────────────────────────────────────────────
yellow "▸ Deploying API service..."
sed \
  -e "s|\${PROJECT_ID}|${PROJECT_ID}|g" \
  -e "s|\${REGION}|${REGION}|g" \
  -e "s|\${DB_INSTANCE}|${DB_INSTANCE}|g" \
  -e "s|\${DB_USER}|${DB_USER}|g" \
  -e "s|\${DB_PASSWORD}|${DB_PASSWORD}|g" \
  -e "s|\${REPOSITORY}|${REPOSITORY}|g" \
  -e "s|\${TAG}|${TAG}|g" \
  -e "s|\${GCS_BUCKET}|${GCS_BUCKET}|g" \
  -e "s|\${CORS_ORIGINS}|*|g" \
  -e "s|\${ROOT_DOMAIN}|*|g" \
  "${SCRIPT_DIR}/api-service.yaml" | \
  gcloud run services replace - --project "${PROJECT_ID}" --region "${REGION}"

API_URL=$(gcloud run services describe tcg-api \
  --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')
green "  ✓ Live: ${API_URL}"

# ── Step 8: Deploy Designer ────────────────────────────────────────
yellow "▸ Deploying Designer service..."
sed \
  -e "s|\${PROJECT_ID}|${PROJECT_ID}|g" \
  -e "s|\${REGION}|${REGION}|g" \
  -e "s|\${REPOSITORY}|${REPOSITORY}|g" \
  -e "s|\${TAG}|${TAG}|g" \
  -e "s|\${API_URL}|${API_URL}|g" \
  "${SCRIPT_DIR}/designer-service.yaml" | \
  gcloud run services replace - --project "${PROJECT_ID}" --region "${REGION}"

DESIGNER_URL=$(gcloud run services describe tcg-designer \
  --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')
green "  ✓ Live: ${DESIGNER_URL}"

# ── Step 9: Lock CORS to Designer origin ──────────────────────────
yellow "▸ Locking down API CORS..."
sed \
  -e "s|\${PROJECT_ID}|${PROJECT_ID}|g" \
  -e "s|\${REGION}|${REGION}|g" \
  -e "s|\${DB_INSTANCE}|${DB_INSTANCE}|g" \
  -e "s|\${DB_USER}|${DB_USER}|g" \
  -e "s|\${DB_PASSWORD}|${DB_PASSWORD}|g" \
  -e "s|\${REPOSITORY}|${REPOSITORY}|g" \
  -e "s|\${TAG}|${TAG}|g" \
  -e "s|\${GCS_BUCKET}|${GCS_BUCKET}|g" \
  -e "s|\${CORS_ORIGINS}|${DESIGNER_URL}|g" \
  -e "s|\${ROOT_DOMAIN}|${ROOT_DOMAIN}|g" \
  "${SCRIPT_DIR}/api-service.yaml" | \
  gcloud run services replace - --project "${PROJECT_ID}" --region "${REGION}"
green "  ✓ CORS locked to ${DESIGNER_URL}"

# ── Step 10: Migrations ───────────────────────────────────────────
yellow "▸ Running database migrations..."
gcloud run jobs execute migrate-prisma \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --image "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/api:${TAG}" \
  --command -- npm run prisma:deploy \
  --set-env-vars "DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@/tcgstudio?host=/cloudsql/${PROJECT_ID}:${REGION}:${DB_INSTANCE}" \
  2>/dev/null || yellow "  ⚠ Migration job failed — run manually or check VPC/SQL connectivity"

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
green "  ✅ Deployment complete!"
echo ""
blue "  API:        ${API_URL}"
blue "  Designer:   ${DESIGNER_URL}"
echo ""
yellow "  JWT secret (save this — won't be shown again):"
echo "    ${JWT_SECRET}"
echo ""
blue "  Custom domain setup for tcgstudio.online:"
echo "    api.tcgstudio.online     → CNAME $(echo ${API_URL}     | sed 's|https\?://||')"
echo "    *.tcgstudio.online       → CNAME $(echo ${DESIGNER_URL} | sed 's|https\?://||')"
echo ""
blue "  Or via gcloud:"
echo "    gcloud run domain-mappings create --service tcg-api --domain api.tcgstudio.online"
echo "    gcloud run domain-mappings create --service tcg-designer --domain '*.tcgstudio.online'"
echo ""
blue "  Commands:"
echo "    gcloud run services list --region ${REGION}"
echo "    gcloud run services logs tcg-api --region ${REGION}"
echo "    gcloud run services logs tcg-designer --region ${REGION}"
echo "    https://console.cloud.google.com/run?project=${PROJECT_ID}"
echo "══════════════════════════════════════════════════════════════"