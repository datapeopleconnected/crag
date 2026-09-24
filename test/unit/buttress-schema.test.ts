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

import ButtressStore from '../../src/ButtressStore.js';
import { ButtressSchema, ButtressSchemaHelpers } from '../../src/ButtressSchema.js';

// Each property is a separate object so the tests can check getProperty returns that exact one.
const email = { __type: 'string' };
const phoneNumber = { __type: 'string' };
const phones = { __type: 'array', __schema: { number: phoneNumber } };
const contacts = { __type: 'array', __schema: { email, phones } };

const schema: ButtressSchema = {
  name: 'organisation',
  type: 'collection',
  properties: {
    name: { __type: 'string' },
    contacts,
  },
};

describe('ButtressSchemaHelpers.getProperty', () => {
  it('returns a top-level property', () => {
    expect(ButtressSchemaHelpers.getProperty(schema, 'name')).to.equal(schema.properties.name);
    expect(ButtressSchemaHelpers.getProperty(schema, 'contacts')).to.equal(contacts);
  });

  it('returns a property from the __schema of an array', () => {
    expect(ButtressSchemaHelpers.getProperty(schema, 'contacts.email')).to.equal(email);
    expect(ButtressSchemaHelpers.getProperty(schema, 'contacts.phones.number')).to.equal(phoneNumber);
  });

  it('steps over array indexes', () => {
    expect(ButtressSchemaHelpers.getProperty(schema, 'contacts.0.phones')).to.equal(phones);
    expect(ButtressSchemaHelpers.getProperty(schema, 'contacts.2.phones.10.number')).to.equal(phoneNumber);
  });

  it('returns undefined for a path the schema does not have', () => {
    expect(ButtressSchemaHelpers.getProperty(schema, 'missing')).to.equal(undefined);
    expect(ButtressSchemaHelpers.getProperty(schema, 'missing.email')).to.equal(undefined);
    expect(ButtressSchemaHelpers.getProperty(schema, 'contacts.0.missing')).to.equal(undefined);
  });
});

describe('ButtressSchemaHelpers.getSubSchema', () => {
  it('steps over array indexes, as getProperty does', () => {
    expect(ButtressSchemaHelpers.getSubSchema(schema, 'contacts.phones')?.properties).to.equal(phones.__schema);
    expect(ButtressSchemaHelpers.getSubSchema(schema, 'contacts.0.phones')?.properties).to.equal(phones.__schema);
  });
});

describe('ButtressStore.pushExt', () => {
  let store: ButtressStore;

  beforeEach(() => {
    store = new ButtressStore();
    store.set('organisation', new Map());
    store.create('organisation', { id: 'org1', name: 'DPC', contacts: [{ email: 'info@example.com' }] });
  });

  it('creates a nested array that does not exist yet', () => {
    const length = store.pushExt(
      'organisation.org1.contacts.0.phones',
      schema,
      { localOnly: true },
      { number: '0123' },
    );

    expect(length).to.equal(1);
    expect(store.get('organisation.org1.contacts.0')).to.deep.equal({
      email: 'info@example.com',
      phones: [{ number: '0123' }],
    });
  });

  it('throws a clear error for a path the schema does not have', () => {
    expect(() => store.pushExt('organisation.org1.missing', schema, { localOnly: true }, 'x')).to.throw(
      'Unable to call push on non-array property type: undefined',
    );
  });
});

describe('ButtressSchemaHelpers.getSubSchema', () => {
  it('returns null for a path the schema does not have', () => {
    expect(ButtressSchemaHelpers.getSubSchema(schema, 'missing')).to.equal(null);
    expect(ButtressSchemaHelpers.getSubSchema(schema, 'missing.email')).to.equal(null);
  });
});

describe('ButtressSchemaHelpers.inflate', () => {
  const nested: ButtressSchema = {
    name: 'organisation',
    type: 'collection',
    properties: {
      // @ts-expect-error ButtressSchemaProperty can't type a plain nested object, though inflate handles one.
      address: { street: { __type: 'string' }, geo: { lat: { __type: 'number' }, lng: { __type: 'number' } } },
    },
  };

  it('builds nested objects', () => {
    expect(ButtressSchemaHelpers.inflate(nested, false)).to.deep.equal({
      address: { street: '', geo: { lat: 0, lng: 0 } },
    });
  });

  it('keeps an id the schema gives', () => {
    const withId: ButtressSchema = {
      name: 'organisation',
      type: 'collection',
      properties: { id: { __type: 'id', __default: 'fixed' } },
    };

    expect(ButtressSchemaHelpers.inflate(withId, true)).to.deep.equal({ id: 'fixed' });
  });
});

describe('ButtressSchemaHelpers.clean', () => {
  const typed: ButtressSchema = {
    name: 'organisation',
    type: 'collection',
    properties: { active: { __type: 'boolean' }, size: { __type: 'number' }, name: { __type: 'string' } },
  };

  it('turns a string into the type of the property at the path', () => {
    expect(ButtressSchemaHelpers.clean(typed, 'active', 'True')).to.equal(true);
    expect(ButtressSchemaHelpers.clean(typed, 'active', 'yes')).to.equal(false);
    expect(ButtressSchemaHelpers.clean(typed, 'size', '£1,200.50')).to.equal('1200.50');
  });

  it('leaves other values alone', () => {
    expect(ButtressSchemaHelpers.clean(typed, 'name', 'a')).to.equal('a');
    expect(ButtressSchemaHelpers.clean(typed, 'missing', 'a')).to.equal('a');
  });

  it('returns false without a schema', () => {
    expect(ButtressSchemaHelpers.clean(undefined as unknown as ButtressSchema, 'name', 'a')).to.equal(false);
  });
});
