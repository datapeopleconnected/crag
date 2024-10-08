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

import {io} from 'socket.io-client';
import Sugar from 'sugar';

import {LtnLogger, LtnLogLevel} from '@lighten/ltn-element';

import {customButtressStoreInterface} from "./ButtressDbService.js";

import {Settings} from './helpers.js';

interface PathParts {
  collectionName: string,
  id: string,
};

export default class ButtressDataRealtime {

  private _logger: LtnLogger;

  private _store: customButtressStoreInterface;

  private _settings: Settings;

  private _socket: any;

  private _synced: boolean = false;

  private _lastSequence: {[key: string]: number} = {};

  private _dispatchCustomEvent: Function;

  private _isConnected: boolean = false;

  private readonly _rxEvents: string[] = [
    'db-activity',
    'clear-local-db',
    'db-connect-room',
    'db-disconnect-room',
  ];

  constructor(store: customButtressStoreInterface, settings: Settings, dispatchCustomEvent: Function) {
    this._store = store;
    this._settings = settings;

    this._logger = new LtnLogger('buttress-data-realtime');

    this._dispatchCustomEvent = dispatchCustomEvent;
  }

  connect() {
    if (!this._settings?.endpoint) {
      throw new Error(`Missing setting 'endpoint' while trying to connect to buttress`);
    }
    if (!this._settings?.token) {
      throw new Error(`Missing setting 'endpoint' while trying to connect`);
    }

    const uri = (this._settings?.apiPath) ? `${this._settings.endpoint}/${this._settings.apiPath}` : this._settings.endpoint;

    this._logger.debug(`Opening connection to ${uri}`);

    this._dispatchCustomEvent('bjs-connection-changed', {
      detail: true,
      bubbles: true,
      composed: true
    });

    try {
      this._socket = io(uri, {
        query: {
          token: this._settings.token
        }
      });
      this._socket.on('connect', () => this._onConnected());
      this._socket.on('disconnect', () => this._onDisconnected());
      this._configureRxEvents();
    } catch (err) {
      this._onDisconnected();
      this._logger.error(err);
    }
  }

  set _connected(state: boolean) {
    this._isConnected = state;
    this._logger.debug(state ? `Connected` : `Disconnected`);
    this._dispatchCustomEvent('bjs-connection-changed', {
      detail: state,
      bubbles: true,
      composed: true
    });
  }

  private _onConnected() {
    this._connected = true;
  }

  private _onDisconnected() {
    this._connected = false;
  }

  setLogLevel(level: LtnLogLevel) {
    this._logger.level = level;
  }

  private _configureRxEvents() {
    this._rxEvents.forEach((eventName) => {
      this._socket.on(eventName, (payload: any) => this._handleRxEvent(eventName, payload));
    });
  }

  // eslint-disable-next-line class-methods-use-this
  private _handleRxEvent(type:string, payload: any) {
    this._logger.debug(`RX Event type:${type} `, payload);
    if (type === 'db-connect-room') {
      this._loadAccessControlData(payload);
    } else if (type === 'db-disconnect-room') {
      this._clearAccessControlQueryHash(payload);
    } else if (type === 'clear-local-db') {
      // this._clearUserLocaldata(data);
      // Do stuff
    } else if (type === 'db-activity') {
      // Do stuff
      this._dbActivity(payload);
    } else {
      // Log out somthing
    }
  }

  private _dbActivity(payload: any) {
    const lastSequence = this._lastSequence[payload.room];

    if (lastSequence) {
      if (lastSequence === payload.sequence) {
        this._synced = false;
      }
      if (lastSequence + 1 !== payload.sequence) {
        this._synced = false;
      }
    }

    if (this._settings?.userId !== payload.data.user || payload.isSameApp === false) {
      this._parsePayload(payload.data);
    }

    this._lastSequence[payload.room] = payload.sequence;
  }

  // eslint-disable-next-line class-methods-use-this
  private async _loadAccessControlData(payload: any) {
    const userId = this._settings?.userId;
    const apiPath = this._settings?.apiPath;
    if (userId !== payload.userId || payload.apiPath !== apiPath) return;

    const {collections} = payload;
    if (!collections || (collections && collections.length < 1)) return;

    for await (const collection of collections) {
      this._store.notifyPath(collection, undefined, {forceChanged: true});
    }

    this._lastSequence[payload.room] = 0;
  }

  // eslint-disable-next-line class-methods-use-this
  private async _clearAccessControlQueryHash(payload: any) {
    const userId = this._settings?.userId;
    const apiPath = this._settings?.apiPath;
    if (userId !== payload.userId || payload.apiPath !== apiPath) return;

    const {collections} = payload;
    if (!collections || (collections && collections.length < 1)) return;

    for await (const collection of collections) {
      this._store.clearQueryMap(collection);
    }

    this._lastSequence[payload.room] = 0;
  }

  // eslint-disable-next-line class-methods-use-this
  private _parsePayload(data: any) {
    const {response} = data;
    // if (response && typeof response === 'object') {
    //   response.__readonly__ = true;
    // }

    const pathSpec = data.pathSpec.split('/').map((ps: string) => Sugar.String.camelize(ps, false)).filter((s: string) => s && s !== '');
    const path = data.path.split('/').filter((s: string) => s && s !== '');
    const paramsRegex = /:(([a-z]|[A-Z]|[0-9]|[-])+)(?:\(.*?\))?$/;

    const pathStr = path.join('/');

    const params: {[key: string]: string} = {};
    for (let idx=0; idx<path.length; idx += 1) {
      const pathParamMatches = pathSpec[idx].match(paramsRegex);
      if (pathParamMatches && pathParamMatches[1]) {
        params[pathParamMatches[1]] = path[idx];
      }
    }

    if (path.length > 0 && !this._store.get(`${path[0]}`)) {
      this._logger.debug(`__parsePayload: No data service for ${path[0]}`);
      return; // We don't have a data service for this data
    }

    const pathParts: PathParts = {
      collectionName: path[0],
      id: path[1],
    };

    this._logger.debug(`__parsePayload verb:${data.verb}`, pathParts);

    if (data.verb === 'post') {
      if (pathStr.includes('bulk/update')) {
        this._handlePut(pathParts, response);
      } else if (pathStr.includes('bulk/delete')) {
        this._handleDelete(pathParts, response, true);
      } else {
        this._handlePost(pathParts, response);
      }
    } else if (data.verb === 'put') {
      this._handlePut(pathParts, response);
    } else if (data.verb === 'delete') {
      this._handleDelete(pathParts, response, false, data.isBulkDelete);
    }
  }

  private _handlePut(pathParts: PathParts, response: any) {
    this._logger.debug(`_handlePut: start`);
    const responses: Array<any> = (Array.isArray(response)) ? response : [response];

    for (let x = 0; x < responses.length; x += 1) {
      const isBulk = (responses[x].id && responses[x].results);

      if (isBulk) {
        responses[x].results.forEach((res: any) => this._update(pathParts, responses[x].id, res));
      } else {
        this._update(pathParts, pathParts.id, responses[x]);
      }
    }
  }

  private _handleDelete(pathParts: PathParts, response:any, isBulk: boolean = false, clear: boolean = false) {
    this._logger.debug(`_handleDelete: start`);
    const responses: Array<any> = (Array.isArray(response)) ? response : [response];

    if (clear || (!isBulk && !pathParts.id)) { // DeleteAll
      this._logger.warn(`Clearing store data hasn't been implemented yet`);
    } else if (isBulk) {
      // TODO: Need to get list of the ids that have been deleted from buttress
      for (let x = 0; x < responses.length; x += 1) {
        const entity = this._store.get(`${pathParts.collectionName}.${responses[x].id}`);
        if (entity) {
          this._store.delete(pathParts.collectionName, responses[x].id, {
            localOnly: true
          });
        }
      };
    } else if (pathParts.id) { // DeleteSingle
      const entity = this._store.get(`${pathParts.collectionName}.${pathParts.id}`);
      if (entity) {
        this._store.delete(pathParts.collectionName, pathParts.id, {
          localOnly: true
        });
      }
    }

    this._logger.debug(`_handleDelete: end`);
  }
  
  private _handlePost(pathParts: PathParts, response: any) {
    const responses: Array<any> = (Array.isArray(response)) ? response : [response];
    this._logger.debug(`_handlePost: start`, responses);

    for (let x = 0; x < responses.length; x += 1) {
      const entity = this._store.get(`${pathParts.collectionName}.${responses[x].id}`);
      if (entity) return; // Skip as it already exists

      this._store.set(`${pathParts.collectionName}.${responses[x].id}`, response, {
        localOnly: true
      });
    }
  }

  private async _update(pathParts: PathParts, id: string, response:any) {
    const updatePath = this._getUpdatePath(pathParts.collectionName, id, response.path);
    this._logger.debug(`_update`, updatePath);
    if (typeof(updatePath) === 'boolean') {
      await this._store.get(pathParts.collectionName, id);
      return;
    }

    if (response.type === 'scalar') {
      this._logger.debug('updating', updatePath, response.value);
      this._store.set(updatePath, response.value, {
        localOnly: true
      });
    } else if (response.type === 'scalar-increment') {
      this._logger.debug('updating', updatePath, response.value);
      this._store.set(updatePath, this._store.get(updatePath) + response.value, {
        localOnly: true
      });
    } else if (response.type === 'vector-add') {
      this._logger.debug('inserting', updatePath, response.value);
      this._store.pushExt(updatePath, {
        localOnly: true,
      }, response.value);
    } else if (response.type === 'vector-rm') {
      this._logger.debug('removing', updatePath, response.value);
      this._store.spliceExt(updatePath, response.value.index, response.value.numRemoved, {
        localOnly: true
      });
    }
  }

  private _getUpdatePath(collectionName: string, id: string, path?: string): string | boolean {
    const data = this._store.get(collectionName);
    if (!data) return false;

    const entity = this._store.get(`${collectionName}.${id}`);
    if (!entity) return false;

    let tail: string[] = [];
    if (path) {
      tail = path.split('.');
 
      if (tail.indexOf('__increment__') !== -1) {
        tail.splice(tail.indexOf('__increment__'), 1);
      }
    }

    return [collectionName, id].concat(tail).join('.');
  }

}