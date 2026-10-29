import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// tsx TypeScript'i CommonJS'e derler, bu yüzden ESM resolve hook'u
// `require('vscode')` ifadesini hiç görmez. Senkron hook zinciri CJS çözümlemesini de kapsar.
const stubUrl = pathToFileURL(new URL('./vscode-stub.ts', import.meta.url).pathname).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'vscode') {
      return { url: stubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
