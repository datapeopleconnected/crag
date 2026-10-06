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

import ButtressDataService from '../../src/ButtressDataService.js';
import ButtressStore, { ButtressEntity } from '../../src/ButtressStore.js';
import ButtressSchema from '../../src/ButtressSchema.js';
import { Logger } from '../../src/Logger.js';
import { ButtressError } from '../../src/ButtressClient.js';

const schema: ButtressSchema = {
  name: 'organisation',
  type: 'collection',
  properties: { name: { __type: 'string' } },
};

// Lets the store flush its queued changes, which is when the data service queues its requests.
const flush = () =>
  new Promise((resolve) => {
    setTimeout(resolve);
  });

type Outcome = 'resolved' | 'rejected' | 'pending';

// Reports how a promise has settled, or 'pending' if it hasn't within the wait.
const outcomeOf = (promise: Promise<unknown>, wait = 200): Promise<Outcome> =>
  Promise.race([
    promise.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    ),
    new Promise<Outcome>((resolve) => {
      setTimeout(() => resolve('pending'), wait);
    }),
  ]);

// Creates an entity and returns a promise that settles when its add request does.
const createAndTrack = (ds: ButtressDataService, name: string) =>
  new Promise((resolve, reject) => {
    ds.create({ id: '', name }, { dboComplete: { resolve, reject } });
  });

describe('ButtressDataService request queue', () => {
  let originalFetch: typeof window.fetch;
  let originalError: typeof console.error;
  let requests: string[];
  let releaseFirst: () => void;
  let status: number;

  beforeEach(() => {
    originalFetch = window.fetch;
    originalError = console.error;
    requests = [];
    status = 200;
    Logger.disableLogging = true;

    // Holds the first request open so the requests after it queue up and get bundled.
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method} ${new URL(input.toString()).pathname}`);
      const respond = () => new Response(status === 200 ? '[]' : '{"message":"nope"}', { status });
      if (requests.length > 1) return Promise.resolve(respond());
      return new Promise<Response>((resolve) => {
        releaseFirst = () => resolve(respond());
      });
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
    console.error = originalError;
    Logger.disableLogging = false;
  });

  const dataService = () =>
    new ButtressDataService(
      'organisation',
      false,
      { endpoint: 'https://example.test', token: 'abc' },
      new ButtressStore(),
      schema,
    );

  it('settles every create that is bundled into a bulk add', async () => {
    const ds = dataService();

    const first = createAndTrack(ds, 'first');
    const second = createAndTrack(ds, 'second');
    const third = createAndTrack(ds, 'third');
    await flush();
    releaseFirst();

    expect(await outcomeOf(first)).to.equal('resolved');
    expect(await outcomeOf(second)).to.equal('resolved');
    expect(await outcomeOf(third)).to.equal('resolved');
    expect(requests.some((url) => url.includes('/bulk/add'))).to.equal(true);
  });

  it('sends an update and then a delete of the same entity in that order', async () => {
    const ds = dataService();
    ds.get('organisation').set('x', { id: 'x', name: 'a' });

    ds.getById('held');
    ds.set('organisation.x.name', 'b');
    // The update is only worked out when the store flushes, so it must flush before x is deleted from the store.
    await flush();
    ds.create({ id: 'y', name: 'y' });
    ds.delete('x');
    await flush();
    releaseFirst();
    await ds.nextIdle();

    expect(requests).to.deep.equal([
      'GET /api/v1/organisation/held',
      'POST /api/v1/organisation/',
      'PUT /api/v1/organisation/x',
      'DELETE /api/v1/organisation/x',
    ]);
  });

  it('rejects every create in a bulk add that fails', async () => {
    const ds = dataService();
    // Logger.error prints even with logging disabled.
    console.error = () => {};

    const first = createAndTrack(ds, 'first');
    const second = createAndTrack(ds, 'second');
    const third = createAndTrack(ds, 'third');
    await flush();
    status = 500;
    releaseFirst();

    expect(await outcomeOf(first)).to.equal('rejected');
    expect(await outcomeOf(second)).to.equal('rejected');
    expect(await outcomeOf(third)).to.equal('rejected');
  });

  it('rejects a failed request with a ButtressError', async () => {
    const ds = dataService();
    console.error = () => {};
    status = 403;

    const failed = createAndTrack(ds, 'first');
    await flush();
    releaseFirst();
    const err = (await failed.catch((e) => e)) as ButtressError;

    expect(err).to.be.instanceOf(ButtressError);
    expect(err.status).to.equal(403);
  });

  it('waits in nextIdle for a request that has already been sent', async () => {
    const ds = dataService();

    let written = false;
    createAndTrack(ds, 'first').then(() => {
      written = true;
    });
    await flush();
    const idle = ds.nextIdle();

    expect(await outcomeOf(idle, 50)).to.equal('pending');
    releaseFirst();
    await idle;
    expect(written).to.equal(true);
  });

  it('resolves nextIdle straight away when nothing is queued or sent', async () => {
    const ds = dataService();

    expect(await outcomeOf(ds.nextIdle(), 50)).to.equal('resolved');
  });

  it('lets go of nextIdle waiters once the queue is idle', async () => {
    const ds = dataService();

    createAndTrack(ds, 'first');
    await flush();
    const idle = ds.nextIdle();
    await flush();
    releaseFirst();
    await idle;

    expect((ds as any)._queue._idleWaiters.length).to.equal(0);
  });
});

describe('ButtressDataService request timeout', () => {
  let originalFetch: typeof window.fetch;
  let originalError: typeof console.error;

  beforeEach(() => {
    originalFetch = window.fetch;
    originalError = console.error;
    // The queue logs the request that timed out.
    console.error = () => {};
  });

  afterEach(() => {
    window.fetch = originalFetch;
    console.error = originalError;
  });

  it('sends the requests queued behind one that never answers once it times out', async () => {
    const sent: string[] = [];
    // The first request never gets a response, and fails when its signal aborts, as fetch does.
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(`${init?.method} ${new URL(input.toString()).pathname}`);
      if (sent.length > 1) return Promise.resolve(new Response('{}'));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    };
    const ds = new ButtressDataService(
      'organisation',
      false,
      { endpoint: 'https://example.test', token: 'abc', requestTimeout: 20 },
      new ButtressStore(),
      schema,
    );

    const hung = ds.getById('hung');
    const created = createAndTrack(ds, 'next');

    expect(await outcomeOf(hung)).to.equal('rejected');
    expect(await outcomeOf(created)).to.equal('resolved');
    expect(sent).to.deep.equal(['GET /api/v1/organisation/hung', 'POST /api/v1/organisation/']);
  });
});

// A request's body is made from the store's objects, which can change before the request is sent.
describe('ButtressDataService queued request bodies', () => {
  type Sent = { method: string; path: string; body?: unknown };

  let originalFetch: typeof window.fetch;
  let sent: Sent[];

  const listSchema: ButtressSchema = {
    name: 'organisation',
    type: 'collection',
    properties: { name: { __type: 'string' }, tags: { __type: 'array' } },
  };

  beforeEach(() => {
    originalFetch = window.fetch;
    sent = [];
    Logger.disableLogging = true;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(input.toString()).pathname.replace('/api/v1/organisation', '');
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      sent.push({ method: init!.method!, path, body });
      // As Buttress does, a bulk update is answered for each update in it.
      if (path === '/bulk/update') return new Response(JSON.stringify(body.map(() => ({ results: [] }))));
      return new Response('{}');
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
    Logger.disableLogging = false;
  });

  const dataService = () =>
    new ButtressDataService(
      'organisation',
      false,
      { endpoint: 'https://example.test', token: 'abc' },
      new ButtressStore(),
      listSchema,
    );

  // The first create is sent straight away, so each later one waits in the queue while the push after it runs.
  it('sends each create as it was made, and not the pushes after it as well', async () => {
    const ds = dataService();

    for (const name of ['a', 'b', 'c']) {
      const path = ds.create({ id: name, name, tags: [] });
      ds.push(`${path}.tags`, 'new');
    }
    await ds.nextIdle();

    const creates = sent.filter((r) => r.method === 'POST' && r.path === '/');
    const bundled = sent.filter((r) => r.path === '/bulk/add').flatMap((r) => r.body as unknown[]);
    expect([...creates.map((r) => r.body), ...bundled]).to.deep.equal(
      ['a', 'b', 'c'].map((name) => ({ id: name, name, tags: [] })),
    );
    expect(ds.get('organisation.c.tags')).to.deep.equal(['new']);
  });

  it('sends a create as it was made, and not a splice after it as well', async () => {
    const ds = dataService();
    ds.create({ id: 'first', name: 'first', tags: [] });

    ds.create({ id: 'x', name: 'x', tags: ['a', 'b'] });
    ds.splice('organisation.x.tags', 0, 1);
    await ds.nextIdle();

    expect(sent.slice(1)).to.deep.equal([
      { method: 'POST', path: '/', body: { id: 'x', name: 'x', tags: ['a', 'b'] } },
      { method: 'PUT', path: '/x', body: { path: 'tags.0.__remove__', value: '' } },
    ]);
  });
});

describe('ButtressDataService query', () => {
  type Org = { id: string; name: string; status: string };

  let originalFetch: typeof window.fetch;
  let server: Org[];
  let searches: number;
  let holdSearches: Promise<void> | undefined;
  // The properties a policy hides from the token, by entity id. Buttress still matches on them.
  let hidden: Map<string, string[]>;

  // Pretends to be Buttress: answers searches (with $eq, $ne, sort, skip and limit), counts and GETs from `server`.
  const matches = (org: Org, query: Record<string, { $eq?: string; $ne?: string }>) =>
    Object.entries(query).every(([field, condition]) =>
      '$ne' in condition ? (org as any)[field] !== condition.$ne : (org as any)[field] === condition.$eq,
    );
  // An entity as the token sees it
  const shown = (org: Org) =>
    Object.fromEntries(Object.entries(org).filter(([key]) => !hidden.get(org.id)?.includes(key)));

  beforeEach(() => {
    originalFetch = window.fetch;
    Logger.disableLogging = true;
    searches = 0;
    holdSearches = undefined;
    hidden = new Map();
    server = Array.from({ length: 25 }, (_, i) => ({
      id: `id${String(i + 1).padStart(2, '0')}`,
      name: `A${String(i + 1).padStart(2, '0')}`,
      status: 'active',
    }));
    server.push({ id: 'idx', name: 'Inactive', status: 'inactive' });

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      if (init?.method === 'QUERY' && url.pathname.endsWith('/organisation/count')) {
        return new Response(JSON.stringify(server.filter((o) => matches(o, body.query)).length));
      }
      if (init?.method === 'POST' && url.pathname.endsWith('/organisation/')) {
        server.push(body);
        return new Response(JSON.stringify(body));
      }
      // Answered for each update, as Buttress does, without applying them.
      if (url.pathname.endsWith('/bulk/update')) return new Response(JSON.stringify(body.map(() => ({ results: [] }))));
      if (init?.method === 'QUERY') {
        searches += 1;
        await holdSearches;
        let found = server.filter((o) => matches(o, body.query));
        if (body.sort?.name) found = found.sort((a, b) => (a.name < b.name ? -body.sort.name : body.sort.name));
        found = found.slice(body.skip, body.limit ? body.skip + body.limit : undefined);
        return new Response(JSON.stringify(found.map(shown)));
      }
      if (init?.method === 'GET') {
        const org = server.find(({ id }) => id === url.pathname.split('/').pop());
        return new Response(JSON.stringify(org && shown(org)));
      }
      return new Response('{}');
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
    Logger.disableLogging = false;
  });

  const active = { status: { $eq: 'active' } };
  const byName = { path: 'name', direction: 'ASC' as const };
  const names = (results: ButtressEntity[]) => results.map((r) => r.name);
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `A${String(from + i).padStart(2, '0')}`);

  const dataService = () =>
    new ButtressDataService(
      'organisation',
      false,
      { endpoint: 'https://example.test', token: 'abc' },
      new ButtressStore(),
      schema,
    );

  it('returns the page the server sent when it is the first page loaded', async () => {
    const ds = dataService();

    const { results, total } = await ds.query(active, { limit: 10, skip: 10, sort: byName });

    expect(names(results)).to.deep.equal(range(11, 20));
    expect(total).to.equal(25);
  });

  it('leaves other matching entities in the store off a page', async () => {
    const ds = dataService();
    // An entity the server no longer counts as a match, but the store still does.
    ds.get('organisation').set('stale', { id: 'stale', name: 'A00', status: 'active' });

    const { results } = await ds.query(active, { limit: 10, skip: 0, sort: byName });

    expect(names(results)).to.deep.equal(range(1, 10));
  });

  it('treats skip without limit as a page', async () => {
    const ds = dataService();
    ds.get('organisation').set('stale', { id: 'stale', name: 'A00', status: 'active' });

    const { results } = await ds.query(active, { skip: 20, sort: byName });

    expect(names(results)).to.deep.equal(range(21, 25));
  });

  it('serves a page again from the cache', async () => {
    const ds = dataService();

    await ds.query(active, { limit: 10, skip: 0, sort: byName });
    const { results } = await ds.query(active, { limit: 10, skip: 0, sort: byName });

    expect(searches).to.equal(1);
    expect(names(results)).to.deep.equal(range(1, 10));
  });

  it('drops entities from a cached page once they no longer match', async () => {
    const ds = dataService();
    await ds.query(active, { limit: 10, skip: 0, sort: byName });

    ds.set('organisation.id03.status', 'inactive');
    const { results } = await ds.query(active, { limit: 10, skip: 0, sort: byName });

    expect(names(results)).to.deep.equal(range(1, 10).filter((n) => n !== 'A03'));
  });

  it('drops deleted entities from a cached page', async () => {
    const ds = dataService();
    await ds.query(active, { limit: 10, skip: 0, sort: byName });

    ds.delete('id02');
    const { results } = await ds.query(active, { limit: 10, skip: 0, sort: byName });

    expect(names(results)).to.deep.equal(range(1, 10).filter((n) => n !== 'A02'));
  });

  it('adds new entities to a cached page only when busted', async () => {
    const ds = dataService();
    await ds.query(active, { limit: 10, skip: 0, sort: byName });
    server.push({ id: 'id00', name: 'A00', status: 'active' });

    const cached = await ds.query(active, { limit: 10, skip: 0, sort: byName });
    const busted = await ds.query(active, { limit: 10, skip: 0, sort: byName, bust: true });

    expect(names(cached.results)).to.deep.equal(range(1, 10));
    expect(names(busted.results)).to.deep.equal(['A00', ...range(1, 9)]);
  });

  it('searches again after clearQueryMap', async () => {
    const ds = dataService();
    await ds.query(active, { limit: 10, skip: 0, sort: byName });

    ds.clearQueryMap();
    await ds.query(active, { limit: 10, skip: 0, sort: byName });

    expect(searches).to.equal(2);
  });

  it('searches for a cached page again after a create', async () => {
    const ds = dataService();
    await ds.query(active, { limit: 10, skip: 0, sort: byName });

    ds.create({ id: 'id00', name: 'A00', status: 'active' });
    await flush();
    const { results } = await ds.query(active, { limit: 10, skip: 0, sort: byName });

    expect(searches).to.equal(2);
    expect(names(results)).to.deep.equal(['A00', ...range(1, 9)]);
  });

  it('searches for a cached page again after a create from elsewhere', async () => {
    const ds = dataService();
    await ds.query(active, { limit: 10, skip: 0, sort: byName });

    // How ButtressRealtime adds an entity another client created.
    ds.create({ id: 'id00', name: 'A00', status: 'active' }, { localOnly: true });
    await ds.query(active, { limit: 10, skip: 0, sort: byName });

    expect(searches).to.equal(2);
  });

  it('does not cache a page whose search was sent before a create', async () => {
    const ds = dataService();
    let release!: () => void;
    holdSearches = new Promise((resolve) => {
      release = resolve;
    });

    const loading = ds.query(active, { limit: 10, skip: 0, sort: byName });
    await flush();
    ds.create({ id: 'id00', name: 'A00', status: 'active' });
    release();
    await loading;
    await flush();
    const { results } = await ds.query(active, { limit: 10, skip: 0, sort: byName });

    expect(searches).to.equal(2);
    expect(names(results)).to.deep.equal(['A00', ...range(1, 9)]);
  });

  // A search's response is older than a write made while it was out: Buttress hadn't had the write when it searched.
  describe('with a write made while a search is out', () => {
    let release: () => void;
    const hold = () => {
      holdSearches = new Promise((resolve) => {
        release = resolve;
      });
    };

    it('keeps the write', async () => {
      const ds = dataService();
      await ds.query(active, { sort: byName });
      hold();

      const loading = ds.query(active, { sort: byName, bust: true });
      await flush();
      ds.set('organisation.id01.name', 'Z01');
      ds.set('organisation.id01.note', 'renamed');
      release();
      const { results } = await loading;

      expect(ds.get('organisation.id01')).to.deep.equal({ id: 'id01', name: 'Z01', status: 'active', note: 'renamed' });
      expect(results.find((r) => r.id === 'id01')?.name).to.equal('Z01');
    });

    it('keeps the write when the search was still queued', async () => {
      const ds = dataService();
      await ds.query(active, { sort: byName });
      hold();

      const first = ds.query(active, { sort: byName, bust: true });
      // Queued behind the first, and sent before the update, which is queued behind it.
      const second = ds.query(active, { limit: 10, sort: byName });
      await flush();
      ds.set('organisation.id01.name', 'Z01');
      release();
      await Promise.all([first, second]);

      expect(searches).to.equal(3);
      expect(ds.get('organisation.id01.name')).to.equal('Z01');
    });

    it('still merges the fresh values of the other properties', async () => {
      const ds = dataService();
      await ds.query({});
      // Changed by another client.
      server[0].status = 'archived';
      hold();

      const loading = ds.query({}, { bust: true });
      await flush();
      ds.set('organisation.id01.name', 'Z01');
      release();
      await loading;

      expect(ds.get('organisation.id01')).to.deep.equal({ id: 'id01', name: 'Z01', status: 'archived' });
    });

    it('does not bring back an entity deleted meanwhile', async () => {
      const ds = dataService();
      await ds.query(active, { sort: byName });
      hold();

      const loading = ds.query(active, { sort: byName, bust: true });
      await flush();
      ds.delete('id02');
      release();
      const { results } = await loading;

      expect(ds.get('organisation.id02')).to.equal(undefined);
      expect(names(results)).to.not.include('A02');
    });

    it('keeps a set made just after a create and a paged query', async () => {
      const ds = dataService();

      ds.create({ id: 'id00', name: 'A00', status: 'active' });
      const loading = ds.query(active, { limit: 10, sort: byName });
      ds.set('organisation.id00.name', 'B00');
      const { results } = await loading;

      expect(ds.get('organisation.id00.name')).to.equal('B00');
      expect(results[0]).to.deep.equal({ id: 'id00', name: 'B00', status: 'active' });
    });
  });

  // A resync clears the cache because updates may have been missed. A search sent before it may be missing them too.
  describe('with the query cache cleared while a search is out', () => {
    let release: () => void;
    const clearedWhileOut = async (ds: ButtressDataService, opts: object) => {
      holdSearches = new Promise((resolve) => {
        release = resolve;
      });
      const loading = ds.query(active, opts);
      await flush();
      ds.clearQueryMap();
      release();
      return loading;
    };

    it('searches again for the query', async () => {
      const ds = dataService();

      await clearedWhileOut(ds, { sort: byName });
      await ds.query(active, { sort: byName });

      expect(searches).to.equal(2);
    });

    it('searches again for the page', async () => {
      const ds = dataService();

      await clearedWhileOut(ds, { limit: 10, sort: byName });
      const { results } = await ds.query(active, { limit: 10, sort: byName });

      expect(searches).to.equal(2);
      expect(names(results)).to.deep.equal(range(1, 10));
    });

    // Not cached, but still the page Buttress sent, as paged queries always are.
    it('still returns the page the search found', async () => {
      const ds = dataService();

      const { results } = await clearedWhileOut(ds, { limit: 10, sort: byName });

      expect(names(results)).to.deep.equal(range(1, 10));
    });

    it('still keeps the entities the search found', async () => {
      const ds = dataService();

      await clearedWhileOut(ds, { sort: byName });

      expect(ds.get('organisation.id01')).to.deep.equal({ id: 'id01', name: 'A01', status: 'active' });
    });
  });

  it('keeps cached unpaged queries after a create', async () => {
    const ds = dataService();
    await ds.query(active, { sort: byName });

    ds.create({ id: 'id00', name: 'A00', status: 'active' });
    await flush();
    await ds.query(active, { sort: byName });

    expect(searches).to.equal(1);
  });

  it('includes local changes in an unpaged query', async () => {
    const ds = dataService();
    await ds.query(active, { sort: byName });

    ds.create({ id: 'local', name: 'A00', status: 'active' });
    ds.set('organisation.id03.status', 'inactive');
    const { results } = await ds.query(active, { sort: byName });

    expect(names(results)).to.deep.equal(['A00', ...range(1, 25).filter((n) => n !== 'A03')]);
  });

  // Without limit or skip, results are the entities Buttress matched, and those written since it was asked, as crag
  // matches them now.
  describe('unpaged results', () => {
    const notActive = { status: { $ne: 'active' } };

    // An active organisation whose status the token can't see, which crag reads as missing.
    const withHiddenStatus = async () => {
      server.push({ id: 'idh', name: 'Hidden', status: 'active' });
      hidden.set('idh', ['status']);
      const ds = dataService();
      await ds.query({});
      return ds;
    };

    it('leaves out an entity Buttress did not match, though it matches locally', async () => {
      const ds = await withHiddenStatus();

      const { results } = await ds.query(notActive);

      expect(ds.get('organisation.idh')).to.deep.equal({ id: 'idh', name: 'Hidden' });
      expect(names(results)).to.deep.equal(['Inactive']);
    });

    it('leaves it out when the answer is cached', async () => {
      const ds = await withHiddenStatus();
      await ds.query(notActive);

      const { results } = await ds.query(notActive);

      expect(searches).to.equal(2);
      expect(names(results)).to.deep.equal(['Inactive']);
    });

    it('leaves out an entity fetched by id after Buttress answered', async () => {
      server.push({ id: 'idh', name: 'Hidden', status: 'active' });
      hidden.set('idh', ['status']);
      const ds = dataService();
      await ds.query(notActive);

      await ds.getById('idh');
      const { results } = await ds.query(notActive);

      expect(names(results)).to.deep.equal(['Inactive']);
    });

    it('matches locally an entity fetched because Buttress changed it', async () => {
      const ds = dataService();
      await ds.query(active, { sort: byName });
      // Changed by another client, whose realtime update made crag fetch it
      server[25].status = 'active';

      await ds.getById('idx', { changed: true });
      const { results } = await ds.query(active, { sort: byName });

      expect(searches).to.equal(1);
      expect(names(results)).to.deep.equal([...range(1, 25), 'Inactive']);
    });

    it('matches locally an entity changed since so it now matches', async () => {
      const ds = dataService();
      await ds.query({});
      await ds.query(active, { sort: byName });

      ds.set('organisation.idx.status', 'active');
      const { results } = await ds.query(active, { sort: byName });

      expect(searches).to.equal(2);
      expect(names(results)).to.deep.equal([...range(1, 25), 'Inactive']);
    });

    it('matches locally an entity created by another client', async () => {
      const ds = dataService();
      await ds.query(active, { sort: byName });

      // How ButtressRealtime adds an entity another client created.
      ds.create({ id: 'id00', name: 'A00', status: 'active' }, { localOnly: true });
      const { results } = await ds.query(active, { sort: byName });

      expect(names(results)).to.deep.equal(['A00', ...range(1, 25)]);
    });

    it('matches locally an entity written while the search was out', async () => {
      const ds = dataService();
      await ds.query({});
      let release!: () => void;
      holdSearches = new Promise((resolve) => {
        release = resolve;
      });

      const loading = ds.query(active, { sort: byName });
      await flush();
      ds.set('organisation.idx.status', 'active');
      release();
      const { results } = await loading;

      expect(names(results)).to.deep.equal([...range(1, 25), 'Inactive']);
    });

    it('matches locally the entities of a collection set in place of the old one', async () => {
      const ds = dataService();
      await ds.query(active, { sort: byName });

      ds.set('organisation', new Map([['local', { id: 'local', name: 'A00', status: 'active' }]]));
      const { results } = await ds.query(active, { sort: byName });

      expect(names(results)).to.deep.equal(['A00']);
    });

    // So a property a policy hides reads as missing again, as the README says.
    it('matches locally an entity with a hidden property once it has been written', async () => {
      const ds = await withHiddenStatus();
      await ds.query(notActive);

      ds.set('organisation.idh.name', 'Hidden 2');
      const { results } = await ds.query(notActive);

      expect(names(results)).to.deep.equal(['Inactive', 'Hidden 2']);
    });
  });

  it('sends the sort direction to Buttress', async () => {
    const ds = dataService();

    const { results } = await ds.query(active, { limit: 3, sort: { path: 'name', direction: 'DESC' } });

    expect(names(results)).to.deep.equal(['A25', 'A24', 'A23']);
  });

  it('merges an entity the server sends twice', async () => {
    const ds = dataService();
    const fetchPage = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'QUERY' && !new URL(input.toString()).pathname.endsWith('/count')) {
        return new Response(
          JSON.stringify([
            { id: 'id01', name: 'A01' },
            { id: 'id01', status: 'active' },
          ]),
        );
      }
      return fetchPage(input, init);
    };

    const { results } = await ds.query(active, { limit: 10 });

    expect(results).to.deep.equal([{ id: 'id01', name: 'A01', status: 'active' }]);
  });

  describe('with the query cache cleared while the count is out', () => {
    // A resync clearing the cache between the search and the count.
    const clearOnCount = (ds: ButtressDataService) => {
      const fetchPage = window.fetch;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (new URL(input.toString()).pathname.endsWith('/count')) ds.clearQueryMap();
        return fetchPage(input, init);
      };
    };

    it('returns the page it searched for', async () => {
      const ds = dataService();
      clearOnCount(ds);

      const { results, total } = await ds.query(active, { limit: 10 });

      expect(names(results)).to.deep.equal(range(1, 10));
      expect(total).to.equal(25);
    });

    it('returns the cached page it was answered from', async () => {
      const ds = dataService();
      await ds.query(active, { limit: 10 });
      clearOnCount(ds);

      const { results } = await ds.query(active, { limit: 10 });

      expect(searches).to.equal(1);
      expect(names(results)).to.deep.equal(range(1, 10));
    });
  });

  it('logs the query and throws when the store cannot run it', async () => {
    const ds = dataService();
    window.fetch = async (input: RequestInfo | URL) =>
      new Response(new URL(input.toString()).pathname.endsWith('/count') ? '0' : '[]');
    const originalError = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => logged.push(args);

    // Buttress refuses a pattern that isn't one, but this one answers anything.
    const err = await ds.query({ name: { $rex: '(' } }).catch((e: unknown) => e);
    console.error = originalError;

    expect(err).to.be.instanceOf(SyntaxError);
    expect(logged).to.have.length(1);
  });
});

describe('ButtressDataService $exists', () => {
  const ds = new ButtressDataService('organisation', false, {}, new ButtressStore(), schema);
  const data = [
    { id: 'set', name: 'Set', tags: ['a'] },
    { id: 'null', name: null, tags: [] },
    { id: 'falsy', name: '', tags: [] },
    { id: 'missing' },
  ];
  const ids = (query: object) => ds._processQueryPart(query, data).map((o: ButtressEntity) => o.id);

  it('matches entities that have the property, whatever its value', () => {
    expect(ids({ name: { $exists: true } })).to.deep.equal(['set', 'null', 'falsy']);
  });

  it('matches entities that do not have the property', () => {
    expect(ids({ name: { $exists: false } })).to.deep.equal(['missing']);
  });

  it('counts an empty array as present', () => {
    expect(ids({ tags: { $exists: true } })).to.deep.equal(['set', 'null', 'falsy']);
  });
});

// What each write sends to Buttress, for the cases that already work. These pin the behaviour while writes move
// from being worked out from store notifications to being sent by the write methods themselves.
describe('ButtressDataService writes', () => {
  type Sent = { method: string; path: string; body?: unknown };

  let originalFetch: typeof window.fetch;
  let sent: Sent[];
  let status: number;

  const writeSchema: ButtressSchema = {
    name: 'organisation',
    type: 'collection',
    properties: {
      name: { __type: 'string' },
      tags: { __type: 'array' },
      // @ts-expect-error ButtressSchemaProperty can't type a plain nested object, though the store handles one.
      address: { city: { __type: 'string' } },
      contacts: { __type: 'array', __schema: { phones: { __type: 'array' } } },
    },
  };

  beforeEach(() => {
    originalFetch = window.fetch;
    sent = [];
    status = 200;
    Logger.disableLogging = true;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const path = new URL(input.toString()).pathname.replace('/api/v1/organisation', '');
      sent.push({ method: init!.method!, path, body });
      // As Buttress does, a bulk update is answered for each update in it.
      if (status === 200 && path === '/bulk/update') {
        return new Response(JSON.stringify(body.map(() => ({ results: [] }))));
      }
      return new Response(status === 200 ? '{}' : '{"message":"nope"}', { status });
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
    Logger.disableLogging = false;
  });

  // A data service with entity x in its store, as if it had been queried.
  const withEntity = () => {
    const ds = new ButtressDataService(
      'organisation',
      false,
      { endpoint: 'https://example.test', token: 'abc' },
      new ButtressStore(),
      writeSchema,
    );
    ds.get('organisation').set('x', {
      id: 'x',
      name: 'a',
      tags: ['a', 'b'],
      address: { city: 'Leeds' },
      contacts: [{ id: 'c1', phones: [] }],
    });
    return ds;
  };

  const settle = async (ds: ButtressDataService) => {
    await flush();
    await ds.nextIdle();
  };

  const tracked = () => {
    let outcome = 'pending';
    const dboComplete = {
      resolve: () => {
        outcome = 'resolved';
      },
      reject: () => {
        outcome = 'rejected';
      },
    };
    return { dboComplete, outcome: () => outcome };
  };

  it('sends a set as an update to that path', async () => {
    const ds = withEntity();

    ds.set('organisation.x.name', 'b');
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'PUT', path: '/x', body: { path: 'name', value: 'b' } }]);
  });

  it('sends a set inside a nested object or array item with the path from the entity', async () => {
    const ds = withEntity();

    ds.set('organisation.x.address.city', 'York');
    ds.set('organisation.x.tags.0', 'z');
    await settle(ds);

    expect(sent).to.deep.equal([
      { method: 'PUT', path: '/x', body: { path: 'address.city', value: 'York' } },
      { method: 'PUT', path: '/x', body: { path: 'tags.0', value: 'z' } },
    ]);
  });

  it('sends a whole array set as an update with the array', async () => {
    const ds = withEntity();

    ds.set('organisation.x.tags', ['c']);
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'PUT', path: '/x', body: { path: 'tags', value: ['c'] } }]);
  });

  it('sends a set of an entity that is not in the store as an add', async () => {
    const ds = withEntity();

    ds.set('organisation.y', { id: 'y', name: 'y' });
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'POST', path: '/', body: { id: 'y', name: 'y' } }]);
  });

  it('sends a push of one item as an update that appends it', async () => {
    const ds = withEntity();

    ds.push('organisation.x.tags', 'c');
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'PUT', path: '/x', body: { path: 'tags', value: 'c' } }]);
  });

  it('sends a push into an array item with the path from the entity', async () => {
    const ds = withEntity();

    ds.push('organisation.x.contacts.0.phones', '0113');
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'PUT', path: '/x', body: { path: 'contacts.0.phones', value: '0113' } }]);
  });

  it('gives a pushed object an id', async () => {
    const ds = withEntity();

    ds.push('organisation.x.contacts', { phones: [] });
    await settle(ds);

    const { value } = sent[0].body as { value: { id: string } };
    expect(value.id).to.match(/^[0-9a-f]{24}$/);
    expect(ds.get('organisation.x.contacts.1.id')).to.equal(value.id);
  });

  it('sends a splice removing one item as a remove at that index', async () => {
    const ds = withEntity();

    ds.splice('organisation.x.tags', 1, 1);
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'PUT', path: '/x', body: { path: 'tags.1.__remove__', value: '' } }]);
  });

  it('sends a create as an add', async () => {
    const ds = withEntity();

    ds.create({ id: 'y', name: 'y' });
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'POST', path: '/', body: { id: 'y', name: 'y' } }]);
  });

  it('sends a delete', async () => {
    const ds = withEntity();

    ds.delete('x');
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'DELETE', path: '/x', body: undefined }]);
    expect(ds.get('organisation.x')).to.equal(undefined);
  });

  it('sends nothing for localOnly writes', async () => {
    const ds = withEntity();

    ds.set('organisation.x.name', 'b', { localOnly: true });
    ds.pushExt('organisation.x.tags', { localOnly: true }, 'c');
    ds.spliceExt('organisation.x.tags', 0, 1, { localOnly: true });
    ds.create({ id: 'y', name: 'y' }, { localOnly: true });
    ds.delete('y', { localOnly: true });
    await settle(ds);

    expect(sent).to.deep.equal([]);
    expect(ds.get('organisation.x.name')).to.equal('b');
    expect(ds.get('organisation.x.tags')).to.deep.equal(['b', 'c']);
  });

  it('sends nothing for silent or forceChanged sets', async () => {
    const ds = withEntity();

    ds.set('organisation.x.name', 'b', { silent: true });
    ds.set('organisation.x.address.city', 'York', { forceChanged: true });
    await settle(ds);

    expect(sent).to.deep.equal([]);
    expect(ds.get('organisation.x.name')).to.equal('b');
  });

  it('sends nothing, and resolves dboComplete, when the value has not changed', async () => {
    const ds = withEntity();
    const { dboComplete, outcome } = tracked();

    ds.set('organisation.x.name', 'a', { dboComplete });
    await settle(ds);

    expect(sent).to.deep.equal([]);
    expect(outcome()).to.equal('resolved');
  });

  it('resolves dboComplete once Buttress accepts the write', async () => {
    const ds = withEntity();
    const set = tracked();
    const created = tracked();
    const deleted = tracked();

    ds.set('organisation.x.name', 'b', { dboComplete: set.dboComplete });
    ds.create({ id: 'y', name: 'y' }, { dboComplete: created.dboComplete });
    await settle(ds);
    ds.delete('y', { dboComplete: deleted.dboComplete });
    await settle(ds);

    expect([set.outcome(), created.outcome(), deleted.outcome()]).to.deep.equal(['resolved', 'resolved', 'resolved']);
  });

  it('sends a set and then a delete of the same entity in one go', async () => {
    const ds = withEntity();

    ds.set('organisation.x.name', 'b');
    ds.delete('x');
    await settle(ds);

    expect(sent).to.deep.equal([
      { method: 'PUT', path: '/x', body: { path: 'name', value: 'b' } },
      { method: 'DELETE', path: '/x', body: undefined },
    ]);
  });

  it('sends a set of an entity already in the store as updates to the values that changed', async () => {
    const ds = withEntity();
    const entity = ds.get('organisation.x');

    ds.set('organisation.x', { ...entity, name: 'b', address: { city: 'York' } });
    await settle(ds);

    expect(sent).to.deep.equal([
      { method: 'PUT', path: '/x', body: { path: 'name', value: 'b' } },
      { method: 'PUT', path: '/x', body: { path: 'address.city', value: 'York' } },
    ]);
  });

  it('fills in the id of an entity set without one', async () => {
    const ds = withEntity();

    ds.set('organisation.y', { name: 'y' });
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'POST', path: '/', body: { name: 'y', id: 'y' } }]);
  });

  it('throws when an entity is set with a different id', () => {
    const ds = withEntity();

    expect(() => ds.set('organisation.y', { id: 'z', name: 'y' })).to.throw(/'z'.*'y'/);
    expect(ds.get('organisation.y')).to.equal(undefined);
  });

  it('sends nothing, and resolves dboComplete, for a set inside an entity that is not in the store', async () => {
    const ds = withEntity();
    const { dboComplete, outcome } = tracked();

    ds.set('organisation.missing.name', 'b', { dboComplete });
    await settle(ds);

    expect(sent).to.deep.equal([]);
    expect(outcome()).to.equal('resolved');
  });

  // As Buttress's $set does.
  it('creates the object missing on the way to a nested set, and sends the set', async () => {
    const ds = withEntity();
    ds.get('organisation').set('y', { id: 'y', name: 'y' });
    const { dboComplete, outcome } = tracked();

    expect(ds.set('organisation.y.address.city', 'York', { dboComplete })).to.equal('organisation.y.address.city');
    await settle(ds);

    expect(ds.get('organisation.y')).to.deep.equal({ id: 'y', name: 'y', address: { city: 'York' } });
    expect(sent).to.deep.equal([{ method: 'PUT', path: '/y', body: { path: 'address.city', value: 'York' } }]);
    expect(outcome()).to.equal('resolved');
  });

  it('creates every object missing on the way to a nested set', async () => {
    const ds = withEntity();

    ds.set('organisation.x.meta.source.name', 'import');
    await settle(ds);

    expect(ds.get('organisation.x.meta')).to.deep.equal({ source: { name: 'import' } });
    expect(sent).to.deep.equal([{ method: 'PUT', path: '/x', body: { path: 'meta.source.name', value: 'import' } }]);
  });

  it('notifies subscribers of a nested set that created the object on the way', async () => {
    const store = new ButtressStore();
    const ds = new ButtressDataService(
      'organisation',
      false,
      { endpoint: 'https://example.test', token: 'abc' },
      store,
      writeSchema,
    );
    store.get('organisation').set('y', { id: 'y' });
    // Past the notification of the data service setting up its collection.
    await flush();
    const notified: unknown[] = [];
    store.subscribe('organisation.*', (cr: { path: string; value: unknown }) => notified.push([cr.path, cr.value]));

    ds.set('organisation.y.address.city', 'York');
    await settle(ds);

    expect(notified).to.deep.equal([['organisation.y.address.city', 'York']]);
  });

  // Buttress can't set a property inside one either.
  it('throws for a nested set under null, and changes and sends nothing', async () => {
    const ds = withEntity();
    ds.get('organisation').set('y', { id: 'y', address: null });

    expect(() => ds.set('organisation.y.address.city', 'York')).to.throw(
      'Unable to set organisation.y.address.city: organisation.y.address is null, not an object',
    );
    await settle(ds);

    expect(ds.get('organisation.y')).to.deep.equal({ id: 'y', address: null });
    expect(sent).to.deep.equal([]);
  });

  it('throws for a nested set under a value that is not an object, and changes and sends nothing', async () => {
    const ds = withEntity();

    expect(() => ds.set('organisation.x.name.first', 'b')).to.throw(
      'Unable to set organisation.x.name.first: organisation.x.name is a string, not an object',
    );
    await settle(ds);

    expect(ds.get('organisation.x.name')).to.equal('a');
    expect(sent).to.deep.equal([]);
  });

  it('still sends and notifies other changes made alongside a set inside an entity that is not in the store', async () => {
    const store = new ButtressStore();
    const ds = new ButtressDataService(
      'organisation',
      false,
      { endpoint: 'https://example.test', token: 'abc' },
      store,
      writeSchema,
    );
    store.get('organisation').set('x', { id: 'x', name: 'a' });
    // Past the notification of the data service setting up its collection.
    await flush();
    const notified: string[] = [];
    store.subscribe('organisation.*', (cr: { path: string }) => notified.push(cr.path));

    ds.set('organisation.missing.name', 'b');
    ds.set('organisation.x.name', 'b');
    await settle(ds);

    expect(notified).to.deep.equal(['organisation.x.name']);
    expect(sent).to.deep.equal([{ method: 'PUT', path: '/x', body: { path: 'name', value: 'b' } }]);
  });

  it('sends nothing, and returns false, for a delete of an entity that is not in the store', async () => {
    const ds = withEntity();
    const { dboComplete, outcome } = tracked();

    expect(ds.delete('missing', { dboComplete })).to.equal(false);
    await settle(ds);

    expect(sent).to.deep.equal([]);
    expect(outcome()).to.equal('resolved');
  });

  it('resolves dboComplete for writes that are not sent', async () => {
    const ds = withEntity();
    const local = tracked();
    const silent = tracked();
    const created = tracked();

    ds.set('organisation.x.name', 'b', { localOnly: true, dboComplete: local.dboComplete });
    ds.set('organisation.x.address.city', 'York', { silent: true, dboComplete: silent.dboComplete });
    ds.create({ id: 'y', name: 'y' }, { localOnly: true, dboComplete: created.dboComplete });
    await settle(ds);

    expect([local.outcome(), silent.outcome(), created.outcome()]).to.deep.equal(['resolved', 'resolved', 'resolved']);
  });

  it('sends a push of several items as an update for each', async () => {
    const ds = withEntity();

    ds.push('organisation.x.tags', 'c', 'd');
    await settle(ds);

    expect(sent).to.deep.equal([
      { method: 'PUT', path: '/x', body: { path: 'tags', value: 'c' } },
      { method: 'PUT', path: '/x', body: { path: 'tags', value: 'd' } },
    ]);
  });

  it('gives every pushed object an id', async () => {
    const ds = withEntity();

    ds.push('organisation.x.contacts', { phones: [] }, { phones: [] });
    await settle(ds);

    const ids = sent.map((r) => (r.body as { value: { id: string } }).value.id);
    expect(ids).to.have.length(2);
    expect(ids[0]).to.match(/^[0-9a-f]{24}$/);
    expect(ids[1]).to.match(/^[0-9a-f]{24}$/);
    expect(ds.get('organisation.x.contacts').map((c: { id: string }) => c.id)).to.deep.equal(['c1', ...ids]);
  });

  it('sends a splice removing several items as a remove for each', async () => {
    const ds = withEntity();

    ds.splice('organisation.x.tags', 0, 2);
    await settle(ds);

    expect(sent).to.deep.equal([
      { method: 'PUT', path: '/x', body: { path: 'tags.0.__remove__', value: '' } },
      { method: 'PUT', path: '/x', body: { path: 'tags.0.__remove__', value: '' } },
    ]);
    expect(ds.get('organisation.x.tags')).to.deep.equal([]);
  });

  it('sends a splice counting from the end as a remove at the index it reached', async () => {
    const ds = withEntity();

    ds.splice('organisation.x.tags', -1, 1);
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'PUT', path: '/x', body: { path: 'tags.1.__remove__', value: '' } }]);
  });

  it('sends a splice adding at the end as an update that appends each item', async () => {
    const ds = withEntity();

    ds.splice('organisation.x.tags', 2, 0, 'c');
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'PUT', path: '/x', body: { path: 'tags', value: 'c' } }]);
  });

  it('sends the whole array for a splice that inserts before the end', async () => {
    const ds = withEntity();

    ds.splice('organisation.x.tags', 1, 0, 'm');
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'PUT', path: '/x', body: { path: 'tags', value: ['a', 'm', 'b'] } }]);
  });

  it('sends the whole array for a splice that removes and adds', async () => {
    const ds = withEntity();

    ds.splice('organisation.x.tags', 0, 1, 'z');
    await settle(ds);

    expect(sent).to.deep.equal([{ method: 'PUT', path: '/x', body: { path: 'tags', value: ['z', 'b'] } }]);
  });

  it('sends nothing for a splice that changes nothing', async () => {
    const ds = withEntity();

    ds.splice('organisation.x.tags', 1, 0);
    await settle(ds);

    expect(sent).to.deep.equal([]);
  });

  it('sends a push and then a delete of the same entity in one go', async () => {
    const ds = withEntity();

    ds.push('organisation.x.tags', 'c');
    ds.delete('x');
    await settle(ds);

    expect(sent).to.deep.equal([
      { method: 'PUT', path: '/x', body: { path: 'tags', value: 'c' } },
      { method: 'DELETE', path: '/x', body: undefined },
    ]);
  });

  it('resolves dboComplete for a push or splice once Buttress accepts it', async () => {
    const ds = withEntity();
    const pushed = tracked();
    const spliced = tracked();

    ds.pushExt('organisation.x.tags', { dboComplete: pushed.dboComplete }, 'c');
    ds.spliceExt('organisation.x.tags', 0, 1, { dboComplete: spliced.dboComplete });
    await settle(ds);

    expect([pushed.outcome(), spliced.outcome()]).to.deep.equal(['resolved', 'resolved']);
  });

  it('rejects dboComplete when Buttress rejects the write', async () => {
    const ds = withEntity();
    const { dboComplete, outcome } = tracked();
    const originalError = console.error;
    console.error = () => {};
    status = 400;

    ds.set('organisation.x.name', 'b', { dboComplete });
    await settle(ds);
    console.error = originalError;

    expect(outcome()).to.equal('rejected');
  });

  it('throws for a create with the id of an entity in the store', () => {
    const ds = withEntity();

    expect(() => ds.create({ id: 'x', name: 'b' })).to.throw('Unable to create entity with duplicate id');
  });

  it('sends nothing for a set of the whole collection', async () => {
    const ds = withEntity();

    ds.set('organisation', new Map());
    await settle(ds);

    expect(sent).to.deep.equal([]);
    expect(ds.get('organisation').size).to.equal(0);
  });

  it('sends nothing for a set of an entity in the store to null', async () => {
    const ds = withEntity();

    ds.set('organisation.x', null);
    await settle(ds);

    expect(sent).to.deep.equal([]);
  });

  it('creates the array, and sends each item, for a splice into an array that is not in the store', async () => {
    const ds = withEntity();
    ds.get('organisation').set('y', { id: 'y', contacts: [{ id: 'c1' }] });

    ds.splice('organisation.y.contacts.0.phones', 0, 0, '0113');
    await settle(ds);

    expect(ds.get('organisation.y.contacts.0.phones')).to.deep.equal(['0113']);
    expect(sent).to.deep.equal([{ method: 'PUT', path: '/y', body: { path: 'contacts.0.phones', value: '0113' } }]);
  });

  // A set sends what differs from Buttress's copy, which pushes and splices change as they change the store's.
  describe('after a push or splice', () => {
    // Buttress's copy of x is taken when it's loaded, as here from a realtime post.
    const loaded = () => {
      const ds = new ButtressDataService(
        'organisation',
        false,
        { endpoint: 'https://example.test', token: 'abc' },
        new ButtressStore(),
        writeSchema,
      );
      ds.create({ id: 'x', name: 'a', tags: ['a', 'b'] }, { localOnly: true });
      return ds;
    };

    it('still sends an item added to the array in place', async () => {
      const ds = loaded();
      const tags = ds.get('organisation.x.tags');

      tags.push('in place');
      ds.push('organisation.x.tags', 'pushed');
      ds.set('organisation.x.tags', tags);
      await settle(ds);

      expect(sent.map((r) => r.body)).to.deep.equal([
        { path: 'tags', value: 'pushed' },
        { path: 'tags', value: ['a', 'b', 'in place', 'pushed'] },
      ]);
    });

    it('does not send the array again', async () => {
      const ds = loaded();

      ds.push('organisation.x.tags', 'c');
      ds.splice('organisation.x.tags', 0, 1);
      ds.splice('organisation.x.tags', 1, 0, 'm');
      ds.splice('organisation.x.tags', 3, 0, 'z');
      await settle(ds);
      const count = sent.length;
      ds.set('organisation.x', ds.get('organisation.x'));
      await settle(ds);

      expect(ds.get('organisation.x.tags')).to.deep.equal(['b', 'm', 'c', 'z']);
      expect(sent.length).to.equal(count);
    });

    it('sends the whole array again after Buttress refused a remove from it', async () => {
      const ds = loaded();
      const originalError = console.error;
      console.error = () => {};
      status = 400;
      ds.splice('organisation.x.tags', 0, 1);
      await settle(ds);
      console.error = originalError;

      status = 200;
      ds.set('organisation.x', ds.get('organisation.x'));
      await settle(ds);

      expect(sent.map((r) => r.body)).to.deep.equal([
        { path: 'tags.0.__remove__', value: '' },
        { path: 'tags', value: ['b'] },
      ]);
    });
  });

  it('takes an entity from a collection set in place of the old one as it is', async () => {
    const ds = withEntity();

    ds.set('organisation', new Map([['x', { id: 'x', name: 'z' }]]));
    ds.set('organisation.x', { id: 'x', name: 'z' });
    await settle(ds);

    expect(sent).to.deep.equal([]);
  });

  it('throws for a push or splice into an entity that is not in the store, and sends nothing', async () => {
    const ds = withEntity();

    expect(() => ds.push('organisation.missing.tags', 'a')).to.throw(/not in the store/);
    expect(() => ds.splice('organisation.missing.tags', 0, 0, 'a')).to.throw(/not in the store/);
    await settle(ds);

    expect(sent).to.deep.equal([]);
  });

  it('passes notifyPath to the store, which reports whether the value changed', () => {
    const ds = withEntity();

    expect(ds.notifyPath('organisation.x.name', 'b')).to.equal(true);
    expect(ds.notifyPath('organisation.x.tags', ds.get('organisation.x.tags'))).to.equal(false);
  });

  it('uses the schema from updateSchema for arrays it creates', () => {
    const ds = withEntity();

    ds.updateSchema({ name: 'organisation', type: 'collection', properties: { links: { __type: 'array' } } });

    expect(ds.pushExt('organisation.x.links', { localOnly: true }, 'a')).to.equal(1);
    expect(() => ds.pushExt('organisation.x.address.lines', { localOnly: true }, 'a')).to.throw(/non-array/);
  });
});

describe('ButtressDataService getById', () => {
  let originalFetch: typeof window.fetch;
  let gets: number;
  let onGet: () => void;

  beforeEach(() => {
    originalFetch = window.fetch;
    gets = 0;
    onGet = () => {};
    window.fetch = async (input: RequestInfo | URL) => {
      gets += 1;
      onGet();
      const id = new URL(input.toString()).pathname.split('/').pop();
      return new Response(JSON.stringify({ id, name: 'from server' }));
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  const dataService = () =>
    new ButtressDataService(
      'organisation',
      false,
      { endpoint: 'https://example.test', token: 'abc' },
      new ButtressStore(),
      schema,
    );

  it('fetches an entity that is not in the store, and keeps it', async () => {
    const ds = dataService();

    expect(await ds.getById('x')).to.deep.equal({ id: 'x', name: 'from server' });
    expect(ds.get('organisation.x')).to.deep.equal({ id: 'x', name: 'from server' });
  });

  it('returns an entity already in the store without fetching it', async () => {
    const ds = dataService();
    ds.get('organisation').set('x', { id: 'x', name: 'local' });

    expect(await ds.getById('x')).to.deep.equal({ id: 'x', name: 'local' });
    expect(gets).to.equal(0);
  });

  it('keeps, and returns, the entity that reached the store while fetching', async () => {
    const ds = dataService();
    const local = { id: 'x', name: 'local' };
    onGet = () => ds.get('organisation').set('x', local);

    expect(await ds.getById('x')).to.equal(local);
    expect(ds.get('organisation.x')).to.equal(local);
  });

  it('does not bring back an entity deleted while fetching it', async () => {
    const ds = dataService();
    // It reaches the store, as from a realtime post, and is deleted, while the GET is out.
    onGet = () => {
      ds.create({ id: 'x', name: 'local' }, { localOnly: true });
      ds.delete('x', { localOnly: true });
    };

    expect(await ds.getById('x')).to.equal(undefined);
    expect(ds.get('organisation.x')).to.equal(undefined);
  });
});

describe('ButtressDataService local sort', () => {
  const b = { id: 'b', name: 'beta', size: 2, founded: '2001-01-01' };
  const none = { id: 'none' };
  const a = { id: 'a', name: 'Alpha', size: 10, founded: '1999-01-01' };

  const sorted = (entities: ButtressEntity[], sort: object) => {
    const ds = new ButtressDataService('organisation', false, {}, new ButtressStore(), schema);
    entities.forEach((entity) => ds.get('organisation').set(entity.id, entity));
    // As Buttress answered, matching every one
    const answer = { ids: entities.map((entity) => entity.id), paged: false, generation: 0, writes: 0 };
    return (ds as any).__filterLocalData({}, answer, sort).map((entity: ButtressEntity) => entity.id);
  };

  it('sorts strings without regard to case, with missing values first', () => {
    expect(sorted([b, none, a], { path: 'name', direction: 'ASC' })).to.deep.equal(['none', 'a', 'b']);
    expect(sorted([b, none, a], { path: 'name', direction: 'DESC' })).to.deep.equal(['b', 'a', 'none']);
  });

  it('sorts numbers', () => {
    expect(sorted([a, b], { path: 'size', type: 'NUMBER', direction: 'ASC' })).to.deep.equal(['b', 'a']);
    expect(sorted([b, a], { path: 'size', type: 'NUMBER', direction: 'DESC' })).to.deep.equal(['a', 'b']);
  });

  it('sorts dates, with missing values first', () => {
    expect(sorted([b, none, a], { path: 'founded', type: 'DATE', direction: 'ASC' })).to.deep.equal(['none', 'a', 'b']);
    expect(sorted([b, none, a], { path: 'founded', type: 'DATE', direction: 'DESC' })).to.deep.equal([
      'b',
      'a',
      'none',
    ]);
  });
});

// Entities arrive from Buttress as JSON, so their dates are ISO strings.
describe('ButtressDataService date operators on data from Buttress', () => {
  type Dated = { id: string; founded?: string | null };

  let originalFetch: typeof window.fetch;

  const server: Dated[] = [
    { id: 'old', founded: '2000-01-01T00:00:00.000Z' },
    { id: 'mid', founded: '2005-06-15T12:00:00.000Z' },
    { id: 'new', founded: '2010-01-01T00:00:00.000Z' },
    { id: 'none' },
    { id: 'null', founded: null },
  ];
  const operand = '2005-06-15T12:00:00.000Z';
  // As Buttress compares them: as dates, never matching a missing or null one.
  const compare: Record<string, (a: number, b: number) => boolean> = {
    $gtDate: (a, b) => a > b,
    $gteDate: (a, b) => a >= b,
    $ltDate: (a, b) => a < b,
    $lteDate: (a, b) => a <= b,
  };
  const matches = (entity: Dated, query: { founded?: Record<string, string> }) =>
    Object.entries(query.founded ?? {}).every(
      ([operator, date]) =>
        typeof entity.founded === 'string' &&
        compare[operator](new Date(entity.founded).getTime(), new Date(date).getTime()),
    );

  beforeEach(() => {
    originalFetch = window.fetch;
    Logger.disableLogging = true;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      const found = server.filter((entity) => matches(entity, body.query));
      if (new URL(input.toString()).pathname.endsWith('/count')) return new Response(JSON.stringify(found.length));
      return new Response(JSON.stringify(found.slice(body.skip, body.limit ? body.skip + body.limit : undefined)));
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
    Logger.disableLogging = false;
  });

  const dataService = () =>
    new ButtressDataService(
      'organisation',
      false,
      { endpoint: 'https://example.test', token: 'abc' },
      new ButtressStore(),
      schema,
    );
  const ids = (results: ButtressEntity[]) => results.map((r) => r.id);

  const expected: Record<string, string[]> = {
    $gtDate: ['new'],
    $gteDate: ['mid', 'new'],
    $ltDate: ['old'],
    $lteDate: ['old', 'mid'],
  };

  for (const [operator, matching] of Object.entries(expected)) {
    it(`matches ${operator}`, async () => {
      const { results, total } = await dataService().query({ founded: { [operator]: operand } });

      expect(ids(results)).to.deep.equal(matching);
      expect(total).to.equal(matching.length);
    });

    it(`matches ${operator} for a page`, async () => {
      const { results } = await dataService().query({ founded: { [operator]: operand } }, { limit: 10 });

      expect(ids(results)).to.deep.equal(matching);
    });

    it(`skips entities without the date, or with a null one, for ${operator}`, async () => {
      const ds = dataService();
      await ds.query({});

      const { results } = await ds.query({ founded: { [operator]: operand } });

      expect(ids(results)).to.deep.equal(matching);
    });
  }

  it('matches a range', async () => {
    const { results } = await dataService().query({
      founded: { $gteDate: '2000-01-01T00:00:00.000Z', $ltDate: '2010-01-01T00:00:00.000Z' },
    });

    expect(ids(results)).to.deep.equal(['old', 'mid']);
  });
});

describe('ButtressDataService query operators', () => {
  const datedSchema: ButtressSchema = {
    name: 'organisation',
    type: 'collection',
    properties: { name: { __type: 'string' }, founded: { __type: 'date' } },
  };
  const ds = new ButtressDataService('organisation', false, {}, new ButtressStore(), datedSchema);
  const data = [
    { id: 'a', name: 'Alpha', tags: ['x', 'y'], founded: new Date('2000-01-01'), links: [new Map([['kind', 'web']])] },
    { id: 'b', name: 'Beta', tags: ['y'], founded: new Date('2010-01-01'), links: [] },
    { id: 'c', name: 'Gamma', tags: [], founded: null, links: [] },
  ];
  const ids = (query: object) => ds._processQueryPart(query, data).map((o: ButtressEntity) => o.id);

  it('matches every part of an $and', () => {
    expect(ids({ $and: [{ tags: { $eq: 'y' } }, { name: { $eq: 'Beta' } }] })).to.deep.equal(['b']);
  });

  it('matches any part of an $or, once each, in the order given', () => {
    expect(
      ids({ $or: [{ name: { $eq: 'Gamma' } }, { tags: { $eq: 'y' } }, { name: { $eq: 'Alpha' } }] }),
    ).to.deep.equal(['a', 'b', 'c']);
  });

  it('matches $inProp against an array property', () => {
    expect(ids({ tags: { $inProp: 'x' } })).to.deep.equal(['a']);
  });

  it('matches dates with $gteDate and $lteDate, including the date itself', () => {
    expect(ids({ founded: { $gteDate: '2010-01-01' } })).to.deep.equal(['b']);
    expect(ids({ founded: { $lteDate: '2000-01-01' } })).to.deep.equal(['a']);
    expect(ids({ founded: { $gteDate: '2000-01-01', $lteDate: '2010-01-01' } })).to.deep.equal(['a', 'b']);
  });

  // As MongoDB compares null: only $gte and $lte match it, and then only a null or missing date.
  it('matches only a null date for $gteDate or $lteDate with a null operand', () => {
    for (const operator of ['$gtDate', '$ltDate']) {
      expect(ids({ founded: { [operator]: null } }), operator).to.deep.equal([]);
    }
    for (const operator of ['$gteDate', '$lteDate']) {
      expect(ids({ founded: { [operator]: null } }), operator).to.deep.equal(['c']);
    }
  });

  it('looks up a path through a Map in an array', () => {
    expect(ids({ 'links.kind': { $eq: 'web' } })).to.deep.equal(['a']);
  });

  it('finds nothing on a path through a string', () => {
    expect(ids({ 'name.first': { $exists: true } })).to.deep.equal([]);
  });

  it('logs an unknown operator and matches nothing', () => {
    const originalError = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => logged.push(args);

    const matched = ids({ name: { $like: 'A' } });
    console.error = originalError;

    expect(matched).to.deep.equal([]);
    expect(logged).to.have.length(1);
  });
});

// A path into an array matches if any value it reaches does. Each path to an identifier here passes through two
// arrays: the signatories, and the identifiers of each signatory's person.
describe('ButtressDataService query operators on nested arrays', () => {
  const nestedSchema: ButtressSchema = {
    name: 'organisation',
    type: 'collection',
    properties: {
      threshold: { __type: 'number' },
      signatories: {
        __type: 'array',
        __schema: {
          person: {
            // @ts-expect-error ButtressSchemaProperty can't type a plain nested object, though the store handles one.
            identifiers: {
              __type: 'array',
              __schema: { name: { __type: 'string' }, age: { __type: 'number' }, hired_at: { __type: 'date' } },
            },
          },
        },
      },
    },
  };
  const ds = new ButtressDataService('organisation', false, {}, new ButtressStore(), nestedSchema);
  const identifier = (name: string, age: number, hired: string) => ({ name, age, hired_at: new Date(hired) });
  const data = [
    {
      id: 'first',
      threshold: 1,
      signatories: [
        { person: { identifiers: [identifier('John', 30, '2010-01-10'), identifier('Mary', 20, '2020-07-04')] } },
      ],
    },
    {
      id: 'second',
      threshold: 2,
      signatories: [
        { person: { identifiers: [identifier('Henry', 50, '2023-10-31')] } },
        { person: { identifiers: [identifier('James', 60, '2009-03-14')] } },
      ],
    },
    {
      id: 'third',
      threshold: 1,
      signatories: [
        { person: { identifiers: [{ ...identifier('Anna', 40, '2015-06-01'), email: 'anna@example.com' }] } },
      ],
    },
  ];
  const identifiers = 'signatories.person.identifiers';
  const name = `${identifiers}.name`;
  const age = `${identifiers}.age`;
  const hiredAt = `${identifiers}.hired_at`;
  const ids = (query: object) => ds._processQueryPart(query, data).map((o: ButtressEntity) => o.id);

  it('matches $eq against a value outside the arrays', () => {
    expect(ids({ threshold: { $eq: 1 } })).to.deep.equal(['first', 'third']);
  });

  it('matches $eq against any value in the arrays', () => {
    expect(ids({ [name]: { $eq: 'James' } })).to.deep.equal(['second']);
  });

  // As MongoDB's $ne, so an entity with John and Mary doesn't match $not John.
  it('matches $not when no value equals the operand', () => {
    expect(ids({ threshold: { $not: 1 } })).to.deep.equal(['second']);
    expect(ids({ [name]: { $not: 'Anna' } })).to.deep.equal(['first', 'second']);
    expect(ids({ [name]: { $not: 'John' } })).to.deep.equal(['second', 'third']);
  });

  it('matches $gt and $lt against any value in the arrays', () => {
    expect(ids({ [age]: { $gt: 45 } })).to.deep.equal(['second']);
    expect(ids({ [age]: { $lt: 25 } })).to.deep.equal(['first']);
    expect(ids({ [age]: { $gt: 100 } })).to.deep.equal([]);
  });

  it('matches $gte and $lte against any value in the arrays, including the value itself', () => {
    expect(ids({ [age]: { $gte: 40 } })).to.deep.equal(['second', 'third']);
    expect(ids({ [age]: { $lte: 20 } })).to.deep.equal(['first']);
  });

  it('matches $rex with regard to case, and $rexi without', () => {
    expect(ids({ [name]: { $rex: 'ry' } })).to.deep.equal(['first', 'second']);
    expect(ids({ [name]: { $rex: '^j' } })).to.deep.equal([]);
    expect(ids({ [name]: { $rexi: '^j' } })).to.deep.equal(['first', 'second']);
  });

  it('matches $in when any value is in the list', () => {
    expect(ids({ [name]: { $in: ['Mary', 'Anna'] } })).to.deep.equal(['first', 'third']);
  });

  it('matches $nin only when no value is in the list', () => {
    expect(ids({ [name]: { $nin: ['Mary', 'James'] } })).to.deep.equal(['third']);
    expect(ids({ [name]: { $nin: ['Zoe'] } })).to.deep.equal(['first', 'second', 'third']);
  });

  it('matches $exists when any item in the arrays has the property', () => {
    expect(ids({ [`${identifiers}.email`]: { $exists: true } })).to.deep.equal(['third']);
    expect(ids({ [`${identifiers}.email`]: { $exists: false } })).to.deep.equal(['first', 'second']);
  });

  it('matches $elMatch only when a single item meets every condition', () => {
    expect(ids({ [identifiers]: { $elMatch: { name: { $eq: 'John' }, age: { $lt: 40 } } } })).to.deep.equal(['first']);
    // Mary is under 25, but she isn't John.
    expect(ids({ [identifiers]: { $elMatch: { name: { $eq: 'John' }, age: { $lt: 25 } } } })).to.deep.equal([]);
  });

  it('matches $gtDate and $ltDate against any date in the arrays', () => {
    expect(ids({ [hiredAt]: { $gtDate: '2022-01-01T00:00:00.000Z' } })).to.deep.equal(['second']);
    expect(ids({ [hiredAt]: { $ltDate: '2012-01-01T00:00:00.000Z' } })).to.deep.equal(['first', 'second']);
  });
});

// The rules Buttress matches a query by, which are MongoDB's, so the results crag chooses locally are the ones Buttress
// would give. The schema types the operands: Buttress reads them as their properties' types before comparing.
describe('ButtressDataService queries as MongoDB reads them', () => {
  const typed: ButtressSchema = {
    name: 'organisation',
    type: 'collection',
    properties: {
      status: { __type: 'string' },
      count: { __type: 'number' },
      active: { __type: 'boolean' },
      founded: { __type: 'date' },
      tags: { __type: 'array', __itemtype: 'string' },
      scores: { __type: 'array', __itemtype: 'number' },
      // @ts-expect-error ButtressSchemaProperty can't type a plain nested object, though the store handles one.
      address: { city: { __type: 'string' }, postcode: { __type: 'string' } },
      items: { __type: 'array', __schema: { sku: { __type: 'string' }, qty: { __type: 'number' } } },
    },
  };
  const ds = new ButtressDataService('organisation', false, {}, new ButtressStore(), typed);
  // Dates as they arrive from Buttress, as ISO strings. `c` hasn't got status, active, founded or address.
  const data = [
    {
      id: 'a',
      status: 'active',
      count: 5,
      active: true,
      founded: '2020-01-01T00:00:00.000Z',
      tags: ['x', 'y'],
      scores: [1, 7],
      address: { city: 'Leeds', postcode: 'LS1' },
      items: [
        { sku: 'p', qty: 0 },
        { sku: '', qty: 2 },
      ],
      label: '10',
    },
    {
      id: 'b',
      status: 'closed',
      count: 0,
      active: false,
      founded: '2010-06-01T00:00:00.000Z',
      tags: ['y'],
      scores: [2],
      address: { city: 'York' },
      items: [{ sku: 'p', qty: 3 }],
      label: 'b',
    },
    { id: 'c', count: null, tags: [], scores: [], items: [] },
  ];
  const ids = (query: object) => ds._processQueryPart(query, data).map((o: ButtressEntity) => o.id);

  describe('operators', () => {
    it('matches $ne when no value equals the operand, a missing one included', () => {
      expect(ids({ status: { $ne: 'active' } })).to.deep.equal(['b', 'c']);
      expect(ids({ tags: { $ne: 'x' } })).to.deep.equal(['b', 'c']);
      expect(ids({ status: { $nin: ['active'] } })).to.deep.equal(['b', 'c']);
    });

    // So a list holding x and y doesn't match $not x, though y differs from it.
    it('matches $not as $ne', () => {
      expect(ids({ tags: { $not: 'x' } })).to.deep.equal(['b', 'c']);
      expect(ids({ status: { $not: 'active' } })).to.deep.equal(['b', 'c']);
    });

    it('matches $all when every operand is a value, and nothing for an empty list', () => {
      expect(ids({ tags: { $all: ['y', 'x'] } })).to.deep.equal(['a']);
      expect(ids({ tags: { $all: ['y'] } })).to.deep.equal(['a', 'b']);
      expect(ids({ tags: { $all: [] } })).to.deep.equal([]);
    });

    it('matches $regex as $rex does', () => {
      expect(ids({ status: { $regex: '^act' } })).to.deep.equal(['a']);
    });

    it('matches $elemMatch as $elMatch does', () => {
      expect(ids({ items: { $elemMatch: { sku: 'p', qty: { $gt: 1 } } } })).to.deep.equal(['b']);
    });

    it('matches $nor when no part matches', () => {
      expect(ids({ $nor: [{ status: { $eq: 'active' } }, { count: { $eq: 0 } }] })).to.deep.equal(['c']);
    });

    it('takes the @ names of operators', () => {
      expect(ids({ '@or': [{ status: { '@eq': 'closed' } }, { count: { '@gt': 4 } }] })).to.deep.equal(['a', 'b']);
      expect(ids({ '@and': [{ tags: { '@in': ['y'] } }, { count: { '@lte': 0 } }] })).to.deep.equal(['b']);
      expect(ids({ '@nor': [{ tags: { '@all': ['y'] } }] })).to.deep.equal(['c']);
      expect(ids({ scores: { '@elMatch': { '@gt': 5 } } })).to.deep.equal(['a']);
    });

    it('keeps the order it was given for an $or', () => {
      expect(ids({ $or: [{ status: { $eq: 'closed' } }, { status: { $eq: 'active' } }] })).to.deep.equal(['a', 'b']);
    });

    it('passes over a logical operator with an empty list, as Buttress does', () => {
      expect(ids({ $or: [] })).to.deep.equal(['a', 'b', 'c']);
    });
  });

  describe('values', () => {
    it('compares a bare value as $eq', () => {
      expect(ids({ status: 'active' })).to.deep.equal(['a']);
    });

    it('compares an object given as a value whole', () => {
      expect(ids({ address: { city: 'Leeds', postcode: 'LS1' } })).to.deep.equal(['a']);
      expect(ids({ address: { city: 'Leeds' } })).to.deep.equal([]);
    });

    it('compares a list given as a value whole, in order', () => {
      expect(ids({ tags: ['x', 'y'] })).to.deep.equal(['a']);
      expect(ids({ tags: ['y'] })).to.deep.equal(['b']);
      expect(ids({ tags: ['y', 'x'] })).to.deep.equal([]);
      expect(ids({ tags: { $eq: [] } })).to.deep.equal(['c']);
    });

    it("reads an $elMatch of operators as tests of a list's values", () => {
      expect(ids({ scores: { $elMatch: { $gt: 5 } } })).to.deep.equal(['a']);
      expect(ids({ scores: { $elMatch: { $gt: 1, $lt: 3 } } })).to.deep.equal(['b']);
    });

    it('reads a missing field as null', () => {
      expect(ids({ status: { $eq: null } })).to.deep.equal(['c']);
      expect(ids({ status: null })).to.deep.equal(['c']);
      expect(ids({ count: null })).to.deep.equal(['c']);
      expect(ids({ status: { $ne: null } })).to.deep.equal(['a', 'b']);
    });

    it('finds 0 and an empty string through arrays', () => {
      expect(ids({ 'items.qty': { $eq: 0 } })).to.deep.equal(['a']);
      expect(ids({ 'items.qty': { $lt: 1 } })).to.deep.equal(['a']);
      expect(ids({ 'items.sku': { $eq: '' } })).to.deep.equal(['a']);
      expect(ids({ 'items.qty': 0 })).to.deep.equal(['a']);
    });
  });

  describe('types', () => {
    it('compares values of one type only', () => {
      expect(ids({ label: { $gt: 5 } })).to.deep.equal([]);
      expect(ids({ label: { $gt: '1' } })).to.deep.equal(['a', 'b']);
      expect(ids({ count: { $gte: null } })).to.deep.equal(['c']);
      expect(ids({ count: { $lt: null } })).to.deep.equal([]);
    });

    it("reads an operand as its property's type", () => {
      expect(ids({ count: { $eq: '5' } })).to.deep.equal(['a']);
      expect(ids({ count: { $in: ['0', '5'] } })).to.deep.equal(['a', 'b']);
      expect(ids({ active: 'false' })).to.deep.equal(['b']);
      expect(ids({ scores: { $elMatch: { $gt: '5' } } })).to.deep.equal(['a']);
      expect(ids({ 'items.qty': { $gt: '2' } })).to.deep.equal(['b']);
    });

    it('compares dates as dates, for a property the schema types as one', () => {
      expect(ids({ founded: { $eq: '2020-01-01' } })).to.deep.equal(['a']);
      expect(ids({ founded: '2010-06-01' })).to.deep.equal(['b']);
      expect(ids({ founded: { $gt: '2015-01-01' } })).to.deep.equal(['a']);
    });
  });
});
