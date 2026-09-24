# Buttress Crag

`@buttress/crag` connects a browser app to a Buttress server. It provides one headless web component,
`<buttress-db-service>`, built with [Lit](https://lit.dev). The component:

- loads your app's schemas and keeps a local store of the entities you work with;
- sends your changes to Buttress, batching them where it can;
- applies changes made by other clients, which arrive over a realtime socket;
- provides itself to the components inside it through [`@lit/context`](https://lit.dev/docs/data/context/).

Upgrading from 0.0.x? Follow the [migration guide](docs/migrating-to-0.1.md).

## Installation

```bash
npm install @buttress/crag
```

crag depends on Lit 3 and `@lit/context`. If your app also uses Lit, use Lit 3 so the page loads a single copy of it.

Installing crag needs Node 24 or newer. It says so in `engines`, so npm and pnpm warn on older versions and Yarn 1
refuses to install it.

## Quick start

**1. Wrap the part of your app that uses the database in the element, and connect.**

```html
<buttress-db-service endpoint="https://buttress.example.com" token="APP_TOKEN" api-path="my-app">
  <organisation-list></organisation-list>
</buttress-db-service>

<script type="module">
  import '@buttress/crag/components/buttress-db-service.js';

  await document.querySelector('buttress-db-service').connect();
</script>
```

The element shows its children through a slot and takes up no space in the layout (`display: contents`).

**2. Use it from the components inside.**

```ts
import { LitElement, html } from 'lit';
import { state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { buttressDbServiceContext, type ButtressDbService, type ButtressEntity } from '@buttress/crag';

class OrganisationList extends LitElement {
  @consume({ context: buttressDbServiceContext })
  db?: ButtressDbService;

  @state()
  private organisations: ButtressEntity[] = [];

  async firstUpdated() {
    if (!this.db) return;
    await this.db.awaitConnection();
    const { results } = await this.db.query('organisation', { status: { $eq: 'active' } });
    this.organisations = results;
  }

  render() {
    return html`<ul>${this.organisations.map((organisation) => html`<li>${organisation.name}</li>`)}</ul>`;
  }
}
customElements.define('organisation-list', OrganisationList);
```

## How it works

- `connect()` fetches your app's schemas and creates a data service for each one, then opens the realtime socket.
  `awaitConnection()` resolves once the schemas have loaded.
- Entities you query, fetch or create are kept in a local store, addressed by path: `organisation` (a `Map` of every
  loaded organisation), `organisation.<id>`, `organisation.<id>.name`.
- Writes change the store straight away, then queue a request to Buttress. Each schema sends its requests one at a
  time, and additions and updates are combined into bulk requests of up to 100.
- Changes made by other clients arrive over the realtime socket and are applied to the store. Each
  `<buttress-db-service>` has its own session id, so crag ignores realtime messages about its own changes.
- `subscribe()` calls you back when paths in the store change.

## Getting the service in a component

`<buttress-db-service>` answers context requests from any element inside it, including elements in shadow roots. If
there's more than one `<buttress-db-service>` above a component, the nearest one answers.

- **Timing.** A component receives the service when it connects, provided `buttress-db-service` is already defined, so
  import `@buttress/crag/components/buttress-db-service.js` before your own components. If you can't guarantee that,
  attach a `ContextRoot` and consume with `subscribe: true`. The root holds on to early requests and answers them once
  the element is defined, but only requests that subscribe:

  ```ts
  import { ContextRoot } from '@lit/context';

  new ContextRoot().attach(document.body);
  ```

- **Moving components.** A component that can move from one `<buttress-db-service>` to another should use
  `@consume({ context: buttressDbServiceContext, subscribe: true })`. Otherwise it keeps the first service it received.
- **Keeping the element beside your content.** Provide it from a common ancestor instead; the
  [migration guide](docs/migrating-to-0.1.md#option-b-provide-it-from-your-root-element) shows how.
- **Without Lit.** Look the element up with `document.querySelector('buttress-db-service')`, or dispatch a
  `ContextEvent` as the [migration guide](docs/migrating-to-0.1.md#3-replace-_getservice-with-consume) shows.
- **TypeScript.** If you use `experimentalDecorators`, set `useDefineForClassFields: false`, as Lit requires for
  decorated fields.

## Attributes

| Attribute     | Property     | Description                                                                                                                                                 |
| ------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`    | `endpoint`   | Base URL of the Buttress server. Required by `connect()`.                                                                                                   |
| `token`       | `token`      | Token sent with every request and used to open the realtime socket. Required.                                                                               |
| `api-path`    | `apiPath`    | Your app's API path on the server. Required.                                                                                                                |
| `userid`      | `userId`     | Id of the signed-in user. When Buttress sends an access-control update for this user, crag refreshes the affected schemas: it either notifies their subscribers or clears their cached queries. |
| `core-schema` | `coreSchema` | JSON array of Buttress core schemas to load as well as your app's own. Locally, core schema names lose a trailing `s`: `users` becomes `user`.              |
| `loglevel`    | `logLevel`   | `error`, `warn`, `info` (the default), `debug` or `sys`. Applies to the element, the store, the data services and the realtime connection.                  |
| `log-label`   |              | Label for the element's own log lines. Defaults to the tag name.                                                                                           |
| `log-disable` |              | Turns off the element's own log lines. Errors are still printed.                                                                                           |

The connection settings are copied when the element connects and whenever they change. A change made after `connect()`
applies to later requests but doesn't reconnect the realtime socket. The logging attributes are read when the element
connects.

## API

The data methods need the schemas, so call them after `awaitConnection()`. `subscribe()` and `unsubscribe()` work at
any time.

### Connection

| Method                                | Description                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `connect(): Promise<void>`            | Loads the schemas, creates the data services, then opens the realtime socket. Rejects if `endpoint`, `token` or `api-path` is missing. |
| `awaitConnection(): Promise<boolean>` | Resolves once `connect()` has loaded the schemas. Can be called before `connect()`.                                        |
| `isDbConnected(): boolean`            | Whether the schemas have loaded.                                                                                           |

### Reading

| Method                               | Description                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `get(path)`                          | Reads from the local store. Returns `undefined` for anything that isn't loaded.                        |
| `query(schema, query, opts?)`        | Loads matching entities into the store and resolves to `{ total, results, skip, limit }`. See [Queries](#queries). |
| `getById(schema, id)`                | Resolves to the entity, from the store if it's loaded and from Buttress if not.                        |
| `count(schema, query, actualCount?)` | Resolves to the number of matching entities, as counted by Buttress.                                    |
| `getSchema(name)`                    | The schema definition, or `false` if there's no such schema.                                            |

### Writing

| Method                                        | Description                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createObject(path)`                          | A new entity filled in with the schema's defaults and a new `id`. Pass a nested path such as `organisation.address` for a sub-object, without an `id`. Nothing is stored. |
| `create(schema, entity, opts?)`               | Adds the entity to the store and to Buttress, generating an `id` if it has none. Returns its path, e.g. `organisation.6709476b082b32233234259c`. |
| `set(path, value, opts?)`                     | Sets a value in the store and on Buttress. Returns the path.                                                                                        |
| `push(path, ...items)`                        | Appends to an array property, creating the array if the schema says the property is one. Returns the new length.                                   |
| `splice(path, start, deleteCount?, ...items)` | Splices an array property. Returns the removed items.                                                                                               |
| `delete(path, opts?)`                         | Deletes an entity: `delete('organisation.<id>')`. Returns whether it was in the store.                                                             |
| `nextIdle(schema)`                            | Resolves once that schema has no queued requests. It doesn't wait for a request that's already been sent; use `dboComplete` for that. |

Before you write:

- `set`, `push` and `splice` only work inside entities that are already in the store: queried, fetched or created.
- Each `push` or `splice` call sends at most one change to Buttress: the first added item, or else a single removed
  item. So push one item per call, remove one item per call, and don't add and remove in the same `splice`. Anything
  else in the call changes the local store but isn't sent.
- `create` and `delete` work on whole entities: `create` takes a schema name and `delete` takes `<schema>.<id>`.

`create`, `set` and `delete` take these options:

| Option                             | Effect                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `localOnly`                        | Changes the store without sending anything to Buttress.                                                   |
| `silent`                           | Doesn't notify subscribers. Sending to Buttress relies on the same notifications, so nothing is sent either. |
| `forceChanged`                     | Notifies subscribers even if the value hasn't changed. Implies `localOnly`.                               |
| `dboComplete: { resolve, reject }` | Called when the request to Buttress finishes, or straight away if nothing changed.                        |

To wait until a change has reached Buttress:

```ts
await new Promise((resolve, reject) => {
  db.set(`${path}.name`, 'New name', { dboComplete: { resolve, reject } });
});
```

### Subscribing

| Method                        | Description                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `subscribe(paths, callback)`  | Calls `callback` when any of the comma-separated `paths` change. Returns an id.      |
| `unsubscribe(id)`             | Removes the subscription. Returns whether it existed.                                |

A path can be:

- `organisation.*`: anything in the `organisation` schema;
- `organisation.<id>.name`: that property, including when the whole entity is replaced;
- `organisation`: the collection itself, when it's replaced.

The callback receives one change record for each path you subscribed to, in the same order. For a path ending in `.*`
the record is `{ path, value, base, opts }`, where `path` is what changed and `base` is the schema's `Map`. For other
paths it's `{ value, opts }`. An array change arrives as `<path>.splices`, with the changes in `value.indexSplices`.
Deleting an entity arrives as `<schema>.<id>.splices`, with the entity in `value.indexSplices[0].removed`.

```ts
const id = db.subscribe('organisation.*', ({ path, value }) => {
  console.log(`${path} is now`, value);
});

db.unsubscribe(id);
```

Callbacks run in a microtask, after the store has changed. Entities loaded by `query()` and `getById()` are added to
the store without notifying subscribers, so use the values those methods return.

### Settings

`getEndpoint()`, `setEndpoint()`, `getToken()`, `setToken()`, `setApiPath()`, `getUserId()`, `setUserId()`,
`getCoreSchemas()` and `setCoreSchemas()` read and change the connection settings. As with the attributes, a change
applies to later requests and doesn't reconnect.

### App administration

These call Buttress's app-management endpoints for the app identified by `apiPath`, so the token needs permission to
use them. Each one rejects with Buttress's error message if the request fails.

| Method                                                     | Resolves to              |
| ---------------------------------------------------------- | ------------------------ |
| `addSchema(apiPath, schema)`                               | `true`                   |
| `updateAppPolicySelectors(apiPath, policySelectors)`       | `true`                   |
| `addLambda(lambda, auth, apiPath)`                         | `true`                   |
| `deployLambda(lambda, apiPath)`                            | `true`. Deploys `lambda.git.branch` at `lambda.git.hash`. |
| `addDataSharing(appDataSharing, apiPath)`                  | The remote app's token   |
| `activateDataSharing(dataSharingId, apiPath, remoteToken)` | `true`                   |

## Queries

A query maps paths to operators. Paths use dots and reach into nested objects and arrays. Combine conditions with
`$and` and `$or`:

```ts
const active = await db.query('organisation', { status: { $eq: 'active' } }, { sort: { path: 'name', direction: 'ASC' } });

const activeOrLarge = await db.query(
  'organisation',
  { $or: [{ status: { $eq: 'active' } }, { number: { $gte: 50 } }] },
  { limit: 20 },
);
```

`$or` returns its matches grouped by the condition they met, so it doesn't keep the `sort` order. If you need both, sort
the results yourself.

`query()` sends the query to Buttress and merges what comes back into the store, asks Buttress for the total, then runs
the same query against the store. As a result:

- `results` can include matching entities that are only in the store, such as ones you've just created;
- `total` is Buttress's count, so it can differ from `results.length`;
- running the same query again, with the same `limit`, `skip`, `sort` and `project`, doesn't fetch the entities again
  unless you pass `bust: true`. The total is always requested.

| Option        | Description                                                                        |
| ------------- | ---------------------------------------------------------------------------------- |
| `limit`       | Maximum number of results, applied by Buttress and to the local results.           |
| `skip`        | Number of results to skip, applied the same way.                                   |
| `sort`        | `{ path, direction: 'ASC' \| 'DESC', type? }`, where `type` is `STRING` (the default), `NUMBER` or `DATE`. |
| `project`     | Projection, applied by Buttress.                                                   |
| `bust`        | Fetches even if this exact query has already run.                                 |
| `actualCount` | Passed to Buttress with the count request.                                        |

Buttress evaluates the query when fetching; crag evaluates it again locally to choose `results`. Locally, a path that
passes through arrays can give several values, and an entity matches if any of them passes:

| Operator                                     | Matches when a value at the path…                                           |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `$eq`                                        | equals the operand                                                          |
| `$not`                                       | differs from the operand                                                    |
| `$gt`, `$gte`, `$lt`, `$lte`                 | is greater than, at least, less than, or at most the operand                |
| `$in`                                        | is in the operand array                                                     |
| `$nin`                                       | is not in the operand array. Every value must pass this one.               |
| `$rex`, `$rexi`                              | matches the regular expression. `$rexi` ignores case.                      |
| `$gtDate`, `$gteDate`, `$ltDate`, `$lteDate` | is after, on or after, before, or on or before the operand date. `null` never matches. |
| `$exists`                                    | equals the operand. Locally this is the same test as `$eq`.                |
| `$elMatch`                                   | is an array with an element that matches the sub-query                     |
| `$inProp`                                    | contains the operand. Top-level properties only.                           |

An unknown operator logs an error and matches nothing.

## Events

Both events bubble and cross shadow roots.

| Event                    | `detail`             | Fired                                                                                                                                  |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `bjs-connection-changed` | `boolean`            | With `true` when `connect()` opens the realtime socket, then whenever the socket connects (`true`) or disconnects (`false`).        |
| `dataservice:loadById`   | `{ schemaName, id }` | When a realtime update arrives for an entity that isn't in the store. crag fetches the entity itself; the event is for information. |

```ts
db.addEventListener('bjs-connection-changed', (e) => {
  const connected = (e as CustomEvent<boolean>).detail;
});
```

## TypeScript

`@buttress/crag` exports:

| Export                     | What it is                                                                        |
| -------------------------- | --------------------------------------------------------------------------------- |
| `ButtressDbService`        | The element's class.                                                              |
| `buttressDbServiceContext` | The context to consume the service with.                                          |
| `LogLevel`                 | The log level enum: `ERROR`, `WARN`, `INFO`, `DEBUG`, `SYS`.                      |
| `ButtressEntity`           | An entity: `{ id: string; [key: string]: any }`.                                  |
| `QueryResult`              | What `query()` resolves to.                                                       |
| `CR`, `CRCallback`         | A change record, and the type of a subscriber callback.                           |
| `Settings`                 | The connection settings.                                                          |

Importing `@buttress/crag` doesn't register the element; import `@buttress/crag/components/buttress-db-service.js` for
that.

## Development

You'll need Node 24 or newer. If you use nvm, `nvm use` switches to the version in `.nvmrc`.

```bash
npm install
npm run build
npm run test:unit
```

| Path                    | Contents                                                        |
| ----------------------- | --------------------------------------------------------------- |
| `src/`                  | Source. `src/components/` registers the element.                |
| `test/unit/`            | Unit tests, run from source in Chrome.                          |
| `test/e2e/`             | End-to-end tests, run in Chrome against Buttress in Docker.     |
| `scripts/`              | Starts and seeds Buttress for the end-to-end tests.             |
| `.docker/`              | The Buttress stack the end-to-end tests run against.            |
| `demo/`                 | The page `npm start` serves.                                    |
| `docs/`                 | Guides, such as the [0.1 migration guide](docs/migrating-to-0.1.md). |
| `dist/`                 | Build output. It's published along with `src/` and the licence. |

| Script                        | What it does                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `npm start`                   | Builds, watches, and serves `demo/`.                                           |
| `npm run build`               | Compiles `src/` to `dist/`.                                                    |
| `npm run test:unit`           | Runs the unit tests in Chrome. No build or server needed.                      |
| `npm run test:watch`          | Runs the unit tests again whenever a file changes.                             |
| `npm test`                    | Builds, bundles and runs the end-to-end tests. Needs Docker.                   |
| `npm run lint`                | Runs ESLint, then Stylelint on the CSS in `src/`. `lint:fix` fixes what it can. |
| `npm run format`              | Checks formatting with Prettier. `format:fix` applies it.                      |
| `npm run typecheck`           | Type-checks `src/` and `test/`.                                                |
| `npm run check`               | Runs `lint`, `format`, `typecheck` and `test:unit`.                            |
| `npm run publint`             | Checks the packed package with publint and Are the Types Wrong.                |

### End-to-end tests

The end-to-end tests need [Docker](https://docs.docker.com/get-docker/) with Compose v2, and nothing else:

```bash
npm test
```

After building, `scripts/e2e.js` starts Buttress, MongoDB and Redis in containers, and seeds Buttress with a test app,
policies, users and organisations (`scripts/e2e-seed.js`). It then runs the tests in Chrome and removes the containers.
Every run starts from an empty database. If a run fails, the end of the Buttress log is printed first.

The first run downloads the images. Later runs check for a newer `dpcltd/buttress:develop` and fall back to the copy
you have when Docker Hub can't be reached. To test against a different image, such as one built from a Buttress
checkout, set `BUTTRESS_IMAGE`:

```bash
docker build -t buttress:local path/to/buttress-js
BUTTRESS_IMAGE=buttress:local npm test
```

`scripts/e2e.js` runs whatever command it's given, with the endpoint and tokens in `BUTTRESS_E2E_*` environment
variables. To look around a seeded Buttress, open a shell with `node scripts/e2e.js bash`. The containers are removed
when you exit it.

### Commits and publishing

The pre-commit hook runs `npm run build` and `npm run licence-check`. Every file in `src/`, `test/` and `scripts/`,
apart from HTML and JSON, must start with the header in `.husky/licencing_header.txt`.

`npm pack` and `npm publish` build the package first. Run `npm run publint` beforehand to check its exports and types.

## Licence

Buttress Crag is free software, released under the [GNU Affero General Public Licence v3.0 or later](LICENSE).
Copyright © 2016–2024 Data People Connected LTD.
