/**
 * Prompts Utility
 * Interactive user input helpers
 */

import Enquirer from 'enquirer';
const { prompt } = Enquirer as unknown as { prompt: typeof Enquirer.prompt };

/**
 * Prompt for text input
 */
export async function text(options: {
  message: string;
  initial?: string;
  required?: boolean;
}): Promise<string> {
  const response = await prompt<{ value: string }>({
    type: 'input',
    name: 'value',
    message: options.message,
    initial: options.initial,
    validate: options.required
      ? (value: string) => (value.trim() ? true : 'This field is required')
      : undefined,
  });

  return response.value;
}

/**
 * Prompt for password input
 */
export async function password(options: {
  message: string;
  required?: boolean;
}): Promise<string> {
  const response = await prompt<{ value: string }>({
    type: 'password',
    name: 'value',
    message: options.message,
    validate: options.required
      ? (value: string) => (value.trim() ? true : 'This field is required')
      : undefined,
  });

  return response.value;
}

/**
 * Prompt for confirmation
 */
export async function confirm(options: {
  message: string;
  initial?: boolean;
}): Promise<boolean> {
  const response = await prompt<{ value: boolean }>({
    type: 'confirm',
    name: 'value',
    message: options.message,
    initial: options.initial ?? false,
  });

  return response.value;
}

/**
 * Prompt for selection from a list
 */
export async function select<T extends string>(options: {
  message: string;
  choices: Array<{ name: T; message?: string; hint?: string } | T>;
  initial?: number;
}): Promise<T> {
  const response = await prompt<{ value: T }>({
    type: 'select',
    name: 'value',
    message: options.message,
    choices: options.choices.map((choice) =>
      typeof choice === 'string' ? { name: choice, message: choice } : choice
    ),
    initial: options.initial,
  });

  return response.value;
}

/**
 * Prompt for multiple selections from a list
 */
export async function multiselect<T extends string>(options: {
  message: string;
  choices: Array<{ name: T; message?: string; hint?: string } | T>;
  initial?: number[];
}): Promise<T[]> {
  const response = await prompt<{ value: T[] }>({
    type: 'multiselect',
    name: 'value',
    message: options.message,
    choices: options.choices.map((choice) =>
      typeof choice === 'string' ? { name: choice, message: choice } : choice
    ),
    initial: options.initial,
  });

  return response.value;
}

/**
 * Prompt for number input
 */
export async function number(options: {
  message: string;
  initial?: number;
  min?: number;
  max?: number;
}): Promise<number> {
  const response = await prompt<{ value: number }>({
    type: 'numeral',
    name: 'value',
    message: options.message,
    initial: options.initial,
    min: options.min,
    max: options.max,
  });

  return response.value;
}

/**
 * Prompt for autocomplete selection
 */
export async function autocomplete<T extends string>(options: {
  message: string;
  choices: Array<{ name: T; message?: string } | T>;
  limit?: number;
}): Promise<T> {
  const response = await prompt<{ value: T }>({
    type: 'autocomplete',
    name: 'value',
    message: options.message,
    choices: options.choices.map((choice) =>
      typeof choice === 'string' ? { name: choice, message: choice } : choice
    ),
    limit: options.limit || 10,
  });

  return response.value;
}

/**
 * Prompt for form input (multiple fields)
 */
export async function form<T extends Record<string, string>>(options: {
  message: string;
  choices: Array<{
    name: keyof T;
    message: string;
    initial?: string;
  }>;
}): Promise<T> {
  const response = await prompt<{ value: T }>({
    type: 'form',
    name: 'value',
    message: options.message,
    choices: options.choices,
  });

  return response.value;
}

export default {
  text,
  password,
  confirm,
  select,
  multiselect,
  number,
  autocomplete,
  form,
};
