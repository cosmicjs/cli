/**
 * Welcome screen, help text, and header display
 */

import chalk from 'chalk';
import { CLI_VERSION } from '../version.js';
import { formatContext } from '../config/context.js';
import { state } from './state.js';
import { getTerminalWidth } from './utils.js';

/**
 * Cosmic logo - large ASCII letters
 */
const COSMIC_LOGO = [
  ' ██████╗ ██████╗ ███████╗███╗   ███╗██╗ ██████╗',
  '██╔════╝██╔═══██╗██╔════╝████╗ ████║██║██╔════╝',
  '██║     ██║   ██║███████╗██╔████╔██║██║██║     ',
  '██║     ██║   ██║╚════██║██║╚██╔╝██║██║██║     ',
  '╚██████╗╚██████╔╝███████║██║ ╚═╝ ██║██║╚██████╗',
  ' ╚═════╝ ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝ ╚═════╝',
];

/**
 * Print a horizontal line for the box
 */
function printBoxLine(width: number, left: string, fill: string, right: string): string {
  return left + fill.repeat(width - 2) + right;
}

/**
 * Print text padded to width
 */
function padText(text: string, width: number, align: 'left' | 'center' | 'right' = 'left'): string {
  // Strip ANSI codes for length calculation
  const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');
  const textLen = stripAnsi(text).length;
  const padding = width - textLen - 2; // -2 for border chars

  if (padding < 0) return '│' + text.slice(0, width - 2) + '│';

  if (align === 'center') {
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return '│' + ' '.repeat(leftPad) + text + ' '.repeat(rightPad) + '│';
  } else if (align === 'right') {
    return '│' + ' '.repeat(padding) + text + '│';
  } else {
    return '│' + text + ' '.repeat(padding) + '│';
  }
}

/**
 * Print the welcome screen with Cosmic logo
 */
export function printWelcomeScreen(model: string): void {
  // Get version
  const version = CLI_VERSION;

  // Determine mode
  let modeText = '';
  let modeColor = chalk.cyan;
  if (state.isRepoMode && state.currentRepo) {
    modeText = state.isAskMode ? 'Repository Mode (Ask)' : 'Repository Mode';
    modeColor = state.isAskMode ? chalk.blue : chalk.magenta;
  } else if (state.isBuildMode) {
    modeText = state.isAskMode ? 'Build Mode (Ask)' : 'Build Mode';
    modeColor = state.isAskMode ? chalk.blue : chalk.green;
  } else if (state.isAutomateMode) {
    modeText = state.isAskMode ? 'Automate Mode (Ask)' : 'Automate Mode';
    modeColor = state.isAskMode ? chalk.blue : chalk.blueBright;
  } else if (state.isContentMode) {
    modeText = state.isAskMode ? 'Content Mode (Ask)' : 'Content Mode';
    modeColor = state.isAskMode ? chalk.blue : chalk.yellow;
  } else {
    modeText = 'Ask Mode (read-only)';
    modeColor = chalk.blue;
  }

  // Get user name
  const userName = process.env.USER || process.env.USERNAME || 'there';

  const termWidth = getTerminalWidth();

  // Compact mode for narrow terminals (< 60 columns)
  if (termWidth < 60) {
    console.log();
    console.log(chalk.cyan.bold(`  Cosmic CLI v${version}`));
    console.log();
    console.log(`  Welcome, ${chalk.bold(userName)}!`);
    console.log(`  ${modeColor.bold(modeText)}`);
    console.log();
    console.log(chalk.dim(`  Model: ${model}`));
    console.log(chalk.dim(`  Context: ${formatContext()}`));
    if (state.isRepoMode && state.currentRepo) {
      console.log(chalk.dim(`  Repo: ${state.currentRepo.owner}/${state.currentRepo.name}`));
    }
    console.log();
    return;
  }

  // Calculate content widths to determine box size
  const logoWidth = 48;
  const contextText = `Context: ${formatContext()}`;
  const modelText = `Model: ${model}`;
  const repoText = state.isRepoMode && state.currentRepo ? `Repository: ${state.currentRepo.owner}/${state.currentRepo.name} (${state.currentRepo.branch})` : '';

  // Build AI context text lines
  const aiContextLines: string[] = [];
  if (state.chatContext.objectTypes && state.chatContext.objectTypes.length > 0) {
    aiContextLines.push(`Object Types: ${state.chatContext.objectTypes.join(', ')}`);
  }
  if (state.chatContext.links && state.chatContext.links.length > 0) {
    aiContextLines.push(`Links: ${state.chatContext.links.join(', ')}`);
  }

  // Find the widest content line
  const contentLines = [
    logoWidth,
    contextText.length,
    modelText.length,
    repoText.length,
    'Build and deploy a website:    cosmic chat --build'.length,
    ...aiContextLines.map(l => l.length),
  ];
  const maxContentWidth = Math.max(...contentLines);

  // Inner width = max content + padding (4 chars for margins)
  // Cap to terminal width minus 2 (for border chars)
  const innerWidth = Math.min(maxContentWidth + 4, termWidth - 2);

  // Whether the logo fits (logo needs innerWidth >= logoWidth + 2 for padding)
  const showLogo = innerWidth >= logoWidth + 2;

  // Helper to strip ANSI codes
  const stripAnsi = (str: string): string => str.replace(/\x1b\[[0-9;]*m/g, '');

  // Helper to center text
  const centerLine = (text: string, color = chalk.white): string => {
    const textLen = stripAnsi(text).length;
    if (textLen > innerWidth) {
      // Truncate if too long
      return chalk.cyan('│') + color(text.slice(0, innerWidth)) + chalk.cyan('│');
    }
    const leftPad = Math.floor((innerWidth - textLen) / 2);
    const rightPad = innerWidth - textLen - leftPad;
    return chalk.cyan('│') + ' '.repeat(leftPad) + color(text) + ' '.repeat(rightPad) + chalk.cyan('│');
  };

  // Helper for left-aligned text with truncation
  const leftLine = (text: string): string => {
    const textLen = stripAnsi(text).length;
    const availWidth = innerWidth - 2; // 2 chars for left margin
    if (textLen > availWidth) {
      // Truncate the raw text (preserving ANSI is complex, so just cap it)
      return chalk.cyan('│') + '  ' + text.slice(0, availWidth) + chalk.cyan('│');
    }
    const rightPad = innerWidth - textLen - 2;
    return chalk.cyan('│') + '  ' + text + ' '.repeat(Math.max(0, rightPad)) + chalk.cyan('│');
  };

  // Empty line
  const emptyLine = (): string => chalk.cyan('│') + ' '.repeat(innerWidth) + chalk.cyan('│');

  // Horizontal rule
  const hrTop = (title: string): string => {
    const borderLen = innerWidth - title.length;
    if (borderLen < 2) {
      return chalk.cyan('╭' + '─'.repeat(innerWidth) + '╮');
    }
    const left = Math.floor(borderLen / 2);
    const right = borderLen - left;
    return chalk.cyan('╭' + '─'.repeat(left) + title + '─'.repeat(right) + '╮');
  };
  const hrMid = (): string => chalk.cyan('├' + '─'.repeat(innerWidth) + '┤');
  const hrBot = (): string => chalk.cyan('╰' + '─'.repeat(innerWidth) + '╯');

  console.log();

  // Top border with title
  console.log(hrTop(` Cosmic CLI v${version} `));
  console.log(emptyLine());

  // Logo - centered (only if it fits)
  if (showLogo) {
    for (const line of COSMIC_LOGO) {
      const leftPad = Math.floor((innerWidth - line.length) / 2);
      const rightPad = innerWidth - line.length - leftPad;
      console.log(chalk.cyan('│') + ' '.repeat(leftPad) + chalk.cyan(line) + ' '.repeat(rightPad) + chalk.cyan('│'));
    }
    console.log(emptyLine());
  }

  console.log(centerLine(`Welcome, ${userName}!`, chalk.bold.white));

  if (modeText) {
    console.log(centerLine(modeText, modeColor.bold));
  }

  console.log(emptyLine());
  console.log(hrMid());
  console.log(emptyLine());

  // Tips
  console.log(leftLine(chalk.bold.white('Getting started')));
  console.log(emptyLine());
  console.log(leftLine(chalk.dim('Create and manage content:     ') + chalk.white('cosmic content')));
  console.log(leftLine(chalk.dim('Build and deploy a website:    ') + chalk.white('cosmic build')));
  console.log(leftLine(chalk.dim('Update an existing repository: ') + chalk.white('cosmic update')));
  console.log(leftLine(chalk.dim('Create agents and workflows:   ') + chalk.white('cosmic automate')));
  console.log(leftLine(chalk.dim('Attach images: ') + chalk.white('@./image.png') + chalk.dim(' or paste a file path')));
  console.log(emptyLine());

  console.log(hrMid());

  // Info
  console.log(leftLine(chalk.dim(modelText)));
  console.log(leftLine(chalk.dim(contextText)));

  if (repoText) {
    console.log(leftLine(chalk.dim(repoText)));
  }

  // Show AI context if present
  if (aiContextLines.length > 0) {
    console.log(hrMid());
    console.log(leftLine(chalk.bold.white('AI Context')));
    for (const line of aiContextLines) {
      console.log(leftLine(chalk.dim(line)));
    }
  }

  console.log(hrBot());
  console.log();
}

/**
 * Print chat header (legacy simple version for non-interactive contexts)
 */
export function printHeader(model: string): void {
  // Use the new welcome screen
  printWelcomeScreen(model);
}

/**
 * Print help information
 */
export function printHelp(): void {
  console.log();
  console.log(chalk.bold('Chat Commands:'));
  console.log(chalk.dim('  exit, quit') + '    - Exit the chat');
  console.log(chalk.dim('  clear') + '         - Clear conversation history');
  console.log(chalk.dim('  context') + '       - Show/manage current context');
  console.log(chalk.dim('  open') + '          - Open last deployment in browser');
  console.log(chalk.dim('  add content') + '   - Generate and add content to Cosmic CMS');
  console.log(chalk.dim('  help') + '          - Show this help');
  console.log();
  console.log(chalk.bold('Media attachments:'));
  console.log(chalk.dim('  Use @path to attach images: ') + chalk.cyan('what\'s in this? @./screenshot.png'));
  console.log(chalk.dim('  Or drag-drop/paste a file path - images are auto-detected and uploaded'));
  console.log();

  // Show current mode info
  if (state.isAskMode) {
    console.log(chalk.bold('Current Mode: ') + chalk.blue('Ask Mode (read-only)'));
    console.log(chalk.dim('  The AI will answer questions but cannot execute actions.'));
    console.log(chalk.dim('  To enable actions, restart with: ') + chalk.cyan('cosmic chat --agent'));
    console.log();
    console.log(chalk.bold('Example questions:'));
    console.log(chalk.dim('  "What object types are available?"'));
    console.log(chalk.dim('  "How do I structure a blog with categories?"'));
    console.log(chalk.dim('  "Explain how metafields work"'));
    console.log(chalk.dim('  "What is the best way to model products?"'));
  } else if (state.isRepoMode) {
    if (state.isAskMode) {
      console.log(chalk.bold('Current Mode: ') + chalk.blue('Repository Mode (Ask)'));
      console.log(chalk.dim('  You are in read-only mode. Ask questions about the codebase.'));
      console.log(chalk.dim('  Use `cosmic update` without --ask to make changes.'));
    } else {
      console.log(chalk.bold('Current Mode: ') + chalk.magenta('Repository Mode'));
      console.log(chalk.dim('  You are in repository update mode. Describe the changes you want.'));
    }
    console.log();
    console.log(chalk.bold('Example prompts:'));
    console.log(chalk.dim('  "Add a dark mode toggle to the header"'));
    console.log(chalk.dim('  "Fix the broken image on the homepage"'));
    console.log(chalk.dim('  "Add a contact form component"'));
    console.log(chalk.dim('  "Update the footer with new social links"'));
  } else if (state.isBuildMode) {
    console.log(chalk.bold('Current Mode: ') + chalk.green('Build Mode'));
    console.log(chalk.dim('  Build and deploy a complete app from scratch.'));
  } else if (state.isAutomateMode) {
    console.log(chalk.bold('Current Mode: ') + chalk.blue('Automate Mode'));
    console.log(chalk.dim('  Create AI agents and workflows with natural language.'));
    console.log();
    console.log(chalk.bold('Example prompts:'));
    console.log(chalk.dim('  "Create an agent that writes blog posts from my content"'));
    console.log(chalk.dim('  "Set up a workflow: scrape SEO data, write article, post to social"'));
    console.log(chalk.dim('  "Create a content agent that generates weekly newsletters"'));
    console.log(chalk.dim('  "Build a workflow that monitors competitors and creates reports"'));
    console.log();
    console.log(chalk.dim('  The AI will plan agents and workflows, then create them with your approval.'));
  } else if (state.isContentMode) {
    console.log(chalk.bold('Current Mode: ') + chalk.yellow('Content Mode'));
    console.log(chalk.dim('  Create and manage content with AI assistance.'));
    console.log();
    console.log(chalk.bold('Example prompts:'));
    console.log(chalk.dim('  "Create a blog post about AI trends"'));
    console.log(chalk.dim('  "Add 5 product descriptions for my store"'));
    console.log(chalk.dim('  "Generate an author profile for John Doe"'));
    console.log(chalk.dim('  "Set up a blog content model with posts and categories"'));
    console.log(chalk.dim('  "Update the homepage content"'));
    console.log();
    console.log(chalk.dim('  Actions require confirmation before executing.'));
  } else {
    console.log(chalk.bold('Current Mode: ') + chalk.blue('Ask Mode (read-only)'));
    console.log(chalk.dim('  Ask questions about your content and get AI-powered answers.'));
    console.log();
    console.log(chalk.bold('Example questions:'));
    console.log(chalk.dim('  "What object types are available?"'));
    console.log(chalk.dim('  "How do I structure a blog with categories?"'));
    console.log(chalk.dim('  "Explain how metafields work"'));
    console.log(chalk.dim('  "What is the best way to model products?"'));
  }

  console.log();
  console.log(chalk.bold('Mode Shortcuts:'));
  console.log(chalk.dim('  cosmic chat') + '             - Ask mode (read-only questions)');
  console.log(chalk.dim('  cosmic chat --content') + '   - Content mode (create/update content)');
  console.log(chalk.dim('  cosmic chat --build') + '     - Build a new app');
  console.log(chalk.dim('  cosmic chat --automate') + '  - Create agents & workflows');
  console.log(chalk.dim('  cosmic chat --repo') + '      - Update existing code');
  console.log();
  console.log(chalk.bold('Shortcut Commands:'));
  console.log(chalk.dim('  cosmic content') + '          - Same as cosmic chat --content');
  console.log(chalk.dim('  cosmic build') + '            - Same as cosmic chat --build');
  console.log(chalk.dim('  cosmic automate') + '         - Same as cosmic chat --automate');
  console.log(chalk.dim('  cosmic update') + '           - Same as cosmic chat --repo');
  console.log();
  console.log(chalk.bold('Context Options:'));
  console.log(chalk.dim('  --ctx <text>') + '            - Add custom context');
  console.log(chalk.dim('  -t, --types <slugs>') + '     - Include object types (comma-separated)');
  console.log(chalk.dim('  -l, --links <urls>') + '      - Include external URLs (comma-separated)');
  console.log();
}
