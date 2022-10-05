import {io} from 'socket.io-client';

import ButtressStore from "./ButtressStore.js";

import {Settings} from './helpers.js';

export default class ButtressDataRealtime {

  private _store: ButtressStore;

  private _settings: Settings;

  private _socket: any;

  private _connected: boolean = false;

  private readonly _rxEvents: string[] = [
    'db-activity',
    'clear-local-db',
    'db-connect-room',
    'db-disconnect-room',
  ];

  constructor(store: ButtressStore, settings: Settings) {
    this._store = store;
    this._settings = settings;
  }

  connect() {
    if (!this._settings?.endpoint) {
      throw new Error(`Missing setting 'endpoint' while trying to connect to buttress`);
    }
    if (!this._settings?.token) {
      throw new Error(`Missing setting 'endpoint' while trying to connect`);
    }

    const uri = (this._settings?.apiPath) ? `${this._settings.endpoint}/${this._settings.apiPath}` : this._settings.endpoint;

    try {
      this._socket = io(uri, {
        query: {
          token: this._settings.token
        }
      });
      this._socket.on('connect',() => {
        this._connected = true;
        this._configureRxEvents();
      });
      this._socket.on('disconnect',() => {
        this._connected = false;
      });
    } catch (err) {
      this._connected = false;
      console.error(err);
    }
  }

  private _configureRxEvents() {
    this._rxEvents.forEach((ev) => {
      this._socket.on(ev, (data: any) => this._handleRxEvent(data));
    });
  }

  // eslint-disable-next-line class-methods-use-this
  private _handleRxEvent(data: any) {
    console.log(data);
  }

}