#!/bin/bash
# Deploy Keep It Krispy MCP Server to AWS Lambda

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_NAME="${FUNCTION_NAME:-krisp-mcp-server}"
REGION="${AWS_REGION:-us-east-1}"
RUNTIME="python3.11"
ROLE_NAME="krisp-mcp-server-role"
BUCKET_NAME="${KRISP_S3_BUCKET:?ERROR: Set KRISP_S3_BUCKET environment variable}"

echo "=== Keep It Krispy MCP Server Deployment ==="
echo "Function: $FUNCTION_NAME"
echo "Region: $REGION"
echo "Bucket: $BUCKET_NAME"
echo ""

cd "$SCRIPT_DIR"

# Create build directory
echo "Creating build package..."
rm -rf .build
mkdir -p .build

# Install dependencies for Lambda (Linux)
pip install \
    --target .build/ \
    --platform manylinux2014_x86_64 \
    --implementation cp \
    --python-version 3.11 \
    --only-binary=:all: \
    -r requirements.txt \
    2>/dev/null || pip install --target .build/ -r requirements.txt

# Copy source code
cp *.py .build/

# Create zip
cd .build
zip -r ../function.zip . -x "*.pyc" -x "__pycache__/*"
cd ..

echo "Package created: function.zip ($(du -h function.zip | cut -f1))"

# Check if function exists
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null; then
    echo "Updating existing Lambda function..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb://function.zip \
        --region "$REGION"

    echo "Waiting for update to complete..."
    aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
else
    echo "Creating new Lambda function..."

    # Create IAM role if it doesn't exist
    if ! aws iam get-role --role-name "$ROLE_NAME" 2>/dev/null; then
        echo "Creating IAM role..."
        aws iam create-role \
            --role-name "$ROLE_NAME" \
            --assume-role-policy-document file://trust-policy.json

        # Attach policy
        aws iam put-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-name "krisp-mcp-server-policy" \
            --policy-document file://iam-policy.json

        echo "Waiting for role to propagate..."
        sleep 10
    fi

    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)

    # Create function
    aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime "$RUNTIME" \
        --handler lambda_handler.handler \
        --role "$ROLE_ARN" \
        --zip-file fileb://function.zip \
        --timeout 30 \
        --memory-size 256 \
        --region "$REGION" \
        --environment "Variables={KRISP_S3_BUCKET=$BUCKET_NAME}"

    echo "Waiting for function to be active..."
    aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
fi

# Check/create function URL
if aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null; then
    echo "Function URL already configured"
else
    echo "Creating function URL with streaming..."
    aws lambda create-function-url-config \
        --function-name "$FUNCTION_NAME" \
        --auth-type NONE \
        --invoke-mode RESPONSE_STREAM \
        --cors "AllowOrigins=*,AllowMethods=POST,GET,OPTIONS,AllowHeaders=Content-Type,X-API-Key,Authorization,Accept" \
        --region "$REGION"

    # Add permission for public access
    aws lambda add-permission \
        --function-name "$FUNCTION_NAME" \
        --statement-id FunctionURLAllowPublicAccess \
        --action lambda:InvokeFunctionUrl \
        --principal "*" \
        --function-url-auth-type NONE \
        --region "$REGION" 2>/dev/null || true
fi

# Get function URL
FUNCTION_URL=$(aws lambda get-function-url-config \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --query 'FunctionUrl' \
    --output text)

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Function URL: $FUNCTION_URL"
echo "MCP Endpoint: ${FUNCTION_URL}mcp"
echo "Health Check: ${FUNCTION_URL}health"
echo ""
echo "To set API key, run:"
echo "  aws lambda update-function-configuration \\"
echo "    --function-name $FUNCTION_NAME \\"
echo "    --environment \"Variables={KRISP_S3_BUCKET=$BUCKET_NAME,MCP_API_KEY=your-secret-key}\""
echo ""
echo "Add to Claude Desktop:"
echo "  URL: ${FUNCTION_URL}mcp"
echo "  Header: X-API-Key: <your-api-key>"

# Cleanup
rm -rf .build
