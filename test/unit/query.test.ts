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

import { compileQuery } from '../../src/query.js';
import type { ButtressSchemaProperties } from '../../src/types/ButtressSchemaProperties.js';

// Buttress's oracle schema and documents (test/e2e/access-control/operators.test.js in buttress-js), the documents as
// Buttress sends them
const fields = {
  name: { __type: 'string' },
  count: { __type: 'number' },
  active: { __type: 'boolean' },
  at: { __type: 'date' },
  owner: { __type: 'id' },
  tags: { __type: 'array', __itemtype: 'string' },
  scores: { __type: 'array', __itemtype: 'number' },
  lines: { __type: 'array', __schema: { sku: { __type: 'string' }, qty: { __type: 'number' } } },
  meta: { __type: 'object' },
  address: { city: { __type: 'string' } },
} as unknown as ButtressSchemaProperties;

const OWNER = '6abd01000000000000000001';
const OTHER_OWNER = '6abd01000000000000000002';
const documents = [
  {
    id: '1',
    name: 'Ada',
    count: 3,
    active: true,
    at: '2026-01-01T00:00:00.000Z',
    owner: OWNER,
    tags: ['a', 'b'],
    scores: [1, 5],
    lines: [
      { sku: 'X', qty: 2 },
      { sku: 'Y', qty: 7 },
    ],
    meta: { level: 2, parts: [{ n: 1 }, { m: 2 }] },
    address: { city: 'Leeds' },
  },
  {
    id: '2',
    name: 'bob',
    count: 10,
    active: false,
    at: '2026-06-01T00:00:00.000Z',
    owner: OTHER_OWNER,
    tags: ['b'],
    scores: [],
    lines: [{ sku: 'Y', qty: 1 }],
    meta: null,
    address: { city: 'York' },
  },
  {
    id: '3',
    name: 'Cy',
    count: null,
    active: null,
    at: null,
    owner: null,
    tags: [],
    scores: [10],
    lines: [],
    meta: {},
    address: { city: null },
  },
  {
    id: '4',
    name: 'ada',
    count: 3.5,
    active: true,
    at: '2025-12-31T23:59:59.000Z',
    owner: OWNER,
    tags: ['c'],
    scores: [3, 4],
    lines: [{ sku: 'X', qty: 9 }],
    meta: { level: 5, parts: [1, 2] },
    address: { city: 'leeds' },
  },
];

const matched = (query: Record<string, unknown>, docs: unknown[] = documents, schema: unknown = fields) => {
  const matches = compileQuery(query, schema as ButtressSchemaProperties);
  return docs.filter((doc) => matches(doc)).map((doc) => (doc as { id: string }).id);
};

// Each query, with the documents MongoDB matches, as Buttress's oracle test checks them against MongoDB
const ORACLE: [Record<string, unknown>, string[]][] = [
  [{ name: 'Ada' }, ['1']],
  [{ name: { $eq: 'ada' } }, ['4']],
  [{ name: { $ne: 'Ada' } }, ['2', '3', '4']],
  [{ name: { $not: 'Ada' } }, ['2', '3', '4']],
  [{ name: { $in: ['Ada', 'bob'] } }, ['1', '2']],
  [{ name: { $nin: ['Ada', 'bob'] } }, ['3', '4']],
  [{ name: { $rex: '^a' } }, ['4']],
  [{ name: { $rexi: '^a' } }, ['1', '4']],
  [{ name: { $inProp: 'd' } }, ['1', '4']],
  [{ name: { $rex: '^\\x41\\w' } }, ['1']],
  [{ name: { $rexi: '^a\\w{2}$' } }, ['1', '4']],
  [{ name: { $rex: 'a\\b' } }, ['1', '4']],
  [{ count: 3 }, ['1']],
  [{ count: { $gt: 3 } }, ['2', '4']],
  [{ count: { $gte: 3 } }, ['1', '2', '4']],
  [{ count: { $lt: 10 } }, ['1', '4']],
  [{ count: { $lte: 3.5 } }, ['1', '4']],
  [{ count: { $gt: '3' } }, ['2', '4']],
  [{ count: null }, ['3']],
  [{ count: { $ne: null } }, ['1', '2', '4']],
  [{ count: { $exists: true } }, ['1', '2', '3', '4']],
  [{ nothing: { $exists: false } }, ['1', '2', '3', '4']],
  [{ nothing: { $exists: true } }, []],
  [{ nothing: null }, ['1', '2', '3', '4']],
  [{ nothing: { $ne: 'x' } }, ['1', '2', '3', '4']],
  [{ nothing: { $nin: ['x'] } }, ['1', '2', '3', '4']],
  [{ constructor: { $exists: true } }, []],
  [{ toString: { $exists: false } }, ['1', '2', '3', '4']],
  [{ active: true }, ['1', '4']],
  [{ active: 'true' }, ['1', '4']],
  [{ active: { $ne: true } }, ['2', '3']],
  [{ at: { $gtDate: '2026-01-01T00:00:00.000Z' } }, ['2']],
  [{ at: { $gteDate: '2026-01-01T00:00:00.000Z' } }, ['1', '2']],
  [{ at: { $ltDate: '2026-01-01T00:00:00.000Z' } }, ['4']],
  [{ at: { $lteDate: '2026-06-01T00:00:00.000Z' } }, ['1', '2', '4']],
  [{ at: null }, ['3']],
  [{ owner: OWNER }, ['1', '4']],
  [{ owner: { $ne: OWNER } }, ['2', '3']],
  [{ owner: { $in: [OWNER, OTHER_OWNER] } }, ['1', '2', '4']],
  [{ owner: null }, ['3']],
  [{ tags: 'b' }, ['1', '2']],
  [{ tags: { $in: ['a', 'c'] } }, ['1', '4']],
  [{ tags: { $in: ['.', 'c'] } }, ['4']],
  [{ tags: { $nin: ['b'] } }, ['3', '4']],
  [{ tags: { $all: ['a', 'b'] } }, ['1']],
  [{ tags: { $all: [] } }, []],
  [{ scores: { $all: [] } }, []],
  [{ tags: { $ne: 'b' } }, ['3', '4']],
  [{ tags: ['a', 'b'] }, ['1']],
  [{ tags: [] }, ['3']],
  [{ scores: { $gt: 4 } }, ['1', '3']],
  [{ scores: { $lt: 2 } }, ['1']],
  [{ scores: { $elMatch: { $gt: 3, $lt: 5 } } }, ['4']],
  [{ scores: { $elMatch: { $gt: '3' } } }, ['1', '3', '4']],
  [{ 'lines.sku': 'Y' }, ['1', '2']],
  [{ 'lines.qty': { $gte: 7 } }, ['1', '4']],
  [{ lines: { $elMatch: { sku: 'X', qty: { $gt: 5 } } } }, ['4']],
  [{ lines: { $elMatch: { sku: 'Y', qty: { $gt: 5 } } } }, ['1']],
  [{ lines: { $elMatch: { $or: [{ sku: 'Y' }, { qty: { $gt: 8 } }] } } }, ['1', '2', '4']],
  [{ lines: { $elMatch: { sku: 'X', $or: [{ qty: 2 }, { qty: 9 }] } } }, ['1', '4']],
  [{ lines: { $elMatch: { $and: [{ sku: 'Y' }, { qty: { $lt: 5 } }] } } }, ['2']],
  [{ 'meta.level': { $gt: 1 } }, ['1', '4']],
  [{ 'meta.parts.n': null }, ['1', '2', '3']],
  [{ 'meta.parts.n': { $ne: null } }, ['4']],
  [{ 'meta.parts.n': { $exists: true } }, ['1']],
  [{ 'meta.parts.n': { $exists: false } }, ['2', '3', '4']],
  [{ 'meta.parts.1': null }, ['1', '2', '3']],
  [{ 'meta.level.x': null }, ['1', '2', '3', '4']],
  [{ meta: null }, ['2']],
  [{ 'address.city': 'Leeds' }, ['1']],
  [{ 'address.city': { $rexi: 'LEE' } }, ['1', '4']],
  [{ 'address.city': null }, ['3']],
  [{ address: { city: 'Leeds' } }, ['1']],
  [{ meta: { level: 2 } }, []],
  [{ meta: {} }, ['3']],
  [{ $or: [{ name: 'Ada' }, { count: 10 }] }, ['1', '2']],
  [{ $and: [{ active: true }, { count: { $lt: 3.5 } }] }, ['1']],
  [{ $nor: [{ name: 'Ada' }, { name: 'bob' }] }, ['3', '4']],
  [{ $and: [] }, ['1', '2', '3', '4']],
  [{}, ['1', '2', '3', '4']],
];

describe('compileQuery', () => {
  describe('as MongoDB matches', () => {
    for (const [query, expected] of ORACLE) {
      it(`matches ${JSON.stringify(query)}`, () => {
        expect(matched(query)).to.deep.equal(expected);
      });
    }
  });

  // Paths and values the oracle doesn't reach, matched by the rules Buttress's matcher follows
  describe('paths', () => {
    it("passes over an index past an array's end", () => {
      expect(matched({ 'tags.5': null })).to.deep.equal([]);
    });

    it("passes over an array's items that aren't documents on the way", () => {
      expect(matched({ 'meta.parts.1.x': null })).to.deep.equal(['1', '2', '3']);
    });

    it('reaches an item by its index in an array the schema gives no item type', () => {
      const list = { list: { __type: 'array' } };
      expect(
        matched(
          { 'list.0': 'a' },
          [
            { id: 'a', list: ['a'] },
            { id: 'b', list: ['b', 'a'] },
          ],
          list,
        ),
      ).to.deep.equal(['a']);
    });

    it('reads a field of a Map as a document', () => {
      const docs = [{ id: 'a', links: [new Map([['kind', 'web']])] }];
      expect(matched({ 'links.kind': 'web' }, docs, {})).to.deep.equal(['a']);
      expect(matched({ 'links.other': null }, docs, {})).to.deep.equal(['a']);
    });

    it('compares a value where the schema has a nested object as it is', () => {
      expect(matched({ address: 'Leeds' }, [{ id: 'a', address: 'Leeds' }])).to.deep.equal(['a']);
    });
  });

  describe('values', () => {
    it('reads each date of a list of dates as a date', () => {
      const dates = { dates: { __type: 'array', __itemtype: 'date' } };
      const docs = [{ id: 'a', dates: ['2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'] }];
      expect(matched({ dates: '2026-06-01' }, docs, dates)).to.deep.equal(['a']);
      expect(matched({ dates: { $lt: '2025-01-01' } }, docs, dates)).to.deep.equal([]);
    });

    it("leaves a stored date that can't be read, and an operand, as text", () => {
      expect(matched({ at: 'soon' }, [{ id: 'a', at: 'soon' }])).to.deep.equal(['a']);
    });

    it('reads 1 and 0 as true and false for a boolean', () => {
      expect(matched({ active: 1 })).to.deep.equal(['1', '4']);
      expect(matched({ active: 0 })).to.deep.equal(['2']);
    });

    it('reads a number as a date for a date', () => {
      expect(matched({ at: Date.parse('2026-06-01T00:00:00.000Z') })).to.deep.equal(['2']);
    });

    it("doesn't order objects", () => {
      expect(matched({ meta: { $gte: {} } })).to.deep.equal([]);
    });
  });

  describe('operators Buttress refuses', () => {
    it("matches nothing for an $elMatch that isn't given an object", () => {
      expect(matched({ tags: { $elMatch: 'a' } })).to.deep.equal([]);
    });

    it("collects the operators it doesn't know, each of which matches nothing", () => {
      const unknown: string[] = [];
      const matches = compileQuery(
        { $or: [{ $where: 'true' }, { name: { $like: 'A' } }, { scores: { $elMatch: { '@near': 1 } } }] },
        fields,
        unknown,
      );

      expect(documents.filter((doc) => matches(doc))).to.deep.equal([]);
      expect(unknown).to.deep.equal(['$where', '$like', '@near']);
    });
  });
});
