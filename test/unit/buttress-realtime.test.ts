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
});
