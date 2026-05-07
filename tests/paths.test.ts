// docs/DESIGN.md §5.1.3 — project-root resolution + path normalization.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizePath, resolveProjectRoot } from '../src/lib/paths.js';

test('resolveProjectRoot: payload.cwd takes precedence', () => {
  const prev = process.env['CLAUDE_PROJECT_DIR'];
  process.env['CLAUDE_PROJECT_DIR'] = '/env/dir';
  try {
    assert.equal(resolveProjectRoot('/payload/dir'), '/payload/dir');
  } finally {
    if (prev === undefined) delete process.env['CLAUDE_PROJECT_DIR'];
    else process.env['CLAUDE_PROJECT_DIR'] = prev;
  }
});

test('resolveProjectRoot: env fallback when payload missing', () => {
  const prev = process.env['CLAUDE_PROJECT_DIR'];
  process.env['CLAUDE_PROJECT_DIR'] = '/env/dir';
  try {
    assert.equal(resolveProjectRoot(undefined), '/env/dir');
  } finally {
    if (prev === undefined) delete process.env['CLAUDE_PROJECT_DIR'];
    else process.env['CLAUDE_PROJECT_DIR'] = prev;
  }
});

test('resolveProjectRoot: process.cwd() fallback', () => {
  const prev = process.env['CLAUDE_PROJECT_DIR'];
  delete process.env['CLAUDE_PROJECT_DIR'];
  try {
    assert.equal(resolveProjectRoot(undefined), process.cwd());
  } finally {
    if (prev !== undefined) process.env['CLAUDE_PROJECT_DIR'] = prev;
  }
});

test('resolveProjectRoot: ignores non-absolute payload cwd', () => {
  assert.equal(resolveProjectRoot('relative/path'), process.cwd());
});

test('normalizePath: absolute inside root → relative + ext', () => {
  const r = normalizePath('/repo/src/components/Card.tsx', { projectRoot: '/repo' });
  assert.equal(r.path, 'src/components/Card.tsx');
  assert.equal(r.ext, '.tsx');
  assert.equal(r.outside, false);
});

test('normalizePath: absolute outside root → kept absolute, outside=true', () => {
  const r = normalizePath('/elsewhere/foo.md', { projectRoot: '/repo' });
  assert.equal(r.path, '/elsewhere/foo.md');
  assert.equal(r.ext, '.md');
  assert.equal(r.outside, true);
});

test('normalizePath: extension lowercased', () => {
  const r = normalizePath('/repo/README.MD', { projectRoot: '/repo' });
  assert.equal(r.ext, '.md');
});

test('normalizePath: no extension → ext null', () => {
  const r = normalizePath('/repo/Makefile', { projectRoot: '/repo' });
  assert.equal(r.ext, null);
});

test('normalizePath: relative input passed through, ext extracted', () => {
  const r = normalizePath('src/types.ts', { projectRoot: '/repo' });
  assert.equal(r.path, 'src/types.ts');
  assert.equal(r.ext, '.ts');
  assert.equal(r.outside, false);
});

test('normalizePath: project root itself → "."', () => {
  const r = normalizePath('/repo', { projectRoot: '/repo' });
  assert.equal(r.path, '.');
});
