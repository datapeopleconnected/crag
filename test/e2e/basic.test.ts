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

import { expect, waitUntil } from '@open-wc/testing';

import { ButtressDbService, ButtressError } from '@buttress/crag';
import '@buttress/crag/components/buttress-db-service.js';

type Entity = { [key: string]: unknown };

const ENDPOINT = 'BUILD_REPLACE_TESTE2E_WITH_ENDPOINT';
const APP_TOKEN = 'BUILD_REPLACE_TESTE2E_WITH_APP_TOKEN';
const USER1_TOKEN = 'BUILD_REPLACE_TESTE2E_WITH_USER1_TOKEN';
const USER2_TOKEN = 'BUILD_REPLACE_TESTE2E_WITH_USER2_TOKEN';

// scripts/e2e-seed.js creates these. Test Org n has number n * 10, and is active when n is even. Buttress fills in
// the arrays, which the seed leaves out.
const SEEDED = Array.from({ length: 10 }, (_, n) => ({
  name: `Test Org ${n}`,
  number: n * 10,
  status: n % 2 === 0 ? 'active' : 'inactive',
  tags: [],
  contacts: [],
}));
const SEEDED_NAMES = SEEDED.map((org) => org.name);

// The names of organisations, sorted.
const names = (results: Entity[]) => results.map((org) => String(org.name)).sort();

// Buttress's own answer to a query, asked for directly: query() matches even the page Buttress sends again.
const buttressAnswer = async (query: Entity, token = APP_TOKEN): Promise<Entity[]> => {
  const response = await fetch(`${ENDPOINT}/test/api/v1/organisation/`, {
    method: 'QUERY',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });
  expect(response.status, await response.clone().text()).to.equal(200);
  return response.json();
};

// The properties Buttress let through, in name order, without the ids it adds.
const visible = (results: Entity[]) =>
  results.map(({ id, sourceId, ...rest }) => rest).sort((a, b) => String(a.name).localeCompare(String(b.name)));

describe('ButtressDbService', () => {
  const elements: ButtressDbService[] = [];

  // A <buttress-db-service> in the document, connected to the seeded app with the token, once its realtime socket
  // is up. connect() fires bjs-connection-changed with true as it opens the socket, then again when it connects.
  const connectAs = async (token: string) => {
    const db = document.createElement('buttress-db-service') as ButtressDbService;
    db.setAttribute('endpoint', ENDPOINT);
    db.setAttribute('token', token);
    db.setAttribute('api-path', 'test');
    document.body.appendChild(db);
    elements.push(db);

    let opened = 0;
    const socketConnected = new Promise<void>((resolve) => {
      db.addEventListener('bjs-connection-changed', (e) => {
        if ((e as CustomEvent<boolean>).detail && ++opened === 2) resolve();
      });
    });
    await db.connect();
    await socketConnected;
    return db;
  };

  // An organisation Buttress will accept: number and status are required.
  const newOrg = (db: ButtressDbService, name: string) => ({
    ...db.createObject('organisation'),
    name,
    number: 123,
    status: 'active',
  });

  after(() => {
    elements.forEach((el) => el.remove());
  });

  it('is not connected by default', () => {
    const db = document.createElement('buttress-db-service') as ButtressDbService;

    expect(db.isDbConnected()).to.equal(false);
  });

  describe('as the app', () => {
    let db: ButtressDbService;

    // count() always asks Buttress, so it shows what Buttress has rather than what's in the local store.
    const countNamed = (name: string) => db.count('organisation', { name: { $eq: name } });

    before(async () => {
      db = await connectAs(APP_TOKEN);
    });

    it('connects', () => {
      expect(db.isDbConnected()).to.equal(true);
    });

    it('queries every property of the seeded organisations', async () => {
      const { total, results } = await db.query('organisation', { name: { $in: SEEDED_NAMES } });

      expect(total).to.equal(10);
      expect(visible(results)).to.deep.equal(SEEDED);
    });

    // Without wait, nextIdle is how to know writes have reached Buttress.
    describe('writes without wait', () => {
      it('creates an entity', async () => {
        const path = db.create('organisation', newOrg(db, 'Created Org'))!;

        expect(path).to.match(/^organisation\.[a-f0-9]{24}$/);
        await db.nextIdle('organisation');
        expect(await countNamed('Created Org')).to.equal(1);
      });

      it('updates an entity', async () => {
        const path = db.create('organisation', newOrg(db, 'Updated Org'))!;

        db.set(`${path}.name`, 'Updated Org 2');

        expect(db.get(`${path}.name`)).to.equal('Updated Org 2');
        await db.nextIdle('organisation');
        expect(await countNamed('Updated Org')).to.equal(0);
        expect(await countNamed('Updated Org 2')).to.equal(1);
      });

      it('deletes an entity', async () => {
        const path = db.create('organisation', newOrg(db, 'Deleted Org'))!;
        await db.nextIdle('organisation');

        expect(db.delete(path)).to.equal(true);

        expect(db.get(path)).to.equal(undefined);
        await db.nextIdle('organisation');
        expect(await countNamed('Deleted Org')).to.equal(0);
      });
    });

    describe('writes with wait', () => {
      it('resolves a create once Buttress has the entity', async () => {
        const path = (await db.create('organisation', newOrg(db, 'Awaited Org'), { wait: true }))!;

        expect(path).to.match(/^organisation\.[a-f0-9]{24}$/);
        expect(await countNamed('Awaited Org')).to.equal(1);
      });

      it('resolves a set once Buttress has the change', async () => {
        const path = (await db.create('organisation', newOrg(db, 'Awaited Update'), { wait: true }))!;

        await db.set(`${path}.name`, 'Awaited Update 2', { wait: true });

        expect(await countNamed('Awaited Update 2')).to.equal(1);
      });

      it('resolves a delete once Buttress has removed the entity', async () => {
        const path = (await db.create('organisation', newOrg(db, 'Awaited Delete'), { wait: true }))!;

        expect(await db.delete(path, { wait: true })).to.equal(true);

        expect(await countNamed('Awaited Delete')).to.equal(0);
      });

      // The first set goes alone, and the two queued behind it go as one bulk update, which Buttress answers for each.
      it('rejects only the update in a bundle that Buttress refuses', async () => {
        const path = (await db.create('organisation', newOrg(db, 'Refused Update'), { wait: true }))!;

        const [named, numbered, statused] = await Promise.all(
          [
            db.set(`${path}.name`, 'Refused Update 2', { wait: true }),
            db.set(`${path}.number`, 'not a number', { wait: true }),
            db.set(`${path}.status`, 'inactive', { wait: true }),
          ].map((write) => write.catch((e: unknown) => e)),
        );

        expect(named).to.equal(`${path}.name`);
        expect(numbered).to.be.instanceOf(ButtressError);
        expect((numbered as ButtressError).status).to.equal(400);
        expect(statused).to.equal(`${path}.status`);
        expect(
          await db.count('organisation', { name: { $eq: 'Refused Update 2' }, status: { $eq: 'inactive' } }),
        ).to.equal(1);
      });

      it('stores whole arrays set into typed arrays as they were sent', async () => {
        const path = (await db.create('organisation', newOrg(db, 'Array Org'), { wait: true }))!;

        await db.set(`${path}.tags`, ['b', 'a'], { wait: true });
        await db.set(
          `${path}.contacts`,
          [
            { name: 'A', qty: 1 },
            { name: 'B', qty: 2 },
          ],
          { wait: true },
        );
        // Buttress can't insert into the middle of an array, so this sends the whole array too.
        await db.spliceWith(`${path}.contacts`, 1, 0, { wait: true }, { name: 'M', qty: 5 });

        // Read with another client, so the arrays come from Buttress rather than this store.
        const reader = await connectAs(APP_TOKEN);
        const { results } = await reader.query('organisation', { name: { $eq: 'Array Org' } });
        const contacts = results[0].contacts as Entity[];
        expect(results[0].tags).to.deep.equal(['b', 'a']);
        expect(contacts.map(({ name, qty }) => ({ name, qty }))).to.deep.equal([
          { name: 'A', qty: 1 },
          { name: 'M', qty: 5 },
          { name: 'B', qty: 2 },
        ]);
      });

      it('rejects a write that Buttress rejects', async () => {
        // number and status are required, so Buttress refuses the entity.
        const payload = db.createObject('organisation');
        payload.name = 'Incomplete Org';
        delete payload.number;
        delete payload.status;

        const err = await db.create('organisation', payload, { wait: true }).catch((e: unknown) => e);

        expect(err).to.be.instanceOf(ButtressError);
        expect((err as ButtressError).status).to.equal(400);
        expect(await countNamed('Incomplete Org')).to.equal(0);
      });
    });
  });

  // Each test waits up to 5s for each write to reach the watcher, so needs longer than Mocha's default 2s.
  describe('realtime', () => {
    const eventually = (check: () => boolean, message: string) => waitUntil(check, message, { timeout: 5000 });

    // Two clients of the app. Each has its own session, so the watcher applies the writer's writes.
    const clients = async () => ({ watcher: await connectAs(APP_TOKEN), writer: await connectAs(APP_TOKEN) });

    it("applies another client's creates and updates to the store", async function () {
      this.timeout(15000);
      const { watcher, writer } = await clients();

      const path = (await writer.create('organisation', newOrg(writer, 'Realtime Org'), { wait: true }))!;
      const watchedName = () => watcher.get(`${path}.name`) as unknown;
      await eventually(() => watchedName() === 'Realtime Org', 'the create to reach the watcher');

      await writer.set(`${path}.name`, 'Realtime Org 2', { wait: true });
      await eventually(() => watchedName() === 'Realtime Org 2', 'the update to reach the watcher');
    });

    it("applies another client's bundled updates to the store", async function () {
      this.timeout(15000);
      const { watcher, writer } = await clients();
      const path = (await writer.create('organisation', newOrg(writer, 'Bundled Org'), { wait: true }))!;
      await eventually(() => watcher.get(path) !== undefined, 'the create to reach the watcher');

      // The first set goes alone, and the two queued behind it go as one bulk update.
      await Promise.all([
        writer.set(`${path}.name`, 'Bundled Org 2', { wait: true }),
        writer.set(`${path}.number`, 456, { wait: true }),
        writer.set(`${path}.status`, 'inactive', { wait: true }),
      ]);
      const watched = (key: string) => watcher.get(`${path}.${key}`) as unknown;
      await eventually(
        () => watched('name') === 'Bundled Org 2' && watched('number') === 456 && watched('status') === 'inactive',
        'the bundled updates to reach the watcher',
      );
    });

    it("applies another client's deletes to the store", async function () {
      this.timeout(15000);
      const { watcher, writer } = await clients();

      const path = (await writer.create('organisation', newOrg(writer, 'Realtime Delete'), { wait: true }))!;
      await eventually(() => watcher.get(path) !== undefined, 'the create to reach the watcher');

      await writer.delete(path, { wait: true });
      await eventually(() => watcher.get(path) === undefined, 'the delete to reach the watcher');
    });
  });

  // crag matches a query again locally to choose results. These check it matches the entities Buttress does, for the
  // rules both take from MongoDB, with every entity in the store, so crag could match ones Buttress doesn't.
  describe('local matching', () => {
    const MATCH = { name: { $rex: '^Match Org ' } };
    const orgs = [
      {
        name: 'Match Org 1',
        number: 0,
        status: 'active',
        tags: ['x', 'y'],
        contacts: [
          { name: 'A', qty: 0 },
          { name: '', qty: 2 },
        ],
      },
      { name: 'Match Org 2', number: 10, status: 'closed', tags: ['y'], contacts: [{ name: 'A', qty: 3 }] },
      { name: 'Match Org 3', number: 25, status: 'active', tags: [], contacts: [] },
    ];
    const ALL = orgs.map((org) => org.name);

    let db: ButtressDbService;

    before(async () => {
      const writer = await connectAs(APP_TOKEN);
      for (const org of orgs) {
        await writer.create('organisation', { ...newOrg(writer, org.name), ...org }, { wait: true });
      }
      // A client with every one of them in its store
      db = await connectAs(APP_TOKEN);
      await db.query('organisation', MATCH);
    });

    const cases: [string, Entity, string[]][] = [
      ['a bare value', { status: 'active' }, ['Match Org 1', 'Match Org 3']],
      ['$ne on a list', { tags: { $ne: 'x' } }, ['Match Org 2', 'Match Org 3']],
      ['$not on a list', { tags: { $not: 'x' } }, ['Match Org 2', 'Match Org 3']],
      ['$all', { tags: { $all: ['y', 'x'] } }, ['Match Org 1']],
      ['$all of an empty list', { tags: { $all: [] } }, []],
      ['$regex', { status: { $regex: '^act' } }, ['Match Org 1', 'Match Org 3']],
      ['$elemMatch', { contacts: { $elemMatch: { name: 'A', qty: { $gt: 1 } } } }, ['Match Org 2']],
      [
        'an $elMatch with its own $or',
        { contacts: { $elMatch: { $or: [{ qty: 3 }, { name: '' }] } } },
        ['Match Org 1', 'Match Org 2'],
      ],
      ["an $elMatch of a list's values", { tags: { $elMatch: { $gt: 'x' } } }, ['Match Org 1', 'Match Org 2']],
      ['$nor', { $nor: [{ status: 'closed' }, { number: 0 }] }, ['Match Org 3']],
      [
        '@ names',
        { '@or': [{ status: { '@eq': 'closed' } }, { number: { '@gt': 20 } }] },
        ['Match Org 2', 'Match Org 3'],
      ],
      ['a list compared whole', { tags: ['x', 'y'] }, ['Match Org 1']],
      ['a list compared whole, in order', { tags: ['y', 'x'] }, []],
      ['an empty list compared whole', { tags: [] }, ['Match Org 3']],
      ['0 through an array', { 'contacts.qty': 0 }, ['Match Org 1']],
      ['an empty string through an array', { 'contacts.name': '' }, ['Match Org 1']],
      ['a missing field as null', { nothing: null }, ALL],
      ['$ne of a missing field', { nothing: { $ne: 'x' } }, ALL],
      [
        "a field an array's documents haven't got as null",
        { 'contacts.nothing': null },
        ['Match Org 1', 'Match Org 2'],
      ],
      ["an operand read as its property's type", { number: { $in: ['0', '25'] } }, ['Match Org 1', 'Match Org 3']],
      ['a comparison across types', { name: { $gt: 5 } }, []],
      ['$gte of null', { number: { $gte: null } }, []],
    ];

    for (const [rule, query, expected] of cases) {
      it(`matches ${rule} as Buttress does`, async () => {
        const matching = { $and: [MATCH, query] };

        const { results } = await db.query('organisation', matching);

        expect(names(await buttressAnswer(matching))).to.deep.equal(expected);
        expect(names(results)).to.deep.equal(expected);
      });
    }
  });

  // scripts/e2e-seed.js gives user 1 policy-test-1, which lets through name and status. User 2 also gets
  // policy-test-2, which lets through number for organisations whose number is 50 or more. Buttress sends those
  // organisations twice, once for each policy, and the store merges them.
  describe('policies', () => {
    // What the user sees of the seeded organisations. The query is empty because Buttress leaves out what a policy
    // lets through when the query filters on a property that policy hides: filtering on name would lose the numbers.
    const seededAs = async (token: string) => {
      const db = await connectAs(token);
      const { results } = await db.query('organisation', {});
      return visible(results.filter((org) => SEEDED_NAMES.includes(org.name)));
    };

    it('shows user 1 the name and status of every organisation, and no number', async () => {
      expect(await seededAs(USER1_TOKEN)).to.deep.equal(SEEDED.map(({ name, status }) => ({ name, status })));
    });

    it('shows user 2 the name and status of every organisation, and the number of those numbered 50 or more', async () => {
      expect(await seededAs(USER2_TOKEN)).to.deep.equal(
        SEEDED.map(({ name, number, status }) => (number >= 50 ? { name, number, status } : { name, status })),
      );
    });

    // Buttress refuses a query on a property none of the user's policies shows them, so query() rejects before crag
    // matches anything locally.
    it('refuses user 1 a query on number, which no policy shows them', async () => {
      const db = await connectAs(USER1_TOKEN);

      const err = await db.query('organisation', { number: { $gte: 50 } }).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(ButtressError);
      expect((err as ButtressError).status).to.equal(403);
    });

    // User 2's store has every seeded organisation, with the numbers of those numbered 50 or more. Buttress answers a
    // query on number through policy-test-2 alone, which shows only number, so its answer is compared by id. crag reads
    // a number it can't see as missing, so a query that matches a missing number matches those organisations locally,
    // but results are restricted to what Buttress matched, which has their numbers.
    describe('local matching on number as user 2, who sees only some numbers', () => {
      let db: ButtressDbService;
      // The seeded organisations' names by id
      const seeded = new Map<string, string>();
      const seededNames = (orgs: Entity[]) =>
        orgs
          .map((org) => seeded.get(String(org.id)))
          .filter((name) => name !== undefined)
          .sort();

      before(async () => {
        db = await connectAs(USER2_TOKEN);
        const { results } = await db.query('organisation', {});
        results.filter((org) => SEEDED_NAMES.includes(org.name)).forEach((org) => seeded.set(org.id, org.name));
      });

      // The seeded organisations whose numbers user 2 can't see
      const hidden = SEEDED.filter((org) => org.number < 50).map((org) => org.name);

      for (const query of [{ number: { $eq: 50 } }, { number: { $gte: 50 } }, { number: { $lt: 50 } }]) {
        it(`matches ${JSON.stringify(query)} as Buttress does`, async () => {
          const { results } = await db.query('organisation', query);

          expect(seededNames(results)).to.deep.equal(seededNames(await buttressAnswer(query, USER2_TOKEN)));
        });
      }

      for (const query of [
        { number: null },
        { number: { $ne: 50 } },
        { number: { $nin: [50, 60] } },
        { number: { $exists: false } },
      ]) {
        it(`matches ${JSON.stringify(query)} as Buttress does, leaving out the organisations whose number it hides`, async () => {
          const { results } = await db.query('organisation', query);

          const buttress = seededNames(await buttressAnswer(query, USER2_TOKEN));
          // Buttress matches none of those, though each matches locally without its number.
          expect(buttress.some((name) => hidden.includes(name))).to.equal(false);
          expect(seededNames(results)).to.deep.equal(buttress);
          // A page is what Buttress matched too
          const { results: page } = await db.query('organisation', query, { limit: 100 });
          expect(seededNames(page)).to.deep.equal(buttress);
        });
      }
    });
  });
});
