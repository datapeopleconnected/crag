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

// Runs scripts/e2e.js with a fake docker on the PATH, which records each command and answers the ones whose output
// the script reads. So these check the stacks the script asks Docker for, without starting one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Records its arguments, as a JSON array a line, and prints what docker would for `compose ls`, `port` and `exec`.
// Nothing listens on port 1, so seeding fails straight away and the script goes on to remove the stack.
const FAKE_DOCKER = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\\n');
if (args.includes('ls')) process.stdout.write(process.env.FAKE_DOCKER_PROJECTS);
else if (args.includes('port')) process.stdout.write('127.0.0.1:1\\n');
else if (args.includes('exec')) process.stdout.write('{"token":"super"}');
`;

const exited = (child) =>
  new Promise((resolve) => {
    child.on('close', resolve);
  });

// Runs the script with Docker running the named Compose projects, and resolves to its pid and the docker commands it ran.
const runScript = async (projects = []) => {
  const dir = await mkdtemp(join(tmpdir(), 'crag-e2e-test-'));
  try {
    await writeFile(join(dir, 'docker'), FAKE_DOCKER);
    await chmod(join(dir, 'docker'), 0o755);
    const log = join(dir, 'docker.log');
    await writeFile(log, '');

    const child = spawn(process.execPath, ['scripts/e2e.js', 'true'], {
      cwd: ROOT,
      stdio: 'ignore',
      env: {
        ...process.env,
        PATH: [dir, dirname(process.execPath), process.env.PATH].join(':'),
        FAKE_DOCKER_LOG: log,
        FAKE_DOCKER_PROJECTS: JSON.stringify(projects.map((Name) => ({ Name }))),
      },
    });
    await exited(child);

    const commands = (await readFile(log, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { pid: child.pid, commands };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const projectOf = (args) => (args.includes('--project-name') ? args[args.indexOf('--project-name') + 1] : undefined);

test('runs the stack as a Compose project of its own', async () => {
  const { pid, commands } = await runScript();
  const stack = commands.filter((args) => !args.includes('ls'));

  assert.ok(stack.some((args) => args.includes('up')), 'starts the stack');
  for (const args of stack) assert.equal(projectOf(args), `crag-e2e-${pid}`, args.join(' '));
  assert.ok(stack.at(-1).includes('down'), 'removes the stack last');
});

// A run killed before it could clean up leaves its stack running.
test('removes the stack of a run that has ended, and no other', async () => {
  const ended = spawn(process.execPath, ['-e', '']);
  await exited(ended);

  const { pid, commands } = await runScript([
    `crag-e2e-${ended.pid}`,
    `crag-e2e-${process.pid}`,
    'crag-e2e',
    'another-project',
  ]);
  const removed = commands.filter((args) => args.includes('down')).map(projectOf);

  assert.deepEqual(removed, [`crag-e2e-${ended.pid}`, `crag-e2e-${pid}`]);
});
