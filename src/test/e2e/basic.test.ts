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

import { html } from 'lit';
import { fixture, expect } from '@open-wc/testing';

import { ButtressDbService } from '@buttress/crag';
import '@buttress/crag/buttress-db-service.js';

describe('ButtressDbService', () => {
  let db: ButtressDbService;
  let entityPath: string | undefined;

  const TEST_APP_TOKEN = 'BUILD_REPLACE_TESTE2E_WITH_APP_TOKEN';
  const TEST_USER1_TOKEN = 'BUILD_REPLACE_TESTE2E_WITH_USER1_TOKEN';
  const TEST_USER2_TOKEN = 'BUILD_REPLACE_TESTE2E_WITH_USER2_TOKEN';

  console.log('TEST_APP_TOKEN', TEST_APP_TOKEN);
  console.log('TEST_USER1_TOKEN', TEST_USER1_TOKEN);
  console.log('TEST_USER2_TOKEN', TEST_USER2_TOKEN);

  it('should be isDbConnected is false by default', async () => {
    const el: ButtressDbService = await fixture(html`<buttress-db-service></buttress-db-service>`);

    expect(el.isDbConnected()).to.equal(false);
  });

  it('should connect to a db instance', async () => {
    db = await fixture(html`<buttress-db-service
      endpoint="BUILD_REPLACE_TESTE2E_WITH_ENDPOINT"
      token="${TEST_APP_TOKEN}"
      api-path="test"
    ></buttress-db-service>`);

    await db.connect();

    expect(db.isDbConnected()).to.equal(true);
  });

  it('should query a data schema', async () => {
    const queryCall = await db.query('organisation', {}); // { total: 0, results: [], skip: undefined, limit: undefined });

    expect(queryCall.total).greaterThan(0);
    expect(queryCall.results).to.be.an('array');
  });

  it('should add some data', async () => {
    const payload = db.createObject('organisation');
    payload.name = 'Test Organisation';
    payload.number = 123;
    payload.status = 'active';

    const res = db.create('organisation', payload); // 'organisation.6709476b082b32233234259c'
    expect(res).to.be.a('string');
    expect(res).to.match(/organisation\.[a-f0-9]{24}/);

    entityPath = res;
  });

  it('should update some data', async () => {
    db.set(`${entityPath}.name`, 'Test Orgs 2');

    // Check to see if the data has been updated
    const value = db.get(`${entityPath}.name`);
    expect(value).to.equal('Test Orgs 2');
  });

  it('should remove some data', async () => {
    if (entityPath === undefined) throw new Error('entityPath is undefined');

    // Wait some time to make sure the data was networked.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const res = db.delete(entityPath);
    expect(res).to.equal(true);

    const value = db.get(entityPath);
    expect(value).to.equal(undefined);
  });

  describe('Policy', () => {
    it ('should connect and have access to all the records but no number property', async () => {
      const db1: ButtressDbService = await fixture(html`<buttress-db-service
        endpoint="BUILD_REPLACE_TESTE2E_WITH_ENDPOINT"
        token="${TEST_USER1_TOKEN}"
        api-path="test"
      ></buttress-db-service>`);

      await db1.connect();

      expect(db1.isDbConnected()).to.equal(true);

      const queryCall = await db1.query('organisation', {}); // { total: 0, results: [], skip: undefined, limit: undefined });
      expect(queryCall.total).equal(10);
      expect(queryCall.results).to.be.an('array');
    });

    it ('should connect and have access to all the records but no status property', async () => {
      const db2: ButtressDbService = await fixture(html`<buttress-db-service
        endpoint="BUILD_REPLACE_TESTE2E_WITH_ENDPOINT"
        token="${TEST_USER2_TOKEN}"
        api-path="test"
      ></buttress-db-service>`);

      await db2.connect();

      expect(db2.isDbConnected()).to.equal(true);

      const queryCall = await db2.query('organisation', {}); // { total: 0, results: [], skip: undefined, limit: undefined });
      expect(queryCall.total).equal(10);
      expect(queryCall.results).to.be.an('array');
    });
  });
});