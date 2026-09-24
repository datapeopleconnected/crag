# \<buttress-db-service>

This webcomponent follows the [open-wc](https://github.com/open-wc/open-wc) recommendation.

## Installation

```bash
npm i @buttress/crag
```

## Usage

Register the element and wrap the part of your app that uses the database in it:

```html
<script type="module">
  import '@buttress/crag/components/buttress-db-service.js';
</script>

<buttress-db-service endpoint="https://buttress.example.com" token="..." api-path="my-app">
  <my-app></my-app>
</buttress-db-service>
```

`<buttress-db-service>` provides itself to its descendants through [`@lit/context`](https://lit.dev/docs/data/context/).
Consume it from any Lit element inside it:

```ts
import { LitElement } from 'lit';
import { consume } from '@lit/context';
import { ButtressDbService, buttressDbServiceContext } from '@buttress/crag';

class OrganisationList extends LitElement {
  @consume({ context: buttressDbServiceContext })
  db?: ButtressDbService;

  async firstUpdated() {
    await this.db?.awaitConnection();
    const organisations = await this.db?.query('organisation', {});
  }
}
```

`db` is set while the consumer connects, as long as `buttress-db-service` is already defined. If consumers can
connect before it is, attach a `ContextRoot` from `@lit/context` to `document.body` so their requests are replayed
once it upgrades. With TypeScript's `experimentalDecorators`, keep `useDefineForClassFields` set to `false`.

## Migrating from 0.0.x

`@lighten/ltn-element` is no longer a dependency: `ButtressDbService` extends `LitElement` and is found through context
instead of the ltn service locator. crag now depends on Lit 3, so apps still on Lit 2 will load two copies of Lit until
they upgrade.

- Replace `this._getService(ButtressDbService)` with a `@consume({ context: buttressDbServiceContext })` property, as
  above.
- Consumers must be descendants of `<buttress-db-service>`. Remove any `LtnTrader.registerService()` call for it: the
  trader would now throw, as the element no longer has `_queryService()`.
- `eventSubscribe()`, `eventUnsubscribe()` and `dispatchCustomEvent()` are gone. Listen for DOM events instead, e.g.
  `db.addEventListener('bjs-connection-changed', (e) => ...)`, where `e.detail` is the connection state.
- Also removed: the `scope` attribute, the `_debug()`/`_info()`/`_warn()`/`_error()`/`_sys()` helpers and the static
  `generateId()`.
- The `loglevel`, `log-label` and `log-disable` attributes work as before, but logging now goes through crag's own
  logger: `LtnLogger.disableLogging` no longer silences it, and `Settings.logLevel` uses the exported `LogLevel` enum.

## Linting and formatting

To scan the project for linting and formatting errors, run

```bash
npm run lint
```

To automatically fix linting and formatting errors, run

```bash
npm run format
```

## Testing with Web Test Runner

To execute a single test run:

```bash
npm run test
```

To run the tests in interactive watch mode run:

```bash
npm run test:watch
```

## Tooling configs

For most of the tools, the configuration is in the `package.json` to reduce the amount of files in your project.

If you customize the configuration a lot, you can consider moving them to individual files.

## Local Demo with `web-dev-server`

```bash
npm start
```

To run a local development server that serves the basic demo located in `demo/index.html`
