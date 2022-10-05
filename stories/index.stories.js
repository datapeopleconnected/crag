"use strict";
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
exports.__esModule = true;
exports.SlottedContent = exports.CustomCounter = exports.CustomTitle = exports.Regular = void 0;
var lit_1 = require("lit");
require("../src/components/buttress-db-service.js");
exports["default"] = {
    title: 'ButtressDbService',
    component: 'buttress-db-service',
    argTypes: {
        title: { control: 'text' },
        counter: { control: 'number' },
        textColor: { control: 'color' }
    }
};
var Template = function (_a) {
    var _b = _a.title, title = _b === void 0 ? 'Hello world' : _b, _c = _a.counter, counter = _c === void 0 ? 5 : _c, textColor = _a.textColor, slot = _a.slot;
    return (0, lit_1.html)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["\n  <buttress-db-service\n    style=\"--buttress-db-service-text-color: ", "\"\n    .title=", "\n    .counter=", "\n  >\n    ", "\n  </buttress-db-service>\n"], ["\n  <buttress-db-service\n    style=\"--buttress-db-service-text-color: ", "\"\n    .title=", "\n    .counter=", "\n  >\n    ", "\n  </buttress-db-service>\n"])), textColor || 'black', title, counter, slot);
};
exports.Regular = Template.bind({});
exports.CustomTitle = Template.bind({});
exports.CustomTitle.args = {
    title: 'My title'
};
exports.CustomCounter = Template.bind({});
exports.CustomCounter.args = {
    counter: 123456
};
exports.SlottedContent = Template.bind({});
exports.SlottedContent.args = {
    slot: (0, lit_1.html)(templateObject_2 || (templateObject_2 = __makeTemplateObject(["<p>Slotted content</p>"], ["<p>Slotted content</p>"])))
};
exports.SlottedContent.argTypes = {
    slot: { table: { disable: true } }
};
var templateObject_1, templateObject_2;
