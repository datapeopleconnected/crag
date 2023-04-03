import { LtnLogger, LtnLogLevel, LtnService } from '@lighten/ltn-element';
import {ButtressSchema, ButtressSchemaHelpers} from './ButtressSchema.js';

export interface ButtressStoreInterface {
  get: Function,
  set: Function,
  create: Function,
  delete: Function,
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
  silent?: boolean,
  splice?: boolean,
  dboComplete?: {
    resolve: Function,
    reject: Function,
  },
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

  private __logger: LtnLogger;

  // private __data: {[key: string]: ButtressEntity} = {};
  private __data: Map<string, Map<string, ButtressEntity>> = new Map();

  private __dataInvalid: boolean = false;

  private __dataPending: MapAny | null = null;

  private __dataOld: MapAny | null = null

  private __subscriptions: Subscriptions = {};

  constructor() {
    this.__logger = new LtnLogger('buttress-store');
  }

  setLogLevel(level: LtnLogLevel) {
    this.__logger.level = level;
  }

  create(schema: string, value: ButtressEntity, opts?: NotifyChangeOpts) {
    if (!value.id) throw new Error('Unable to create object without providing an ID');

    return this.set(`${schema}.${value.id}`, value, opts);
  }

  delete(path: string, opts?: NotifyChangeOpts) {
    const parts = path.toString().split('.');
    const id = parts.pop();
    const prePath = parts.join('.');

    if (!id) throw new Error('Unable to remove property');

    const parent = this.get(prePath);
    const isMap = (parent instanceof Map); 
    const prop = (isMap) ? parent.get(id) : parent[id];

    this.__notifyPath(`${path}.splices`, { indexSplices: [{
      index: 0,
      addedCount: 0,
      removed: [prop],
      object: parent,
      type: 'splice',
    }] }, opts);

    const change = (isMap) ? parent.delete(id) : delete parent[id];
    if (change) this.__invalidateData();

    return change;
  }

  get(path: string, root?: {}): any {
    return ButtressStore.get(path, root || this.__data);
  }

  static get(path: string, root?: any): any {
    const parts = path.toString().split('.');
    let prop: any = root;

    for (let i=0; i < parts.length; i += 1) {
      if (!prop) return undefined;
      const part = parts[i];
      prop = (prop instanceof Map) ? prop.get(part) : prop[part];
    }

    return prop;
  }

  set(path: string, value: any, opts?: NotifyChangeOpts): string|undefined {
    const change = opts?.silent || this.__notifyPath(path, value, opts);
    const setPath = this.__setDataProperty(path, value);
    if (change) {
      this.__invalidateData();
    } else {
      opts?.dboComplete?.resolve();
    }

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
      this.__notifySplices(array, path, [{
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
      this.__notifySplices(array, path, [{
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

  private __notifySplices(array: Array<any>, path: string, splices: Array<any>) {
    this.__notifyPath(`${path}.splices`, { indexSplices: splices }, {splice: true});
    this.__notifyPath(`${path}.length`, array.length);
    this.__invalidateData();
  }

  private __setDataProperty(path: string, value: any): string|undefined {
    const parts = path.toString().split('.');
    let prop: any = this.__data;

    const last = parts[parts.length-1];
    if (parts.length > 1) {
      for (let i = 0; i < parts.length - 1; i += 1) {
        const part = parts[i];
        prop = (prop instanceof Map) ? prop.get(part) : prop[part];
        if (!prop) return undefined;
      }
      // Set value to object at end of path
      if (prop instanceof Map) {
        prop.set(last, value);
      } else {
        prop[last] = value;
      }
    } else if (prop instanceof Map) {
      prop.set(path, value);
    } else {
      prop[path] = value;
    }

    return parts.join('.');
  }

  private __notifyPath(path: string, value?: any, opts?: NotifyChangeOpts): boolean {
    let val = value;
    if (arguments.length === 1) {
      val = this.get(path);
    }

    const old = this.get(path);
    const changed = old !== val;

    if (changed) {
      if (!this.__dataPending) {
        this.__dataPending = {};
        this.__dataOld = {};
      }

      if (this.__dataOld && !(path in this.__dataOld)) {
        this.__dataOld[path] = old;
      }

      if (opts?.splice) {
        if (!this.__dataPending[path]) {
          this.__dataPending[path] = [];
        }

        this.__dataPending[path].push({
          value,
          opts
        });
      } else {
        this.__dataPending[path] = {
          value,
          opts
        };
      }
    }

    return changed;
  }

  private __invalidateData() {
    this.__logger.debug(`__invalidateData __dataInvalid:${this.__dataInvalid}`);
    if (!this.__dataInvalid) {
      this.__dataInvalid = true;
      queueMicrotask(() => {
        // Bundle up changes
        if (this.__dataInvalid) {
          this.__dataInvalid = false;
          this.__flushProperties();
        }
      });
    }
  }

  private __flushProperties() {
    const changedProps = this.__dataPending;
    this.__logger.debug(`__flushProperties __dataPending:`, this.__dataPending);
    if (changedProps !== null) {
      this.__dataPending = null;
      this.__dataOld = null;
      this.__propertiesChanged(changedProps);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  private __propertiesChanged(changedProps: MapAny) {
    let ran = false;

    this.__logger.debug(`__propertiesChanged changedProps: `, changedProps);

    // eslint-disable-next-line no-multi-assign
    const id = dedupeId += 1;
    for (const prop of Object.keys(changedProps)) {
      const rootProperty = (prop.indexOf('.') === -1) ? prop : prop.slice(0, prop.indexOf('.'));
      const fxs = this.__subscriptions[rootProperty];
      this.__logger.debug(`__propertiesChanged changed prop: ${prop}, got ${fxs?.length} fxs`);
      if (fxs) {
        for (let i = 0; i < fxs.length; i += 1) {
          const fx = fxs[i];

          const trigger = this.__pathMatchesTrigger(prop, fx.trigger);

          this.__logger.debug(`__propertiesChanged fx: ${i}: lastRun: ${id} !== ${fx.info.lastRun}, trigger: ${trigger}`);
          // if (fx.info.lastRun !== id && trigger) {
          if (trigger) {
            fx.info.lastRun = id;

            if (Array.isArray(changedProps[prop])) {
              changedProps[prop].forEach((p: any) => fx.cb(...this.__marshalArgs(fx.info.args, prop, p)));
            } else {
              fx.cb(...this.__marshalArgs(fx.info.args, prop, changedProps[prop]));
            }

            ran = true;
          }
        }
      }
    }

    return ran;
  }

  private __marshalArgs(args: any[], path: string, changedProp: any) {
    const values = [];

    for (let i = 0, l = args.length; i < l; i += 1) {
      const {name, structured, wildcard, argVal, literal} = args[i];
      let value = argVal;
      if (!literal) {
        if (wildcard) {
          const matches = path.indexOf(`${name}.`) === 0;
          const p = matches ? path : name;
          const pathValue = (this.get(p) === undefined) ? changedProp.value : this.get(p);
          value = {
            path: matches ? path : name,
            value: pathValue,
            base: matches ? this.get(name) : pathValue,
            opts: changedProp.opts
          };
        } else if (structured) {
          value = {
            value: (this.get(name) === undefined) ? changedProp.value : this.get(name),
            opts: changedProp.opts
          };
        } else {
          value = {
            value: this.get(name),
            opts: changedProp.opts
          };
        }
      }

      values[i] = value;
    }
    return values;
  }

  // eslint-disable-next-line class-methods-use-this
  private __pathMatchesTrigger(path: string, trigger: PathSig): boolean {
    return (!trigger) || (trigger.name === path) ||
      !!(trigger.structured && trigger.name.indexOf(`${path}.`) === 0) ||
      !!(trigger.wildcard && path.indexOf(`${trigger.name}.`) === 0);
  }

  // eslint-disable-next-line class-methods-use-this
  subscribe(pathsStr: string, fn: Function): string {
    const id = LtnService.generateId();
    this.__logger.debug('subscribe', pathsStr);
    const paths = pathsStr.trim().split(',')
      .map((path) => this.__parsePath(path.trim()));

    for (let i = 0; i < paths.length; i += 1) {
      if (!this.__subscriptions[paths[i].rootProperty]) {
        this.__subscriptions[paths[i].rootProperty] = [];
      }

      this.__subscriptions[paths[i].rootProperty].push({
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
    this.__logger.debug('Scrubbing subscription with referece: ', id);

    Object.keys(this.__subscriptions).forEach((key) => {
      const matches = this.__subscriptions[key].filter((obj) => obj.ref !== id);
      if (this.__subscriptions[key].length !== matches.length) {
        this.__subscriptions[key] = matches;
        result = true;
      }
    });

    return result;
  }

  // eslint-disable-next-line class-methods-use-this
  private __parsePath(path: string): PathSig {
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
