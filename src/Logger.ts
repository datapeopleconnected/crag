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

export enum LogLevel {
  ERROR,
  WARN,
  INFO,
  DEBUG,
  SYS,
}

export type LogLevelStrings = keyof typeof LogLevel;

export class Logger {
  protected _level: LogLevel = LogLevel.INFO;

  private _label: string;

  private _disable = false;

  static disableLogging = false;

  constructor(label: string, level: LogLevel = LogLevel.INFO) {
    this._label = label;
    this._level = level;
  }

  set level(level: LogLevel) {
    this._level = level;
  }

  set label(label: string) {
    this._label = label;
  }

  set disable(disable: boolean) {
    this._disable = disable;
  }

  error(...args: unknown[]) {
    console.error([this._label, ...args]);
  }

  warn(..._args: unknown[]) {
    if (Logger.disableLogging === false && this._disable === false && this._level >= LogLevel.WARN) {
      const args: unknown[] = ['[WARN]', `[${this._label}]`, ..._args];
      console.warn(...args);
    }
  }

  info(..._args: unknown[]) {
    if (Logger.disableLogging === false && this._disable === false && this._level >= LogLevel.INFO) {
      const args: unknown[] = ['[INFO]', `[${this._label}]`, ..._args];
      console.info(...args);
    }
  }

  debug(..._args: unknown[]) {
    if (Logger.disableLogging === false && this._disable === false && this._level >= LogLevel.DEBUG) {
      const args: unknown[] = ['[DEBUG]', `[${this._label}]`, ..._args];
      console.debug(...args);
    }
  }

  sys(..._args: unknown[]) {
    if (Logger.disableLogging === false && this._disable === false && this._level >= LogLevel.SYS) {
      const args: unknown[] = ['[SYS]', `[${this._label}]`, ..._args];
      console.debug(...args);
    }
  }
}
