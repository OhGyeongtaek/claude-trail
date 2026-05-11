// `claude-trail init` / `init --remove` — settings.json safe merge.
// Spec: docs/DESIGN.md §11.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  planInstall,
  planRemove,
  type InstallChange,
  type RemoveChange,
  type Settings,
} from '../lib/installer.js';
import { resolveProjectRoot, trailDir } from '../lib/paths.js';

interface InitArgs {
  remove: boolean;
  purge: boolean;
  yes: boolean;
}

export function parseInitArgs(argv: string[]): InitArgs {
  const out: InitArgs = { remove: false, purge: false, yes: false };
  for (const a of argv) {
    if (a === '--remove') out.remove = true;
    else if (a === '--purge') out.purge = true;
    else if (a === '--yes' || a === '-y') out.yes = true;
  }
  return out;
}

export async function runInit(argv: string[]): Promise<number> {
  const args = parseInitArgs(argv);
  const projectRoot = resolveProjectRoot();
  const settingsPath = join(projectRoot, '.claude', 'settings.json');

  const existing = readSettings(settingsPath);

  if (args.remove) {
    return runRemove(settingsPath, existing, args, projectRoot);
  }
  return runInstall(settingsPath, existing, args);
}

async function runInstall(
  settingsPath: string,
  existing: Settings | null,
  args: InitArgs,
): Promise<number> {
  const { settings, changes } = planInstall(existing);
  const dirtyChanges = changes.filter((c) => c.action !== 'unchanged');

  if (dirtyChanges.length === 0) {
    process.stdout.write('claude-trail: hooks already installed (no change).\n');
    return 0;
  }

  printInstallDiff(settingsPath, dirtyChanges);

  if (!args.yes && !(await confirm())) {
    process.stdout.write('claude-trail: aborted.\n');
    return 1;
  }

  writeSettings(settingsPath, settings);
  process.stdout.write(`claude-trail: wrote ${settingsPath}\n`);
  return 0;
}

async function runRemove(
  settingsPath: string,
  existing: Settings | null,
  args: InitArgs,
  projectRoot: string,
): Promise<number> {
  if (existing === null) {
    process.stdout.write('claude-trail: no settings.json found, nothing to remove.\n');
    if (args.purge) purgeTrailDir(projectRoot);
    return 0;
  }

  const { settings, changes, totalRemoved } = planRemove(existing);
  if (totalRemoved === 0) {
    process.stdout.write('claude-trail: no claude-trail hooks present.\n');
    if (args.purge) purgeTrailDir(projectRoot);
    return 0;
  }

  printRemoveDiff(settingsPath, changes);

  if (!args.yes && !(await confirm())) {
    process.stdout.write('claude-trail: aborted.\n');
    return 1;
  }

  writeSettings(settingsPath, settings);
  process.stdout.write(`claude-trail: removed ${totalRemoved} hook entries from ${settingsPath}\n`);
  if (args.purge) purgeTrailDir(projectRoot);
  return 0;
}

function readSettings(path: string): Settings | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw) as Settings;
  } catch (err) {
    process.stderr.write(
      `claude-trail: failed to parse ${path} — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

function writeSettings(path: string, settings: Settings): void {
  const dir = path.slice(0, path.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(settings, null, 2) + '\n';
  writeFileSync(path, json, 'utf8');
}

function printInstallDiff(path: string, changes: InstallChange[]): void {
  process.stdout.write(`claude-trail: planned changes to ${path}:\n\n`);
  for (const c of changes) {
    const matcher = c.matcher ? ` matcher="${c.matcher}"` : '';
    const verb = c.action === 'added' ? '+ add  ' : '~ update';
    process.stdout.write(`  ${verb} ${c.event}${matcher}\n`);
    process.stdout.write(`           command: ${c.command}\n`);
  }
  process.stdout.write('\n');
}

function printRemoveDiff(path: string, changes: RemoveChange[]): void {
  process.stdout.write(`claude-trail: planned removal from ${path}:\n\n`);
  for (const c of changes) {
    process.stdout.write(`  - remove ${c.event} (${c.removed} entr${c.removed === 1 ? 'y' : 'ies'})\n`);
  }
  process.stdout.write('\n');
}

async function confirm(): Promise<boolean> {
  // Default to "no" in pipelines to avoid silent surprises — pass --yes to override.
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'claude-trail: stdin is not a TTY. Re-run with --yes to skip the confirmation prompt.\n',
    );
    return false;
  }
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question('Apply these changes? [y/N]: ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function purgeTrailDir(projectRoot: string): void {
  const dir = trailDir(projectRoot);
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
  process.stdout.write(`claude-trail: purged ${dir}\n`);
}
