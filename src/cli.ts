#!/usr/bin/env node

import { Command } from 'commander';
import { syncDown, syncUp, detectConflicts } from './sync.js';

const program = new Command();

program
  .name('issync')
  .description('bidirectional github issue syncing')
  .version('0.2.1');

program
  .command('down')
  .description('sync issues from github to local')
  .option('--closed', 'include closed issues')
  .option('--full', 'force full sync (skip incremental)')
  .option('--projects', 'sync github projects v2 custom fields')
  .action(async (options) => {
    try {
      await syncDown(options.closed, options.full, options.projects);
    } catch (error) {
      console.error(`error: ${error}`);
      process.exit(1);
    }
  });

program
  .command('up')
  .description('sync local changes to github')
  .option('--force', 'force update even if conflicts detected')
  .option('--dry-run', 'show what would be updated without making changes')
  .option('--projects', 'sync github projects v2 custom fields')
  .action(async (options) => {
    try {
      await syncUp(options.force, options.dryRun, options.projects);
    } catch (error) {
      console.error(`error: ${error}`);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('bidirectional sync (down then up)')
  .option('--closed', 'include closed issues')
  .option('--force', 'force update even if conflicts detected')
  .option('--dry-run', 'show what would be updated without making changes')
  .option('--full', 'force full sync (skip incremental)')
  .option('--projects', 'sync github projects v2 custom fields')
  .action(async (options) => {
    try {
      await syncDown(options.closed, options.full, options.projects);
      console.log('');
      await syncUp(options.force, options.dryRun, options.projects);
    } catch (error) {
      console.error(`error: ${error}`);
      process.exit(1);
    }
  });

program
  .command('conflicts')
  .description('detect conflicts between local and remote')
  .action(async () => {
    try {
      const conflicts = await detectConflicts();

      if (conflicts.length === 0) {
        console.log('no conflicts detected');
        return;
      }

      console.log(`found ${conflicts.length} conflict(s):\n`);
      for (const c of conflicts) {
        console.log(`issue #${c.number}: ${c.title}`);
        console.log(`  github updated: ${c.github_updated}`);
        console.log(`  local updated:  ${c.local_updated}`);
        console.log(`  last synced:    ${c.last_synced}\n`);
      }
    } catch (error) {
      console.error(`error: ${error}`);
      process.exit(1);
    }
  });

program.parse();
