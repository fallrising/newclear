import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function shellQuote(value){return "'"+value.replace(/'/g,"'\\''")+"'";}
export function paneID(value){assert(/^%\d+$/.test(value),'REVIEW_TUI_PANE_ID');return value;}
export function terminalCommand(binary,data,before,after,exit){
  assert(binary==='/build/thinrouter'&&data.startsWith('/state/')&&[before,after,exit].every(path=>path.startsWith('/state/')),'REVIEW_TUI_PRIVATE_PATH');
  return 'stty -g > '+shellQuote(before)+'; /usr/bin/env TERM=xterm-256color '+shellQuote(binary)+' tui --data-dir '+shellQuote(data)+'; poker_exit=$?; stty -g > '+shellQuote(after)+'; printf "%s\\n" "$poker_exit" > '+shellQuote(exit)+'; exec /bin/sleep 300';
}
export function createTUICapture(state,id,binary,data,output,secrets,result,check) {
  const owned=[];const env={PATH:'/usr/bin:/bin',TMPDIR:state,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TERM:'xterm-256color'};
  function command(args) {
    return new Promise((resolve,reject)=>execFile('/usr/bin/tmux',args,{env,timeout:3000,maxBuffer:1024*1024,killSignal:'SIGKILL'},(error,stdout)=>{if(error)reject(Error('REVIEW_TMUX_COMMAND'));else resolve(stdout);}));
  }
  async function tmux(item,args){assert(owned.includes(item),'REVIEW_FOREIGN_TMUX');return command(['-S',item.socket,'-f','/dev/null',...args]);}
  const pidAbsent=pid=>{assert(Number.isSafeInteger(pid)&&pid>1&&pid!==process.pid,'REVIEW_TMUX_PID');try{process.kill(pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}};
  const groupAbsent=pid=>{assert(Number.isSafeInteger(pid)&&pid>1&&pid!==process.pid,'REVIEW_TUI_GROUP');try{process.kill(-pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}};
  async function close(item) {
    if(item.closed)return;
    // Socket is uniquely claimed in the fresh private state before tmux starts.
    const owner=JSON.parse(await readFile(join(state,'owner.json'),'utf8'));assert(owner.id===id,'REVIEW_TMUX_OWNER');
    let socketExists=false;try {const st=await lstat(item.socket);assert(st.isSocket()&&st.uid===process.getuid(),'REVIEW_TMUX_SOCKET');socketExists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!item.pid&&socketExists){const raw=(await tmux(item,['display-message','-p','#{pid}'])).trim();assert(/^\d+$/.test(raw),'REVIEW_TMUX_PID');item.pid=Number(raw);}
    assert(item.pid,'REVIEW_TMUX_ABSENCE_UNKNOWN');
    if(item.pid&&!pidAbsent(item.pid)) {
      const actual=Number((await tmux(item,['display-message','-p','#{pid}'])).trim());assert(actual===item.pid,'REVIEW_TMUX_OWNER_CHANGED');
      // This is only the explicitly owned socket, never the default/global server.
      await tmux(item,['kill-server']);
      const deadline=Date.now()+2500;while(!pidAbsent(item.pid)&&Date.now()<deadline)await delay(50);
      assert(pidAbsent(item.pid),'REVIEW_TMUX_REMAINS');
    }
    if(item.panePID){const deadline=Date.now()+2500;while(!groupAbsent(item.panePID)&&Date.now()<deadline)await delay(50);assert(groupAbsent(item.panePID),'REVIEW_TUI_GROUP_REMAINS');}
    assert(item.panePID,'REVIEW_TUI_GROUP_UNKNOWN');
    item.closed=true;(result.tuiCleanup??=[]).push({dataset:item.dataset,size:item.size,serverAbsent:pidAbsent(item.pid),paneGroupAbsent:groupAbsent(item.panePID)});
  }
  async function capture(dataset) {
    assert(['empty','populated'].includes(dataset),'REVIEW_TUI_DATASET');
    const owner=JSON.parse(await readFile(join(state,'owner.json'),'utf8'));assert(owner.id===id,'REVIEW_TMUX_OWNER');
    result.terminal??={TERM:'xterm-256color',locale:'C.UTF-8',tmux:(await command(['-V'])).trim(),captures:[],exits:[]};
    assert(/^tmux \d/.test(result.terminal.tmux),'REVIEW_TMUX_VERSION');
    for(const [columns,rows,exitKey] of [[80,24,'q'],[120,40,'Escape']]) {
      check();const label=dataset+'-'+columns+'x'+rows;
      const item={dataset,size:columns+'x'+rows,socket:join(state,'tmux-'+label+'.sock'),session:'review',pid:null,closed:false};
      try {await lstat(item.socket);throw Error('REVIEW_TMUX_SOCKET_REUSE');}catch(error){if(error.code!=='ENOENT')throw error;}
      owned.push(item);
      const before=join(state,label+'-before.stty'),after=join(state,label+'-after.stty'),exit=join(state,label+'-exit.code');
      try {
        const pane=(await tmux(item,['new-session','-d','-P','-F','#{pane_id}','-x',String(columns),'-y',String(rows),'-s',item.session,'/bin/sh','-c',terminalCommand(binary,data,before,after,exit)])).trim();paneID(pane);
        item.pid=Number((await tmux(item,['display-message','-p','-t',pane,'#{pid}'])).trim());assert(Number.isSafeInteger(item.pid)&&item.pid>1,'REVIEW_TMUX_PID');
        item.panePID=Number((await tmux(item,['display-message','-p','-t',pane,'#{pane_pid}'])).trim());assert(Number.isSafeInteger(item.panePID)&&item.panePID>1,'REVIEW_TUI_GROUP');
        const stat=await readFile('/proc/'+item.panePID+'/stat','utf8');assert(Number(stat.slice(stat.lastIndexOf(')')+2).split(/\s+/)[2])===item.panePID,'REVIEW_TUI_GROUP_IDENTITY');
        const size=(await tmux(item,['display-message','-p','-t',pane,'#{pane_width}x#{pane_height}'])).trim();assert(size===item.size,'REVIEW_TUI_SIZE');
        for(const [index,title] of ['Connections','Routes','Recent usage'].entries()) {
          if(index)await tmux(item,['send-keys','-t',pane,'Tab']);
          let plain='',ready=false;
          const deadline=Date.now()+5000;
          while(Date.now()<deadline){check();plain=await tmux(item,['capture-pane','-p','-t',pane]);const alternate=(await tmux(item,['display-message','-p','-t',pane,'#{alternate_on}'])).trim();if(alternate==='1'&&(plain.split('\n')[3]??'').includes(title)){ready=true;break;}await delay(100);}
          assert(ready,'REVIEW_TUI_PAGE_NOT_READY');
          const ansi=await tmux(item,['capture-pane','-p','-e','-t',pane]);
          assert(plain.includes('q: quit / Esc')&&plain.includes('est. cost: $')&&plain.includes('db: /state/synthetic-data/thinrouter.db'),'REVIEW_TUI_EXIT_HINT');
          if(dataset==='empty')assert(plain.includes('No rows to display.'),'REVIEW_TUI_EMPTY');
          if(dataset==='populated'&&index===0)assert(plain.split('\n').some(line=>line.includes('合成連線')&&line.includes('http://127.0.0.1')&&line.includes('review-model')),'REVIEW_TUI_CONNECTION_COLUMNS');
          if(dataset==='populated'&&index===0)for(const name of ['review-connection-02','review-connection-09'])assert(plain.split('\n').some(line=>line.includes(name)&&line.includes('http://127.0.0.1:20129/v1')&&line.includes('review-model')),'REVIEW_TUI_NORMAL_IDENTITY');
          if(dataset==='populated'&&index===1)assert(plain.split('\n').some(line=>line.includes('合成模型')&&line.includes('fallback')&&line.includes('review-short')),'REVIEW_TUI_ROUTE_COLUMNS');assert(/\x1b\[/.test(ansi),'REVIEW_TUI_ANSI_MISSING');
          assert(secrets.every(secret=>!plain.includes(secret)&&!ansi.includes(secret)),'REVIEW_TUI_SECRET');
          const stem='tui-'+label+'-'+['connections','routes','usage'][index];
          await writeFile(join(output,stem+'.txt'),plain,{flag:'wx',mode:0o600});await writeFile(join(output,stem+'.ansi'),ansi,{flag:'wx',mode:0o600});
          result.terminal.captures.push({dataset,size:item.size,page:title,alternateScreen:true,exitHintVisible:true,plain:{file:stem+'.txt',sha256:createHash('sha256').update(plain).digest('hex')},ansi:{file:stem+'.ansi',sha256:createHash('sha256').update(ansi).digest('hex')},visibleRows:plain.split('\n').length-1});
        }
        await tmux(item,['send-keys','-t',pane,exitKey]);
        let code=null;const deadline=Date.now()+5000;
        while(Date.now()<deadline){try{code=(await readFile(exit,'utf8')).trim();break;}catch(error){if(error.code!=='ENOENT')throw error;}await delay(100);}
        assert(code==='0','REVIEW_TUI_EXIT');
        const initial=(await readFile(before,'utf8')).trim(),restored=(await readFile(after,'utf8')).trim();
        assert(initial&&initial===restored,'REVIEW_TUI_RAW_MODE_NOT_RESTORED');
        const alternate=(await tmux(item,['display-message','-p','-t',pane,'#{alternate_on}'])).trim();assert(alternate==='0','REVIEW_TUI_ALT_NOT_RESTORED');
        result.terminal.exits.push({dataset,size:item.size,key:exitKey==='Escape'?'Esc':'q',code:0,sttyRestored:true,alternateScreenRestored:true});
      } finally {await close(item);}
    }
  }
  return {capture,async closeAll(){let failed=false;for(const item of owned){try{await close(item);}catch{failed=true;}}assert(!failed,'REVIEW_TMUX_CLEANUP');}};
}
