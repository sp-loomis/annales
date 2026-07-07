export interface AppConfig {
  databaseUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  uploadTtlSeconds: number;
  port: number;
}

export function configFromEnv(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3Endpoint: process.env.S3_ENDPOINT ?? '',
    s3Region: process.env.S3_REGION ?? 'us-east-1',
    s3Bucket: process.env.S3_BUCKET ?? '',
    s3AccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    s3SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    uploadTtlSeconds: Number(process.env.UPLOAD_TTL_SECONDS ?? 900),
    port: Number(process.env.PORT ?? 3000),
    ...overrides,
  };
}
