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
import { v4 as uuidv4 } from 'uuid';

import { LtnLogLevel } from '@lighten/ltn-element';

export interface Settings {
  [index: string]: string | undefined | string[] | LtnLogLevel;

  clientSessionId: string;

  endpoint?: string;
  token?: string;
  apiPath?: string;
  userId?: string;
  coreSchema?: string[];
  logLevel?: LtnLogLevel;
};

export function buildSettings(settings: Partial<Settings>): Settings {
  if (settings.clientSessionId) {
    return settings as Settings;
  }

  return {
    ...settings,
    clientSessionId: uuidv4()
  };
}

export function Camelize(str: string, upper?: boolean): string {
  return str.replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => index === 0 && !upper ? word.toLowerCase() : word.toUpperCase()).replace(/\s+/g, '');
};
export function Dasherize(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

export function DateCreate(date: string | number | Date): Date {
  return new Date(date);
};
export function DateIsEqual(date: Date, compare: Date): boolean {
  return date.getTime() === compare.getTime();
}
export function DateIsBefore(date: Date, compare: Date): boolean {
  return date < compare;
}
export function DateIsAfter(date: Date, compare: Date): boolean {
  return date > compare;
}