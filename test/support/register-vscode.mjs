import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// tsx compiles TypeScript to CommonJS, so the ESM resolve hook never sees
// `require('vscode')`. The synchronous hook chain also covers CJS resolution.
const stubUrl = pathToFileURL(new URL('./vscode-stub.ts', import.meta.url).pathname).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'vscode') {
      return { url: stubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
