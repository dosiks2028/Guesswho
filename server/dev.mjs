import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath,['server/index.mjs'],{stdio:'inherit',env:{...process.env,PORT:'8787'},windowsHide:true}),
  spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','0.0.0.0'],{stdio:'inherit',windowsHide:true}),
];
const stop = () => { for (const child of children) child.kill(); };
process.on('SIGINT',stop); process.on('SIGTERM',stop);
for (const child of children) child.on('exit',code => { stop(); process.exitCode = code || 0; });
