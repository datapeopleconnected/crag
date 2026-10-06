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

import type { ButtressSchemaProperties } from './types/ButtressSchemaProperties.js';
import type { ButtressSchemaProperty } from './types/ButtressSchemaProperty.js';

/**
 * A Buttress query matched in memory as Buttress matches it, which is as MongoDB does: Buttress's own matcher
 * (matchQuery, in buttress-js src/access-control/operators.ts) is checked against MongoDB's answers, and this follows it. Operands are
 * read as their properties' types first, as Buttress's StandardModel.parseQuery reads them, and dates in the store,
 * which arrive as ISO strings, are read as dates, as Buttress stores them.
 */

// What the schema says of a value: a property, or an object's properties (the schema's own, a nested object's, or an
// array's items')
type Shape = ButtressSchemaProperty | ButtressSchemaProperties | undefined;

type MongoOperator =
  | '$eq'
  | '$ne'
  | '$gt'
  | '$gte'
  | '$lt'
  | '$lte'
  | '$in'
  | '$nin'
  | '$all'
  | '$exists'
  | '$regex'
  | '$elemMatch';

interface OperatorAlias {
  operator: MongoOperator;
  // The flags for a $regex
  options?: string;
  // The operand as MongoDB takes it
  operand?: (operand: unknown) => unknown;
}

export type Matcher = (document: unknown) => boolean;
// Whether the values a path reaches pass
type Test = (values: unknown[]) => boolean;

const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

// A lookup that has only the names given it, so a name such as `constructor` isn't found on Object.prototype
const lookup = <T>(entries: [string, T][]): Record<string, T> =>
  Object.assign(Object.create(null) as Record<string, T>, Object.fromEntries(entries));

// Each name by its `$op` and its `@op`, as Buttress takes both
const withAtNames = <T>(entries: [string, T][]) =>
  lookup(
    entries.flatMap(([name, value]): [string, T][] => [
      [name, value],
      [`@${name.slice(1)}`, value],
    ]),
  );

// Text matched as it is, rather than as a pattern. Buttress refuses an operand that isn't text.
const escapePattern = (operand: unknown) => String(operand).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ALIASES: Record<string, OperatorAlias> = withAtNames<OperatorAlias>([
  ['$eq', { operator: '$eq' }],
  ['$ne', { operator: '$ne' }],
  ['$not', { operator: '$ne' }],
  ['$gt', { operator: '$gt' }],
  ['$gte', { operator: '$gte' }],
  ['$lt', { operator: '$lt' }],
  ['$lte', { operator: '$lte' }],
  ['$gtDate', { operator: '$gt' }],
  ['$gteDate', { operator: '$gte' }],
  ['$ltDate', { operator: '$lt' }],
  ['$lteDate', { operator: '$lte' }],
  ['$in', { operator: '$in' }],
  ['$nin', { operator: '$nin' }],
  ['$all', { operator: '$all' }],
  ['$exists', { operator: '$exists' }],
  ['$rex', { operator: '$regex' }],
  ['$rexi', { operator: '$regex', options: 'i' }],
  ['$regex', { operator: '$regex' }],
  // The property holds the text
  ['$inProp', { operator: '$regex', operand: escapePattern }],
  ['$elMatch', { operator: '$elemMatch' }],
  ['$elemMatch', { operator: '$elemMatch' }],
]);

const LOGICAL_ALIASES = withAtNames<'$and' | '$or' | '$nor'>([
  ['$and', '$and'],
  ['$or', '$or'],
  ['$nor', '$nor'],
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

// A document whose fields a path reaches: an object of fields, or a Map
const isDocument = (value: unknown): value is Record<string, unknown> | Map<string, unknown> =>
  isPlainObject(value) || value instanceof Map;

const isOperatorName = (key: string) => key.startsWith('$') || key.startsWith('@');

// An object a query gives a property is its operators if one of its keys is an operator's name. Any other is a value,
// compared whole.
const hasOperatorNames = (value: unknown): value is Record<string, unknown> =>
  isPlainObject(value) && Object.keys(value).some(isOperatorName);

// Whether an $elMatch takes the operators a value of the list must pass (`{$gt: 1}`), rather than a query an item must
// match (`{sku: 'a'}`, `{$or: [...]}`)
const isValueOperators = (value: Record<string, unknown>) =>
  Object.keys(value).length > 0 && Object.keys(value).every((key) => isOperatorName(key) && !has(LOGICAL_ALIASES, key));

const asList = (operand: unknown): unknown[] => (Array.isArray(operand) ? operand : [operand]);

const never = () => false;

/*
 * The schema
 */

const isProperty = (shape: Shape): shape is ButtressSchemaProperty => typeof shape?.__type === 'string';

// A shape's own entry for a field, not one an object has from Object.prototype
const fieldShape = (fields: Shape, name: string): Shape =>
  fields && has(fields, name) ? (fields as Record<string, Shape>)[name] : undefined;

// The properties of a document of this shape: a nested object's, or an array's items'
const fieldsOf = (shape: Shape): Shape => (isProperty(shape) ? shape.__schema : shape);

// The shape of an array's items: an array property's, or a nested object's properties for an array of them
const itemShape = (shape: Shape): Shape => {
  if (!isProperty(shape)) return shape;
  return shape.__schema ?? (shape.__itemtype ? { __type: shape.__itemtype } : undefined);
};

// The property a query's path names, as Buttress looks it up: through nested objects and arrays' items, though not
// through an index
const shapeAt = (fields: Shape, segments: string[]): Shape =>
  segments.reduce((shape: Shape, segment) => fieldShape(fieldsOf(shape), segment), fields);

/*
 * Reading values
 */

const asDate = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(asDate);
  if (typeof value !== 'string') return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
};

// A stored value as Buttress has it: its dates read as dates. A date that can't be read is left as it is.
const read = (value: unknown, shape: Shape): unknown => {
  if (!shape) return value;
  if (isProperty(shape)) {
    if (shape.__type === 'date' || shape.__itemtype === 'date') return asDate(value);
    return shape.__schema ? read(value, shape.__schema) : value;
  }
  if (Array.isArray(value)) return value.map((item) => read(item, shape));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, read(field, fieldShape(shape, key))]));
};

// Where a path reaches a field a document hasn't got: null to a comparison with null, and not there to $exists
const MISSING = Symbol('missing');

/**
 * The values a dotted path reaches in a document, as MongoDB reaches them: through each document of an array on the way
 * (and the item a numeric segment names), and at the end an array as well as each of its items. A document without
 * the field gives MISSING, as does a value that isn't a document where a field is looked for, but an array's items that
 * aren't documents are passed over.
 */
const valuesAt = (value: unknown, segments: string[], shape: Shape, inArray = false): unknown[] => {
  if (segments.length < 1) {
    if (value === undefined) return inArray ? [] : [MISSING];
    const stored = read(value, shape);
    return Array.isArray(stored) ? [stored, ...stored] : [stored];
  }

  const [head, ...rest] = segments;
  if (Array.isArray(value)) {
    const item = itemShape(shape);
    const byIndex = /^\d+$/.test(head) ? valuesAt(value[Number(head)], rest, item, true) : [];
    return [...byIndex, ...value.flatMap((entry) => (isDocument(entry) ? fieldAt(entry, head, rest, item) : []))];
  }
  if (isDocument(value)) return fieldAt(value, head, rest, shape);
  return inArray ? [] : [MISSING];
};

const fieldAt = (
  document: Record<string, unknown> | Map<string, unknown>,
  name: string,
  rest: string[],
  shape: Shape,
) => {
  const shapeOfField = fieldShape(fieldsOf(shape), name);
  if (document instanceof Map) return document.has(name) ? valuesAt(document.get(name), rest, shapeOfField) : [MISSING];
  return has(document, name) ? valuesAt(document[name], rest, shapeOfField) : [MISSING];
};

/*
 * Reading operands
 */

// The types Buttress reads a compared operand as. It reads ids and uuids too, but they're text here.
const QUERY_TYPES = new Set(['boolean', 'number', 'date']);
const COMPARISONS = new Set<MongoOperator>(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$all']);
const BOOLEANS: Record<string, boolean> = { true: true, yes: true, '1': true, false: false, no: false, '0': false };

// The type a property's compared operands are read as: its own, or its items'
const comparedType = (shape: Shape) => {
  if (!isProperty(shape)) return undefined;
  if (QUERY_TYPES.has(shape.__type)) return shape.__type;
  return shape.__type === 'array' && shape.__itemtype && QUERY_TYPES.has(shape.__itemtype)
    ? shape.__itemtype
    : undefined;
};

// An operand, or each of a list of them, read as a type, as Buttress reads it. Null is left, to match a property with
// no value, and so is an operand that can't be read, which Buttress refuses the query for.
const decode = (type: string, operand: unknown): unknown => {
  if (Array.isArray(operand)) return operand.map((item) => decode(type, item));

  if (type === 'boolean') {
    if (operand === 1 || operand === 0) return operand === 1;
    if (typeof operand === 'string' && has(BOOLEANS, operand.toLowerCase())) return BOOLEANS[operand.toLowerCase()];
  } else if (type === 'number') {
    if (typeof operand === 'string' && !Number.isNaN(Number(operand))) return Number(operand);
  } else if (typeof operand === 'string' || typeof operand === 'number') {
    const date = new Date(operand);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return operand;
};

/*
 * Comparing
 */

// MongoDB compares values of one type only: numbers with numbers, text with text, dates with dates...
const typeOf = (value: unknown) =>
  value === null
    ? 'null'
    : value instanceof Date
      ? 'date'
      : Array.isArray(value)
        ? 'array'
        : typeof value === 'object'
          ? 'object'
          : typeof value;

const isEqual = (a: unknown, b: unknown): boolean => {
  const type = typeOf(a);
  if (type !== typeOf(b)) return false;
  if (type === 'date') return (a as Date).getTime() === (b as Date).getTime();
  if (type === 'array') {
    const [x, y] = [a as unknown[], b as unknown[]];
    return x.length === y.length && x.every((item, idx) => isEqual(item, y[idx]));
  }
  if (type === 'object') {
    // As MongoDB compares documents: the same fields, in the same order
    const [x, y] = [a as Record<string, unknown>, b as Record<string, unknown>];
    const [xKeys, yKeys] = [Object.keys(x), Object.keys(y)];
    return xKeys.length === yKeys.length && xKeys.every((key, idx) => yKeys[idx] === key && isEqual(x[key], y[key]));
  }
  return a === b;
};

// The order of two values of one type, or null for values MongoDB doesn't compare
const order = (a: unknown, b: unknown): number | null => {
  const type = typeOf(a);
  if (type !== typeOf(b)) return null;
  if (type === 'number' || type === 'string' || type === 'boolean') {
    return a === b ? 0 : (a as number) > (b as number) ? 1 : -1;
  }
  if (type === 'date') return Math.sign((a as Date).getTime() - (b as Date).getTime());
  return null;
};

// A field equal to the operand: one of its values is, and null for a field that's null or that a document hasn't got
const equals = (values: unknown[], operand: unknown) =>
  operand === null
    ? values.some((value) => value === null || value === MISSING)
    : values.some((value) => isEqual(value, operand));

const compares = (values: unknown[], operand: unknown, passes: (order: number) => boolean, orEqualNull: boolean) => {
  if (operand === null) return orEqualNull && equals(values, null);
  return values.some((value) => {
    const result = order(value, operand);
    return result !== null && passes(result);
  });
};

/*
 * Compiling
 */

// The test of a field's values for an object of operators, every one of which must pass
const compileOperators = (operators: Record<string, unknown>, shape: Shape, unknownOperators: string[]): Test => {
  const tests = Object.entries(operators).map(([name, given]): Test => {
    if (!has(ALIASES, name)) {
      unknownOperators.push(name);
      return never;
    }

    const alias = ALIASES[name];
    const type = COMPARISONS.has(alias.operator) ? comparedType(shape) : undefined;
    const operand = type ? decode(type, given) : given;
    const list = asList(operand);

    switch (alias.operator) {
      case '$eq':
        return (values) => equals(values, operand);
      case '$ne':
        return (values) => !equals(values, operand);
      case '$gt':
        return (values) => compares(values, operand, (r) => r > 0, false);
      case '$gte':
        return (values) => compares(values, operand, (r) => r >= 0, true);
      case '$lt':
        return (values) => compares(values, operand, (r) => r < 0, false);
      case '$lte':
        return (values) => compares(values, operand, (r) => r <= 0, true);
      case '$in':
        return (values) => list.some((item) => equals(values, item));
      case '$nin':
        return (values) => !list.some((item) => equals(values, item));
      case '$all':
        // MongoDB's $all of an empty list matches nothing
        return (values) => list.length > 0 && list.every((item) => equals(values, item));
      case '$exists':
        return (values) => values.some((value) => value !== MISSING) === Boolean(operand);
      case '$regex': {
        const pattern = new RegExp(String(alias.operand ? alias.operand(operand) : operand), alias.options);
        return (values) => values.some((value) => typeof value === 'string' && pattern.test(value));
      }
      case '$elemMatch': {
        if (!isPlainObject(operand)) return never;
        const matches = itemTest(operand, shape, unknownOperators);
        return (values) => values.some((value) => Array.isArray(value) && value.some(matches));
      }
    }
  });
  return (values) => tests.every((test) => test(values));
};

// Whether an item of a list matches an $elMatch: as a value its operators test, read as the list's items are, or as a
// document its query matches
const itemTest = (
  query: Record<string, unknown>,
  shape: Shape,
  unknownOperators: string[],
): ((item: unknown) => boolean) => {
  if (isValueOperators(query)) {
    const test = compileOperators(query, shape, unknownOperators);
    return (item) => test([item]);
  }
  const matches = compileQuery(query, fieldsOf(shape), unknownOperators);
  return (item) => isDocument(item) && matches(item);
};

/**
 * A Buttress query as a test of a document, each of its conditions and logical operators, all of them.
 * @param {object} query - a Buttress query, its operators in their `$op` or `@op` names
 * @param {object} [fields] - the schema's properties, to read operands and stored dates by
 * @param {string[]} [unknownOperators] - collects the names of operators it doesn't know, each of which matches nothing
 * @return {Matcher}
 */
export function compileQuery(query: Record<string, unknown>, fields?: Shape, unknownOperators: string[] = []): Matcher {
  const parts = Object.entries(query).flatMap(([key, condition]): Matcher[] => {
    if (has(LOGICAL_ALIASES, key)) {
      const queries = asList(condition).map((part) =>
        compileQuery(part as Record<string, unknown>, fields, unknownOperators),
      );
      // Buttress passes over a logical operator with an empty list
      if (queries.length < 1) return [];

      const logical = LOGICAL_ALIASES[key];
      if (logical === '$and') return [(document) => queries.every((matches) => matches(document))];
      if (logical === '$or') return [(document) => queries.some((matches) => matches(document))];
      return [(document) => !queries.some((matches) => matches(document))];
    }
    // Any other operator's name in a property's place names no property
    if (isOperatorName(key)) {
      unknownOperators.push(key);
      return [never];
    }

    const segments = key.split('.');
    const shape = shapeAt(fields, segments);
    // A value is compared whole: a list, an object of fields, a date
    const test = compileOperators(
      hasOperatorNames(condition) ? condition : { $eq: condition },
      shape,
      unknownOperators,
    );
    return [(document) => test(valuesAt(document, segments, fields))];
  });
  return (document) => parts.every((matches) => matches(document));
}
