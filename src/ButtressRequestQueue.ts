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

import { ButtressError, type ButtressClient } from './ButtressClient.js';
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
  // Never bundled, as for a create sent again on its own after the bulk add it was in was refused.
  alone?: boolean;
}

// Buttress's answer for one update in a bulk update. One it didn't apply has null results, and its validation says why.
interface BulkUpdateEntry {
  results?: unknown;
  validation?: true | { status?: number; code?: string; message?: string };
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
      // Copied as it will be sent, since it can hold the store's own objects, which may change before it's sent.
      const body = request.body === undefined ? undefined : JSON.parse(JSON.stringify(request.body));
      this._queue.push({ ...request, body, resolve: resolve as (data: unknown) => void, reject });
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

    if (this.bundling && !first.alone && (first.type === 'add' || first.type === 'update')) {
      this._queue.forEach((r, idx) => {
        if (
          batch.length < this.bundlingChunk &&
          r !== first &&
          !r.alone &&
          r.type === first.type &&
          this._canSendNow(idx, batch)
        ) {
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
    const bulk = batch.length > 1;
    const request = bulk ? this._bulk(batch) : batch[0];

    try {
      const data = await this._client.request(request.method, request.url, { body: request.body });
      if (bulk && request.type === 'update') {
        this._settleUpdates(batch, data, request.url);
      } else {
        // Every create in a bulk add settles with it, since Buttress stores all of them or none.
        batch.forEach((r) => r.resolve(data));
      }
    } catch (err) {
      if (bulk && request.type === 'add' && err instanceof ButtressError && err.status === 400) {
        // Buttress stores none of a bulk add if one of them is invalid, and names only the first. So each is sent again
        // on its own, ahead of anything queued since: the valid ones are stored, and each invalid one gets its error.
        this._queue.unshift(...batch.map((r) => ({ ...r, alone: true })));
      } else {
        this._logger.error(err);
        batch.forEach((r) => r.reject(err));
      }
    } finally {
      this._sending = false;
      this._next();
    }
  }

  // Buttress answers a bulk update with an entry for each update, in the order they were sent, and applies the rest
  // when it refuses one. So each update settles from its own entry.
  private _settleUpdates(batch: PendingRequest[], data: unknown, url: string) {
    const answered =
      Array.isArray(data) && data.length === batch.length && data.every((entry) => entry && typeof entry === 'object');
    if (!answered) {
      // As from a Buttress older than crag supports. It may have applied some or all of them.
      const err = new Error(
        `Buttress didn't answer each update in the bulk update to ${url}, so crag can't tell which it applied. ` +
          `crag needs Buttress develop at 390fea49 or later.`,
      );
      this._logger.error(err);
      batch.forEach((r) => r.reject(err));
      return;
    }

    (data as BulkUpdateEntry[]).forEach((entry, idx) => {
      const refusal = entry.validation === true ? undefined : entry.validation;
      if (entry.results !== null && !refusal) {
        batch[idx].resolve(entry.results);
        return;
      }

      const err = new ButtressError(
        refusal?.status ?? 500,
        'POST',
        url,
        refusal?.message ?? "Buttress didn't apply the update",
      );
      this._logger.error(err);
      batch[idx].reject(err);
    });
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
