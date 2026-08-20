'use strict';

/**
 * Cross-platform golden-master updater: `npm run test:update-golden`.
 *
 * `UPDATE_GOLDEN=1 node --test` is not valid syntax on Windows cmd.exe, so this
 * sets the variable in the environment and re-spawns the runner. Node 20 runs
 * each test file in a child process which inherits this env.
 *
 * Rewrites golden files to whatever the engine currently produces — only run
 * this when a behavior change is intentional, then review the diff.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const result = spawnSync(process.execPath, ['--test', 'test/'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, UPDATE_GOLDEN: '1' },
  stdio: 'inherit'
});

process.exit(result.status === null ? 1 : result.status);
