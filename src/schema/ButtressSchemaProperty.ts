import type { ButtressSchemaProperties } from './ButtressSchemaProperties.js';

export type ButtressSchemaProperty = {
  __type: string,
  __default?: any,
  __required?: boolean,
  __allowUpdate?: boolean,
  __enum?: string[],
  __schema?: ButtressSchemaProperties
}
