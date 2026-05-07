#!/usr/bin/env node
import('../dist/hook.js').catch((err) => {
  try {
    process.stderr.write('claude-trail-hook: failed to load dist/hook.js\n');
  } catch {}
  process.exit(0);
});
