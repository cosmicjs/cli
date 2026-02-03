# Cosmic CLI

AI-powered command-line interface for [Cosmic CMS](https://www.cosmicjs.com). Manage your content, media, repositories, deployments, workflows, and AI agents through natural language and direct commands.

## Features

- **AI-Powered Chat Mode** - Interact with your content using natural language
- **Shortcut Commands** - `content`, `build`, and `update` for common AI workflows
- **Direct Commands** - Full CRUD for objects, media, repos, workflows, and agents
- **Repository & Deploy** - Connect GitHub repos and deploy to Vercel
- **Multiple Auth Methods** - User login (JWT) or bucket keys
- **Context Management** - Navigate workspaces, projects, and buckets like a filesystem
- **AI Generation** - Generate text and images with streaming output
- **AI Agents** - Content, repository, and computer use agents with scheduling
- **Auth Capture** - Capture browser auth locally for computer use agents

> **Full Reference:** See [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md) for complete command documentation.

## Installation

```bash
# Install globally with npm
npm install -g @cosmicjs/cli

# Or with bun
bun add -g @cosmicjs/cli
```

## Quick Start

```bash
# Login to your Cosmic account
cosmic login

# Set your working context
cosmic use my-workspace/my-project/my-bucket

# Start interactive chat mode
cosmic chat

# Or use shortcut commands
cosmic content              # Create/manage content with AI
cosmic build                # Build a new app with AI
cosmic update my-repo       # Update existing code with AI
```

## Authentication

### User Authentication

Login with your Cosmic account for full dashboard access:

```bash
cosmic login
cosmic whoami               # Show current user
cosmic logout               # Clear credentials
```

### Bucket Key Authentication

For quick bucket-level access without logging in:

```bash
cosmic use --bucket=my-bucket --read-key=your-read-key --write-key=your-write-key
```

## Core Commands

### Context & Navigation

```bash
# Set working context
cosmic use <workspace>/<project>/<bucket>
cosmic context                      # Show current context

# Navigate like a filesystem
cosmic ls                           # List contents at current level
cosmic cd my-project                # Navigate into project
cosmic cd my-bucket                 # Navigate into bucket
cosmic cd posts                     # Navigate into object type
cosmic cd ..                        # Go up one level
cosmic pwd                          # Show current location
```

### Objects

```bash
cosmic objects list                          # List objects
cosmic objects list --type=posts             # Filter by type
cosmic objects list --status=draft           # Filter by status
cosmic objects get <id>                      # Get object details
cosmic objects create --type=posts           # Create object (interactive)
cosmic objects update <id> --title="New"     # Update object
cosmic objects delete <id>                   # Delete object
cosmic objects publish <id>                  # Publish object
cosmic objects types                         # List object types
```

### Media

```bash
cosmic media list                    # List media files
cosmic media list --folder=images    # Filter by folder
cosmic media get <id>                # Get media details
cosmic media upload ./image.png      # Upload file
cosmic media delete <id>             # Delete media
```

### Repositories

```bash
cosmic repos list                              # List connected repos
cosmic repos get <id>                          # Get repo details
cosmic repos connect --url <github-url>        # Connect a GitHub repo
cosmic repos delete <id>                       # Disconnect repo

# Branch management
cosmic repos branches <repoId> list            # List branches
cosmic repos branches <repoId> create          # Create branch
cosmic repos branches <repoId> delete <name>   # Delete branch
```

### Deployments

```bash
cosmic deploy start <repoId>                   # Deploy to Vercel
cosmic deploy start <repoId> --watch           # Deploy and watch progress
cosmic deploy list <repoId>                    # List deployments
cosmic deploy logs <deploymentId>              # Get logs
cosmic deploy logs <deploymentId> --follow     # Stream logs
cosmic deploy cancel <repoId> <deploymentId>   # Cancel deployment
```

### Workflows

```bash
cosmic workflows list                          # List workflows
cosmic workflows get <id>                      # Get workflow details
cosmic workflows create --agent <agentId>      # Create with initial agent
cosmic workflows add-step <id> --agent <id>    # Add agent as step
cosmic workflows remove-step <id> --step 2     # Remove step
cosmic workflows run <id>                      # Execute workflow
cosmic workflows executions                    # List executions
cosmic workflows executions <execId>           # Get execution details
cosmic workflows cancel <execId>               # Cancel execution
```

### Agents

```bash
cosmic agents list                   # List agents
cosmic agents get <id>               # Get agent details
cosmic agents create --type=content  # Create agent (interactive)
cosmic agents run <id>               # Run agent
cosmic agents executions <agentId>   # List executions
cosmic agents delete <id>            # Delete agent

# Advanced agent operations
cosmic agents follow-up <agentId>              # Continue work on same branch
cosmic agents pr <agentId>                     # Create PR from agent work
cosmic agents approve <agentId> <execId>       # Approve pending operations
cosmic agents capture-auth --url <login-url>   # Capture browser auth
```

#### Agent Types

| Type | Alias | Description |
|------|-------|-------------|
| `content` | - | Creates and manages content in your bucket |
| `repository` | `code`, `repo` | Makes code changes to connected repositories |
| `computer_use` | - | Browser automation with AI vision |

### AI Generation

```bash
cosmic ai generate "Your prompt"               # Generate text (streaming)
cosmic ai generate "prompt" --model=gpt-5      # Specify model
cosmic ai image "A sunset over mountains"      # Generate image
cosmic ai image "prompt" --folder=heroes       # Save to folder
cosmic ai chat "Tell me about my content"      # Single chat message
```

## Shortcut Commands

These shortcuts make common AI workflows faster:

### Content Mode

Create and manage content with AI assistance:

```bash
cosmic content                                 # Start content chat
cosmic content -p "Create 5 blog posts"        # With initial prompt
cosmic content --types posts,authors           # Include specific object types
cosmic content --ask                           # Read-only mode (no changes)
```

### Build Mode

Generate complete applications:

```bash
cosmic build                                   # Start build chat (interactive)
cosmic build -p "A blog with dark mode"        # With description
cosmic build --types posts                     # Include content as context
cosmic build --ask                             # Ask questions without generating
```

### Update Mode

Modify existing repository code:

```bash
cosmic update                                  # Select repo interactively
cosmic update my-repo                          # Specify repo
cosmic update my-repo -b feature-branch        # Specify branch
cosmic update my-repo -p "Add dark mode"       # With instructions
cosmic update --ask                            # Explore code without changes
```

## Interactive Chat Mode

Start an interactive AI chat session:

```bash
cosmic chat                  # Default ask mode (read-only)
cosmic chat --content        # Content mode (can modify content)
cosmic chat --build          # Build mode (generate apps)
cosmic chat --repo           # Repository mode (code changes)
```

### Context Options

Provide context to the AI:

```bash
cosmic chat --types posts,authors              # Include object types
cosmic chat --links "https://docs.example.com" # Include external URLs
cosmic chat --objects-limit 50                 # Max objects per type
cosmic chat --objects-depth 2                  # Nested metafield depth
```

### Chat Commands

Inside chat mode:
- `exit` / `quit` - Exit chat
- `clear` - Clear conversation history
- `context` - Show current context
- `help` - Show available commands

## Configuration

```bash
cosmic config get                    # Show all config
cosmic config get defaultModel       # Get specific value
cosmic config set defaultModel gpt-5 # Set value
```

### Config Options

| Option | Description |
|--------|-------------|
| `defaultModel` | Default AI model for generation |
| `apiUrl` | Custom API URL |
| `sdkUrl` | Custom SDK URL (for local development) |

Configuration stored in `~/.cosmic/`:
- `config.json` - Settings
- `credentials.json` - Auth tokens

## AI Models

```bash
cosmic models                        # List all available models
```

Set your default model:

```bash
cosmic config set defaultModel claude-opus-4-5-20251101
```

Or specify per-command:

```bash
cosmic ai generate --model=gpt-5 "Your prompt"
```

**Available models:**
- **Claude (Anthropic):** `claude-opus-4-5-20251101`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`
- **GPT (OpenAI):** `gpt-5`, `gpt-5.2`, `gpt-5-mini`, `gpt-4o`
- **Gemini (Google):** `gemini-3-pro-preview`

## Examples

### Build and Deploy an App

```bash
# Build a new app
cosmic build -p "A recipe blog with categories and search"

# Connect the generated repo
cosmic repos connect --url https://github.com/myuser/recipe-blog

# Deploy to Vercel
cosmic deploy start <repoId> --watch
```

### Agent Workflow

```bash
# Create a scheduled content agent
cosmic agents create \
  --type content \
  --name "Weekly Roundup" \
  --prompt "Create a weekly summary of new products" \
  --schedule \
  --schedule-frequency weekly

# Create a repository agent
cosmic agents create \
  --type repo \
  --name "Bug Fixer" \
  --prompt "Fix the accessibility issues" \
  --run

# Create PR from agent's work
cosmic agents pr <agentId>
```

### Computer Use Agent with Auth

```bash
# Capture authentication
cosmic agents capture-auth --url https://dashboard.example.com/login
# (Browser opens, log in, click "Done - Capture Auth")
# Returns session ID: abc123...

# Create agent with pre-captured auth
cosmic agents create \
  --type computer_use \
  --name "Dashboard Reporter" \
  --start-url "https://dashboard.example.com" \
  --prompt "Screenshot the weekly metrics" \
  --auth-session abc123...
```

### Multi-Step Workflow

```bash
# Create workflow with initial agent
cosmic workflows create --name "Content Pipeline" --agent writer-id

# Add more steps
cosmic workflows add-step <workflowId> --agent editor-id
cosmic workflows add-step <workflowId> --agent publisher-id

# Execute
cosmic workflows run <workflowId>

# Monitor
cosmic workflows executions <executionId>
```

## Global Options

All commands support:

```bash
--json          # Output as JSON (for scripting)
--verbose, -v   # Enable verbose output
--no-color      # Disable colored output
```

## Environment Variables

```bash
COSMIC_DEBUG=1  # Enable debug output
```

## Development

```bash
git clone https://github.com/cosmicjs/cli.git
cd cli
bun install
bun run build
bun run dev
```

## Support

- [Cosmic Documentation](https://www.cosmicjs.com/docs)
- [Full CLI Reference](docs/CLI_REFERENCE.md)
- [Discord Community](https://discord.gg/MSCwQ7D6Mg)
- [GitHub Issues](https://github.com/cosmicjs/cli/issues)

## License

MIT License - see [LICENSE](LICENSE) for details.
