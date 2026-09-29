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

import { expect, fixture, waitUntil } from '@open-wc/testing';
import { html, LitElement } from 'lit';
import { consume } from '@lit/context';

import '../../src/components/buttress-db-service.js';
import { ButtressDbService, WriteOpts } from '../../src/ButtressDbService.js';
import { buttressDbServiceContext } from '../../src/context.js';
import { ButtressError } from '../../src/ButtressClient.js';

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
    el.requestTimeout = 5000;

    // updateComplete resolves false if another update was requested during this one.
    expect(await el.updateComplete).to.equal(true);
    expect(el.getEndpoint()).to.equal('https://example.test');
    expect(el.getToken()).to.equal('abc');
    expect(el.getUserId()).to.equal('user-1');
    expect(el.getCoreSchemas()).to.deep.equal(['app']);
    expect((el as any)._settings.requestTimeout).to.equal(5000);
  });

  it('reads the request timeout, in milliseconds, from request-timeout', async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service request-timeout="5000"></buttress-db-service>
    `);

    expect((el as any)._settings.requestTimeout).to.equal(5000);
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

  // So realtime resyncs when it first connects after something was loaded.
  describe('whether anything has been loaded', () => {
    let originalFetch: typeof window.fetch;

    beforeEach(() => {
      originalFetch = window.fetch;
      window.fetch = async (input: RequestInfo | URL) => {
        const { pathname } = new URL(input.toString());
        if (pathname.endsWith('/app/schema')) {
          return new Response(JSON.stringify([{ name: 'organisation', type: 'collection', properties: {} }]));
        }
        return new Response(pathname.endsWith('/count') ? '0' : '[]');
      };
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
    const hasLoaded = (el: ButtressDbService) => (el as any)._dsStoreInterface.hasLoaded();

    it('is false before anything is loaded', async () => {
      expect(hasLoaded(await connected())).to.equal(false);
    });

    it('is true after a query, even one that found nothing', async () => {
      const el = await connected();

      await el.query('organisation', {});

      expect(hasLoaded(el)).to.equal(true);
    });

    it('is true with an entity in the store', async () => {
      const el = await connected();

      el.create('organisation', { id: 'x' }, { localOnly: true });

      expect(hasLoaded(el)).to.equal(true);
    });
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

describe('ButtressDbService requests', () => {
  let originalFetch: typeof window.fetch;
  let sent: { url: URL; init: RequestInit }[];
  let respond: () => Response;

  beforeEach(() => {
    originalFetch = window.fetch;
    sent = [];
    respond = () => new Response('[]');
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: new URL(input.toString()), init: init! });
      return respond();
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  const element = () =>
    fixture<ButtressDbService>(html`
      <buttress-db-service
        endpoint="https://example.test"
        token="abc"
        api-path="app"
        core-schema='["users"]'
      ></buttress-db-service>
    `);

  it('asks for the core schemas in the query string', async () => {
    const el = await element();
    (el as any)._realtime.connect = () => {};

    await el.connect();

    expect(sent[0].url.searchParams.get('core')).to.equal('users');
  });

  it('sends apiPath in the query string and the session id with admin requests', async () => {
    const el = await element();
    respond = () => new Response('{}', { status: 201 });

    expect(await el.addSchema('other-app', [])).to.equal(true);

    const { url, init } = sent[0];
    expect(url.searchParams.get('apiPath')).to.equal('other-app');
    expect((init.headers as Record<string, string>)['x-client-session-id']).to.be.a('string');
  });

  it('rejects admin requests with the ButtressError', async () => {
    const el = await element();
    respond = () => new Response('{"message":"nope"}', { status: 400 });

    const err = await el.addSchema('other-app', []).catch((e) => e);

    expect(err).to.be.instanceOf(ButtressError);
    expect(err.serverMessage).to.equal('nope');
  });
});

describe('ButtressDbService wait', () => {
  let originalFetch: typeof window.fetch;
  let status: number;
  let holdWrites: Promise<void> | undefined;
  let writes: number;

  const schemas = [
    {
      name: 'organisation',
      type: 'collection',
      properties: { name: { __type: 'string' }, tags: { __type: 'array' } },
    },
  ];

  beforeEach(() => {
    originalFetch = window.fetch;
    status = 200;
    holdWrites = undefined;
    writes = 0;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = new URL(input.toString());
      if (pathname.endsWith('/app/schema')) return new Response(JSON.stringify(schemas));
      writes += 1;
      await holdWrites;
      // As Buttress does, a bulk update is answered for each update in it.
      if (status === 200 && pathname.endsWith('/bulk/update')) {
        return new Response(JSON.stringify(JSON.parse(init!.body as string).map(() => ({ results: [] }))));
      }
      return new Response(status === 200 ? '{}' : '{"message":"nope"}', { status });
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  // A connected element with organisation x in its store.
  const connected = async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service endpoint="https://example.test" token="abc" api-path="app" log-disable></buttress-db-service>
    `);
    (el as any)._realtime.connect = () => {};
    await el.connect();
    el.create('organisation', { id: 'x', name: 'a', tags: ['a', 'b'] }, { localOnly: true });
    return el;
  };

  const outcomeOf = (value: unknown) =>
    Promise.race([
      Promise.resolve(value).then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise((resolve) => {
        setTimeout(() => resolve('pending'), 50);
      }),
    ]);

  it('returns the same values as before without wait', async () => {
    const el = await connected();

    expect(el.set('organisation.x.name', 'b')).to.equal('organisation.x.name');
    expect(el.pushWith('organisation.x.tags', {}, 'c')).to.equal(3);
    expect(el.spliceWith('organisation.x.tags', 0, 1, {})).to.deep.equal(['a']);
    expect(el.create('organisation', { id: 'y', name: 'y' })).to.equal('organisation.y');
    expect(el.delete('organisation.y')).to.equal(true);
  });

  it('resolves with wait once Buttress has accepted the write', async () => {
    const el = await connected();
    let release!: () => void;
    holdWrites = new Promise((resolve) => {
      release = resolve;
    });

    const setting = el.set('organisation.x.name', 'b', { wait: true });

    expect(el.get('organisation.x.name')).to.equal('b');
    expect(await outcomeOf(setting)).to.equal('pending');
    release();
    expect(await setting).to.equal('organisation.x.name');
  });

  it('resolves each write with wait to the value it returns without it', async () => {
    const el = await connected();

    expect(await el.create('organisation', { id: 'y', name: 'y' }, { wait: true })).to.equal('organisation.y');
    expect(await el.pushWith('organisation.x.tags', { wait: true }, 'c')).to.equal(3);
    expect(await el.spliceWith('organisation.x.tags', 0, 1, { wait: true })).to.deep.equal(['a']);
    expect(await el.delete('organisation.y', { wait: true })).to.equal(true);
    expect(writes).to.equal(4);
  });

  it('types the result as a promise only with wait', async () => {
    const el = await connected();
    const maybe: WriteOpts = { wait: false };

    // Checked by tsc: each assignment fails to compile if the overloads give the wrong type.
    const path: string | undefined = el.set('organisation.x.name', 'b');
    const waited: Promise<string | undefined> = el.set('organisation.x.name', 'c', { wait: true });
    const either: string | undefined | Promise<string | undefined> = el.set('organisation.x.name', 'd', maybe);
    const length: number = el.pushWith('organisation.x.tags', {}, 'c');
    const removed: Promise<unknown[]> = el.spliceWith('organisation.x.tags', 0, 1, { wait: true });

    expect([path, await waited, await either, length, await removed]).to.have.length(5);
  });

  it('rejects with wait when Buttress rejects the write', async () => {
    const el = await connected();
    const originalError = console.error;
    console.error = () => {};
    status = 400;

    const err = await el.set('organisation.x.name', 'b', { wait: true }).catch((e: unknown) => e);
    console.error = originalError;

    expect(err).to.be.instanceOf(ButtressError);
  });

  it('resolves straight away with wait for a write that is not sent', async () => {
    const el = await connected();

    expect(await el.set('organisation.x.name', 'b', { wait: true, localOnly: true })).to.equal('organisation.x.name');
    expect(writes).to.equal(0);
  });

  it('still throws straight away for an invalid call with wait', async () => {
    const el = await connected();

    expect(() => el.create('organisation.x', { id: 'z' }, { wait: true })).to.throw();
  });

  it('still calls dboComplete with wait', async () => {
    const el = await connected();
    let called = false;

    await el.set('organisation.x.name', 'b', {
      wait: true,
      dboComplete: {
        resolve: () => {
          called = true;
        },
        reject: () => {},
      },
    });

    expect(called).to.equal(true);
  });

  // The callback's error isn't swallowed: it reaches the page as an unhandled rejection, recorded here. The test runner
  // reports those with console.error, as the queue reports a rejected write, so that's silenced meanwhile.
  describe('with a dboComplete callback that throws', () => {
    let uncaught: unknown[];
    let originalError: typeof console.error;
    const onRejection = (event: PromiseRejectionEvent) => {
      uncaught.push(event.reason);
    };
    const throwing = () => {
      throw new Error('callback failed');
    };
    const uncaughtMessages = async () => {
      await waitUntil(() => uncaught.length > 0, 'no unhandled rejection');
      return uncaught.map((err) => (err as Error).message);
    };

    beforeEach(() => {
      uncaught = [];
      window.addEventListener('unhandledrejection', onRejection);
      originalError = console.error;
      console.error = () => {};
    });

    afterEach(() => {
      window.removeEventListener('unhandledrejection', onRejection);
      console.error = originalError;
    });

    it('still resolves with wait once Buttress accepts the write', async () => {
      const el = await connected();

      const setting = el.set('organisation.x.name', 'b', {
        wait: true,
        dboComplete: { resolve: throwing, reject: () => {} },
      });

      expect(await outcomeOf(setting)).to.equal('resolved');
      expect(await uncaughtMessages()).to.deep.equal(['callback failed']);
    });

    it('still rejects with wait when Buttress rejects the write', async () => {
      const el = await connected();
      status = 400;

      const setting = el.set('organisation.x.name', 'b', {
        wait: true,
        dboComplete: { resolve: () => {}, reject: throwing },
      });

      expect(await outcomeOf(setting)).to.equal('rejected');
      expect(await uncaughtMessages()).to.deep.equal(['callback failed']);
    });
  });

  it('still calls dboComplete.reject with wait when Buttress rejects the write', async () => {
    const el = await connected();
    const originalError = console.error;
    console.error = () => {};
    status = 400;
    let rejected: unknown;

    await el
      .set('organisation.x.name', 'b', {
        wait: true,
        dboComplete: {
          resolve: () => {},
          reject: (err) => {
            rejected = err;
          },
        },
      })
      .catch(() => {});
    console.error = originalError;

    expect(rejected).to.be.instanceOf(ButtressError);
  });
});

// Writes waiting at the same time go to Buttress as one bulk request, which it answers for each write.
describe('ButtressDbService bundled writes', () => {
  let originalFetch: typeof window.fetch;
  let originalError: typeof console.error;
  let release: () => void;
  let writes: number;

  const schemas = [
    {
      name: 'organisation',
      type: 'collection',
      properties: { name: { __type: 'string' }, status: { __type: 'string' } },
    },
  ];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  beforeEach(() => {
    originalFetch = window.fetch;
    originalError = console.error;
    // The queue logs each refused write.
    console.error = () => {};
    writes = 0;
    // Pretends to be Buttress: refuses a status of 'invalid', and a create without a name.
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = new URL(input.toString()).pathname.replace(/^(\/app)?\/api\/v1\//, '');
      if (route === 'app/schema') return json(schemas);
      writes += 1;
      // Holds the first write, so the ones after it wait and are bundled.
      if (writes === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      const body = JSON.parse(init!.body as string);
      if (route === 'organisation/bulk/update') {
        return json(
          body.map((u: { id: string; body: { value: unknown } }) =>
            u.body.value === 'invalid'
              ? { id: u.id, results: null, validation: { code: 400, message: 'organisation: Invalid value: status' } }
              : { id: u.id, results: [u.body] },
          ),
        );
      }
      if (route === 'organisation/bulk/add') {
        const invalid = body.findIndex((entity: { name: string }) => !entity.name);
        if (invalid !== -1) return json({ message: `organisation: Missing field: name at index ${invalid}` }, 400);
      }
      if (route === 'organisation/' && !body.name) return json({ message: 'organisation: Missing field: name' }, 400);
      return json(body);
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
    console.error = originalError;
  });

  const connected = async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service endpoint="https://example.test" token="abc" api-path="app" log-disable></buttress-db-service>
    `);
    (el as any)._realtime.connect = () => {};
    await el.connect();
    el.create('organisation', { id: 'x', name: 'a', status: 'new' }, { localOnly: true });
    el.create('organisation', { id: 'y', name: 'b', status: 'new' }, { localOnly: true });
    return el;
  };
  const outcome = (write: Promise<unknown>) =>
    write.then(
      () => 'resolved',
      (err: ButtressError) => `${err.status} ${err.serverMessage}`,
    );

  it('rejects, with wait, only the update in a bundle that Buttress refused', async () => {
    const el = await connected();

    const outcomes = [
      el.set('organisation.x.name', 'first', { wait: true }),
      el.set('organisation.x.status', 'invalid', { wait: true }),
      el.set('organisation.y.name', 'c', { wait: true }),
    ].map(outcome);
    release();

    expect(await Promise.all(outcomes)).to.deep.equal([
      'resolved',
      '400 organisation: Invalid value: status',
      'resolved',
    ]);
  });

  it('saves, with wait, the valid creates in a bulk add that Buttress refused, and rejects the invalid one', async () => {
    const el = await connected();

    const outcomes = [
      el.set('organisation.x.name', 'first', { wait: true }),
      el.create('organisation', { id: 'a1', name: 'A' }, { wait: true }),
      el.create('organisation', { id: 'b1', name: '' }, { wait: true }),
      el.create('organisation', { id: 'c1', name: 'C' }, { wait: true }),
    ].map(outcome);
    release();

    expect(await Promise.all(outcomes)).to.deep.equal([
      'resolved',
      'resolved',
      '400 organisation: Missing field: name',
      'resolved',
    ]);
  });
});

// get(), query results and getById() hand out the store's own objects, which an app can change in place. So a set works
// out what to send from what Buttress has, not from the object in the store.
describe('ButtressDbService set of an entity from the store', () => {
  type Sent = { method: string; path: string; body: unknown };
  type BulkUpdate = { id: string; body: unknown }[];

  let originalFetch: typeof window.fetch;
  let originalError: typeof console.error;
  let sent: Sent[];
  let status: number;

  const schemas = [
    {
      name: 'organisation',
      type: 'collection',
      properties: {
        name: { __type: 'string' },
        status: { __type: 'string' },
        tags: { __type: 'array' },
        address: { city: { __type: 'string' }, street: { __type: 'string' } },
      },
    },
  ];
  const stored = { id: 'x', name: 'a', status: 'new', tags: ['a', 'b'], address: { city: 'Leeds', street: 'High St' } };
  const path = 'organisation.x';

  beforeEach(() => {
    originalFetch = window.fetch;
    originalError = console.error;
    sent = [];
    status = 200;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = new URL(input.toString()).pathname.replace('/api/v1/', '');
      if (route === 'app/schema') return new Response(JSON.stringify(schemas));
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      sent.push({ method: init!.method!, path: route, body });
      if (route.endsWith('/count')) return new Response('1');
      if (init?.method === 'SEARCH') return new Response(JSON.stringify([stored]));
      if (route.endsWith('/bulk/update')) {
        return new Response(JSON.stringify((body as BulkUpdate).map((u) => ({ id: u.id, results: [u.body] }))));
      }
      return new Response(status === 200 ? '{}' : '{"message":"nope"}', { status });
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
    console.error = originalError;
  });

  // A connected element with organisation x loaded by a query.
  const loaded = async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service endpoint="https://example.test" token="abc" api-path="app" log-disable></buttress-db-service>
    `);
    (el as any)._realtime.connect = () => {};
    await el.connect();
    const { results } = await el.query('organisation', {});
    sent = [];
    return { el, entity: results[0] };
  };

  // The { path, value } of each update sent, bundled or not.
  const updates = () =>
    sent.flatMap((r) => {
      if (r.method === 'PUT') return [r.body];
      if (r.path.endsWith('/bulk/update')) return (r.body as BulkUpdate).map((u) => u.body);
      return [];
    });

  it('sends a nested edit made to a copy of the entity', async () => {
    const { el } = await loaded();

    const copy = { ...el.get(path)! };
    copy.address.city = 'York';
    await el.set(path, copy, { wait: true });

    expect(updates()).to.deep.equal([{ path: 'address.city', value: 'York' }]);
  });

  it('sends an edit made to the entity in place, and notifies subscribers', async () => {
    const { el, entity } = await loaded();
    const names: unknown[] = [];
    el.subscribe(`${path}.name`, (cr: { value: unknown }) => names.push(cr.value));

    entity.name = 'b';
    await el.set(path, entity, { wait: true });

    expect(updates()).to.deep.equal([{ path: 'name', value: 'b' }]);
    expect(names).to.deep.equal(['b']);
  });

  it('sends an edit made to an array in place, and notifies subscribers', async () => {
    const { el, entity } = await loaded();
    const lengths: unknown[] = [];
    el.subscribe(`${path}.tags`, (cr: { value: unknown[] }) => lengths.push(cr.value.length));

    entity.tags.push('c');
    await el.set(`${path}.tags`, entity.tags, { wait: true });

    expect(updates()).to.deep.equal([{ path: 'tags', value: ['a', 'b', 'c'] }]);
    expect(lengths).to.deep.equal([3]);
  });

  it('sets the properties a whole-entity set leaves out to null', async () => {
    const { el } = await loaded();

    await el.set(path, { id: 'x', name: 'b', tags: ['a', 'b'] }, { wait: true });

    expect(updates()).to.deep.equal([
      { path: 'name', value: 'b' },
      { path: 'status', value: null },
      { path: 'address', value: null },
    ]);
  });

  it('sets the properties a nested object set leaves out to null', async () => {
    const { el } = await loaded();

    await el.set(`${path}.address`, { city: 'York' }, { wait: true });

    expect(updates()).to.deep.equal([
      { path: 'address.city', value: 'York' },
      { path: 'address.street', value: null },
    ]);
  });

  it('sets a property set to undefined to null', async () => {
    const { el, entity } = await loaded();

    await el.set(path, { ...entity, status: undefined }, { wait: true });
    await el.set(`${path}.name`, undefined, { wait: true });

    expect(updates()).to.deep.equal([
      { path: 'status', value: null },
      { path: 'name', value: null },
    ]);
  });

  it('does not send again what a realtime update brought', async () => {
    const { el } = await loaded();
    (el as any)._realtime._parsePayload({
      schemaName: 'organisation',
      verb: 'put',
      path: 'organisation/x',
      pathSpec: 'organisation/:id',
      response: { type: 'scalar', path: 'name', value: 'from elsewhere' },
    });

    await el.set(path, { ...el.get(path)!, status: 'done' }, { wait: true });

    expect(updates()).to.deep.equal([{ path: 'status', value: 'done' }]);
  });

  it('sends a value again after Buttress refused it', async () => {
    const { el } = await loaded();
    console.error = () => {};
    status = 400;
    await el.set(`${path}.name`, 'b', { wait: true }).catch(() => {});

    status = 200;
    await el.set(`${path}.name`, 'b', { wait: true });

    expect(updates()).to.deep.equal([
      { path: 'name', value: 'b' },
      { path: 'name', value: 'b' },
    ]);
  });

  it('does not send again what it has already sent', async () => {
    const { el, entity } = await loaded();

    entity.name = 'b';
    await el.set(path, entity, { wait: true });
    await el.set(path, entity, { wait: true });
    await el.set(`${path}.name`, 'b', { wait: true });

    expect(updates()).to.deep.equal([{ path: 'name', value: 'b' }]);
  });
});

describe('ButtressDbService API', () => {
  let originalFetch: typeof window.fetch;
  let sent: { method: string; path: string; apiPath: string | null; body: unknown }[];
  let schemas: object[];
  let respond: (path: string) => unknown;

  const organisation = {
    name: 'organisation',
    type: 'collection',
    properties: { name: { __type: 'string' }, tags: { __type: 'array' } },
  };

  beforeEach(() => {
    originalFetch = window.fetch;
    sent = [];
    schemas = [organisation];
    respond = () => ({});
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      const path = url.pathname.replace('/api/v1/', '');
      if (path === 'app/schema') return new Response(JSON.stringify(schemas));
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      sent.push({ method: init!.method!, path, apiPath: url.searchParams.get('apiPath'), body });
      return new Response(JSON.stringify(respond(path)));
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  const element = async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service endpoint="https://example.test" token="abc" api-path="app" log-disable></buttress-db-service>
    `);
    (el as any)._realtime.connect = () => {};
    return el;
  };

  // A connected element with organisation x in its store.
  const connected = async () => {
    const el = await element();
    await el.connect();
    el.create('organisation', { id: 'x', name: 'a', tags: ['a', 'b'] }, { localOnly: true });
    return el;
  };

  it('reports whether it is connected', async () => {
    const el = await element();

    expect(el.isDbConnected()).to.equal(false);
    await el.connect();
    expect(el.isDbConnected()).to.equal(true);
  });

  it('resolves awaitConnection straight away once connected', async () => {
    const el = await connected();

    expect(await el.awaitConnection()).to.equal(true);
  });

  it('names the missing setting when connect() is missing the token or apiPath', async () => {
    const noToken = await fixture<ButtressDbService>(html`
      <buttress-db-service endpoint="https://example.test"></buttress-db-service>
    `);
    const noApiPath = await fixture<ButtressDbService>(html`
      <buttress-db-service endpoint="https://example.test" token="abc"></buttress-db-service>
    `);

    expect(((await noToken.connect().catch((e: Error) => e)) as Error).message).to.match(/'token'/);
    expect(((await noApiPath.connect().catch((e: Error) => e)) as Error).message).to.match(/'apiPath'/);
  });

  it('connects without being in the document, and opens the realtime socket', async () => {
    const el = document.createElement('buttress-db-service') as ButtressDbService;
    let realtimeConnects = 0;
    (el as any)._realtime.connect = () => {
      realtimeConnects += 1;
    };
    el.setEndpoint('https://example.test');
    el.setToken('abc');
    await el.setApiPath('app');

    await el.connect();

    expect(el.getSchema('organisation')).to.not.equal(false);
    expect(realtimeConnects).to.equal(1);
  });

  it('keeps data services on a second connect, and drops those whose schema has gone', async () => {
    const el = await connected();
    const before = (el as any)._dataServices.organisation;
    schemas = [
      { ...organisation, properties: { links: { __type: 'array' } } },
      { ...organisation, name: 'person' },
    ];
    await el.connect();
    expect((el as any)._dataServices.organisation).to.equal(before);
    expect(el.pushWith('organisation.x.links', { localOnly: true }, 'a')).to.equal(1);

    schemas = [{ ...organisation, name: 'person' }];
    await el.connect();

    expect(Object.keys((el as any)._dataServices)).to.deep.equal(['person']);
  });

  it('logs the error when the realtime socket cannot be reopened after a move', async () => {
    const parent = await fixture<HTMLDivElement>(html`
      <div>
        <buttress-db-service log-disable></buttress-db-service>
        <section></section>
      </div>
    `);
    const el = parent.querySelector<ButtressDbService>('buttress-db-service')!;
    const realtime = (el as any)._realtime;
    realtime.disconnect = () => {};
    Object.defineProperty(realtime, 'isOpen', { get: () => true });
    realtime.connect = () => {
      throw new Error('no socket');
    };
    const originalError = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => logged.push(args);

    parent.querySelector('section')!.appendChild(el);
    console.error = originalError;

    expect(logged).to.have.length(1);
  });

  it('finds no local name before the schemas have loaded', async () => {
    const el = await element();

    expect((el as any)._dsStoreInterface.localName('organisation')).to.equal(undefined);
  });

  it('returns false from getSchema for a schema it does not have', async () => {
    const el = await element();

    expect(el.getSchema('organisation')).to.equal(false);
    await el.connect();
    expect(el.getSchema(undefined)).to.equal(false);
    expect(el.getSchema('unknown')).to.equal(false);
  });

  it('pushes and splices without options', async () => {
    const el = await connected();

    expect(el.push('organisation.x.tags', 'c')).to.equal(3);
    expect(el.splice('organisation.x.tags', 0, 1)).to.deep.equal(['a']);
    await el.nextIdle('organisation');

    expect(el.get('organisation.x.tags')).to.deep.equal(['b', 'c']);
    expect(sent.map((r) => r.method)).to.deep.equal(['PUT', 'PUT']);
  });

  it('passes notifyPath through to the data service', async () => {
    const el = await connected();

    expect((el as any)._dsStoreInterface.notifyPath('organisation.x.name', 'b')).to.equal(true);
  });

  it('only deletes top-level entities', async () => {
    const el = await connected();

    expect(() => el.delete('organisation.x.name')).to.throw('Delete is only avaible for top level entities');
  });

  it('throws for a path with no data service', async () => {
    const el = await connected();

    expect(() => el.get('unknown.x')).to.throw('Unable to find data service with path part unknown');
  });

  it('calls subscribers until they unsubscribe', async () => {
    const el = await connected();
    const values: unknown[] = [];
    const id = el.subscribe('organisation.x.name', (cr: { value: unknown }) => values.push(cr.value));

    el.set('organisation.x.name', 'b', { localOnly: true });
    await el.nextIdle('organisation');
    expect(el.unsubscribe(id)).to.equal(true);
    el.set('organisation.x.name', 'c', { localOnly: true });
    await el.nextIdle('organisation');

    expect(values).to.deep.equal(['b']);
    expect(el.unsubscribe(id)).to.equal(false);
  });

  describe('an entity held from a query', () => {
    const held = async (el: ButtressDbService) => {
      respond = (path) => (path.endsWith('/count') ? 1 : [{ id: 'x', name: 'a' }]);
      const { results } = await el.query('organisation', { name: { $eq: 'a' } });
      return results[0];
    };

    it('is still the entity in the store after a later search returns it, with the fresh values', async () => {
      const el = await connected();
      const entity = await held(el);
      // Partial, as a projected search returns them, and twice.
      respond = (path) =>
        path.endsWith('/count')
          ? 1
          : [
              { id: 'x', name: 'b' },
              { id: 'x', status: 'new' },
            ];

      const { results } = await el.query('organisation', {});
      el.set('organisation.x.name', 'c', { localOnly: true });

      expect(results[0]).to.equal(entity);
      expect(el.get('organisation.x')).to.equal(entity);
      expect(entity).to.deep.equal({ id: 'x', name: 'c', tags: ['a', 'b'], status: 'new' });
    });

    it('is still the entity in the store after a realtime post for it, with the fresh values', async () => {
      const el = await connected();
      const entity = await held(el);
      const notified: unknown[] = [];
      el.subscribe('organisation.x', (cr: unknown) => notified.push(cr));

      (el as any)._realtime._handlePost('organisation', { id: 'x', name: 'b' });
      await el.nextIdle('organisation');

      expect(el.get('organisation.x')).to.equal(entity);
      expect(entity).to.deep.equal({ id: 'x', name: 'b', tags: ['a', 'b'] });
      expect(notified).to.deep.equal([{ value: entity, opts: { localOnly: true, forceChanged: true } }]);
    });
  });

  it('notifies subscribers, and sends the change, for a set of an entity changed in place', async () => {
    const el = await connected();
    const entity = el.get('organisation.x')!;
    const values: unknown[] = [];
    el.subscribe('organisation.x.name', (cr: { value: unknown }) => values.push(cr.value));

    entity.name = 'b';
    el.set('organisation.x', entity);
    await el.nextIdle('organisation');

    expect(values).to.deep.equal(['b']);
    expect(sent.map(({ method, body }) => ({ method, body }))).to.deep.equal([
      { method: 'PUT', body: { path: 'name', value: 'b' } },
    ]);
  });

  it('creates a blank object from a schema', async () => {
    const el = await connected();

    expect(el.createObject('organisation')).to.include({ name: '' });
    expect(() => el.createObject('unknown')).to.throw('Unable to find schema for path unknown');
  });

  it('gets an entity by id', async () => {
    const el = await connected();
    respond = (path) => ({ id: path.split('/').pop(), name: 'y' });

    expect(await el.getById('organisation', 'y')).to.deep.equal({ id: 'y', name: 'y' });
    expect(((await el.getById('organisation', '').catch((e: Error) => e)) as Error).message).to.equal(
      'Unable to get property without an id',
    );
    expect(await el.getById('unknown', 'y').catch((e: Error) => e)).to.be.instanceOf(Error);
  });

  it('fetches an entity when realtime asks it to', async () => {
    const el = await connected();
    respond = (path) => ({ id: path.split('/').pop(), name: 'y' });

    await (el as any)._realtime._loadById({ schemaName: 'organisation', id: 'y' });

    expect(el.get('organisation.y')).to.deep.equal({ id: 'y', name: 'y' });
  });

  it('queries and counts through the data service', async () => {
    const el = await connected();
    respond = (path) => (path.endsWith('/count') ? 1 : [{ id: 'x', name: 'a' }]);

    expect((await el.query('organisation', { name: { $eq: 'a' } })).total).to.equal(1);
    expect(await el.count('organisation', {})).to.equal(1);
    expect(await el.query('unknown', {}).catch((e: Error) => e)).to.be.instanceOf(Error);
    expect(await el.count('unknown', {}).catch((e: Error) => e)).to.be.instanceOf(Error);
  });

  it('finds the data service for a path', async () => {
    const el = await connected();

    expect(el._resolveDataServiceFromPath('organisation.x')?.name).to.equal('organisation');
    expect(el._resolveDataServiceFromPath('unknown.x')).to.equal(undefined);
  });

  it('sends each admin request to the API path it is given', async () => {
    const el = await element();
    respond = () => ({ remoteAppToken: 'remote' });
    const lambda = { id: 'l1', git: { branch: 'main', hash: 'abc' } };

    expect(await el.addLambda(lambda, { auth: true }, 'other')).to.equal(true);
    expect(await el.deployLambda(lambda, 'other')).to.equal(true);
    expect(await el.addDataSharing({ id: 'ds1' }, 'other')).to.equal('remote');
    expect(await el.updateAppPolicySelectors('other', { role: 'x' })).to.equal(true);
    expect(await el.activateDataSharing('ds1', 'other', 'token')).to.equal(true);

    expect(sent).to.deep.equal([
      { method: 'POST', path: 'lambda', apiPath: 'other', body: { lambda, auth: { auth: true } } },
      { method: 'PUT', path: 'lambda/l1/deployment', apiPath: 'other', body: { branch: 'main', hash: 'abc' } },
      { method: 'POST', path: 'app-data-sharing', apiPath: 'other', body: { id: 'ds1' } },
      { method: 'PUT', path: 'app/policy-property-list', apiPath: 'other', body: { role: 'x' } },
      { method: 'PUT', path: 'app-data-sharing/ds1/token', apiPath: 'other', body: { token: 'token' } },
    ]);
  });

  it('throws from an admin request without an endpoint', async () => {
    const el = await fixture<ButtressDbService>(html`
      <buttress-db-service></buttress-db-service>
    `);

    expect(((await el.addSchema('other', []).catch((e: Error) => e)) as Error).message).to.equal(
      "Missing setting 'endpoint' while sending PUT app/schema",
    );
  });
});
