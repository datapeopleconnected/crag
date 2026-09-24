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

import { ButtressClient, ButtressError } from '../../src/ButtressClient.js';
import { buildSettings } from '../../src/helpers.js';

describe('ButtressClient', () => {
  let originalFetch: typeof window.fetch;
  let sent: { url: URL; init: RequestInit }[];
  let respond: () => Response;

  beforeEach(() => {
    originalFetch = window.fetch;
    sent = [];
    respond = () => new Response('{"ok":true}');
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: new URL(input.toString()), init: init! });
      return respond();
    };
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  const client = () => {
    const settings = buildSettings({ endpoint: 'https://example.test', token: 'abc' });
    return { settings, client: new ButtressClient(settings) };
  };

  it('sends the token, session id and JSON body', async () => {
    const { settings, client: c } = client();

    await c.request('POST', 'https://example.test/api/v1/lambda', { body: { a: 1 } });

    const { init } = sent[0];
    const headers = init.headers as Record<string, string>;
    expect(init.method).to.equal('POST');
    expect(headers.Authorization).to.equal('Bearer abc');
    expect(headers['x-client-session-id']).to.equal(settings.clientSessionId);
    expect(headers['Content-Type']).to.equal('application/json');
    expect(init.body).to.equal('{"a":1}');
    expect(init.cache).to.equal('no-store');
  });

  it('sends query values in the query string, with a cache-buster', async () => {
    const { client: c } = client();

    await c.request('GET', 'https://example.test/api/v1/app/schema', { query: { core: 'users,apps' } });

    const { url, init } = sent[0];
    expect(url.searchParams.get('core')).to.equal('users,apps');
    expect(url.searchParams.has('urq')).to.equal(true);
    expect((init.headers as Record<string, string>).core).to.equal(undefined);
  });

  it('reads the token when each request is sent', async () => {
    const { settings, client: c } = client();

    settings.token = 'changed';
    await c.request('GET', 'https://example.test/api/v1/app/schema');

    expect((sent[0].init.headers as Record<string, string>).Authorization).to.equal('Bearer changed');
  });

  it('resolves with the parsed body of any 2xx response', async () => {
    const { client: c } = client();
    respond = () => new Response('{"id":"x"}', { status: 201 });

    expect(await c.request('POST', 'https://example.test/api/v1/lambda')).to.deep.equal({ id: 'x' });
  });

  it('throws a ButtressError with the status and Buttress message', async () => {
    const { client: c } = client();
    respond = () => new Response('{"message":"access denied"}', { status: 403, statusText: 'Forbidden' });

    const err = await c.request('SEARCH', 'https://example.test/api/v1/organisation/').catch((e) => e);

    expect(err).to.be.instanceOf(ButtressError);
    expect(err.status).to.equal(403);
    expect(err.method).to.equal('SEARCH');
    expect(err.url).to.equal('https://example.test/api/v1/organisation/');
    expect(err.serverMessage).to.equal('access denied');
    expect(err.message).to.contain('access denied');
  });

  it('throws a ButtressError for an error response that is not JSON', async () => {
    const { client: c } = client();
    respond = () => new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' });

    const err = await c.request('GET', 'https://example.test/api/v1/app/schema').catch((e) => e);

    expect(err).to.be.instanceOf(ButtressError);
    expect(err.status).to.equal(502);
    expect(err.serverMessage).to.equal('Bad Gateway');
  });

  it('throws without sending when the token is missing', async () => {
    const settings = buildSettings({ endpoint: 'https://example.test' });

    const err = await new ButtressClient(settings).request('GET', 'https://example.test/x').catch((e) => e);

    expect(err.message).to.contain("'token'");
    expect(sent.length).to.equal(0);
  });
});
