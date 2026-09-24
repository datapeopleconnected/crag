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

    realtime.connect();
    const socket = (realtime as any)._socket;
    expect(socket.active).to.equal(true);

    realtime.disconnect();

    expect(socket.active).to.equal(false);
    expect((realtime as any)._socket).to.equal(null);
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
});
