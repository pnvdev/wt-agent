import prompts from 'prompts';
import { GitService } from '../services/git';

export async function runInteractiveMode() {
  const git = new GitService();
  
  try {
    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { title: 'List Worktrees', value: 'list' },
        { title: 'Create Worktree', value: 'create' },
        { title: 'Switch Worktree', value: 'switch' },
        { title: 'Remove Worktree', value: 'remove' },
        { title: 'Sync Worktree', value: 'sync' },
        { title: 'Run Garbage Collection', value: 'gc' },
        { title: 'Exit', value: 'exit' }
      ]
    });

    if (!action || action === 'exit') {
      console.log('Goodbye!');
      process.exit(0);
    }

    if (action === 'list') {
      const wts = git.listWorktrees();
      console.log(''); // empty line
      if (wts.length === 0) {
        console.log('No active worktrees found.');
      } else {
        console.log('Active Worktrees:');
        wts.forEach(wt => {
          console.log(`- ${wt.branch} -> ${wt.path} [Clean: ${wt.isClean}] ${wt.lockedBy ? `(Locked by: ${wt.lockedBy})` : ''}`);
        });
      }
      console.log('');
      return runInteractiveMode();
    }

    if (action === 'gc') {
      const { base } = await prompts({
        type: 'text',
        name: 'base',
        message: 'Base branch to check against:',
        initial: 'main'
      });
      if (base) {
        const result = git.gc(base);
        console.log('');
        console.log(`Garbage Collection Complete. Removed: ${result.removed.join(', ') || 'None'}`);
        console.log('');
      }
      return runInteractiveMode();
    }

    const { feature } = await prompts({
      type: 'text',
      name: 'feature',
      message: 'Feature branch name (e.g. feature/login):'
    });

    if (!feature) return runInteractiveMode();

    if (action === 'create') {
      const { base } = await prompts({
        type: 'text',
        name: 'base',
        message: 'Base branch:',
        initial: 'main'
      });
      const result = git.addWorktree(feature, base || 'main');
      console.log('');
      console.log(`Worktree created at: ${result.path}`);
      console.log('');
    } else if (action === 'switch') {
      console.log('');
      console.log(`Worktree path: ${git.getWorktreePath(feature)}`);
      console.log('');
    } else if (action === 'sync') {
      const { base } = await prompts({
        type: 'text',
        name: 'base',
        message: 'Base branch to sync against:',
        initial: 'main'
      });
      git.syncWorktree(feature, base || 'main');
      console.log('');
      console.log(`Worktree synced successfully!`);
      console.log('');
    } else if (action === 'remove') {
      const { force } = await prompts({
        type: 'confirm',
        name: 'force',
        message: 'Force remove? (required if dirty or locked)',
        initial: false
      });
      git.removeWorktree(feature, force);
      console.log('');
      console.log(`Worktree removed successfully!`);
      console.log('');
    }
    
    // Loop back
    await runInteractiveMode();
    
  } catch (error: any) {
    console.log('');
    console.error(`\x1b[31m[ERROR]\x1b[0m ${error.message}`);
    console.log('');
    // Loop back on error to allow retry
    await runInteractiveMode();
  }
}