# Cosmic CLI

AI-powered command-line interface for [Cosmic CMS](https://www.cosmicjs.com). Manage your content, media, workflows, and AI agents through natural language and direct commands.

## Features

- **AI-Powered Chat Mode** - Interact with your content using natural language
- **Direct Commands** - Full CRUD for objects, media, workflows, and agents
- **Multiple Auth Methods** - User login (JWT) or bucket keys
- **Context Management** - Switch between workspaces, projects, and buckets
- **AI Generation** - Generate text and images directly from the CLI

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
cosmic agents create --type=content  # Create agent
cosmic agents run <id>               # Run agent
cosmic agents executions <agentId>   # List agent executions
```

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
cosmic objects update abc123 --content="Updated content"
cosmic objects publish abc123
```

### Workflow Automation

```bash
# List active workflows
cosmic workflows list --status=active

# Run a workflow with inputs
cosmic workflows run weekly-newsletter --inputs='{"topic":"AI updates"}'

# Check execution status
cosmic workflows executions --workflow-id=abc123
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
