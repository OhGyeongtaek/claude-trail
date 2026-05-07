#!/usr/bin/env node
import('../dist/cli.js').catch((err) => {
  console.error('claude-trail: failed to load dist/cli.js — did you run `npm run build`?');
  console.error(err);
  process.exit(1);
});
