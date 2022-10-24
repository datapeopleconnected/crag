import { html, css } from 'lit';
import { property } from 'lit/decorators.js';
import { LtnService, LtnLogLevel } from '@lighten/ltn-element';
// import { LtnSettingsService, ButtressSettings } from './LtnSettingsService.js';

import ButtressDataService from './ButtressDataService.js';
import ButtressStore from './ButtressStore.js';
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

  private _subscriptions: Array<{path:string, cb: Function}> = [];

  private _connected: boolean = false;

  private _awaitConnectionPool: Array<Function> = [];

  constructor() {
    super();

    const dispatchCustomEvent = (type: string, options: Event) => this.dispatchEvent(new CustomEvent(type, options));

    this._store = new ButtressStore();
    this._realtime = new ButtressRealtime(this._store, this._settings, dispatchCustomEvent);
  }

  connectedCallback(): void {
    super.connectedCallback();

    console.log('test');

    this._settings.endpoint = this.endpoint;
    this._settings.token = this.token;
    this._settings.apiPath = this.apiPath;
    this._settings.userId = this.userId;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._debug(`disconnectedCallback`);
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
      throw new Error(`Missing setting 'endpoint' while trying to connect`);
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

    const req: RequestInfo = `${this._settings.endpoint}/api/v1/app/schema?urq${Date.now()}&token=${this._settings.token}`;

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
    return this._store.get(path);
  }

  // eslint-disable-next-line class-methods-use-this
  set(path: string, value: any): string|undefined {
    return this._store.set(path, value);
  }

  // eslint-disable-next-line class-methods-use-this
  push(path: string, ...items: any[]): number {
    return this._store.push(path, ...items);
  }

  // eslint-disable-next-line class-methods-use-this
  splice(path: string, start: number, deleteCount?: number, ...items: any[]): any[] {
    if (arguments.length < 3) {
      return this._store.splice(path, start);
    }

    return this._store.splice(path, start, deleteCount, ...items);
  }

  // eslint-disable-next-line class-methods-use-this
  subscribe(path: string, cb: Function): boolean {
    this._store.subscribe(path, cb);
    return true;
  }

  getSchema(name: string | undefined): ButtressSchema | boolean {
    if (!name || !this._schema || !this._schema[name]) return false;
    return this._schema[name];
  }

  createObject(path: string) : any {
    const parts = path.split('.');
    const schema = this.getSchema(parts.shift());
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
