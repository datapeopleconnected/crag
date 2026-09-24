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

import { expect } from '@open-wc/testing';

import type { ButtressClient } from '../../src/ButtressClient.js';
import { ButtressRequestQueue, QueuedRequest } from '../../src/ButtressRequestQueue.js';
import { Logger } from '../../src/Logger.js';

// Records what the queue sends, and holds the first request open until release() so the rest queue up behind it.
const fakeClient = () => {
  const sent: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = {
    request: async (method: string, url: string, opts: { body?: unknown }) => {
      const label = url === 'bulk' ? `${method} bulk ${JSON.stringify(opts.body)}` : `${method} ${url}`;
      sent.push(label);
      if (sent.length === 1) await held;
      return {};
    },
  };
  return { client: client as unknown as ButtressClient, sent, release };
};

const get = (id: string): QueuedRequest => ({ type: 'get', method: 'GET', url: `get ${id}`, entityId: id });
const add = (id: string): QueuedRequest => ({ type: 'add', method: 'POST', url: `add ${id}`, entityId: id, body: id });
const update = (id: string, path = 'name'): QueuedRequest => ({
  type: 'update',
  method: 'PUT',
  url: `update ${id}`,
  entityId: id,
  body: path,
});
const remove = (id: string): QueuedRequest => ({ type: 'delete', method: 'DELETE', url: `delete ${id}`, entityId: id });
const search = (): QueuedRequest => ({ type: 'search', method: 'SEARCH', url: 'search' });

describe('ButtressRequestQueue', () => {
  beforeEach(() => {
    Logger.disableLogging = true;
  });

  afterEach(() => {
    Logger.disableLogging = false;
  });

  // Queues `first`, which is held open, then `rest` behind it, and returns everything sent once it's all done.
  const run = async (first: QueuedRequest, ...rest: QueuedRequest[]) => {
    const { client, sent, release } = fakeClient();
    const queue = new ButtressRequestQueue(client, () => 'bulk', new Logger('test'));
    const done = [first, ...rest].map((r) => queue.push(r));
    release();
    await Promise.all(done);
    return sent;
  };

  it('sends adds and deletes ahead of other requests', async () => {
    expect(await run(search(), update('a'), remove('b'), search())).to.deep.equal([
      'SEARCH search',
      'DELETE delete b',
      'PUT update a',
      'SEARCH search',
    ]);
  });

  it('does not send a delete ahead of an earlier update to the same entity', async () => {
    expect(await run(search(), update('x'), add('y'), remove('x'))).to.deep.equal([
      'SEARCH search',
      'POST add y',
      'PUT update x',
      'DELETE delete x',
    ]);
  });

  it('does not send a delete ahead of an earlier get of the same entity', async () => {
    expect(await run(search(), get('x'), remove('x'))).to.deep.equal(['SEARCH search', 'GET get x', 'DELETE delete x']);
  });

  it('does not bundle an update ahead of an earlier delete of the same entity', async () => {
    expect(await run(search(), update('x', 'a'), remove('x'), update('x', 'b'))).to.deep.equal([
      'SEARCH search',
      'PUT update x',
      'DELETE delete x',
      'PUT update x',
    ]);
  });

  it('bundles unrelated requests of the same type, in the order they were queued', async () => {
    expect(await run(search(), update('a', 'one'), add('b'), update('c', 'two'), add('d'))).to.deep.equal([
      'SEARCH search',
      'POST bulk ["b","d"]',
      'POST bulk [{"id":"a","body":"one"},{"id":"c","body":"two"}]',
    ]);
  });

  it('bundles updates to the same entity together', async () => {
    expect(await run(search(), update('x', 'a'), update('x', 'b'))).to.deep.equal([
      'SEARCH search',
      'POST bulk [{"id":"x","body":"a"},{"id":"x","body":"b"}]',
    ]);
  });

  it('sends requests in order when bundling is off', async () => {
    const { client, sent, release } = fakeClient();
    const queue = new ButtressRequestQueue(client, () => 'bulk', new Logger('test'));
    queue.bundling = false;

    const done = [search(), update('a'), add('b'), add('c')].map((r) => queue.push(r));
    release();
    await Promise.all(done);

    expect(sent).to.deep.equal(['SEARCH search', 'PUT update a', 'POST add b', 'POST add c']);
  });

  it('lets go of nextIdle waiters once idle', async () => {
    const { client, release } = fakeClient();
    const queue = new ButtressRequestQueue(client, () => 'bulk', new Logger('test'));

    const done = queue.push(search());
    const idle = queue.nextIdle();
    release();
    await done;
    await idle;

    expect((queue as unknown as { _idleWaiters: unknown[] })._idleWaiters.length).to.equal(0);
  });
});
