#!/bin/bash
# Keep It Krispy - Self-Hosted Install Script
# Deploys all AWS infrastructure to YOUR account
# https://github.com/dwinter3/keep-it-krispy

set -e

REPO_URL="https://github.com/dwinter3/keep-it-krispy.git"
INSTALL_DIR="${KRISP_INSTALL_DIR:-$HOME/keep-it-krispy}"
STACK_NAME="${KRISP_STACK_NAME:-krisp-buddy}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Generate webhook auth key (32 hex chars) for security
generate_auth_key() {
    # Use /dev/urandom for secure random key, fallback to openssl
    if [ -f /dev/urandom ]; then
        head -c 16 /dev/urandom | xxd -p
    elif command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 16
    else
        # Last resort: use $RANDOM (less secure but functional)
        echo "$(printf '%08x%08x%08x%08x' $RANDOM$RANDOM $RANDOM$RANDOM $RANDOM$RANDOM $RANDOM$RANDOM)"
    fi
}

WEBHOOK_AUTH_KEY=$(generate_auth_key)

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
    echo "1. Download the scoped IAM policy:"
    echo -e "   ${CYAN}curl -O https://krispy.alpha-pm.dev/iam-policy.json${NC}"
    echo ""
    echo "2. Create the IAM policy in AWS Console:"
    echo "   IAM → Policies → Create Policy → JSON tab"
    echo "   Paste the contents of iam-policy.json"
    echo "   Name it: KrispBuddyDeployerPolicy"
    echo ""
    echo "3. Create an IAM User:"
    echo "   IAM → Users → Create User"
    echo "   Name: krisp-deployer"
    echo "   Attach: KrispBuddyDeployerPolicy"
    echo ""
    echo "4. Create Access Key:"
    echo "   Select user → Security credentials → Create access key → CLI"
    echo ""
    echo "5. Configure AWS CLI:"
    echo -e "   ${CYAN}aws configure${NC}"
    echo ""
    echo "   Enter:"
    echo "   - AWS Access Key ID: AKIA..."
    echo "   - AWS Secret Access Key: wJalr..."
    echo "   - Default region: us-east-1"
    echo "   - Output format: json"
    echo ""
    echo "6. Verify:"
    echo -e "   ${CYAN}aws sts get-caller-identity${NC}"
    echo ""
    echo "7. Run this installer again:"
    echo -e "   ${CYAN}curl -fsSL https://krispy.alpha-pm.dev/install.sh | bash${NC}"
    echo ""
    echo "Full guide: https://krispy.alpha-pm.dev"
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
        echo "To fix this, use our scoped IAM policy:"
        echo ""
        echo "  1. Download the policy:"
        echo -e "     ${CYAN}curl -O https://krispy.alpha-pm.dev/iam-policy.json${NC}"
        echo ""
        echo "  2. Create the policy in AWS Console:"
        echo "     IAM → Policies → Create Policy → JSON tab → paste contents"
        echo "     Name: KrispBuddyDeployerPolicy"
        echo ""
        echo "  3. Attach the policy to your user:"
        echo "     IAM → Users → Your User → Add permissions → Attach policy"
        echo ""
        echo "  Full guide: https://krispy.alpha-pm.dev"
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
    echo "  (with webhook authentication enabled)"

    aws cloudformation deploy \
        --template-file cloudformation.yaml \
        --stack-name "$STACK_NAME" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$AWS_REGION" \
        --parameter-overrides "KrispWebhookAuthKey=$WEBHOOK_AUTH_KEY" \
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
KRISP_WEBHOOK_AUTH_KEY=$WEBHOOK_AUTH_KEY
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

# Configure MCP for Claude Desktop
configure_claude_desktop() {
    local account_id=$(aws sts get-caller-identity --query Account --output text)
    local config_file="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
    local config_dir="$HOME/Library/Application Support/Claude"

    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  Configure Claude Desktop MCP"
    echo "═══════════════════════════════════════════════════════════"
    echo ""

    # Check if Claude Desktop is installed
    if [ ! -d "$config_dir" ]; then
        echo -e "${YELLOW}Claude Desktop config directory not found.${NC}"
        echo "  Skipping auto-configuration."
        echo "  Install Claude Desktop from: https://claude.ai/download"
        return
    fi

    read -p "Auto-configure Claude Desktop with krisp MCP server? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "  Skipping Claude Desktop configuration."
        return
    fi

    # Build the MCP config
    local mcp_config=$(cat << EOF
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
        "AWS_PROFILE": "${AWS_PROFILE:-default}"
      }
    }
  }
}
EOF
)

    # Check if config file exists
    if [ -f "$config_file" ]; then
        # Backup existing config
        cp "$config_file" "${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
        echo "  Backed up existing config"

        # Check if krisp is already configured
        if grep -q '"krisp"' "$config_file" 2>/dev/null; then
            echo -e "${YELLOW}  krisp MCP server already in config. Updating...${NC}"
        fi

        # Merge configs using Python (handles JSON properly)
        python3 << PYTHON
import json
import sys

config_file = "$config_file"
new_server = json.loads('''$mcp_config''')

try:
    with open(config_file, 'r') as f:
        existing = json.load(f)
except:
    existing = {}

if 'mcpServers' not in existing:
    existing['mcpServers'] = {}

existing['mcpServers']['krisp'] = new_server['mcpServers']['krisp']

with open(config_file, 'w') as f:
    json.dump(existing, f, indent=2)

print("  Config updated successfully")
PYTHON
    else
        # Create new config file
        echo "$mcp_config" > "$config_file"
        echo "  Config file created"
    fi

    echo -e "${GREEN}✓ Claude Desktop configured${NC}"
    echo ""
    echo -e "${YELLOW}  Restart Claude Desktop to load the krisp MCP server.${NC}"
}

# Configure MCP for Claude Code
configure_claude_code() {
    local account_id=$(aws sts get-caller-identity --query Account --output text)

    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  Configure Claude Code MCP"
    echo "═══════════════════════════════════════════════════════════"
    echo ""

    # Check if claude CLI is installed
    if ! command -v claude >/dev/null 2>&1; then
        echo -e "${YELLOW}Claude Code CLI not found.${NC}"
        echo "  Skipping auto-configuration."
        echo "  Install from: https://docs.anthropic.com/en/docs/claude-code"
        return
    fi

    read -p "Auto-configure Claude Code with krisp MCP server? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "  Skipping Claude Code configuration."
        return
    fi

    # Check if krisp is already configured
    if claude mcp list 2>/dev/null | grep -q "krisp"; then
        echo "  Removing existing krisp MCP server..."
        claude mcp remove krisp --scope user 2>/dev/null || true
    fi

    # Add the MCP server
    claude mcp add --transport stdio \
        --env "AWS_REGION=$AWS_REGION" \
        --env "KRISP_S3_BUCKET=krisp-transcripts-${account_id}" \
        --env "DYNAMODB_TABLE=krisp-transcripts-index" \
        --env "VECTOR_BUCKET=krisp-vectors-${account_id}" \
        --env "VECTOR_INDEX=transcript-chunks" \
        --env "AWS_PROFILE=${AWS_PROFILE:-default}" \
        --scope user \
        krisp -- node "$INSTALL_DIR/lambda/mcp-server-ts/dist/stdio-server.cjs"

    echo -e "${GREEN}✓ Claude Code configured${NC}"
}

# Deploy Admin Dashboard (Optional)
deploy_admin_dashboard() {
    local account_id=$(aws sts get-caller-identity --query Account --output text)

    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  Optional: Admin Dashboard"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "The admin dashboard is a web UI for browsing transcripts,"
    echo "searching meetings, and managing speakers."
    echo ""
    echo "Features:"
    echo "  • Browse all transcripts with search"
    echo "  • Semantic AI search across meetings"
    echo "  • Speaker management"
    echo "  • Password protected (SSL included)"
    echo ""
    echo "Requirements:"
    echo "  • Docker (for building the image)"
    echo "  • Adds ~\$5-10/month (AWS App Runner)"
    echo ""

    read -p "Deploy admin dashboard? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "  Skipping admin dashboard."
        ADMIN_DEPLOYED=false
        return
    fi

    # Check for Docker
    echo ""
    echo "→ Checking for Docker..."
    if ! command -v docker >/dev/null 2>&1; then
        echo -e "${RED}❌ Docker not found${NC}"
        echo ""
        echo "Docker is required to build the admin dashboard."
        echo "Install Docker from: https://docker.com/get-started"
        echo ""
        echo "Skipping admin dashboard deployment."
        ADMIN_DEPLOYED=false
        return
    fi

    # Check if Docker daemon is running
    if ! docker info >/dev/null 2>&1; then
        echo -e "${RED}❌ Docker daemon not running${NC}"
        echo ""
        echo "Please start Docker Desktop and try again."
        echo ""
        echo "Skipping admin dashboard deployment."
        ADMIN_DEPLOYED=false
        return
    fi
    echo -e "${GREEN}✓ Docker available${NC}"

    # Generate admin password
    ADMIN_PASSWORD=$(generate_auth_key)
    echo ""
    echo "→ Generated admin password"

    # Create ECR repository
    echo "→ Creating ECR repository..."
    local ecr_repo="${STACK_NAME}-admin"

    # Check if repo exists, create if not
    if ! aws ecr describe-repositories --repository-names "$ecr_repo" --region "$AWS_REGION" >/dev/null 2>&1; then
        aws ecr create-repository \
            --repository-name "$ecr_repo" \
            --region "$AWS_REGION" \
            --image-scanning-configuration scanOnPush=true >/dev/null
    fi

    local ecr_uri="${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ecr_repo}"
    echo -e "${GREEN}✓ ECR repository ready: $ecr_repo${NC}"

    # Login to ECR
    echo "→ Logging into ECR..."
    aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com" >/dev/null 2>&1
    echo -e "${GREEN}✓ ECR login successful${NC}"

    # Build Docker image
    echo "→ Building admin dashboard (this may take a few minutes)..."
    cd "$INSTALL_DIR"

    docker build \
        --build-arg SITE_PASSWORD="$ADMIN_PASSWORD" \
        --build-arg KRISP_S3_BUCKET="krisp-transcripts-${account_id}" \
        --build-arg DYNAMODB_TABLE="krisp-transcripts-index" \
        --build-arg VECTOR_BUCKET="krisp-vectors-${account_id}" \
        --build-arg VECTOR_INDEX="transcript-chunks" \
        --build-arg APP_REGION="$AWS_REGION" \
        -t "${ecr_uri}:latest" \
        -f Dockerfile . \
        --quiet

    echo -e "${GREEN}✓ Docker image built${NC}"

    # Push to ECR
    echo "→ Pushing image to ECR..."
    docker push "${ecr_uri}:latest" --quiet
    echo -e "${GREEN}✓ Image pushed to ECR${NC}"

    # Deploy CloudFormation for admin dashboard
    echo "→ Deploying admin dashboard infrastructure..."
    aws cloudformation deploy \
        --template-file cloudformation-admin.yaml \
        --stack-name "${STACK_NAME}-admin" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$AWS_REGION" \
        --parameter-overrides \
            "ProjectName=$STACK_NAME" \
            "SitePassword=$ADMIN_PASSWORD" \
            "ImageUri=${ecr_uri}:latest" \
            "TranscriptsBucket=krisp-transcripts-${account_id}" \
            "DynamoDBTable=krisp-transcripts-index" \
            "VectorBucket=krisp-vectors-${account_id}" \
            "VectorIndex=transcript-chunks" \
        --no-fail-on-empty-changeset

    # Get admin dashboard URL
    ADMIN_URL=$(aws cloudformation describe-stacks \
        --stack-name "${STACK_NAME}-admin" \
        --query "Stacks[0].Outputs[?OutputKey=='AdminDashboardUrl'].OutputValue" \
        --output text \
        --region "$AWS_REGION")

    echo -e "${GREEN}✓ Admin dashboard deployed${NC}"

    # Save admin config
    cat >> .env.local << EOF

# Admin Dashboard
ADMIN_URL=$ADMIN_URL
ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF

    ADMIN_DEPLOYED=true
}

# Print completion message
print_completion() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✓ Keep It Krispy Installed Successfully!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${CYAN}WEBHOOK CONFIGURATION (add to Krisp settings):${NC}"
    echo ""
    echo "  Webhook URL:"
    echo "    $WEBHOOK_URL"
    echo ""
    echo "  Authorization Header (required):"
    echo "    Header Name:  Authorization"
    echo "    Header Value: $WEBHOOK_AUTH_KEY"
    echo ""
    echo -e "${YELLOW}  ⚠ Keep your auth key secret! Only your Krisp app should know it.${NC}"
    echo ""
    echo -e "${CYAN}NEXT STEPS:${NC}"
    echo ""
    echo "  1. Configure Krisp webhook:"
    echo "     Open Krisp → Settings → Integrations → Webhooks"
    echo "     • Webhook URL: paste the URL above"
    echo "     • Request Headers: click '+' to add header"
    echo "       - Name: Authorization"
    echo "       - Value: paste the auth key above"
    echo ""
    echo "  2. Restart Claude Desktop (if configured above)"
    echo ""
    echo "  3. Have a meeting! Transcripts will auto-index."
    echo ""
    echo "  4. Ask Claude: \"What was my last meeting about?\""
    echo ""
    # Show admin dashboard info if deployed
    if [ "$ADMIN_DEPLOYED" = true ]; then
        echo -e "${CYAN}ADMIN DASHBOARD:${NC}"
        echo ""
        echo "  URL:      $ADMIN_URL"
        echo "  Password: $ADMIN_PASSWORD"
        echo ""
        echo -e "${YELLOW}  ⚠ Save your admin password! It's also in .env.local${NC}"
        echo ""
    fi

    echo -e "${CYAN}SAVED CONFIG:${NC}"
    echo "  All credentials saved to: $INSTALL_DIR/.env.local"
    echo ""
    echo -e "${CYAN}DOCUMENTATION:${NC}"
    echo "  https://krispy.alpha-pm.dev"
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
    configure_claude_desktop
    configure_claude_code
    deploy_admin_dashboard
    print_completion
}

main "$@"
