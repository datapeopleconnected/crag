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
    window.fetch = (input: RequestInfo | URL) => {
      requests.push(input.toString());
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

    expect((ds as any).__awaitIdleQueue.length).to.equal(0);
  });
});

describe('ButtressDataService query', () => {
  type Org = { id: string; name: string; status: string };

  let originalFetch: typeof window.fetch;
  let server: Org[];
  let searches: number;
  let holdSearches: Promise<void> | undefined;

  // Pretends to be Buttress: answers searches (with $eq, sort, skip and limit) and counts from `server`.
  const matches = (org: Org, query: Record<string, { $eq: string }>) =>
    Object.entries(query).every(([field, { $eq }]) => (org as any)[field] === $eq);

  beforeEach(() => {
    originalFetch = window.fetch;
    Logger.disableLogging = true;
    searches = 0;
    holdSearches = undefined;
    server = Array.from({ length: 25 }, (_, i) => ({
      id: `id${String(i + 1).padStart(2, '0')}`,
      name: `A${String(i + 1).padStart(2, '0')}`,
      status: 'active',
    }));
    server.push({ id: 'idx', name: 'Inactive', status: 'inactive' });

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      if (init?.method === 'SEARCH' && url.pathname.endsWith('/organisation/count')) {
        return new Response(JSON.stringify(server.filter((o) => matches(o, body.query)).length));
      }
      if (init?.method === 'POST' && url.pathname.endsWith('/organisation/')) {
        server.push(body);
        return new Response(JSON.stringify(body));
      }
      if (init?.method === 'SEARCH') {
        searches += 1;
        await holdSearches;
        let found = server.filter((o) => matches(o, body.query));
        if (body.sort?.name) found = found.sort((a, b) => (a.name < b.name ? -body.sort.name : body.sort.name));
        found = found.slice(body.skip, body.limit ? body.skip + body.limit : undefined);
        return new Response(JSON.stringify(found));
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
});
