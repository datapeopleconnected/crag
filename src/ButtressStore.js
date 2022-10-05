"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
exports.__esModule = true;
var dedupeId = 0;
var ButtressStore = /** @class */ (function () {
    function ButtressStore() {
        this._dataInvalid = false;
        this._dataPending = null;
        this._dataOld = null;
        this._subscriptions = {};
        this._data = {};
    }
    ButtressStore.prototype.get = function (path, root) {
        var parts = path.toString().split('.');
        var prop = root || this._data;
        // Loop over path parts[0..n-1] and dereference
        for (var i = 0; i < parts.length; i += 1) {
            if (!prop)
                return undefined;
            var part = parts[i];
            prop = prop[part];
        }
        return prop;
    };
    ButtressStore.prototype.set = function (path, value) {
        var change = this.notifyPath(path, value);
        var setPath = this.setDataProperty(path, value);
        if (change)
            this._invalidateData();
        return setPath;
    };
    ButtressStore.prototype.push = function (path) {
        var items = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            items[_i - 1] = arguments[_i];
        }
        var array = this.get(path);
        var len = array.length;
        var ret = array.push.apply(array, items);
        if (items.length) {
            this.notifySplices(array, path, [{
                    index: len,
                    addedCount: items.length,
                    removed: [],
                    object: array,
                    type: 'splice'
                }]);
        }
        return ret;
    };
    ButtressStore.prototype.splice = function (path, start, deleteCount) {
        var items = [];
        for (var _i = 3; _i < arguments.length; _i++) {
            items[_i - 3] = arguments[_i];
        }
        var array = this.get(path);
        var beginning = start;
        if (beginning < 0) {
            beginning = array.length - Math.floor(-beginning);
        }
        else if (beginning) {
            beginning = Math.floor(beginning);
        }
        var ret = (arguments.length === 2) ? array.splice(beginning) : array.splice.apply(array, __spreadArray([beginning, deleteCount], items, false));
        if (items.length || ret.length) {
            this.notifySplices(array, path, [{
                    index: beginning,
                    addedCount: items.length,
                    removed: ret,
                    object: array,
                    type: 'splice'
                }]);
        }
        return ret;
    };
    ButtressStore.prototype.notifySplices = function (array, path, splices) {
        this.notifyPath("".concat(path, ".splices"), { indexSplices: splices });
        this.notifyPath("".concat(path, ".length"), array.length);
        this._invalidateData();
    };
    ButtressStore.prototype.setDataProperty = function (path, value) {
        var parts = path.toString().split('.');
        var prop = this._data;
        var last = parts[parts.length - 1];
        if (parts.length > 1) {
            // Loop over path parts[0..n-2] and dereference
            for (var i = 0; i < parts.length - 1; i += 1) {
                var part = parts[i];
                prop = prop[part];
                if (!prop)
                    return undefined;
            }
            // Set value to object at end of path
            prop[last] = value;
        }
        else {
            // Simple property set
            prop[path] = value;
        }
        return parts.join('.');
    };
    ButtressStore.prototype.notifyPath = function (path, value) {
        var val = value;
        if (arguments.length === 1) {
            val = this.get(path);
        }
        var old = this.get(path);
        var changed = old !== val;
        if (changed) {
            if (!this._dataPending) {
                this._dataPending = {};
                this._dataOld = {};
            }
            if (this._dataOld && !(path in this._dataOld)) {
                this._dataOld[path] = old;
            }
            this._dataPending[path] = val;
        }
        return changed;
    };
    ButtressStore.prototype._invalidateData = function () {
        var _this = this;
        if (!this._dataInvalid) {
            this._dataInvalid = true;
            queueMicrotask(function () {
                // Bundle up changes
                if (_this._dataInvalid) {
                    _this._dataInvalid = false;
                    _this._flushProperties();
                }
            });
        }
    };
    ButtressStore.prototype._flushProperties = function () {
        var changedProps = this._dataPending;
        var old = this._dataOld;
        if (changedProps !== null) {
            this._dataPending = null;
            this._dataOld = null;
            this._propertiesChanged(changedProps, old);
        }
    };
    // eslint-disable-next-line class-methods-use-this
    ButtressStore.prototype._propertiesChanged = function (changedProps, oldProps) {
        var ran = false;
        // eslint-disable-next-line no-multi-assign
        var id = dedupeId += 1;
        for (var _i = 0, _a = Object.keys(changedProps); _i < _a.length; _i++) {
            var prop = _a[_i];
            var rootProperty = (prop.indexOf('.') === -1) ? prop : prop.slice(0, prop.indexOf('.'));
            var fxs = this._subscriptions[rootProperty];
            if (fxs) {
                for (var i = 0; i < fxs.length; i += 1) {
                    var fx = fxs[i];
                    if (fx.info.lastRun !== id && this._pathMatchesTrigger(prop, fx.trigger)) {
                        fx.info.lastRun = id;
                        fx.cb.apply(fx, this._marshalArgs(fx.info.args, prop, changedProps));
                        ran = true;
                    }
                }
            }
        }
        return ran;
    };
    ButtressStore.prototype._marshalArgs = function (args, path, props) {
        var values = [];
        for (var i = 0, l = args.length; i < l; i += 1) {
            var _a = args[i], name_1 = _a.name, structured = _a.structured, wildcard = _a.wildcard, argVal = _a.argVal, literal = _a.literal;
            var value = argVal;
            if (!literal) {
                if (wildcard) {
                    var matches = path.indexOf("".concat(name_1, ".")) === 0;
                    var p = matches ? path : name_1;
                    var pathValue = (this.get(p) === undefined) ? props[p] : this.get(p);
                    value = {
                        path: matches ? path : name_1,
                        value: pathValue,
                        base: matches ? this.get(name_1) : pathValue
                    };
                }
                else if (structured) {
                    value = (this.get(name_1) === undefined) ? props[name_1] : this.get(name_1);
                }
                else {
                    value = this.get(name_1);
                }
            }
            values[i] = value;
        }
        return values;
    };
    // eslint-disable-next-line class-methods-use-this
    ButtressStore.prototype._pathMatchesTrigger = function (path, trigger) {
        return (!trigger) || (trigger.name === path) ||
            !!(trigger.structured && trigger.name.indexOf("".concat(path, ".")) === 0) ||
            !!(trigger.wildcard && path.indexOf("".concat(trigger.name, ".")) === 0);
    };
    // eslint-disable-next-line class-methods-use-this
    ButtressStore.prototype.subscribe = function (pathsStr, fn) {
        var _this = this;
        var paths = pathsStr.trim().split(',')
            .map(function (path) { return _this.parsePath(path.trim()); });
        for (var i = 0; i < paths.length; i += 1) {
            if (!this._subscriptions[paths[i].rootProperty]) {
                this._subscriptions[paths[i].rootProperty] = [];
            }
            this._subscriptions[paths[i].rootProperty].push({
                trigger: paths[i],
                info: {
                    lastRun: 0,
                    args: paths
                },
                cb: fn
            });
        }
    };
    // eslint-disable-next-line class-methods-use-this
    ButtressStore.prototype.parsePath = function (path) {
        var p = {
            name: path.trim(),
            value: '',
            literal: false,
            structured: false,
            rootProperty: '',
            wildcard: false
        };
        // detect literal value (must be String or Number)
        var fc = path[0];
        if (fc === '-')
            fc = path[1];
        if (fc >= '0' && fc <= '9')
            fc = '#';
        if (fc === '\'' || fc === '"') {
            p.value = path.slice(1, -1);
            p.literal = true;
        }
        else if (fc === '#') {
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
    };
    ButtressStore.prototype.unsubscribe = function () {
    };
    return ButtressStore;
}());
exports["default"] = ButtressStore;
