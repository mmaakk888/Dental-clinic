import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync, createPrivateKey, createPublicKey, sign, createHash} from 'node:crypto';
import {createZip, listFiles} from './portable-zip';

// The private signer NEVER enters Git, public files or an update package.
const args=process.argv.slice(2);
if(args[0]==='keygen'){
  const keyPath=path.resolve(args[1]||'.firebase/update-signing/publisher.private.pem');
  fs.mkdirSync(path.dirname(keyPath),{recursive:true});
  if(fs.existsSync(keyPath))throw Error('Existing signing identity is immutable. Back it up offline; do not overwrite it.');
  const pair=generateKeyPairSync('ed25519');fs.writeFileSync(keyPath,pair.privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});
  const raw=(pair.publicKey.export({format:'der',type:'spki'}) as Buffer).subarray(-32).toString('base64');
  console.log(JSON.stringify({publicKey:raw,privateKeyFile:keyPath,warning:'Save the private file OFFLINE, separately. Never upload it to the host or GitHub.'}));
}else{
  const [rootArg,keyArg,fromArg,outArg,migrationsArg]=args;
  if(!outArg)throw Error('Usage: tsx scripts/package-update.ts htdocs private-signing.pem fromVersion[,from2] output.zip [migrations.json]');
  const root=path.resolve(rootArg),keyPath=path.resolve(keyArg),output=path.resolve(outArg);
  const key=createPrivateKey(fs.readFileSync(keyPath)),publicKey=(createPublicKey(key).export({format:'der',type:'spki'}) as Buffer).subarray(-32).toString('base64');
  const trust=JSON.parse(fs.readFileSync(path.join(root,'api/update-trust.json'),'utf8'));
  if(!trust.keys.includes(publicKey))throw Error('Private signer does not match the pinned publisher.');
  const release=JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8'));
  const immutable=new Set(['api/update.php','api/update-console.js','api/update-console.css']);
  const source=listFiles(root).filter(file=>!immutable.has(path.relative(root,file).replaceAll('\\','/')));
  const staging=fs.mkdtempSync(path.resolve('.firebase/update-package-'));fs.mkdirSync(path.join(staging,'payload'));
  const files=source.map(file=>{const name=path.relative(root,file).replaceAll('\\','/'),bytes=fs.readFileSync(file);const dest=path.join(staging,'payload',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);return {path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
  const migrations=migrationsArg?JSON.parse(fs.readFileSync(migrationsArg,'utf8')):[{id:'system-updater-v1',kind:'meta-default',key:'system_migration.updater-v1',value:{protocol:1}}];
  const manifest={format:'clinic-app-update',protocol:1,app:'dental-clinic-php-mysql',from:fromArg.split(','),to:release.version,schemaVersion:release.schemaVersion,minPhp:'8.2.0',notes:'تحديث آمن مع الحفاظ على تصميم العيادة وبياناتها وإعداداتها.',files,migrations};
  if(manifest.from.includes(manifest.to))throw Error('An update must target a DIFFERENT version. Do not relabel an unchanged release.');
  const raw=Buffer.from(JSON.stringify(manifest));fs.writeFileSync(path.join(staging,'manifest.json'),raw);fs.writeFileSync(path.join(staging,'signature.txt'),sign(null,raw,key).toString('base64'));
  fs.mkdirSync(path.dirname(output),{recursive:true});createZip(output,staging,listFiles(staging));console.log(JSON.stringify({output,from:manifest.from,to:manifest.to,files:files.length,sha256:createHash('sha256').update(fs.readFileSync(output)).digest('hex')}));
}
