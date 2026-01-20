#!/bin/bash
set -e

FUNCTION_NAME="krisp-transcript-processor"
ROLE_NAME="krisp-processor-lambda-role"
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID="${AWS_ACCOUNT_ID:?ERROR: Set AWS_ACCOUNT_ID environment variable}"

cd "$(dirname "$0")"

echo "Creating deployment package..."
rm -rf package
mkdir -p package
pip install -r requirements.txt -t package --quiet
cp handler.py embeddings.py vectors.py package/
cd package
zip -r ../deployment.zip . -q
cd ..

echo "Checking if role exists..."
if ! aws iam get-role --role-name $ROLE_NAME 2>/dev/null; then
    echo "Creating IAM role..."
    aws iam create-role \
        --role-name $ROLE_NAME \
        --assume-role-policy-document file://../trust-policy.json

    echo "Waiting for role to propagate..."
    sleep 10
fi

echo "Updating IAM policy..."
aws iam put-role-policy \
    --role-name $ROLE_NAME \
    --policy-name krisp-processor-policy \
    --policy-document file://iam-policy.json

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

echo "Checking if function exists..."
if aws lambda get-function --function-name $FUNCTION_NAME --region $REGION 2>/dev/null; then
    echo "Updating existing function..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://deployment.zip \
        --region $REGION
else
    echo "Creating new function..."
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime python3.12 \
        --role $ROLE_ARN \
        --handler handler.handler \
        --zip-file fileb://deployment.zip \
        --timeout 60 \
        --memory-size 256 \
        --environment "Variables={DYNAMODB_TABLE=krisp-transcripts-index}" \
        --region $REGION
fi

echo "Waiting for function to be active..."
aws lambda wait function-active --function-name $FUNCTION_NAME --region $REGION

echo "Deployment complete!"
echo "Function ARN: arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"

# Clean up
rm -rf package deployment.zip

echo ""
echo "Next: Configure S3 event notification with:"
echo "aws s3api put-bucket-notification-configuration --bucket \$KRISP_S3_BUCKET --notification-configuration file://s3-notification.json"
