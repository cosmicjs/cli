/**
 * Spinner Utility
 * Loading indicators for async operations
 */

import ora, { Ora } from 'ora';

let currentSpinner: Ora | null = null;

/**
 * Start a spinner with a message
 */
export function start(message: string): Ora {
  // Stop any existing spinner
  if (currentSpinner) {
    currentSpinner.stop();
  }

  currentSpinner = ora({
    text: message,
    spinner: 'dots',
    // Don't discard stdin - this interferes with readline in interactive mode
    discardStdin: false,
  }).start();

  return currentSpinner;
}

/**
 * Update the spinner message
 */
export function update(message: string): void {
  if (currentSpinner) {
    currentSpinner.text = message;
  }
}

/**
 * Stop the spinner with a success message
 */
export function succeed(message?: string): void {
  if (currentSpinner) {
    currentSpinner.succeed(message);
    currentSpinner = null;
  }
}

/**
 * Stop the spinner with a failure message
 */
export function fail(message?: string): void {
  if (currentSpinner) {
    currentSpinner.fail(message);
    currentSpinner = null;
  }
}

/**
 * Stop the spinner with a warning message
 */
export function warn(message?: string): void {
  if (currentSpinner) {
    currentSpinner.warn(message);
    currentSpinner = null;
  }
}

/**
 * Stop the spinner with an info message
 */
export function info(message?: string): void {
  if (currentSpinner) {
    currentSpinner.info(message);
    currentSpinner = null;
  }
}

/**
 * Stop the spinner without any symbol
 */
export function stop(): void {
  if (currentSpinner) {
    currentSpinner.stop();
    currentSpinner = null;
  }
}

/**
 * Stop and clear the spinner
 */
export function clear(): void {
  if (currentSpinner) {
    currentSpinner.stop();
    currentSpinner.clear();
    currentSpinner = null;
  }
}

/**
 * Run an async function with a spinner
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
  options: {
    successMessage?: string;
    failureMessage?: string;
  } = {}
): Promise<T> {
  const spinner = start(message);

  try {
    const result = await fn();
    spinner.succeed(options.successMessage);
    return result;
  } catch (error) {
    spinner.fail(options.failureMessage || (error as Error).message);
    throw error;
  }
}

export default {
  start,
  update,
  succeed,
  fail,
  warn,
  info,
  stop,
  clear,
  withSpinner,
};
