import type { ButtressSchemaProperties } from './schema/ButtressSchemaProperties.js';
import type { ButtressSchemaProperty } from './schema/ButtressSchemaProperty.js';

export type ButtressSchema = {
  name: string,
  type: string,
  properties: ButtressSchemaProperties,
};
export default ButtressSchema;

export class ButtressSchemaHelpers {
  static getSubSchema(schema: ButtressSchema, path: string) {
    return path.split('.').reduce((out: ButtressSchema, path: string) => {
      if (!out) return false; // Skip all paths if we hit a false

      const property = getPath(out.properties, path);
      if (!property) {
        return false;
      }
      if (property.type && property.type === 'array' && !property.__schema) {
        return false;
      }

      return {
        name: path,
        properties: property.__schema || property
      };
    }, schema);
  }
  
  static getFlattened(schema: ButtressSchema) {
    const __buildFlattenedSchema = (property: ButtressSchemaProperty, parent: ButtressSchemaProperties, path: string, flattened: {}) => {
      path.push(property);
  
      let isRoot = true;
      Object.keys(parent[property]).forEach((childProp) => {
        if (/^__/.test(childProp)) {
          return;
        }
  
        isRoot = false;
        __buildFlattenedSchema(childProp, parent[property], path, flattened);
      });
  
      if (isRoot === true) {
        flattened[path.join('.')] = parent[property];
        path.pop();
        return;
      }
  
      path.pop();
      return;
    };
  
    const flattened = {};
    const path = [];
    for (let property in schema.properties) {
      if (!schema.properties.hasOwnProperty(property)) continue;
      __buildFlattenedSchema(property, schema.properties, path, flattened);
    }
  
    return flattened;
  }

  static inflate(schema, createId) {
    const __inflateObject = (parent, path, value) => {
      if (path.length > 1) {
        let parentKey = path.shift();
        if (!parent[parentKey]) {
          parent[parentKey] = {};
        }
        __inflateObject(parent[parentKey], path, value);
        return;
      }
    
      parent[path.shift()] = value;
      return;
    };
    
    const flattenedSchema = AppDb.Schema.getFlattened(schema);
  
    const res = {};
    const objects = {};
    for (let property in flattenedSchema) {
      if (!flattenedSchema.hasOwnProperty(property)) continue;
      const config = flattenedSchema[property];
      let propVal = {
        path: property,
        value: AppDb.Factory.getPropDefault(config)
      };
  
      const path = propVal.path.split('.');
      const root = path.shift();
      let value = propVal.value;
      if (path.length > 0) {
        if (!objects[root]) {
          objects[root] = {};
        }
        __inflateObject(objects[root], path, value);
        value = objects[root];
      }
  
      res[root] = value;
    }

    if (!res.id && createId) {
      res.id = AppDb.Factory.getPropDefault({
        __type: 'id',
        __default: 'new'
      });
    }

    return res;
  }

  static clean(collection, path, value) {
    const schema = this.getSchema(collection);

    if (!schema) {
      return false;
    }

    let flatSchema = this.getFlattened(schema);

    for (let property in flatSchema) {
      if (!flatSchema.hasOwnProperty(property)) continue;
      if (property !== path) continue;
      const schemaProp = flatSchema[property];

      switch (schemaProp.__type) {
        case 'boolean':
          value = (/^true$/i).test(value);
          break;
        case 'number':
          value = value.replace(/[^\d\.\-\ ]/g, '');
          break;
      }

      break;
    }

    return value;
  }
}