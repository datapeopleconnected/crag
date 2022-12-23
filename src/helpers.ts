import { LtnLogLevel } from '@lighten/ltn-element';

export interface Settings {
  [index: string]: string | undefined | string[] | LtnLogLevel;

  endpoint?: string;
  token?: string;
  apiPath?: string;
  userId?: string;
  coreSchema?: string[];
  logLevel?: LtnLogLevel;
};
