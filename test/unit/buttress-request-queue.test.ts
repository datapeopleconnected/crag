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

import { ButtressError, type ButtressClient } from '../../src/ButtressClient.js';
import { ButtressRequestQueue, QueuedRequest } from '../../src/ButtressRequestQueue.js';
import { Logger } from '../../src/Logger.js';

// Records what the queue sends, and holds the first request open until release() so the rest queue up behind it. It
// answers a bulk request with an entry for each item, as Buttress answers a bulk update.
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
      return url === 'bulk' ? (opts.body as unknown[]).map(() => ({ results: [] })) : {};
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

  it('sends a body as it was when queued', async () => {
    const bodies: unknown[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = {
      request: async (_method: string, _url: string, opts: { body?: unknown }) => {
        bodies.push(JSON.parse(JSON.stringify(opts.body ?? null)));
        if (bodies.length === 1) await held;
        return {};
      },
    } as unknown as ButtressClient;
    const queue = new ButtressRequestQueue(client, () => 'bulk', new Logger('test'));
    const entity = { id: 'x', tags: ['a'] };

    const done = [queue.push(search()), queue.push({ ...add('x'), body: entity })];
    entity.tags.push('b');
    release();
    await Promise.all(done);

    expect(bodies[1]).to.deep.equal({ id: 'x', tags: ['a'] });
  });

  describe('bulk responses', () => {
    let originalError: typeof console.error;

    beforeEach(() => {
      originalError = console.error;
      // The queue logs each request that fails.
      console.error = () => {};
    });

    afterEach(() => {
      console.error = originalError;
    });

    // Like fakeClient, with the response to each request from `respond`, which can also throw.
    const respondingClient = (respond: (method: string, url: string, body: unknown) => unknown) => {
      const sent: string[] = [];
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const client = {
        request: async (method: string, url: string, opts: { body?: unknown }) => {
          sent.push(url === 'bulk' ? `${method} bulk ${JSON.stringify(opts.body)}` : `${method} ${url}`);
          if (sent.length === 1) await held;
          return respond(method, url, opts.body);
        },
      };
      const queue = new ButtressRequestQueue(client as unknown as ButtressClient, () => 'bulk', new Logger('test'));
      return { queue, sent, release };
    };
    const outcome = (request: Promise<unknown>) =>
      request.then(
        () => 'resolved',
        (err: ButtressError) => `${err.status} ${err.serverMessage}`,
      );

    // Buttress answers a bulk update with an entry for each update, in the order sent.
    it('settles each bundled update from its own entry', async () => {
      const entries: Record<string, object> = {
        applied: { results: [{ type: 'scalar' }] },
        refused: { results: null, validation: { code: 400, message: 'organisation: Invalid ID: b' } },
        valid: { results: [{ type: 'scalar' }], validation: true },
        refusedWithResults: { results: [], validation: { code: 400, message: 'organisation: refused' } },
        unexplained: { results: null },
      };
      const { queue, release } = respondingClient((_method, url, body) =>
        url === 'bulk' ? (body as { id: string; body: string }[]).map((u) => ({ id: u.id, ...entries[u.body] })) : {},
      );

      const outcomes = [
        search(),
        update('a', 'applied'),
        update('b', 'refused'),
        update('a', 'valid'),
        update('c', 'refusedWithResults'),
        update('d', 'unexplained'),
      ].map((r) => outcome(queue.push(r)));
      release();

      expect(await Promise.all(outcomes)).to.deep.equal([
        'resolved',
        'resolved',
        '400 organisation: Invalid ID: b',
        'resolved',
        '400 organisation: refused',
        "500 Buttress didn't apply the update",
      ]);
    });

    // As from a Buttress older than crag supports, which merged the updates to each entity into one entry.
    for (const [shape, response] of Object.entries({
      'not a list': {},
      'too short': [{ results: [] }],
      'not of entries': [null, 'x'],
    })) {
      it(`rejects every bundled update when the response is ${shape}`, async () => {
        const { queue, release } = respondingClient((_method, url) => (url === 'bulk' ? response : {}));

        const outcomes = [search(), update('a'), update('b')].map((r) =>
          queue.push(r).then(
            () => 'resolved',
            (err: Error) => err.message,
          ),
        );
        release();
        const [searched, ...updates] = await Promise.all(outcomes);

        expect(searched).to.equal('resolved');
        expect(updates).to.have.length(2);
        updates.forEach((message) => expect(message).to.match(/^Buttress didn't answer each update .* 3f044191/));
      });
    }

    it('rejects every bundled update when the bulk update fails', async () => {
      const { queue, release } = respondingClient((_method, url) => {
        if (url === 'bulk') throw new ButtressError(500, 'POST', url, 'Internal Server Error');
        return {};
      });

      const outcomes = [search(), update('a'), update('b')].map((r) => outcome(queue.push(r)));
      release();

      expect(await Promise.all(outcomes)).to.deep.equal([
        'resolved',
        '500 Internal Server Error',
        '500 Internal Server Error',
      ]);
    });

    // Buttress stores none of a bulk add if one is invalid, and names only the first.
    it('sends each create in a bulk add Buttress refused on its own, ahead of what was queued after it', async () => {
      const { queue, sent, release } = respondingClient((_method, url, body) => {
        if (url === 'bulk') throw new ButtressError(400, 'POST', url, 'organisation: Missing field: name at index 1');
        if (body === 'bad') throw new ButtressError(400, 'POST', url, 'organisation: Missing field: name');
        return {};
      });

      // The update to a waits for a's create, which is sent again.
      const outcomes = [search(), add('a'), add('bad'), add('c'), update('a')].map((r) => outcome(queue.push(r)));
      release();

      expect(await Promise.all(outcomes)).to.deep.equal([
        'resolved',
        'resolved',
        '400 organisation: Missing field: name',
        'resolved',
        'resolved',
      ]);
      expect(sent).to.deep.equal([
        'SEARCH search',
        'POST bulk ["a","bad","c"]',
        'POST add a',
        'POST add bad',
        'POST add c',
        'PUT update a',
      ]);
    });

    it('rejects every create in a bulk add that fails with no response', async () => {
      const { queue, release } = respondingClient((_method, url) => {
        if (url === 'bulk') throw new TypeError('Failed to fetch');
        return {};
      });

      const outcomes = [search(), add('a'), add('b')].map((r) =>
        queue.push(r).then(
          () => 'resolved',
          (err: Error) => err.message,
        ),
      );
      release();

      expect(await Promise.all(outcomes)).to.deep.equal(['resolved', 'Failed to fetch', 'Failed to fetch']);
    });
  });

  it('bundles adds that do not name their entity', async () => {
    const anonymous = (body: string): QueuedRequest => ({ type: 'add', method: 'POST', url: 'add', body });

    expect(await run(search(), anonymous('a'), anonymous('b'))).to.deep.equal(['SEARCH search', 'POST bulk ["a","b"]']);
  });
});
