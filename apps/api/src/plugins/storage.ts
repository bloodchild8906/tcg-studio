/**
 * Object-storage plugin.
 *
 * Supports MinIO (S3-compatible) and Google Cloud Storage (GCS).
 * Decorates the Fastify instance with `fastify.storage`.
 */

import type { Readable } from "node:stream";
import fp from "fastify-plugin";
import { Client as MinioClient } from "minio";
import { Storage as GcsClient } from "@google-cloud/storage";
import { loadEnv } from "@/env";

export interface StorageHelper {
  bucket: string;
  objectKey: (params: {
    tenantId: string;
    projectId: string | null;
    assetId: string;
    extension: string;
  }) => string;
  putObject: (key: string, data: Buffer, options: { contentType: string }) => Promise<void>;
  getObject: (key: string) => Promise<Readable>;
  removeObject: (key: string) => Promise<void>;
}

declare module "fastify" {
  interface FastifyInstance {
    storage: StorageHelper;
  }
}

export default fp(async (fastify) => {
  const env = loadEnv();

  let helper: StorageHelper;

  if (env.STORAGE_PROVIDER === "gcs") {
    const client = new GcsClient({
      projectId: env.GCS_PROJECT_ID,
      keyFilename: env.GCS_KEY_FILE,
    });
    const bucket = client.bucket(env.GCS_BUCKET);

    helper = {
      bucket: env.GCS_BUCKET,
      objectKey: ({ tenantId, projectId, assetId, extension }) => {
        const ext = extension.startsWith(".") ? extension : `.${extension}`;
        const projectSegment = projectId ? `projects/${projectId}/` : "";
        return `tenants/${tenantId}/${projectSegment}assets/${assetId}${ext}`;
      },
      putObject: async (key, data, { contentType }) => {
        await bucket.file(key).save(data, { contentType, resumable: false });
      },
      getObject: async (key) => {
        return bucket.file(key).createReadStream();
      },
      removeObject: async (key) => {
        await bucket.file(key).delete({ ignoreNotFound: true });
      },
    };
    fastify.log.info(`storage: using GCS bucket "${env.GCS_BUCKET}"`);
  } else {
    const client = new MinioClient({
      endPoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
    });

    await ensureMinioBucket(client, env.MINIO_BUCKET, fastify.log);

    helper = {
      bucket: env.MINIO_BUCKET,
      objectKey: ({ tenantId, projectId, assetId, extension }) => {
        const ext = extension.startsWith(".") ? extension : `.${extension}`;
        const projectSegment = projectId ? `projects/${projectId}/` : "";
        return `tenants/${tenantId}/${projectSegment}assets/${assetId}${ext}`;
      },
      putObject: async (key, data, { contentType }) => {
        await client.putObject(env.MINIO_BUCKET, key, data, data.length, { "Content-Type": contentType });
      },
      getObject: async (key) => {
        return client.getObject(env.MINIO_BUCKET, key);
      },
      removeObject: async (key) => {
        await client.removeObject(env.MINIO_BUCKET, key);
      },
    };
    fastify.log.info(`storage: using MinIO bucket "${env.MINIO_BUCKET}"`);
  }

  fastify.decorate("storage", helper);
});

async function ensureMinioBucket(
  client: MinioClient,
  bucket: string,
  log: { info: (msg: string) => void; warn: (msg: object | string) => void },
): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const exists = await client.bucketExists(bucket);
      if (!exists) {
        await client.makeBucket(bucket, "us-east-1");
        log.info(`storage: created bucket "${bucket}"`);
      }
      return;
    } catch (err) {
      if (attempt === 6) {
        log.warn({ err: String(err) });
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}
