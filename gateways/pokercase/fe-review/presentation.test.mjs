import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const template=async name=>readFile(new URL('../templates/'+name,import.meta.url),'utf8');
test('empty key stores are described as denied by default, not open inference',async()=>{
  for(const name of ['keys.html','dashboard.html']) {
    const html=await template(name);
    assert(!/auth is open|\/v1[^<\n]*is open/.test(html),'obsolete open-keyless copy');
    assert.match(html,/required by default/);assert.match(html,/explicit.*opt-in/);
  }
});
test('table action columns have nonempty accessible headings',async()=>{
  for(const name of ['connections.html','routes.html','keys.html']) {
    const html=await template(name);assert(!/<th>\s*<\/th>/.test(html),'empty action heading');assert.match(html,/<th>Actions<\/th>/);
  }
});
test('every data table has a named keyboard-reachable local scroll region',async()=>{
  for(const name of ['connections.html','routes.html','keys.html','usage.html']) {
    const html=await template(name);const tables=[...html.matchAll(/<table>/g)];
    const wrappers=[...html.matchAll(/<div class="table-scroll" tabindex="0" role="region" aria-label="[^"]+">\s*<table>/g)];
    assert(tables.length>0&&wrappers.length===tables.length,'table missing its own accessible scroll region');
  }
});
test('prose links have a non-color visual cue and intrinsic table width stays local',async()=>{
  const css=await template('style.css');
  assert.match(css,/\.content\s+li\s+a\s*\{[^}]*text-decoration:\s*underline/);
  assert.match(css,/\.content\s*\{[^}]*min-width:\s*0/);
  assert.match(css,/\.table-scroll\s*\{[^}]*overflow-x:\s*auto/);
});
