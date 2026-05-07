// claude-trail CLI entry — watch / init / init --remove.
// Spec: docs/DESIGN.md §6.
//
// This entry MUST NOT import the hook adapter (cold start budget is owned by
// dist/hook.js, see §10/§11). React/Ink imports are confined to the watch
// command via dynamic import.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const HELP = `claude-trail ${VERSION}

Usage:
  claude-trail <command> [options]
  claude-trail --version
  claude-trail --help

Commands:
  watch              Live TUI dashboard (M1)
  init               Install hooks into .claude/settings.json (M2)
  init --remove      Remove this tool's hooks
  hook               (internal) stdin adapter for Claude Code hooks
                     — invoked via bin/claude-trail-hook.js

See docs/DESIGN.md for full specification.
`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    return 0;
  }

  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  switch (cmd) {
    case 'watch': {
      const { runWatch } = await import('./commands/watch.js');
      return runWatch(rest);
    }
    case 'init':
      process.stderr.write('claude-trail: `init` is not implemented yet (M5).\n');
      void rest;
      return 1;
    case 'hook':
      process.stderr.write(
        'claude-trail: `hook` should be invoked via bin/claude-trail-hook.js, not the main CLI.\n',
      );
      return 1;
    default:
      process.stderr.write(`claude-trail: unknown command: ${cmd}\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`claude-trail: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
