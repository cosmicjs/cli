# Cosmic CLI

AI-powered command-line interface for [Cosmic CMS](https://www.cosmicjs.com). Manage your content, media, workflows, and AI agents through natural language and direct commands.

## Features

- **AI-Powered Chat Mode** - Interact with your content using natural language
- **Direct Commands** - Full CRUD for objects, media, workflows, and agents
- **Multiple Auth Methods** - User login (JWT) or bucket keys
- **Context Management** - Switch between workspaces, projects, and buckets
- **AI Generation** - Generate text and images directly from the CLI
- **AI Agents** - Content, repository, and computer use agents with scheduling
- **Auth Capture** - Capture browser auth locally for computer use agents

## Installation

```bash
# Install globally
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
cosmic
```

## Authentication

### User Authentication

Login with your Cosmic account for full dashboard access:

```bash
cosmic login
```

### Bucket Key Authentication

For quick bucket-level access without logging in:

```bash
cosmic use --bucket=my-bucket --read-key=your-read-key --write-key=your-write-key
```

## Commands

### Auth

```bash
cosmic login                # Login to Cosmic
cosmic logout               # Clear credentials
cosmic whoami               # Show current user
```

### Context

```bash
cosmic use <ws>/<proj>/<bucket>    # Set working context
cosmic context                      # Show current context
cosmic workspaces                   # List workspaces
cosmic projects                     # List projects
cosmic models                       # List available AI models
```

### Navigation

Navigate your Cosmic content like a filesystem:

```bash
cosmic pwd                    # Show current location
cosmic ls                     # List contents at current level
cosmic ls /                   # List all projects
cosmic ls /project-id         # List buckets in project
cosmic ls /project/bucket     # List object types in bucket
cosmic cd project-id          # Navigate into a project
cosmic cd bucket-slug         # Navigate into a bucket
cosmic cd posts               # Navigate into an object type
cosmic cd ..                  # Go up one level
cosmic cd /                   # Go to root (home)
```

#### Navigation Hierarchy

```
/ (root)
└── project-id/
    └── bucket-slug/
        └── object-type/
            └── objects...
```

Example workflow:

```bash
$ cosmic ls
    Projects
    ────────────────────────────────────────────────────────
    📁  my-project              My Project              3 buckets

$ cosmic cd my-project
  ✓ Now in Project: My Project

$ cosmic ls
    Buckets in My Project
    ────────────────────────────────────────────────────────
    📦  production
        Production (42 objects)

    📦  staging
        Staging (15 objects)

$ cosmic cd production
  ✓ Now in Bucket: Production

$ cosmic ls
    Object Types in production
    ────────────────────────────────────────────────────────
    📄  posts                   Blog Posts              12 objects
    📄  authors                 Authors                 3 objects

$ cosmic cd ..
  ✓ Now in Project: My Project
```

### Objects

```bash
cosmic objects list                          # List objects
cosmic objects list --type=posts             # Filter by type
cosmic objects list --status=draft           # Filter by status
cosmic objects get <id>                      # Get object details
cosmic objects create --type=posts           # Create object
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

### Workflows

```bash
cosmic workflows list                      # List workflows
cosmic workflows get <id>                  # Get workflow details
cosmic workflows create --agent <agentId>  # Create workflow with initial agent
cosmic workflows add-step <id> --agent <agentId>  # Add agent as step
cosmic workflows remove-step <id> --step 2        # Remove step by number
cosmic workflows run <id>                  # Execute workflow
cosmic workflows executions                # List executions
cosmic workflows cancel <id>               # Cancel execution
```

### Agents

```bash
cosmic agents list                   # List agents
cosmic agents get <id>               # Get agent details
cosmic agents create --type=content  # Create content agent
cosmic agents run <id>               # Run agent
cosmic agents executions <agentId>   # List agent executions
cosmic agents delete <id>            # Delete agent
```

#### Agent Types

- **content** - Creates and manages content in your bucket
- **repository** - Makes code changes to connected repositories  
- **computer_use** - Browser automation with AI vision

#### Creating Agents

```bash
# Content agent
cosmic agents create \
  --type content \
  --name "Blog Writer" \
  --prompt "Write engaging blog posts about technology"

# Repository agent (code changes)
cosmic agents create \
  --type repository \
  --name "Bug Fixer" \
  --prompt "Fix the bug described in the issue"

# Computer use agent (browser automation)
cosmic agents create \
  --type computer_use \
  --name "Web Scraper" \
  --start-url "https://example.com" \
  --prompt "Extract the main content from the page"
```

#### Scheduling Agents

Run agents on a schedule:

```bash
cosmic agents create \
  --type content \
  --name "Daily News Digest" \
  --prompt "Create a summary of today's tech news" \
  --schedule \
  --schedule-frequency daily \
  --timezone "America/New_York"
```

Schedule options:
- `--schedule` - Enable scheduling
- `--schedule-type` - `once` or `recurring` (default: recurring)
- `--schedule-frequency` - `hourly`, `daily`, `weekly`, `monthly`
- `--timezone` - Timezone for schedule (default: UTC)

### Auth Capture (for Computer Use Agents)

Capture authentication from your local browser for use with computer use agents:

```bash
# Open browser, log in manually, then click "Done - Capture Auth"
cosmic agents capture-auth --url https://example.com/login

# Returns a session ID like: a1b2c3d4-5678-90ab-cdef-1234567890ab
```

Use the captured auth session when creating a computer use agent:

```bash
cosmic agents create \
  --type computer_use \
  --name "Dashboard Bot" \
  --start-url "https://example.com/dashboard" \
  --prompt "Check the analytics and report key metrics" \
  --auth-session a1b2c3d4-5678-90ab-cdef-1234567890ab
```

This allows agents to access authenticated pages without handling login flows.

### AI Generation

```bash
cosmic ai generate "Write a blog post about AI"   # Generate text
cosmic ai image "Mountain landscape at sunset"    # Generate image
cosmic ai chat "Tell me about my content"         # Single chat message
```

### Configuration

```bash
cosmic config get                               # Show all config
cosmic config get defaultModel                  # Get specific value
cosmic config set defaultModel gpt-5            # Set config value
```

## Interactive Chat Mode

Run `cosmic` without arguments to start the interactive AI chat:

```
$ cosmic

  Cosmic CLI v1.0.0
  Logged in as: tony@cosmic.com
  Context: my-workspace / my-project / my-bucket

> list all blog posts

  Found 5 posts:
  1. "Welcome Post" (published)
  2. "Product Update" (draft)
  ...

> publish post 2

  ✓ Published "Product Update"

> create a new post titled "Hello World"

  ✓ Created post "Hello World" (draft)

> exit
```

### Chat Modes

```bash
cosmic chat              # Default ask mode (read-only)
cosmic chat --content    # Content mode (can create/update content)
cosmic chat --build      # Build mode (for app development)
cosmic chat --repo       # Repository mode (for code changes)
```

### Chat Commands

- `exit` / `quit` - Exit chat mode
- `clear` - Clear conversation history
- `context` - Show current context
- `help` - Show help

## Configuration Files

Configuration is stored in `~/.cosmic/`:

- `config.json` - Settings (current context, default model, etc.)
- `credentials.json` - Authentication tokens

## AI Models

The CLI supports all Cosmic AI models. Set your default:

```bash
cosmic config set defaultModel claude-opus-4-5-20251101
```

Or specify per-command:

```bash
cosmic ai generate --model=gpt-5 "Your prompt"
```

Available models include:

- Claude (Anthropic): `claude-opus-4-5-20251101`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`
- GPT (OpenAI): `gpt-5`, `gpt-5.2`, `gpt-5-mini`, `gpt-4o`
- Gemini (Google): `gemini-3-pro-preview`

Use `cosmic models` to see all available models.

## Examples

### Content Management

```bash
# List all published posts
cosmic objects list --type=posts --status=published

# Create a new blog post
cosmic objects create --type=posts --title="My New Post" --status=draft

# Update and publish
cosmic objects update abc123 --metadata '{"content":"Updated content"}'
cosmic objects publish abc123
```

### Workflow Automation

```bash
# Create a multi-step workflow
cosmic workflows create --name "Content Pipeline" --agent writer-agent-id
cosmic workflows add-step pipeline-id --agent editor-agent-id
cosmic workflows add-step pipeline-id --agent publisher-agent-id

# Run a workflow
cosmic workflows run pipeline-id

# Check execution status
cosmic workflows executions pipeline-id
```

### Agent Automation

```bash
# Create a scheduled content agent
cosmic agents create \
  --type content \
  --name "Weekly Roundup" \
  --prompt "Create a weekly summary of new products" \
  --schedule \
  --schedule-frequency weekly

# Create a computer use agent with pre-captured auth
cosmic agents capture-auth --url https://analytics.example.com/login
# (log in manually, click Done)
# Session ID: abc123...

cosmic agents create \
  --type computer_use \
  --name "Analytics Reporter" \
  --start-url "https://analytics.example.com/dashboard" \
  --prompt "Screenshot the weekly metrics and create a summary" \
  --auth-session abc123...
```

### AI-Assisted Content

```bash
# Generate text content
cosmic ai generate "Write a product description for a coffee mug" --model=claude-sonnet-4-5-20250929

# Generate and save an image
cosmic ai image "Professional headshot placeholder" --folder=avatars

# Interactive content creation
cosmic
> generate 5 blog post ideas about web development
> create a post from idea 3
> add a hero image for it
```

## Development

```bash
# Clone the repo
git clone https://github.com/cosmicjs/cli.git
cd cli

# Install dependencies
bun install

# Build
bun run build

# Run in development
bun run dev
```

## Support

- [Cosmic Documentation](https://www.cosmicjs.com/docs)
- [Discord Community](https://discord.gg/MSCwQ7D6Mg)
- [GitHub Issues](https://github.com/cosmicjs/cli/issues)

## License

MIT License - see [LICENSE](LICENSE) for details.
