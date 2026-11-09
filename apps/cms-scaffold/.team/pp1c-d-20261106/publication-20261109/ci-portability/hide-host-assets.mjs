import { registerHooks } from 'node:module';
registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier === 'node:os' && /\/local-restore-(?:smoke|browser-material)\.mjs$/.test(context.parentURL ?? ''))
    return {url:'data:text/javascript,export const homedir=()=>"/nonexistent-pp1c-ci-fixture";',shortCircuit:true};
  return nextResolve(specifier, context);
}});
