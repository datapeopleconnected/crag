import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { LtnService, LtnLogLevel } from '@lighten/ltn-element';
// import { LtnSettingsService, ButtressSettings } from './LtnSettingsService.js';

import ButtressDataService, { QueryOpts } from './ButtressDataService.js';
import {ButtressStore, ButtressStoreInterface, ButtressEntity, NotifyChangeOpts} from './ButtressStore.js';
import ButtressRealtime from './ButtressRealtime.js';

import ButtressSchema from './ButtressSchema.js';
import {ButtressSchemaFactory} from './ButtressSchemaFactory.js';

import { Settings } from './helpers.js';

export interface customButtressStoreInterface extends ButtressStoreInterface {
  clearQueryMap: Function,
}

export class ButtressDbService extends LtnService {
  // @property({ type: String, attribute: false }) endpoint = "hello";
  // private _endpoint: String = "hello";asd

  @property({type: String})
  endpoint?: string;

  @property({type: String})
  token?: string;

  @property({type: String, attribute: 'api-path'})
  apiPath?: string;

  @property({type: String})
  userId?: string;

  @property({type: Array, attribute: 'core-schema'})
  coreSchema?: Array<string>;

  private _store: ButtressStore;

  private _realtime: ButtressRealtime;

  private _settings: Settings = {};

  private _schema: {[key: string]: ButtressSchema} | null = null;

  private _dataServices: {[key: string]: ButtressDataService} = {};

  private _connected: boolean = false;

  private _awaitConnectionPool: Array<Function> = [];

  private _dsStoreInterface: customButtressStoreInterface;

  constructor() {
    super();

    const dispatchCustomEvent = (type: string, options: Event) => this.dispatchCustomEvent(type, options);

    // Route through the dataservices
    // const self = this;
    this._dsStoreInterface = {
      create: (service: string, value: ButtressEntity, opts?: NotifyChangeOpts): string|undefined => this._getDataService(service).create(value, opts),
      delete: (service: string, id: string, opts?: NotifyChangeOpts): boolean => this._getDataService(service).delete(id, opts),

      get: (path: string): any => this._getDataService(path).get(path),
      set: (path: string, value: any, opts?: NotifyChangeOpts): string|undefined => this._getDataService(path).set(path, value, opts),
      push: (path: string, ...items: any[]): number => this._getDataService(path).push(path, ...items),
      pushExt: (path: string, opts?: NotifyChangeOpts, ...items: any[]): number => this._getDataService(path).pushExt(path, opts, ...items),
      splice: (path: string, start: number, deleteCount?: number, ...items: any[]): any[] =>
        this._getDataService(path).splice(path, start, deleteCount, ...items),
      spliceExt: (path: string, start: number, deleteCount?: number, opts?: NotifyChangeOpts, ...items: any[]): any[] =>
        this._getDataService(path).spliceExt(path, start, deleteCount, opts, ...items),
      notifyPath: (path: string, value: any, opts?: NotifyChangeOpts): boolean => this._getDataService(path).notifyPath(path, value, opts),
      clearQueryMap: (path: string) => this._getDataService(path).clearQueryMap(),
    };

    // Store
    this._store = new ButtressStore();

    // TODO: Pass through data service catpure 
    this._realtime = new ButtressRealtime(this._dsStoreInterface, this._settings, dispatchCustomEvent);
  }

  connectedCallback(): void {
    super.connectedCallback();

    this._settings.endpoint = this.endpoint;
    this._settings.token = this.token;
    this._settings.apiPath = this.apiPath;
    this._settings.userId = this.userId;
    this._settings.coreSchema = (this.coreSchema && this.coreSchema.length > 0) ? this.coreSchema : [];
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._debug(`disconnectedCallback`);
  }

  isDbConnected(): boolean {
    return this._connected;
  }

  async connect() {
    if (!this._settings.endpoint) {
      throw new Error(`Missing required setting 'endpoint'`);
    }
    if (!this._settings.token) {
      throw new Error(`Missing required setting 'token'`);
    }
    if (!this._settings.apiPath) {
      throw new Error(`Missing required setting 'apiPath'`);
    }

    await this._connect();
    await this._realtime.connect();
  }

  private async _connect() {
    this._connected = false;
    if (!this._settings?.endpoint) {
      throw new Error(`Missing setting 'endpoint' while trying to connect to buttress`);
    }
    if (!this._settings?.token) {
      throw new Error(`Missing setting 'token' while trying to connect`);
    }

    // Test the connection to buttress

    // Kick off realtime sync

    await this._fetchAppSchema();
    // TODO: Handle errors

    await this._refreshLocalDataServices();

    for (let i = this._awaitConnectionPool.length - 1; i >= 0; i -= 1) {
      this._awaitConnectionPool[i]();
      this._awaitConnectionPool.splice(i, 1);
    }
    this._connected = true;
  }

  // eslint-disable-next-line class-methods-use-this
  private _bjsRequest(method: string, path: string, token: string, body?: any, headers?: { [key: string]: string }, queryString?: any) {
    const qs = new URLSearchParams({urq: Date.now(), ...queryString});

    return fetch(`${path}?${qs.toString()}`, {
      method,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...headers,
      },
      body: (body) ? JSON.stringify(body) : undefined,
    });
  }

  private async _fetchAppSchema() {
    this._debug('_fetchAppSchema', this._settings);
    if (!this._settings) return;

    const token = this._settings.token || '';
    const coreSchema: string[] = (this._settings.coreSchema) ? (this._settings.coreSchema) : [];

    const response = await this._bjsRequest('GET', `${this._settings.endpoint}/api/v1/app/schema`, token, null, {core: coreSchema.join(',')});
    if (response.ok) {
      const body = await response.json();
      this._schema = body.reduce((obj: {[key: string]: ButtressSchema}, schema: ButtressSchema) => {
        const schemaName = (schema.core) ? this._stripTrailingS(schema.name) : schema.name;
        obj[schemaName] = schema; // eslint-disable-line no-param-reassign
        return obj;
      }, {});
      this._debug(body);
    } else {
      throw new Error(
        `Buttress Error: ${response.status}: ${response.statusText}`
      );
    }
  }

  private async _refreshLocalDataServices() {
    if (!this._schema || !this._settings) return;

    const schemas: string[] = Object.keys(this._schema || []);
    const dataServices: string[] = Object.keys(this._dataServices || []);

    const obsoleteDataServices = dataServices.filter((name) => !schemas.includes(name));
    schemas.forEach((name) => {
      if (!this._schema) return;
      const schema = this._schema[name];
      // TODO change apps and users api to app and user to be consistent with the endpoints
      const endpointName = (schema.core) ? this._stripTrailingS(name) : schema.name;
      if (dataServices.includes(endpointName)) {
        this._dataServices[endpointName].updateSchema(this._schema[name]);
      } else {
        const isCore = (schema.core === true);
        this._dataServices[endpointName] = new ButtressDataService(endpointName, isCore, this._settings, this._store, this._schema[name]);
        if (this._settings.logLevel) {
          this._dataServices[endpointName].setLogLevel(this._settings.logLevel);
        }
      }
    });

    obsoleteDataServices.forEach((name) => delete this._dataServices[name]);
  }

  async awaitConnection(): Promise<boolean> {
    if (this._connected) return true;

    await new Promise((r) => this._awaitConnectionPool.push(r));

    this._debug('awaited');

    return true;
  }

  protected _setLogLevel(level: LtnLogLevel) {
    super._setLogLevel(level);

    this._settings.logLevel = level;

    this._realtime.setLogLevel(level);
    this._store.setLogLevel(level);

    const dataServices: string[] = Object.keys(this._dataServices || []);
    dataServices.forEach((key) => this._dataServices[key].setLogLevel(level));
  }

  create(path: string, value: ButtressEntity, opts?: NotifyChangeOpts): string | undefined {
    const parts = path.toString().split('.');
    if (parts.length > 1) throw new Error('Create is only avaible for top level entities');
    const [schema] = parts;

    return this._dsStoreInterface.create(schema, value, opts);
  }

  delete(path: string, opts?: NotifyChangeOpts): boolean {
    const parts = path.toString().split('.');
    if (parts.length > 2) throw new Error('Delete is only avaible for top level entities');
    const [schema, id] = parts;

    return this._dsStoreInterface.delete(schema, id, opts);
  }

  // eslint-disable-next-line class-methods-use-this
  get<T extends ButtressEntity>(path: string): T | undefined {
    return this._dsStoreInterface.get(path);
  }

  // eslint-disable-next-line class-methods-use-this
  set(path: string, value: any, opts?: NotifyChangeOpts): string | undefined {
    return this._dsStoreInterface.set(path, value, opts);
  }

  // eslint-disable-next-line class-methods-use-this
  push(path: string, ...items: any[]): number {
    return this._dsStoreInterface.push(path, ...items);
  }

  // eslint-disable-next-line class-methods-use-this
  splice(path: string, start: number, deleteCount?: number, ...items: any[]): any[] {
    return this._dsStoreInterface.splice(path, start, deleteCount, ...items);
  }

  // eslint-disable-next-line class-methods-use-this
  subscribe(path: string, cb: Function): string {
    return this._store.subscribe(path, cb);
  }

  unsubscribe(id: string): boolean {
    return this._store.unsubscribe(id);
  }

  async nextIdle(dataService: string) {
    return this._getDataService(dataService).nextIdle();
  }

  getSchema(name: string | undefined): ButtressSchema | boolean {
    if (!name || !this._schema || !this._schema[name]) return false;
    return this._schema[name];
  }

  private _getDataService(path: string): ButtressDataService {
    const [root] = path.split('.');
    if (!this._dataServices[root]) throw new Error(`Unable to find data service with path part ${root}`);
    return this._dataServices[root];
  }

  createObject<T extends ButtressEntity>(path: string) : T {
    const schema = this.getSchema(path.split('.').shift());
    if (typeof schema === 'boolean') throw new Error(`Unable to find schema for path ${path}`);

    return ButtressSchemaFactory.create(schema, path) as T;
  }

  async getById<T extends ButtressEntity>(dataService: string, entityId: string): Promise<T | undefined> {
    if (!entityId) throw new Error('Unable to get property without an id');

    const ds = this._dataServices[dataService];
    if (!ds) throw new Error('Unable to subscribe to path, data service doesn\'t exist');

    return await ds.getById(entityId) as T;
  }

  async query(dataService: string, buttressQuery: any, opts?: QueryOpts) {
    const ds = this._dataServices[dataService];
    if (!ds) throw new Error('Unable to subscribe to path, data service doesn\'t exist');

    return ds.query(buttressQuery, opts);
  }

  async count(dataService: string, buttressQuery: any) {
    const ds = this._dataServices[dataService];
    if (!ds) throw new Error('Unable to subscribe to path, data service doesn\'t exist');

    return ds.count(buttressQuery);
  }

  _resolveDataServiceFromPath(path: string): ButtressDataService | undefined {
    const [ds] = path.toString().split('.');
    return this._dataServices[ds]
  }

  getEndpoint() {
    return this._settings.endpoint;
  }

  getUserId() {
    return this._settings.userId;
  }

  getToken() {
    return this._settings.token;
  }

  getCoreSchemas() {
    return this._settings.coreSchema;
  }

  setEndpoint(endpoint: string) {
    this._settings.endpoint = endpoint;
  }

  setUserId(userId: string) {
    this._settings.userId = userId;
  }

  setToken(token: string) {
    this._settings.token = token;
  }

  async setApiPath(apiPath: string) {
    this._settings.apiPath = apiPath;
  }

  setCoreSchemas(coreSchema: Array<string>) {
    this._settings.coreSchema = coreSchema;
  }

  updated(changedProperties: Map<string, unknown>) {
    let update = false;
    changedProperties.forEach((oldValue, propName) => {
      if (propName === 'endpoint') {
        this._settings.endpoint = this.endpoint;
        update = true;
      }
      else if (propName === 'token') {
        this._settings.token = this.token;
        update = true;
      }
      else if (propName === 'apiPath') {
        this._settings.apiPath = this.apiPath;
        update = true;
      }
      else if (propName === 'userId') {
        this._settings.userId = this.userId;
        update = true;
      }
      else if (propName === 'coreSchema') {
        this._settings.coreSchema = this.coreSchema;
        update = true;
      }
    });

    if (update) {
      this.requestUpdate();
      // Trigger reconnection?
      // this.connect();
    }
  }

  // eslint-disable-next-line class-methods-use-this
  _stripTrailingS(word: string): string {
    const lastLetter = word.slice(-1);
    let output = word;
    if (lastLetter === 's') {
      output = word.substring(0 , word.length - 1);
    }

    return output;
  }

  async addLambda(lambda: ButtressEntity, auth: any, apiPath: string) {
    const {endpoint, token} = this._settings;

    try {
      if (!endpoint || !token) {
        throw new Error('Invalid Buttress endpoint or a token');
      }

      const res = await this._bjsRequest('POST', `${endpoint}/api/v1/lambda`, token, {
        lambda,
        auth,
      }, {apiPath});

      const outcome = await res.json();
      if (res.status !== 200) throw new Error(outcome.message);

      return true;
    } catch(err: any) {
      throw new Error(err);
    }
  }

  async deployLambda(lambda: ButtressEntity, apiPath: string) {
    const {endpoint, token} = this._settings;

    try {
      if (!endpoint || !token) {
        throw new Error('Invalid Buttress endpoint or a token');
      }

      const res = await this._bjsRequest('PUT', `${endpoint}/api/v1/lambda/${lambda.id}/deployment`, token, {
        branch: lambda.git.branch,
        hash: lambda.git.hash,
      }, {apiPath});

      const outcome = await res.json();
      if (res.status !== 200) throw new Error(outcome.message);

      return true;
    } catch (err: any) {
      throw new Error(err);
    }
  }

  async addDataSharing(appDataSharing: ButtressEntity, apiPath: string) {
    const {endpoint, token} = this._settings;

    try {
      if (!endpoint || !token) {
        throw new Error('Invalid Buttress endpoint or a token');
      }

      const res = await this._bjsRequest('POST', `${endpoint}/api/v1/app-data-sharing`, token, appDataSharing, {apiPath});

      const outcome = await res.json();
      if (res.status !== 200) throw new Error(outcome.message);

      return outcome.remoteAppToken;
    } catch(err: any) {
      throw new Error(err);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  async addSchema(apiPath: string, schema: any) {
    const {endpoint, token} = this._settings;

    try {
      if (!endpoint || !token) {
        throw new Error('Invalid Buttress endpoint or a token');
      }

      const res = await this._bjsRequest('PUT', `${endpoint}/api/v1/app/schema`, token, schema, {apiPath});

      const outcome = await res.json();
      if (res.status !== 200) throw new Error(outcome.message);

      return true;
    } catch(err: any) {
      throw new Error(err);
    }
  }

  async updateAppPolicySelectors(apiPath: string, policySelectorsList: any) {
    const {endpoint, token} = this._settings;

    try {
      if (!endpoint || !token) {
        throw new Error('Invalid Buttress endpoint or a token');
      }

      const res = await this._bjsRequest('PUT', `${endpoint}/api/v1/app/policy-property-list`, token, policySelectorsList, {apiPath});

      const outcome = await res.json();
      if (res.status !== 200) throw new Error(outcome.message);

      return true;
    } catch(err: any) {
      throw new Error(err);
    }
  }

  async activateDataSharing(dataSharingId: string, apiPath: string, remoteToken: string): Promise<boolean> {
    const {endpoint, token} = this._settings;

    try {
      if (!endpoint || !token) {
        throw new Error('Invalid Buttress endpoint or a token');
      }

      const res = await this._bjsRequest('PUT', `${endpoint}/api/v1/app-data-sharing/${dataSharingId}/token`, token, {
        token: remoteToken
      }, {apiPath});

      const outcome = await res.json();
      if (res.status !== 200) throw new Error(outcome.message);

      return true;
    } catch(err: any) {
      throw new Error(err);
    }
  }

  render() {
    return html``;
  }
}
