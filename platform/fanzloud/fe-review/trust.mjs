import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
export function installFreshTrust(life,result){
 result.stage='TRUST';const openssl=(...args)=>{life.check();execFileSync('openssl',args,{cwd:'/state',stdio:'ignore',timeout:10000});life.check();};
 openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout','trusted.key','-out','trusted.crt','-days','1','-subj','/CN=Review-trusted','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign');
 openssl('req','-newkey','rsa:2048','-nodes','-keyout','correct.key','-out','correct.csr','-subj','/CN=Review-correct');writeFileSync('/state/correct.ext','subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',{flag:'wx',mode:0o600});
 openssl('x509','-req','-in','correct.csr','-CA','trusted.crt','-CAkey','trusted.key','-CAcreateserial','-out','correct.crt','-days','1','-extfile','correct.ext');
 const nss=homedir()+'/.pki/nssdb';assert(!existsSync(nss));mkdirSync(nss,{recursive:true,mode:0o700});for(const args of [['-N','--empty-password','-d','sql:'+nss],['-A','-d','sql:'+nss,'-n','review-trusted','-t','C,,','-i','/state/trusted.crt']]){life.check();execFileSync('certutil',args,{stdio:'ignore',timeout:5000});}life.check();

return {key:readFileSync('/state/correct.key'),cert:readFileSync('/state/correct.crt')};
}
