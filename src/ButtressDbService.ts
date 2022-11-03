import { html, css } from 'lit';
import { property } from 'lit/decorators.js';
import { LtnService, LtnLogLevel } from '@lighten/ltn-element';
// import { LtnSettingsService, ButtressSettings } from './LtnSettingsService.js';

import ButtressDataService from './ButtressDataService.js';
import {ButtressStore, ButtressStoreInterface, NotifyChangeOpts} from './ButtressStore.js';
import ButtressRealtime from './ButtressRealtime.js';

import ButtressSchema from './ButtressSchema.js';
import {ButtressSchemaFactory} from './ButtressSchemaFactory.js'

import { Settings } from './helpers.js';

export class ButtressDbService extends LtnService {
  static styles = css`
    :host {
      display: none;
    }
  `;

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

  private _store: ButtressStore;

  private _realtime: ButtressRealtime;

  private _settings: Settings = {};

  private _schema: {[key: string]: ButtressSchema} | null = null;

  private _dataServices: {[key: string]: ButtressDataService} = {};

  private _connected: boolean = false;

  private _awaitConnectionPool: Array<Function> = [];

  private _dsStoreInterface: ButtressStoreInterface;

  constructor() {
    super();

    const dispatchCustomEvent = (type: string, options: Event) => this.dispatchCustomEvent(type, options);

    // Route through the dataservices
    // const self = this;
    this._dsStoreInterface = {
      get: (path: string): any => this._getDataService(path).get(path),
      set: (path: string, value: any): string|undefined => this._getDataService(path).set(path, value),
      push: (path: string, ...items: any[]): number => this._getDataService(path).push(path, ...items),
      pushExt: (path: string, opts?: NotifyChangeOpts, ...items: any[]): number => this._getDataService(path).pushExt(path, opts, ...items),
      splice: (path: string, start: number, deleteCount?: number, ...items: any[]): any[] =>
        this._getDataService(path).splice(path, start, deleteCount, ...items),
      spliceExt: (path: string, start: number, deleteCount?: number, opts?: NotifyChangeOpts, ...items: any[]): any[] =>
        this._getDataService(path).spliceExt(path, start, deleteCount, opts, ...items)
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

  private async _fetchAppSchema() {
    this._debug('_fetchAppSchema', this._settings);
    if (!this._settings) return;

    // eslint-disable-next-line no-undef
    const req: RequestInfo = `${this._settings.endpoint}/api/v1/app/schema?urq${Date.now()}&token=${this._settings.token}`;

    // eslint-disable-next-line no-undef
    const init: RequestInit = {
      method: 'GET',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const response = await fetch(req, init);
    if (response.ok) {
      const body = await response.json();
      this._schema = body.reduce((obj: {[key: string]: ButtressSchema}, schema: ButtressSchema) => {
        obj[schema.name] = schema; // eslint-disable-line no-param-reassign
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
      if (dataServices.includes(name)) {
        this._dataServices[name].updateSchema(this._schema[name]);
      } else {
        this._dataServices[name] = new ButtressDataService(name, this._settings, this._store, this._schema[name]);
        if (this._settings.logLevel) {
          this._dataServices[name].setLogLevel(this._settings.logLevel);
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

  // eslint-disable-next-line class-methods-use-this
  get(path: string): any {
    return this._dsStoreInterface.get(path);
  }

  // eslint-disable-next-line class-methods-use-this
  set(path: string, value: any): string|undefined {
    return this._dsStoreInterface.set(path, value);
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

  getSchema(name: string | undefined): ButtressSchema | boolean {
    if (!name || !this._schema || !this._schema[name]) return false;
    return this._schema[name];
  }

  private _getDataService(path: string): ButtressDataService {
    const [root] = path.split('.');
    if (!this._dataServices[root]) throw new Error(`Unable to find data service with path part ${root}`);
    return this._dataServices[root];
  }

  createObject(path: string) : any {
    const schema = this.getSchema(path.split('.').shift());
    if (typeof schema === 'boolean') throw new Error(`Unable to find schmea for path ${path}`);
    
    return ButtressSchemaFactory.create(schema, path);
  }

  async query(dataService: string, buttressQuery: object) {
    const ds = this._dataServices[dataService];
    if (!ds) throw new Error('Unable to subscribe to path, data service doesn\'t exist');

    return ds.query(buttressQuery);
  }

  _resolveDataServiceFromPath(path: string): ButtressDataService | undefined {
    const [ds] = path.toString().split('.');
    return this._dataServices[ds]
  }

  setUserId(userId: string) {
    this._settings.userId = userId;
  }

  setToken(token: string) {
    this._settings.token = token;
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
    });

    if (update) {
      this.requestUpdate();
      // Trigger reconnection?
      // this.connect();
    }
  }

  render() {
    return html``;
  }
}
