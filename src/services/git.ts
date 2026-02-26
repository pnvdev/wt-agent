import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface WorktreeInfo {
  path: string;
  branch: string;
  isClean: boolean;
  lockedBy?: string;
}

export class GitService {
  private baseDir: string;
  
  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.cwd();
    // Validate we are in a git repository
    try {
      this.exec('git rev-parse --is-inside-work-tree');
    } catch {
      throw new Error('Not inside a Git repository');
    }
  }

  private exec(cmd: string, cwd: string = this.baseDir): string {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  }

  private getWorktreeDir(feature: string): string {
    const normalized = feature.replace(/[/\\]/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
    return path.join(this.baseDir, '.worktrees', normalized);
  }

  public getWorktreePath(feature: string): string {
    return this.getWorktreeDir(feature);
  }

  private getLockStatus(wtPath: string): string | undefined {
    const metadataPath = path.join(wtPath, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        return data.lockedBy;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  public listWorktrees(): WorktreeInfo[] {
    const output = this.exec('git worktree list --porcelain');
    const lines = output.split(/\r?\n/);
    const worktrees: WorktreeInfo[] = [];
    
    let currentWt: Partial<WorktreeInfo> = {};
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (currentWt.path && currentWt.branch && currentWt.path.includes('.worktrees')) {
          currentWt.isClean = this.isClean(currentWt.path);
          currentWt.lockedBy = this.getLockStatus(currentWt.path);
          worktrees.push(currentWt as WorktreeInfo);
        }
        currentWt = { path: line.replace('worktree ', '').trim() };
      } else if (line.startsWith('branch ')) {
        const branchRef = line.replace('branch ', '').trim();
        currentWt.branch = branchRef.replace('refs/heads/', '');
      }
    }
    // Push the last one if applicable
    if (currentWt.path && currentWt.branch && currentWt.path.includes('.worktrees')) {
      currentWt.isClean = this.isClean(currentWt.path);
      currentWt.lockedBy = this.getLockStatus(currentWt.path);
      worktrees.push(currentWt as WorktreeInfo);
    }
    
    return worktrees;
  }

  public isClean(wtPath: string): boolean {
    try {
      const output = this.exec('git status --porcelain', wtPath);
      // Filter out metadata.json which is an internal file
      const lines = output.split(/\r?\n/).filter(line => line.trim() !== '' && !line.includes('metadata.json'));
      return lines.length === 0;
    } catch {
      return false;
    }
  }

  private runHook(wtPath: string, hookCommand?: string): string | undefined {
    if (!hookCommand) return undefined;
    try {
      return this.exec(hookCommand, wtPath);
    } catch (e: any) {
      throw new Error(`Hook execution failed: ${e.message}`);
    }
  }

  private isolateDependencies(wtPath: string): void {
    const pkgJsonPath = path.join(wtPath, 'package.json');
    const nodeModulesPath = path.join(wtPath, 'node_modules');

    if (fs.existsSync(pkgJsonPath)) {
      try {
        // Just run an npm install to make sure the worktree has its own local dependencies.
        // It might be slow, but it guarantees isolation for Node.
        // In the future, we could use hardlinks or pnpm/yarn native worktree features.
        this.exec('npm install', wtPath);
      } catch (e: any) {
        throw new Error(`Failed to isolate Node dependencies: ${e.message}`);
      }
    }
  }

  public addWorktree(feature: string, base: string = 'main', hook?: string, isolateDeps: boolean = false): { path: string, hookOutput?: string } {
    const wtPath = this.getWorktreeDir(feature);
    
    const worktreesBase = path.join(this.baseDir, '.worktrees');
    if (!fs.existsSync(worktreesBase)) {
      fs.mkdirSync(worktreesBase, { recursive: true });
    }

    if (fs.existsSync(wtPath)) {
      throw new Error(`Worktree for feature ${feature} already exists at ${wtPath}`);
    }

    let resultPath = wtPath;
    try {
      this.exec(`git worktree add -b ${feature} ${wtPath} ${base}`);
    } catch (e: any) {
      if (e.message.includes('already exists')) {
         this.exec(`git worktree add ${wtPath} ${feature}`);
      } else {
         throw new Error(`Failed to create worktree: ${e.message}`);
      }
    }

    if (isolateDeps) {
      this.isolateDependencies(resultPath);
    }
    const hookOutput = this.runHook(resultPath, hook);
    return { path: resultPath, hookOutput };
  }

  public removeWorktree(feature: string, force: boolean): void {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) {
      throw new Error(`Worktree for feature ${feature} does not exist`);
    }

    const lockedBy = this.getLockStatus(wtPath);
    if (lockedBy && !force) {
      throw new Error(`Worktree is locked by agent: ${lockedBy}. Use --force to remove it anyway.`);
    }

    if (!force && !this.isClean(wtPath)) {
      throw new Error('Worktree is dirty. Use --force to remove it anyway.');
    }

    try {
      this.exec(`git worktree remove ${force ? '--force' : ''} ${wtPath}`);
    } catch (e: any) {
      throw new Error(`Failed to remove worktree: ${e.message}`);
    }
  }

  public syncWorktree(feature: string, base: string = 'main', hook?: string, isolateDeps: boolean = false): { synced: string, hookOutput?: string } {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) {
      throw new Error(`Worktree for feature ${feature} does not exist`);
    }

    try {
      this.exec('git fetch origin', wtPath);
      this.exec(`git rebase origin/${base}`, wtPath);
      
      if (isolateDeps) {
        this.isolateDependencies(wtPath);
      }
      const hookOutput = this.runHook(wtPath, hook);
      return { synced: feature, hookOutput };
    } catch (e: any) {
      throw new Error(`Failed to sync worktree: ${e.message}. You may need to resolve conflicts manually in ${wtPath}`);
    }
  }

  public lockWorktree(feature: string, agentId: string): void {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) {
      throw new Error(`Worktree for feature ${feature} does not exist`);
    }
    const currentLock = this.getLockStatus(wtPath);
    if (currentLock && currentLock !== agentId) {
      throw new Error(`Worktree is already locked by agent: ${currentLock}`);
    }
    
    const metadataPath = path.join(wtPath, 'metadata.json');
    const lockData = {
      lockedBy: agentId,
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(metadataPath, JSON.stringify(lockData, null, 2), 'utf-8');
  }

  public unlockWorktree(feature: string, agentId: string, force: boolean): void {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) {
      throw new Error(`Worktree for feature ${feature} does not exist`);
    }
    const currentLock = this.getLockStatus(wtPath);
    if (!currentLock) {
      return; // Already unlocked
    }
    if (currentLock !== agentId && !force) {
      throw new Error(`Worktree is locked by another agent (${currentLock}). Use --force to unlock.`);
    }

    const metadataPath = path.join(wtPath, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath);
    }
  }

  public gc(base: string = 'main'): { removed: string[] } {
    const worktrees = this.listWorktrees();
    const removed: string[] = [];

    // Ensure we have the latest base branch tracking
    try {
      this.exec(`git fetch origin ${base}`);
    } catch {
      // Ignore fetch errors
    }

    for (const wt of worktrees) {
      // Check if branch is merged into base (e.g., origin/main or local main)
      try {
        const mergedBranches = this.exec(`git branch --merged origin/${base}`).split(/\r?\n/).map(b => b.replace('*', '').trim());
        const isMerged = mergedBranches.includes(wt.branch) || this.exec(`git branch --merged ${base}`).split(/\r?\n/).map(b => b.replace('*', '').trim()).includes(wt.branch);
        
        if (isMerged && wt.isClean) {
          const lockedBy = this.getLockStatus(wt.path);
          if (!lockedBy) {
            this.exec(`git worktree remove ${wt.path}`);
            this.exec(`git branch -d ${wt.branch}`); // Clean up local branch as well since it's merged
            removed.push(wt.branch);
          }
        }
      } catch (e) {
        // Skip if there's an issue checking/removing this particular worktree
      }
    }
    return { removed };
  }

  public checkpointSave(feature: string, message: string): { sha: string } {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) {
      throw new Error(`Worktree for feature ${feature} does not exist`);
    }

    try {
      const currentSha = this.exec('git rev-parse HEAD', wtPath);
      this.exec('git add .', wtPath);
      // git add -A is better for untracked and deleted. Wait, the problem is it might not commit anything.
      // let's just make sure we capture status.
      try {
        this.exec(`git commit -m "wt-checkpoint: ${message}"`, wtPath);
      } catch (e: any) {
        // If nothing to commit, that's fine, we still advance? No, if nothing to commit, newSha == currentSha
        // which means the checkpoint is identical to the base.
      }
      const newSha = this.exec('git rev-parse HEAD', wtPath);

      const metadataPath = path.join(wtPath, 'metadata.json');
      let data: any = {};
      if (fs.existsSync(metadataPath)) {
        data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      }
      data.lastCheckpoint = newSha;
      data.checkpointBase = currentSha; // where to go back to if we discard
      fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2), 'utf-8');

      return { sha: newSha };
    } catch (e: any) {
      throw new Error(`Failed to save checkpoint: ${e.message}`);
    }
  }

  public checkpointRestore(feature: string): { restoredTo: string } {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) {
      throw new Error(`Worktree for feature ${feature} does not exist`);
    }

    const metadataPath = path.join(wtPath, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`No checkpoints found for ${feature}`);
    }

    let data: any = {};
    try {
      data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    } catch {
      throw new Error(`Invalid metadata for ${feature}`);
    }

    if (!data.checkpointBase) {
      throw new Error(`No restore point found for ${feature}`);
    }

    try {
      this.exec(`git reset --hard ${data.checkpointBase}`, wtPath);
      
      // Cleanup metadata
      delete data.lastCheckpoint;
      delete data.checkpointBase;
      fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2), 'utf-8');

      return { restoredTo: data.checkpointBase };
    } catch (e: any) {
      throw new Error(`Failed to restore checkpoint: ${e.message}`);
    }
  }

  public status(feature: string): any {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) {
      throw new Error(`Worktree for feature ${feature} does not exist`);
    }

    try {
      const output = this.exec('git status --porcelain', wtPath);
      const lines = output.split(/\r?\n/).filter(line => line.trim() !== '' && !line.includes('metadata.json'));
      
      const conflicts: string[] = [];
      const modified: string[] = [];
      const added: string[] = [];
      const deleted: string[] = [];

      lines.forEach(line => {
        const code = line.substring(0, 2);
        const file = line.substring(3);
        if (code === 'UU' || code === 'AA' || code === 'DD' || code === 'AU' || code === 'UA' || code === 'DU' || code === 'UD') {
          conflicts.push(file);
        } else if (code.includes('M')) {
          modified.push(file);
        } else if (code.includes('A') || code === '??') {
          added.push(file);
        } else if (code.includes('D')) {
          deleted.push(file);
        }
      });

      return { isClean: lines.length === 0, conflicts, modified, added, deleted };
    } catch (e: any) {
      throw new Error(`Failed to get status: ${e.message}`);
    }
  }

  public resolveContinue(feature: string): { resolved: boolean } {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) {
      throw new Error(`Worktree for feature ${feature} does not exist`);
    }

    try {
      this.exec('git add .', wtPath);
      // It could be a rebase or a merge
      if (fs.existsSync(path.join(wtPath, '.git', 'rebase-merge')) || fs.existsSync(path.join(wtPath, '.git', 'rebase-apply'))) {
        this.exec('git rebase --continue', wtPath);
      } else if (fs.existsSync(path.join(wtPath, '.git', 'MERGE_HEAD'))) {
        this.exec('git commit --no-edit', wtPath);
      } else {
         // Maybe cherry-pick or nothing
         this.exec('git commit -m "Resolved conflicts"', wtPath);
      }
      return { resolved: true };
    } catch (e: any) {
      throw new Error(`Failed to continue after conflict resolution: ${e.message}`);
    }
  }

  public contextSet(feature: string, contextMsg: string): void {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) throw new Error(`Worktree for feature ${feature} does not exist`);

    const metadataPath = path.join(wtPath, 'metadata.json');
    let data: any = {};
    if (fs.existsSync(metadataPath)) data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    data.context = contextMsg;
    fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  public contextGet(feature: string): { context: string | undefined } {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) throw new Error(`Worktree for feature ${feature} does not exist`);

    const metadataPath = path.join(wtPath, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      const data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      return { context: data.context };
    }
    return { context: undefined };
  }

  public handoff(feature: string, toAgentId: string): void {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) throw new Error(`Worktree for feature ${feature} does not exist`);

    const metadataPath = path.join(wtPath, 'metadata.json');
    let data: any = {};
    if (fs.existsSync(metadataPath)) data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    data.lockedBy = toAgentId;
    data.timestamp = new Date().toISOString();
    fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  public portRequest(feature: string): { port: number } {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) throw new Error(`Worktree for feature ${feature} does not exist`);

    const worktrees = this.listWorktrees();
    const usedPorts = new Set<number>();

    // Collect all used ports
    for (const wt of worktrees) {
      const mPath = path.join(wt.path, 'metadata.json');
      if (fs.existsSync(mPath)) {
        try {
          const d = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
          if (d.port) usedPorts.add(d.port);
        } catch {}
      }
    }

    // Find first available port in 8000-8050
    let assignedPort = -1;
    for (let p = 8000; p <= 8050; p++) {
      if (!usedPorts.has(p)) {
        assignedPort = p;
        break;
      }
    }

    if (assignedPort === -1) throw new Error("No available ports in range 8000-8050");

    const metadataPath = path.join(wtPath, 'metadata.json');
    let data: any = {};
    if (fs.existsSync(metadataPath)) data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    data.port = assignedPort;
    fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2), 'utf-8');

    // Also write it to .env.local for convenience
    const envPath = path.join(wtPath, '.env.local');
    let envContent = '';
    if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf-8');
    const portRegex = /^PORT=.*$/m;
    if (portRegex.test(envContent)) {
      envContent = envContent.replace(portRegex, `PORT=${assignedPort}`);
    } else {
      envContent += `\nPORT=${assignedPort}\n`;
    }
    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');

    return { port: assignedPort };
  }

  public portRelease(feature: string): void {
    const wtPath = this.getWorktreeDir(feature);
    if (!fs.existsSync(wtPath)) throw new Error(`Worktree for feature ${feature} does not exist`);

    const metadataPath = path.join(wtPath, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      const data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      if (data.port) {
        delete data.port;
        fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2), 'utf-8');
      }
    }
  }

  public doctor(): any {
    const report: any = { gitInstalled: false, isRepo: false, worktrees: [] };
    
    try {
      this.exec('git --version');
      report.gitInstalled = true;
      
      this.exec('git rev-parse --is-inside-work-tree');
      report.isRepo = true;
      
      report.worktrees = this.listWorktrees();
      // Check for orphaned dirs in .worktrees
      const worktreesBase = path.join(this.baseDir, '.worktrees');
      if (fs.existsSync(worktreesBase)) {
         const dirs = fs.readdirSync(worktreesBase);
         const registeredPaths = report.worktrees.map((w: any) => w.path);
         report.orphanedDirs = dirs.map(d => path.join(worktreesBase, d)).filter(p => !registeredPaths.includes(p));
      } else {
         report.orphanedDirs = [];
      }

    } catch (e) {
      // Ignore errors for doctor
    }
    
    return report;
  }
}
