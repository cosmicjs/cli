/**
 * Display Utilities
 * Helpers for terminal output formatting
 */

import chalk from 'chalk';
import Table from 'cli-table3';

/**
 * Print a success message
 */
export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

/**
 * Print an error message
 */
export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

/**
 * Print a warning message
 */
export function warning(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

/**
 * Print an info message
 */
export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

/**
 * Print a dim/secondary message
 */
export function dim(message: string): void {
  console.log(chalk.dim(message));
}

/**
 * Print a header
 */
export function header(message: string): void {
  console.log();
  console.log(chalk.bold.cyan(message));
  console.log(chalk.dim('─'.repeat(message.length)));
}

/**
 * Print a subheader
 */
export function subheader(message: string): void {
  console.log();
  console.log(chalk.bold(message));
}

/**
 * Print JSON data formatted
 */
export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Format a date string
 */
export function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return chalk.dim('-');
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a status badge
 */
export function formatStatus(status: string): string {
  switch (status.toLowerCase()) {
    case 'published':
    case 'active':
    case 'completed':
      return chalk.green(status);
    case 'draft':
    case 'pending':
      return chalk.yellow(status);
    case 'failed':
    case 'cancelled':
    case 'paused':
      return chalk.red(status);
    case 'running':
      return chalk.blue(status);
    default:
      return chalk.dim(status);
  }
}

/**
 * Truncate a string to a maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Create a table for displaying data
 */
export function createTable(options: {
  head: string[];
  colWidths?: number[];
}): Table.Table {
  return new Table({
    head: options.head.map((h) => chalk.bold.cyan(h)),
    colWidths: options.colWidths,
    style: {
      head: [],
      border: [],
    },
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
  });
}

/**
 * Print a key-value pair
 */
export function keyValue(key: string, value: string | number | undefined): void {
  const displayValue = value !== undefined ? String(value) : chalk.dim('-');
  console.log(`  ${chalk.dim(key + ':')} ${displayValue}`);
}

/**
 * Print a section with multiple key-value pairs
 */
export function section(title: string, items: Record<string, unknown>): void {
  subheader(title);
  for (const [key, value] of Object.entries(items)) {
    keyValue(key, value as string);
  }
}

/**
 * Print a divider line
 */
export function divider(): void {
  console.log(chalk.dim('─'.repeat(50)));
}

/**
 * Print empty line
 */
export function newline(): void {
  console.log();
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format a list of items
 */
export function list(items: string[], numbered = false): void {
  items.forEach((item, index) => {
    if (numbered) {
      console.log(`  ${chalk.dim(String(index + 1) + '.')} ${item}`);
    } else {
      console.log(`  ${chalk.dim('•')} ${item}`);
    }
  });
}

export default {
  success,
  error,
  warning,
  info,
  dim,
  header,
  subheader,
  json,
  formatDate,
  formatStatus,
  truncate,
  createTable,
  keyValue,
  section,
  divider,
  newline,
  formatBytes,
  list,
};
