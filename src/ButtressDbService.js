"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
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
exports.ButtressDbService = void 0;
var lit_1 = require("lit");
var ltn_element_1 = require("@lighten/ltn-element");
// import { LtnSettingsService, ButtressSettings } from './LtnSettingsService.js';
var ButtressDataService_js_1 = require("./ButtressDataService.js");
var ButtressStore_js_1 = require("./ButtressStore.js");
var ButtressRealtime_js_1 = require("./ButtressRealtime.js");
var ButtressDbService = /** @class */ (function (_super) {
    __extends(ButtressDbService, _super);
    function ButtressDbService() {
        var _this = _super.call(this) || this;
        _this._settings = {
            endpoint: 'https://local.buttressjs.com',
            token: 'YwwUxkdE1AkkdE8tlAkJd9UpRwJAZp9c5sMB',
            apiPath: 'lit'
        };
        _this._schema = null;
        _this._dataServices = {};
        _this._subscriptions = [];
        _this._connected = false;
        _this._awaitConnectionPool = [];
        _this._store = new ButtressStore_js_1["default"]();
        _this._realtime = new ButtressRealtime_js_1["default"](_this._store, _this._settings);
        return _this;
    }
    ButtressDbService.prototype.connectedCallback = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _super.prototype.connectedCallback.call(this);
                        return [4 /*yield*/, this.updateComplete];
                    case 1:
                        _a.sent();
                        // const settingsService: LtnSettingsService | null = this._getService(
                        //   LtnSettingsService
                        // );
                        // this.__settings = settingsService
                        //   ? settingsService.getButtressSettings()
                        //   : null;
                        // this._debug(`connectedCallback`, this.__settings);
                        return [4 /*yield*/, this._connect()];
                    case 2:
                        // const settingsService: LtnSettingsService | null = this._getService(
                        //   LtnSettingsService
                        // );
                        // this.__settings = settingsService
                        //   ? settingsService.getButtressSettings()
                        //   : null;
                        // this._debug(`connectedCallback`, this.__settings);
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    ButtressDbService.prototype.disconnectedCallback = function () {
        _super.prototype.disconnectedCallback.call(this);
        this._debug("disconnectedCallback");
    };
    ButtressDbService.prototype._connect = function () {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function () {
            var i;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        this._connected = false;
                        if (!((_a = this._settings) === null || _a === void 0 ? void 0 : _a.endpoint)) {
                            throw new Error("Missing setting 'endpoint' while trying to connect to buttress");
                        }
                        if (!((_b = this._settings) === null || _b === void 0 ? void 0 : _b.token)) {
                            throw new Error("Missing setting 'endpoint' while trying to connect");
                        }
                        // Test the connection to buttress
                        // Kick off realtime sync
                        return [4 /*yield*/, this._fetchAppSchema()];
                    case 1:
                        // Test the connection to buttress
                        // Kick off realtime sync
                        _c.sent();
                        // TODO: Handle errors
                        return [4 /*yield*/, this._refreshLocalDataServices()];
                    case 2:
                        // TODO: Handle errors
                        _c.sent();
                        for (i = this._awaitConnectionPool.length - 1; i >= 0; i -= 1) {
                            this._awaitConnectionPool[i]();
                            this._awaitConnectionPool.splice(i, 1);
                        }
                        this._connected = true;
                        return [2 /*return*/];
                }
            });
        });
    };
    ButtressDbService.prototype._fetchAppSchema = function () {
        return __awaiter(this, void 0, void 0, function () {
            var req, init, response, body;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this._debug('_fetchAppSchema', this._settings);
                        if (!this._settings)
                            return [2 /*return*/];
                        req = "".concat(this._settings.endpoint, "/api/v1/app/schema?urq").concat(Date.now(), "&token=").concat(this._settings.token);
                        init = {
                            method: 'GET',
                            cache: 'no-cache',
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        };
                        return [4 /*yield*/, fetch(req, init)];
                    case 1:
                        response = _a.sent();
                        if (!response.ok) return [3 /*break*/, 3];
                        return [4 /*yield*/, response.json()];
                    case 2:
                        body = _a.sent();
                        this._schema = body.reduce(function (obj, schema) {
                            obj[schema.name] = schema; // eslint-disable-line no-param-reassign
                            return obj;
                        }, {});
                        this._debug(body);
                        return [3 /*break*/, 4];
                    case 3: throw new Error("Buttress Error: ".concat(response.status, ": ").concat(response.statusText));
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    ButtressDbService.prototype._refreshLocalDataServices = function () {
        return __awaiter(this, void 0, void 0, function () {
            var schemas, dataServices, obsoleteDataServices;
            var _this = this;
            return __generator(this, function (_a) {
                if (!this._schema || !this._settings)
                    return [2 /*return*/];
                schemas = Object.keys(this._schema || []);
                dataServices = Object.keys(this._dataServices || []);
                obsoleteDataServices = dataServices.filter(function (name) { return !schemas.includes(name); });
                schemas.forEach(function (name) {
                    if (!_this._schema)
                        return;
                    if (dataServices.includes(name)) {
                        _this._dataServices[name].updateSchema(_this._schema[name]);
                    }
                    else {
                        _this._dataServices[name] = new ButtressDataService_js_1["default"](name, _this._settings, _this._store, _this._schema[name]);
                    }
                });
                obsoleteDataServices.forEach(function (name) { return delete _this._dataServices[name]; });
                return [2 /*return*/];
            });
        });
    };
    ButtressDbService.prototype.awaitConnection = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this._connected)
                            return [2 /*return*/, true];
                        return [4 /*yield*/, new Promise(function (r) { return _this._awaitConnectionPool.push(r); })];
                    case 1:
                        _a.sent();
                        console.log('awaited');
                        return [2 /*return*/, true];
                }
            });
        });
    };
    // eslint-disable-next-line class-methods-use-this
    ButtressDbService.prototype.get = function (path) {
        return this._store.get(path);
    };
    // eslint-disable-next-line class-methods-use-this
    ButtressDbService.prototype.set = function (path, value) {
        return this._store.set(path, value);
    };
    // eslint-disable-next-line class-methods-use-this
    ButtressDbService.prototype.push = function (path) {
        var _a;
        var items = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            items[_i - 1] = arguments[_i];
        }
        return (_a = this._store).push.apply(_a, __spreadArray([path], items, false));
    };
    // eslint-disable-next-line class-methods-use-this
    ButtressDbService.prototype.splice = function (path, start, deleteCount) {
        var _a;
        var items = [];
        for (var _i = 3; _i < arguments.length; _i++) {
            items[_i - 3] = arguments[_i];
        }
        if (arguments.length < 3) {
            return this._store.splice(path, start);
        }
        return (_a = this._store).splice.apply(_a, __spreadArray([path, start, deleteCount], items, false));
    };
    // eslint-disable-next-line class-methods-use-this
    ButtressDbService.prototype.subscribe = function (path, cb) {
        this._store.subscribe(path, cb);
        return true;
    };
    ButtressDbService.prototype.query = function (dataService, buttressQuery) {
        return __awaiter(this, void 0, void 0, function () {
            var ds;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        ds = this._dataServices[dataService];
                        if (!ds)
                            throw new Error('Unable to subscribe to path, data service doesn\'t exist');
                        return [4 /*yield*/, ds.query(buttressQuery)];
                    case 1: return [2 /*return*/, _a.sent()];
                }
            });
        });
    };
    ButtressDbService.prototype._resolveDataServiceFromPath = function (path) {
        var ds = path.toString().split('.')[0];
        return this._dataServices[ds];
    };
    ButtressDbService.prototype.render = function () {
        return (0, lit_1.html)(templateObject_1 || (templateObject_1 = __makeTemplateObject([""], [""])));
    };
    ButtressDbService.styles = (0, lit_1.css)(templateObject_2 || (templateObject_2 = __makeTemplateObject(["\n    :host {\n      display: none;\n    }\n  "], ["\n    :host {\n      display: none;\n    }\n  "])));
    return ButtressDbService;
}(ltn_element_1.LtnService));
exports.ButtressDbService = ButtressDbService;
var templateObject_1, templateObject_2;
