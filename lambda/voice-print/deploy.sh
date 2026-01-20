#!/bin/bash
set -e

FUNCTION_NAME="krisp-voice-print-processor"
REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-krisp-buddy}"

cd "$(dirname "$0")"

echo "Creating deployment package..."
rm -rf package deployment.zip
mkdir -p package
pip install -r requirements.txt -t package --quiet 2>/dev/null || true
cp handler.py package/
cd package
zip -r ../deployment.zip . -q
cd ..

echo "Checking if function exists..."
if aws lambda get-function --function-name $FUNCTION_NAME --region $REGION --profile $PROFILE 2>/dev/null; then
    echo "Updating existing function..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://deployment.zip \
        --region $REGION \
        --profile $PROFILE
else
    echo "Creating new function..."
    # Get the existing processor role ARN
    ROLE_ARN=$(aws iam get-role --role-name krisp-processor-lambda-role --profile $PROFILE --query 'Role.Arn' --output text 2>/dev/null || echo "")

    if [ -z "$ROLE_ARN" ]; then
        echo "ERROR: Cannot find krisp-processor-lambda-role. Please ensure it exists."
        exit 1
    fi

    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime python3.12 \
        --role $ROLE_ARN \
        --handler handler.handler \
        --zip-file fileb://deployment.zip \
        --timeout 300 \
        --memory-size 512 \
        --environment "Variables={AUDIO_BUCKET=krisp-audio-754639201213,DYNAMODB_TABLE=krisp-transcripts-index,VOICE_PRINTS_TABLE=krisp-voice-prints}" \
        --region $REGION \
        --profile $PROFILE
fi

echo "Waiting for function to be active..."
aws lambda wait function-active --function-name $FUNCTION_NAME --region $REGION --profile $PROFILE

echo "Deployment complete!"
echo "Function ARN: $(aws lambda get-function --function-name $FUNCTION_NAME --region $REGION --profile $PROFILE --query 'Configuration.FunctionArn' --output text)"

# Clean up
rm -rf package deployment.zip

echo ""
echo "Next steps:"
echo "1. Add S3 event notification to trigger this Lambda:"
echo "   aws s3api put-bucket-notification-configuration --bucket krisp-audio-754639201213 --notification-configuration file://s3-notification.json --profile $PROFILE --region $REGION"
echo ""
echo "2. Add EventBridge rule for Transcribe job completion:"
echo "   aws events put-rule --name krisp-transcribe-complete --event-pattern '{\"source\":[\"aws.transcribe\"],\"detail-type\":[\"Transcribe Job State Change\"],\"detail\":{\"TranscriptionJobStatus\":[\"COMPLETED\",\"FAILED\"]}}' --profile $PROFILE --region $REGION"
