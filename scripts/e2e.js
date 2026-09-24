/**
 * Buttress Crag
 * Copyright (C) 2016-2024 Data People Connected LTD.
 * <https://www.dpc-ltd.com/>
 *
 * This file is part of Buttress Crag.
 * Buttress Crag is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public Licence as published by the Free Software
 * Foundation, either version 3 of the Licence, or (at your option) any later version.
 * Buttress Crag is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public Licence for more details.
 * You should have received a copy of the GNU Affero General Public Licence along with
 * this program. If not, see <http://www.gnu.org/licenses/>.
 */

// Runs a command against a throwaway Buttress:
//
//   node scripts/e2e.js wtr --node-resolve
//
// Starts the Docker stack in .docker/docker-compose.e2e.yml, seeds it, runs the command with the endpoint and
// tokens in BUTTRESS_E2E_* environment variables, then removes the stack. Set BUTTRESS_IMAGE to use another
// Buttress image, such as one built from a local checkout.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { seed } from './e2e-seed.js';

const COMPOSE = ['compose', '--file', '.docker/docker-compose.e2e.yml'];
// Nothing in the stack is worth stopping gracefully, and Buttress ignores SIGTERM, which costs ten seconds.
const DOWN = ['down', '--volumes', '--timeout', '0'];

// Resolves with the command's exit code. Its output goes straight to the terminal.
const run = (command, args, options) =>
  new Promise((resolve, reject) => {
    spawn(command, args, { stdio: 'inherit', ...options })
      .on('error', reject)
      .on('close', (code) => resolve(code ?? 1));
  });

const compose = async (...args) => {
  const code = await run('docker', [...COMPOSE, ...args]);
  if (code !== 0) throw new Error(`docker compose ${args[0]} exited with code ${code}`);
};

const composeOutput = async (...args) => {
  const { stdout } = await promisify(execFile)('docker', [...COMPOSE, ...args]);
  return stdout.trim();
};

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/e2e.js <command> [args...]');
  process.exit(1);
}

// Ctrl+C reaches the child processes too. Outlive them, so the stack still gets removed.
let interrupted = false;
process.on('SIGINT', () => {
  interrupted = true;
});

let exitCode = 1;
try {
  // Clear out anything left by an earlier run that was killed before it could clean up.
  await compose(...DOWN, '--remove-orphans');
  // develop moves on, so fetch the latest. If that fails, say when offline, the cached image is used.
  if (!process.env.BUTTRESS_IMAGE) await compose('pull', '--ignore-pull-failures', 'buttress');
  await compose('up', '--detach', '--wait');

  const endpoint = `http://${await composeOutput('port', 'proxy', '80')}`;
  console.log(`Buttress is up at ${endpoint}`);

  const superApp = JSON.parse(
    await composeOutput('exec', '-T', 'buttress', 'cat', '/opt/buttress/app_data/super.json'),
  );
  const tokens = await seed(endpoint, superApp.token);

  if (!interrupted) {
    exitCode = await run(command, args, {
      env: {
        ...process.env,
        BUTTRESS_E2E_ENDPOINT: endpoint,
        BUTTRESS_E2E_APP_TOKEN: tokens.appToken,
        BUTTRESS_E2E_USER1_TOKEN: tokens.user1Token,
        BUTTRESS_E2E_USER2_TOKEN: tokens.user2Token,
      },
    });
  }
} catch (err) {
  console.error(
    err.code === 'ENOENT' ? `Couldn't find \`${err.path}\`. Is it installed and on your PATH?` : err.message,
  );
}

// docker reports its own failures from here on, so they're ignored rather than stopping the clean-up.
if (exitCode !== 0 && !interrupted) {
  console.error('\nThe end of the Buttress log:');
  await compose('logs', '--no-log-prefix', '--tail', '50', 'buttress').catch(() => {});
}
await compose(...DOWN).catch(() => {});

process.exit(interrupted ? 130 : exitCode);
