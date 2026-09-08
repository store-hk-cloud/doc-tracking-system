import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';

const require = createRequire(import.meta.url);

export function loadModule(path, mocks = {}, globals = {}, cache = new Map()) {
  const file = resolve(path);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const source = readFileSync(file, 'utf8');
  const js = transpileModule(source, { compilerOptions: {
    module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, target: 99, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(js, {
    exports, console, process, URL, Request, Response, setTimeout, clearTimeout, ...globals,
    require(name) {
      if (name in mocks) return mocks[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? resolve('src', name.slice(2)) : resolve(dirname(file), name);
        const match = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`].find(existsSync);
        return loadModule(match, mocks, globals, cache);
      }
      return require(name);
    },
  }, { filename: file });
  return exports;
}
