/**
 * Team Commands
 * Manage project team members
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireAuth } from '../config/context.js';
import { getCurrentProjectId } from '../config/store.js';
import * as display from '../utils/display.js';
import * as spinner from '../utils/spinner.js';
import * as prompts from '../utils/prompts.js';
import {
  listProjectTeam,
  addProjectTeamMember,
  updateProjectTeamMember,
  removeProjectTeamMember,
} from '../api/dashboard/team.js';

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
 * List team members
 */
async function listTeam(options: { json?: boolean }): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  try {
    spinner.start('Loading team members...');
    const team = await listProjectTeam(projectId);
    spinner.succeed(`Found ${team.length} team member(s)`);

    if (team.length === 0) {
      display.info('No team members found');
      return;
    }

    if (options.json) {
      display.json(team);
      return;
    }

    const table = display.createTable({
      head: ['Email', 'Name', 'Role', 'Status'],
    });

    for (const member of team) {
      const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || '-';
      table.push([
        chalk.cyan(member.email),
        name,
        formatRole(member.project_role),
        member.status || '-',
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to load team members');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Add team member
 */
async function addTeamMember(
  email: string,
  options: { role?: string; json?: boolean }
): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  const role = (options.role ||
    (await prompts.select({
      message: 'Project role:',
      choices: [
        { name: 'admin' as const, message: 'Admin - Full access' },
        { name: 'manager' as const, message: 'Manager - Manage content and settings' },
        { name: 'user' as const, message: 'User - Content access based on bucket roles' },
      ],
    }))) as 'admin' | 'manager' | 'user';

  try {
    spinner.start('Adding team member...');
    await addProjectTeamMember(projectId, {
      users: [{ email, project_role: role }],
    });
    spinner.succeed(`Added ${chalk.cyan(email)} as ${formatRole(role)}`);
  } catch (error) {
    spinner.fail('Failed to add team member');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Update team member
 */
async function updateTeamMemberCmd(
  userId: string,
  options: { role?: string; json?: boolean }
): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  const role = (options.role ||
    (await prompts.select({
      message: 'New project role:',
      choices: [
        { name: 'admin' as const, message: 'Admin - Full access' },
        { name: 'manager' as const, message: 'Manager - Manage content and settings' },
        { name: 'user' as const, message: 'User - Content access based on bucket roles' },
      ],
    }))) as 'admin' | 'manager' | 'user';

  try {
    spinner.start('Updating team member...');
    await updateProjectTeamMember(projectId, userId, {
      project_role: role,
    });
    spinner.succeed(`Updated team member role to ${formatRole(role)}`);
  } catch (error) {
    spinner.fail('Failed to update team member');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Remove team member
 */
async function removeTeamMember(
  userId: string,
  options: { force?: boolean }
): Promise<void> {
  requireAuth();
  const projectId = requireProject();

  if (!options.force) {
    const confirmed = await prompts.confirm({
      message: `Remove team member "${userId}" from this project?`,
    });

    if (!confirmed) {
      display.info('Cancelled');
      return;
    }
  }

  try {
    spinner.start('Removing team member...');
    await removeProjectTeamMember(projectId, userId);
    spinner.succeed('Removed team member');
  } catch (error) {
    spinner.fail('Failed to remove team member');
    display.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Format role for display
 */
function formatRole(role: string): string {
  switch (role) {
    case 'admin':
      return chalk.red('admin');
    case 'manager':
      return chalk.yellow('manager');
    case 'user':
      return chalk.blue('user');
    default:
      return role;
  }
}

/**
 * Create team commands
 */
export function createTeamCommands(program: Command): void {
  const teamCmd = program
    .command('team')
    .description('Manage project team members');

  teamCmd
    .command('list')
    .alias('ls')
    .description('List team members')
    .option('--json', 'Output as JSON')
    .action(listTeam);

  teamCmd
    .command('add <email>')
    .description('Add a team member')
    .option('-r, --role <role>', 'Project role (admin, manager, user)')
    .option('--json', 'Output as JSON')
    .action(addTeamMember);

  teamCmd
    .command('update <userId>')
    .alias('edit')
    .description('Update a team member role')
    .option('-r, --role <role>', 'New project role (admin, manager, user)')
    .option('--json', 'Output as JSON')
    .action(updateTeamMemberCmd);

  teamCmd
    .command('remove <userId>')
    .alias('rm')
    .description('Remove a team member')
    .option('-f, --force', 'Skip confirmation')
    .action(removeTeamMember);
}

export default { createTeamCommands };
