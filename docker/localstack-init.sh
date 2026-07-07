#!/bin/bash
# LocalStack "ready" init hook — community LocalStack keeps S3 state in
# memory, so buckets vanish on container restart. Recreate them every boot.
set -e
for bucket in sheaf-dev sheaf-test; do
  awslocal s3api head-bucket --bucket "$bucket" 2>/dev/null || awslocal s3 mb "s3://$bucket"
  awslocal s3api put-bucket-versioning --bucket "$bucket" \
    --versioning-configuration Status=Enabled
done
echo "sheaf buckets ready"
