# Migrating from 0.0.x to 0.1

crag 0.1 no longer depends on `@lighten/ltn-element`. `<buttress-db-service>` is now a plain Lit element that provides
itself to the components inside it through [`@lit/context`](https://lit.dev/docs/data/context/). Before, components
looked it up through ltn-element's service registry. crag also moves from Lit 2 to Lit 3.

Once a component has the service, nothing changes: connecting, querying, reading, writing, subscriptions, attributes
and events all work as before. Most apps need to change three things: where the element sits in the page, how
components get hold of it, and which version of Lit they use.

## At a glance

|                             | 0.0.x                                    | 0.1                                                |
| --------------------------- | ---------------------------------------- | -------------------------------------------------- |
| Base class                  | `LtnService` from ltn-element, on Lit 2  | `LitElement`, on Lit 3                             |
| Getting the service         | `this._getService(ButtressDbService)`    | `@consume({ context: buttressDbServiceContext })`  |
| Where the element sits      | Anywhere, registered with an `LtnTrader` | Around the components that use it                  |
| Children of the element     | Not shown                                | Shown through a slot                               |
| Listening for events        | `eventSubscribe(name, (detail) => …)`    | `addEventListener(name, (e) => … e.detail …)`      |
| Logging                     | `LtnLogger`                              | crag's own logger, with the same attributes        |
| Skipping your own updates   | Matched by `userId`                      | Matched by a session id for each element           |

## 1. Update your dependencies

```bash
npm install @buttress/crag@^0.1.0 @lit/context lit@^3
```

- Your app needs `@lit/context` for `@consume`.
- Remove `@lighten/ltn-element` if nothing else in your app uses it (`npm uninstall @lighten/ltn-element`). If you
  keep it, the page will load both Lit 2 and Lit 3, because ltn-element requires Lit 2.
- Check that there's one copy of Lit with `npm ls lit`. More than one copy causes a "Multiple versions of Lit loaded"
  warning in development.

## 2. Put your components inside `<buttress-db-service>`

Context is passed down the DOM, so every component that uses the service must be inside the element: in its children,
or anywhere below them, including inside shadow roots.

### Option A: wrap your content

This is the simplest change. Before:

```html
<buttress-db-service endpoint="…" token="…" api-path="…"></buttress-db-service>
<app-shell></app-shell>
```

After:

```html
<buttress-db-service endpoint="…" token="…" api-path="…">
  <app-shell></app-shell>
</buttress-db-service>
```

The element uses `display: contents`, so it doesn't change your layout.

### Option B: provide it from your root element

If the element has to stay beside your content, have a common ancestor provide it. Create the element in that ancestor,
so the provider already has it when the first component asks:

```ts
import { LitElement, html } from 'lit';
import { ContextProvider } from '@lit/context';
import { buttressDbServiceContext, type ButtressDbService } from '@buttress/crag';
import '@buttress/crag/components/buttress-db-service.js';

class AppRoot extends LitElement {
  private db = Object.assign(document.createElement('buttress-db-service') as ButtressDbService, {
    endpoint: 'https://buttress.example.com',
    token: 'APP_TOKEN',
    apiPath: 'my-app',
  });

  private dbProvider = new ContextProvider(this, { context: buttressDbServiceContext, initialValue: this.db });

  async firstUpdated() {
    await this.db.connect();
  }

  render() {
    return html`${this.db}<app-shell></app-shell>`;
  }
}
customElements.define('app-root', AppRoot);
```

Don't render `<buttress-db-service>` in the template and hand it to the provider in `firstUpdated()` instead. Anything
in the root's own template connects during its first render, before `firstUpdated()` runs, so those components would
be given `undefined`.

The element ends up in the root's shadow root, so `document.querySelector('buttress-db-service')` can't find it. Code
outside the root needs another way to reach it.

## 3. Replace `_getService` with `@consume`

Before:

```ts
import { LtnElement } from '@lighten/ltn-element';
import { ButtressDbService } from '@buttress/crag';

class OrganisationList extends LtnElement {
  private db?: ButtressDbService;

  connectedCallback() {
    super.connectedCallback();
    this.db = this._getService(ButtressDbService);
  }
}
```

After:

```ts
import { LitElement } from 'lit';
import { consume } from '@lit/context';
import { buttressDbServiceContext, type ButtressDbService } from '@buttress/crag';

class OrganisationList extends LitElement {
  @consume({ context: buttressDbServiceContext })
  private db?: ButtressDbService;
}
```

- `db` is set while the component connects, inside `super.connectedCallback()`. Use it from then on, for example in
  `firstUpdated()`, but not in the constructor.
- It's the same element that `_getService` returned, so the code that uses `this.db` doesn't change.
- If your components only extended `LtnElement` to call `_getService`, they can extend `LitElement` instead.
- If a component can move from one `<buttress-db-service>` to another, add `subscribe: true`. Otherwise it keeps the
  first service it received.

A custom element that doesn't use Lit can ask for the service by dispatching a `ContextEvent` when it connects:

```ts
import { ContextEvent } from '@lit/context';
import { buttressDbServiceContext, type ButtressDbService } from '@buttress/crag';

class PlainElement extends HTMLElement {
  db?: ButtressDbService;

  connectedCallback() {
    this.dispatchEvent(
      new ContextEvent(buttressDbServiceContext, this, (db) => {
        this.db = db;
      }),
    );
  }
}
```

## 4. Define the element before your components connect

A component asks for the service when it connects. If `<buttress-db-service>` hasn't been defined by then, nothing
answers and the component's `db` stays `undefined`. Import `@buttress/crag/components/buttress-db-service.js` before
the modules that define your components.

If you can't guarantee that order, attach a `ContextRoot` early on and consume with
`@consume({ context: buttressDbServiceContext, subscribe: true })`:

```ts
import { ContextRoot } from '@lit/context';

new ContextRoot().attach(document.body);
```

The `ContextRoot` holds on to unanswered requests and repeats them once the element is defined. It only keeps requests
that subscribe, so it can't help a plain `@consume({ context: buttressDbServiceContext })`.

## 5. Remove trader registrations

0.1 doesn't have the ltn-element lookup methods. If an `LtnTrader` still has the element registered, the next lookup
through that trader throws a `TypeError` mentioning `_queryService`. Remove any `registerService()` call for
`<buttress-db-service>`.

## 6. Replace `eventSubscribe` with DOM listeners

`eventSubscribe()`, `eventUnsubscribe()` and `dispatchCustomEvent()` have been removed. crag's events are ordinary DOM
events, so listen on the element, or on any ancestor, since they bubble and cross shadow roots.

Before:

```ts
const id = db.eventSubscribe('bjs-connection-changed', (connected) => {
  // …
});
db.eventUnsubscribe(id);
```

After:

```ts
const onConnectionChanged = (e: Event) => {
  const connected = (e as CustomEvent<boolean>).detail;
  // …
};
db.addEventListener('bjs-connection-changed', onConnectionChanged);
db.removeEventListener('bjs-connection-changed', onConnectionChanged);
```

A listener receives the event, where an `eventSubscribe` callback received its `detail`.

## 7. Check your logging

- The `loglevel`, `log-label` and `log-disable` attributes work as before.
- crag has its own logger now, so `LtnLogger.disableLogging` doesn't affect it.
- `Settings.logLevel` uses crag's `LogLevel` enum, exported from `@buttress/crag`, instead of `LtnLogLevel`. The two
  have the same members, but TypeScript treats them as different types.
- The `_debug()`, `_info()`, `_warn()`, `_error()` and `_sys()` helpers are gone, so a subclass of `ButtressDbService`
  needs its own logging.

## 8. Check your TypeScript settings

If you use TypeScript's `experimentalDecorators`, set `useDefineForClassFields: false` in your `tsconfig.json`. Lit
requires it for decorated fields. It's already the default for targets older than ES2022.

## 9. Check that your Buttress server sends `clientSessionId`

Buttress sends a realtime update back to the client whose change caused it. crag skips those updates because it
already applied the change locally. It used to recognise them by `userId`. Now each `<buttress-db-service>` creates its
own session id when it's constructed, sends it with its data requests in an `x-client-session-id` header, and skips
realtime updates whose `data.clientSessionId` matches.

- Your Buttress server must read the header and include `clientSessionId` in the realtime payloads it sends. If it
  doesn't, crag applies its own changes a second time when they come back.
- Two tabs, or two elements, signed in as the same user now see each other's changes in real time. Before, they
  skipped them because the `userId` matched.
- crag no longer uses `userId` itself. It used to refresh schemas when Buttress sent an access-control update for that
  user, but Buttress no longer sends those updates. You can still set it and read it back with `getUserId()`.
- If you build a `Settings` object in TypeScript, it now needs a `clientSessionId` string, such as one from
  `crypto.randomUUID()`.

## Removed APIs

| 0.0.x                                                     | Replacement                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `_getService(ButtressDbService)`                          | `@consume({ context: buttressDbServiceContext })`              |
| `_queryService()`, `_traderStack`, `LtnElementVersion`    | None: the service registry has gone.                            |
| `eventSubscribe(name, callback)`                          | `addEventListener(name, (e) => callback(e.detail))`            |
| `eventUnsubscribe(id)`                                    | `removeEventListener(name, listener)`                           |
| `dispatchCustomEvent(name, init)`                         | `dispatchEvent(new CustomEvent(name, init))`                    |
| `ButtressDbService.generateId()`                          | `crypto.randomUUID()` (secure contexts only), or `v4()` from the `uuid` package |
| `_debug()`, `_info()`, `_warn()`, `_error()`, `_sys()`    | None                                                            |
| The `scope` attribute                                     | None: only the service registry used it.                        |

## Other changes in behaviour

- **Children are shown.** Anything you put inside `<buttress-db-service>` used to be hidden. It's now shown through a
  slot.
- **Missing entities are fetched once.** When a realtime update arrives for an entity that isn't in the store, crag
  fetches it. Previously a handler for this was added every time the element connected and never removed, so after the
  element had been attached N times, each of these updates caused N fetches.
- **crag resyncs after a reconnection.** Buttress can't replay the realtime updates sent while the socket had no
  connection, so when it connects again crag clears its cached queries and dispatches `bjs-resync`. Listen for it to
  reload what you're showing. Entities already in the store keep their values until a query fetches them again.
- **`nextIdle()` waits for requests that have been sent.** It used to resolve once nothing was queued, even while a
  request was still waiting for a response, so with a single write it resolved straight away. It now resolves once
  Buttress has responded to every request, including any queued while it waits.
- **Paged queries return the page Buttress sent.** A query with `limit` or `skip` used to be run again over
  everything in the store and then cut to size, so the page depended on what else was loaded: opening straight on
  page 2 returned nothing. It now returns the entities Buttress sent for that page, less any since deleted or changed
  so they no longer match. After a create in that schema, whether yours or another client's, pages are searched for
again.
- **Every create in a bulk add settles.** When several creates were combined into one bulk request, only the first
  one's `dboComplete` was resolved or rejected. The others never settled.
- **Invalid `loglevel` values are ignored.** Previously, a value from `0` to `4` was turned into a level name and that
  name used as the level, which quietly turned off everything except errors.

## Troubleshooting

**A component's `db` is `undefined`.** Check that:

- the component is inside `<buttress-db-service>`, or under a root that provides it (step 2);
- the element was defined before the component connected, or the component subscribes and a `ContextRoot` is attached
  (step 4);
- you're not reading `db` in the constructor. It's set when the component connects.

**The console warns "Multiple versions of Lit loaded".** Your app resolves a different copy of Lit from crag's. Upgrade
to Lit 3 and check `npm ls lit`. `npm dedupe` can merge compatible copies.

**A `TypeError` mentions `_queryService`.** An `LtnTrader` still has the element registered (step 5).

**There are two `<buttress-db-service>` elements.** Each component gets the nearest one above it. A component that
moves between them keeps the first unless it consumes with `subscribe: true`.

## Checklist

- [ ] crag 0.1, Lit 3 and `@lit/context` are installed, and `npm ls lit` shows one version.
- [ ] Every component that uses the service is inside `<buttress-db-service>`, or under a root that provides it.
- [ ] `_getService(ButtressDbService)` is replaced with `@consume`.
- [ ] `<buttress-db-service>` is defined before your components connect, or they subscribe and a `ContextRoot` is
      attached.
- [ ] Nothing calls `LtnTrader.registerService()` for the element.
- [ ] `eventSubscribe()` is replaced with `addEventListener()`.
- [ ] `useDefineForClassFields` is `false` if you use `experimentalDecorators`.
- [ ] Your Buttress server includes `clientSessionId` in its realtime payloads.
