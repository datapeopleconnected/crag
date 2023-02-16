import { LtnLogger, LtnLogLevel } from '@lighten/ltn-element';
import { ObjectId } from 'bson';
import Sugar from 'sugar';

import ButtressSchema from './ButtressSchema.js';
import { ButtressSchemaFactory } from './ButtressSchemaFactory.js';
import { ButtressStore, NotifyChangeOpts, ButtressStoreInterface, IndexSplice, ButtressEntity } from './ButtressStore.js';

import { Settings } from './helpers.js';

export interface QueryResult {
  skip?: number,
  limit?: number,
  total: number,
  results: ButtressEntity[]
}
export interface QueryOpts {
  limit?: number
  skip?: number
  sort?: any
  project?: any
  bust?: boolean
}

export default class ButtressDataService implements ButtressStoreInterface {
  name: string;

  private _logger: LtnLogger;

  readonly BUNDLED_REQUESTS_TYPES: string[] = ['add', 'update'];

  private _store: ButtressStore;

  private _schema: ButtressSchema;

  private _settings: Settings;

  private _queryMap: Array<string> = [];

  private _requestQueue: Array<any> = [];

  private __awaitIdleQueue: Array<Function> = [];

  status: string = 'pending';

  core: boolean = false;

  bundling: boolean = true;

  bundlingChunk: number = 100;

  constructor(name: string, core: boolean, settings: Settings, store: ButtressStore, schema: ButtressSchema) {
    this.name = name;
    this.core = core;
    this._settings = settings;

    this._logger = new LtnLogger(`buttress-data-service-${name}`);

    this._schema = schema;

    this._store = store;

    this._store.set(this.name, new Map());

    this._store.subscribe(`${this.name}.*, ${this.name}`, (cr: any, map: any, skip: boolean = false) => this._processDataChange(cr, skip));
  }

  setLogLevel(level: LtnLogLevel) {
    this._logger.level = level;
  }

  create(value: ButtressEntity, opts?: NotifyChangeOpts): string|undefined {
    const val = value;

    // Generate ID if not provided
    if (!val.id) {
      val.id = ButtressSchemaFactory.getObjectId();
    } else if (this._store.get(`${this.name}.${val.id}`)) {
      // Check for remote?
      throw new Error('Unable to create entity with duplicate id');
    }

    return this._store.create(this.name, value, opts);
  }

  delete(id: string, opts?: NotifyChangeOpts) {
    return this._store.delete(`${this.name}.${id}`, opts);
  }

  // Data accessors
  get(path: string, opts?: NotifyChangeOpts): any {
    return this._store.get(path);
  }

  set(path: string, value: any, opts?: NotifyChangeOpts): string|undefined {
    return this._store.set(path, value, opts);
  }

  push(path: string, ...items: any[]): number {
    return this._store.push(path, this._schema, ...items);
  }

  pushExt(path: string, opts?: NotifyChangeOpts, ...items: any[]): number {
    return this._store.pushExt(path, this._schema, opts, ...items);
  }

  splice(path: string, start: number, deleteCount?: number, ...items: any[]): any[] {
    if (arguments.length < 3) return this._store.splice(path, this._schema, start);

    return this._store.splice(path, this._schema, start, deleteCount, ...items);
  }

  spliceExt(path: string, start: number, deleteCount?: number, opts?: NotifyChangeOpts, ...items: any[]): any[] {
    return this._store.spliceExt(path, this._schema, start, deleteCount, opts, ...items)
  }

  // eslint-disable-next-line class-methods-use-this
  _processDataChange(cr: any, skip: boolean) : void {
    if (skip) return;
    if (/\.length$/.test(cr.path) === true) {
      return;
    }

    if (/__(\w+)__/.test(cr.path)) {
      this._logger.debug(`Ignoring internal change: ${cr.path}`);
      return;
    }

    if (cr.opts?.readonly) {
      this._logger.debug(`Ignoring readonly change: ${cr.path}`);
      return;
    }

    this._logger.debug(cr);

    const path = cr.path.split('.');
    if (/\.splices$/.test(cr.path) === true) {
      if (path.length < 4) {
        // Modification to base
        cr.value.indexSplices.forEach((i: any) => {
          if (i.opts?.readonly) {
            return;
          }

          if (i.addedCount > 0) {
            this._logger.error(`Deprecated - Base array index addition, the base array is now a map`);
            // const o = i.object[i.index];
            // if (!o.id) o.id = new ObjectId().toString();

            // this.__generateAddRequest(o);
          }

          i.removed.forEach((r: any) => {
            this._logger.debug(`this.__generateRmRequest(${r.id});`);
            this.__generateRmRequest(r.id)
              .then(() => {
                if (cr?.opts?.promise) {
                  cr.opts.promise.resolve();
                }
              }).catch((err) => {
                if (cr?.opts?.promise) {
                  cr.opts.promise.reject(err);
                }
              });
          });
        });
      } else {
        const entity = this._store.get(path.slice(0, 2).join('.'));

        this._logger.debug(entity);

        this._logger.debug('Child array mutation', cr);
        this._logger.debug('Index Splices: ', cr.value.indexSplices?.length);
        this._logger.debug('Key Splices: ', cr.value.keySplices?.length);

        if (cr.value.indexSplices?.length > 0) {
          cr.value.indexSplices.forEach((indexSplice: IndexSplice) => {
            const o = indexSplice.object[indexSplice.index];
            if (indexSplice.addedCount > 0) {
              // Remove datastore entity prefix
              path.splice(0,2);
              // Remove .splices
              path.splice(-1,1);
              if (typeof o === 'object' && !o.id) {
                o.id = new ObjectId().toHexString();
              }

              this.__generateUpdateRequest(entity.id, path.join('.'), o);
            } else if (indexSplice.removed.length > 0){
              if(indexSplice.removed.length > 1) {
                this._logger.debug('Index splice removed.length > 1', indexSplice.removed);
              } else {
                path.splice(0, 2);
                path.splice(-1, 1);
                path.push(indexSplice.index);
                path.push('__remove__');

                this.__generateUpdateRequest(entity.id, path.join('.'), '');
              }
            }
          });
        } else if (cr.value.keySplices) {
          this._logger.debug('Key Splices: ', cr.value.keySplices);
          // cr.value.keySplices.forEach((k, idx) => {
          //   k.removed.forEach(() => {
          //     const itemIndex = cr.value.indexSplices[idx].index;
          //     this._logger.debug(itemIndex);
    
          //     path.splice(0, 2); // drop the prefix
          //     path.splice(-1, 1); // drop the .splices
          //     path.push(itemIndex); // add the correct index
    
          //     // path.push(k.replace('#', ''));
          //     path.push('__remove__'); // add the remove command
          //     this._logger.debug(`this.__generateUpdateRequest(${entity.id}, ${path.join('.')}, '');`);
          //     // this.__generateUpdateRequest(entity.id, path.join('.'), '');
          //   });
          // });
        }
      }
    } else {
      if (path.length < 2) {
        // Path is a whole update to the collection so we'll ignore it
        return;
      }

      const isAddition = (path.length === 2);

      const pathToEntity = path.splice(0, 2).join('.');
      const item = this._store.get(pathToEntity);

      if (isAddition) {
        // Addition to a base object
        this.__generateAddRequest(item)
          .then(() => {
            if (cr?.opts?.promise) {
              cr.opts.promise.resolve();
            }
          }).catch((err) => {
            if (cr?.opts?.promise) {
              cr.opts.promise.reject(err);
            }
          });
        return;
      }

      this.__generateUpdateRequest(item.id, path.join('.'), cr.value);
    }

  }

  updateSchema(schema: ButtressSchema) {
    this._schema = schema;
  }

  async getById(id: string) {
    const storeEntity = this.get(`${this.name}.${id}`);
    if (storeEntity) return storeEntity;
    if (!this._settings) throw new Error('Unable to call query, setttings is still undefined');

    const entity = await this.__generateGetByIdRequest(id);
    this._store.set(this.name, new Map([...this.get(this.name), [entity.id, entity]]), {
      silent: true
    });

    return entity;
  }

  async query(buttressQuery: any, opts?: QueryOpts): Promise<QueryResult> {
    if (!this._settings) throw new Error('Unable to call query, setttings is still undefined');

    // We only need to make a call to fetch the data into our local store. We then
    // filter the data in the local store to get the results of the query.
    await this.search(buttressQuery, opts);

    // Fetch the total results count from buttress as the query maybe paged.
    const total = await this.count(buttressQuery);

    return this.__filterLocalData(buttressQuery, {
      limit: opts?.limit,
      skip: opts?.skip,
      total,
      sort: opts?.sort
    });
  }

  private __filterLocalData(buttressQuery: any, opts: {total: number, limit?: number, skip?: number, sort?: string}): QueryResult {
    let data = this._store.get(this.name);

    try {
      data = this.__processQueryPart(buttressQuery, Array.from(data.values()));
    } catch (err) {
      this._logger.error('Query was:', this.query);
      throw err;
    }

    if (opts?.sort) {
    //   data.sort((a: any, b: any) => this.__sort(a, b));
    }

    if (opts?.limit) {
      data = data.splice(opts.skip || 0, opts.limit);
    }

    return {
      skip: opts?.skip,
      limit: opts?.limit,
      total: opts.total,
      results: data
    };
  }

  private __processQueryPart(query: any, data: Array<any>) {
    let output = data.slice(0);

    for (const field of Object.keys(query)) {
      if (field === '$and') {
        // eslint-disable-next-line no-loop-func
        query[field].forEach((o: any) => {
          output = this.__processQueryPart(o, output);
        });
      } else if (field === '$or') {
        output = query[field]
          // eslint-disable-next-line no-loop-func
          .map((o: any) => this.__processQueryPart(o, output))
          .reduce((combined: any, results: any) => combined.concat(results.filter((r: any) => combined.indexOf(r) === -1)), []);
      } else {
        const command = query[field];
        for (const operator of Object.keys(command)) {
          output = this._queryFilterData(output, field, operator, command[operator]);
        }
      }
    }

    return output;
  }

  // eslint-disable-next-line class-methods-use-this
  private __parsePath(obj: any, path: string) {
    const value = this._store.get(path, obj);
    return Array.isArray(value) ? value : [value];
  }

  _queryFilterData(data: any, field: string, operator: string, operand: any) {
    const fns: {[key: string]: Function} = {
      $not: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex(val => val !== rhs) !== -1,
      $eq: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex(val => val === rhs) !== -1,
      $gt: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex(val => val > rhs) !== -1,
      $lt: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex(val => val < rhs) !== -1,
      $gte: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex(val => val >= rhs) !== -1,
      $lte: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex(val => val <= rhs) !== -1,
      $rex: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex(val => (new RegExp(rhs)).test(val)) !== -1,
      $rexi: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex(val => (new RegExp(rhs, 'i')).test(val)) !== -1,
      $in: (rhs: any) => (lhs: any) => rhs.indexOf(lhs[field]) !== -1,
      $nin: (rhs: any) => (lhs: any) => rhs.indexOf(lhs[field]) === -1,
      $exists: (rhs: any) => (lhs: any) => this.__parsePath(lhs, field).findIndex(val => val === undefined) === -1 === rhs,
      $inProp: (rhs: any) => (lhs: any) => lhs[field].indexOf(rhs) !== -1,
      $elMatch: (rhs: any) => (lhs: any) => this.__processQueryPart(rhs, this.__parsePath(lhs, field)).length > 0,
      $gtDate: (rhs: any) => {
        if (rhs === null) return false;
        const rhsDate = Sugar.Date.create(rhs);

        return (lhs: any) => this.__parsePath(lhs, field).findIndex(val => {
          if (val === null) return false; // Dont compare against null value
          return Sugar.Date.isBefore(rhsDate, val);
        }) !== -1;
      },
      $ltDate: (rhs: any) => {
        if (rhs === null) return false;
        const rhsDate = Sugar.Date.create(rhs);

        return (lhs: any) => this.__parsePath(lhs, field).findIndex(val => {
          if (val === null) return false; // Dont compare against null value
          return Sugar.Date.isAfter(rhsDate, val);
        }) !== -1;
      },
      $gteDate: (rhs: any) => {
        if (rhs === null) return false;
        const rhsDate = Sugar.Date.create(rhs);

        return (lhs: any) => this.__parsePath(lhs, field).findIndex(val => {
          if (val === null) return false; // Dont compare against null value
          return Sugar.Date.isBefore(rhsDate, val) || Sugar.Date.is(rhsDate, val);
        }) !== -1;
      },
      $lteDate: (rhs: any) => {
        if (rhs === null) return false;
        const rhsDate = Sugar.Date.create(rhs);

        return (lhs: any) => this.__parsePath(lhs, field).findIndex(val => {
          if (val === null) return false; // Dont compare against null value
          return Sugar.Date.isAfter(rhsDate, val) || Sugar.Date.is(rhsDate, val);
        }) !== -1;
      }
    };

    if (!fns[operator]) {
      this._logger.error(new Error(`Invalid operator: ${operator}`));
      return [];
    }

    return data.filter(fns[operator](operand));
  }

  async search(buttressQuery: any, opts?: QueryOpts): Promise<any> {
    if (!this._settings) return undefined;

    // Rules on busting the hash
    const hash = this._hashQuery({buttressQuery, limit: opts?.limit, skip: opts?.skip, sort: opts?.sort, project: opts?.project});
    const hashIdx = this._queryMap.indexOf(`${hash}`);
    if (opts?.bust && hashIdx !== -1) {
      this._queryMap.splice(hashIdx, 1);
    } else if (hashIdx !== -1) {
      return Promise.resolve(false);
    }

    const body = await this.__generateSearchRequest(buttressQuery, opts?.limit, opts?.skip, opts?.sort, opts?.project);

    this._store.set(this.name, new Map([...this.get(this.name), ...body.map((o: any) => [o.id, o])]), {
      silent: true
    });
    this._queryMap.push(`${hash}`);

    return body;
  }

  async count(buttressQuery: any): Promise<number> {
    return this.__generateCountRequest(buttressQuery);
  }

  _hashQuery(object: any) {
    const str = this.name + JSON.stringify(object);

    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i += 1) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
    }

    return hash;
  }

  private __updateQueue(): undefined {
    if (this._requestQueue.length === 0) {
      this.__awaitIdleQueue.forEach((resolve) => resolve(true));
      return;
    };
    if (this.status === 'working') return;
    // TODO: Debounce method
    this.__reduceRequests();
  }

  async nextIdle(): Promise<boolean> {
    return new Promise((r) => {
      queueMicrotask(() => {
        if (this._requestQueue.length === 0) {
          r(true);
          return;
        };

        this.__awaitIdleQueue.push(r);
      })
    });
  }

  // _generateListRequest(): Promise<void> {
  //   return this.__queueRequest({
  //     type: 'list',
  //     url: this.getUrl(),
  //     method: 'GET',
  //   });
  // }

  private __generateGetByIdRequest(entityId: string): Promise<ButtressEntity> {
    return this.__queueRequest({
      type: 'get',
      url: this.getUrl(entityId),
      method: 'GET',
    });
  }

  private __generateSearchRequest(query: any, limit: number = 0, skip: number = 0, sort: string, project: any): Promise<ButtressEntity[]> {
    return this.__queueRequest({
      type: 'search',
      url: this.getUrl(),
      method: 'SEARCH',
      contentType: 'application/json',
      body: {
        query,
        limit,
        skip,
        sort,
        project,
      },
    });
  }

  private __generateRmRequest(entityId: string) {
    return this.__queueRequest({
      type: 'delete',
      url: this.getUrl(entityId),
      entityId,
      method: 'DELETE',
    });
  }

  private __generateCountRequest(query: any): Promise<number> {
    return this.__queueRequest({
      type: 'count',
      url: this.getUrl('count'),
      method: 'SEARCH',
      body: {
        query,
      },
    });
  }

  private __generateAddRequest(entity: any) {
    return this.__queueRequest({
      type: 'add',
      url: this.getUrl(),
      entityId: -1,
      method: 'POST',
      contentType: 'application/json',
      body: entity
    });
  }

  private __generateUpdateRequest(entityId: string, path: string, value: string | number): Promise<void> {
    return this.__queueRequest({
      type: 'update',
      url: this.getUrl(entityId),
      entityId,
      method: 'PUT',
      contentType: 'application/json',
      body: {
        path,
        value
      }
    });
  }

  private __queueRequest(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;

      this._requestQueue.push(request);
      this.__updateQueue();
    });
  }

  // eslint-disable-next-line class-methods-use-this
  private __reduceRequests() {
    this.status = 'working';

    // Prioritise additions & deletions
    const requestIdx = this._requestQueue.findIndex((r) => r.type === 'add' || r.type === 'delete');
    let request = (requestIdx !== -1 && this.bundling) ? this._requestQueue.splice(requestIdx, 1).shift() : this._requestQueue.shift();

    if (this.bundling && this.BUNDLED_REQUESTS_TYPES.includes(request.type)) {
      this._logger.debug('bulk compatible request, trying to chunk:', request.type);
      const requests = [
        request,
        ...this._requestQueue.filter((r) => r.type === request.type)
          .splice(0, this.bundlingChunk - 1)
      ];

      if (requests.length > 1) {
        this._requestQueue = this._requestQueue.filter((r) => !requests.includes(r));

        request = {
          type: `bulk/${request.type}`,
          url: `${this.getUrl('bulk', request.type)}`,
          entityId: -1,
          method: 'POST',
          contentType: 'application/json',
          body: null,
          dependentRequests: requests,
        };

        if (request.type === 'bulk/update') {
          request.body = requests.map((rq) => ({
            id: rq.entityId,
            body: rq.body
          }));
        } else {
          request.body = requests.map((rq) => rq.body);
        }
      }
    }

    // const request = this._requestQueue.shift();
    return this.__generateRequest(request);
  }

  private async __generateRequest(request: any) {
    const body = (request.body) ? JSON.stringify(request.body) : null;
    try {
      const response = await fetch(`${request.url}?urq=${Date.now()}&token=${this._settings.token}`, {
        method: request.method,
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      })

      if (!response.ok) {
        const responseData = await response.json();
        const message = (responseData) ? responseData.message : '';
        throw new Error(`DS ERROR [${request.type}] ${message} - ${response.status} ${request.url} - ${response.statusText}`);
      }

      this.status = 'done';
      const data = await response.json();
      if (request.reject) request.resolve(data);
    } catch(err) {
      // will only reject on network failure or if anything prevented the request from completing.
      this._logger.error(err);

      if (request.reject) request.reject(err);
      this.status = 'error';
    } finally {
      this.__updateQueue();
    }
  }

  getUrl(...parts: string[]) {
    if (!this.core && this._settings.apiPath) {
      return `${this._settings.endpoint}/${this._settings.apiPath}/api/v1/${this.name}/${parts.join('/')}`;
    }

    return `${this._settings.endpoint}/api/v1/${this.name}/${parts.join('/')}`;
  }
}
