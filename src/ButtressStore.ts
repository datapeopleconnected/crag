import ButtressSchema from './ButtressSchema.js';

interface PathSig {
  name: string,
  value: string | number,
  literal: boolean,
  structured: boolean,
  rootProperty: string,
  wildcard: boolean,
}

interface ChangeOpts {
  readonly?: boolean
}

interface MapAny {
  [key: string]: any
}

let dedupeId = 0;

export default class ButtressStore {
  private _data: {[key: string]: ButtressSchema};

  private _dataInvalid: boolean = false;

  private _dataPending: MapAny | null = null;

  private _dataOld: MapAny | null = null

  private _subscriptions: {[key: string]: Array<{trigger: PathSig, info: {lastRun: number, args: Array<PathSig>}, cb: Function}>} = {};

  constructor() {
    this._data = {};
  }

  get(path: string, root?: any): any {
    const parts = path.toString().split('.');
    let prop: any = root || this._data;

    // Loop over path parts[0..n-1] and dereference
    for (let i=0; i < parts.length; i += 1) {
      if (!prop) return undefined;
      const part = parts[i];
      prop = prop[part];
    }

    return prop;
  }

  set(path: string, value: any, opts?: ChangeOpts): string|undefined {
    const change = this.notifyPath(path, value);
    const setPath = this.setDataProperty(path, value);
    if (change) this._invalidateData();
    return setPath;
  }

  push(path: string, ...items: any[]): number {
    return this.pushExt(path, undefined, ...items);
  }

  pushExt(path: string, opts?: ChangeOpts, ...items: any[]): number {
    const array = this.get(path);
    const len = array.length;
    const ret = array.push(...items);

    if (!opts?.readonly && items.length) {
      this.notifySplices(array, path, [{
        index: len,
        addedCount: items.length,
        removed: [],
        object: array,
        type: 'splice'
      }]);
    }

    return ret;
  }

  splice(path: string, start: number, deleteCount?: number, ...items: any[]): any[] {
    return this.spliceExt(path, start, deleteCount, undefined, ...items);
  }

  spliceExt(path: string, start: number, deleteCount?: number, opts?: ChangeOpts, ...items: any[]): any[] {
    const array = this.get(path);

    let beginning = start;

    if (beginning < 0) {
      beginning = array.length - Math.floor(-beginning);
    } else if (beginning) {
      beginning = Math.floor(beginning);
    }

    const ret = (arguments.length === 2) ? array.splice(beginning) : array.splice(beginning, deleteCount, ...items);

    if (!opts?.readonly && (items.length || ret.length)) {
      this.notifySplices(array, path, [{
        index: beginning,
        addedCount: items.length,
        removed: ret,
        object: array,
        type: 'splice'
      }]);
    }

    return ret;
  }

  notifySplices(array: Array<any>, path: string, splices: Array<any>) {
    this.notifyPath(`${path}.splices`, { indexSplices: splices });
    this.notifyPath(`${path}.length`, array.length);
    this._invalidateData();
  }

  setDataProperty(path: string, value: any): string|undefined {
    const parts = path.toString().split('.');
    let prop: any = this._data;

    const last = parts[parts.length-1];
    if (parts.length > 1) {
      // Loop over path parts[0..n-2] and dereference
      for (let i=0; i < parts.length - 1; i += 1) {
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

  notifyPath(path: string, value?: any, opts?: ChangeOpts): boolean {
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

  _invalidateData() {
    if (!this._dataInvalid) {
      this._dataInvalid = true;
      queueMicrotask(() => {
      // Bundle up changes
        if (this._dataInvalid) {
          this._dataInvalid = false;
          this._flushProperties();
        }
      });
    }
  }

  _flushProperties() {
    const changedProps = this._dataPending;
    const old = this._dataOld;
    if (changedProps !== null) {
      this._dataPending = null;
      this._dataOld = null;
      this._propertiesChanged(changedProps, old);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  _propertiesChanged(changedProps: MapAny, oldProps: MapAny | null) {
    let ran = false;

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

  _marshalArgs(args: any[], path: string, props: MapAny) {
    const values = [];
    for (let i = 0, l = args.length; i < l; i += 1) {
      const {name, structured, wildcard, argVal, literal} = args[i];
      let value = argVal;
      if (!literal) {
        if (wildcard) {
          const matches = path.indexOf(`${name}.`) === 0;
          const p = matches ? path : name;
          const pathValue = (this.get(p) === undefined) ? props[p].val : this.get(p);
          value = {
            path: matches ? path : name,
            value: pathValue,
            base: matches ? this.get(name) : pathValue,
            opts: props[p]?.opts
          };
        } else if (structured) {
          value = {
            value: (this.get(name) === undefined) ? props[name].val : this.get(name),
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
  _pathMatchesTrigger(path: string, trigger: PathSig): boolean {
    return (!trigger) || (trigger.name === path) ||
      !!(trigger.structured && trigger.name.indexOf(`${path}.`) === 0) ||
      !!(trigger.wildcard && path.indexOf(`${trigger.name}.`) === 0);
  }

  // eslint-disable-next-line class-methods-use-this
  subscribe(pathsStr: string, fn: Function) {
    const paths = pathsStr.trim().split(',')
      .map((path) => this.parsePath(path.trim()));

    for (let i = 0; i < paths.length; i += 1) {
      if (!this._subscriptions[paths[i].rootProperty]) {
        this._subscriptions[paths[i].rootProperty] = [];
      }

      this._subscriptions[paths[i].rootProperty].push({
        trigger: paths[i],
        info: {
          lastRun: 0,
          args: paths,
        },
        cb: fn,
      });
    }
  }

  // eslint-disable-next-line class-methods-use-this
  parsePath(path: string): PathSig {
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

  unsubscribe() {

  }
}