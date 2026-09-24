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

import { expect, fixture } from '@open-wc/testing';
import { html, LitElement } from 'lit';
import { consume } from '@lit/context';

import '../../src/components/buttress-db-service.js';
import { ButtressDbService } from '../../src/ButtressDbService.js';
import { buttressDbServiceContext } from '../../src/context.js';

class DbConsumer extends LitElement {
  @consume({ context: buttressDbServiceContext })
  db?: ButtressDbService;
}
customElements.define('db-consumer', DbConsumer);

// Assertions compare booleans and tag names, not elements: if an assertion with an element
// as its expected value fails, the runner tries to serialise the element and times out.
describe('ButtressDbService context', () => {
  it('provides itself to descendants', async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service>
        <db-consumer></db-consumer>
      </buttress-db-service>
    `);
    const consumer = el.querySelector<DbConsumer>('db-consumer');

    expect(consumer?.db === el, 'consumer.db is the <buttress-db-service>').to.equal(true);
  });

  it('renders its children through a slot', async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service>
        <db-consumer></db-consumer>
      </buttress-db-service>
    `);
    const slot = el.shadowRoot?.querySelector('slot');

    expect(slot?.assignedElements().map((child) => child.localName)).to.deep.equal(['db-consumer']);
  });
});

// Removing the element logs 'disconnectedCallback' at DEBUG level.
describe('ButtressDbService logging', () => {
  let messages: string[];
  let originalDebug: typeof console.debug;

  const disconnectedMessages = () => messages.filter((message) => message.includes('disconnectedCallback'));

  beforeEach(() => {
    messages = [];
    originalDebug = console.debug;
    console.debug = (...args: unknown[]) => {
      messages.push(args.join(' '));
    };
  });

  afterEach(() => {
    console.debug = originalDebug;
  });

  it('logs debug messages when loglevel is debug', async () => {
    const el = await fixture(html`
      <buttress-db-service loglevel="debug"></buttress-db-service>
    `);
    el.remove();

    expect(disconnectedMessages()).to.deep.equal(['[DEBUG] [buttress-db-service] disconnectedCallback']);
  });

  it('does not log debug messages at the default level', async () => {
    const el = await fixture(html`
      <buttress-db-service></buttress-db-service>
    `);
    el.remove();

    expect(disconnectedMessages()).to.deep.equal([]);
  });

  it('uses the log-label attribute as the label', async () => {
    const el = await fixture(html`
      <buttress-db-service loglevel="debug" log-label="My-Label"></buttress-db-service>
    `);
    el.remove();

    expect(disconnectedMessages()).to.deep.equal(['[DEBUG] [my-label] disconnectedCallback']);
  });

  it('logs nothing when log-disable is set', async () => {
    const el = await fixture(html`
      <buttress-db-service loglevel="debug" log-disable></buttress-db-service>
    `);
    el.remove();

    expect(disconnectedMessages()).to.deep.equal([]);
  });
});

describe('ButtressDbService settings', () => {
  it('syncs property changes into settings in a single update', async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service></buttress-db-service>
    `);

    el.endpoint = 'https://example.test';
    el.token = 'abc';
    el.userId = 'user-1';
    el.coreSchema = ['app'];

    // updateComplete resolves false if another update was requested during this one.
    expect(await el.updateComplete).to.equal(true);
    expect(el.getEndpoint()).to.equal('https://example.test');
    expect(el.getToken()).to.equal('abc');
    expect(el.getUserId()).to.equal('user-1');
    expect(el.getCoreSchemas()).to.deep.equal(['app']);
  });
});

describe('ButtressDbService settings on connect', () => {
  it('keeps values from the setters when moved to another parent', async () => {
    const parent = await fixture<HTMLDivElement>(html`
      <div>
        <buttress-db-service></buttress-db-service>
        <section></section>
      </div>
    `);
    const el = parent.querySelector<ButtressDbService>('buttress-db-service')!;
    el.setEndpoint('https://example.test');
    el.setToken('abc');
    el.setUserId('user-1');
    el.setCoreSchemas(['app']);

    parent.querySelector('section')!.appendChild(el);

    expect(el.getEndpoint()).to.equal('https://example.test');
    expect(el.getToken()).to.equal('abc');
    expect(el.getUserId()).to.equal('user-1');
    expect(el.getCoreSchemas()).to.deep.equal(['app']);
  });

  it('prefers attributes over earlier setter values when connected', async () => {
    const parent = await fixture<HTMLDivElement>(html`
      <div></div>
    `);
    const el = document.createElement('buttress-db-service') as ButtressDbService;
    el.setEndpoint('https://old.test');
    el.setAttribute('endpoint', 'https://new.test');

    parent.appendChild(el);

    expect(el.getEndpoint()).to.equal('https://new.test');
  });

  it('defaults the core schemas to an empty list', async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service></buttress-db-service>
    `);

    expect(el.getCoreSchemas()).to.deep.equal([]);
  });
});

describe('ButtressDbService realtime', () => {
  it('closes the realtime connection when removed', async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service></buttress-db-service>
    `);
    const realtime = (el as any)._realtime;
    let disconnects = 0;
    realtime.disconnect = () => {
      disconnects += 1;
    };

    el.remove();

    expect(disconnects).to.equal(1);
  });

  it('reopens the realtime connection when moved to another parent', async () => {
    const parent = await fixture<HTMLDivElement>(html`
      <div>
        <buttress-db-service endpoint="http://127.0.0.1:1" token="abc"></buttress-db-service>
        <section></section>
      </div>
    `);
    const el = parent.querySelector<ButtressDbService>('buttress-db-service')!;
    const realtime = (el as any)._realtime;
    realtime.connect();
    const before = realtime._socket;

    parent.querySelector('section')!.appendChild(el);

    expect(before.active).to.equal(false);
    expect(realtime.isOpen).to.equal(true);
    expect(realtime._socket.active).to.equal(true);

    el.remove();
    expect(realtime.isOpen).to.equal(false);
  });

  it('does not open a realtime connection on move if none was open', async () => {
    const parent = await fixture<HTMLDivElement>(html`
      <div>
        <buttress-db-service endpoint="http://127.0.0.1:1" token="abc"></buttress-db-service>
        <section></section>
      </div>
    `);
    const el = parent.querySelector<ButtressDbService>('buttress-db-service')!;

    parent.querySelector('section')!.appendChild(el);

    expect((el as any)._realtime.isOpen).to.equal(false);
  });
});

describe('ButtressDbService connect', () => {
  let originalFetch: typeof window.fetch;
  let resolveSchema: () => void;

  beforeEach(() => {
    originalFetch = window.fetch;
    // Holds the schema request open until the test resolves it, with an empty schema list.
    window.fetch = () =>
      new Promise<Response>((resolve) => {
        resolveSchema = () => resolve(new Response('[]', { status: 200 }));
      });
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  const connectWithStubbedRealtime = async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service endpoint="https://example.test" token="abc" api-path="app"></buttress-db-service>
    `);
    let realtimeConnects = 0;
    (el as any)._realtime.connect = () => {
      realtimeConnects += 1;
    };
    const connecting = el.connect();
    return { el, connecting, realtimeConnects: () => realtimeConnects };
  };

  it('opens the realtime socket once the schemas have loaded', async () => {
    const { connecting, realtimeConnects } = await connectWithStubbedRealtime();

    resolveSchema();
    await connecting;

    expect(realtimeConnects()).to.equal(1);
  });

  it('does not open the realtime socket if removed while the schemas load', async () => {
    const { el, connecting, realtimeConnects } = await connectWithStubbedRealtime();

    el.remove();
    resolveSchema();
    await connecting;

    expect(realtimeConnects()).to.equal(0);
  });

  it('opens the realtime socket when added back after being removed while the schemas load', async () => {
    const { el, connecting, realtimeConnects } = await connectWithStubbedRealtime();
    const parent = el.parentElement!;

    el.remove();
    resolveSchema();
    await connecting;
    parent.appendChild(el);

    expect(realtimeConnects()).to.equal(1);
  });
});

describe('ButtressDbService resync', () => {
  it('clears the query cache of every data service', async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service></buttress-db-service>
    `);
    const cleared: string[] = [];
    (el as any)._dataServices = {
      organisation: { clearQueryMap: () => cleared.push('organisation') },
      person: { clearQueryMap: () => cleared.push('person') },
    };

    (el as any)._dsStoreInterface.clearQueryMaps();

    expect(cleared).to.deep.equal(['organisation', 'person']);
  });
});

describe('ButtressDbService awaitConnection', () => {
  let originalFetch: typeof window.fetch;
  let status: number;

  // Reports whether a promise has settled within a short wait.
  const outcomeOf = (promise: Promise<unknown>) =>
    Promise.race([
      promise.then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise((resolve) => {
        setTimeout(() => resolve('pending'), 100);
      }),
    ]);

  beforeEach(() => {
    originalFetch = window.fetch;
    status = 500;
    // Answers the schema request with an empty schema list, or an error while status is 500.
    window.fetch = async () => new Response('[]', { status });
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  const connectable = async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service endpoint="https://example.test" token="abc" api-path="app"></buttress-db-service>
    `);
    (el as any)._realtime.connect = () => {};
    return el;
  };

  it('rejects when the schemas fail to load', async () => {
    const el = await connectable();

    const waiting = el.awaitConnection();
    await el.connect().catch(() => {});

    expect(await outcomeOf(waiting)).to.equal('rejected');
  });

  it('rejects when connect() is missing a setting', async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service></buttress-db-service>
    `);

    const waiting = el.awaitConnection();
    await el.connect().catch(() => {});

    expect(await outcomeOf(waiting)).to.equal('rejected');
  });

  it('waits for the next connect() when called after a failure', async () => {
    const el = await connectable();
    await el.connect().catch(() => {});

    const waiting = el.awaitConnection();
    status = 200;
    await el.connect();

    expect(await outcomeOf(waiting)).to.equal('resolved');
  });
});

describe('ButtressDbService schema names', () => {
  let originalFetch: typeof window.fetch;

  const schemas = [
    { name: 'users', type: 'collection', core: true, properties: {} },
    { name: 'activities', type: 'collection', core: true, properties: {} },
    { name: 'access', type: 'collection', core: true, properties: {} },
    { name: 'items', type: 'collection', properties: {} },
  ];

  beforeEach(() => {
    originalFetch = window.fetch;
    window.fetch = async () => new Response(JSON.stringify(schemas));
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  const connected = async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service endpoint="https://example.test" token="abc" api-path="app"></buttress-db-service>
    `);
    (el as any)._realtime.connect = () => {};
    await el.connect();
    return el;
  };

  it('uses the same local name for the schema and its data service', async () => {
    const el = await connected();

    for (const name of ['user', 'activity', 'acces', 'items']) {
      expect(el.getSchema(name), name).to.not.equal(false);
      expect(Boolean((el as any)._dataServices[name]), name).to.equal(true);
    }
    expect(Object.keys((el as any)._dataServices)).to.have.length(4);
  });

  it('routes a core schema whose name ends in ies', async () => {
    const el = await connected();

    expect((el as any)._dataServices.activity.getUrl()).to.equal('https://example.test/api/v1/activity/');
  });

  it('finds the local name for the name Buttress sends', async () => {
    const el = await connected();
    const { localName } = (el as any)._dsStoreInterface;

    expect(['users', 'activities', 'items', 'unknown'].map(localName)).to.deep.equal([
      'user',
      'activity',
      'items',
      undefined,
    ]);
  });
});
