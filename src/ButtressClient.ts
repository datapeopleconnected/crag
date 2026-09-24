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

import type { Settings } from './helpers.js';

// Thrown for a response from Buttress with an error status. A request that gets no response,
// such as one that fails on the network, rejects with fetch's own error instead.
export class ButtressError extends Error {
  readonly status: number;

  readonly method: string;

  readonly url: string;

  // The message Buttress sent with the error, or the status text if it didn't send one.
  readonly serverMessage: string;

  constructor(status: number, method: string, url: string, serverMessage: string) {
    super(`Buttress responded ${status} to ${method} ${url}: ${serverMessage}`);
    this.name = 'ButtressError';
    this.status = status;
    this.method = method;
    this.url = url;
    this.serverMessage = serverMessage;
  }
}

export interface ButtressRequestOpts {
  body?: unknown;
  query?: { [key: string]: string };
}

// Sends requests to Buttress. It reads the settings on each request, so a changed token applies straight away.
export class ButtressClient {
  private _settings: Settings;

  constructor(settings: Settings) {
    this._settings = settings;
  }

  async request<T = any>(method: string, url: string, opts: ButtressRequestOpts = {}): Promise<T> {
    const { token, clientSessionId } = this._settings;
    if (!token) throw new Error(`Missing setting 'token' while sending ${method} ${url}`);

    const qs = new URLSearchParams({ ...opts.query, urq: `${Date.now()}` });
    const response = await fetch(`${url}?${qs.toString()}`, {
      method,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-client-session-id': clientSessionId,
      },
      body: opts.body === undefined || opts.body === null ? undefined : JSON.stringify(opts.body),
    });

    if (!response.ok) {
      throw new ButtressError(response.status, method, url, await ButtressClient.errorMessage(response));
    }

    return response.json();
  }

  // Error responses aren't always JSON: a proxy in front of Buttress may send an HTML page.
  private static async errorMessage(response: Response): Promise<string> {
    try {
      const body = await response.json();
      if (body && typeof body.message === 'string' && body.message) return body.message;
    } catch {
      // Not JSON.
    }
    return response.statusText;
  }
}
