import {ObjectId} from 'bson';
import Sugar from 'sugar';

import {ButtressSchema, ButtressSchemaHelpers} from './ButtressSchema.js';

import type { ButtressSchemaProperties } from './schema/ButtressSchemaProperties.js';

export class ButtressSchemaFactory {
  static create(primarySchema: ButtressSchema, path: string) {
    let schema = primarySchema;
    if (!schema) throw new Error(`Missing schema when trying to create new object`);

    if (path.split('.').length > 1) schema = ButtressSchemaHelpers.getSubSchema(primarySchema, path);

    return ButtressSchemaHelpers.inflate(schema, schema === primarySchema);
  }

  static getObjectId() {
    return new ObjectId();
  }

  static getPropDefault(config: ButtressSchemaProperties) {
    let res;
    // 🤨
    switch ((config.__type as unknown as string)) {
      default:
      case 'boolean':
        res = config.__default !== undefined ? config.__default : false;
        break;
      case 'string':
        res = config.__default !== undefined ? config.__default : '';
        break;
      case 'number':
        res = config.__default !== undefined ? config.__default : 0;
        break;
      case 'array':
        res = [];
        break;
      case 'object':
        res = {};
        break;
      case 'id':
        if (config.__default && config.__default === 'new') {
          res = new ObjectId();
        } else if (config.__default) {
          res = config.__default;
        } else {
          res = null;
        }  
        break;
      case 'date':
        if (config.__default === null) {
          res = null;
        } else if (config.__default) {
          res = Sugar.Date.create(config.__default);
        } else {
          res = new Date();
        }
    }
    return res;
  }
}