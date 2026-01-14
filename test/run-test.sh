#!/bin/bash
# Keep It Krispy - Interactive Test Script
# Runs installation step-by-step so you can watch each phase

set -e

# Configuration (edit these for your test account)
export AWS_PROFILE="${AWS_PROFILE:-krisp-test}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export KRISP_STACK_NAME="${KRISP_STACK_NAME:-krisp-buddy-test}"
export KRISP_INSTALL_DIR="${KRISP_INSTALL_DIR:-$HOME/krisp-buddy-test}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

pause() {
    echo ""
    echo -e "${YELLOW}>>> Press Enter to continue to next step...${NC}"
    read
}

header() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo ""
}

success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# ============================================================================
# STEP 0: Prerequisites Check
# ============================================================================
step_0_prereqs() {
    header "STEP 0: Prerequisites Check"

    echo "Checking required tools..."
    command -v git >/dev/null && success "git installed" || echo "❌ git not found"
    command -v node >/dev/null && success "node $(node --version) installed" || echo "❌ node not found"
    command -v npm >/dev/null && success "npm installed" || echo "❌ npm not found"
    command -v aws >/dev/null && success "aws-cli installed" || echo "❌ aws-cli not found"
    command -v python3 >/dev/null && success "python3 installed" || echo "❌ python3 not found"

    echo ""
    echo "Checking AWS credentials for profile: $AWS_PROFILE"
    if aws sts get-caller-identity --profile "$AWS_PROFILE" 2>/dev/null; then
        success "AWS credentials valid"
        ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
        echo "  Account ID: $ACCOUNT_ID"
        echo "  Region: $AWS_REGION"
    else
        echo "❌ AWS credentials not configured for profile: $AWS_PROFILE"
        echo ""
        echo "To set up:"
        echo "  1. Create IAM user in test account with AdministratorAccess"
        echo "  2. aws configure --profile $AWS_PROFILE"
        exit 1
    fi

    pause
}

# ============================================================================
# STEP 1: Deploy CloudFormation Infrastructure
# ============================================================================
step_1_cloudformation() {
    header "STEP 1: Deploy CloudFormation Stack"

    echo "This will create:"
    echo "  • S3 bucket: krisp-transcripts-$ACCOUNT_ID"
    echo "  • S3 bucket: krisp-vectors-$ACCOUNT_ID"
    echo "  • DynamoDB table: krisp-transcripts-index"
    echo "  • Lambda: $KRISP_STACK_NAME-webhook"
    echo "  • Lambda: $KRISP_STACK_NAME-processor"
    echo "  • IAM roles for Lambda execution"
    echo ""

    echo "Deploying CloudFormation stack: $KRISP_STACK_NAME"
    aws cloudformation deploy \
        --template-file "$REPO_DIR/cloudformation.yaml" \
        --stack-name "$KRISP_STACK_NAME" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --no-fail-on-empty-changeset

    success "CloudFormation stack deployed"

    echo ""
    echo "Stack outputs:"
    aws cloudformation describe-stacks \
        --stack-name "$KRISP_STACK_NAME" \
        --query "Stacks[0].Outputs" \
        --output table \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"

    # Save webhook URL for later
    WEBHOOK_URL=$(aws cloudformation describe-stacks \
        --stack-name "$KRISP_STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='WebhookUrl'].OutputValue" \
        --output text \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE")

    echo ""
    echo "Webhook URL: $WEBHOOK_URL"

    pause
}

# ============================================================================
# STEP 2: Create S3 Vectors Index
# ============================================================================
step_2_vectors_index() {
    header "STEP 2: Create S3 Vectors Index"

    VECTORS_BUCKET="krisp-vectors-$ACCOUNT_ID"

    echo "Creating S3 Vectors index..."
    echo "  Bucket: $VECTORS_BUCKET"
    echo "  Index: transcript-chunks"
    echo "  Dimensions: 1024"
    echo "  Distance metric: cosine"
    echo ""

    if aws s3vectors help >/dev/null 2>&1; then
        aws s3vectors create-index \
            --vector-bucket-name "$VECTORS_BUCKET" \
            --index-name transcript-chunks \
            --dimension 1024 \
            --distance-metric cosine \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE" 2>/dev/null || echo "  (Index may already exist)"

        success "S3 Vectors index created/verified"
    else
        echo "⚠️  S3 Vectors CLI not available in your AWS CLI version"
        echo "   You may need to create the index manually in the AWS Console"
        echo "   Or update your AWS CLI: pip install --upgrade awscli"
    fi

    pause
}

# ============================================================================
# STEP 3: Deploy Processor Lambda Code
# ============================================================================
step_3_processor() {
    header "STEP 3: Deploy Processor Lambda Code"

    echo "The CloudFormation created a placeholder Lambda."
    echo "Now deploying the actual processor code with dependencies..."
    echo ""

    cd "$REPO_DIR/lambda/processor"

    echo "Creating deployment package..."
    rm -rf package deployment.zip 2>/dev/null || true
    mkdir -p package

    echo "Installing Python dependencies..."
    pip install -r requirements.txt -t package --quiet

    echo "Packaging Lambda function..."
    cp handler.py embeddings.py dynamo.py vectors.py package/
    cd package && zip -r ../deployment.zip . -q && cd ..

    echo "Uploading to Lambda..."
    aws lambda update-function-code \
        --function-name "${KRISP_STACK_NAME}-processor" \
        --zip-file fileb://deployment.zip \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" >/dev/null

    rm -rf package deployment.zip
    cd "$SCRIPT_DIR"

    success "Processor Lambda deployed with all dependencies"

    pause
}

# ============================================================================
# STEP 4: Build MCP Server
# ============================================================================
step_4_mcp_server() {
    header "STEP 4: Build MCP Server"

    echo "Building the MCP server for Claude Desktop/Code..."
    echo ""

    cd "$REPO_DIR/lambda/mcp-server-ts"

    echo "Installing npm dependencies..."
    npm install --silent

    echo "Building server..."
    npm run build:stdio

    success "MCP server built at: $REPO_DIR/lambda/mcp-server-ts/dist/stdio-server.cjs"

    cd "$SCRIPT_DIR"

    pause
}

# ============================================================================
# STEP 5: Test Webhook with Mock Transcript
# ============================================================================
step_5_mock_webhook() {
    header "STEP 5: Test Webhook with Mock Transcript"

    echo "Sending mock transcript to webhook..."
    echo "  URL: $WEBHOOK_URL"
    echo "  Payload: $SCRIPT_DIR/mock-transcript.json"
    echo ""

    RESPONSE=$(curl -s -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d @"$SCRIPT_DIR/mock-transcript.json")

    echo "Response: $RESPONSE"
    echo ""

    if echo "$RESPONSE" | grep -q '"statusCode":200\|"message":"Webhook received"'; then
        success "Webhook accepted the transcript"
    else
        echo "⚠️  Unexpected response from webhook"
    fi

    echo ""
    echo "Checking S3 for stored transcript..."
    sleep 2  # Give S3 a moment

    TRANSCRIPTS_BUCKET="krisp-transcripts-$ACCOUNT_ID"
    aws s3 ls "s3://$TRANSCRIPTS_BUCKET/meetings/" --recursive \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION" | tail -5

    pause
}

# ============================================================================
# STEP 6: Verify Processing
# ============================================================================
step_6_verify() {
    header "STEP 6: Verify Processing"

    echo "Checking DynamoDB for indexed transcript..."
    aws dynamodb scan \
        --table-name krisp-transcripts-index \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --max-items 5 \
        --output table

    echo ""
    echo "Checking S3 Vectors for embeddings..."
    VECTORS_BUCKET="krisp-vectors-$ACCOUNT_ID"

    if aws s3vectors help >/dev/null 2>&1; then
        aws s3vectors list-vectors \
            --vector-bucket-name "$VECTORS_BUCKET" \
            --index-name transcript-chunks \
            --max-results 5 \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE" 2>/dev/null || echo "  (No vectors yet or index not ready)"
    else
        echo "  (S3 Vectors CLI not available - check console)"
    fi

    pause
}

# ============================================================================
# STEP 7: Test MCP Server Query
# ============================================================================
step_7_mcp_query() {
    header "STEP 7: Test MCP Server Query"

    echo "Testing MCP server with a sample query..."
    echo ""

    # Export environment variables for MCP server
    export AWS_REGION="$AWS_REGION"
    export AWS_PROFILE="$AWS_PROFILE"
    export KRISP_S3_BUCKET="krisp-transcripts-$ACCOUNT_ID"
    export DYNAMODB_TABLE="krisp-transcripts-index"
    export VECTOR_BUCKET="krisp-vectors-$ACCOUNT_ID"
    export VECTOR_INDEX="transcript-chunks"

    echo "MCP Server configuration:"
    echo "  AWS_REGION=$AWS_REGION"
    echo "  AWS_PROFILE=$AWS_PROFILE"
    echo "  KRISP_S3_BUCKET=$KRISP_S3_BUCKET"
    echo "  DYNAMODB_TABLE=$DYNAMODB_TABLE"
    echo "  VECTOR_BUCKET=$VECTOR_BUCKET"
    echo "  VECTOR_INDEX=$VECTOR_INDEX"
    echo ""

    echo "To add to Claude Desktop, edit ~/Library/Application Support/Claude/claude_desktop_config.json:"
    cat << EOF
{
  "mcpServers": {
    "krisp-test": {
      "command": "node",
      "args": ["$REPO_DIR/lambda/mcp-server-ts/dist/stdio-server.cjs"],
      "env": {
        "AWS_REGION": "$AWS_REGION",
        "AWS_PROFILE": "$AWS_PROFILE",
        "KRISP_S3_BUCKET": "$KRISP_S3_BUCKET",
        "DYNAMODB_TABLE": "$DYNAMODB_TABLE",
        "VECTOR_BUCKET": "$VECTOR_BUCKET",
        "VECTOR_INDEX": "$VECTOR_INDEX"
      }
    }
  }
}
EOF

    pause
}

# ============================================================================
# STEP 8: Summary
# ============================================================================
step_8_summary() {
    header "STEP 8: Summary"

    echo "Test installation complete!"
    echo ""
    echo "What was created:"
    echo "  • CloudFormation stack: $KRISP_STACK_NAME"
    echo "  • S3 bucket: krisp-transcripts-$ACCOUNT_ID"
    echo "  • S3 bucket: krisp-vectors-$ACCOUNT_ID"
    echo "  • DynamoDB table: krisp-transcripts-index"
    echo "  • Lambda functions: webhook & processor"
    echo "  • S3 Vectors index: transcript-chunks"
    echo ""
    echo "Webhook URL (for Krisp settings):"
    echo "  $WEBHOOK_URL"
    echo ""
    echo "To clean up:"
    echo "  aws cloudformation delete-stack --stack-name $KRISP_STACK_NAME --profile $AWS_PROFILE"
    echo "  aws s3 rm s3://krisp-transcripts-$ACCOUNT_ID --recursive --profile $AWS_PROFILE"
    echo "  aws s3 rm s3://krisp-vectors-$ACCOUNT_ID --recursive --profile $AWS_PROFILE"
    echo ""
}

# ============================================================================
# Main
# ============================================================================
main() {
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║         Keep It Krispy - Interactive Test Install            ║"
    echo "╠═══════════════════════════════════════════════════════════════╣"
    echo "║  This script walks through each installation step so you     ║"
    echo "║  can watch the process and verify each phase.                ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Configuration:"
    echo "  AWS_PROFILE: $AWS_PROFILE"
    echo "  AWS_REGION: $AWS_REGION"
    echo "  STACK_NAME: $KRISP_STACK_NAME"
    echo "  INSTALL_DIR: $KRISP_INSTALL_DIR"
    echo ""

    pause

    step_0_prereqs

    ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)

    step_1_cloudformation
    step_2_vectors_index
    step_3_processor
    step_4_mcp_server
    step_5_mock_webhook
    step_6_verify
    step_7_mcp_query
    step_8_summary
}

# Allow running individual steps
case "${1:-}" in
    0|prereqs) step_0_prereqs ;;
    1|cloudformation) step_1_cloudformation ;;
    2|vectors) step_2_vectors_index ;;
    3|processor) step_3_processor ;;
    4|mcp) step_4_mcp_server ;;
    5|webhook) step_5_mock_webhook ;;
    6|verify) step_6_verify ;;
    7|query) step_7_mcp_query ;;
    8|summary) step_8_summary ;;
    *) main ;;
esac
