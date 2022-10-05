"use strict";
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
var bson_browser_esm_js_1 = require("bson/dist/bson.browser.esm.js");
var ButtressDataService = /** @class */ (function () {
    function ButtressDataService(name, settings, store, schema) {
        var _this = this;
        this.BUNDLED_REQUESTS_TYPES = ['add', 'update'];
        this._queryMap = [];
        this._requestQueue = [];
        this.status = 'pending';
        this.core = false;
        this.bundling = true;
        this.bundlingChunk = 100;
        this.name = name;
        this._settings = settings;
        if (schema)
            this.updateSchema(schema);
        this._store = store;
        this._store.subscribe("".concat(this.name, ".*, ").concat(this.name), function (cr) { return _this._processDataChange(cr); });
    }
    // eslint-disable-next-line class-methods-use-this
    ButtressDataService.prototype._processDataChange = function (cr) {
        var _this = this;
        if (/\.length$/.test(cr.path) === true) {
            return;
        }
        if (/__(\w+)__/.test(cr.path)) {
            console.log("Ignoring internal change: ".concat(cr.path));
            return;
        }
        console.log(cr);
        var path = cr.path.split('.');
        if (/\.splices$/.test(cr.path) === true) {
            if (path.length < 3) {
                // Modification to base
                cr.value.indexSplices.forEach(function (i) {
                    var o = i.object[i.index];
                    if (i.addedCount > 0) {
                        if (o.__readonly__) {
                            delete o.__readonly__;
                            return;
                        }
                        if (!o.id)
                            o.id = new bson_browser_esm_js_1.ObjectId().toString();
                        _this._generateAddRequest(o);
                    }
                    i.removed.forEach(function (r) {
                        if (r.__readonly__) {
                            console.log("Ignoring __readonly__ splice for ".concat(r.id));
                            delete r.__readonly__;
                            return;
                        }
                        console.log("this.__generateRmRequest(".concat(r.id, ");"));
                        _this._generateRmRequest(r.id);
                    });
                });
            }
            else {
                var entity = this._store.get(path.slice(0, 2));
                if (entity.__readOnlyChange__) {
                    console.log("Ignoring readonly change: ".concat(cr.path));
                    delete entity.__readOnlyChange__;
                    return;
                }
                console.log(entity);
                console.log('Child array mutation', cr);
                console.log('Key Splices: ', cr.value.indexSplices.length);
                // if (cr.value.indexSplices.length > 0) {
                //   cr.value.indexSplices.forEach(i => {
                //     let o = i.object[i.index];
                //     if (i.addedCount > 0) {
                //       path.splice(0,2);
                //       path.splice(-1,1);
                //       // if (this.get('logging')) console.log('Update request', entity.id, path.join('.'), cr.value);
                //       if (typeof o === 'object' && !o.id) {
                //         o.id = AppDb.Factory.getObjectId();
                //       }
                //       console.log(`this.__generateUpdateRequest(${entity.id}, ${path.join('.')}, ${o});`);
                //       // this.__generateUpdateRequest(entity.id, path.join('.'), o);
                //     } else if (i.removed.length > 0){
                //       if(i.removed.length > 1) {
                //         if (this.get('logging')) console.log('Index splice removed.length > 1', i.removed);
                //       } else {
                //         path.splice(0, 2);
                //         path.splice(-1, 1);
                //         path.push(i.index);
                //         path.push('__remove__');
                //         console.log(`this.__generateUpdateRequest(${entity.id}, ${path.join('.')}, '');`);
                //         // this.__generateUpdateRequest(entity.id, path.join('.'), '');
                //       }
                //     }
                //   });
                // } else if (cr.value.keySplices) {
                //   console.log('Key Splices: ', cr.value.keySplices.length);
                //   cr.value.keySplices.forEach((k, idx) => {
                //     k.removed.forEach(() => {
                //       let itemIndex = cr.value.indexSplices[idx].index;
                //       console.log(itemIndex);
                //       path.splice(0, 2); // drop the prefix
                //       path.splice(-1, 1); // drop the .splices
                //       path.push(itemIndex); // add the correct index
                //       // path.push(k.replace('#', ''));
                //       path.push('__remove__'); // add the remove command
                //       this.__generateUpdateRequest(entity.id, path.join('.'), '');
                //     });
                //   });
                // }
            }
        }
        else {
            if (path.length < 2) {
                // Path is a whole update to the collection so we'll ignore it
                return;
            }
            var pathToEntity = path.splice(0, 2).join('.');
            var item = this._store.get(pathToEntity);
            this._generateUpdateRequest(item.id, path.join('.'), cr.value);
        }
    };
    ButtressDataService.prototype.updateSchema = function (schema) {
        this._schema = schema;
    };
    ButtressDataService.prototype.query = function (buttressQuery) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this._settings)
                            return [2 /*return*/, undefined];
                        return [4 /*yield*/, this.search(buttressQuery)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, this._filterLocalData(buttressQuery)];
                }
            });
        });
    };
    ButtressDataService.prototype._filterLocalData = function (buttressQuery, opts) {
        var data = this._store.get(this.name);
        try {
            data = this._processQueryPart(buttressQuery, data);
        }
        catch (err) {
            console.error('Query was:', this.query);
            throw err;
        }
        if (opts === null || opts === void 0 ? void 0 : opts.sortPath) {
            //   data.sort((a: any, b: any) => this.__sort(a, b));
        }
        return data;
    };
    ButtressDataService.prototype._processQueryPart = function (query, data) {
        var _this = this;
        var output = data.slice(0);
        for (var _i = 0, _a = Object.keys(query); _i < _a.length; _i++) {
            var field = _a[_i];
            if (field === '$and') {
                // eslint-disable-next-line no-loop-func
                query[field].forEach(function (o) {
                    output = _this._processQueryPart(o, output);
                });
            }
            else if (field === '$or') {
                output = query[field]
                    // eslint-disable-next-line no-loop-func
                    .map(function (o) { return _this._processQueryPart(o, output); })
                    .reduce(function (combined, results) { return combined.concat(results.filter(function (r) { return combined.indexOf(r) === -1; })); }, []);
            }
            else {
                var command = query[field];
                for (var _b = 0, _c = Object.keys(command); _b < _c.length; _b++) {
                    var operator = _c[_b];
                    output = this._queryFilterData(output, field, operator, command[operator]);
                }
            }
        }
        return output;
    };
    // eslint-disable-next-line class-methods-use-this
    ButtressDataService.prototype._parsePath = function (obj, path) {
        var value = this._store.get(path, obj);
        return Array.isArray(value) ? value : [value];
    };
    ButtressDataService.prototype._queryFilterData = function (data, field, operator, operand) {
        var _this = this;
        var fns = {
            $not: function (rhs) { return function (lhs) { return _this._parsePath(lhs, field).findIndex(function (val) { return val !== rhs; }) !== -1; }; },
            $eq: function (rhs) { return function (lhs) { return _this._parsePath(lhs, field).findIndex(function (val) { return val === rhs; }) !== -1; }; },
            $gt: function (rhs) { return function (lhs) { return _this._parsePath(lhs, field).findIndex(function (val) { return val > rhs; }) !== -1; }; },
            $lt: function (rhs) { return function (lhs) { return _this._parsePath(lhs, field).findIndex(function (val) { return val < rhs; }) !== -1; }; },
            $gte: function (rhs) { return function (lhs) { return _this._parsePath(lhs, field).findIndex(function (val) { return val >= rhs; }) !== -1; }; },
            $lte: function (rhs) { return function (lhs) { return _this._parsePath(lhs, field).findIndex(function (val) { return val <= rhs; }) !== -1; }; },
            $rex: function (rhs) { return function (lhs) { return _this._parsePath(lhs, field).findIndex(function (val) { return (new RegExp(rhs)).test(val); }) !== -1; }; },
            $rexi: function (rhs) { return function (lhs) { return _this._parsePath(lhs, field).findIndex(function (val) { return (new RegExp(rhs, 'i')).test(val); }) !== -1; }; },
            $in: function (rhs) { return function (lhs) { return rhs.indexOf(lhs[field]) !== -1; }; },
            $nin: function (rhs) { return function (lhs) { return rhs.indexOf(lhs[field]) === -1; }; },
            $exists: function (rhs) { return function (lhs) { return _this._parsePath(lhs, field).findIndex(function (val) { return val === undefined; }) === -1 === rhs; }; },
            $inProp: function (rhs) { return function (lhs) { return lhs[field].indexOf(rhs) !== -1; }; },
            $elMatch: function (rhs) { return function (lhs) { return _this._processQueryPart(rhs, _this._parsePath(lhs, field)).length > 0; }; }
        };
        if (!fns[operator]) {
            console.error(new Error("Invalid operator: ".concat(operator)));
            return [];
        }
        return data.filter(fns[operator](operand));
    };
    ButtressDataService.prototype.search = function (buttressQuery) {
        return __awaiter(this, void 0, void 0, function () {
            var hash, req, init, response, body;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this._settings)
                            return [2 /*return*/, undefined];
                        hash = this._hashQuery(buttressQuery);
                        if (this._queryMap.indexOf("".concat(hash)) !== -1)
                            return [2 /*return*/, Promise.resolve(false)];
                        req = "".concat(this._settings.endpoint, "/").concat(this._settings.apiPath, "/api/v1/").concat(this.name, "?urq").concat(Date.now(), "&token=").concat(this._settings.token);
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
                        body = null;
                        if (!response.ok) return [3 /*break*/, 3];
                        return [4 /*yield*/, response.json()];
                    case 2:
                        body = _a.sent();
                        // this.set(this.name, body);
                        this._store.set(this.name, body);
                        this._queryMap.push("".concat(hash));
                        return [3 /*break*/, 4];
                    case 3: throw new Error("Buttress Error: ".concat(response.status, ": ").concat(response.statusText));
                    case 4: return [2 /*return*/, body];
                }
            });
        });
    };
    ButtressDataService.prototype._hashQuery = function (object) {
        var str = this.name + JSON.stringify(object);
        var hash = 0;
        if (str.length === 0)
            return hash;
        for (var i = 0; i < str.length; i += 1) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
    };
    ButtressDataService.prototype._updateQueue = function () {
        if (this._requestQueue.length === 0)
            return;
        if (this.status === 'working')
            return;
        // TODO: Debounce method
        this._reduceRequests();
    };
    ButtressDataService.prototype._generateListRequest = function () {
        return this._queueRequest({
            type: 'list',
            url: this.getUrl(),
            method: 'GET'
        });
    };
    ButtressDataService.prototype._generateGetRequest = function (entityId) {
        return this._queueRequest({
            type: 'get',
            url: this.getUrl(entityId),
            method: 'GET'
        });
    };
    ButtressDataService.prototype._generateSearchRequest = function (query, limit, skip, sort, project) {
        if (limit === void 0) { limit = 0; }
        if (skip === void 0) { skip = 0; }
        return this._queueRequest({
            type: 'search',
            url: this.getUrl(),
            method: 'SEARCH',
            contentType: 'application/json',
            body: {
                query: query,
                limit: limit,
                skip: skip,
                sort: sort,
                project: project
            }
        });
    };
    ButtressDataService.prototype._generateRmRequest = function (entityId) {
        return this._queueRequest({
            type: 'delete',
            url: this.getUrl(entityId),
            entityId: entityId,
            method: 'DELETE'
        });
    };
    ButtressDataService.prototype._generateCountRequest = function (query) {
        return this._queueRequest({
            type: 'count',
            url: this.getUrl('count'),
            method: 'SEARCH',
            body: {
                query: query
            }
        });
    };
    ButtressDataService.prototype._generateAddRequest = function (entity) {
        return this._queueRequest({
            type: 'add',
            url: this.getUrl(),
            entityId: -1,
            method: 'POST',
            contentType: 'application/json',
            body: entity
        });
    };
    ButtressDataService.prototype._generateUpdateRequest = function (entityId, path, value) {
        return this._queueRequest({
            type: 'update',
            url: this.getUrl(entityId),
            entityId: entityId,
            method: 'PUT',
            contentType: 'application/json',
            body: {
                path: path,
                value: value
            }
        });
    };
    ButtressDataService.prototype._queueRequest = function (request) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            request.resolve = resolve;
            request.reject = reject;
            _this._requestQueue.push(request);
            _this._updateQueue();
        });
    };
    // eslint-disable-next-line class-methods-use-this
    ButtressDataService.prototype._reduceRequests = function () {
        this.status = 'working';
        // Prioritise additions & deletions
        var requestIdx = this._requestQueue.findIndex(function (r) { return r.type === 'add' || r.type === 'delete'; });
        var request = (requestIdx !== -1 && this.bundling) ? this._requestQueue.splice(requestIdx, 1).shift() : this._requestQueue.shift();
        if (this.bundling && this.BUNDLED_REQUESTS_TYPES.includes(request.type)) {
            console.log('bulk compatible request, trying to chunk:', request.type);
            var requests_1 = __spreadArray([
                request
            ], this._requestQueue.filter(function (r) { return r.type === request.type; })
                .splice(0, this.bundlingChunk - 1), true);
            if (requests_1.length > 1) {
                this._requestQueue = this._requestQueue.filter(function (r) { return !requests_1.includes(r); });
                request = {
                    type: "bulk/".concat(request.type),
                    url: "".concat(this.getUrl('bulk', request.type)),
                    entityId: -1,
                    method: 'POST',
                    contentType: 'application/json',
                    body: null,
                    dependentRequests: requests_1
                };
                if (request.type === 'bulk/update') {
                    request.body = requests_1.map(function (rq) { return ({
                        id: rq.entityId,
                        body: rq.body
                    }); });
                }
                else {
                    request.body = requests_1.map(function (rq) { return rq.body; });
                }
            }
        }
        // const request = this._requestQueue.shift();
        return this._generateRequest(request);
    };
    ButtressDataService.prototype._generateRequest = function (request) {
        return __awaiter(this, void 0, void 0, function () {
            var body, response, err_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        body = (request.body) ? JSON.stringify(request.body) : null;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, fetch("".concat(request.url, "?urq=").concat(Date.now(), "&token=").concat(this._settings.token), {
                                method: request.method,
                                cache: 'no-store',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: body
                            })];
                    case 2:
                        response = _a.sent();
                        if (response.ok) {
                            this.status = 'done';
                        }
                        else {
                            // Handle Buttress Error
                            throw new Error("DS ERROR [".concat(request.type, "] ").concat(response.status, " ").concat(request.url, " - ").concat(response.statusText));
                        }
                        return [3 /*break*/, 5];
                    case 3:
                        err_1 = _a.sent();
                        // will only reject on network failure or if anything prevented the request from completing.
                        console.error(err_1);
                        if (request.reject)
                            request.reject(err_1);
                        this.status = 'error';
                        return [3 /*break*/, 5];
                    case 4:
                        this._updateQueue();
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    ButtressDataService.prototype.getUrl = function () {
        var parts = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            parts[_i] = arguments[_i];
        }
        if (!this.core && this._settings.apiPath) {
            return "".concat(this._settings.endpoint, "/").concat(this._settings.apiPath, "/api/v1/").concat(this.name, "/").concat(parts.join('/'));
        }
        return "".concat(this._settings.endpoint, "/").concat(this._settings.apiPath, "/").concat(this.name, "/").concat(parts.join('/'));
    };
    return ButtressDataService;
}());
exports["default"] = ButtressDataService;
