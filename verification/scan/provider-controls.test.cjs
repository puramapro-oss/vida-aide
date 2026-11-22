// Execute the actual scan producer and the locked SDK with a synthetic fetch.
// No provider connection, secret, financial operation or real model response.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..');
const modules=process.env.VIDA_AIDE_VERIFICATION_NODE_MODULES||path.join(root,'verification/node_modules');
const load=createRequire(path.join(path.dirname(modules),'package.json'));
const ts=load('typescript');
const AnthropicModule=load('@anthropic-ai/sdk');
const Anthropic=AnthropicModule.default||AnthropicModule;
function producer(fetch){
  const mod={exports:{}};
  class OfflineAnthropic{
    constructor(options){return new Anthropic({...options,apiKey:'offline_fixture_only',fetch});}
  }
  const filename=path.join(root,'src/lib/claude.ts');
  const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
  new Function('require','module','exports',compiled.outputText)((request)=>{
    if(request==='@anthropic-ai/sdk')return OfflineAnthropic;
    throw new Error('Unexpected runtime dependency: '+request);
  },mod,mod.exports);
  return mod.exports.scanFinancialJSON;
}
test('a retryable provider failure causes one real SDK transport attempt',async()=>{
  let calls=0;
  const scan=producer(async()=>{calls++;return new Response(JSON.stringify({type:'error',error:{type:'api_error',message:'Synthetic retryable failure'}}),{status:500,headers:{'content-type':'application/json','x-should-retry':'true'}});});
  await assert.rejects(()=>scan({revenus_mensuels_nets:0},'financial','free'));
  assert.equal(calls,1,'A reserved scan must not create hidden SDK retries');
});
test('an already aborted signal stops the actual SDK before synthetic transport',async()=>{
  let calls=0;
  const scan=producer(async()=>{calls++;throw new Error('Transport should not start');});
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>scan({},'financial','free',controller.signal));
  assert.equal(calls,0);
});
