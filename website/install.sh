#!/bin/bash
# Keep It Krispy - Self-Hosted Install Script
# Deploys all AWS infrastructure to YOUR account
# https://github.com/dwinter3/keep-it-krispy

set -e

REPO_URL="https://github.com/dwinter3/keep-it-krispy.git"
INSTALL_DIR="${KRISP_INSTALL_DIR:-$HOME/keep-it-krispy}"
STACK_NAME="${KRISP_STACK_NAME:-krisp-buddy}"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║         Keep It Krispy                ║"
echo "  ║   AI-Powered Meeting Memory           ║"
echo "  ║                                       ║"
echo "  ║   Self-Hosted AWS Deployment          ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

# Check prerequisites
check_prereqs() {
    local missing=()

    command -v git >/dev/null 2>&1 || missing+=("git")
    command -v node >/dev/null 2>&1 || missing+=("node (v18+)")
    command -v npm >/dev/null 2>&1 || missing+=("npm")
    command -v aws >/dev/null 2>&1 || missing+=("aws-cli")
    command -v python3 >/dev/null 2>&1 || missing+=("python3")

    if [ ${#missing[@]} -ne 0 ]; then
        echo "❌ Missing prerequisites: ${missing[*]}"
        echo ""
        echo "Please install:"
        for pkg in "${missing[@]}"; do
            case $pkg in
                git) echo "  • git: https://git-scm.com/downloads" ;;
                node*|npm) echo "  • Node.js 18+: https://nodejs.org/" ;;
                aws-cli) echo "  • AWS CLI: https://aws.amazon.com/cli/" ;;
                python3) echo "  • Python 3.11+: https://python.org/" ;;
            esac
        done
        exit 1
    fi

    # Check AWS credentials
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        echo "❌ AWS credentials not configured"
        echo ""
        echo "Run: aws configure"
        echo "Or set AWS_PROFILE environment variable"
        exit 1
    fi

    local account_id=$(aws sts get-caller-identity --query Account --output text)
    echo "✓ Prerequisites check passed"
    echo "✓ AWS Account: $account_id"
    echo "✓ AWS Region: $AWS_REGION"
}

# Clone repository
clone_repo() {
    if [ -d "$INSTALL_DIR" ]; then
        echo "→ Directory exists, pulling latest..."
        cd "$INSTALL_DIR"
        git pull origin main
    else
        echo "→ Cloning repository..."
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    echo "✓ Repository ready at $INSTALL_DIR"
}

# Deploy CloudFormation stack
deploy_infrastructure() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  Deploying AWS Infrastructure"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "This will create in your AWS account:"
    echo "  • S3 bucket for transcripts"
    echo "  • S3 bucket for vector embeddings"
    echo "  • DynamoDB table for metadata"
    echo "  • Lambda functions for webhook & processing"
    echo ""
    echo "Estimated cost: < \$2/month (mostly free tier)"
    echo ""

    read -p "Continue with deployment? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Deployment cancelled."
        exit 0
    fi

    echo ""
    echo "→ Deploying CloudFormation stack: $STACK_NAME"

    aws cloudformation deploy \
        --template-file cloudformation.yaml \
        --stack-name "$STACK_NAME" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$AWS_REGION" \
        --no-fail-on-empty-changeset

    echo "✓ Infrastructure deployed"
    echo ""

    # Get outputs
    echo "→ Fetching deployment outputs..."
    WEBHOOK_URL=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='WebhookUrl'].OutputValue" \
        --output text \
        --region "$AWS_REGION")

    TRANSCRIPTS_BUCKET=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='TranscriptsBucket'].OutputValue" \
        --output text \
        --region "$AWS_REGION")

    VECTORS_BUCKET=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='VectorsBucket'].OutputValue" \
        --output text \
        --region "$AWS_REGION")

    # Save config
    cat > .env.local << EOF
# Keep It Krispy - Auto-generated config
AWS_REGION=$AWS_REGION
KRISP_S3_BUCKET=$TRANSCRIPTS_BUCKET
VECTOR_BUCKET=$VECTORS_BUCKET
DYNAMODB_TABLE=krisp-transcripts-index
VECTOR_INDEX=transcript-chunks
KRISP_WEBHOOK_URL=$WEBHOOK_URL
EOF

    echo "✓ Configuration saved to .env.local"
}

# Create S3 Vectors index
create_vectors_index() {
    echo ""
    echo "→ Creating S3 Vectors index..."

    local account_id=$(aws sts get-caller-identity --query Account --output text)
    local vectors_bucket="krisp-vectors-${account_id}"

    # Check if s3vectors is available (preview feature)
    if aws s3vectors help >/dev/null 2>&1; then
        aws s3vectors create-index \
            --vector-bucket-name "$vectors_bucket" \
            --index-name transcript-chunks \
            --dimension 1024 \
            --distance-metric cosine \
            --region "$AWS_REGION" 2>/dev/null || echo "  (Index may already exist)"
        echo "✓ S3 Vectors index created"
    else
        echo "⚠️  S3 Vectors CLI not available"
        echo "   Create index manually in AWS Console:"
        echo "   Bucket: $vectors_bucket"
        echo "   Index: transcript-chunks"
        echo "   Dimensions: 1024"
        echo "   Distance: cosine"
    fi
}

# Deploy processor Lambda with full code
deploy_processor() {
    echo ""
    echo "→ Deploying processor Lambda..."

    cd lambda/processor

    # Create deployment package
    rm -rf package deployment.zip 2>/dev/null || true
    mkdir -p package
    pip install -r requirements.txt -t package --quiet 2>/dev/null || pip install -r requirements.txt -t package
    cp handler.py package/
    cd package && zip -r ../deployment.zip . -q && cd ..

    # Update Lambda
    aws lambda update-function-code \
        --function-name "${STACK_NAME}-processor" \
        --zip-file fileb://deployment.zip \
        --region "$AWS_REGION" >/dev/null

    rm -rf package deployment.zip
    cd ../..

    echo "✓ Processor Lambda deployed"
}

# Build MCP server
build_mcp_server() {
    echo ""
    echo "→ Building MCP server..."

    cd lambda/mcp-server-ts
    npm install --silent 2>/dev/null || npm install
    npm run build:stdio
    cd ../..

    echo "✓ MCP server built"
}

# Print completion message
print_completion() {
    local account_id=$(aws sts get-caller-identity --query Account --output text)

    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "  ✓ Keep It Krispy Installed Successfully!"
    echo "════════════════════════════════════════════════════════════"
    echo ""
    echo "WEBHOOK URL (add to Krisp settings):"
    echo "  $WEBHOOK_URL"
    echo ""
    echo "NEXT STEPS:"
    echo ""
    echo "  1. Configure Krisp webhook:"
    echo "     Go to Krisp → Settings → Integrations → Webhooks"
    echo "     Add URL: $WEBHOOK_URL"
    echo ""
    echo "  2. Add MCP server to Claude Desktop:"
    echo "     Edit: ~/Library/Application Support/Claude/claude_desktop_config.json"
    echo ""
    cat << EOF
     {
       "mcpServers": {
         "krisp": {
           "command": "node",
           "args": ["$INSTALL_DIR/lambda/mcp-server-ts/dist/stdio-server.cjs"],
           "env": {
             "AWS_REGION": "$AWS_REGION",
             "KRISP_S3_BUCKET": "krisp-transcripts-${account_id}",
             "DYNAMODB_TABLE": "krisp-transcripts-index",
             "VECTOR_BUCKET": "krisp-vectors-${account_id}",
             "VECTOR_INDEX": "transcript-chunks",
             "AWS_PROFILE": "default"
           }
         }
       }
     }
EOF
    echo ""
    echo "  3. Or add to Claude Code:"
    echo "     claude mcp add --transport stdio \\"
    echo "       --env AWS_REGION=$AWS_REGION \\"
    echo "       --env KRISP_S3_BUCKET=krisp-transcripts-${account_id} \\"
    echo "       --env DYNAMODB_TABLE=krisp-transcripts-index \\"
    echo "       --env VECTOR_BUCKET=krisp-vectors-${account_id} \\"
    echo "       --env VECTOR_INDEX=transcript-chunks \\"
    echo "       --scope user \\"
    echo "       krisp -- node $INSTALL_DIR/lambda/mcp-server-ts/dist/stdio-server.cjs"
    echo ""
    echo "  4. Have a meeting! Transcripts will auto-index."
    echo ""
    echo "Documentation: https://github.com/dwinter3/keep-it-krispy"
    echo ""
}

# Main
main() {
    check_prereqs
    echo ""
    clone_repo
    echo ""
    deploy_infrastructure
    create_vectors_index
    deploy_processor
    build_mcp_server
    print_completion
}

main "$@"
