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

import ButtressDataService from '../../ButtressDataService';
import ButtressStore from '../../ButtressStore.js';
import ButtressSchema from '../../ButtressSchema';

describe('processQueryPart', () => {
  const store = new ButtressStore();
  const ds = new ButtressDataService('Unit Testing', false, {
    
  }, store, {} as ButtressSchema)
  const data = [
    {
      "publicLedger": {
        "signatureRequirement": {
            "threshold": 1,
            "signatories": [
                {
                  "person": {
                    "identifiers": [{
                      "id": "6780ebbf068de140a2ba8c26",
                      "name": "John",
                      "age": 30,
                      "hired_at": new Date("2010-01-10T00:00:00.000Z"),
                    }, {
                      "id": "6780ebbf068de140a2ba8c27",
                      "name": "Mary",
                      "age": 20,
                      "hired_at": new Date("2020-07-04T00:00:00.000Z"),
                    }]
                  },
                  "publicKey": "302a300506032b6570032100763f8f38e913c44bbb389ef5f5bc67accc0b66dfce4fb790393a7a089e2b02dc"
                }
            ]
        }
      }
    }, {
      "publicLedger": {
        "signatureRequirement": {
            "threshold": 1,
            "signatories": [
                {
                  "person": {
                    "identifiers": [{
                      "id": "6780ebbf068de140a2ba8c28",
                      "name": "Henry",
                      "age": 50,
                      "hired_at": new Date("2023-10-31T00:00:00.000Z"),
                    }, {
                      "id": "6780ebbf068de140a2ba8c29",
                      "name": "James",
                      "age": 60,
                      "hired_at": new Date("2009-03-14T00:00:00.000Z"),
                    }]
                  },
                  "publicKey": "302a300506032b6570032100763f8f38e913c44bbb389ef5f5bc67accc0b66dfce4fb790393a7a089e2b02dc"
                }
            ]
        }
      }
    }
  ];

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $not', () => {
    const query = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.id": {
        "$not": "6780ebbf068de140a2ba8c26"
      }
    };

    const res = ds._processQueryPart(query, data);
    expect(res).to.be.an('array');

    const values = res.reduce((arr: string[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const ids = identifiers.map((i: any) => i.id);
      arr = arr.concat(ids).filter((v, idx, arr) => arr.indexOf(v) === idx);
      return arr;
    }, []);

    expect(values.every((item) => item !== '6780ebbf068de140a2ba8c26')).to.be.false;
  });

  it('Validate ButtressDataService _processQueryPart works with simple query for $eq', () => {
    const query = {
      "publicLedger.signatureRequirement.threshold": {
        "$eq": 1
      }
    };

    const res = ds._processQueryPart(query, data);
    expect(res).to.be.an('array');

    expect(res.every((item) => item.publicLedger.signatureRequirement.threshold === 1)).to.be.true;
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $eq', () => {
    const query = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.id": {
        "$eq": "6780ebbf068de140a2ba8c26"
      }
    };

    const res = ds._processQueryPart(query, data);
    expect(res).to.be.an('array');

    const values = res.reduce((arr: string[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const ids = identifiers.map((i: any) => i.id);
      arr = arr.concat(ids).filter((v, idx, arr) => arr.indexOf(v) === idx);
      return arr;
    }, []);

    expect(values).include('6780ebbf068de140a2ba8c26');
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $gt', () => {
    const firstQuery = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.age": {
        "$gt": 100,
      }
    };
    const secondQuery = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.age": {
        "$gt": 10,
      }
    };

    const firstRes = ds._processQueryPart(firstQuery, data);
    const secondRes = ds._processQueryPart(secondQuery, data);
    expect(firstRes).to.be.an('array');
    expect(secondRes).to.be.an('array');

    const values = secondRes.reduce((arr: number[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const ages = identifiers.map((i: any) => i.age);
      arr = arr.concat(ages).filter((v, idx, arr) => arr.indexOf(v) === idx);
      return arr;
    }, []);

    expect(firstRes.length).to.equal(0);
    expect(values.every((v) => v > 10)).to.be.true;
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $lt', () => {
    const firstQuery = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.age": {
        "$lt": 40,
      }
    };
    const secondQuery = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.age": {
        "$lt": 10,
      }
    };

    const firstRes = ds._processQueryPart(firstQuery, data);
    const secondRes = ds._processQueryPart(secondQuery, data);
    expect(firstRes).to.be.an('array');
    expect(secondRes).to.be.an('array');

    const values = firstRes.reduce((arr: number[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const ages = identifiers.map((i: any) => i.age);
      arr = arr.concat(ages).filter((v, idx, arr) => arr.indexOf(v) === idx);
      return arr;
    }, []);

    expect(secondRes.length).to.equal(0);
    expect(values.every((v) => v > 10)).to.be.true;
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $gte', () => {
    const firstQuery = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.age": {
        "$gte": 50,
      }
    };

    const res = ds._processQueryPart(firstQuery, data);
    expect(res).to.be.an('array');

    const values = res.reduce((arr: number[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const ages = identifiers.map((i: any) => i.age);
      arr = arr.concat(ages).filter((v, idx, arr) => arr.indexOf(v) === idx);
      return arr;
    }, []);

    expect(res.length).to.equal(1);
    expect(values.every((v) => v >= 50)).to.be.true;
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $lte', () => {
    const firstQuery = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.age": {
        "$lte": 10,
      }
    };

    const res = ds._processQueryPart(firstQuery, data);
    expect(res).to.be.an('array');
    expect(res.length).to.equal(0);
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $rex', () => {
    const firstQuery = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.name": {
        "$rex": "h",
      }
    };

    const res = ds._processQueryPart(firstQuery, data);
    expect(res).to.be.an('array');
    expect(res.length).to.equal(1);

    let values = res.reduce((arr: string[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const names = identifiers.map((i: any) => i.name);
      arr = arr.concat(names).filter((v, idx, arr) => arr.indexOf(v) === idx);
      return arr;
    }, []);

    values = values.filter((v) => v.includes('h'));
    expect(values.length).to.equal(1);
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $rexi', () => {
    const firstQuery = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.name": {
        "$rexi": "M",
      }
    };

    const res = ds._processQueryPart(firstQuery, data);
    expect(res).to.be.an('array');
    expect(res.length).to.equal(2);

    const values = res.reduce((arr: string[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const names = identifiers.map((i: any) => i.name);
      arr = arr.concat(names).filter((v, idx, arr) => arr.indexOf(v) === idx);
      return arr;
    }, []);

    const passed = values.some((v) => v === 'John') && values.some((v) => v === 'Henry');
    expect(passed).to.be.true;
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $in', () => {
    const query = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.id": {
        "$in": ["6780ebbf068de140a2ba8c26"]
      }
    };

    const res = ds._processQueryPart(query, data);
    expect(res).to.be.an('array');

    const values = res.reduce((arr: string[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const ids = identifiers.map((i: any) => i.id);
      arr = arr.concat(ids).filter((v, idx, arr) => arr.indexOf(v) === idx);
      return arr;
    }, []);

    expect(values).include('6780ebbf068de140a2ba8c26');
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $nin', () => {
    const firstQuery = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.id": {
        "$nin": ["6780ebbf068de140a2ba8c26", "6780ebbf068de140a2ba8c28"],
      },
    };
    const secondQuery = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.id": {
        "$nin": ["6780ebbf068de140a2ba8c30", "6780ebbf068de140a2ba8c31"],
      },
    };

    const firstRes = ds._processQueryPart(firstQuery, data);
    const secondRes = ds._processQueryPart(secondQuery, data);
    expect(firstRes).to.be.an('array');
    expect(firstRes.length).to.equal(0);
    expect(secondRes).to.be.an('array');
    expect(secondRes.length).to.equal(2);

    const values = secondRes.reduce((arr: string[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const ids = identifiers.map((i: any) => i.id);
      arr = arr.concat(ids).filter((v, idx, arr) => arr.indexOf(v) === idx);
      return arr;
    }, []);

    expect(values.every((v => v !== '6780ebbf068de140a2ba8c30' && v !== '6780ebbf068de140a2ba8c31'))).to.be.true
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $exists', () => {
    const query = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.name": {
        "$exists": "John"
      }
    };

    const res = ds._processQueryPart(query, data);
    expect(res).to.be.an('array');
    expect(res.length).to.equal(1);

    const values = res.reduce((arr: string[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const names = identifiers.map((i: any) => i.name);
      arr = arr.concat(names).filter((v, idx, arr) => arr.indexOf(v) === idx);
      return arr;
    }, []);

    expect(values.some((v) => v === 'John')).to.be.true;
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $exists', () => {
    const query = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.name": {
        "$exists": "John"
      }
    };

    const res = ds._processQueryPart(query, data);
    expect(res).to.be.an('array');
    expect(res.length).to.equal(1);

    const values = res.reduce((arr: string[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const names = identifiers.map((i: any) => i.name);
      arr = arr.concat(names).filter((v, idx, arr) => arr.indexOf(v) === idx);
      return arr;
    }, []);

    expect(values.some((v) => v === 'John')).to.be.true;
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $elMatch', () => {
    const query = {
      "publicLedger.signatureRequirement.signatories.person.identifiers": {
        "$elMatch": {
          "name": {
            "$eq": "John",
          },
          "age": {
            "$lt": 40,
          },
        },
      }
    };

    const res = ds._processQueryPart(query, data);
    expect(res).to.be.an('array');
    expect(res.length).to.equal(1);

    const values = res.reduce((arr: any[], i) => {
      const signatories = i.publicLedger.signatureRequirement.signatories.map((s: any) => s.person);
      const identifiers = signatories.map((s: any) => s.identifiers).flat();
      const obj = identifiers.map((i: any) => {
        return {name:i.name, age: i.age};
      });
      arr = arr.concat(obj);
      return arr;
    }, []);

    expect(values.some((v) => v.name === 'John' && v.age < 40)).to.be.true;
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $gtDate', () => {
    const query = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.hired_at": {
        "$gtDate": "2022-01-01T00:00:00.000Z",
      }
    };

    const res = ds._processQueryPart(query, data);
    expect(res).to.be.an('array');
    expect(res.length).to.equal(1);
  });

  it('Validate ButtressDataService _processQueryPart works with nested arrays in $ltDate', () => {
    const query = {
      "publicLedger.signatureRequirement.signatories.person.identifiers.hired_at": {
        "$ltDate": "2010-01-20T00:00:00.000Z",
      }
    };

    const res = ds._processQueryPart(query, data);
    expect(res).to.be.an('array');
    expect(res.length).to.equal(2);
  });
});