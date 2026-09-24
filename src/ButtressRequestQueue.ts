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

import type { ButtressClient } from './ButtressClient.js';
import type { Logger } from './Logger.js';

export interface QueuedRequest {
  type: 'get' | 'search' | 'count' | 'add' | 'update' | 'delete';
  method: string;
  url: string;
  // The entity the request reads or writes, if it's about one.
  entityId?: string;
  body?: unknown;
}

interface PendingRequest extends QueuedRequest {
  resolve: (data: unknown) => void;
  reject: (err: unknown) => void;
}

// Sends a schema's requests to Buttress one at a time. With bundling on, adds and deletes go ahead of other
// requests, and adds or updates waiting at the same time go as one bulk request. Neither ever moves a request
// ahead of an earlier one for the same entity, so an update and then a delete of it reach Buttress in that order.
export class ButtressRequestQueue {
  bundling: boolean = true;

  bundlingChunk: number = 100;

  private _client: ButtressClient;

  private _bulkUrl: (type: 'add' | 'update') => string;

  private _logger: Logger;

  private _queue: PendingRequest[] = [];

  private _sending: boolean = false;

  private _idleWaiters: Array<(idle: boolean) => void> = [];

  constructor(client: ButtressClient, bulkUrl: (type: 'add' | 'update') => string, logger: Logger) {
    this._client = client;
    this._bulkUrl = bulkUrl;
    this._logger = logger;
  }

  push<T = unknown>(request: QueuedRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this._queue.push({ ...request, resolve: resolve as (data: unknown) => void, reject });
      this._next();
    });
  }

  // Resolves once nothing is queued or waiting for a response, including requests queued in the meantime.
  nextIdle(): Promise<boolean> {
    return new Promise((resolve) => {
      queueMicrotask(() => {
        if (this._queue.length === 0 && !this._sending) {
          resolve(true);
          return;
        }

        this._idleWaiters.push(resolve);
      });
    });
  }

  private _next() {
    if (this._sending) return;
    if (this._queue.length === 0) {
      // On the next task, so the handlers of the requests that just settled run first, and anything they queue is
      // waited for too.
      setTimeout(() => this._resolveIdleWaiters());
      return;
    }

    this._send(this._takeBatch());
  }

  private _resolveIdleWaiters() {
    if (this._queue.length > 0 || this._sending) return;

    const waiting = this._idleWaiters;
    this._idleWaiters = [];
    waiting.forEach((resolve) => resolve(true));
  }

  // The requests to send next, in the order they were queued, taken off the queue.
  private _takeBatch(): PendingRequest[] {
    const firstIdx = this.bundling
      ? this._queue.findIndex((r, idx) => (r.type === 'add' || r.type === 'delete') && this._canSendNow(idx, []))
      : -1;
    const first = this._queue[firstIdx === -1 ? 0 : firstIdx];
    const batch = [first];

    if (this.bundling && (first.type === 'add' || first.type === 'update')) {
      this._queue.forEach((r, idx) => {
        if (batch.length < this.bundlingChunk && r !== first && r.type === first.type && this._canSendNow(idx, batch)) {
          batch.push(r);
        }
      });
    }

    this._queue = this._queue.filter((r) => !batch.includes(r));
    return batch;
  }

  // Whether the request at idx can go now, alongside `batch`: not if an earlier request for its entity is staying.
  private _canSendNow(idx: number, batch: PendingRequest[]): boolean {
    const { entityId } = this._queue[idx];
    if (entityId === undefined) return true;

    return !this._queue.slice(0, idx).some((r) => r.entityId === entityId && !batch.includes(r));
  }

  private async _send(batch: PendingRequest[]) {
    this._sending = true;
    const request = batch.length > 1 ? this._bulk(batch) : batch[0];

    try {
      const data = await this._client.request(request.method, request.url, { body: request.body });
      // Every bundled request settles with the bulk request.
      batch.forEach((r) => r.resolve(data));
    } catch (err) {
      this._logger.error(err);
      batch.forEach((r) => r.reject(err));
    } finally {
      this._sending = false;
      this._next();
    }
  }

  private _bulk(batch: PendingRequest[]): QueuedRequest {
    const type = batch[0].type as 'add' | 'update';

    return {
      type,
      method: 'POST',
      url: this._bulkUrl(type),
      body: type === 'update' ? batch.map((r) => ({ id: r.entityId, body: r.body })) : batch.map((r) => r.body),
    };
  }
}
