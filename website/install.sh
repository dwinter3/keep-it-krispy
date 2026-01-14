#!/bin/bash
# Keep It Krispy - Self-Hosted Install Script
# Deploys all AWS infrastructure to YOUR account
# https://github.com/dwinter3/keep-it-krispy

set -e

REPO_URL="https://github.com/dwinter3/keep-it-krispy.git"
INSTALL_DIR="${KRISP_INSTALL_DIR:-$HOME/keep-it-krispy}"
STACK_NAME="${KRISP_STACK_NAME:-krisp-buddy}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    echo ""
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║         Keep It Krispy                ║"
    echo "  ║   AI-Powered Meeting Memory           ║"
    echo "  ║                                       ║"
    echo "  ║   Self-Hosted AWS Deployment          ║"
    echo "  ╚═══════════════════════════════════════╝"
    echo ""
}

# Detect OS for installation commands
detect_os() {
    case "$(uname -s)" in
        Darwin*) echo "macos" ;;
        Linux*)  echo "linux" ;;
        MINGW*|CYGWIN*|MSYS*) echo "windows" ;;
        *) echo "unknown" ;;
    esac
}

# Help user install AWS CLI
install_aws_cli_helper() {
    local os=$(detect_os)

    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  AWS CLI Installation Required${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    case $os in
        macos)
            echo "You're on macOS. Install AWS CLI with:"
            echo ""
            echo -e "  ${CYAN}brew install awscli${NC}"
            echo ""
            echo "Don't have Homebrew? Install it first:"
            echo -e "  ${CYAN}/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"${NC}"
            echo ""
            echo "Or download the official installer:"
            echo "  https://awscli.amazonaws.com/AWSCLIV2.pkg"
            ;;
        linux)
            echo "You're on Linux. Install AWS CLI with:"
            echo ""
            echo -e "  ${CYAN}curl \"https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip\" -o \"awscliv2.zip\"${NC}"
            echo -e "  ${CYAN}unzip awscliv2.zip${NC}"
            echo -e "  ${CYAN}sudo ./aws/install${NC}"
            echo ""
            echo "Or via package manager:"
            echo -e "  ${CYAN}sudo apt install awscli${NC}  # Debian/Ubuntu"
            echo -e "  ${CYAN}sudo yum install awscli${NC}  # RHEL/CentOS"
            ;;
        windows)
            echo "You're on Windows. Download the installer:"
            echo "  https://awscli.amazonaws.com/AWSCLIV2.msi"
            echo ""
            echo "Or via winget:"
            echo -e "  ${CYAN}winget install Amazon.AWSCLI${NC}"
            ;;
        *)
            echo "Download AWS CLI from:"
            echo "  https://aws.amazon.com/cli/"
            ;;
    esac

    echo ""
    echo "After installation, run this script again."
    echo ""
}

# Help user configure AWS credentials
configure_aws_credentials_helper() {
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  AWS Credentials Setup Required${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "AWS CLI is installed but credentials are not configured."
    echo ""
    echo -e "${CYAN}Option 1: Configure credentials now (interactive)${NC}"
    echo ""

    read -p "Would you like to configure AWS credentials now? [Y/n] " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo ""
        echo "No problem! Here's how to set up credentials manually:"
        echo ""
        show_manual_aws_setup
        exit 0
    fi

    echo ""
    echo -e "${GREEN}Great! Let's set up your AWS credentials.${NC}"
    echo ""
    echo "You'll need an AWS Access Key. If you don't have one:"
    echo ""
    echo "  1. Log into AWS Console: https://console.aws.amazon.com"
    echo "  2. Go to IAM → Users → Your User (or create one)"
    echo "  3. Security credentials → Create access key → CLI"
    echo "  4. Copy the Access Key ID and Secret Access Key"
    echo ""
    read -p "Press Enter when you have your Access Key ready..."
    echo ""

    # Run aws configure interactively
    echo "Running 'aws configure'..."
    echo "(Enter your Access Key ID, Secret Key, region: us-east-1, output: json)"
    echo ""
    aws configure

    # Verify it worked
    echo ""
    if aws sts get-caller-identity >/dev/null 2>&1; then
        echo -e "${GREEN}✓ AWS credentials configured successfully!${NC}"
        return 0
    else
        echo -e "${RED}❌ Configuration failed. Please check your credentials.${NC}"
        exit 1
    fi
}

show_manual_aws_setup() {
    echo -e "${CYAN}Manual AWS Setup Guide:${NC}"
    echo ""
    echo "1. Create an IAM User with AdministratorAccess:"
    echo "   AWS Console → IAM → Users → Create User"
    echo "   Attach policy: AdministratorAccess"
    echo ""
    echo "2. Create Access Key:"
    echo "   Select user → Security credentials → Create access key → CLI"
    echo ""
    echo "3. Configure AWS CLI:"
    echo -e "   ${CYAN}aws configure${NC}"
    echo ""
    echo "   Enter:"
    echo "   - AWS Access Key ID: AKIA..."
    echo "   - AWS Secret Access Key: wJalr..."
    echo "   - Default region: us-east-1"
    echo "   - Output format: json"
    echo ""
    echo "4. Verify:"
    echo -e "   ${CYAN}aws sts get-caller-identity${NC}"
    echo ""
    echo "5. Run this installer again:"
    echo -e "   ${CYAN}curl -fsSL https://krispy.alpha-pm.dev/install.sh | bash${NC}"
    echo ""
    echo "Full guide: https://krispy.alpha-pm.dev/#aws-setup"
}

# Validate AWS permissions before deployment
validate_aws_permissions() {
    echo ""
    echo "→ Validating AWS permissions..."

    local account_id=$(aws sts get-caller-identity --query Account --output text)
    local missing_perms=()

    # Test S3 permissions
    echo -n "  Checking S3..."
    if aws s3api head-bucket --bucket "test-perms-$RANDOM" 2>&1 | grep -q "Access Denied"; then
        missing_perms+=("s3:*")
        echo -e " ${RED}✗${NC}"
    else
        echo -e " ${GREEN}✓${NC}"
    fi

    # Test CloudFormation permissions
    echo -n "  Checking CloudFormation..."
    if aws cloudformation describe-stacks --stack-name "nonexistent-$RANDOM" 2>&1 | grep -q "AccessDenied"; then
        missing_perms+=("cloudformation:*")
        echo -e " ${RED}✗${NC}"
    else
        echo -e " ${GREEN}✓${NC}"
    fi

    # Test Lambda permissions
    echo -n "  Checking Lambda..."
    if aws lambda list-functions --max-items 1 2>&1 | grep -q "AccessDenied"; then
        missing_perms+=("lambda:*")
        echo -e " ${RED}✗${NC}"
    else
        echo -e " ${GREEN}✓${NC}"
    fi

    # Test DynamoDB permissions
    echo -n "  Checking DynamoDB..."
    if aws dynamodb list-tables --max-items 1 2>&1 | grep -q "AccessDenied"; then
        missing_perms+=("dynamodb:*")
        echo -e " ${RED}✗${NC}"
    else
        echo -e " ${GREEN}✓${NC}"
    fi

    # Test IAM permissions (needed for creating roles)
    echo -n "  Checking IAM..."
    if aws iam list-roles --max-items 1 2>&1 | grep -q "AccessDenied"; then
        missing_perms+=("iam:*")
        echo -e " ${RED}✗${NC}"
    else
        echo -e " ${GREEN}✓${NC}"
    fi

    # Test Bedrock permissions
    echo -n "  Checking Bedrock..."
    if aws bedrock list-foundation-models --region "$AWS_REGION" 2>&1 | grep -q "AccessDenied"; then
        missing_perms+=("bedrock:*")
        echo -e " ${YELLOW}⚠${NC} (optional)"
    else
        echo -e " ${GREEN}✓${NC}"
    fi

    if [ ${#missing_perms[@]} -ne 0 ]; then
        echo ""
        echo -e "${RED}❌ Insufficient AWS permissions${NC}"
        echo ""
        echo "Your IAM user/role is missing permissions for:"
        for perm in "${missing_perms[@]}"; do
            echo "  • $perm"
        done
        echo ""
        echo "To fix this:"
        echo "  1. Go to AWS Console → IAM → Users → Your User"
        echo "  2. Add permission: AdministratorAccess (easiest)"
        echo ""
        echo "  Or create a custom policy with these permissions:"
        echo "    cloudformation:*, s3:*, dynamodb:*, lambda:*,"
        echo "    iam:*, logs:*, bedrock:*"
        echo ""

        if [ ${#missing_perms[@]} -eq 1 ] && [ "${missing_perms[0]}" == "bedrock:*" ]; then
            echo -e "${YELLOW}Note: Bedrock is optional. You can continue without it,${NC}"
            echo -e "${YELLOW}but semantic search won't work until you enable Bedrock access.${NC}"
            echo ""
            read -p "Continue anyway? [y/N] " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        else
            exit 1
        fi
    fi

    echo ""
    echo -e "${GREEN}✓ AWS permissions validated${NC}"
}

# Check for Bedrock model access
check_bedrock_access() {
    echo ""
    echo "→ Checking Bedrock model access..."

    # Check if Titan Embeddings is accessible
    local model_access=$(aws bedrock get-foundation-model-availability \
        --model-identifier amazon.titan-embed-text-v2:0 \
        --region "$AWS_REGION" \
        --query 'modelAvailability.accessStatus' \
        --output text 2>/dev/null || echo "UNKNOWN")

    if [ "$model_access" == "ACCESSIBLE" ]; then
        echo -e "${GREEN}✓ Bedrock Titan Embeddings: Access granted${NC}"
    else
        echo -e "${YELLOW}⚠ Bedrock Titan Embeddings: Access not confirmed${NC}"
        echo ""
        echo "  To enable semantic search, you need to request model access:"
        echo "  1. Go to: https://console.aws.amazon.com/bedrock/home?region=$AWS_REGION#/modelaccess"
        echo "  2. Click 'Manage model access'"
        echo "  3. Select 'Amazon' → 'Titan Text Embeddings V2'"
        echo "  4. Click 'Request model access'"
        echo ""
        echo "  (Access is usually granted instantly)"
        echo ""
        read -p "Have you enabled Bedrock model access? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo ""
            echo -e "${YELLOW}Continuing without confirmed Bedrock access.${NC}"
            echo "  Semantic search may fail until you enable model access."
            echo ""
        fi
    fi
}

# Check basic prerequisites
check_prereqs() {
    echo "Checking prerequisites..."
    echo ""

    local missing=()

    # Check git
    echo -n "  Git..."
    if command -v git >/dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC} ($(git --version | cut -d' ' -f3))"
    else
        echo -e " ${RED}✗${NC}"
        missing+=("git")
    fi

    # Check Node.js
    echo -n "  Node.js 18+..."
    if command -v node >/dev/null 2>&1; then
        local node_version=$(node --version | tr -d 'v')
        local node_major=$(echo "$node_version" | cut -d. -f1)
        if [ "$node_major" -ge 18 ]; then
            echo -e " ${GREEN}✓${NC} (v$node_version)"
        else
            echo -e " ${RED}✗${NC} (v$node_version - need 18+)"
            missing+=("node (v18+)")
        fi
    else
        echo -e " ${RED}✗${NC}"
        missing+=("node (v18+)")
    fi

    # Check Python
    echo -n "  Python 3.11+..."
    if command -v python3 >/dev/null 2>&1; then
        local py_version=$(python3 --version | cut -d' ' -f2)
        local py_major=$(echo "$py_version" | cut -d. -f1)
        local py_minor=$(echo "$py_version" | cut -d. -f2)
        if [ "$py_major" -ge 3 ] && [ "$py_minor" -ge 11 ]; then
            echo -e " ${GREEN}✓${NC} ($py_version)"
        else
            echo -e " ${YELLOW}⚠${NC} ($py_version - recommend 3.11+)"
        fi
    else
        echo -e " ${RED}✗${NC}"
        missing+=("python3")
    fi

    # Check AWS CLI
    echo -n "  AWS CLI..."
    if command -v aws >/dev/null 2>&1; then
        local aws_version=$(aws --version | cut -d' ' -f1 | cut -d'/' -f2)
        echo -e " ${GREEN}✓${NC} ($aws_version)"
    else
        echo -e " ${RED}✗${NC}"
        install_aws_cli_helper
        exit 1
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        echo ""
        echo -e "${RED}❌ Missing prerequisites:${NC}"
        for pkg in "${missing[@]}"; do
            case $pkg in
                git) echo "  • Git: https://git-scm.com/downloads" ;;
                node*) echo "  • Node.js 18+: https://nodejs.org/" ;;
                python3) echo "  • Python 3.11+: https://python.org/" ;;
            esac
        done
        exit 1
    fi

    echo ""

    # Check AWS credentials
    echo "Checking AWS credentials..."
    echo ""
    echo -n "  AWS credentials..."
    if aws sts get-caller-identity >/dev/null 2>&1; then
        local account_id=$(aws sts get-caller-identity --query Account --output text)
        local user_arn=$(aws sts get-caller-identity --query Arn --output text)
        echo -e " ${GREEN}✓${NC}"
        echo "  Account: $account_id"
        echo "  Identity: $user_arn"
        echo "  Region: $AWS_REGION"
    else
        echo -e " ${RED}✗${NC}"
        configure_aws_credentials_helper
    fi
}

# Clone repository
clone_repo() {
    echo ""
    if [ -d "$INSTALL_DIR" ]; then
        echo "→ Directory exists, pulling latest..."
        cd "$INSTALL_DIR"
        git pull origin main
    else
        echo "→ Cloning repository..."
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    echo -e "${GREEN}✓ Repository ready at $INSTALL_DIR${NC}"
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

    echo -e "${GREEN}✓ Infrastructure deployed${NC}"
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

    echo -e "${GREEN}✓ Configuration saved to .env.local${NC}"
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
        echo -e "${GREEN}✓ S3 Vectors index created${NC}"
    else
        echo -e "${YELLOW}⚠ S3 Vectors CLI not available${NC}"
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

    echo -e "${GREEN}✓ Processor Lambda deployed${NC}"
}

# Build MCP server
build_mcp_server() {
    echo ""
    echo "→ Building MCP server..."

    cd lambda/mcp-server-ts
    npm install --silent 2>/dev/null || npm install
    npm run build:stdio
    cd ../..

    echo -e "${GREEN}✓ MCP server built${NC}"
}

# Print completion message
print_completion() {
    local account_id=$(aws sts get-caller-identity --query Account --output text)

    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✓ Keep It Krispy Installed Successfully!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${CYAN}WEBHOOK URL (add to Krisp settings):${NC}"
    echo "  $WEBHOOK_URL"
    echo ""
    echo -e "${CYAN}NEXT STEPS:${NC}"
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
    print_header
    check_prereqs
    validate_aws_permissions
    check_bedrock_access
    clone_repo
    deploy_infrastructure
    create_vectors_index
    deploy_processor
    build_mcp_server
    print_completion
}

main "$@"
