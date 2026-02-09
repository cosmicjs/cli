/**
 * AI Error Handling Utilities
 * Centralized detection and handling of AI token limit / payment errors
 */

import chalk from 'chalk';

const BILLING_URL = 'https://app.cosmicjs.com/account/billing';

/**
 * Error patterns that indicate an AI token limit or payment-required issue.
 * The backend returns 402 PaymentRequired with these message patterns.
 */
const TOKEN_LIMIT_PATTERNS = [
  'token usage limit',
  'AI token usage limit',
  'INSUFFICIENT_CREDITS',
  'insufficient_credits',
  'payment required',
  'Payment Required',
];

/**
 * Check if an error is an AI token limit / payment-required error.
 * Works with Error objects, HTTP status codes embedded in messages,
 * and backend-specific error codes.
 */
export function isAITokenLimitError(error: unknown): boolean {
  if (!error) return false;

  const message = getErrorMessage(error);

  // Check message patterns
  for (const pattern of TOKEN_LIMIT_PATTERNS) {
    if (message.toLowerCase().includes(pattern.toLowerCase())) {
      return true;
    }
  }

  // Check for HTTP 402 status in the error
  if (typeof error === 'object' && error !== null) {
    const errObj = error as {
      status?: number;
      statusCode?: number;
      response?: { status?: number };
    };
    if (
      errObj.status === 402 ||
      errObj.statusCode === 402 ||
      errObj.response?.status === 402
    ) {
      return true;
    }
  }

  // Check for "HTTP error: 402" in the message (from our streaming API)
  if (message.includes('HTTP error: 402')) {
    return true;
  }

  return false;
}

/**
 * Extract the error message from various error types.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    return (
      (obj.message as string) ||
      (obj.error as string) ||
      ''
    );
  }
  return String(error);
}

/**
 * Display a user-friendly AI token limit error with upgrade options.
 * Used across all CLI commands and the chat REPL.
 *
 * @param error - The original error (used to extract details)
 * @param context - Optional context like { model } for richer messaging
 */
export function showAITokenUpgradePrompt(
  error?: unknown,
  context?: { model?: string }
): void {
  const message = error ? getErrorMessage(error) : '';

  console.log();
  console.log(chalk.red('✗ AI Token Limit Reached'));
  console.log();
  console.log(chalk.dim('  Your AI token usage limit has been exceeded.'));

  // If the backend included model/tier info, show it
  const tierMatch = message.match(/Model\s+(\S+)\s+\((\w+)\s+tier,\s+(\d+)x\s+cost\)/i);
  if (tierMatch) {
    console.log(chalk.dim(`  Model "${tierMatch[1]}" is ${tierMatch[2]} tier (${tierMatch[3]}x token cost).`));
  } else if (context?.model) {
    console.log(chalk.dim(`  Current model: "${context.model}"`));
  }

  console.log();
  console.log(chalk.yellow('  Upgrade options:'));
  console.log(chalk.dim('  1. Add more AI tokens:          ') + chalk.cyan('cosmic billing addons subscribe'));
  console.log(chalk.dim('  2. Upgrade your plan:            ') + chalk.cyan('cosmic billing plans upgrade'));
  console.log(chalk.dim('  3. Use a lighter model:          ') + chalk.cyan('cosmic config set defaultModel <model>'));
  console.log(chalk.dim('  4. View current usage:           ') + chalk.cyan('cosmic billing usage'));
  console.log(chalk.dim('  5. Open billing in browser:      ') + chalk.cyan(BILLING_URL));
  console.log();
}

/**
 * Open the billing page in the system browser.
 */
export async function openBillingPage(): Promise<void> {
  try {
    const { exec } = await import('child_process');
    const platform = process.platform;
    const cmd =
      platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} "${BILLING_URL}"`);
  } catch {
    // Silently fail if can't open browser
  }
}

export default { isAITokenLimitError, showAITokenUpgradePrompt, openBillingPage };
