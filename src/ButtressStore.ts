import { LtnLogger, LtnLogLevel, LtnService } from '@lighten/ltn-element';
import {ButtressSchema, ButtressSchemaHelpers} from './ButtressSchema.js';

export interface ButtressStoreInterface {
  get: Function,
  set: Function,
  push: Function,
  pushExt: Function,
  splice: Function,
  spliceExt:Function
}

export interface ButtressEntity {
  [index: string]: any;
  id: string
}

interface PathSig {
  name: string,
  value: string | number,
  literal: boolean,
  structured: boolean,
  rootProperty: string,
  wildcard: boolean,
}

export interface NotifyChangeOpts {
  readonly?: boolean,
  silent?: boolean
}

export interface IndexSplice {
  addedCount: number
  index: number
  object: any[]
  removed: any[]
  opts?: NotifyChangeOpts
  type: string
}
interface MapAny {
  [key: string]: any
}

interface Subscription {
  ref: string,
  trigger: PathSig,
  info: {
    lastRun: number,
    args: Array<PathSig>
  },
  cb: Function
}
interface Subscriptions {
  [key: string]: Array<Subscription>
}

let dedupeId = 0;

export class ButtressStore implements ButtressStoreInterface {

  private _logger: LtnLogger;

  // private _data: {[key: string]: ButtressEntity} = {};
  private _data: Map<string, Map<string, ButtressEntity>> = new Map();

  private _dataInvalid: boolean = false;

  private _dataPending: MapAny | null = null;

  private _dataOld: MapAny | null = null

  private _subscriptions: Subscriptions = {};

  constructor() {
    this._logger = new LtnLogger('buttress-store');
  }

  setLogLevel(level: LtnLogLevel) {
    this._logger.level = level;
  }

  get(path: string, root?: {}): any {
    return ButtressStore.get(path, root || this._data);
  }

  static get(path: string, root?: any): any {
    const parts = path.toString().split('.');
    let prop: any = root;

    for (let i=0; i < parts.length; i += 1) {
      if (!prop) return undefined;
      const part = parts[i];
      prop = prop[part];
    }

    return prop;
  }

  set(path: string, value: any, opts?: NotifyChangeOpts): string|undefined {
    const change = opts?.silent || this._notifyPath(path, value, opts);
    const setPath = this._setDataProperty(path, value);
    if (change) this._invalidateData();
    return setPath;
  }

  push(path: string, schema: ButtressSchema, ...items: any[]): number {
    return this.pushExt(path, schema, undefined, ...items);
  }

  pushExt(path: string, schema: ButtressSchema, opts?: NotifyChangeOpts, ...items: any[]): number {
    let array = this.get(path);

    // If we're setting a sub property of the base then we'll check the prop data type & create
    const parts = path.split('.');
    if (array === undefined && parts.length > 2) {
      const prop = ButtressSchemaHelpers.getProperty(schema, parts.slice(2).join('.'));
      if (!prop || prop.__type !== 'array') {
        throw new Error(`Unable to call push on non-array property type: ${prop?.__type}`);
      }

      this.set(path, [], {
        readonly: true,
        silent: true
      });
      array = this.get(path);
    }

    const len = array.length;
    const ret = array.push(...items);

    // if (!opts?.readonly && items.length) {
    if (items.length) {
      this._notifySplices(array, path, [{
        index: len,
        addedCount: items.length,
        removed: [],
        object: array,
        type: 'splice',
        opts
      }]);
    }

    return ret;
  }

  splice(path: string, schema: ButtressSchema, start: number, deleteCount?: number, ...items: any[]): any[] {
    return this.spliceExt(path, schema, start, deleteCount, undefined, ...items);
  }

  spliceExt(path: string, schema: ButtressSchema, start: number, deleteCount?: number, opts?: NotifyChangeOpts, ...items: any[]): any[] {
    let array = this.get(path);

    const parts = path.split('.');
    if (array === undefined && parts.length > 2) {
      const prop = ButtressSchemaHelpers.getProperty(schema, parts.slice(2).join('.'));
      if (!prop || prop.__type !== 'array') {
        throw new Error(`Unable to call push on non-array property type: ${prop?.__type}`);
      }

      this.set(path, [], {
        readonly: true,
        silent: true
      });
      array = this.get(path);
    }

    let beginning = start;

    if (beginning < 0) {
      beginning = array.length - Math.floor(-beginning);
    } else if (beginning) {
      beginning = Math.floor(beginning);
    }

    const ret = (arguments.length === 3) ? array.splice(beginning) : array.splice(beginning, deleteCount, ...items);
    if (items.length || ret.length) {
      this._notifySplices(array, path, [{
        index: beginning,
        addedCount: items.length,
        removed: ret,
        object: array,
        type: 'splice',
        opts
      }]);
    }

    return ret;
  }

  private _notifySplices(array: Array<any>, path: string, splices: Array<any>) {
    this._notifyPath(`${path}.splices`, { indexSplices: splices });
    this._notifyPath(`${path}.length`, array.length);
    this._invalidateData();
  }

  private _setDataProperty(path: string, value: any): string|undefined {
    const parts = path.toString().split('.');
    let prop: any = this._data;

    const last = parts[parts.length-1];
    if (parts.length > 1) {
      // Loop over path parts[0..n-2] and dereference
      for (let i = 0; i < parts.length - 1; i += 1) {
        const part = parts[i];
        prop = prop[part];
        if (!prop) return undefined;
      }
      // Set value to object at end of path
      prop[last] = value;
    } else {
      // Simple property set
      prop[path] = value;
    }

    return parts.join('.');
  }

  private _notifyPath(path: string, value?: any, opts?: NotifyChangeOpts): boolean {
    let val = value;
    if (arguments.length === 1) {
      val = this.get(path);
    }

    const old = this.get(path);
    const changed = old !== val;

    if (changed) {
      if (!this._dataPending) {
        this._dataPending = {};
        this._dataOld = {};
      }

      if (this._dataOld && !(path in this._dataOld)) {
        this._dataOld[path] = old;
      }

      this._dataPending[path] = {
        value,
        opts
      };
    }

    return changed;
  }

  private _invalidateData() {
    this._logger.debug(`_invalidateData _dataInvalid:${this._dataInvalid}`);
    if (!this._dataInvalid) {
      this._dataInvalid = true;
      // queueMicrotask(() => {
      // Bundle up changes
        if (this._dataInvalid) {
          this._dataInvalid = false;
          this._flushProperties();
        }
      // });
    }
  }

  private _flushProperties() {
    const changedProps = this._dataPending;
    const old = this._dataOld;
    this._logger.debug(`_flushProperties _dataPending:${this._dataPending} _dataOld:${this._dataOld}`);
    if (changedProps !== null) {
      this._dataPending = null;
      this._dataOld = null;
      this._propertiesChanged(changedProps, old);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  private _propertiesChanged(changedProps: MapAny, oldProps: MapAny | null) {
    let ran = false;

    this._logger.debug(`_propertiesChanged changedProps:${changedProps} oldProps:${oldProps}`);

    // eslint-disable-next-line no-multi-assign
    const id = dedupeId += 1;
    for (const prop of Object.keys(changedProps)) {
      const rootProperty = (prop.indexOf('.') === -1) ? prop : prop.slice(0, prop.indexOf('.'));
      const fxs = this._subscriptions[rootProperty];
      if (fxs) {
        for (let i = 0; i < fxs.length; i += 1) {
          const fx = fxs[i];

          if (fx.info.lastRun !== id && this._pathMatchesTrigger(prop, fx.trigger)) {
            fx.info.lastRun = id;
            fx.cb(...this._marshalArgs(fx.info.args, prop, changedProps));

            ran = true;
          }
        }
      }
    }

    return ran;
  }

  private _marshalArgs(args: any[], path: string, props: MapAny) {
    const values = [];

    for (let i = 0, l = args.length; i < l; i += 1) {
      const {name, structured, wildcard, argVal, literal} = args[i];
      let value = argVal;
      if (!literal) {
        if (wildcard) {
          const matches = path.indexOf(`${name}.`) === 0;
          const p = matches ? path : name;
          const pathValue = (this.get(p) === undefined) ? props[p].value : this.get(p);
          value = {
            path: matches ? path : name,
            value: pathValue,
            base: matches ? this.get(name) : pathValue,
            opts: props[p]?.opts
          };
        } else if (structured) {
          value = {
            value: (this.get(name) === undefined) ? props[name].value : this.get(name),
            opts: props[name]?.opts
          };
        } else {
          value = {
            value: this.get(name),
            opts: props[name]?.opts
          };
        }
      }

      values[i] = value;
    }
    return values;
  }

  // eslint-disable-next-line class-methods-use-this
  private _pathMatchesTrigger(path: string, trigger: PathSig): boolean {
    return (!trigger) || (trigger.name === path) ||
      !!(trigger.structured && trigger.name.indexOf(`${path}.`) === 0) ||
      !!(trigger.wildcard && path.indexOf(`${trigger.name}.`) === 0);
  }

  // eslint-disable-next-line class-methods-use-this
  subscribe(pathsStr: string, fn: Function): string {
    const id = LtnService.generateId();
    this._logger.debug('subscribe', pathsStr);
    const paths = pathsStr.trim().split(',')
      .map((path) => this._parsePath(path.trim()));

    for (let i = 0; i < paths.length; i += 1) {
      if (!this._subscriptions[paths[i].rootProperty]) {
        this._subscriptions[paths[i].rootProperty] = [];
      }

      this._subscriptions[paths[i].rootProperty].push({
        ref: id,
        trigger: paths[i],
        info: {
          lastRun: 0,
          args: paths,
        },
        cb: fn,
      });
    }

    return id;
  }

  unsubscribe(id: string): boolean {
    let result = false;
    this._logger.debug('Scrubbing subscription with referece: ', id);

    Object.keys(this._subscriptions).forEach((key) => {
      const matches = this._subscriptions[key].filter((obj) => obj.ref !== id);
      if (this._subscriptions[key].length !== matches.length) {
        this._subscriptions[key] = matches;
        result = true;
      }
    });

    return result;
  }

  // eslint-disable-next-line class-methods-use-this
  private _parsePath(path: string): PathSig {
    const p: PathSig = {
      name: path.trim(),
      value: '',
      literal: false,
      structured: false,
      rootProperty: '',
      wildcard: false,
    };

    // detect literal value (must be String or Number)
    let fc = path[0];
    if (fc === '-') [,fc] = path;

    if (fc >= '0' && fc <= '9') fc = '#';

    if (fc === '\'' || fc === '"') {
      p.value = path.slice(1, -1);
      p.literal = true;
    } else if (fc === '#') {
      p.value = Number(path);
      p.literal = true;
    }

    // if not literal, look for structured path
    if (!p.literal) {
      p.rootProperty = (path.indexOf('.') === -1) ? path : path.slice(0, path.indexOf('.'));
      // detect structured path (has dots)
      p.structured = path.indexOf('.') >= 0;
      if (p.structured) {
        p.wildcard = (path.slice(-2) === '.*');
        if (p.wildcard) {
          p.name = path.slice(0, -2);
        }
      }
    }

    return p;
  }
}
export default ButtressStore;
