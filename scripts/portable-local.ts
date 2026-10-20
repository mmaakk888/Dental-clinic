import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {createServer} from 'vite';
const mode=process.argv[2]??'preview',php=process.env.CLINIC_PHP_BINARY||'php';
const config=process.env.CLINIC_LOCAL_CONFIG;
if(!config||!fs.existsSync(config))throw Error('جهّز قاعدة MySQL محلية وملف إعدادات خاص، ثم اضبط CLINIC_LOCAL_CONFIG. راجع portable/INSTALL.ar.md. لا توجد بيانات أو حسابات تجريبية تُنشأ تلقائيًا.');
const probe=spawnSync(php,['-r','exit(version_compare(PHP_VERSION,"8.2",">=") && extension_loaded("pdo_mysql") ? 0 : 2);'],{encoding:'utf8',windowsHide:true});
if(probe.error||probe.status!==0)throw Error('يلزم PHP CLI 8.2+ مع pdo_mysql على اللاب للمعاينة. اضبط CLINIC_PHP_BINARY إذا لم يكن php في PATH. الاستضافة لا تحتاج Node.');
const dev=mode==='dev';if(!dev&&!fs.existsSync('build/portable-release/htdocs/index.html'))throw Error('شغّل pnpm build أولًا.');
const port=dev?4187:Number(process.env.CLINIC_PREVIEW_PORT||4174);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local port.');
const env:NodeJS.ProcessEnv={...process.env,CLINIC_LOCAL_CONFIG:path.resolve(config)};delete env.CLINIC_TEST_MODE;delete env.CLINIC_TEST_CONFIG;
const child=spawn(php,dev?['-S',`127.0.0.1:${port}`,'-t','portable/public','portable/dev-router.php']:['-S',`127.0.0.1:${port}`,'-t','build/portable-release/htdocs'],{stdio:'inherit',windowsHide:true,env});
let vite:Awaited<ReturnType<typeof createServer>>|undefined;
const stop=async()=>{child.kill();await vite?.close();};process.on('SIGINT',()=>void stop().then(()=>process.exit()));process.on('SIGTERM',()=>void stop().then(()=>process.exit()));
child.on('error',error=>{console.error(error.message);process.exitCode=1;void stop();});child.on('exit',code=>{if(code)process.exitCode=code;void vite?.close();});
if(dev){vite=await createServer({configFile:path.resolve('vite.portable.config.ts')});await vite.listen();vite.printUrls();}
else console.log(`معاينة PHP المحلية: http://127.0.0.1:${port}/ — يجب أن يطابق app_url هذا الرابط مع تفعيل allow_http_loopback محليًا فقط.`);
