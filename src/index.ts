#!/usr/bin/env node
import { Command } from 'commander';
import { GitService } from './services/git';
import { emitOutput } from './utils/output';
import { runInteractiveMode } from './commands/interactive';

const program = new Command();
program
  .name('wt-agent')
  .description('Agentic CLI for managing Git Worktrees deterministically')
  .version('1.0.0')
  .option('--json', 'Output in JSON format (default for agent execution)', false)
  .option('--human', 'Output in human-readable format', false);

// Helper to determine output format
const getFormatOptions = () => {
  const opts = program.opts();
  // Default to JSON unless human is explicitly passed
  return { json: !opts.human };
};

const handleCommand = (fn: (git: GitService, ...cmdArgs: any[]) => any) => {
  return (...args: any[]) => {
    const opts = getFormatOptions();
    try {
      const git = new GitService();
      // args includes command arguments and the commander OptionValues object at the end
      const result = fn(git, ...args);
      emitOutput(opts, true, result, 'Operation completed successfully');
    } catch (error: any) {
      emitOutput(opts, false, undefined, error.message, 'WT_ERR', error.message);
    }
  };
};

program
  .command('create <feature>')
  .description('Create a new worktree for a feature')
  .option('-b, --base <base>', 'Base branch', 'main')
  .option('--hook <hook>', 'Command to run after creating the worktree')
  .option('--isolate-deps', 'Automatically symlink or install dependencies locally for this worktree', false)
  .action(handleCommand((git: GitService, feature: string, options: any) => {
    return git.addWorktree(feature, options.base, options.hook, options.isolateDeps);
  }));

program
  .command('list')
  .description('List all active feature worktrees')
  .action(handleCommand((git: GitService) => {
    return git.listWorktrees();
  }));

program
  .command('switch <feature>')
  .description('Get the deterministic path to a feature worktree')
  .action(handleCommand((git: GitService, feature: string) => {
    return { path: git.getWorktreePath(feature) };
  }));

program
  .command('remove <feature>')
  .description('Remove a worktree safely')
  .option('-f, --force', 'Force removal of dirty worktree', false)
  .action(handleCommand((git: GitService, feature: string, options: any) => {
    git.removeWorktree(feature, options.force);
    return { removed: feature };
  }));

program
  .command('sync <feature>')
  .description('Sync a worktree with remote origin base')
  .option('-b, --base <base>', 'Base branch to rebase against', 'main')
  .option('--hook <hook>', 'Command to run after syncing the worktree')
  .option('--isolate-deps', 'Automatically symlink or install dependencies locally for this worktree', false)
  .action(handleCommand((git: GitService, feature: string, options: any) => {
    return git.syncWorktree(feature, options.base, options.hook, options.isolateDeps);
  }));

program
  .command('lock <feature> <agentId>')
  .description('Lock a worktree for a specific agent')
  .action(handleCommand((git: GitService, feature: string, agentId: string) => {
    git.lockWorktree(feature, agentId);
    return { locked: feature, by: agentId };
  }));

program
  .command('unlock <feature> <agentId>')
  .description('Unlock a worktree')
  .option('-f, --force', 'Force unlock even if locked by another agent', false)
  .action(handleCommand((git: GitService, feature: string, agentId: string, options: any) => {
    git.unlockWorktree(feature, agentId, options.force);
    return { unlocked: feature };
  }));

program
  .command('checkpoint-save <feature> <message>')
  .description('Save a fast snapshot of the worktree state for trial & error')
  .action(handleCommand((git: GitService, feature: string, message: string) => {
    return git.checkpointSave(feature, message);
  }));

program
  .command('checkpoint-restore <feature>')
  .description('Restore a worktree to the state before the last checkpoint')
  .action(handleCommand((git: GitService, feature: string) => {
    return git.checkpointRestore(feature);
  }));

program
  .command('gc')
  .description('Garbage collect merged worktrees')
  .option('-b, --base <base>', 'Base branch to check against', 'main')
  .action(handleCommand((git: GitService, options: any) => {
    return git.gc(options.base);
  }));

program
  .command('doctor')
  .description('Analyze environment health for agents')
  .action(handleCommand((git: GitService) => {
    return git.doctor();
  }));

program
  .command('status <feature>')
  .description('Get structured JSON status of a worktree, including conflict parsing')
  .action(handleCommand((git: GitService, feature: string) => {
    return git.status(feature);
  }));

program
  .command('resolve-continue <feature>')
  .description('Continue rebase/merge after conflicts are resolved')
  .action(handleCommand((git: GitService, feature: string) => {
    return git.resolveContinue(feature);
  }));

program
  .command('context-set <feature> <context>')
  .description('Set shared context metadata for a worktree')
  .action(handleCommand((git: GitService, feature: string, context: string) => {
    git.contextSet(feature, context);
    return { feature, context };
  }));

program
  .command('context-get <feature>')
  .description('Get shared context metadata for a worktree')
  .action(handleCommand((git: GitService, feature: string) => {
    return git.contextGet(feature);
  }));

program
  .command('handoff <feature> <agentId>')
  .description('Transfer lock and context of a worktree to another agent')
  .action(handleCommand((git: GitService, feature: string, agentId: string) => {
    git.handoff(feature, agentId);
    return { feature, handoffTo: agentId };
  }));

program
  .command('port-request <feature>')
  .description('Lease a dynamic exclusive port for a worktree')
  .action(handleCommand((git: GitService, feature: string) => {
    return git.portRequest(feature);
  }));

program
  .command('port-release <feature>')
  .description('Release a previously leased port')
  .action(handleCommand((git: GitService, feature: string) => {
    git.portRelease(feature);
    return { released: feature };
  }));

program
  .command('interactive')
  .alias('i')
  .description('Run wt-agent in an interactive prompt mode for humans')
  .action(() => {
    runInteractiveMode();
  });

program.parse(process.argv);
