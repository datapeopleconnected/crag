"use strict";
exports.__esModule = true;
var socket_io_client_1 = require("socket.io-client");
var ButtressDataRealtime = /** @class */ (function () {
    function ButtressDataRealtime(store, settings) {
        this._connected = false;
        this._store = store;
        this._settings = settings;
    }
    ButtressDataRealtime.prototype.connect = function () {
        var _a, _b, _c;
        if (!((_a = this._settings) === null || _a === void 0 ? void 0 : _a.endpoint)) {
            throw new Error("Missing setting 'endpoint' while trying to connect to buttress");
        }
        if (!((_b = this._settings) === null || _b === void 0 ? void 0 : _b.token)) {
            throw new Error("Missing setting 'endpoint' while trying to connect");
        }
        var uri = ((_c = this._settings) === null || _c === void 0 ? void 0 : _c.apiPath) ? "".concat(this._settings.endpoint, "/").concat(this._settings.apiPath) : this._settings.endpoint;
        try {
            this._socket = (0, socket_io_client_1["default"])(uri);
        }
        catch (err) {
            this._connected = false;
            console.error(err);
        }
    };
    return ButtressDataRealtime;
}());
exports["default"] = ButtressDataRealtime;
