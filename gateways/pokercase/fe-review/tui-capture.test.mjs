import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalCommand,paneID,shellQuote} from './tui-capture.mjs';
test('terminal command has only readonly tui and private explicit data/output paths',()=>{
  const command=terminalCommand('/build/thinrouter','/state/synthetic-data','/state/before','/state/after','/state/exit');
  assert(command.includes("' tui --data-dir '/state/synthetic-data'"));assert(!/import-local|refresh|login-siwc|serve/.test(command));
  assert.throws(()=>terminalCommand('/usr/bin/other','/state/data','/state/a','/state/b','/state/c'),/REVIEW_TUI_PRIVATE_PATH/);
  assert.throws(()=>terminalCommand('/build/thinrouter','/home/private','/state/a','/state/b','/state/c'),/REVIEW_TUI_PRIVATE_PATH/);
  assert.equal(shellQuote("x'$(unsafe)"),"'x'\\''$(unsafe)'");
});
test('tmux pane must be exact returned numeric pane identity',()=>{
  assert.equal(paneID('%12'),'%12');for(const value of ['default','0:0','%1; kill-server',''])assert.throws(()=>paneID(value),/REVIEW_TUI_PANE_ID/);
});
