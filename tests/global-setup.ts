import { execSync } from 'node:child_process';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
} from '@aws-sdk/client-s3';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://sheaf:sheaf@localhost:5433/sheaf_test';
const TEST_S3_ENDPOINT = process.env.TEST_S3_ENDPOINT ?? 'http://localhost:4566';
const TEST_BUCKET = 'sheaf-test';

export default async function setup() {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });

  const s3 = new S3Client({
    endpoint: TEST_S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
  } catch {
    // already exists
  }
  await s3.send(
    new PutBucketVersioningCommand({
      Bucket: TEST_BUCKET,
      VersioningConfiguration: { Status: 'Enabled' },
    })
  );
  s3.destroy();
}
