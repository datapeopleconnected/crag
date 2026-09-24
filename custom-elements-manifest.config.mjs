import path from 'node:path';

// `cem analyze` reads the TypeScript source, but the package ships dist/. Point every module path in the
// manifest at the published file: `src/components/buttress-db-service.ts` becomes
// `dist/components/buttress-db-service.js`. The analyzer writes most references from the package root, with
// or without a leading slash, and re-exports such as index.ts's `./context.js` relative to their module.
const toDist = (modulePath, from = '') => {
  const resolved = /^\.\.?\//.test(modulePath)
    ? path.posix.join(path.posix.dirname(from), modulePath)
    : modulePath.replace(/^\//, '');
  return resolved.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js');
};

const publishedPaths = () => ({
  name: 'crag-published-paths',
  packageLinkPhase({ customElementsManifest }) {
    for (const mod of customElementsManifest.modules) {
      for (const exp of mod.exports ?? []) {
        if (exp.declaration?.module) exp.declaration.module = toDist(exp.declaration.module, mod.path);
      }
      for (const dec of mod.declarations ?? []) {
        if (dec.superclass?.module) dec.superclass.module = toDist(dec.superclass.module, mod.path);
      }
      mod.path = toDist(mod.path);
    }
  },
});

// components/buttress-db-service.ts registers the element as `ButtressDbService.is`, which the analyzer can't
// read, so its definition comes out without a tag name. Take it from the class's `@tagname` instead.
const definitionTagNames = () => ({
  name: 'crag-definition-tag-names',
  packageLinkPhase({ customElementsManifest }) {
    const modules = customElementsManifest.modules;
    const tagNames = new Map(
      modules.flatMap((mod) =>
        (mod.declarations ?? []).filter((dec) => dec.tagName).map((dec) => [`${mod.path}#${dec.name}`, dec.tagName]),
      ),
    );
    for (const exp of modules.flatMap((mod) => mod.exports ?? [])) {
      if (exp.kind !== 'custom-element-definition' || exp.name) continue;
      const modulePath = exp.declaration.module.replace(/^\//, '').replace(/\.js$/, '.ts');
      exp.name = tagNames.get(`${modulePath}#${exp.declaration.name}`);
    }
  },
});

// The analyzer lists `export type { … }` like any other export, but those names don't exist at runtime.
const noTypeOnlyExports = () => ({
  name: 'crag-no-type-only-exports',
  analyzePhase({ ts, node, moduleDoc }) {
    if (!ts.isExportDeclaration(node) || !node.isTypeOnly || !node.exportClause) return;
    const names = new Set(node.exportClause.elements.map((el) => el.name.text));
    moduleDoc.exports = moduleDoc.exports?.filter((exp) => !names.has(exp.name));
  },
});

export default {
  // The package's entry points, and the modules they export from. The rest of src/ is internal.
  globs: ['src/index.ts', 'src/ButtressDbService.ts', 'src/context.ts', 'src/Logger.ts', 'src/components/*.ts'],
  outdir: '.',
  // package.json already points at the manifest. Left on, the analyzer rewrites the file on every build.
  packagejson: false,
  litelement: true,
  // publishedPaths must run last: the others look modules up by their source path.
  plugins: [noTypeOnlyExports(), definitionTagNames(), publishedPaths()],
};
