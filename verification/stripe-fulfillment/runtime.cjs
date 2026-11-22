const fs=require('node:fs');
const path=require('node:path');
const {requireTools,requireStripe}=require('./harness.cjs');
const lock=require('../../package-lock.json');
function version(name,loader){
  let directory=path.dirname(loader.resolve(name));
  for(;;){const file=path.join(directory,'package.json');if(fs.existsSync(file)){const pkg=JSON.parse(fs.readFileSync(file,'utf8'));if(pkg.name===name)return pkg.version;}const parent=path.dirname(directory);if(parent===directory)throw new Error('Cannot identify runtime '+name);directory=parent;}
}
const dependencies=Object.fromEntries(['next','zod','typescript','stripe'].map(name=>[name,{actual:version(name,name==='stripe'?requireStripe:requireTools),locked:lock.packages['node_modules/'+name].version}]));
console.log(JSON.stringify({node:process.version,dependencies,all_match_lock:Object.values(dependencies).every(entry=>entry.actual===entry.locked),network_calls:0}));
