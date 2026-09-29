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

import ButtressStore, { ButtressEntity } from '../../src/ButtressStore.js';
import ButtressSchema from '../../src/ButtressSchema.js';

const schema: ButtressSchema = {
  name: 'organisation',
  type: 'collection',
  properties: {
    name: { __type: 'string' },
    tags: { __type: 'array' },
    // @ts-expect-error ButtressSchemaProperty can't type a plain nested object, though getProperty handles one.
    address: { lines: { __type: 'array' } },
    contacts: { __type: 'array', __schema: { phones: { __type: 'array' } } },
  },
};

// Sets up the store the way ButtressDataService does.
const storeWith = (entity: ButtressEntity) => {
  const store = new ButtressStore();
  store.set('organisation', new Map());
  store.create('organisation', entity);
  return store;
};

describe('ButtressStore.pushExt', () => {
  it('creates a missing array whose parent is in the store', () => {
    const store = storeWith({ id: 'org1', address: {} });

    expect(store.pushExt('organisation.org1.address.lines', schema, undefined, 'x')).to.equal(1);
    expect(store.get('organisation.org1.address.lines')).to.deep.equal(['x']);
  });

  it('throws naming the path when the parent object is not in the store', () => {
    const store = storeWith({ id: 'org1' });

    expect(() => store.pushExt('organisation.org1.address.lines', schema, undefined, 'x')).to.throw(
      'Unable to call push on organisation.org1.address.lines: organisation.org1.address is not in the store',
    );
  });

  it('throws naming the path when the parent array item is not in the store', () => {
    const store = storeWith({ id: 'org1', contacts: [] });

    expect(() => store.pushExt('organisation.org1.contacts.5.phones', schema, undefined, 'x')).to.throw(
      'Unable to call push on organisation.org1.contacts.5.phones: organisation.org1.contacts.5 is not in the store',
    );
  });
});

describe('ButtressStore.spliceExt', () => {
  it('creates a missing array whose parent is in the store', () => {
    const store = storeWith({ id: 'org1', address: {} });

    expect(store.spliceExt('organisation.org1.address.lines', schema, 0, 0, undefined, 'x')).to.deep.equal([]);
    expect(store.get('organisation.org1.address.lines')).to.deep.equal(['x']);
  });

  it('throws naming the path when the parent object is not in the store', () => {
    const store = storeWith({ id: 'org1' });

    expect(() => store.spliceExt('organisation.org1.address.lines', schema, 0, 0, undefined, 'x')).to.throw(
      'Unable to call splice on organisation.org1.address.lines: organisation.org1.address is not in the store',
    );
  });

  it('throws naming the path when the parent array item is not in the store', () => {
    const store = storeWith({ id: 'org1', contacts: [] });

    expect(() => store.spliceExt('organisation.org1.contacts.5.phones', schema, 0, 0, undefined, 'x')).to.throw(
      'Unable to call splice on organisation.org1.contacts.5.phones: organisation.org1.contacts.5 is not in the store',
    );
  });

  it('says splice, not push, when the property is not an array', () => {
    const store = storeWith({ id: 'org1' });

    expect(() => store.spliceExt('organisation.org1.name', schema, 0, 0, undefined, 'x')).to.throw(
      'Unable to call splice on non-array property type: string',
    );
  });
});

describe('ButtressStore.splice', () => {
  it('removes everything from start when deleteCount is omitted', () => {
    const store = storeWith({ id: 'org1', tags: ['a', 'b', 'c'] });

    expect(store.splice('organisation.org1.tags', schema, 1)).to.deep.equal(['b', 'c']);
    expect(store.get('organisation.org1.tags')).to.deep.equal(['a']);
  });

  // ButtressDbService.splice(path, start) reaches the store like this: it passes deleteCount on even when omitted.
  it('removes everything from start when deleteCount is undefined', () => {
    const store = storeWith({ id: 'org1', tags: ['a', 'b', 'c'] });

    expect(store.splice('organisation.org1.tags', schema, 1, undefined)).to.deep.equal(['b', 'c']);
    expect(store.get('organisation.org1.tags')).to.deep.equal(['a']);
  });

  it('inserts without deleting when deleteCount is 0', () => {
    const store = storeWith({ id: 'org1', tags: ['a', 'b', 'c'] });

    expect(store.splice('organisation.org1.tags', schema, 1, 0, 'x')).to.deep.equal([]);
    expect(store.get('organisation.org1.tags')).to.deep.equal(['a', 'x', 'b', 'c']);
  });

  // Like ['a', 'b', 'c'].splice(1, undefined, 'x'), which counts the undefined deleteCount as 0.
  it('inserts without deleting when deleteCount is undefined and there are items', () => {
    const store = storeWith({ id: 'org1', tags: ['a', 'b', 'c'] });

    expect(store.splice('organisation.org1.tags', schema, 1, undefined, 'x')).to.deep.equal([]);
    expect(store.get('organisation.org1.tags')).to.deep.equal(['a', 'x', 'b', 'c']);
  });
});

describe('ButtressStore forceChanged', () => {
  it('notifies subscribers without changing the options passed in', async () => {
    const store = storeWith({ id: 'org1', name: 'a' });
    const notified: unknown[] = [];
    await Promise.resolve();
    store.subscribe('organisation.*', (cr: { opts: unknown }) => notified.push(cr.opts));
    const opts = { forceChanged: true };

    store.set('organisation.org1.name', 'a', opts);
    await Promise.resolve();

    expect(opts).to.deep.equal({ forceChanged: true });
    expect(notified).to.deep.equal([{ forceChanged: true }]);
  });
});

describe('ButtressStore writes', () => {
  it('throws for a create without an id', () => {
    const store = storeWith({ id: 'org1' });

    expect(() => store.create('organisation', { id: '' })).to.throw('Unable to create object without providing an ID');
  });

  it('throws for a delete of a path without an id', () => {
    const store = storeWith({ id: 'org1' });

    expect(() => store.delete('organisation.')).to.throw('Unable to remove property');
  });

  it('deletes a property of an object', () => {
    const store = storeWith({ id: 'org1', name: 'a' });

    expect(store.delete('organisation.org1.name')).to.equal(true);
    expect(store.get('organisation.org1')).to.deep.equal({ id: 'org1' });
  });

  it('returns false for a delete of an entity that is not in the store', () => {
    const store = storeWith({ id: 'org1' });

    expect(store.delete('organisation.missing')).to.equal(false);
  });

  it('resolves dboComplete for a set that changes nothing', () => {
    const store = storeWith({ id: 'org1', name: 'a' });
    let resolved = false;

    store.set('organisation.org1.name', 'a', {
      dboComplete: {
        resolve: () => {
          resolved = true;
        },
        reject: () => {},
      },
    });

    expect(resolved).to.equal(true);
  });

  it('pushes without options', () => {
    const store = storeWith({ id: 'org1', tags: ['a'] });

    expect(store.push('organisation.org1.tags', schema, 'b', 'c')).to.equal(3);
    expect(store.get('organisation.org1.tags')).to.deep.equal(['a', 'b', 'c']);
  });

  it('counts a negative splice start from the end', () => {
    const store = storeWith({ id: 'org1', tags: ['a', 'b', 'c'] });

    expect(store.splice('organisation.org1.tags', schema, -2, 1)).to.deep.equal(['b']);
    expect(store.get('organisation.org1.tags')).to.deep.equal(['a', 'c']);
  });

  it('reports no change from notifyPath with only a path', () => {
    const store = storeWith({ id: 'org1', name: 'a' });

    expect(store.notifyPath('organisation.org1.name')).to.equal(false);
  });
});

describe('ButtressStore subscriptions', () => {
  // A store with org1 in it, past the notification of setting it up.
  const subscribed = async (paths: string, entity: ButtressEntity = { id: 'org1', name: 'a', tags: ['a'] }) => {
    const store = storeWith(entity);
    await Promise.resolve();
    const calls: unknown[][] = [];
    const id = store.subscribe(paths, (...args: unknown[]) => calls.push(args));
    return { store, calls, id };
  };

  it('calls a subscriber to a whole collection', async () => {
    const { store, calls } = await subscribed('organisation');

    store.set('organisation', new Map());
    await Promise.resolve();

    expect(calls).to.have.length(1);
  });

  it('calls a wildcard subscriber once for each splice of an array', async () => {
    const { store, calls } = await subscribed('organisation.*');

    store.push('organisation.org1.tags', schema, 'b');
    store.push('organisation.org1.tags', schema, 'c');
    await Promise.resolve();

    const paths = calls.map(([cr]) => (cr as { path: string }).path);
    expect(paths).to.deep.equal(['organisation.org1.tags.splices', 'organisation.org1.tags.splices']);
  });

  it('notifies each change of a path once, with its latest value', async () => {
    const { store, calls } = await subscribed('organisation.org1.name');

    store.set('organisation.org1.name', 'b');
    store.set('organisation.org1.name', 'c');
    await Promise.resolve();

    expect(calls.map(([cr]) => (cr as { value: unknown }).value)).to.deep.equal(['c']);
  });

  it('notifies both forced and ordinary changes made together', async () => {
    const { store, calls } = await subscribed('organisation.*');

    store.set('organisation.org1.name', 'a', { forceChanged: true });
    store.set('organisation.org1.tags', ['a'], { forceChanged: true });
    store.set('organisation.org1.status', 'new');
    await Promise.resolve();

    expect(calls.map(([cr]) => (cr as { path: string }).path)).to.deep.equal([
      'organisation.org1.name',
      'organisation.org1.tags',
      'organisation.org1.status',
    ]);
  });

  it('passes the value of every path subscribed to together, whichever changed', async () => {
    const { store, calls } = await subscribed('organisation.org1.name, organisation.*, organisation');

    store.set('organisation.org1.name', 'b');
    await Promise.resolve();

    // Called for the first two paths, which both match, but not the third.
    expect(calls).to.have.length(2);
    const [name, wildcard, collection] = calls[0] as { path?: string; value: unknown; base?: unknown }[];
    expect(name.value).to.equal('b');
    expect(wildcard.path).to.equal('organisation.org1.name');
    expect(wildcard.base).to.equal(store.get('organisation'));
    expect(collection.value).to.equal(store.get('organisation'));
  });

  it('passes a wildcard path that did not change as its current value', async () => {
    const { store, calls } = await subscribed('organisation.org1.name, organisation.org1.tags.*');

    store.set('organisation.org1.name', 'b');
    await Promise.resolve();

    const [, tags] = calls[0] as { path: string; value: unknown; base: unknown }[];
    expect(tags).to.include({ path: 'organisation.org1.tags', value: store.get('organisation.org1.tags') });
    expect(tags.base).to.equal(tags.value);
  });

  it('passes the value it was notified with for a path that is no longer in the store', async () => {
    const { store, calls } = await subscribed('organisation.org1.name, organisation.*');

    store.notifyPath('organisation.org1.name', 'b');
    store.delete('organisation.org1');
    await Promise.resolve();

    const [name, wildcard] = calls[0] as { value: unknown }[];
    expect(name.value).to.equal('b');
    expect(wildcard.value).to.equal('b');
  });

  it('passes literal arguments as they are written', async () => {
    const { store, calls } = await subscribed(`organisation.org1.name, 'text', "quoted", 42, -1.5`);

    store.set('organisation.org1.name', 'b');
    await Promise.resolve();

    expect(calls[0].slice(1)).to.deep.equal(['text', 'quoted', 42, -1.5]);
  });

  it('stops calling a subscriber once it unsubscribes', async () => {
    const { store, calls, id } = await subscribed('organisation.org1.name');

    expect(store.unsubscribe(id)).to.equal(true);
    store.set('organisation.org1.name', 'b');
    await Promise.resolve();

    expect(calls).to.deep.equal([]);
    expect(store.unsubscribe(id)).to.equal(false);
  });
});
