import { LtnLogger, LtnLogLevel } from '@lighten/ltn-element';
import {ObjectId} from 'bson';

import ButtressSchema from './ButtressSchema.js';

import ButtressStore from './ButtressStore.js';

import {Settings} from './helpers.js';

export default class ButtressDataService {
  name: string;

  private _logger: LtnLogger;

  readonly BUNDLED_REQUESTS_TYPES: string[] = ['add', 'update'];

  private _store: ButtressStore;

  private _schema: ButtressSchema | undefined;

  private _settings: Settings;

  private _queryMap: Array<string> = [];

  private _requestQueue: Array<any> = [];

  status: string = 'pending';

  core: boolean = false;

  bundling: boolean = true;

  bundlingChunk: number = 100;

  constructor(name: string, settings: Settings, store: ButtressStore, schema?: ButtressSchema) {
    this.name = name;
    this._settings = settings;

    this._logger = new LtnLogger(`buttress-data-service-${name}`);

    if (schema) this.updateSchema(schema);

    this._store = store;

    this._store.subscribe(`${this.name}.*, ${this.name}`, (cr: any) => this._processDataChange(cr));
  }

  setLogLevel(level: LtnLogLevel) {
    this._logger.level = level;
  }

  // eslint-disable-next-line class-methods-use-this
  _processDataChange(cr: any) : void {
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
      if (path.length < 3) {
        // Modification to base
        cr.value.indexSplices.forEach((i: any) => {
          if (i.opts?.readonly) {
            return;
          }

          const o = i.object[i.index];
          if (i.addedCount > 0) {
            if (!o.id) o.id = new ObjectId().toString();

            this._generateAddRequest(o);
          }

          i.removed.forEach((r: any) => {
            this._logger.debug(`this.__generateRmRequest(${r.id});`);
            this._generateRmRequest(r.id);
          });
        });
      } else {

        const entity = this._store.get(path.slice(0,2));
        if (entity.__readOnlyChange__) {
          this._logger.debug(`Ignoring readonly change: ${cr.path}`);
          delete entity.__readOnlyChange__;
          return;
        }

        this._logger.debug(entity);

        this._logger.debug('Child array mutation', cr);
        this._logger.debug('Key Splices: ', cr.value.indexSplices.length);

        // if (cr.value.indexSplices.length > 0) {
        //   cr.value.indexSplices.forEach(i => {
        //     let o = i.object[i.index];
        //     if (i.addedCount > 0) {
        //       path.splice(0,2);
        //       path.splice(-1,1);
        //       // this._logger.debug('Update request', entity.id, path.join('.'), cr.value);
        //       if (typeof o === 'object' && !o.id) {
        //         o.id = AppDb.Factory.getObjectId();
        //       }
        //       this._logger.debug(`this.__generateUpdateRequest(${entity.id}, ${path.join('.')}, ${o});`);
        //       // this.__generateUpdateRequest(entity.id, path.join('.'), o);
        //     } else if (i.removed.length > 0){
        //       if(i.removed.length > 1) {
        //         this._logger.debug('Index splice removed.length > 1', i.removed);
        //       } else {
        //         path.splice(0, 2);
        //         path.splice(-1, 1);
        //         path.push(i.index);
        //         path.push('__remove__');

        //         this._logger.debug(`this.__generateUpdateRequest(${entity.id}, ${path.join('.')}, '');`);
        //         // this.__generateUpdateRequest(entity.id, path.join('.'), '');
        //       }
        //     }
        //   });
        // } else if (cr.value.keySplices) {
        //   this._logger.debug('Key Splices: ', cr.value.keySplices.length);
        //   cr.value.keySplices.forEach((k, idx) => {
        //     k.removed.forEach(() => {
        //       let itemIndex = cr.value.indexSplices[idx].index;
        //       this._logger.debug(itemIndex);
    
        //       path.splice(0, 2); // drop the prefix
        //       path.splice(-1, 1); // drop the .splices
        //       path.push(itemIndex); // add the correct index
    
        //       // path.push(k.replace('#', ''));
        //       path.push('__remove__'); // add the remove command
        //       this.__generateUpdateRequest(entity.id, path.join('.'), '');
        //     });
        //   });
        // }
      }
    } else {
      if (path.length < 2) {
        // Path is a whole update to the collection so we'll ignore it
        return;
      }

      const pathToEntity = path.splice(0, 2).join('.');
      const item = this._store.get(pathToEntity);

      this._generateUpdateRequest(item.id, path.join('.'), cr.value);
    }

  }

  updateSchema(schema: ButtressSchema) {
    this._schema = schema;
  }

  async query(buttressQuery: any): Promise<any> {
    if (!this._settings) return undefined;

    await this.search(buttressQuery);

    return this._filterLocalData(buttressQuery);
  }

  _filterLocalData(buttressQuery: any, opts?: {sortPath?: string}): Array<any> {
    let data = this._store.get(this.name);

    try {
      data = this._processQueryPart(buttressQuery, data);
    } catch (err) {
      console.error('Query was:', this.query);
      throw err;
    }

    if (opts?.sortPath) {
    //   data.sort((a: any, b: any) => this.__sort(a, b));
    }

    return data;
  }

  _processQueryPart(query: any, data: Array<any>) {
    let output = data.slice(0);

    for (const field of Object.keys(query)) {
      if (field === '$and') {
        // eslint-disable-next-line no-loop-func
        query[field].forEach((o: any) => {
          output = this._processQueryPart(o, output);
        });
      } else if (field === '$or') {
        output = query[field]
          // eslint-disable-next-line no-loop-func
          .map((o: any) => this._processQueryPart(o, output))
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
  _parsePath(obj: any, path: string) {
    const value = this._store.get(path, obj);
    return Array.isArray(value) ? value : [value];
  }

  _queryFilterData(data: any, field: string, operator: string, operand: any) {
    const fns: {[key: string]: Function} = {
      $not: (rhs: any) => (lhs: any) => this._parsePath(lhs, field).findIndex(val => val !== rhs) !== -1,
      $eq: (rhs: any) => (lhs: any) => this._parsePath(lhs, field).findIndex(val => val === rhs) !== -1,
      $gt: (rhs: any) => (lhs: any) => this._parsePath(lhs, field).findIndex(val => val > rhs) !== -1,
      $lt: (rhs: any) => (lhs: any) => this._parsePath(lhs, field).findIndex(val => val < rhs) !== -1,
      $gte: (rhs: any) => (lhs: any) => this._parsePath(lhs, field).findIndex(val => val >= rhs) !== -1,
      $lte: (rhs: any) => (lhs: any) => this._parsePath(lhs, field).findIndex(val => val <= rhs) !== -1,
      $rex: (rhs: any) => (lhs: any) => this._parsePath(lhs, field).findIndex(val => (new RegExp(rhs)).test(val)) !== -1,
      $rexi: (rhs: any) => (lhs: any) => this._parsePath(lhs, field).findIndex(val => (new RegExp(rhs, 'i')).test(val)) !== -1,
      $in: (rhs: any) => (lhs: any) => rhs.indexOf(lhs[field]) !== -1,
      $nin: (rhs: any) => (lhs: any) => rhs.indexOf(lhs[field]) === -1,
      $exists: (rhs: any) => (lhs: any) => this._parsePath(lhs, field).findIndex(val => val === undefined) === -1 === rhs,
      $inProp: (rhs: any) => (lhs: any) => lhs[field].indexOf(rhs) !== -1,
      $elMatch: (rhs: any) => (lhs: any) => this._processQueryPart(rhs, this._parsePath(lhs, field)).length > 0,
      // $gtDate: (rhs: any) => {
      //   if (rhs === null) return false;
      //   const rhsDate = Sugar.Date.create(rhs);

      //   return (lhs: any) => this._parsePath(lhs, field).findIndex(val => {
      //     if (val === null) return false; // Dont compare against null value
      //     return Sugar.Date.isBefore(rhsDate, val);
      //   }) !== -1;
      // },
      // $ltDate: (rhs: any) => {
      //   if (rhs === null) return false;
      //   const rhsDate = Sugar.Date.create(rhs);

      //   return (lhs: any) => this._parsePath(lhs, field).findIndex(val => {
      //     if (val === null) return false; // Dont compare against null value
      //     return Sugar.Date.isAfter(rhsDate, val);
      //   }) !== -1;
      // },
      // $gteDate: (rhs: any) => {
      //   if (rhs === null) return false;
      //   const rhsDate = Sugar.Date.create(rhs);

      //   return (lhs: any) => this._parsePath(lhs, field).findIndex(val => {
      //     if (val === null) return false; // Dont compare against null value
      //     return Sugar.Date.isBefore(rhsDate, val) || Sugar.Date.is(rhsDate, val);
      //   }) !== -1;
      // },
      // $lteDate: (rhs: any) => {
      //   if (rhs === null) return false;
      //   const rhsDate = Sugar.Date.create(rhs);

      //   return (lhs: any) => this._parsePath(lhs, field).findIndex(val => {
      //     if (val === null) return false; // Dont compare against null value
      //     return Sugar.Date.isAfter(rhsDate, val) || Sugar.Date.is(rhsDate, val);
      //   }) !== -1;
      // }
    };

    if (!fns[operator]) {
      console.error(new Error(`Invalid operator: ${operator}`));
      return [];
    }

    return data.filter(fns[operator](operand));
  }

  async search(buttressQuery: any): Promise<any> {
    if (!this._settings) return undefined;

    const hash = this._hashQuery(buttressQuery);
    if (this._queryMap.indexOf(`${hash}`) !== -1) return Promise.resolve(false);

    const req: RequestInfo = `${this._settings.endpoint}/${this._settings.apiPath}/api/v1/${this.name}?urq${Date.now()}&token=${this._settings.token}`;
    const init: RequestInit = {
      method: 'GET',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const response = await fetch(req, init);
    let body = null;
    if (response.ok) {
      body = await response.json();
      // this.set(this.name, body);
      this._store.set(this.name, body, {
        silent: true
      });
      this._queryMap.push(`${hash}`);
    } else {
      throw new Error(`Buttress Error: ${response.status}: ${response.statusText}`);
    }

    return body;
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

  _updateQueue(): undefined {
    if (this._requestQueue.length === 0) return;
    if (this.status === 'working') return;
    // TODO: Debounce method
    this._reduceRequests();
  }

  _generateListRequest(): Promise<void> {
    return this._queueRequest({
      type: 'list',
      url: this.getUrl(),
      method: 'GET',
    });
  }

  _generateGetRequest(entityId: string): Promise<void> {
    return this._queueRequest({
      type: 'get',
      url: this.getUrl(entityId),
      method: 'GET',
    });
  }

  _generateSearchRequest(query: any, limit: number = 0, skip: number = 0, sort: string, project: any): Promise<void> {
    return this._queueRequest({
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

  _generateRmRequest(entityId: string) {
    return this._queueRequest({
      type: 'delete',
      url: this.getUrl(entityId),
      entityId,
      method: 'DELETE',
    });
  }

  _generateCountRequest(query: any): Promise<void> {
    return this._queueRequest({
      type: 'count',
      url: this.getUrl('count'),
      method: 'SEARCH',
      body: {
        query,
      },
    });
  }

  _generateAddRequest(entity: any) {
    return this._queueRequest({
      type: 'add',
      url: this.getUrl(),
      entityId: -1,
      method: 'POST',
      contentType: 'application/json',
      body: entity
    });
  }

  _generateUpdateRequest(entityId: string, path: string, value: string | number): Promise<void> {
    return this._queueRequest({
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

  _queueRequest(request: any): Promise<void> {
    return new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;

      this._requestQueue.push(request);
      this._updateQueue();
    });
  }

  // eslint-disable-next-line class-methods-use-this
  _reduceRequests() {
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
    return this._generateRequest(request);
  }

  async _generateRequest(request: any) {
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

      if (response.ok) {
        this.status = 'done';
      } else {
        // Handle Buttress Error
        throw new Error(`DS ERROR [${request.type}] ${response.status} ${request.url} - ${response.statusText}`);
      }
    } catch(err) {
      // will only reject on network failure or if anything prevented the request from completing.
      console.error(err);

      if (request.reject) request.reject(err);
      this.status = 'error';
    } finally {
      this._updateQueue();
    }
  }

  getUrl(...parts: string[]) {
    if (!this.core && this._settings.apiPath) {
      return `${this._settings.endpoint}/${this._settings.apiPath}/api/v1/${this.name}/${parts.join('/')}`;
    }

    return `${this._settings.endpoint}/${this._settings.apiPath}/${this.name}/${parts.join('/')}`;
  }

  // set(path: string, value: any): string|undefined {
  //   // const parts = path.toString().split('.');
  //   // parts.unshift(this.name);
  //   // return this._store.set(parts.join('.'), value);
  //   return this._store.set(path, value);
  // }

  // TODO: process a change

  // TODO: Handle subscriptions

  // Handle updates
}
