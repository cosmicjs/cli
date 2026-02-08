/**
 * Billing Commands
 * Plan, addon, usage, and billing portal management
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireAuth } from '../config/context.js';
import { getCurrentProjectId } from '../config/store.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
import {
  listProjectPlans,
  addProjectPlanSubscription,
  cancelProjectPlanSubscription,
  listProjectAddons,
  addProjectAddonSubscription,
  cancelProjectAddonSubscription,
  addProjectUserAddon,
  addProjectBucketAddon,
  addProjectAITokensAddon,
  getProjectBillingPortalUrl,
  getProjectUsage,
} from '../api/dashboard/billing.js';
import { getProject } from '../api/dashboard/core.js';

/**
 * Require a project to be selected
 */
function requireProject(): string {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    throw new Error(
      'No project selected. Run `cosmic use` to set your workspace, then `cosmic cd` to navigate to a project.'
    );
  }
  return projectId;
}

/**
 * Format a price with commas: 1069.2 -> "$1,069.20/yr"
 */
function formatPrice(amount: number, interval: string): string {
  const formatted = amount % 1 === 0
    ? `$${amount.toLocaleString()}`
    : `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${formatted}/${interval}`;
}

const BILLING_URL = 'https://app.cosmicjs.com/account/billing';

/**
 * Open a URL in the system browser
 */
async function openInBrowser(url: string): Promise<void> {
  try {
    const { exec } = await import('child_process');
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} "${url}"`);
  } catch {
    // Silently fail if can't open browser
  }
}

/**
 * Show billing URL with option to open in browser.
 * For info contexts: show URL + hint. For error contexts: prompt to open.
 */
async function showBillingLink(context: 'manage' | 'setup'): Promise<void> {
  if (context === 'manage') {
    display.dim(`Manage billing at: ${chalk.cyan(BILLING_URL)} (run ${chalk.bold('billing open')} to open)`);
  } else {
    display.info(`Set up billing at: ${chalk.cyan(BILLING_URL)}`);
    try {
      const shouldOpen = await prompts.confirm({
        message: 'Open billing page in browser?',
        initial: true,
      });
      if (shouldOpen) {
        await openInBrowser(BILLING_URL);
      }
    } catch {
      // User cancelled prompt
    }
  }
}

// ============================================================================
// Plans
// ============================================================================

/**
 * List available plans
 */
async function listPlans(options: { json?: boolean }): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  try {
    spinner.start('Loading plans...');
    const plans = await listProjectPlans(projectId);
    spinner.succeed(`Found ${plans.length} plan(s)`);

    if (plans.length === 0) {
      display.info('No plans available');
      return;
    }

    if (options.json) {
      display.json(plans);
      return;
    }

    const table = display.createTable({
      head: ['Name', 'ID', 'Monthly', 'Yearly', 'Subscribed'],
    });

    for (const plan of plans) {
      const monthly = plan.pricing?.month;
      const yearly = plan.pricing?.year;

      table.push([
        chalk.cyan(plan.name),
        chalk.dim(plan.id),
        monthly ? formatPrice(monthly.amount, 'mo') : '-',
        yearly ? formatPrice(yearly.amount, 'yr') : '-',
        plan.is_subscribed ? chalk.green('Yes') : chalk.dim('No'),
      ]);
    }

    console.log(table.toString());

    console.log();
    await showBillingLink('manage');
  } catch (error) {
    spinner.fail('Failed to load plans');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Subscribe to a plan
 */
async function subscribePlan(options: {
  priceId?: string;
  json?: boolean;
}): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  let priceId = options.priceId;

  if (!priceId) {
    // Fetch plans and let user pick
    try {
      spinner.start('Loading plans...');
      const plans = await listProjectPlans(projectId);
      spinner.succeed();

      const choices: { name: string; message: string }[] = [];
      for (const plan of plans) {
        for (const [interval, price] of Object.entries(plan.pricing || {})) {
          const priceStr = price.amount ? formatPrice(price.amount, interval) : 'Free';
          choices.push({
            name: price.id,
            message: `${plan.name} - ${priceStr}${price.is_subscribed ? ' (current)' : ''}`,
          });
        }
      }

      if (choices.length === 0) {
        display.error('No plans available');
        process.exit(1);
      }

      priceId = await prompts.select({
        message: 'Select a plan:',
        choices,
      });
    } catch (error) {
      spinner.fail('Failed to load plans');
      display.error((error as Error).message);
      process.exit(1);
    }
  }

  const confirmed = await prompts.confirm({
    message: 'Subscribe to this plan?',
    initial: true,
  });
  if (!confirmed) {
    display.info('Cancelled');
    return;
  }

  try {
    spinner.start('Subscribing to plan...');
    const result = await addProjectPlanSubscription(projectId, priceId);
    spinner.succeed(result.message || 'Successfully subscribed to plan');
  } catch (error) {
    spinner.fail('Failed to subscribe to plan');
    const msg = (error as Error).message;
    display.error(msg);
    if (msg.includes('not setup')) {
      console.log();
      await showBillingLink('setup');
    }
    process.exit(1);
  }
}

/**
 * Cancel plan subscription
 */
async function cancelPlan(options: { force?: boolean }): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: 'Cancel your current plan subscription? This will downgrade your project.',
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Cancelling plan...');
    const result = await cancelProjectPlanSubscription(projectId);
    spinner.succeed(result.message || 'Successfully cancelled plan');
  } catch (error) {
    spinner.fail('Failed to cancel plan');
    display.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Addons
// ============================================================================

/**
 * List available addons
 */
async function listAddons(options: { json?: boolean }): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  try {
    spinner.start('Loading addons...');
    const [addons, project] = await Promise.all([
      listProjectAddons(projectId),
      getProject(projectId),
    ]);
    spinner.succeed(`Found ${addons.length} addon(s)`);

    if (addons.length === 0) {
      display.info('No addons available');
      return;
    }

    if (options.json) {
      display.json(addons);
      return;
    }

    // Build a map of quantity info from the project
    const quantities: Record<string, number | string> = {};
    if (project.additional_users) quantities['team'] = project.additional_users;
    if (project.additional_buckets) quantities['bucket'] = project.additional_buckets;
    if (project.additional_ai_tokens?.input_tokens) quantities['ai_input'] = project.additional_ai_tokens.input_tokens;
    if (project.additional_ai_tokens?.output_tokens) quantities['ai_output'] = project.additional_ai_tokens.output_tokens;

    const table = display.createTable({
      head: ['Name', 'ID', 'Monthly', 'Yearly', 'Subscribed'],
    });

    for (const addon of addons) {
      const monthly = addon.pricing?.month;
      const yearly = addon.pricing?.year;

      // For quantity-based addons, show "per unit" in the price
      const suffix = addon.is_additional ? ' ea' : '';

      // Determine subscription status with actual quantities
      let subscribed: string;
      if (addon.is_additional) {
        const nameLower = addon.name.toLowerCase();
        let qty = 0;
        if (nameLower.includes('bucket')) qty = (quantities['bucket'] as number) || 0;
        else if (nameLower.includes('team') || nameLower.includes('user')) qty = (quantities['team'] as number) || 0;
        else if (nameLower.includes('ai') && nameLower.includes('input')) qty = (quantities['ai_input'] as number) || 0;
        else if (nameLower.includes('ai') && nameLower.includes('output')) qty = (quantities['ai_output'] as number) || 0;

        subscribed = qty > 0 ? chalk.green(`${qty}`) : chalk.dim('0');
      } else {
        subscribed = addon.is_subscribed ? chalk.green('Yes') : chalk.dim('No');
      }

      table.push([
        chalk.cyan(addon.name),
        chalk.dim(addon.id),
        monthly ? formatPrice(monthly.amount, 'mo') + suffix : '-',
        yearly ? formatPrice(yearly.amount, 'yr') + suffix : '-',
        subscribed,
      ]);
    }

    console.log(table.toString());

    console.log();
    await showBillingLink('manage');
  } catch (error) {
    spinner.fail('Failed to load addons');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Subscribe to an addon
 */
async function subscribeAddon(options: {
  addonId?: string;
  priceId?: string;
  quantity?: string;
  json?: boolean;
}): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  let addonId = options.addonId;
  let priceId = options.priceId;

  let selectedAddonName = '';

  if (!addonId || !priceId) {
    try {
      spinner.start('Loading addons...');
      const [addons, project] = await Promise.all([
        listProjectAddons(projectId),
        getProject(projectId),
      ]);
      spinner.succeed();

      const choices: { name: string; message: string }[] = [];
      let aiTokensAdded = false;
      for (const addon of addons) {
        const nameLower = addon.name.toLowerCase();
        // Combine AI input/output token addons into a single selection
        if (addon.is_additional && nameLower.includes('ai') && (nameLower.includes('input') || nameLower.includes('output'))) {
          if (!aiTokensAdded) {
            const inputQty = project.additional_ai_tokens?.input_tokens || 0;
            const outputQty = project.additional_ai_tokens?.output_tokens || 0;
            const currentLabel = (inputQty || outputQty) ? ` (current: ${inputQty}M input, ${outputQty}M output)` : '';
            choices.push({
              name: `ai_tokens::::1::Additional AI tokens`,
              message: `Additional AI tokens - input $5/mo ea, output $19/mo ea${currentLabel}`,
            });
            aiTokensAdded = true;
          }
          continue;
        }

        // For quantity-based addons (buckets, users), show current quantity
        if (addon.is_additional) {
          let currentQty = 0;
          if (nameLower.includes('bucket')) currentQty = project.additional_buckets || 0;
          else if (nameLower.includes('team') || nameLower.includes('user')) currentQty = project.additional_users || 0;
          const monthly = addon.pricing?.month;
          const priceStr = monthly ? formatPrice(monthly.amount, 'mo') : '';
          const currentLabel = currentQty > 0 ? ` (current: ${currentQty})` : '';
          choices.push({
            name: `${addon.id}::${monthly?.id || ''}::1::${addon.name}`,
            message: `${addon.name} - ${priceStr} ea${currentLabel}`,
          });
          continue;
        }

        // Regular addons: show each price interval, mark subscribed
        for (const [interval, price] of Object.entries(addon.pricing || {})) {
          const priceStr = price.amount ? formatPrice(price.amount, interval) : 'Free';
          const subscribed = addon.is_subscribed && price.is_subscribed;
          choices.push({
            name: `${addon.id}::${price.id}::0::${addon.name}`,
            message: `${addon.name} - ${priceStr}${subscribed ? ' (subscribed)' : ''}`,
          });
        }
      }

      if (choices.length === 0) {
        display.error('No addons available');
        process.exit(1);
      }

      const selected = await prompts.select({
        message: 'Select an addon:',
        choices,
      });

      const parts = selected.split('::');
      addonId = parts[0];
      priceId = parts[1];
      const isAdditional = parts[2] === '1';
      selectedAddonName = parts.slice(3).join('::');

      // Quantity-based addons use dedicated endpoints, not addAddonSubscription
      if (isAdditional) {
        const nameLower = selectedAddonName.toLowerCase();
        const isAITokenAddon = nameLower.includes('ai') && nameLower.includes('token');

        let quantity = 0;
        let inputTokens = 0;
        let outputTokens = 0;

        if (isAITokenAddon) {
          // AI tokens must always send both input and output values together
          // (backend replaces both; sending 0 for one resets it)
          // Default to current project values so user sees what's already set
          const currentInput = project.additional_ai_tokens?.input_tokens || 0;
          const currentOutput = project.additional_ai_tokens?.output_tokens || 0;

          const values = await prompts.form<{ input_tokens: string; output_tokens: string }>({
            message: 'Set AI token quantities (in millions, 0 to cancel):',
            choices: [
              { name: 'input_tokens', message: 'Input tokens', initial: String(currentInput) },
              { name: 'output_tokens', message: 'Output tokens', initial: String(currentOutput) },
            ],
          });
          inputTokens = parseInt(values.input_tokens, 10) || 0;
          outputTokens = parseInt(values.output_tokens, 10) || 0;
        } else {
          // Default to current quantity for buckets/users
          let currentQty = 1;
          if (nameLower.includes('bucket')) currentQty = project.additional_buckets || 1;
          else if (nameLower.includes('team') || nameLower.includes('user')) currentQty = project.additional_users || 1;

          quantity = options.quantity
            ? parseInt(options.quantity, 10)
            : await prompts.number({
              message: 'Quantity (0 to cancel):',
              initial: currentQty,
              min: 0,
            });
        }

        const confirmMsg = isAITokenAddon
          ? `Update AI tokens to ${inputTokens}M input, ${outputTokens}M output?`
          : `Set ${selectedAddonName} to ${quantity}?`;
        const addonConfirmed = await prompts.confirm({
          message: confirmMsg,
          initial: true,
        });
        if (!addonConfirmed) {
          display.info('Cancelled');
          return;
        }

        try {
          const spinnerMsg = isAITokenAddon
            ? `Updating AI tokens (input: ${inputTokens}M, output: ${outputTokens}M)...`
            : `Updating ${selectedAddonName}...`;
          spinner.start(spinnerMsg);
          let result: { message: string };
          if (nameLower.includes('bucket')) {
            result = await addProjectBucketAddon(projectId, quantity);
          } else if (nameLower.includes('team') || nameLower.includes('user')) {
            result = await addProjectUserAddon(projectId, quantity);
          } else if (isAITokenAddon) {
            result = await addProjectAITokensAddon(projectId, inputTokens, outputTokens);
          } else {
            // Fallback to generic
            result = await addProjectAddonSubscription(projectId, addonId!, priceId!);
          }
          spinner.succeed(result.message);
        } catch (error) {
          spinner.fail(`Failed to update ${selectedAddonName}`);
          const msg = (error as Error).message;
          display.error(msg);
          if (msg.includes('not setup')) {
            console.log();
            await showBillingLink('setup');
          }
          process.exit(1);
        }
        return;
      }
    } catch (error) {
      spinner.fail('Failed to load addons');
      display.error((error as Error).message);
      process.exit(1);
    }
  }

  const confirmAddon = await prompts.confirm({
    message: `Subscribe to ${selectedAddonName || 'this addon'}?`,
    initial: true,
  });
  if (!confirmAddon) {
    display.info('Cancelled');
    return;
  }

  try {
    spinner.start('Subscribing to addon...');
    const result = await addProjectAddonSubscription(projectId, addonId!, priceId!);
    spinner.succeed(result.message || 'Successfully subscribed to addon');
  } catch (error) {
    spinner.fail('Failed to subscribe to addon');
    const msg = (error as Error).message;
    display.error(msg);
    if (msg.includes('not setup')) {
      console.log();
      await showBillingLink('setup');
    }
    process.exit(1);
  }
}

/**
 * Cancel an addon subscription
 */
async function cancelAddon(
  addonId: string,
  options: { force?: boolean }
): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Cancel addon subscription "${addonId}"?`,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Cancelling addon...');
    const result = await cancelProjectAddonSubscription(projectId, addonId);
    spinner.succeed(result.message || 'Successfully cancelled addon');
  } catch (error) {
    spinner.fail('Failed to cancel addon');
    display.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Usage & Portal
// ============================================================================

/**
 * Parse a human-readable limit string like "1k", "10k", "1GB", "1M", "300k" into a number.
 * Returns the numeric value (bytes for storage, count for everything else).
 */
function parseLimit(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;

  const str = value.trim().toLowerCase();

  // Storage units
  if (str.endsWith('gb')) return parseFloat(str) * 1_000_000_000;
  if (str.endsWith('mb')) return parseFloat(str) * 1_000_000;
  if (str.endsWith('kb')) return parseFloat(str) * 1_000;
  if (str.endsWith('tb')) return parseFloat(str) * 1_000_000_000_000;

  // Count multipliers
  if (str.endsWith('m')) return parseFloat(str) * 1_000_000;
  if (str.endsWith('k')) return parseFloat(str) * 1_000;

  return parseFloat(str) || 0;
}

/**
 * Format a usage bar like: 41 / 10k (0.4%)
 */
function formatUsageLine(used: number | undefined, limit: string | number | undefined, opts?: { bytes?: boolean }): string {
  const usedVal = used ?? 0;
  const limitVal = parseLimit(limit);
  const limitStr = typeof limit === 'string' ? limit : (limit ?? 0).toLocaleString();

  const usedStr = opts?.bytes ? display.formatBytes(usedVal) : usedVal.toLocaleString();
  const limitDisplay = opts?.bytes && typeof limit === 'string' ? limit : limitStr;

  if (limitVal > 0) {
    const pct = ((usedVal / limitVal) * 100).toFixed(1);
    return `${usedStr} / ${limitDisplay} (${pct}%)`;
  }
  return usedStr;
}

/**
 * Show project usage
 */
async function showUsage(options: { json?: boolean }): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  try {
    spinner.start('Loading usage...');
    const data = await getProjectUsage(projectId);
    spinner.succeed('Usage loaded');

    if (options.json) {
      display.json(data);
      return;
    }

    const { usage, plan_info } = data;

    // Objects & Types
    display.header('Objects');
    display.keyValue('Objects', formatUsageLine(usage.total_objects, plan_info.max_objects));
    display.keyValue('Object Types', formatUsageLine(usage.total_object_types, plan_info.max_object_types));

    // API Requests
    console.log();
    display.header('API Requests');
    display.keyValue('Non-Cached', formatUsageLine(usage.api_requests?.non_cached, plan_info.api_requests?.max_non_cached));
    display.keyValue('Cached', formatUsageLine(usage.api_requests?.cached, plan_info.api_requests?.max_cached));
    display.keyValue('Bandwidth', formatUsageLine(usage.api_requests?.bandwidth, plan_info.api_requests?.max_bandwidth, { bytes: true }));

    // Media
    console.log();
    display.header('Media');
    display.keyValue('Files', formatUsageLine(usage.media?.files, plan_info.media?.max_files));
    display.keyValue('Storage', formatUsageLine(usage.media?.storage, plan_info.media?.max_storage, { bytes: true }));
    display.keyValue('Requests', formatUsageLine(usage.media?.requests, plan_info.media?.max_requests));
    display.keyValue('Bandwidth', formatUsageLine(usage.media?.bandwidth, plan_info.media?.max_bandwidth, { bytes: true }));

    // AI
    console.log();
    display.header('AI Tokens');
    display.keyValue('Input Tokens', formatUsageLine(usage.ai?.input_tokens, plan_info.ai_tokens?.max_input));
    display.keyValue('Output Tokens', formatUsageLine(usage.ai?.output_tokens, plan_info.ai_tokens?.max_output));

    // Agents
    console.log();
    display.header('Agents');
    display.keyValue('Agents', formatUsageLine(usage.agents?.total_agents, plan_info.max_agents));
  } catch (error) {
    spinner.fail('Failed to load usage');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Open billing portal
 */
async function openPortal(): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  try {
    spinner.start('Getting billing portal URL...');
    const { url } = await getProjectBillingPortalUrl(projectId);
    spinner.succeed('Billing portal URL ready');

    console.log();
    console.log(`  ${chalk.cyan(url)}`);
    console.log();
    display.info('Open this URL in your browser to manage payment methods, view invoices, and more.');

    await openInBrowser(url);
  } catch (error) {
    spinner.fail('Failed to get billing portal URL');
    const msg = (error as Error).message;
    display.error(msg);
    if (msg.includes('not setup')) {
      console.log();
      await showBillingLink('setup');
    }
    process.exit(1);
  }
}

/**
 * Open billing page directly in browser
 */
async function openBillingPage(): Promise<void> {
  display.info(`Opening ${chalk.cyan(BILLING_URL)}`);
  await openInBrowser(BILLING_URL);
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Create billing commands
 */
export function createBillingCommands(program: Command): void {
  const billingCmd = program
    .command('billing')
    .description('Manage billing, plans, and addons');

  // Usage
  billingCmd
    .command('usage')
    .description('Show project usage statistics')
    .option('--json', 'Output as JSON')
    .action(showUsage);

  // Open billing page in browser
  billingCmd
    .command('open')
    .description('Open billing page in browser')
    .action(openBillingPage);

  // Portal
  billingCmd
    .command('portal')
    .description('Open Stripe billing portal in browser')
    .action(openPortal);

  // Plans
  const plansCmd = billingCmd
    .command('plans')
    .description('Manage plan subscriptions');

  plansCmd
    .command('list')
    .alias('ls')
    .description('List available plans')
    .option('--json', 'Output as JSON')
    .action(listPlans);

  plansCmd
    .command('subscribe')
    .alias('upgrade')
    .description('Subscribe to a plan')
    .option('--price-id <priceId>', 'Stripe price ID')
    .option('--json', 'Output as JSON')
    .action(subscribePlan);

  plansCmd
    .command('cancel')
    .description('Cancel current plan subscription')
    .option('-f, --force', 'Skip confirmation')
    .action(cancelPlan);

  // Addons
  const addonsCmd = billingCmd
    .command('addons')
    .description('Manage addon subscriptions');

  addonsCmd
    .command('list')
    .alias('ls')
    .description('List available addons')
    .option('--json', 'Output as JSON')
    .action(listAddons);

  addonsCmd
    .command('subscribe')
    .alias('add')
    .description('Subscribe to an addon')
    .option('--addon-id <addonId>', 'Stripe addon/product ID')
    .option('--price-id <priceId>', 'Stripe price ID')
    .option('-q, --quantity <number>', 'Quantity (for per-unit addons)')
    .option('--json', 'Output as JSON')
    .action(subscribeAddon);

  addonsCmd
    .command('cancel <addonId>')
    .alias('rm')
    .description('Cancel an addon subscription')
    .option('-f, --force', 'Skip confirmation')
    .action(cancelAddon);
}

export default { createBillingCommands };
