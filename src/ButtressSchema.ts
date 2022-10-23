import { ButtressSchemaFactory } from './ButtressSchemaFactory.js';
import type { ButtressSchemaProperties } from './types/ButtressSchemaProperties.js';
import type { ButtressSchemaProperty } from './types/ButtressSchemaProperty.js';

export type ButtressSchema = {
  name: string,
  type: string,
  properties: ButtressSchemaProperties,
};
export default ButtressSchema;

export class ButtressSchemaHelpers {
  static getSubSchema(schema: ButtressSchema, path: string): ButtressSchema | null {
    return path.split('.').reduce((out: ButtressSchema | null, part: string) => {
      if (!out) return null;

      const property = getPath(out.properties, part);
      if (!property) {
        return null;
      }
      if (property.type && property.type === 'array' && !property.__schema) {
        return null;
      }

      return {
        name: path,
        properties: property.__schema || property
      } as ButtressSchema;
    }, schema);
  }
  
  static getFlattened(schema: ButtressSchema): ButtressSchemaProperties {
    const __buildFlattenedSchema = (
      property: string,
      parent: ButtressSchemaProperties | ButtressSchemaProperty,
      path: string[],
      flattened: ButtressSchemaProperties
    ) => {
      type parentKey = keyof typeof parent;

      let flat = flattened;
      path.push(property);

      let isRoot = true;
      Object.keys(parent[property as parentKey]).forEach((childProp) => {
        if (/^__/.test(childProp)) {
          return;
        }

        isRoot = false;
        flat = Object.assign(flat, __buildFlattenedSchema(childProp, parent[property as parentKey], path, flat));
      });
  
      if (isRoot === true) {
        flat[path.join('.')] = parent[property as parentKey];
      }

      path.pop();
      return flat;
    };

    let flattened = {};
    const path: string[] = [];
    Object.keys(schema.properties).forEach((prop: string) => {
      flattened = Object.assign(flattened, __buildFlattenedSchema(prop, schema.properties, path, flattened));
    });
  
    return flattened;
  }

  static inflate(schema: ButtressSchema, createId: boolean) {
    const __inflateObject = (parent: {}, path: string[], value: any) => {
      const parentOut = parent;
      if (path.length > 1) {
        const parentKey = path.shift();
        if (!parentKey) return;

        if (!parentOut[parentKey]) {
          parentOut[parentKey] = {};
        }

        __inflateObject(parentOut[parentKey], path, value);
        return;
      }

      parentOut[path.shift()] = value;
      return parentOut;
    };

    const flattenedSchema = ButtressSchemaHelpers.getFlattened(schema);
    type flattenedSchemaKey = keyof typeof flattenedSchema;
  
    const res: ButtressSchemaProperties = {};
    const objects = {};
    Object.keys(flattenedSchema).forEach((property) => {
      const config = flattenedSchema[property];
      const propVal = {
        path: property,
        value: ButtressSchemaFactory.getPropDefault(config)
      };
  
      const path = propVal.path.split('.');
      const root = path.shift();
      if (!root) return;

      let {value} = propVal;
      if (path.length > 0) {
        if (!objects[root]) {
          objects[root] = {};
        }
        __inflateObject(objects[root], path, value);
        value = objects[root];
      }
  
      res[root] = value;
    });

    if (!res.id && createId) {
      res.id = ButtressSchemaFactory.getPropDefault({
        __type: 'id',
        __default: 'new'
      });
    }

    return res;
  }

  static clean(schema: ButtressSchema, path: string, value: any) {
    if (!schema) return false;

    let val = value;
    const flatSchema = this.getFlattened(schema);
    Object.keys(flatSchema).forEach((flatSchemaProperty) => {
      if (flatSchemaProperty !== path) return;
      const schemaProp = flatSchema[flatSchemaProperty];

      if (schemaProp.__type === 'boolean') {
        val = (/^true$/i).test(value);
      } else if (schemaProp.__type === 'number') {
        val = value.replace(/[^\d.\- ]/g, '');
      }
    });

    return val;
  }
}