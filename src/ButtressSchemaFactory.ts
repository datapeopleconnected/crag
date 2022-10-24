import {ObjectId} from 'bson';
import Sugar from 'sugar';

import {ButtressSchema, ButtressSchemaHelpers} from './ButtressSchema.js';

import type { ButtressSchemaProperty } from './types/ButtressSchemaProperty.js';

export class ButtressSchemaFactory {
  static create(primarySchema: ButtressSchema, path: string) {
    let schema = primarySchema;
    if (!schema) throw new Error(`Missing primarySchema when attempting to create blank object`);

    if (path.split('.').length > 1) {
      const parts = path.split('.')
      const subSchema = ButtressSchemaHelpers.getSubSchema(primarySchema, parts.slice(1, parts.length).join('.'));
      if (!subSchema) throw new Error(`Unable to find schema at path ${path}`);
      schema = subSchema;
    }

    return ButtressSchemaHelpers.inflate(schema, schema === primarySchema);
  }

  static getObjectId() {
    return new ObjectId();
  }

  static getPropDefault(config: ButtressSchemaProperty): null | string | [] | {} {
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
          res = new ObjectId().toHexString();
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