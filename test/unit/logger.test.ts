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

import { expect } from '@open-wc/testing';

import { Logger, LogLevel } from '../../src/Logger.js';

describe('Logger', () => {
  let printed: string[];
  const originals = { warn: console.warn, info: console.info, debug: console.debug, error: console.error };

  beforeEach(() => {
    printed = [];
    const record = (...args: unknown[]) => printed.push(args.join(' '));
    console.warn = record;
    console.info = record;
    console.debug = record;
    console.error = record;
  });

  afterEach(() => {
    Object.assign(console, originals);
    Logger.disableLogging = false;
  });

  const logAll = (logger: Logger) => {
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    logger.sys('s');
  };

  it('prints the levels up to its own', () => {
    logAll(new Logger('test', LogLevel.WARN));

    expect(printed).to.deep.equal(['test,e', '[WARN] [test] w']);
  });

  it('prints every level at SYS', () => {
    const logger = new Logger('test');
    logger.level = LogLevel.SYS;

    logAll(logger);

    expect(printed).to.deep.equal([
      'test,e',
      '[WARN] [test] w',
      '[INFO] [test] i',
      '[DEBUG] [test] d',
      '[SYS] [test] s',
    ]);
  });

  it('prints only errors when disabled, or when all logging is', () => {
    const disabled = new Logger('test', LogLevel.SYS);
    disabled.disable = true;
    logAll(disabled);

    Logger.disableLogging = true;
    logAll(new Logger('other', LogLevel.SYS));

    expect(printed).to.deep.equal(['test,e', 'other,e']);
  });
});
