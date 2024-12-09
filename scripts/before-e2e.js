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

import fs from 'node:fs';

const ENDPOINT = 'https://test.local.buttressjs.com';
const TOKEN = 'splIFZxM44YpM9QUdI98NsoAZhIggocFA1IN';

const bjsRequest = async (method, path, body, token = TOKEN, apiPath = false) => {
  let url = `${ENDPOINT}/api/v1/${path}`;
  if (apiPath) url = `${ENDPOINT}/${apiPath}/api/v1/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: (body) ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    throw new Error(`Failed to ${method} ${url}`);
  }

  return res.json();
};


(async () => {
  // Delete all other apps

  const schema = [{
    name: 'organisation',
    type: 'collection',
    properties: {
      name: {
        __type: 'string',
        __default: null,
        __required: true,
        __allowUpdate: true
      },
      number: {
        __type: 'number',
        __default: null,
        __required: true,
        __allowUpdate: true
      },
      status: {
        __type: 'string',
        __default: null,
        __required: true,
        __allowUpdate: true
      }
    }
  }];

  const policies = [{
    "name": "policy-test-1",
    "selection": {
      "policyTest": {
        "@gte": 1
      }
    },
    "config": [
      {
        "verbs": [
          "GET", "SEARCH"
        ],
        "schema": [
          "organisation"
        ],
        "projection": {
          "keys": [
            "name",
            "status"
          ]
        },
        "query": {
          "access": "%FULL_ACCESS%"
        }
      }
    ]
  }, {
    "name": "policy-test-2",
    "selection": {
      "policyTest": {
        "@gte": 2
      }
    },
    "config": [
      {
        "verbs": [
          "GET", "SEARCH"
        ],
        "schema": [
          "organisation"
        ],
        "projection": {
          "keys": [
            "number"
          ]
        },
        "query": {
          "number": {
            $gte: 50
          }
        }
      }
    ]
  }];

  // Delete all existing apps
  await bjsRequest('DELETE', 'app');

  // Create a new app for testing.
  const testApp = await bjsRequest('POST', 'app', {
    name: 'Test Application',
    apiPath: 'test',
    policyPropertiesList: {
      policyTest: [1,2]
    }
  });

  // Update the app schema
  await bjsRequest('PUT', `app/schema`, schema, testApp.token);

  // Create some policy
  for await (const policy of policies) {
    await bjsRequest('POST', `policy`, policy, testApp.token);
  }

  // Create some users
  const testUser1 = await bjsRequest('POST', `user`, {
    auth: [{ app: 'test-app', appId: `test-1`, email: 'test+1@buttressjs.com' }],
    token: { domains: ['localhost*'], policyProperties: { policyTest: 1 } },
  }, testApp.token);

  const testUser2 = await bjsRequest('POST', `user`, {
    auth: [{ app: 'test-app', appId: `test-2`, email: 'test+2@buttressjs.com' }],
    token: { domains: ['localhost*'], policyProperties: { policyTest: 2 } },
  }, testApp.token);

  // Create some test orgs
  for await (const x of Array.from({ length: 10 }, (_, i) => i)) {
    await bjsRequest('POST', `organisation`, {
      name: `Test Org ${x}`,
      number: x * 10,
      status: (x % 2 === 0) ? 'active' : 'inactive',
    }, testApp.token, 'test');
  }

  // Write the token to a file.
  fs.writeFileSync('test-app-token.json', JSON.stringify({
    app: testApp,
    testUser1: testUser1.tokens[0].value,
    testUser2: testUser2.tokens[0].value,
  }));
})();