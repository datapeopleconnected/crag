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
