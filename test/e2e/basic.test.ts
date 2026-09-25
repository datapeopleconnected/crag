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

// scripts/e2e-seed.js creates these. Test Org n has number n * 10, and is active when n is even.
const SEEDED = Array.from({ length: 10 }, (_, n) => ({
  name: `Test Org ${n}`,
  number: n * 10,
  status: n % 2 === 0 ? 'active' : 'inactive',
}));
const SEEDED_NAMES = SEEDED.map((org) => org.name);

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

    // Buttress doesn't send deletes: to work out who may see the change, its socket policy router looks up the
    // entity, which has gone, and logs "Unable to find document" instead. Unskip once Buttress sends them.
    it.skip("applies another client's deletes to the store", async function () {
      this.timeout(15000);
      const { watcher, writer } = await clients();

      const path = (await writer.create('organisation', newOrg(writer, 'Realtime Delete'), { wait: true }))!;
      await eventually(() => watcher.get(path) !== undefined, 'the create to reach the watcher');

      await writer.delete(path, { wait: true });
      await eventually(() => watcher.get(path) === undefined, 'the delete to reach the watcher');
    });
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
  });
});
