#!/bin/bash
# Keep It Krispy - MCP Server Installer
# Installs the MCP server for Claude Desktop and Claude Code
# Connects to the Keep It Krispy SaaS at app.krispy.alpha-pm.dev
# https://github.com/dwinter3/keep-it-krispy

set -e

REPO_URL="https://github.com/dwinter3/keep-it-krispy.git"
INSTALL_DIR="${KRISP_INSTALL_DIR:-$HOME/keep-it-krispy}"

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
    echo "  ║   MCP Server Installer                ║"
    echo "  ╚═══════════════════════════════════════╝"
    echo ""
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*) echo "macos" ;;
        Linux*)  echo "linux" ;;
        MINGW*|CYGWIN*|MSYS*) echo "windows" ;;
        *) echo "unknown" ;;
    esac
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

    # Check npm
    echo -n "  npm..."
    if command -v npm >/dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC} ($(npm --version))"
    else
        echo -e " ${RED}✗${NC}"
        missing+=("npm")
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        echo ""
        echo -e "${RED}❌ Missing prerequisites:${NC}"
        for pkg in "${missing[@]}"; do
            case $pkg in
                git) echo "  • Git: https://git-scm.com/downloads" ;;
                node*) echo "  • Node.js 18+: https://nodejs.org/" ;;
                npm) echo "  • npm: comes with Node.js" ;;
            esac
        done
        exit 1
    fi

    echo ""
    echo -e "${GREEN}✓ All prerequisites met${NC}"
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

# Build MCP server
build_mcp_server() {
    echo ""
    echo "→ Building MCP server..."

    cd "$INSTALL_DIR/lambda/mcp-server-ts"
    npm install --silent 2>/dev/null || npm install
    npm run build:stdio

    echo -e "${GREEN}✓ MCP server built${NC}"
}

# Get user credentials
get_user_credentials() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  Account Setup"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "To connect the MCP server to your Keep It Krispy account,"
    echo "you need your User ID from the dashboard."
    echo ""
    echo -e "${CYAN}1. Sign in at: https://app.krispy.alpha-pm.dev${NC}"
    echo -e "${CYAN}2. Go to Settings to find your User ID${NC}"
    echo ""

    read -p "Enter your User ID (e.g., usr_abc123): " USER_ID

    if [ -z "$USER_ID" ]; then
        echo -e "${RED}❌ User ID is required${NC}"
        echo ""
        echo "Sign up or sign in at: https://app.krispy.alpha-pm.dev"
        echo "Then run this installer again."
        exit 1
    fi

    # Validate format (basic check)
    if [[ ! "$USER_ID" =~ ^usr_ ]]; then
        echo -e "${YELLOW}⚠ User ID usually starts with 'usr_'. Continuing anyway...${NC}"
    fi

    echo ""
    echo -e "${GREEN}✓ User ID: $USER_ID${NC}"
}

# Configure MCP for Claude Desktop
configure_claude_desktop() {
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
        "AWS_REGION": "us-east-1",
        "KRISP_S3_BUCKET": "krisp-transcripts-754639201213",
        "DYNAMODB_TABLE": "krisp-transcripts-index",
        "VECTOR_BUCKET": "krisp-vectors-754639201213",
        "VECTOR_INDEX": "transcript-chunks",
        "ENTITIES_TABLE": "krisp-entities",
        "RELATIONSHIPS_TABLE": "krisp-relationships",
        "KRISP_USER_ID": "$USER_ID"
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
        --env "AWS_REGION=us-east-1" \
        --env "KRISP_S3_BUCKET=krisp-transcripts-754639201213" \
        --env "DYNAMODB_TABLE=krisp-transcripts-index" \
        --env "VECTOR_BUCKET=krisp-vectors-754639201213" \
        --env "VECTOR_INDEX=transcript-chunks" \
        --env "ENTITIES_TABLE=krisp-entities" \
        --env "RELATIONSHIPS_TABLE=krisp-relationships" \
        --env "KRISP_USER_ID=$USER_ID" \
        --scope user \
        krisp -- node "$INSTALL_DIR/lambda/mcp-server-ts/dist/stdio-server.cjs"

    echo -e "${GREEN}✓ Claude Code configured${NC}"
}

# Print completion message
print_completion() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✓ Keep It Krispy MCP Server Installed!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${CYAN}NEXT STEPS:${NC}"
    echo ""
    echo "  1. Restart Claude Desktop (Cmd+Q, then reopen)"
    echo ""
    echo "  2. Configure Krisp webhooks in the dashboard:"
    echo "     https://app.krispy.alpha-pm.dev/settings"
    echo ""
    echo "  3. Have a meeting! Transcripts will auto-sync."
    echo ""
    echo "  4. Ask Claude: \"What was my last meeting about?\""
    echo ""
    echo -e "${CYAN}INSTALLED FILES:${NC}"
    echo "  MCP Server: $INSTALL_DIR/lambda/mcp-server-ts/dist/stdio-server.cjs"
    echo ""
    echo -e "${CYAN}DASHBOARD:${NC}"
    echo "  https://app.krispy.alpha-pm.dev"
    echo ""
    echo -e "${CYAN}DOCUMENTATION:${NC}"
    echo "  https://krispy.alpha-pm.dev"
    echo ""
}

# Main
main() {
    print_header
    check_prereqs
    clone_repo
    build_mcp_server
    get_user_credentials
    configure_claude_desktop
    configure_claude_code
    print_completion
}

main "$@"
