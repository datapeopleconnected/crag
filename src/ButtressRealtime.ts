import {io} from 'socket.io-client';
// import Sugar from 'sugar';

import ButtressStore from "./ButtressStore.js";

import {Settings} from './helpers.js';

interface PathParts {
  collectionName: string,
  id: string,
};

export default class ButtressDataRealtime {

  private _store: ButtressStore;

  private _settings: Settings;

  private _socket: any;

  private _connected: boolean = false;

  private _synced: boolean = false;

  private _lastSequence: {[key: string]: number} = {};

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
    this._rxEvents.forEach((eventName) => {
      this._socket.on(eventName, (data: any) => this._handleRxEvent(eventName, data));
    });
  }

  // eslint-disable-next-line class-methods-use-this
  private _handleRxEvent(type:string, data: any) {
    if (type === 'db-disconnect-room' || type === 'db-connect-room') {
      // Do stuff
    } else if (type === 'clear-local-db') {
      this._clearUserLocaldata(data);
      // Do stuff
    } else if (type === 'db-activity') {
      // Do stuff
      this._dbActivity(data);
    } else {
      // Log out somthing
    }
  }

  private _dbActivity(data: any) {
    const lastSequence = this._lastSequence[data.room];

    if (lastSequence) {
      if (lastSequence === data.sequence) {
        this._synced = false;
      }
      if (lastSequence + 1 !== data.sequence) {
        this._synced = false;
      }
    }

    if (this._settings?.userId !== data.user || data.isSameApp === false) {
      this._parsePayload(data);
    }

    this._lastSequence[data.room] = data.sequence;
  }

  private _clearUserLocaldata(data: any) {
  }

  // eslint-disable-next-line class-methods-use-this
  private _parsePayload(data: any) {
    const {response} = data;
    if (response && typeof response === 'object') {
      response.__readonly__ = true;
    }
    const pathSpec = data.pathSpec.split('/').map((ps: string) => Sugar.String.camelize(ps, false)).filter((s: string) => s && s !== '');
    const path = data.path.split('/').map((p: string) => Sugar.String.camelize(p, false)).filter((s: string) => s && s !== '');
    const paramsRegex = /:(([a-z]|[A-Z]|[0-9]|[-])+)(?:\(.*?\))?$/;

    const pathStr = path.join('/');

    const params: {[key: string]: string} = {};
    for (let idx=0; idx<path.length; idx += 1) {
      const pathParamMatches = pathSpec[idx].match(paramsRegex);
      if (pathParamMatches && pathParamMatches[1]) {
        params[pathParamMatches[1]] = path[idx];
      }
    }

    if (path.length > 0 && !this._store.get(`db.${path[0]}.data`)) {
      // if (this.get('logging')) console.log('silly', `__parsePayload: No data service for ${path[0]}`);
      return; // We don't have a data service for this data
    }

    const pathParts: PathParts = {
      collectionName: path[0],
      id: path[1],
    };

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
      const clearData = data.isBulkDelete;
      this._handleDelete(pathParts, response, false, clearData);
      if (path.length === 1) {
        const collection = this._store.get(`db.${path[0]}.data`);
        for (let x = 0; x < collection.length; x += 1) {
          collection[x].__readonly__ = true;
        }
        this._store.splice(`db.${path[0]}.data`, 0, data.length);
      } else if (path.length === 2 && params.id) {
        const collection = this._store.get(`db.${path[0]}.data`);
        const itemIndex = collection.findIndex((d: any) => d.id === params.id);
        if (itemIndex !== -1) {
          const item = data[itemIndex];
          item.__readonly__ = true;
          this._store.splice(`db.${path[0]}.data`, itemIndex, 1);
        }
      }
    }
  }

  // eslint-disable-next-line class-methods-use-this
  private _handlePut(pathParts: PathParts, response: any) {
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
    
  }
  
  private _handlePost(pathParts: PathParts, response: any) {
    
  }

  // -

  private async _update(pathParts: PathParts, id: string, response:any) {
    const updatePath = this._getUpdatePath(pathParts.collectionName, id, response.path);
    if (typeof(updatePath) === 'boolean') {
      await this._store.get(pathParts.collectionName, id);
      return;
    }
  
    // if (this.get('logging')) console.log('silly', `__handlePut`, updatePath);
    // this.db[pathParts.collectionName].data[updatePath[3]].__readOnlyChange__ = true;

    // TODO: Flag as readonly change
    if (response.type === 'scalar') {
      // if (this.get('logging')) console.log('silly', 'updating', updatePath, response.value);
      this._store.set(updatePath, response.value, {
        readonly: true
      });
    } else if (response.type === 'scalar-increment') {
      // if (this.get('logging')) console.log('silly', 'updating', updatePath, response.value);
      this._store.set(updatePath, this._store.get(updatePath) + response.value, {
        readonly: true
      });
    }  else if (response.type === 'vector-add') {
      // if (this.get('logging')) console.log('silly', 'inserting', updatePath, response.value);
      this._store.pushExt(updatePath, {
        readonly: true,
      }, response.value);
    }  else if (response.type === 'vector-rm') {
      // if (this.get('logging')) console.log('silly', 'removing', updatePath, response.value);
      this._store.spliceExt(updatePath, response.value.index, response.value.numRemoved, {
        readonly: true
      });
    }
  }

  private _getUpdatePath(collectionName: string, id: string, path?: string): string | boolean {
    const data = this._store.get(`db.${collectionName}.data`);
    if (!data) return false;

    const entityIdx = data.findIndex((e: any) => e.id === id);
    if (entityIdx === -1) return false;

    let tail: string[] = [];
    if (path) {
      tail = path.split('.');
 
      if (tail.indexOf('__increment__') !== -1) {
        tail.splice(tail.indexOf('__increment__'), 1);
      }
    }

    return ['db', collectionName, 'data', entityIdx].concat(tail).join('.');
  }

}