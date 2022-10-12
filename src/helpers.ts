import { LtnLogLevel } from '@lighten/ltn-element';

export interface Settings {
  endpoint: string,
  token: string,
  apiPath: string,
  userId: string | null,
  logLevel?: LtnLogLevel
};