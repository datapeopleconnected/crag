import { LtnLogLevel } from '@lighten/ltn-element';

export interface Settings {
  [index: string]: string | undefined | LtnLogLevel;

  endpoint?: string;
  token?: string;
  apiPath?: string;
  userId?: string;
  logLevel?: LtnLogLevel;
};
