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

import ButtressRealtime from '../../src/ButtressRealtime.js';
import { buildSettings } from '../../src/helpers.js';

describe('ButtressRealtime', () => {
  it('closes the socket on disconnect', () => {
    const settings = buildSettings({});
    settings.endpoint = 'http://127.0.0.1:1';
    settings.token = 'abc';
    const realtime = new ButtressRealtime(
      {} as any,
      settings,
      () => {},
      () => {},
    );

    expect(realtime.isOpen).to.equal(false);
    realtime.connect();
    const socket = (realtime as any)._socket;
    expect(socket.active).to.equal(true);
    expect(realtime.isOpen).to.equal(true);

    realtime.disconnect();

    expect(socket.active).to.equal(false);
    expect(realtime.isOpen).to.equal(false);
    expect((realtime as any)._socket).to.equal(null);
  });

  it('closes the previous socket when connect is called again', () => {
    const settings = buildSettings({});
    settings.endpoint = 'http://127.0.0.1:1';
    settings.token = 'abc';
    const realtime = new ButtressRealtime(
      {} as any,
      settings,
      () => {},
      () => {},
    );

    realtime.connect();
    const first = (realtime as any)._socket;
    realtime.connect();
    const second = (realtime as any)._socket;

    expect(first.active).to.equal(false);
    expect(second.active).to.equal(true);

    realtime.disconnect();
  });

  it('does nothing on disconnect before connect', () => {
    const realtime = new ButtressRealtime(
      {} as any,
      buildSettings({}),
      () => {},
      () => {},
    );

    expect(() => realtime.disconnect()).to.not.throw();
  });

  it('creates entities that are new to the store', () => {
    const created: unknown[][] = [];
    const store = {
      get: () => undefined,
      create: (...args: unknown[]) => created.push(args),
    };
    const realtime = new ButtressRealtime(
      store as any,
      buildSettings({}),
      () => {},
      () => {},
    );

    (realtime as any)._handlePost('organisation', { id: 'org1', name: 'New' });

    expect(created).to.deep.equal([['organisation', { id: 'org1', name: 'New' }, { localOnly: true }]]);
  });

  describe('resync', () => {
    const setup = () => {
      const calls: string[] = [];
      const store = { clearQueryMaps: () => calls.push('clearQueryMaps') };
      const settings = buildSettings({});
      settings.endpoint = 'http://127.0.0.1:1';
      settings.token = 'abc';
      const realtime = new ButtressRealtime(
        store as any,
        settings,
        (type: string) => calls.push(type),
        () => {},
      );
      const connected = () => (realtime as any)._onConnected();
      return { realtime, calls, connected, resyncs: () => calls.filter((c) => c === 'bjs-resync').length };
    };

    it('does not resync on the first connection', () => {
      const { realtime, connected, resyncs } = setup();

      realtime.connect();
      connected();

      expect(resyncs()).to.equal(0);
      realtime.disconnect();
    });

    it('clears the query caches, then dispatches bjs-resync, on a reconnection', () => {
      const { realtime, calls, connected, resyncs } = setup();
      realtime.connect();
      connected();

      calls.length = 0;
      connected();

      expect(resyncs()).to.equal(1);
      expect(calls.indexOf('clearQueryMaps')).to.be.lessThan(calls.indexOf('bjs-resync'));
      realtime.disconnect();
    });

    it('resyncs when a new socket connects after the old one was closed', () => {
      const { realtime, connected, resyncs } = setup();
      realtime.connect();
      connected();
      realtime.disconnect();

      realtime.connect();
      connected();

      expect(resyncs()).to.equal(1);
      realtime.disconnect();
    });
  });

  it('names the token when the token is missing', () => {
    const settings = buildSettings({});
    settings.endpoint = 'http://127.0.0.1:1';
    const realtime = new ButtressRealtime(
      {} as any,
      settings,
      () => {},
      () => {},
    );

    expect(() => realtime.connect()).to.throw(/'token'/);
  });

  describe('db-activity', () => {
    const setup = () => {
      const settings = buildSettings({});
      const realtime = new ButtressRealtime(
        {} as any,
        settings,
        () => {},
        () => {},
      );
      const applied: unknown[] = [];
      (realtime as any)._parsePayload = (data: unknown) => applied.push(data);
      const receive = (data: object) => (realtime as any)._handleRxEvent('db-activity', { time: '', data });
      return { settings, applied, receive };
    };

    it('skips updates from its own session', () => {
      const { settings, applied, receive } = setup();

      receive({ clientSessionId: settings.clientSessionId, isSameApp: true });

      expect(applied.length).to.equal(0);
    });

    it('applies updates from another session', () => {
      const { applied, receive } = setup();

      receive({ clientSessionId: 'someone-else' });

      expect(applied.length).to.equal(1);
    });

    it('applies updates shared from another app, whatever their session id', () => {
      const { settings, applied, receive } = setup();

      receive({ clientSessionId: settings.clientSessionId, isSameApp: false });

      expect(applied.length).to.equal(1);
    });
  });

  describe('schema names', () => {
    const setup = () => {
      const created: unknown[][] = [];
      const store = {
        localName: (name: string) => ({ users: 'user' })[name],
        get: () => undefined,
        create: (...args: unknown[]) => created.push(args),
      };
      const realtime = new ButtressRealtime(
        store as any,
        buildSettings({}),
        () => {},
        () => {},
      );
      const post = (schemaName: string) =>
        (realtime as any)._parsePayload({
          schemaName,
          verb: 'post',
          path: 'user',
          pathSpec: 'user',
          response: { id: 'u1' },
        });
      return { created, post };
    };

    it('applies updates to a core schema under its local name', () => {
      const { created, post } = setup();

      post('users');

      expect(created).to.deep.equal([['user', { id: 'u1' }, { localOnly: true }]]);
    });

    it('skips updates for a schema it has not loaded', () => {
      const { created, post } = setup();

      expect(() => post('unknown')).to.not.throw();
      expect(created).to.deep.equal([]);
    });
  });

  it('names the endpoint when the endpoint is missing', () => {
    const realtime = new ButtressRealtime(
      {} as any,
      buildSettings({ token: 'abc' }),
      () => {},
      () => {},
    );

    expect(() => realtime.connect()).to.throw(/'endpoint'/);
  });

  it("connects to the app's namespace when apiPath is set", () => {
    const realtime = new ButtressRealtime(
      {} as any,
      buildSettings({ endpoint: 'http://127.0.0.1:1', token: 'abc', apiPath: 'app' }),
      () => {},
      () => {},
    );

    realtime.connect();

    expect((realtime as any)._socket.nsp).to.equal('/app');
    realtime.disconnect();
  });

  describe('connection events', () => {
    const setup = () => {
      const events: { type: string; detail: unknown }[] = [];
      const realtime = new ButtressRealtime(
        {} as any,
        buildSettings({ endpoint: 'http://127.0.0.1:1', token: 'abc' }),
        (type: string, init: CustomEventInit) => events.push({ type, detail: init.detail }),
        () => {},
      );
      return { realtime, events };
    };

    it('dispatches bjs-connection-changed with false when the socket disconnects', () => {
      const { realtime, events } = setup();
      realtime.connect();
      events.length = 0;

      (realtime as any)._onDisconnected();

      expect(events).to.deep.equal([{ type: 'bjs-connection-changed', detail: false }]);
      realtime.disconnect();
    });

    it('reports a disconnection, and logs the error, when the socket cannot be set up', () => {
      const { realtime, events } = setup();
      const originalError = console.error;
      const logged: unknown[] = [];
      console.error = (...args: unknown[]) => logged.push(args);
      (realtime as any)._configureRxEvents = () => {
        throw new Error('broken');
      };

      realtime.connect();
      console.error = originalError;

      expect(events).to.deep.equal([
        { type: 'bjs-connection-changed', detail: true },
        { type: 'bjs-connection-changed', detail: false },
      ]);
      expect(logged).to.have.length(1);
      realtime.disconnect();
    });
  });

  // Applies db-activity payloads to a fake store that holds organisation x, and records what it's asked to do.
  describe('payloads', () => {
    let originalWarn: typeof console.warn;

    beforeEach(() => {
      originalWarn = console.warn;
      console.warn = () => {};
    });

    afterEach(() => {
      console.warn = originalWarn;
    });

    const setup = () => {
      const calls: unknown[][] = [];
      const loaded: unknown[] = [];
      const events: string[] = [];
      const data: { [path: string]: unknown } = {
        organisation: new Map(),
        'organisation.x': { id: 'x', name: 'a', count: 1 },
        'organisation.x.count': 1,
      };
      const store = {
        localName: (name: string) => name,
        get: (path: string) => data[path],
        set: (...args: unknown[]) => calls.push(['set', ...args]),
        create: (...args: unknown[]) => calls.push(['create', ...args]),
        delete: (...args: unknown[]) => calls.push(['delete', ...args]),
        pushExt: (...args: unknown[]) => calls.push(['pushExt', ...args]),
        spliceExt: (...args: unknown[]) => calls.push(['spliceExt', ...args]),
      };
      const realtime = new ButtressRealtime(
        store as any,
        buildSettings({}),
        (type: string) => events.push(type),
        (detail: unknown) => loaded.push(detail),
      );
      const receive = (verb: string, path: string, response: unknown, extra: object = {}) =>
        (realtime as any)._parsePayload({
          schemaName: 'organisation',
          verb,
          path,
          pathSpec: path.replace(/\/[^/]+$/, '/:id'),
          response,
          ...extra,
        });
      return { data, calls, loaded, events, receive };
    };

    const local = { localOnly: true };

    it('merges a post into an entity already in the store', () => {
      const { calls, receive } = setup();

      receive('post', 'organisation', { id: 'x', name: 'b' });

      expect(calls).to.deep.equal([['set', 'organisation.x', { id: 'x', name: 'b', count: 1 }, local]]);
    });

    it('creates each entity in a post of several', () => {
      const { calls, receive } = setup();

      receive('post', 'organisation', [{ id: 'y' }, { id: 'z' }]);

      expect(calls).to.deep.equal([
        ['create', 'organisation', { id: 'y' }, local],
        ['create', 'organisation', { id: 'z' }, local],
      ]);
    });

    it('sets a scalar update', () => {
      const { calls, receive } = setup();

      receive('put', 'organisation/x', { type: 'scalar', path: 'name', value: 'b' });

      expect(calls).to.deep.equal([['set', 'organisation.x.name', 'b', local]]);
    });

    it('adds an increment to the value in the store', () => {
      const { calls, receive } = setup();

      receive('put', 'organisation/x', { type: 'scalar-increment', path: 'count.__increment__', value: 2 });

      expect(calls).to.deep.equal([['set', 'organisation.x.count', 3, local]]);
    });

    it('pushes a vector-add update', () => {
      const { calls, receive } = setup();

      receive('put', 'organisation/x', { type: 'vector-add', path: 'tags', value: 'c' });

      expect(calls).to.deep.equal([['pushExt', 'organisation.x.tags', local, 'c']]);
    });

    it('splices a vector-rm update', () => {
      const { calls, receive } = setup();

      receive('put', 'organisation/x', { type: 'vector-rm', path: 'tags', value: { index: 1, numRemoved: 2 } });

      expect(calls).to.deep.equal([['spliceExt', 'organisation.x.tags', 1, 2, local]]);
    });

    it('ignores an update of a type it does not know', () => {
      const { calls, loaded, receive } = setup();

      receive('put', 'organisation/x', { type: 'unknown', path: 'name', value: 'b' });

      expect(calls).to.deep.equal([]);
      expect(loaded).to.deep.equal([]);
    });

    it('sets the whole entity for an update without a path', () => {
      const { calls, receive } = setup();

      receive('put', 'organisation/x', { type: 'scalar', value: { id: 'x' } });

      expect(calls).to.deep.equal([['set', 'organisation.x', { id: 'x' }, local]]);
    });

    it('applies each update in a list', () => {
      const { calls, receive } = setup();

      receive('put', 'organisation/x', [
        { type: 'scalar', path: 'name', value: 'b' },
        { type: 'scalar', path: 'status', value: 'c' },
      ]);

      expect(calls).to.deep.equal([
        ['set', 'organisation.x.name', 'b', local],
        ['set', 'organisation.x.status', 'c', local],
      ]);
    });

    it('applies a bulk update to the entity each result names', () => {
      const { calls, receive } = setup();

      receive('post', 'organisation/bulk/update', [
        { id: 'x', results: [{ type: 'scalar', path: 'name', value: 'b' }] },
      ]);

      expect(calls).to.deep.equal([['set', 'organisation.x.name', 'b', local]]);
    });

    it('loads an entity that is not in the store when an update for it arrives', () => {
      const { calls, loaded, events, receive } = setup();

      receive('put', 'organisation/y', { type: 'scalar', path: 'name', value: 'b' });

      expect(calls).to.deep.equal([]);
      expect(loaded).to.deep.equal([{ schemaName: 'organisation', id: 'y' }]);
      expect(events).to.deep.equal(['dataservice:loadById']);
    });

    it('loads the entity when an update arrives before its collection is in the store', () => {
      const { data, loaded, receive } = setup();
      delete data.organisation;

      receive('put', 'organisation/x', { type: 'scalar', path: 'name', value: 'b' });

      expect(loaded).to.deep.equal([{ schemaName: 'organisation', id: 'x' }]);
    });

    it('deletes an entity in the store', () => {
      const { calls, receive } = setup();

      receive('delete', 'organisation/x', {});

      expect(calls).to.deep.equal([['delete', 'organisation', 'x', local]]);
    });

    it('ignores a delete of an entity that is not in the store', () => {
      const { calls, receive } = setup();

      receive('delete', 'organisation/y', {});

      expect(calls).to.deep.equal([]);
    });

    it('deletes each entity in a bulk delete that is in the store', () => {
      const { calls, receive } = setup();

      receive('post', 'organisation/bulk/delete', [{ id: 'x' }, { id: 'y' }]);

      expect(calls).to.deep.equal([['delete', 'organisation', 'x', local]]);
    });

    it('leaves the store alone for a delete of every entity', () => {
      const { calls, receive } = setup();

      receive('delete', 'organisation', {});
      receive('delete', 'organisation/x', {}, { isBulkDelete: true });

      expect(calls).to.deep.equal([]);
    });
  });
});
