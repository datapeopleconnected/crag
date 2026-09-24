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
      sent.push({
        method: init!.method!,
        path: new URL(input.toString()).pathname.replace('/api/v1/organisation', ''),
        body,
      });
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

  it('sends a set of an entity already in the store as updates to the properties that changed', async () => {
    const ds = withEntity();
    const entity = ds.get('organisation.x');

    ds.set('organisation.x', { ...entity, name: 'b', address: { city: 'York' } });
    await settle(ds);

    expect(sent).to.deep.equal([
      { method: 'PUT', path: '/x', body: { path: 'name', value: 'b' } },
      { method: 'PUT', path: '/x', body: { path: 'address', value: { city: 'York' } } },
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

  it('sends nothing, and resolves dboComplete, for a set inside an object that is not in the store', async () => {
    const ds = withEntity();
    const { dboComplete, outcome } = tracked();

    ds.set('organisation.missing.name', 'b', { dboComplete });
    await settle(ds);

    expect(sent).to.deep.equal([]);
    expect(outcome()).to.equal('resolved');
  });

  it('still sends and notifies other changes made alongside a set inside an object that is not in the store', async () => {
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
});
