/**
 * Buttress Crag
 * Copyright (C) 2016-2024 Data People Connected LTD.
 * <https://www.dpc-ltd.com/>
 *
 * This file is part of Buttress Crag.
 * Buttress Crag is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public Licence as published by the Free Software
 * Foundation, either version 3 of the Licence, or (at your option) any later version.
 * Buttress Crag is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public Licence for more details.
 * You should have received a copy of the GNU Affero General Public Licence along with
 * this program. If not, see <http://www.gnu.org/licenses/>.
 */

import ButtressStore from './ButtressStore.js';
import { ButtressSchemaFactory } from './ButtressSchemaFactory.js';
import type { ButtressSchemaProperties } from './types/ButtressSchemaProperties.js';
import type { ButtressSchemaProperty } from './types/ButtressSchemaProperty.js';

export type ButtressSchema = {
  name: string;
  type: string;
  core?: boolean;
  properties: ButtressSchemaProperties;
};
export default ButtressSchema;

export class ButtressSchemaHelpers {
  static getSubSchema(schema: ButtressSchema, path: string): ButtressSchema | null {
    let parent: ButtressSchemaProperty | undefined;
    return path.split('.').reduce((out: ButtressSchema | null, part: string) => {
      if (!out) return null;
      if (ButtressSchemaHelpers.isItemIndex(parent, part)) {
        parent = undefined;
        return out;
      }

      const property = ButtressStore.get(part, out.properties);
      if (!property) {
        return null;
      }
      // Only a nested object (no __type) or a property with a __schema has properties to build an object from.
      if (property.__type && !property.__schema) {
        return null;
      }

      parent = property;
      return {
        name: path,
        properties: property.__schema || property,
      } as ButtressSchema;
    }, schema);
  }

  static getFlattened(schema: ButtressSchema): ButtressSchemaProperties {
    const __buildFlattenedSchema = (
      property: string,
      parent: ButtressSchemaProperties | ButtressSchemaProperty,
      path: string[],
      flattened: ButtressSchemaProperties,
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
    // __ keys aren't skipped here: at the top level they're property names, like the core apps schema's __roles.
    Object.keys(schema.properties).forEach((prop: string) => {
      flattened = Object.assign(flattened, __buildFlattenedSchema(prop, schema.properties, path, flattened));
    });

    return flattened;
  }

  static inflate(schema: ButtressSchema, createId: boolean) {
    type InflatedObject = { [index: string]: unknown };

    const __inflateObject = (parent: InflatedObject, path: string[], value: any): InflatedObject => {
      const parentOut = parent;
      if (path.length > 1) {
        const parentKey = path.shift();
        if (!parentKey) return parentOut;

        if (!parentOut[parentKey]) {
          parentOut[parentKey] = {};
        }

        __inflateObject(parentOut[parentKey] as InflatedObject, path, value);
        return parentOut;
      }

      const part = path.shift();
      if (!part) return parentOut;

      parentOut[part] = value;
      return parentOut;
    };

    const flattenedSchema = ButtressSchemaHelpers.getFlattened(schema);
    // type flattenedSchemaKey = keyof typeof flattenedSchema;

    const res: { [index: string]: any } = {};
    const objects: { [index: string]: InflatedObject } = {};
    Object.keys(flattenedSchema).forEach((property) => {
      const config = flattenedSchema[property];
      const propVal = {
        path: property,
        value: ButtressSchemaFactory.getPropDefault(config),
      };

      const path = propVal.path.split('.');
      const root = path.shift();
      if (!root) return;

      let { value } = propVal;
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
        __default: 'new',
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
        val = /^true$/i.test(value);
      } else if (schemaProp.__type === 'number') {
        val = value.replace(/[^\d.\- ]/g, '');
      }
    });

    return val;
  }

  static getProperty(schema: ButtressSchema, path: string): ButtressSchemaProperty | undefined {
    const parts = path.toString().split('.');
    let props: any = schema.properties;

    for (let i = 0; i < parts.length; i += 1) {
      if (!props) return undefined;
      const prop = props[parts[i]];

      if (prop?.__schema && i < parts.length - 1) {
        props = prop.__schema;
        if (ButtressSchemaHelpers.isItemIndex(prop, parts[i + 1])) i += 1;
      } else {
        props = prop;
      }
    }

    return props;
  }

  // Data paths name one item of an array (`contacts.0.phones`), while the schema describes all of
  // them at once (`contacts.phones`), so getProperty and getSubSchema both step over the index.
  private static isItemIndex(property: ButtressSchemaProperty | undefined, part: string): boolean {
    return property?.__type === 'array' && !!property.__schema && /^\d+$/.test(part);
  }
}
