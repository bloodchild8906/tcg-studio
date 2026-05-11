# Deploying TCGStudio to Google Cloud Run

This guide explains how to deploy the TCGStudio stack (API and Designer) to Google Cloud Run for the domain **tcgstudio.online**.

## Architecture

- **TCG API**: Node.js Fastify backend on Cloud Run (port 4000).
- **TCG Designer**: React SPA served via Nginx on Cloud Run (port 80).
- **Cloud SQL**: Managed PostgreSQL database.
- **Artifact Registry**: Storage for Docker images.
- **Cloud Build**: Automated CI/CD pipeline.
- **GCS**: Asset storage bucket.
- **Custom Domain**: `tcgstudio.online` with subdomains `api.*` and `designer.*`.

## Prerequisites

1. **Google Cloud Project**: Created and active with billing enabled.
2. **gcloud CLI**: Installed and authenticated (`gcloud auth login`).
3. **Project ID**: Set in your shell (`gcloud config set project YOUR_PROJECT_ID`).
4. **DNS access**: You control the `tcgstudio.online` DNS zone.

## Setup GCP Resources

### 1. Enable APIs

```bash
gcloud services enable \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    sqladmin.googleapis.com \
    storage-component.googleapis.com
```

### 2. Create Cloud SQL Instance

```bash
gcloud sql instances create tcg-db \
    --database-version=POSTGRES_16 \
    --tier=db-f1-micro \
    --region=us-central1 \
    --root-password=YOUR_STRONG_PASSWORD

gcloud sql databases create tcgstudio --instance=tcg-db
```

### 3. Upload a JWT Secret

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
# Save the output — you'll need it once

echo -n "<your-secret>" | gcloud secrets create tcg-jwt-secret --data-file=-
```

## Deployment

### Quick Deploy (single command)

```bash
cd deploy/
bash deploy.sh YOUR_PROJECT_ID us-central1
```

The script will:
1. Enable required GCP APIs
2. Create the Artifact Registry repo
3. Provision Cloud SQL + GCS bucket
4. Build and push Docker images
5. Deploy the API to Cloud Run
6. Deploy the Designer to Cloud Run
7. Wire up CORS between them
8. Run database migrations

### DNS Setup

After deployment, the script prints your Cloud Run URLs. Create these DNS records:

```
api.tcgstudio.online    CNAME  <api-cloud-run-url>.a.run.app
*.tcgstudio.online      CNAME  <designer-cloud-run-url>.a.run.app
```

Or map custom domains directly via gcloud:

```bash
gcloud run domain-mappings create --service tcg-api --domain api.tcgstudio.online
gcloud run domain-mappings create --service tcg-designer --domain designer.tcgstudio.online
gcloud run domain-mappings create --service tcg-designer --domain '*.tcgstudio.online'
```

### Environment Variables

The deploy script handles these automatically. For manual reference:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://postgres:PASSWORD@/tcgstudio?host=/cloudsql/PROJECT:REGION:tcg-db` |
| `JWT_SECRET` | *(from GCP Secret Manager)* |
| `CORS_ORIGINS` | `https://designer.tcgstudio.online` |
| `ROOT_DOMAIN` | `tcgstudio.online` |
| `STORAGE_PROVIDER` | `gcs` |
| `GCS_BUCKET` | `tcgstudio-assets-PROJECT_ID` |
| `VITE_API_URL` | *(injected at request time by nginx)* |

### Database Migrations

After deployment, run migrations:

```bash
# Option 1: Cloud Run Job (preferred)
gcloud run jobs execute migrate-prisma \
  --image us-central1-docker.pkg.dev/PROJECT/tcgstudio/api:latest \
  --command -- npm run prisma:deploy \
  --set-env-vars "DATABASE_URL=..."

# Option 2: From local machine with Cloud SQL Auth Proxy
cd apps/api
export DATABASE_URL="postgresql://postgres:PASSWORD@/tcgstudio?host=/cloudsql/PROJECT:us-central1:tcg-db"
npm run prisma:deploy
```

## Updating an Existing Deployment

```bash
# Rebuild and redeploy everything
bash deploy.sh YOUR_PROJECT_ID us-central1 latest
```

## Monitoring

```bash
gcloud run services list --region us-central1
gcloud run services logs tcg-api --region us-central1
gcloud run services logs tcg-designer --region us-central1
```

## Storage

The API uses Google Cloud Storage for asset uploads by default in production. Ensure the Cloud Run service account has `roles/storage.objectAdmin` on the bucket:

```bash
gsutil iam ch "serviceAccount:PROJECT_ID@appspot.gserviceaccount.com:roles/storage.objectAdmin" gs://tcgstudio-assets-PROJECT_ID
```