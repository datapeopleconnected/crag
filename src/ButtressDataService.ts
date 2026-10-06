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
import { Logger, LogLevel } from './Logger.js';
import { ButtressClient } from './ButtressClient.js';
import { ButtressRequestQueue } from './ButtressRequestQueue.js';

import ButtressSchema from './ButtressSchema.js';
import { ButtressSchemaFactory } from './ButtressSchemaFactory.js';
import { ButtressStore, NotifyChangeOpts, ButtressStoreInterface, ButtressEntity } from './ButtressStore.js';

import { Settings, buildSettings, Dasherize, DateTime } from './helpers.js';

export interface QueryResult {
  skip?: number;
  limit?: number;
  total: number;
  results: ButtressEntity[];
}
export interface SortOpts {
  path: string;
  type?: 'STRING' | 'NUMBER' | 'DATE' | 'BOOLEAN';
  direction: 'ASC' | 'DESC';
}

export interface BJSSortOpt {
  [key: string]: number;
}

export interface QueryOpts {
  limit?: number;
  skip?: number;
  sort?: SortOpts;
  project?: any;
  bust?: boolean;
  actualCount?: boolean;
}

// The keys of each entity written locally while a search or GET was out, or true for an entity created, replaced or
// deleted meanwhile.
type Written = Map<string, Set<string> | true>;

// A value as it's sent to Buttress.
type Json = null | boolean | number | string | Json[] | JsonObject;
type JsonObject = { [key: string]: Json };

export default class ButtressDataService implements ButtressStoreInterface {
  name: string;

  path: string;

  private __route: string;

  private _logger: Logger;

  private _store: ButtressStore;

  private _schema: ButtressSchema;

  private _settings: Settings;

  private _queue: ButtressRequestQueue;

  // The ids each search returned, in the server's order, keyed by __queryKey().
  private _queryCache: Map<string, { ids: string[]; paged: boolean; generation: number }> = new Map();

  // Bumped by a create: cached pages from an earlier generation are searched for again.
  private __pageGeneration = 0;

  // Bumped when the query cache is cleared: a search sent before then isn't cached when it comes back.
  private __cacheEpoch = 0;

  // One for each search or GET that's queued or waiting for its response. The response is older than the writes
  // recorded in it, since Buttress hadn't had them when it answered, so merging it mustn't undo them.
  private __reads: Set<Written> = new Set();

  // What Buttress has of each entity in the store, as far as crag knows: the entity as it was loaded, with every write
  // since applied, as JSON. A set sends what differs from this. It can't compare with the entity in the store, since
  // get(), query results and getById() hand out that object, which an app can change in place.
  private __synced: Map<string, JsonObject> = new Map();

  core: boolean = false;

  constructor(name: string, core: boolean, settings: Partial<Settings>, store: ButtressStore, schema: ButtressSchema) {
    this.name = name;
    this.core = core;
    this._settings = buildSettings(settings);

    this.path = this.name;

    this.__route = this.path
      .split('-')
      .map((part) => Dasherize(part))
      .join('/');

    this._logger = new Logger(`buttress-data-service-${name}`);

    this._queue = new ButtressRequestQueue(
      new ButtressClient(this._settings),
      (type) => this.getUrl('bulk', type),
      this._logger,
    );

    this._schema = schema;

    this._store = store;

    this._store.set(this.name, new Map());
  }

  setLogLevel(level: LogLevel) {
    this._logger.level = level;
  }

  create(value: ButtressEntity, opts?: NotifyChangeOpts): string | undefined {
    const val = value;

    // Generate ID if not provided
    if (!val.id) {
      val.id = ButtressSchemaFactory.getObjectId();
    } else if (this._store.get(`${this.name}.${val.id}`)) {
      // Check for remote?
      throw new Error('Unable to create entity with duplicate id');
    }

    const path = this._store.create(this.name, value, ButtressDataService.__storeOpts(opts));
    this.__recordWrite(val.id);
    this.__syncEntity(val.id, value);
    // Only Buttress can say which page a new entity belongs on.
    this.__pageGeneration += 1;
    this.__send(opts, () => [this.__generateAddRequest(value)]);

    return path;
  }

  delete(id: string, opts?: NotifyChangeOpts) {
    if (!this._store.get(`${this.name}.${id}`)) {
      opts?.dboComplete?.resolve();
      return false;
    }

    const deleted = this._store.delete(`${this.name}.${id}`, ButtressDataService.__storeOpts(opts));
    this.__recordWrite(id);
    this.__synced.delete(id);
    this.__send(opts, () => [this.__generateRmRequest(id)]);

    return deleted;
  }

  // The synced copy of an entity in the store. One put in the store without being loaded or created, as tests do, is
  // taken as synced as it is.
  private __syncedEntity(id: string): JsonObject {
    if (!this.__synced.has(id)) this.__syncEntity(id, this._store.get(`${this.name}.${id}`));
    return this.__synced.get(id)!;
  }

  // Takes an entity, as it is now, as what Buttress has of it.
  private __syncEntity(id: string, entity: ButtressEntity) {
    this.__synced.set(id, ButtressDataService.__json(entity) as JsonObject);
  }

  // Sets the value at a path inside an entity's synced copy, creating the objects on the way. Undefined removes it.
  private __syncAt(id: string, path: string[], value: Json | undefined) {
    let parent = this.__syncedEntity(id);
    path.slice(0, -1).forEach((part) => {
      if (parent[part] === null || typeof parent[part] !== 'object') parent[part] = {};
      parent = parent[part] as JsonObject;
    });
    const last = path[path.length - 1];
    if (value === undefined) {
      delete parent[last];
    } else {
      parent[last] = value;
    }
  }

  // Merges fresh values from Buttress into the synced copy of the entity they were merged into. A new entity, or one
  // without a copy, starts one, so nothing is kept from the copy of an entity that has since left the store.
  private __syncFrom(id: string, fresh: ButtressEntity, held: ButtressEntity | undefined) {
    const synced = held ? this.__synced.get(id) : undefined;
    if (synced) {
      Object.assign(synced, ButtressDataService.__json(fresh));
    } else {
      this.__syncEntity(id, held ?? fresh);
    }
  }

  private static __json(value: unknown): Json | undefined {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  private static __valueAt(root: Json | undefined, path: string[]): Json | undefined {
    return path.reduce<Json | undefined>(
      (value, part) => (value !== null && typeof value === 'object' ? (value as JsonObject)[part] : undefined),
      root,
    );
  }

  // The updates that take Buttress from `before` to `after`, both JSON: the path and value of each value that differs.
  // Objects are compared key by key, so an edit deep inside one sends just that value, and arrays are sent whole. A key
  // that `after` doesn't have is sent as null.
  private static __diff(
    before: Json | undefined,
    after: Json | undefined,
    path: string,
    updates: [string, Json][] = [],
  ): [string, Json][] {
    const isObject = (value: Json | undefined): value is JsonObject =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    if (isObject(before) && isObject(after)) {
      new Set([...Object.keys(before), ...Object.keys(after)]).forEach((key) => {
        // An entity's own id is never updated.
        if (path === '' && key === 'id') return;
        ButtressDataService.__diff(before[key], after[key], path ? `${path}.${key}` : key, updates);
      });
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      updates.push([path, after === undefined ? null : after]);
    }
    return updates;
  }

  // Records a write to an entity, or to one of its top-level keys, for each search or GET that's out.
  private __recordWrite(id: string, key?: string) {
    this.__reads.forEach((written) => {
      const keys = written.get(id);
      if (keys === true) return;
      if (key === undefined) {
        written.set(id, true);
      } else if (keys) {
        keys.add(key);
      } else {
        written.set(id, new Set([key]));
      }
    });
  }

  private __startRead(): Written {
    const written: Written = new Map();
    this.__reads.add(written);
    return written;
  }

  // Data accessors
  get(path: string): any {
    return this._store.get(path);
  }

  set(path: string, value: any, opts?: NotifyChangeOpts): string | undefined {
    const parts = path.split('.');
    const [, id, ...entityPath] = parts;
    if (id === undefined) {
      // A set of the whole collection is only ever local. Its entities aren't the ones the synced copies were of.
      this.__synced.clear();
      const setPath = this._store.set(path, value, ButtressDataService.__storeOpts(opts));
      this.__send(opts, () => []);
      return setPath;
    }
    if (entityPath.length === 0) return this.__setEntity(id, value, opts);

    // Nothing to set inside an entity that isn't in the store.
    if (!this._store.get(`${this.name}.${id}`)) {
      opts?.dboComplete?.resolve();
      return undefined;
    }
    const before = ButtressDataService.__valueAt(this.__syncedEntity(id), entityPath);
    this.__createParents(parts);

    const after = ButtressDataService.__json(value);
    const updates = ButtressDataService.__diff(before, after, entityPath.join('.'));
    const old = this._store.get(path);
    // An object changed in place is the one already in the store, which can't see the change for itself.
    const storeOpts =
      old === value && updates.length > 0
        ? { ...ButtressDataService.__storeOpts(opts), forceChanged: true }
        : ButtressDataService.__storeOpts(opts);
    const setPath = this._store.set(path, value, storeOpts);
    if (old !== value || updates.length > 0) this.__recordWrite(id, entityPath[0]);
    this.__syncAt(id, entityPath, after);
    this.__send(opts, () =>
      updates.map(([updatePath, update]) => this.__generateUpdateRequest(id, updatePath, update)),
    );

    return setPath;
  }

  // Creates the objects missing on the way to a path inside an entity, as Buttress's $set does. Throws, before changing
  // anything, for one that is null or isn't an object, since Buttress can't set a property inside that either.
  private __createParents(parts: string[]) {
    for (let i = 3; i < parts.length; i += 1) {
      const parentPath = parts.slice(0, i).join('.');
      const parent = this._store.get(parentPath);
      if (parent === undefined) {
        this._store.set(parentPath, {}, { silent: true });
      } else if (parent === null || typeof parent !== 'object') {
        throw new Error(
          `Unable to set ${parts.join('.')}: ${parentPath} is ${parent === null ? 'null' : `a ${typeof parent}`}, not an object`,
        );
      }
    }
  }

  private __setEntity(id: string, value: any, opts?: NotifyChangeOpts): string | undefined {
    if (value && typeof value === 'object') {
      if (value.id === undefined || value.id === null || value.id === '') {
        value.id = id;
      } else if (value.id !== id) {
        throw new Error(`The entity's id '${value.id}' doesn't match the id in the path, '${id}'`);
      }
    }

    const existing = this._store.get(`${this.name}.${id}`);
    const isEntity = Boolean(value) && typeof value === 'object';
    // Buttress updates an entity one path at a time, so send each value that differs from what it has.
    const updates =
      existing && isEntity
        ? ButtressDataService.__diff(this.__syncedEntity(id), ButtressDataService.__json(value), '')
        : [];
    // The object already in the store can only have changed in place, which the store can't see for itself.
    const storeOpts =
      existing && value === existing
        ? { ...ButtressDataService.__storeOpts(opts), forceChanged: true }
        : ButtressDataService.__storeOpts(opts);
    const setPath = this._store.set(`${this.name}.${id}`, value, storeOpts);
    this.__recordWrite(id);
    if (isEntity) {
      this.__syncEntity(id, value);
    } else {
      this.__synced.delete(id);
    }

    if (!existing) {
      this.__pageGeneration += 1;
      this.__send(opts, () => [this.__generateAddRequest(value)]);
      return setPath;
    }

    this.__send(opts, () =>
      updates.map(([updatePath, update]) => this.__generateUpdateRequest(id, updatePath, update)),
    );

    return setPath;
  }

  // Queues a write's requests, unless its options keep it from Buttress, and settles dboComplete once they have.
  private __send(opts: NotifyChangeOpts | undefined, requests: () => Promise<unknown>[]) {
    const sent = ButtressDataService.__sends(opts) ? requests() : [];
    Promise.all(sent).then(
      () => opts?.dboComplete?.resolve(),
      (err) => opts?.dboComplete?.reject(err),
    );
  }

  private static __sends(opts?: NotifyChangeOpts): boolean {
    return !opts?.localOnly && !opts?.silent && !opts?.forceChanged;
  }

  // Objects added to an array get an id, as Buttress expects of them.
  private static __giveIds(items: any[]) {
    items.forEach((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item) && !item.id) {
        item.id = ButtressSchemaFactory.getObjectId();
      }
    });
  }

  // The data service settles dboComplete itself, so the store mustn't also resolve it.
  private static __storeOpts(opts?: NotifyChangeOpts): NotifyChangeOpts | undefined {
    if (!opts?.dboComplete) return opts;
    const { dboComplete: _dboComplete, ...rest } = opts;
    return rest;
  }

  push(path: string, ...items: any[]): number {
    return this.pushExt(path, undefined, ...items);
  }

  pushExt(path: string, opts?: NotifyChangeOpts, ...items: any[]): number {
    if (ButtressDataService.__sends(opts)) ButtressDataService.__giveIds(items);
    const [, id, ...arrayPath] = path.split('.');
    const synced = this.__syncedArray(id, arrayPath);
    const length = this._store.pushExt(path, this._schema, ButtressDataService.__storeOpts(opts), ...items);

    if (items.length > 0) {
      this.__recordWrite(id, arrayPath[0]);
      this.__syncAt(id, arrayPath, [...synced, ...(ButtressDataService.__json(items) as Json[])]);
    }
    this.__send(opts, () => items.map((item) => this.__generateUpdateRequest(id, arrayPath.join('.'), item)));

    return length;
  }

  // The synced copy of an array inside an entity in the store, or an empty one.
  private __syncedArray(id: string, path: string[]): Json[] {
    const synced = this._store.get(`${this.name}.${id}`)
      ? ButtressDataService.__valueAt(this.__syncedEntity(id), path)
      : undefined;
    return Array.isArray(synced) ? [...synced] : [];
  }

  // splice(path, start) removes to the end, as Array.prototype.splice does.
  splice(path: string, start: number, deleteCount?: number, ...items: any[]): any[] {
    return this.spliceExt(path, start, deleteCount, undefined, ...items);
  }

  spliceExt(path: string, start: number, deleteCount?: number, opts?: NotifyChangeOpts, ...items: any[]): any[] {
    const before = this._store.get(path);
    const length = Array.isArray(before) ? before.length : 0;
    // Counted as Array.prototype.splice counts it, so the requests use the index the store spliced at.
    const from = Math.trunc(start) || 0;
    const index = from < 0 ? Math.max(length + from, 0) : Math.min(from, length);

    if (ButtressDataService.__sends(opts)) ButtressDataService.__giveIds(items);
    const [, id, ...rest] = path.split('.');
    const synced = this.__syncedArray(id, rest);
    const removed = this._store.spliceExt(
      path,
      this._schema,
      index,
      deleteCount,
      ButtressDataService.__storeOpts(opts),
      ...items,
    );

    const arrayPath = rest.join('.');
    const appends = removed.length === 0 && index === length;
    if (removed.length > 0 || items.length > 0) {
      this.__recordWrite(id, rest[0]);
      // As Buttress applies what's sent: the removes or appends to its own copy, or else the whole array.
      if (items.length === 0) {
        synced.splice(index, removed.length);
        this.__syncAt(id, rest, synced);
      } else {
        const array = appends ? [...synced, ...items] : this._store.get(path);
        this.__syncAt(id, rest, ButtressDataService.__json(array));
      }
    }
    this.__send(opts, () => {
      // Each remove shifts the items after it down, so every one is at the same index.
      if (items.length === 0)
        return removed.map(() => this.__generateUpdateRequest(id, `${arrayPath}.${index}.__remove__`, ''));
      if (appends) {
        return items.map((item) => this.__generateUpdateRequest(id, arrayPath, item));
      }
      // Buttress can only append to an array or remove from it, so anything else sends the whole array.
      return [this.__generateUpdateRequest(id, arrayPath, [...this._store.get(path)])];
    });

    return removed;
  }

  notifyPath(path: string, value?: any, opts?: NotifyChangeOpts): boolean {
    return this._store.notifyPath(path, value, opts);
  }

  updateSchema(schema: ButtressSchema) {
    this._schema = schema;
  }

  async getById(id: string) {
    const storeEntity = this.get(`${this.name}.${id}`);
    if (storeEntity) return storeEntity;

    const written = this.__startRead();
    try {
      const entity = await this.__generateGetByIdRequest(id);

      // If it reached the store while the request was out, anything else holding it holds the store's object.
      const arrived = this._store.get(`${this.name}.${entity.id}`);
      if (arrived) return arrived;
      // It was in the store while the request was out, and has been deleted since.
      if (written.has(entity.id)) return undefined;

      this._store.set(this.name, new Map([...this.get(this.name), [entity.id, entity]]), {
        silent: true,
      });
      this.__syncEntity(entity.id, entity);

      return entity;
    } finally {
      this.__reads.delete(written);
    }
  }

  async query(buttressQuery: any, opts?: QueryOpts): Promise<QueryResult> {
    // Fetches the matching entities into the local store, unless this search is cached.
    const found = await this.search(buttressQuery, opts);
    // The ids of the page: those this search found, or else the cached ones, which search() only answers from when it
    // has them. Taken now, since a resync can clear the cache while the count is out, and a search that was out when
    // the cache was cleared isn't cached.
    const pageIds = found
      ? ButtressDataService.__ids(found)
      : this._queryCache.get(this.__queryKey(buttressQuery, opts))!.ids;

    // Fetch the total results count from buttress as the query maybe paged.
    const total = await this.count(buttressQuery, opts?.actualCount);

    const paged = ButtressDataService.__isPaged(opts);
    const results = paged ? this.__page(buttressQuery, pageIds) : this.__filterLocalData(buttressQuery, opts?.sort);

    return { skip: opts?.skip, limit: opts?.limit, total, results };
  }

  // A page can't be cut from the store, which may hold matches the server left off it, so a
  // page is the entities the server sent, less any since deleted or changed so they don't match.
  private __page(buttressQuery: any, ids: string[]): ButtressEntity[] {
    const entities = ids.map((id) => this._store.get(`${this.name}.${id}`)).filter((entity) => entity);
    // _processQueryPart can reorder the entities ($or does), so keep the server's order.
    const matching = new Set(this.__matchLocally(buttressQuery, entities));

    return entities.filter((entity) => matching.has(entity));
  }

  private __filterLocalData(buttressQuery: any, sort?: SortOpts): ButtressEntity[] {
    let arr = Array.from(this._store.get(this.name).values());

    if (sort) {
      arr = arr.sort((a: any, b: any) => this.__sort(a, b, sort));
    }

    return this.__matchLocally(buttressQuery, arr);
  }

  private __matchLocally(buttressQuery: any, entities: any[]): ButtressEntity[] {
    try {
      return this._processQueryPart(buttressQuery, entities);
    } catch (err) {
      this._logger.error('Query was:', buttressQuery);
      throw err;
    }
  }

  private static __isPaged(opts?: QueryOpts): boolean {
    return !!(opts?.limit || opts?.skip);
  }

  private __queryKey(buttressQuery: any, opts?: QueryOpts): string {
    return JSON.stringify({
      buttressQuery,
      limit: opts?.limit,
      skip: opts?.skip,
      sort: opts?.sort,
      project: opts?.project,
    });
  }

  private __sort(a: any, b: any, sort: SortOpts): number {
    let aVal = this._store.get(sort.path, a);
    let bVal = this._store.get(sort.path, b);

    let sortType = sort.type || 'STRING';

    if (sortType === 'STRING') {
      aVal = aVal ? aVal.toLowerCase() : '';
      bVal = bVal ? bVal.toLowerCase() : '';
    } else if (sortType === 'DATE') {
      aVal = aVal ? new Date(aVal).getTime() : 0;
      bVal = bVal ? new Date(bVal).getTime() : 0;
      sortType = 'NUMBER';
    }

    if (sortType === 'NUMBER') {
      return sort.direction === 'ASC' ? aVal - bVal : bVal - aVal;
    }

    if (sort.direction === 'ASC') {
      return aVal.localeCompare(bVal);
    }

    return bVal.localeCompare(aVal);
  }

  _processQueryPart(query: any, data: Array<any>) {
    let output = data.slice(0);

    for (const field of Object.keys(query)) {
      if (field === '$and') {
        query[field].forEach((o: any) => {
          output = this._processQueryPart(o, output);
        });
      } else if (field === '$or') {
        output = query[field]
          .map((o: any) => this._processQueryPart(o, output))
          .reduce(
            (combined: any, results: any) => combined.concat(results.filter((r: any) => combined.indexOf(r) === -1)),
            [],
          );
      } else {
        const command = query[field];
        for (const operator of Object.keys(command)) {
          output = this._queryFilterData(output, field, operator, command[operator]);
        }
      }
    }

    return output;
  }

  private __parsePath(obj: any, path: string) {
    let value = this._store.get(path, obj);
    value = value ? value : this.__recursivePathLookUp(obj, path);
    return Array.isArray(value) ? value : [value];
  }

  private __recursivePathLookUp = (root: any, path: string) => {
    const parts = path.toString().split('.');

    const helper = (current: any, remainingParts: string[]): any[] | string | undefined => {
      if (!current || remainingParts.length === 0) return current;

      const [currentPart, ...restParts] = remainingParts;

      if (current instanceof Map) {
        return helper(current.get(currentPart), restParts);
      } else if (typeof current === 'object' && Array.isArray(current)) {
        const results = current
          .map((item) => helper(item, [currentPart, ...restParts]))
          .flat()
          .filter((v) => v);
        return results.length > 0 ? results : undefined;
      } else if (typeof current === 'object') {
        return helper(current[currentPart], restParts);
      }

      return undefined;
    };

    return helper(root, parts);
  };

  _queryFilterData(data: any, field: string, operator: string, operand: any) {
    // A date operator compares times. DateTime gives NaN for a value that isn't a date, such as a missing or null one,
    // and NaN compares false, so those never match, and an operand that isn't a date matches nothing.
    const dateOperator = (matches: (time: number, operandTime: number) => boolean) => (rhs: any) => {
      const operandTime = DateTime(rhs);
      return (lhs: any) => this.__parsePath(lhs, field).some((val) => matches(DateTime(val), operandTime));
    };

    // Each operator takes its operand and returns the filter for it.
    const fns: { [key: string]: (rhs: any) => (lhs: any) => boolean } = {
      $not: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex((val) => val !== rhs) !== -1,
      $eq: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex((val) => val === rhs) !== -1,
      $gt: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex((val) => val > rhs) !== -1,
      $lt: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex((val) => val < rhs) !== -1,
      $gte: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex((val) => val >= rhs) !== -1,
      $lte: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex((val) => val <= rhs) !== -1,
      $rex: (rhs: any) => (lhs: any) =>
        this.__parsePath(lhs, field).findIndex((val) => new RegExp(rhs).test(val)) !== -1,
      $rexi: (rhs: any) => (lhs: any) =>
        this.__parsePath(lhs, field).findIndex((val) => new RegExp(rhs, 'i').test(val)) !== -1,
      $in: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).some((v) => rhs.indexOf(v) !== -1),
      $nin: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).every((v) => rhs.indexOf(v) === -1),
      // As in MongoDB: present, even if null. __parsePath gives no values for an empty array, so check for one.
      $exists: (rhs: any) => (lhs: any) => {
        const exists =
          this.__parsePath(lhs, field).some((val) => val !== undefined) || Array.isArray(this._store.get(field, lhs));
        return rhs ? exists : !exists;
      },
      $inProp: (rhs: any) => (lhs: any) => lhs[field].indexOf(rhs) !== -1,
      $elMatch: (rhs: any) => (lhs: any) => this._processQueryPart(rhs, this.__parsePath(lhs, field)).length > 0,
      $gtDate: dateOperator((time, operandTime) => time > operandTime),
      $ltDate: dateOperator((time, operandTime) => time < operandTime),
      $gteDate: dateOperator((time, operandTime) => time >= operandTime),
      $lteDate: dateOperator((time, operandTime) => time <= operandTime),
    };

    if (!fns[operator]) {
      this._logger.error(new Error(`Invalid operator: ${operator}`));
      return [];
    }

    return data.filter(fns[operator](operand));
  }

  async search(buttressQuery: any, opts?: QueryOpts): Promise<any> {
    const key = this.__queryKey(buttressQuery, opts);
    const paged = ButtressDataService.__isPaged(opts);
    const generation = this.__pageGeneration;
    const epoch = this.__cacheEpoch;
    const cached = this._queryCache.get(key);
    if (!opts?.bust && cached && (!cached.paged || cached.generation === generation)) {
      return false;
    }

    let sort: undefined | BJSSortOpt;
    if (opts?.sort) {
      sort = {};
      sort[opts.sort.path] = opts.sort.direction === 'ASC' ? 1 : -1;
    }

    const written = this.__startRead();
    try {
      const body = await this.__generateSearchRequest(buttressQuery, opts?.limit, opts?.skip, sort, opts?.project);

      const entities: Map<string, ButtressEntity> = this.get(this.name);
      const added: Map<string, ButtressEntity> = new Map();
      for (const o of body) {
        const keys = written.get(o.id);
        // Created, replaced or deleted while the search was out.
        if (keys === true) continue;
        const fresh = keys ? ButtressDataService.__without(o, keys) : o;
        // Merged into the object already in the store, so anything holding it sees the fresh values.
        const held = added.get(o.id) ?? entities.get(o.id);
        if (held) {
          Object.assign(held, fresh);
        } else {
          added.set(o.id, fresh);
        }
        this.__syncFrom(o.id, fresh, held);
      }

      this._store.set(this.name, new Map([...entities, ...added]), {
        silent: true,
      });
      // The generation from when the search was sent, so a create while it was out makes this page stale. A search
      // that was out when the cache was cleared, as it is by a resync, may be missing the changes the resync is for.
      if (epoch === this.__cacheEpoch) {
        this._queryCache.set(key, { ids: ButtressDataService.__ids(body), paged, generation });
      }

      return body;
    } finally {
      this.__reads.delete(written);
    }
  }

  // The ids of the entities a search found, in the order Buttress sent them, each once.
  private static __ids(entities: ButtressEntity[]): string[] {
    return [...new Set(entities.map((entity) => entity.id))];
  }

  private static __without(entity: ButtressEntity, keys: Set<string>): ButtressEntity {
    return Object.fromEntries(Object.entries(entity).filter(([key]) => !keys.has(key))) as ButtressEntity;
  }

  async count(buttressQuery: any, actualCount?: boolean): Promise<number> {
    return this.__generateCountRequest(buttressQuery, actualCount);
  }

  clearQueryMap() {
    this._queryCache.clear();
    this.__cacheEpoch += 1;
  }

  // Whether anything has been queried or fetched: whether it holds any entities or cached queries, or has a search or
  // GET out.
  hasQueried(): boolean {
    return this.get(this.name).size > 0 || this._queryCache.size > 0 || this.__reads.size > 0;
  }

  nextIdle(): Promise<boolean> {
    return this._queue.nextIdle();
  }

  private __generateGetByIdRequest(entityId: string): Promise<ButtressEntity> {
    return this._queue.push({ type: 'get', method: 'GET', url: this.getUrl(entityId), entityId });
  }

  private __generateSearchRequest(
    query: any,
    limit: number = 0,
    skip: number = 0,
    sort: undefined | BJSSortOpt = undefined,
    project: any = undefined,
  ): Promise<ButtressEntity[]> {
    return this._queue.push({
      type: 'search',
      method: 'QUERY',
      url: this.getUrl(),
      body: { query, limit, skip, sort, project },
    });
  }

  private __generateRmRequest(entityId: string) {
    return this._queue.push({ type: 'delete', method: 'DELETE', url: this.getUrl(entityId), entityId });
  }

  private __generateCountRequest(query: any, actualCount: boolean = false): Promise<number> {
    return this._queue.push({
      type: 'count',
      method: 'QUERY',
      url: this.getUrl('count'),
      body: { query, actualCount },
    });
  }

  private __generateAddRequest(entity: any) {
    return this._queue.push({ type: 'add', method: 'POST', url: this.getUrl(), entityId: entity.id, body: entity });
  }

  private __generateUpdateRequest(entityId: string, path: string, value: unknown): Promise<void> {
    const request = this._queue.push<void>({
      type: 'update',
      method: 'PUT',
      url: this.getUrl(entityId),
      entityId,
      body: { path, value },
    });
    // Buttress didn't take it, so what it has there is unknown, and a later set of that value is sent again. For a
    // remove from an array, that's the whole array.
    request.catch(() => {
      if (this.__synced.has(entityId))
        this.__syncAt(entityId, path.replace(/\.\d+\.__remove__$/, '').split('.'), undefined);
    });
    return request;
  }

  getUrl(...parts: string[]) {
    if (!this.core && this._settings.apiPath) {
      return `${this._settings.endpoint}/${this._settings.apiPath}/api/v1/${this.__route}/${parts.join('/')}`;
    }

    return `${this._settings.endpoint}/api/v1/${this.__route}/${parts.join('/')}`;
  }
}
