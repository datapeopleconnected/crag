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

import { coreSchemaLocalName } from '../../src/helpers.js';

describe('coreSchemaLocalName', () => {
  it('drops the s from plural names', () => {
    expect(['users', 'apps', 'tokens', 'trackings'].map(coreSchemaLocalName)).to.deep.equal([
      'user',
      'app',
      'token',
      'tracking',
    ]);
  });

  it('turns ies into y', () => {
    expect(coreSchemaLocalName('activities')).to.equal('activity');
  });

  it('leaves singular names alone', () => {
    expect(['lambda', 'policy', 'deployment', 'secureStore'].map(coreSchemaLocalName)).to.deep.equal([
      'lambda',
      'policy',
      'deployment',
      'secureStore',
    ]);
  });
});
