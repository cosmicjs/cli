# Cosmic CLI - Full Reference

Complete command reference for the Cosmic CLI. For a quick overview, see the [README](../README.md).

## Table of Contents

- [Interactive Shell](#interactive-shell)
- [Global Options](#global-options)
- [Authentication](#authentication)
- [Context & Navigation](#context--navigation)
- [Objects](#objects)
- [Types](#types)
- [Media](#media)
- [Repositories](#repositories)
- [Deployments](#deployments)
- [Webhooks](#webhooks)
- [Team](#team)
- [Domains](#domains)
- [Workflows](#workflows)
- [Agents](#agents)
- [AI Generation](#ai-generation)
- [Interactive Chat](#interactive-chat)
- [Shortcut Commands](#shortcut-commands)
- [Configuration](#configuration)
- [Command Aliases](#command-aliases)

---

## Interactive Shell

### `cosmic shell`

Start an interactive shell session where you can run commands without the `cosmic` prefix.

```bash
cosmic shell
```

**Alias:** `cosmic sh`

#### Shell Session Example

```
$ cosmic shell

  Cosmic Shell v1.0.0
  Logged in as: you@example.com
  Context: my-workspace / my-project / production

  Type commands without "cosmic" prefix. Use "!" for system shell.
  Type "help" for commands, "exit" to quit.

cosmic my-workspace/production> ls
cosmic my-workspace/production> objects list
cosmic my-workspace/production> cd posts
cosmic my-workspace/production> !git status
cosmic my-workspace/production> exit
Goodbye!
$
```

#### Shell Features

| Feature | Description |
|---------|-------------|
| No prefix needed | Type `ls` instead of `cosmic ls` |
| System commands | Use `!` prefix for shell commands (`!ls`, `!git status`, etc.) |
| Dynamic prompt | Shows current workspace/bucket context |
| Command history | Use arrow keys to navigate command history |
| Context updates | Prompt updates when context changes (after `cd`, `use`, etc.) |

#### Shell Commands

| Command | Description |
|---------|-------------|
| `help` | Show available commands |
| `exit`, `quit` | Exit the shell |
| `!<command>` | Run system shell command |

#### Navigation Commands (in shell)

```bash
ls                    # List contents at current level
cd <path>             # Navigate to project/bucket/type
pwd                   # Show current location
use [workspace]       # Set workspace (or "-" for default)
context               # Show current context
```

#### Content Commands (in shell)

```bash
objects list          # List objects
objects get <id>      # Get object details
objects types         # List object types
media list            # List media files
```

#### AI Commands (in shell)

```bash
chat                  # Start AI chat
content               # Content mode chat
build                 # Build mode chat
update [repo]         # Update repo mode chat
ai generate <prompt>  # Generate text
ai image <prompt>     # Generate image
```

#### Other Commands (in shell)

```bash
types list            # List object types
agents list           # List agents
workflows list        # List workflows
repos list            # List repositories
webhooks list         # List webhooks
team list             # List team members
domains list          # List domains
```

---

## Global Options

These options work with all commands:

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON for scripting/automation |
| `-v, --verbose` | Enable verbose output |
| `--no-color` | Disable colored output |
| `--help` | Show help for command |
| `--version` | Show CLI version |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `COSMIC_DEBUG=1` | Enable debug output with detailed error information |

---

## Authentication

### `cosmic login`

Login to your Cosmic account. Opens browser for OAuth authentication.

```bash
cosmic login
```

### `cosmic logout`

Clear stored credentials.

```bash
cosmic logout
```

### `cosmic whoami`

Show current authenticated user.

```bash
cosmic whoami
```

---

## Context & Navigation

### `cosmic use`

Set the working context (workspace, project, bucket). Runs interactively to let you select from available options.

```bash
# Interactive selection
cosmic use

# Switch to a specific workspace
cosmic use <workspace-slug>

# Switch to default projects (no workspace)
cosmic use -
cosmic use --default

# With bucket keys (no login required)
cosmic use --bucket=<slug> --read-key=<key> --write-key=<key>
```

**Options:**
| Option | Description |
|--------|-------------|
| `-d, --default` | Switch to default projects (no workspace) |
| `--bucket <slug>` | Bucket slug |
| `--read-key <key>` | Bucket read key |
| `--write-key <key>` | Bucket write key |

### `cosmic context`

Show current working context.

```bash
cosmic context
```

### `cosmic workspaces`

List available workspaces.

```bash
cosmic workspaces
cosmic workspaces --json
```

### `cosmic projects`

List projects in current workspace.

```bash
cosmic projects
cosmic projects --json
```

### `cosmic models`

List available AI models.

```bash
cosmic models
cosmic models --json
```

### `cosmic ls`

List contents at current navigation level.

```bash
cosmic ls                     # List at current level
cosmic ls /                   # List all projects
cosmic ls /project-id         # List buckets in project
cosmic ls /project/bucket     # List object types in bucket
```

### `cosmic cd`

Navigate the content hierarchy.

```bash
cosmic cd project-id          # Navigate into project
cosmic cd bucket-slug         # Navigate into bucket
cosmic cd posts               # Navigate into object type
cosmic cd ..                  # Go up one level
cosmic cd /                   # Go to root
```

### `cosmic pwd`

Show current navigation location.

```bash
cosmic pwd
```

---

## Objects

### `cosmic objects list`

List objects in current bucket.

```bash
cosmic objects list
cosmic objects ls                            # Alias
cosmic objects list --props "id,title,type"  # Select specific fields
```

**Options:**
| Option | Description |
|--------|-------------|
| `-t, --type <slug>` | Filter by object type |
| `-s, --status <status>` | Filter by status (`published`, `draft`, `any`) |
| `-l, --limit <n>` | Limit results (default: 10) |
| `-p, --props <props>` | Properties to return (comma-separated, e.g. `"id,title,slug,metadata"`) |
| `-d, --depth <n>` | Depth for nested object references |
| `--skip <n>` | Skip results (for pagination) |
| `--json` | Output as JSON |

### `cosmic objects get`

Get object details.

```bash
cosmic objects get <id>
cosmic objects get <id> --json
cosmic objects get <id> --props "id,title,metadata" --depth 2
```

**Options:**
| Option | Description |
|--------|-------------|
| `-p, --props <props>` | Properties to return (comma-separated) |
| `-d, --depth <n>` | Depth for nested object references |
| `--json` | Output as JSON |

### `cosmic objects create`

Create a new object (interactive).

```bash
cosmic objects create
cosmic objects create --type=posts
cosmic objects create --type=posts --title="My Post"
```

**Options:**
| Option | Description |
|--------|-------------|
| `--type <slug>` | Object type slug |
| `--title <title>` | Object title |
| `--slug <slug>` | Object slug |
| `--status <status>` | Status (`published`, `draft`) |
| `--content <content>` | Content/body text |
| `--metadata <json>` | Metadata as JSON string |
| `--json` | Output as JSON |

### `cosmic objects update`

Update an existing object.

```bash
cosmic objects update <id> --title="New Title"
cosmic objects update <id> --metadata='{"key":"value"}'
```

**Options:**
| Option | Description |
|--------|-------------|
| `--title <title>` | New title |
| `--slug <slug>` | New slug |
| `--status <status>` | New status |
| `--content <content>` | New content |
| `--metadata <json>` | New metadata (JSON) |
| `--json` | Output as JSON |

### `cosmic objects delete`

Delete an object.

```bash
cosmic objects delete <id>
cosmic objects rm <id>                       # Alias
cosmic objects delete <id> --force           # Skip confirmation
```

### `cosmic objects publish`

Publish a draft object.

```bash
cosmic objects publish <id>
```

### `cosmic objects types`

List object types in current bucket.

```bash
cosmic objects types
cosmic objects types --json
```

---

## Types

### `cosmic types list`

List object types in current bucket.

```bash
cosmic types list
cosmic types ls                             # Alias
cosmic types list --json
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `cosmic types get`

Get object type details including metafields.

```bash
cosmic types get <slug>
cosmic types get posts --json
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `cosmic types create`

Create a new object type.

```bash
cosmic types create
cosmic types create --title "Blog Posts"
cosmic types create --title "Posts" --slug posts --emoji "📝"
cosmic types add                             # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `--title <title>` | Object type title |
| `--slug <slug>` | Object type slug (auto-generated from title) |
| `--singular <name>` | Singular display name |
| `--emoji <emoji>` | Emoji icon |
| `--singleton` | Create as singleton type |
| `--json` | Output as JSON |

### `cosmic types update`

Update an object type.

```bash
cosmic types update <slug> --title "New Title"
cosmic types update posts --emoji "✍️"
cosmic types edit posts --singular "Post"    # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `--title <title>` | New title |
| `--slug <slug>` | New slug |
| `--singular <name>` | New singular name |
| `--emoji <emoji>` | New emoji |
| `--singleton` | Set as singleton |
| `--no-singleton` | Unset singleton |
| `--json` | Output as JSON |

### `cosmic types delete`

Delete an object type and all its objects.

```bash
cosmic types delete <slug>
cosmic types rm <slug>                       # Alias
cosmic types delete <slug> --force           # Skip confirmation
```

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --force` | Skip confirmation |

### `cosmic types duplicate`

Duplicate an object type (copies structure, not objects).

```bash
cosmic types duplicate <slug>
cosmic types dup <slug>                      # Alias
cosmic types duplicate posts --json
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

---

## Media

### `cosmic media list`

List media files.

```bash
cosmic media list
cosmic media ls                              # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `--folder <folder>` | Filter by folder |
| `--limit <n>` | Limit results |
| `--json` | Output as JSON |

### `cosmic media get`

Get media file details.

```bash
cosmic media get <id>
cosmic media get <id> --json
```

### `cosmic media upload`

Upload a file to the media library.

```bash
cosmic media upload ./image.png
cosmic media upload ./photo.jpg --folder=photos
cosmic media upload ./hero.png --alt-text="Hero image"
```

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --folder <folder>` | Target folder |
| `-a, --alt-text <text>` | Alt text for accessibility |
| `--json` | Output as JSON |

### `cosmic media delete`

Delete a media file.

```bash
cosmic media delete <id>
cosmic media rm <id>                         # Alias
cosmic media delete <id> --force             # Skip confirmation
```

---

## Repositories

### `cosmic repos list`

List connected GitHub repositories.

```bash
cosmic repos list
cosmic repos ls                              # Alias
cosmic repos                                 # Default action
cosmic repositories list                     # Full alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `cosmic repos get`

Get repository details.

```bash
cosmic repos get <id>
cosmic repos get <id> --json
```

### `cosmic repos connect`

Connect a GitHub repository.

```bash
cosmic repos connect
cosmic repos connect --url https://github.com/user/repo
cosmic repos add --url https://github.com/user/repo    # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Repository name |
| `-u, --url <url>` | GitHub repository URL |
| `-f, --framework <fw>` | Framework (`nextjs`, `react`, `vue`, `nuxt`, `astro`, `svelte`, `other`) |
| `--json` | Output as JSON |

### `cosmic repos delete`

Disconnect a repository (does not delete the GitHub repo).

```bash
cosmic repos delete <id>
cosmic repos rm <id>                         # Alias
cosmic repos delete <id> --force             # Skip confirmation
```

### `cosmic repos clone`

Clone a repository locally and auto-create a `.env` file with Cosmic bucket API keys.

```bash
cosmic repos clone                           # Interactive selection
cosmic repos clone <repositoryId>            # Clone by repository ID
cosmic repos clone <github-url>              # Clone by GitHub URL
cosmic repos clone <id> -d my-project        # Custom directory name
cosmic repos clone <id> -b develop           # Clone specific branch
cosmic repos clone <id> --no-env             # Skip .env creation
```

**Options:**
| Option | Description |
|--------|-------------|
| `-d, --directory <dir>` | Target directory name (default: repo name) |
| `-b, --branch <branch>` | Branch to clone (default: repo's default branch) |
| `--no-env` | Skip creating the .env file |
| `--json` | Output as JSON |

**What it does:**
1. Clones the repository using `git clone`
2. Creates a `.env` file with:
   - `COSMIC_BUCKET_SLUG` - Your bucket slug
   - `COSMIC_READ_KEY` - API read key
   - `COSMIC_WRITE_KEY` - API write key
   - `NEXT_PUBLIC_COSMIC_BUCKET_SLUG` - For Next.js client-side
   - `NEXT_PUBLIC_COSMIC_READ_KEY` - For Next.js client-side

**Examples:**
```bash
# Interactive - shows list of connected repos to choose from
cosmic repos clone

# Clone by repository ID
cosmic repos clone 507f1f77bcf86cd799439011

# Clone a GitHub URL
cosmic repos clone https://github.com/cosmicjs/nextjs-blog

# Clone to a specific directory
cosmic repos clone 507f1f77bcf86cd799439011 -d my-blog

# Clone a specific branch
cosmic repos clone 507f1f77bcf86cd799439011 -b develop

# Clone without creating .env (if you have your own setup)
cosmic repos clone 507f1f77bcf86cd799439011 --no-env
```

**Output example:**
```
  Cloning my-blog into my-blog...

Cloning into 'my-blog'...
remote: Enumerating objects: 150, done.
...

  ✓ Repository cloned to my-blog
  Fetching bucket API keys...
  ✓ API keys configured
  ✓ Created .env with Cosmic bucket keys

  Environment Variables
  COSMIC_BUCKET_SLUG   my-bucket
  COSMIC_READ_KEY      abc123...
  COSMIC_WRITE_KEY     xyz789...

  Next steps
    1. cd my-blog
    2. npm install # or bun install
    3. npm run dev # Start development server
```

### Environment Variables (Vercel Deployment)

Manage environment variables for repository deployments. These are synced to Vercel when you deploy.

#### `cosmic repos env list <repoId>`

List environment variables for a repository.

```bash
cosmic repos env list <repoId>
cosmic repos env ls <repoId>                 # Alias
cosmic repos env list <repoId> --json
```

#### `cosmic repos env create <repoId>`

Add an environment variable.

```bash
cosmic repos env create <repoId>
cosmic repos env add <repoId>                  # Alias
cosmic repos env create <repoId> -k API_KEY -v secret123
cosmic repos env create <repoId> -k API_KEY -v secret123 -t production,preview
cosmic repos env create <repoId> -k NEXT_PUBLIC_SITE_URL -v https://example.com --type plain
```

**Options:**
| Option | Description |
|--------|-------------|
| `-k, --key <key>` | Environment variable key |
| `-v, --value <value>` | Value |
| `-t, --target <targets>` | Target environments: `production`, `preview`, `development` (comma-separated, default: all) |
| `--type <type>` | `encrypted` (default) or `plain` (for client-side vars like `NEXT_PUBLIC_*`) |
| `--json` | Output as JSON |

#### `cosmic repos env edit <repoId> <key>`

Edit an existing environment variable.

```bash
cosmic repos env edit <repoId> API_KEY -v new-value
cosmic repos env edit <repoId> API_KEY -t production
cosmic repos env edit <repoId> API_KEY --type plain
```

**Options:**
| Option | Description |
|--------|-------------|
| `-v, --value <value>` | New value |
| `-t, --target <targets>` | Target environments (comma-separated) |
| `--type <type>` | `encrypted` or `plain` |
| `--json` | Output as JSON |

#### `cosmic repos env delete <repoId> <key>`

Delete an environment variable.

```bash
cosmic repos env delete <repoId> API_KEY
cosmic repos env rm <repoId> API_KEY         # Alias
cosmic repos env delete <repoId> API_KEY -f  # Skip confirmation
```

### Custom Domains (Vercel Deployment)

Manage custom domains for repository deployments. Domains are added to the Vercel project linked to the repository.

#### `cosmic repos domains list <repoId>`

List domains for a repository.

```bash
cosmic repos domains list <repoId>
cosmic repos domains ls <repoId>             # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

#### `cosmic repos domains create <repoId> <domain>`

Add a domain to a repository.

```bash
cosmic repos domains create <repoId> www.example.com
cosmic repos domains add <repoId> www.example.com     # Alias
cosmic repos domains create <repoId> www.example.com -r example.com
cosmic repos domains create <repoId> blog.example.com --redirect-status 302
```

**Options:**
| Option | Description |
|--------|-------------|
| `-r, --redirect <url>` | Redirect URL or domain |
| `--redirect-status <code>` | Redirect status code: `301`, `302`, `307`, `308` (default: 301) |
| `--json` | Output as JSON |

#### `cosmic repos domains edit <repoId> <domain>`

Update domain settings (redirect configuration).

```bash
cosmic repos domains edit <repoId> www.example.com -r https://example.com
cosmic repos domains edit <repoId> www.example.com -r ""   # Remove redirect
cosmic repos domains edit <repoId> www.example.com --redirect-status 302
```

**Options:**
| Option | Description |
|--------|-------------|
| `-r, --redirect <url>` | Redirect URL or domain (empty to remove redirect) |
| `--redirect-status <code>` | Redirect status code: `301`, `302`, `307`, `308` |
| `--json` | Output as JSON |

#### `cosmic repos domains delete <repoId> <domain>`

Remove a domain from a repository.

```bash
cosmic repos domains delete <repoId> www.example.com
cosmic repos domains rm <repoId> www.example.com           # Alias
cosmic repos domains delete <repoId> www.example.com -f    # Skip confirmation
```

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --force` | Skip confirmation |
| `--json` | Output as JSON |

### Branch Management

#### `cosmic repos branches <repoId> list`

List branches for a repository.

```bash
cosmic repos branches <repoId> list
cosmic repos branches <repoId> ls            # Alias
cosmic repos branches <repoId>               # Default action
```

#### `cosmic repos branches <repoId> create`

Create a new branch.

```bash
cosmic repos branches <repoId> create
cosmic repos branches <repoId> create --name feature-x
cosmic repos branches <repoId> create --name feature-x --from main
```

**Options:**
| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Branch name |
| `--from <branch>` | Source branch (default: main) |
| `--json` | Output as JSON |

#### `cosmic repos branches <repoId> delete`

Delete a branch.

```bash
cosmic repos branches <repoId> delete <branchName>
cosmic repos branches <repoId> rm <branchName>       # Alias
cosmic repos branches <repoId> delete <name> --force # Skip confirmation
```

### Pull Request Management

#### `cosmic repos pr list <repoId>`

List pull requests for a repository.

```bash
cosmic repos pr list <repoId>
cosmic repos pr ls <repoId>                          # Alias
cosmic repos pull-requests list <repoId>             # Full alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-s, --state <state>` | Filter by state: `open`, `closed`, `all` (default: `open`) |
| `--base <branch>` | Filter by base branch |
| `--head <branch>` | Filter by head branch |
| `--json` | Output as JSON |

**Examples:**
```bash
cosmic repos pr list repo-123                        # List open PRs
cosmic repos pr list repo-123 --state all            # List all PRs
cosmic repos pr list repo-123 --base main            # PRs targeting main
```

#### `cosmic repos pr get <repoId> <pull_number>`

Get pull request details.

```bash
cosmic repos pr get <repoId> <pull_number>
cosmic repos pr get repo-123 42 --json
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

#### `cosmic repos pr create <repoId>`

Create a new pull request.

```bash
cosmic repos pr create <repoId>
cosmic repos pr add <repoId>                         # Alias
cosmic repos pr create <repoId> --head feature --base main
```

**Options:**
| Option | Description |
|--------|-------------|
| `-t, --title <title>` | Pull request title |
| `-b, --body <body>` | Pull request description |
| `--head <branch>` | Head branch (source, where changes are) |
| `--base <branch>` | Base branch (target, where changes go) |
| `--draft` | Create as draft PR |
| `--json` | Output as JSON |

**Examples:**
```bash
# Interactive mode
cosmic repos pr create repo-123

# With all options
cosmic repos pr create repo-123 \
  --title "Add new feature" \
  --body "This PR adds..." \
  --head feature-branch \
  --base main

# Create draft PR
cosmic repos pr create repo-123 --draft
```

#### `cosmic repos pr merge <repoId> <pull_number>`

Merge a pull request.

```bash
cosmic repos pr merge <repoId> <pull_number>
cosmic repos pr merge repo-123 42
cosmic repos pr merge repo-123 42 --method squash
```

**Options:**
| Option | Description |
|--------|-------------|
| `-m, --method <method>` | Merge method: `merge`, `squash`, `rebase` (default: `merge`) |
| `--title <title>` | Commit title for merge |
| `--message <message>` | Commit message for merge |
| `-f, --force` | Skip confirmation |

**Examples:**
```bash
# Standard merge
cosmic repos pr merge repo-123 42

# Squash merge
cosmic repos pr merge repo-123 42 --method squash

# With custom commit message
cosmic repos pr merge repo-123 42 \
  --title "Feature: Add dark mode" \
  --message "Adds dark mode support with theme toggle"
```

#### `cosmic repos pr close <repoId> <pull_number>`

Close a pull request without merging.

```bash
cosmic repos pr close <repoId> <pull_number>
cosmic repos pr close repo-123 42
cosmic repos pr close repo-123 42 --force            # Skip confirmation
```

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --force` | Skip confirmation |

---

## Deployments

### `cosmic deploy start`

Deploy a repository to Vercel.

```bash
cosmic deploy start <repositoryId>
cosmic deploy trigger <repositoryId>         # Alias
cosmic deploy start <repositoryId> --branch main   # Deploy from specific branch (repos with existing Vercel project)
```

**Options:**
| Option | Description |
|--------|-------------|
| `-w, --watch` | Watch deployment progress until complete |
| `-b, --branch <branch>` | Branch to deploy (for repos with existing Vercel project; uses redeploy API) |
| `--json` | Output as JSON |

### `cosmic deploy redeploy`

Redeploy a repository with optional branch selection. Use when the repository already has a Vercel project and you want to trigger a new deployment from a specific branch.

```bash
cosmic deploy redeploy <repositoryId>              # Interactive branch selection
cosmic deploy redeploy <repositoryId> -b main      # Redeploy from main branch
cosmic deploy redeploy <repositoryId> --branch develop --watch
```

**Options:**
| Option | Description |
|--------|-------------|
| `-b, --branch <branch>` | Branch to deploy from (skips interactive selection) |
| `-w, --watch` | Watch deployment progress until complete |
| `--json` | Output as JSON |

### `cosmic deploy list`

List deployments for a repository.

```bash
cosmic deploy list <repositoryId>
cosmic deploy ls <repositoryId>              # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-n, --limit <n>` | Number of deployments to show (default: 10) |
| `--json` | Output as JSON |

### `cosmic deploy logs`

Get deployment logs.

```bash
cosmic deploy logs <deploymentId>
cosmic deploy logs <deploymentId> --follow   # Stream logs in real-time
```

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --follow` | Follow/stream logs |
| `--json` | Output as JSON |

### `cosmic deploy cancel`

Cancel an in-progress deployment.

```bash
cosmic deploy cancel <repositoryId> <deploymentId>
cosmic deploy cancel <repoId> <deploymentId> --force  # Skip confirmation
```

---

## Webhooks

### `cosmic webhooks list`

List webhooks in current bucket.

```bash
cosmic webhooks list
cosmic webhooks ls                           # Alias
cosmic wh list                               # Short alias
cosmic webhooks list --json
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `cosmic webhooks get`

Get webhook details.

```bash
cosmic webhooks get <id>
cosmic webhooks get <id> --json
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `cosmic webhooks create`

Create a new webhook.

```bash
cosmic webhooks create                       # Interactive mode
cosmic webhooks add                          # Alias
cosmic webhooks create \
  --title "Notify on publish" \
  --endpoint https://example.com/webhook \
  --resource objects \
  --events created,edited,deleted
```

**Options:**
| Option | Description |
|--------|-------------|
| `--title <title>` | Webhook title |
| `--endpoint <url>` | Endpoint URL to receive events |
| `--resource <type>` | Resource type: `objects`, `media`, `merge_request` |
| `--events <events>` | Events to listen for (comma-separated: `created`, `edited`, `deleted`, `completed`) |
| `--object-types <types>` | Object type filters (comma-separated) |
| `--payload` | Include full payload in webhook |
| `--props <props>` | Properties to include in payload |
| `--json` | Output as JSON |

### `cosmic webhooks update`

Update a webhook.

```bash
cosmic webhooks update <id> --endpoint https://new-url.com/hook
cosmic webhooks edit <id> --events created,edited    # Alias
cosmic webhooks update <id> --title "New Name" --no-payload
```

**Options:**
| Option | Description |
|--------|-------------|
| `--title <title>` | New title |
| `--endpoint <url>` | New endpoint URL |
| `--resource <type>` | New resource type |
| `--events <events>` | New events (comma-separated) |
| `--object-types <types>` | New object type filters (comma-separated) |
| `--payload` | Enable payload |
| `--no-payload` | Disable payload |
| `--props <props>` | Properties to include in payload |
| `--json` | Output as JSON |

### `cosmic webhooks delete`

Delete a webhook.

```bash
cosmic webhooks delete <id>
cosmic webhooks rm <id>                      # Alias
cosmic webhooks delete <id> --force          # Skip confirmation
```

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --force` | Skip confirmation |

---

## Team

Manage project team members. Requires a project to be selected (use `cosmic cd` to navigate to a project).

### `cosmic team list`

List team members in the current project.

```bash
cosmic team list
cosmic team ls                               # Alias
cosmic team list --json
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `cosmic team add`

Add a team member to the project.

```bash
cosmic team add user@example.com             # Interactive role selection
cosmic team add user@example.com --role admin
cosmic team add user@example.com -r manager
```

**Options:**
| Option | Description |
|--------|-------------|
| `-r, --role <role>` | Project role: `admin`, `manager`, `user` |
| `--json` | Output as JSON |

**Roles:**
| Role | Description |
|------|-------------|
| `admin` | Full access to the project |
| `manager` | Manage content and settings |
| `user` | Content access based on bucket roles |

### `cosmic team update`

Update a team member's role.

```bash
cosmic team update <userId> --role admin
cosmic team edit <userId> -r user            # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-r, --role <role>` | New project role: `admin`, `manager`, `user` |
| `--json` | Output as JSON |

### `cosmic team remove`

Remove a team member from the project.

```bash
cosmic team remove <userId>
cosmic team rm <userId>                      # Alias
cosmic team remove <userId> --force          # Skip confirmation
```

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --force` | Skip confirmation |

---

## Domains

Manage domains and DNS records.

### `cosmic domains list`

List all domains.

```bash
cosmic domains list
cosmic domains ls                            # Alias
cosmic domains list --json
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `cosmic domains get`

Get domain details.

```bash
cosmic domains get <id>
cosmic domains get <id> --json
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `cosmic domains search`

Search for available domain names.

```bash
cosmic domains search example.com
cosmic domains search mysite --limit 20
```

**Options:**
| Option | Description |
|--------|-------------|
| `-l, --limit <n>` | Limit results |
| `--json` | Output as JSON |

### `cosmic domains import`

Import an external domain (one you already own).

```bash
cosmic domains import example.com
cosmic domains import example.com --description "Main website"
```

**Options:**
| Option | Description |
|--------|-------------|
| `-d, --description <text>` | Domain description |
| `--json` | Output as JSON |

### `cosmic domains connect`

Connect a domain to a deployed repository.

```bash
cosmic domains connect <id> --repo <repoId>
cosmic domains connect <id> --repo <repoId> --redirect https://www.example.com
cosmic domains connect <id> -r <repoId> --redirect-code 302
```

**Options:**
| Option | Description |
|--------|-------------|
| `-r, --repo <repoId>` | Repository ID to connect |
| `--redirect <url>` | Redirect URL |
| `--redirect-code <code>` | Redirect status code: `301`, `302`, `307`, `308` |
| `--json` | Output as JSON |

### `cosmic domains disconnect`

Disconnect a domain from a repository.

```bash
cosmic domains disconnect <id> --repo <repoId>
cosmic domains disconnect <id> -r <repoId>
```

**Options:**
| Option | Description |
|--------|-------------|
| `-r, --repo <repoId>` | Repository ID to disconnect |

### `cosmic domains delete`

Delete a domain.

```bash
cosmic domains delete <id>
cosmic domains rm <id>                       # Alias
cosmic domains delete <id> --force           # Skip confirmation
```

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --force` | Skip confirmation |

### DNS Records

Manage DNS records for a domain.

#### `cosmic domains dns list`

List DNS records for a domain.

```bash
cosmic domains dns list <domainId>
cosmic domains dns ls <domainId>             # Alias
cosmic domains dns list <domainId> --json
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

#### `cosmic domains dns add`

Add a DNS record.

```bash
cosmic domains dns add <domainId>                                   # Interactive
cosmic domains dns add <domainId> -t A -n @ -v 76.76.21.21
cosmic domains dns add <domainId> -t CNAME -n www -v example.com
cosmic domains dns add <domainId> -t TXT -n @ -v "v=spf1 ..." --ttl 3600
```

**Options:**
| Option | Description |
|--------|-------------|
| `-t, --type <type>` | Record type: `A`, `AAAA`, `CNAME`, `MX`, `TXT`, `SRV`, `NS` |
| `-n, --name <name>` | Record name |
| `-v, --value <value>` | Record value |
| `--ttl <seconds>` | TTL in seconds (60-86400) |
| `--comment <text>` | Record comment |
| `--json` | Output as JSON |

#### `cosmic domains dns update`

Update a DNS record.

```bash
cosmic domains dns update <domainId> <recordId> --value 1.2.3.4
cosmic domains dns edit <domainId> <recordId> --ttl 3600    # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-t, --type <type>` | New record type |
| `-n, --name <name>` | New record name |
| `-v, --value <value>` | New record value |
| `--ttl <seconds>` | New TTL |
| `--comment <text>` | New comment |
| `--json` | Output as JSON |

#### `cosmic domains dns delete`

Delete a DNS record.

```bash
cosmic domains dns delete <domainId> <recordId>
cosmic domains dns rm <domainId> <recordId>            # Alias
cosmic domains dns delete <domainId> <recordId> -f     # Skip confirmation
```

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --force` | Skip confirmation |

---

## Workflows

### `cosmic workflows list`

List workflows.

```bash
cosmic workflows list
cosmic workflows ls                          # Alias
cosmic wf list                               # Short alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-s, --status <status>` | Filter by status (`active`, `draft`, `paused`) |
| `--schedule-type <type>` | Filter by schedule type (`manual`, `cron`, `event_triggered`) |
| `-l, --limit <n>` | Limit results |
| `--json` | Output as JSON |

### `cosmic workflows get`

Get workflow details.

```bash
cosmic workflows get <id>
cosmic workflows get <id> --json
```

### `cosmic workflows create`

Create a new workflow with an initial agent step.

```bash
cosmic workflows create
cosmic workflows create --name "My Workflow" --agent <agentId>
cosmic workflows add                         # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Workflow name |
| `-d, --description <desc>` | Description |
| `-a, --agent <agentId>` | Initial agent ID for first step |
| `--schedule-type <type>` | Schedule type (`manual`, `cron`, `event_triggered`) |
| `--status <status>` | Initial status (`draft`, `active`, `paused`) |
| `--json` | Output as JSON |

### `cosmic workflows add-step`

Add an agent as a step to an existing workflow.

```bash
cosmic workflows add-step <workflowId>
cosmic workflows add-step <workflowId> --agent <agentId>
```

**Options:**
| Option | Description |
|--------|-------------|
| `-a, --agent <agentId>` | Agent ID to add |
| `--json` | Output as JSON |

### `cosmic workflows remove-step`

Remove a step from a workflow.

```bash
cosmic workflows remove-step <workflowId>
cosmic workflows remove-step <workflowId> --step 2
```

**Options:**
| Option | Description |
|--------|-------------|
| `-s, --step <n>` | Step number to remove (1-based) |
| `-f, --force` | Skip confirmation |
| `--json` | Output as JSON |

### `cosmic workflows run`

Execute a workflow.

```bash
cosmic workflows run <id>
cosmic workflows execute <id>                # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-i, --inputs <json>` | User inputs as JSON string |
| `--json` | Output as JSON |

### `cosmic workflows delete`

Delete a workflow.

```bash
cosmic workflows delete <id>
cosmic workflows rm <id>                     # Alias
cosmic workflows delete <id> --force         # Skip confirmation
```

### `cosmic workflows executions`

List or get execution details.

```bash
cosmic workflows executions                  # List all executions
cosmic workflows executions <executionId>    # Get specific execution
cosmic workflows exec <executionId>          # Alias
```

**Options (for listing):**
| Option | Description |
|--------|-------------|
| `-w, --workflow-id <id>` | Filter by workflow ID |
| `-s, --status <status>` | Filter by status |
| `-l, --limit <n>` | Limit results (default: 20) |
| `--json` | Output as JSON |

### `cosmic workflows cancel`

Cancel a running execution.

```bash
cosmic workflows cancel <executionId>
```

---

## Agents

### `cosmic agents list`

List agents in current bucket.

```bash
cosmic agents list
cosmic agents ls                             # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `cosmic agents get`

Get agent details.

```bash
cosmic agents get <id>
cosmic agents get <id> --json
```

### `cosmic agents create`

Create a new agent.

```bash
cosmic agents create --type content
cosmic agents add --type repo                # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-t, --type <type>` | **Required.** Agent type: `content`, `repository` (or `code`/`repo`), `computer_use` |
| `-n, --name <name>` | Agent name |
| `-p, --prompt <prompt>` | Agent prompt/instructions |
| `-m, --model <model>` | AI model (default: opus-4.5 for content/repo, haiku-4.5 for computer_use) |
| `-e, --emoji <emoji>` | Agent emoji |
| `--repository-id <id>` | Repository ID (for repository type) |
| `--base-branch <branch>` | Base branch (for repository type) |
| `--start-url <url>` | Start URL (for computer_use type) |
| `--goal <goal>` | Goal description (for computer_use type) |
| `--auth-session <id>` | Pre-captured auth session ID (for computer_use type) |
| `--types <types>` | Object type slugs for context (comma-separated) |
| `-l, --links <urls>` | External URLs for context (comma-separated) |
| `--objects-limit <n>` | Max objects per type for context (default: 100) |
| `--objects-depth <n>` | Object depth for nested metafields (default: 1) |
| `--email-notifications` | Enable email notifications |
| `--require-approval` | Require approval before execution |
| `--schedule` | Enable scheduled runs |
| `--schedule-type <type>` | `once` or `recurring` (default: recurring) |
| `--schedule-frequency <freq>` | `hourly`, `daily`, `weekly`, `monthly` (default: daily) |
| `--timezone <tz>` | Timezone for schedule (default: UTC) |
| `--run` | Run immediately after creation |
| `--json` | Output as JSON |

### `cosmic agents run`

Run an agent.

```bash
cosmic agents run <id>
cosmic agents run <id> --prompt "Override prompt"
```

**Options:**
| Option | Description |
|--------|-------------|
| `-p, --prompt <prompt>` | Override the agent's prompt |
| `--json` | Output as JSON |

### `cosmic agents follow-up`

Add a follow-up task to continue work on the same branch.

```bash
cosmic agents follow-up <agentId>
cosmic agents followup <agentId>             # Alias
cosmic agents follow-up <agentId> --prompt "Continue with..."
```

**Options:**
| Option | Description |
|--------|-------------|
| `-p, --prompt <prompt>` | Follow-up instructions |
| `--json` | Output as JSON |

### `cosmic agents pr`

Create a pull request from agent's work.

```bash
cosmic agents pr <agentId>
cosmic agents pull-request <agentId>         # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-t, --title <title>` | PR title |
| `-b, --body <body>` | PR description |
| `--json` | Output as JSON |

### `cosmic agents approve`

Approve and execute pending operations for an execution.

```bash
cosmic agents approve <agentId> <executionId>
cosmic agents approve <agentId> <execId> --all    # Approve without confirmation
cosmic agents approve <agentId> <execId> --skip   # Skip and mark complete
```

**Options:**
| Option | Description |
|--------|-------------|
| `-y, --all` | Approve all operations without confirmation |
| `--skip` | Skip operations and mark execution as complete |
| `--json` | Output as JSON |

### `cosmic agents delete`

Delete an agent.

```bash
cosmic agents delete <id>
cosmic agents rm <id>                        # Alias
cosmic agents delete <id> --force            # Skip confirmation
```

### `cosmic agents executions`

List or get agent execution details.

```bash
cosmic agents executions <agentId>                    # List executions
cosmic agents executions <agentId> <executionId>      # Get specific
cosmic agents exec <agentId> <execId>                 # Alias
cosmic agents executions <agentId> <execId> --watch   # Poll until complete
```

**Options:**
| Option | Description |
|--------|-------------|
| `-w, --watch` | Watch execution and poll until complete |
| `--json` | Output as JSON |

### `cosmic agents capture-auth`

Capture authentication from local browser for computer use agents.

```bash
cosmic agents capture-auth --url https://example.com/login
```

Opens a browser window. Log in to the site, then click "Done - Capture Auth" in the banner. Returns a session ID to use with `--auth-session` when creating agents.

**Options:**
| Option | Description |
|--------|-------------|
| `-u, --url <url>` | **Required.** URL to authenticate on |
| `-l, --label <label>` | Label for this auth session |
| `--timeout <seconds>` | Timeout in seconds (default: 600) |
| `--json` | Output as JSON |

---

## AI Generation

### `cosmic ai generate`

Generate text from a prompt with streaming output.

```bash
cosmic ai generate "Write a blog post about AI"
cosmic ai gen "Your prompt"                  # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-m, --model <model>` | AI model to use |
| `--max-tokens <n>` | Maximum tokens to generate |
| `--temperature <n>` | Temperature (0-2) |
| `--json` | Output as JSON |

### `cosmic ai image`

Generate an image from a prompt.

```bash
cosmic ai image "A sunset over mountains"
cosmic ai img "Your prompt"                  # Alias
```

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --folder <folder>` | Target folder in media library |
| `-a, --alt-text <text>` | Alt text for the image |
| `--json` | Output as JSON |

### `cosmic ai chat`

Send a single message to AI.

```bash
cosmic ai chat "Tell me about my content"
cosmic ai chat "Explain this" --system "You are a helpful assistant"
```

**Options:**
| Option | Description |
|--------|-------------|
| `-m, --model <model>` | AI model to use |
| `-s, --system <prompt>` | System prompt |
| `--json` | Output as JSON |

---

## Interactive Chat

### `cosmic chat`

Start interactive AI chat session.

```bash
cosmic chat                    # Default ask mode (read-only)
cosmic chat --content          # Content mode (can modify content)
cosmic chat --build            # Build mode (generate apps)
cosmic chat --repo             # Repository mode (code changes)
cosmic chat --repo my-repo     # Repo mode with specific repo
```

**Options:**
| Option | Description |
|--------|-------------|
| `-m, --model <model>` | AI model to use |
| `--ask` | Ask mode - read-only questions |
| `-c, --content` | Content mode - create/update content |
| `-b, --build` | Build mode - app development |
| `-r, --repo [name]` | Repository mode - code changes |
| `--branch <branch>` | Branch to use in repo mode |
| `-p, --prompt <prompt>` | Start with initial prompt |
| `-t, --types <types>` | Object type slugs to include (comma-separated) |
| `-l, --links <urls>` | External URLs to include (comma-separated) |
| `--objects-limit <n>` | Max objects per type (default: 10 content, 100 build) |
| `--objects-depth <n>` | Object depth for nested metafields (default: 1) |

### Chat Commands

Inside chat mode:

| Command | Description |
|---------|-------------|
| `exit`, `quit` | Exit chat mode |
| `clear` | Clear conversation history |
| `context` | Show current context |
| `help` | Show available commands |

---

## Shortcut Commands

### `cosmic content`

Shortcut for content mode chat.

```bash
cosmic content                               # Start content chat
cosmic content -p "Create 5 blog posts"      # With initial prompt
cosmic content --types posts,authors         # Include object types
cosmic content --ask                         # Read-only mode
```

**Options:**
| Option | Description |
|--------|-------------|
| `-m, --model <model>` | AI model to use |
| `-p, --prompt <prompt>` | Initial prompt |
| `-a, --ask` | Ask mode (read-only) |
| `-t, --types <types>` | Object types to include |
| `-l, --links <urls>` | External URLs to include |
| `--objects-limit <n>` | Max objects per type |
| `--objects-depth <n>` | Nested metafield depth |

### `cosmic build`

Shortcut for build mode chat.

```bash
cosmic build                                 # Start build chat
cosmic build -p "A blog with dark mode"      # With description
cosmic build --types posts                   # Include content context
cosmic build --ask                           # Ask without generating
```

**Options:**
| Option | Description |
|--------|-------------|
| `-m, --model <model>` | AI model to use |
| `-p, --prompt <prompt>` | App description |
| `-a, --ask` | Ask mode (questions only) |
| `-t, --types <types>` | Object types to include |
| `-l, --links <urls>` | External URLs to include |
| `--objects-limit <n>` | Max objects per type |
| `--objects-depth <n>` | Nested metafield depth |

### `cosmic update`

Shortcut for repository update mode.

```bash
cosmic update                                # Select repo interactively
cosmic update my-repo                        # Specify repo name
cosmic update my-repo -b feature-branch      # Specify branch
cosmic update -p "Add dark mode support"     # With instructions
cosmic update --ask                          # Explore code without changes
```

**Options:**
| Option | Description |
|--------|-------------|
| `-m, --model <model>` | AI model to use |
| `-b, --branch <branch>` | Branch to update (default: main) |
| `-p, --prompt <prompt>` | Change description |
| `-a, --ask` | Ask mode (explore only) |
| `-t, --types <types>` | Object types to include |
| `-l, --links <urls>` | External URLs to include |
| `--objects-limit <n>` | Max objects per type |
| `--objects-depth <n>` | Nested metafield depth |

---

## Configuration

### `cosmic config get`

Get configuration values.

```bash
cosmic config get                            # Show all config
cosmic config get defaultModel               # Get specific value
```

### `cosmic config set`

Set configuration values.

```bash
cosmic config set defaultModel gpt-5
cosmic config set apiUrl https://custom-api.example.com
cosmic config set sdkUrl http://localhost:8080/v3
```

### Configuration Options

| Option | Description |
|--------|-------------|
| `defaultModel` | Default AI model for generation |
| `apiUrl` | Custom API URL |
| `sdkUrl` | Custom SDK URL (for local development) |
| `currentWorkspace` | Current workspace slug |
| `currentProject` | Current project slug |
| `currentBucket` | Current bucket slug |

### Configuration Files

Configuration is stored in `~/.cosmic/`:

| File | Contents |
|------|----------|
| `config.json` | Settings (context, default model, etc.) |
| `credentials.json` | Authentication tokens |

---

## Command Aliases

Many commands have short aliases for convenience:

| Command | Aliases |
|---------|---------|
| `shell` | `sh` |
| `list` | `ls` |
| `delete` | `rm` |
| `create` | `add` |
| `update` | `edit` |
| `objects` | `obj` |
| `webhooks` | `wh` |
| `workflows` | `wf` |
| `repositories` | `repos` |
| `duplicate` | `dup` |
| `executions` | `exec` |
| `generate` | `gen` |
| `image` | `img` |
| `follow-up` | `followup` |
| `pr` | `pull-request` |

### Agent Type Aliases

| Type | Aliases |
|------|---------|
| `repository` | `code`, `repo` |

---

## Examples

### Clone Repository for Local Development

```bash
# Clone a connected repository with auto-configured environment
cosmic repos clone                     # Interactive - select from connected repos
cosmic repos clone my-repo-id          # By repository ID  
cosmic repos clone https://github.com/user/my-app  # By URL

# The clone command automatically:
# 1. Clones the repo to your local machine
# 2. Creates .env with your Cosmic API keys:
#    - COSMIC_BUCKET_SLUG
#    - COSMIC_READ_KEY  
#    - COSMIC_WRITE_KEY
#    - NEXT_PUBLIC_COSMIC_BUCKET_SLUG (for Next.js)
#    - NEXT_PUBLIC_COSMIC_READ_KEY (for Next.js)

# Start developing immediately
cd my-app
npm install
npm run dev
```

### Complete App Workflow (Full Walkthrough)

```bash
# 1. Login to Cosmic
cosmic login

# 2. Create a new project with AI-generated content model
cosmic projects create
# Follow prompts:
#   - Project title: "Recipe Blog"
#   - How to start: "Use AI to generate content model"
#   - Describe: "A recipe blog with recipes, categories, and authors"
# AI creates object types and sample content automatically

# 3. Verify your content
cosmic ls                              # See your project
cosmic cd <project-id>                 # Navigate into it
cosmic ls                              # See the bucket
cosmic cd <bucket-slug>                # Navigate into bucket
cosmic objects list                    # See generated content

# 4. Generate more content with AI
cosmic content -p "Create 10 more recipes with hero images"

# 5. Build an app from your content
cosmic build -p "A modern recipe blog using Next.js with search, 
category filtering, and a beautiful grid layout"
# AI generates complete app code and creates GitHub repo

# 6. List your repos and deploy
cosmic repos list                      # Find repo ID
cosmic deploy start <repoId> --watch   # Deploy to Vercel
# ✓ Deployment ready: https://recipe-blog-xyz.vercel.app

# 7. Clone locally for development
cosmic repos clone <repoId>            # Clone with .env auto-configured
cd recipe-blog
npm install
npm run dev                            # Start local development

# 8. Make updates to the app
cosmic update <repoName> -p "Add a favorites feature where users can 
save recipes to localStorage, and add dark mode support"
# AI modifies the code in your repo

# 9. Watch the agent work
cosmic agents executions <agentId> --watch

# 10. Review and create a PR
cosmic agents pr <agentId>
# ✓ PR created: https://github.com/user/recipe-blog/pull/1

# 11. Merge and redeploy
# After reviewing/merging the PR:
cosmic deploy redeploy <repoId> --branch main --watch
# Or: cosmic deploy start <repoId> --branch main --watch
```

### Automated Content Pipeline

```bash
# Create agents
cosmic agents create --type content --name "Writer" \
  --prompt "Write engaging blog posts" --run

cosmic agents create --type content --name "Editor" \
  --prompt "Edit and improve blog posts"

# Create workflow
cosmic workflows create --name "Content Pipeline" --agent <writerId>
cosmic workflows add-step <workflowId> --agent <editorId>

# Execute
cosmic workflows run <workflowId>
```

### Computer Use with Auth

```bash
# Capture auth session
cosmic agents capture-auth --url https://dashboard.example.com/login

# Create agent with auth
cosmic agents create \
  --type computer_use \
  --name "Dashboard Bot" \
  --start-url "https://dashboard.example.com" \
  --prompt "Screenshot the weekly metrics and summarize them" \
  --auth-session <sessionId> \
  --schedule \
  --schedule-frequency daily

# Check executions
cosmic agents executions <agentId> --watch
```
