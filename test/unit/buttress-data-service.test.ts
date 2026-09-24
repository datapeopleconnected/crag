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
import ButtressStore from '../../src/ButtressStore.js';
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
