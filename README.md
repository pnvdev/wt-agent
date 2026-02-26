# 🤖 wt-agent (Worktree Agent)

`wt-agent` is an advanced, deterministic CLI tool designed to empower autonomous AI agents (like `gemini-cli`, `Cursor`, or `Devin`) to manage Git worktrees safely and concurrently.

By leveraging Git worktrees under the hood, `wt-agent` allows multiple agents to work on different features or bug fixes in parallel, fully isolated folders (`.worktrees/<feature>`) without stepping on each other's toes, avoiding merge conflicts on the host repository, and eliminating the need for slow, heavy full repository clones.

## 🌟 Key Features

*   **Agent-First Output:** Native structured JSON output for seamless integration and parsing by LLMs and agentic loops.
*   **Idempotency:** Re-running commands will gracefully handle existing states instead of throwing destructive errors.
*   **Agent Locking System:** Lock (`lock`) and Handoff (`handoff`) worktrees to prevent other agents or cleanup scripts from deleting in-progress work.
*   **Dependency Sandboxing (`--isolate-deps`):** Automatically scopes `node_modules` installation inside the worktree so branch-specific dependencies don't break the main repository.
*   **Dynamic Port Leasing:** Agents can dynamically request an exclusive port (e.g., `8001`) via `port-request`, which is automatically written to `.env.local`, preventing server collisions during automated E2E testing.
*   **Structured Conflict API:** Automatically parses `git status` during a rebase or merge conflict into a clean JSON so agents know exactly what files need manual intervention before calling `resolve-continue`.
*   **System Checkpoints:** Fast, lightweight `checkpoint-save` and `checkpoint-restore` commands for agents to perform safe "Trial & Error" loops without polluting the global Git stash.
*   **Garbage Collection (`gc`):** Automatically finds and deletes worktrees whose branches have already been merged into `main`.
*   **Interactive Mode:** Includes a human-friendly interactive prompt interface using `wt-agent interactive` (`wt-agent i`).

## 🚀 Quick Start (npx)

You can run the CLI directly without any installation using `npx` via the `@pnvdev` scope:

```bash
npx --yes @pnvdev/wt-agent --help
```

## 🛠️ Local Installation & Build

Ensure you have Node.js (>= 18) installed.

```bash
# Clone the repository
git clone <repository-url>
cd wt-agent

# Install dependencies
npm install

# Build the TypeScript project
npm run build
```

## 💻 Usage (Agentic CLI)

`wt-agent` is primarily designed to be invoked by other programs using sub-processes. By default, it returns JSON.

### Creating a Worktree
```bash
npx wt-agent create feature/auth-login --base main --isolate-deps
```
*Output:*
```json
{
  "success": true,
  "data": {
    "path": "/absolute/path/to/repo/.worktrees/feature-auth-login"
  }
}
```

### Checking Status (Conflict Resolution)
```bash
npx wt-agent status feature/auth-login
```
*Output:*
```json
{
  "success": true,
  "data": {
    "isClean": false,
    "conflicts": ["src/auth.ts"],
    "modified": [],
    "added": [],
    "deleted": []
  }
}
```

### System Checkpoints (Trial & Error)
Agents can snapshot their work before a risky refactor.
```bash
npx wt-agent checkpoint-save feature/auth-login "Before updating React router"
```
If the refactor fails the tests:
```bash
npx wt-agent checkpoint-restore feature/auth-login
```

### Agent Handoff & Context
Agents can leave context for other agents taking over the task.
```bash
npx wt-agent context-set feature/auth-login "Goal: Fix UI padding"
npx wt-agent handoff feature/auth-login frontend-agent-id-123
```

### Dynamic Port Leasing
Allocate a unique port for a dev server to avoid collisions with other agents.
```bash
npx wt-agent port-request feature/auth-login
```
*Output:*
```json
{
  "success": true,
  "data": {
    "port": 8000
  }
}
```

### Garbage Collection
Clean up disk space by removing worktrees that are already merged.
```bash
npx wt-agent gc --base main
```

## 🧑‍💻 Usage (Interactive Mode for Humans)

If you want to use the tool as a human developer without typing the commands, simply run:

```bash
npx wt-agent interactive
# or
npx wt-agent i
```

This will launch a prompt interface allowing you to navigate, create, sync, and delete worktrees easily.

## 🛠️ Testing

The project uses `vitest` with fully isolated temporary Git repositories to ensure deterministic testing without altering your local git config.

```bash
npm run test
```

## 🏗️ Architecture

*   **`src/index.ts`:** The presentation layer using `commander`. It parses arguments and handles the standard JSON output wrapper (`src/utils/output.ts`).
*   **`src/services/git.ts`:** The core engine. It interacts with the local `git` binary via `child_process.execSync`. By using the host's `git`, it naturally inherits all SSH keys, global configs, and credential helpers without needing heavy native bindings like `nodegit`.
*   **Metadata (`metadata.json`):** State (locks, assigned ports, context messages, checkpoint SHAs) is stored locally within each `.worktrees/<feature>/metadata.json` file.

---
*Built for the Agentic future of Software Engineering.*