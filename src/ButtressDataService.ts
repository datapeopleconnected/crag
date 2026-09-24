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

import { Settings, buildSettings, Dasherize, DateCreate, DateIsBefore, DateIsAfter, DateIsEqual } from './helpers.js';

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
    this.__send(opts, () => [this.__generateRmRequest(id)]);

    return deleted;
  }

  // Data accessors
  get(path: string): any {
    return this._store.get(path);
  }

  set(path: string, value: any, opts?: NotifyChangeOpts): string | undefined {
    const parts = path.split('.');
    if (parts.length === 2) return this.__setEntity(parts[1], value, opts);

    // Nothing to set inside an object that isn't in the store.
    const parent = parts.length > 2 ? this._store.get(parts.slice(0, -1).join('.')) : undefined;
    if (parts.length > 2 && (typeof parent !== 'object' || parent === null)) {
      opts?.dboComplete?.resolve();
      return undefined;
    }

    const changed = this._store.get(path) !== value;
    const setPath = this._store.set(path, value, ButtressDataService.__storeOpts(opts));
    // A set of the whole collection is only ever local.
    const entityPath = parts.slice(2).join('.');
    this.__send(opts, () => (changed && entityPath ? [this.__generateUpdateRequest(parts[1], entityPath, value)] : []));

    return setPath;
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
    const setPath = this._store.set(`${this.name}.${id}`, value, ButtressDataService.__storeOpts(opts));

    if (!existing) {
      this.__pageGeneration += 1;
      this.__send(opts, () => [this.__generateAddRequest(value)]);
      return setPath;
    }

    // Buttress updates an entity one path at a time, so send the top-level properties that changed.
    const changed = Object.keys(value || {}).filter(
      (key) => key !== 'id' && JSON.stringify(value[key]) !== JSON.stringify(existing[key]),
    );
    this.__send(opts, () => changed.map((key) => this.__generateUpdateRequest(id, key, value[key])));

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
    const length = this._store.pushExt(path, this._schema, ButtressDataService.__storeOpts(opts), ...items);

    const [, id, ...arrayPath] = path.split('.');
    this.__send(opts, () => items.map((item) => this.__generateUpdateRequest(id, arrayPath.join('.'), item)));

    return length;
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
    const removed = this._store.spliceExt(
      path,
      this._schema,
      index,
      deleteCount,
      ButtressDataService.__storeOpts(opts),
      ...items,
    );

    const [, id, ...rest] = path.split('.');
    const arrayPath = rest.join('.');
    this.__send(opts, () => {
      // Each remove shifts the items after it down, so every one is at the same index.
      if (items.length === 0)
        return removed.map(() => this.__generateUpdateRequest(id, `${arrayPath}.${index}.__remove__`, ''));
      if (removed.length === 0 && index === length) {
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
    if (!this._settings) throw new Error('Unable to call query, setttings is still undefined');

    const entity = await this.__generateGetByIdRequest(id);

    if (this._store.get(`${this.name}.${entity.id}`)) return entity;

    this._store.set(this.name, new Map([...this.get(this.name), [entity.id, entity]]), {
      silent: true,
    });

    return entity;
  }

  async query(buttressQuery: any, opts?: QueryOpts): Promise<QueryResult> {
    if (!this._settings) throw new Error('Unable to call query, setttings is still undefined');

    // Fetches the matching entities into the local store, unless this search is cached.
    await this.search(buttressQuery, opts);

    // Fetch the total results count from buttress as the query maybe paged.
    const total = await this.count(buttressQuery, opts?.actualCount);

    const paged = ButtressDataService.__isPaged(opts);
    const results = paged ? this.__cachedPage(buttressQuery, opts) : this.__filterLocalData(buttressQuery, opts?.sort);

    return { skip: opts?.skip, limit: opts?.limit, total, results };
  }

  // A page can't be cut from the store, which may hold matches the server left off it, so a
  // page is the entities the server sent, less any since deleted or changed so they don't match.
  private __cachedPage(buttressQuery: any, opts?: QueryOpts): ButtressEntity[] {
    const ids = this._queryCache.get(this.__queryKey(buttressQuery, opts))?.ids || [];
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
    // Each operator takes its operand and returns the filter for it (the date ones return false for a null operand).
    const fns: { [key: string]: (rhs: any) => ((lhs: any) => boolean) | false } = {
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
      $gtDate: (rhs: any) => {
        if (rhs === null) return false;
        const rhsDate = DateCreate(rhs);

        return (lhs: any) =>
          this.__parsePath(lhs, field).findIndex((val) => {
            if (val === null) return false; // Dont compare against null value
            return DateIsBefore(rhsDate, val);
          }) !== -1;
      },
      $ltDate: (rhs: any) => {
        if (rhs === null) return false;
        const rhsDate = DateCreate(rhs);

        return (lhs: any) =>
          this.__parsePath(lhs, field).findIndex((val) => {
            if (val === null) return false; // Dont compare against null value
            return DateIsAfter(rhsDate, val);
          }) !== -1;
      },
      $gteDate: (rhs: any) => {
        if (rhs === null) return false;
        const rhsDate = DateCreate(rhs);

        return (lhs: any) =>
          this.__parsePath(lhs, field).findIndex((val) => {
            if (val === null) return false; // Dont compare against null value
            return DateIsBefore(rhsDate, val) || DateIsEqual(rhsDate, val);
          }) !== -1;
      },
      $lteDate: (rhs: any) => {
        if (rhs === null) return false;
        const rhsDate = DateCreate(rhs);

        return (lhs: any) =>
          this.__parsePath(lhs, field).findIndex((val) => {
            if (val === null) return false; // Dont compare against null value
            return DateIsAfter(rhsDate, val) || DateIsEqual(rhsDate, val);
          }) !== -1;
      },
    };

    if (!fns[operator]) {
      this._logger.error(new Error(`Invalid operator: ${operator}`));
      return [];
    }

    return data.filter(fns[operator](operand));
  }

  async search(buttressQuery: any, opts?: QueryOpts): Promise<any> {
    if (!this._settings) return undefined;

    const key = this.__queryKey(buttressQuery, opts);
    const paged = ButtressDataService.__isPaged(opts);
    const generation = this.__pageGeneration;
    const cached = this._queryCache.get(key);
    if (!opts?.bust && cached && (!cached.paged || cached.generation === generation)) {
      return false;
    }

    let sort: undefined | BJSSortOpt;
    if (opts?.sort) {
      sort = {};
      sort[opts.sort.path] = opts.sort.direction === 'ASC' ? 1 : -1;
    }

    const body = await this.__generateSearchRequest(buttressQuery, opts?.limit, opts?.skip, sort, opts?.project);

    // Filter out any objects which exists in the local store
    // const filteredBody =body.filter((o: any) => !this._store.get(`${this.name}.${o.id}`));
    const newMapArrMap: [string, ButtressEntity][] = [];

    for (const o of body) {
      const idx = newMapArrMap.findIndex((n) => n[0] === o.id);
      if (idx !== -1) {
        newMapArrMap[idx] = [o.id, { ...newMapArrMap[idx][1], ...o }];
        continue;
      }
      const existing = this._store.get(`${this.name}.${o.id}`);
      if (!existing) {
        newMapArrMap.push([o.id, o]);
        continue;
      }
      newMapArrMap.push([o.id, { ...existing, ...o }]);
    }

    this._store.set(this.name, new Map([...this.get(this.name), ...newMapArrMap]), {
      silent: true,
    });
    // The generation from when the search was sent, so a create while it was out makes this page stale.
    this._queryCache.set(key, { ids: newMapArrMap.map(([id]) => id), paged, generation });

    return body;
  }

  async count(buttressQuery: any, actualCount?: boolean): Promise<number> {
    return this.__generateCountRequest(buttressQuery, actualCount);
  }

  clearQueryMap() {
    this._queryCache.clear();
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
      method: 'SEARCH',
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
      method: 'SEARCH',
      url: this.getUrl('count'),
      body: { query, actualCount },
    });
  }

  private __generateAddRequest(entity: any) {
    return this._queue.push({ type: 'add', method: 'POST', url: this.getUrl(), entityId: entity.id, body: entity });
  }

  private __generateUpdateRequest(entityId: string, path: string, value: unknown): Promise<void> {
    return this._queue.push({
      type: 'update',
      method: 'PUT',
      url: this.getUrl(entityId),
      entityId,
      body: { path, value },
    });
  }

  getUrl(...parts: string[]) {
    if (!this.core && this._settings.apiPath) {
      return `${this._settings.endpoint}/${this._settings.apiPath}/api/v1/${this.__route}/${parts.join('/')}`;
    }

    return `${this._settings.endpoint}/api/v1/${this.__route}/${parts.join('/')}`;
  }
}
