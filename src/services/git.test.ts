import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitService } from './git';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

describe('GitService', () => {
  let tempDir: string;
  let git: GitService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-agent-test-'));
    // Initialize git repo and configure user just in case
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
    // Create initial commit
    fs.writeFileSync(path.join(tempDir, 'README.md'), 'test repo');
    execSync('git add README.md', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' });
    
    git = new GitService(tempDir);
  });

  afterEach(() => {
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should initialize correctly in a git repository', () => {
    expect(git).toBeDefined();
  });

  it('should create and list a worktree', () => {
    execSync('git branch -M main', { cwd: tempDir, stdio: 'ignore' });
    const feature = 'feature/test-1';

    const resultWithBase = git.addWorktree(feature, 'main');
    expect(resultWithBase.path).toContain('feature-test-1');
    expect(fs.existsSync(resultWithBase.path)).toBe(true);

    const list = git.listWorktrees();
    expect(list.length).toBeGreaterThan(0);
    const wt = list.find(w => w.branch === feature);
    expect(wt).toBeDefined();
    expect(wt?.isClean).toBe(true);
  });

  it('should lock and unlock a worktree', () => {
    execSync('git branch -M main', { cwd: tempDir, stdio: 'ignore' });
    const feature = 'feature/test-lock';
    git.addWorktree(feature, 'main');
    
    git.lockWorktree(feature, 'agent-123');
    let list = git.listWorktrees();
    let wt = list.find(w => w.branch === feature);
    expect(wt?.lockedBy).toBe('agent-123');

    // Unlock
    git.unlockWorktree(feature, 'agent-123', false);
    list = git.listWorktrees();
    wt = list.find(w => w.branch === feature);
    expect(wt?.lockedBy).toBeUndefined();
  });

  it('should prevent removing a locked worktree without force', () => {
    execSync('git branch -M main', { cwd: tempDir, stdio: 'ignore' });
    const feature = 'feature/test-remove-lock';
    git.addWorktree(feature, 'main');
    git.lockWorktree(feature, 'agent-123');

    expect(() => git.removeWorktree(feature, false)).toThrow(/locked/);
    
    // Should work with force
    git.removeWorktree(feature, true);
    expect(fs.existsSync(git.getWorktreePath(feature))).toBe(false);
  });

  it('should save and restore a checkpoint', () => {
    execSync('git branch -M main', { cwd: tempDir, stdio: 'ignore' });
    const feature = 'feature/checkpoint-test';
    const result = git.addWorktree(feature, 'main');
    
    // Make a change
    const file = path.join(result.path, 'data.txt');
    fs.writeFileSync(file, 'v1');
    git.checkpointSave(feature, 'save v1');
    
    // Debug what is inside git status
    const statusOutput = execSync('git status --porcelain', { cwd: result.path, encoding: 'utf-8' });
    console.log('STATUS:', statusOutput);
    
    // Assert file is clean (committed in checkpoint)
    expect(git.isClean(result.path)).toBe(true);

    // Make another change
    fs.writeFileSync(file, 'v2');
    
    // Restore
    git.checkpointRestore(feature);
    
    // It should go back to the state BEFORE the checkpoint (where data.txt didn't exist or wasn't tracked)
    // Actually, based on our logic, checkpointSave commits 'v1', and checkpointRestore resets to the state *before* checkpointSave.
    expect(fs.existsSync(file)).toBe(false);
  });
});