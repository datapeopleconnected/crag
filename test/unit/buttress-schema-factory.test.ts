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

import { ButtressSchema, ButtressSchemaHelpers } from '../../src/ButtressSchema.js';
import { ButtressSchemaFactory } from '../../src/ButtressSchemaFactory.js';
import type { ButtressSchemaProperty } from '../../src/types/ButtressSchemaProperty.js';

const tags = { __type: 'array' };
const contacts = { __type: 'array', __schema: { email: { __type: 'string' } } };
// A nested object is a plain object of properties with no __type, which ButtressSchemaProperty doesn't describe.
const address = { street: { __type: 'string' }, city: { __type: 'string' } } as unknown as ButtressSchemaProperty;

const schema: ButtressSchema = {
  name: 'organisation',
  type: 'collection',
  properties: { name: { __type: 'string' }, meta: { __type: 'object' }, tags, contacts, address },
};

describe('ButtressSchemaHelpers.getSubSchema', () => {
  it('returns null for a property with a __type but no __schema', () => {
    expect(ButtressSchemaHelpers.getSubSchema(schema, 'name')).to.equal(null);
    expect(ButtressSchemaHelpers.getSubSchema(schema, 'meta')).to.equal(null);
    expect(ButtressSchemaHelpers.getSubSchema(schema, 'tags')).to.equal(null);
  });

  it('returns the __schema of an array of objects', () => {
    expect(ButtressSchemaHelpers.getSubSchema(schema, 'contacts')?.properties).to.equal(contacts.__schema);
  });

  it('returns the properties of a nested object', () => {
    expect(ButtressSchemaHelpers.getSubSchema(schema, 'address')?.properties).to.equal(address);
  });
});

describe('ButtressSchemaFactory.create', () => {
  // If getSubSchema let one of these through, inflate would treat its definition (`{ __type: 'string' }`)
  // as a set of properties and overflow the stack walking the characters of 'string'.
  it('throws a clear error for a property with a __type but no __schema', () => {
    const paths = [
      'organisation.name',
      'organisation.meta',
      'organisation.tags',
      'organisation.address.street',
      'organisation.contacts.0.email',
    ];
    paths.forEach((path) => {
      expect(() => ButtressSchemaFactory.create(schema, path)).to.throw(`Unable to find schema at path ${path}`);
    });
  });

  it('builds an item of an array of objects', () => {
    expect(ButtressSchemaFactory.create(schema, 'organisation.contacts')).to.deep.equal({ email: '' });
  });

  it('builds a nested object', () => {
    expect(ButtressSchemaFactory.create(schema, 'organisation.address')).to.deep.equal({ street: '', city: '' });
  });

  // Buttress's core apps schema has top-level properties named __schema and __roles, so getFlattened mustn't
  // skip __ keys at the top level the way it does inside a property, where they're the property's settings.
  it('keeps top-level properties whose names start with __', () => {
    const apps: ButtressSchema = {
      name: 'apps',
      type: 'collection',
      properties: { __schema: { __type: 'string', __default: '[]' }, __roles: { __type: 'array' } },
    };
    const app = ButtressSchemaFactory.create(apps, 'apps');
    expect(app.__schema).to.equal('[]');
    expect(app.__roles).to.deep.equal([]);
  });
});

// An ObjectId is a 4-byte timestamp, a 5-byte random value and a 3-byte counter, written as 24 hex characters.
describe('ButtressSchemaFactory.getObjectId', () => {
  it('returns 24 lower-case hex characters', () => {
    expect(ButtressSchemaFactory.getObjectId()).to.match(/^[0-9a-f]{24}$/);
  });

  it('starts with the current time in seconds', () => {
    const seconds = Math.floor(Date.now() / 1000);
    const timestamp = parseInt(ButtressSchemaFactory.getObjectId().slice(0, 8), 16);
    expect(timestamp).to.be.within(seconds, seconds + 1);
  });

  it('keeps the random value and steps the counter by one from each id to the next', () => {
    const first = ButtressSchemaFactory.getObjectId();
    const second = ButtressSchemaFactory.getObjectId();
    expect(second.slice(8, 18)).to.equal(first.slice(8, 18));
    expect(parseInt(second.slice(18), 16)).to.equal((parseInt(first.slice(18), 16) + 1) % 0x1000000);
  });

  it('returns a different id each time', () => {
    const ids = new Set(Array.from({ length: 10000 }, () => ButtressSchemaFactory.getObjectId()));
    expect(ids.size).to.equal(10000);
  });

  it("is the default for an id property set to 'new'", () => {
    expect(ButtressSchemaFactory.getPropDefault({ __type: 'id', __default: 'new' })).to.match(/^[0-9a-f]{24}$/);
  });
});
