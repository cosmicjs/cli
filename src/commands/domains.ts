/**
 * Domains Commands
 * Domain and DNS record management
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireAuth } from '../config/context.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
import {
  listDomains as apiListDomains,
  getDomain as apiGetDomain,
  searchDomains as apiSearchDomains,
  importDomain as apiImportDomain,
  updateDomainSettings as apiUpdateDomainSettings,
  deleteDomain as apiDeleteDomain,
  connectDomain as apiConnectDomain,
  disconnectDomain as apiDisconnectDomain,
  listDnsRecords as apiListDnsRecords,
  createDnsRecord as apiCreateDnsRecord,
  updateDnsRecord as apiUpdateDnsRecord,
  deleteDnsRecord as apiDeleteDnsRecord,
} from '../api/dashboard/domains.js';

// ============================================================================
// Domain Commands
// ============================================================================

/**
 * List domains
 */
async function listDomains(options: { json?: boolean }): Promise<void> {
  requireAuth();

  try {
    spinner.start('Loading domains...');
    const domains = await apiListDomains();
    spinner.succeed(`Found ${domains.length} domain(s)`);

    if (domains.length === 0) {
      display.info('No domains found');
      return;
    }

    if (options.json) {
      display.json(domains);
      return;
    }

    const table = display.createTable({
      head: ['ID', 'Domain', 'Status', 'Auto-Renew', 'Expires'],
    });

    for (const d of domains) {
      table.push([
        chalk.dim(d.id),
        chalk.cyan(d.domain_name),
        d.status || '-',
        d.auto_renew ? chalk.green('Yes') : chalk.dim('No'),
        d.expires_at ? display.formatDate(d.expires_at) : '-',
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load domains');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Get domain details
 */
async function getDomainCmd(
  id: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    spinner.start('Loading domain...');
    const domain = await apiGetDomain(id);
    spinner.succeed();

    if (options.json) {
      display.json(domain);
      return;
    }

    display.header(domain.domain_name);
    display.keyValue('ID', domain.id);
    display.keyValue('Status', domain.status || '-');
    display.keyValue('Auto-Renew', domain.auto_renew ? 'Yes' : 'No');
    if (domain.expires_at) display.keyValue('Expires', display.formatDate(domain.expires_at));
    if (domain.description) display.keyValue('Description', domain.description);
    if (domain.nameservers && domain.nameservers.length > 0) {
      display.keyValue('Nameservers', domain.nameservers.join(', '));
    }
    if (domain.repository_id) {
      display.keyValue('Connected Repo', domain.repository_id);
    }
  } catch (error) {
    spinner.fail('Failed to load domain');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Search for available domains
 */
async function searchDomainsCmd(
  query: string,
  options: { limit?: string; json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    spinner.start('Searching domains...');
    const limit = options.limit ? parseInt(options.limit, 10) : undefined;
    const suggestions = await apiSearchDomains(query, { limit });
    spinner.succeed(`Found ${suggestions.length} suggestion(s)`);

    if (suggestions.length === 0) {
      display.info('No domain suggestions found');
      return;
    }

    if (options.json) {
      display.json(suggestions);
      return;
    }

    const table = display.createTable({
      head: ['Domain', 'Available', 'Price', 'Premium'],
    });

    for (const s of suggestions) {
      table.push([
        chalk.cyan(s.name),
        s.available ? chalk.green('Yes') : chalk.red('No'),
        s.price ? `$${s.price}` : '-',
        s.premium ? chalk.yellow('Yes') : '-',
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to search domains');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Import an external domain
 */
async function importDomainCmd(
  domainName: string,
  options: { description?: string; json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    spinner.start('Importing domain...');
    const domain = await apiImportDomain({
      domain_name: domainName,
      description: options.description,
    });
    spinner.succeed(`Imported domain: ${chalk.cyan(domain.domain_name)}`);

    if (options.json) {
      display.json(domain);
    } else {
      display.keyValue('ID', domain.id);
      display.keyValue('Status', domain.status || '-');
    }
  } catch (error) {
    spinner.fail('Failed to import domain');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete domain
 */
async function deleteDomainCmd(
  id: string,
  options: { force?: boolean }
): Promise<void> {
  requireAuth();

  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Delete domain "${id}"? This cannot be undone.`,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Deleting domain...');
    await apiDeleteDomain(id);
    spinner.succeed('Deleted domain');
  } catch (error) {
    spinner.fail('Failed to delete domain');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Connect domain to repository
 */
async function connectDomainCmd(
  id: string,
  options: { repo?: string; redirect?: string; redirectCode?: string; json?: boolean }
): Promise<void> {
  requireAuth();

  const repositoryId =
    options.repo ||
    (await prompts.text({
      message: 'Repository ID to connect:',
      required: true,
    }));

  try {
    spinner.start('Connecting domain to repository...');
    await apiConnectDomain(id, {
      repository_id: repositoryId,
      redirect_url: options.redirect,
      redirect_status_code: options.redirectCode
        ? (parseInt(options.redirectCode, 10) as 301 | 302 | 307 | 308)
        : undefined,
    });
    spinner.succeed('Connected domain to repository');
  } catch (error) {
    spinner.fail('Failed to connect domain');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Disconnect domain from repository
 */
async function disconnectDomainCmd(
  id: string,
  options: { repo?: string }
): Promise<void> {
  requireAuth();

  const repositoryId =
    options.repo ||
    (await prompts.text({
      message: 'Repository ID to disconnect:',
      required: true,
    }));

  try {
    spinner.start('Disconnecting domain from repository...');
    await apiDisconnectDomain(id, { repository_id: repositoryId });
    spinner.succeed('Disconnected domain from repository');
  } catch (error) {
    spinner.fail('Failed to disconnect domain');
    display.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// DNS Commands
// ============================================================================

/**
 * List DNS records
 */
async function listDnsRecordsCmd(
  domainId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    spinner.start('Loading DNS records...');
    const records = await apiListDnsRecords(domainId);
    spinner.succeed(`Found ${records.length} DNS record(s)`);

    if (records.length === 0) {
      display.info('No DNS records found');
      return;
    }

    if (options.json) {
      display.json(records);
      return;
    }

    const table = display.createTable({
      head: ['ID', 'Type', 'Name', 'Value', 'TTL'],
    });

    for (const r of records) {
      table.push([
        chalk.dim(r.id),
        chalk.cyan(r.type),
        r.name,
        display.truncate(r.value, 40),
        String(r.ttl || 60),
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load DNS records');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Add DNS record
 */
async function addDnsRecordCmd(
  domainId: string,
  options: {
    type?: string;
    name?: string;
    value?: string;
    ttl?: string;
    comment?: string;
    json?: boolean;
  }
): Promise<void> {
  requireAuth();

  const type = (options.type ||
    (await prompts.select({
      message: 'Record type:',
      choices: [
        { title: 'A', value: 'A' },
        { title: 'AAAA', value: 'AAAA' },
        { title: 'CNAME', value: 'CNAME' },
        { title: 'MX', value: 'MX' },
        { title: 'TXT', value: 'TXT' },
        { title: 'SRV', value: 'SRV' },
        { title: 'NS', value: 'NS' },
      ],
    }))) as 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS';

  const name =
    options.name ||
    (await prompts.text({
      message: 'Record name:',
      required: true,
    }));

  const value =
    options.value ||
    (await prompts.text({
      message: 'Record value:',
      required: true,
    }));

  const ttl = options.ttl ? parseInt(options.ttl, 10) : undefined;

  try {
    spinner.start('Creating DNS record...');
    const record = await apiCreateDnsRecord(domainId, {
      type,
      name,
      value,
      ttl,
      comment: options.comment,
    });
    spinner.succeed(`Created ${chalk.cyan(type)} record for ${chalk.cyan(name)}`);

    if (options.json) {
      display.json(record);
    } else {
      display.keyValue('ID', record.id);
    }
  } catch (error) {
    spinner.fail('Failed to create DNS record');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Update DNS record
 */
async function updateDnsRecordCmd(
  domainId: string,
  recordId: string,
  options: {
    type?: string;
    name?: string;
    value?: string;
    ttl?: string;
    comment?: string;
    json?: boolean;
  }
): Promise<void> {
  requireAuth();

  const data: Record<string, unknown> = {};
  if (options.type) data.type = options.type;
  if (options.name) data.name = options.name;
  if (options.value) data.value = options.value;
  if (options.ttl) data.ttl = parseInt(options.ttl, 10);
  if (options.comment) data.comment = options.comment;

  if (Object.keys(data).length === 0) {
    display.error('No update fields provided. Use --type, --name, --value, --ttl, or --comment.');
    process.exit(1);
  }

  try {
    spinner.start('Updating DNS record...');
    const record = await apiUpdateDnsRecord(domainId, recordId, data);
    spinner.succeed(`Updated DNS record: ${chalk.cyan(record.id)}`);

    if (options.json) {
      display.json(record);
    }
  } catch (error) {
    spinner.fail('Failed to update DNS record');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete DNS record
 */
async function deleteDnsRecordCmd(
  domainId: string,
  recordId: string,
  options: { force?: boolean }
): Promise<void> {
  requireAuth();

  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Delete DNS record "${recordId}"? This cannot be undone.`,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Deleting DNS record...');
    await apiDeleteDnsRecord(domainId, recordId);
    spinner.succeed('Deleted DNS record');
  } catch (error) {
    spinner.fail('Failed to delete DNS record');
    display.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Create domains commands
 */
export function createDomainsCommands(program: Command): void {
  const domainsCmd = program
    .command('domains')
    .description('Manage domains and DNS records');

  domainsCmd
    .command('list')
    .alias('ls')
    .description('List all domains')
    .option('--json', 'Output as JSON')
    .action(listDomains);

  domainsCmd
    .command('get <id>')
    .description('Get domain details')
    .option('--json', 'Output as JSON')
    .action(getDomainCmd);

  domainsCmd
    .command('search <query>')
    .description('Search for available domains')
    .option('-l, --limit <number>', 'Limit results')
    .option('--json', 'Output as JSON')
    .action(searchDomainsCmd);

  domainsCmd
    .command('import <domain>')
    .description('Import an external domain')
    .option('-d, --description <description>', 'Domain description')
    .option('--json', 'Output as JSON')
    .action(importDomainCmd);

  domainsCmd
    .command('delete <id>')
    .alias('rm')
    .description('Delete a domain')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteDomainCmd);

  domainsCmd
    .command('connect <id>')
    .description('Connect domain to a repository')
    .option('-r, --repo <repoId>', 'Repository ID')
    .option('--redirect <url>', 'Redirect URL')
    .option('--redirect-code <code>', 'Redirect status code (301, 302, 307, 308)')
    .option('--json', 'Output as JSON')
    .action(connectDomainCmd);

  domainsCmd
    .command('disconnect <id>')
    .description('Disconnect domain from a repository')
    .option('-r, --repo <repoId>', 'Repository ID')
    .action(disconnectDomainCmd);

  // DNS subcommands
  const dnsCmd = domainsCmd
    .command('dns')
    .description('Manage DNS records for a domain');

  dnsCmd
    .command('list <domainId>')
    .alias('ls')
    .description('List DNS records')
    .option('--json', 'Output as JSON')
    .action(listDnsRecordsCmd);

  dnsCmd
    .command('add <domainId>')
    .description('Add a DNS record')
    .option('-t, --type <type>', 'Record type (A, AAAA, CNAME, MX, TXT, SRV, NS)')
    .option('-n, --name <name>', 'Record name')
    .option('-v, --value <value>', 'Record value')
    .option('--ttl <seconds>', 'TTL in seconds (60-86400)')
    .option('--comment <comment>', 'Record comment')
    .option('--json', 'Output as JSON')
    .action(addDnsRecordCmd);

  dnsCmd
    .command('update <domainId> <recordId>')
    .alias('edit')
    .description('Update a DNS record')
    .option('-t, --type <type>', 'New record type')
    .option('-n, --name <name>', 'New record name')
    .option('-v, --value <value>', 'New record value')
    .option('--ttl <seconds>', 'New TTL in seconds')
    .option('--comment <comment>', 'New comment')
    .option('--json', 'Output as JSON')
    .action(updateDnsRecordCmd);

  dnsCmd
    .command('delete <domainId> <recordId>')
    .alias('rm')
    .description('Delete a DNS record')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteDnsRecordCmd);
}

export default { createDomainsCommands };
