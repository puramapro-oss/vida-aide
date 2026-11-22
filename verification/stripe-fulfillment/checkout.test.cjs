const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {requireTools,ids}=require('./harness.cjs');
const ts=requireTools('typescript');
const root=path.resolve(__dirname,'../..');
function harness(){
  const state={user:{id:'auth_fixture',email:'auth@example.invalid'},authError:null,profile:{id:ids.profile,email:'payer@example.invalid',stripe_customer_id:null,role:'user'},profileError:null,session:{url:'https://checkout.stripe.com/c/pay_fixture'}};
  const calls={auth:0,profile:0,create:[]};
  const cache=new Map();
  function load(filename){
    filename=path.resolve(root,filename);if(cache.has(filename))return cache.get(filename);const mod={exports:{}};cache.set(filename,mod.exports);
    const localRequire=request=>{
      if(request==='stripe')return class Stripe{constructor(){this.checkout={sessions:{create:async(...args)=>{calls.create.push(args);if(state.providerError)throw state.providerError;return state.session;}}};}};
      if(request==='@/lib/supabase-server')return{createServerSupabaseClient:async()=>({auth:{getUser:async()=>{calls.auth++;return{data:{user:state.user},error:state.authError};}}})};
      if(request==='@/lib/supabase')return{createServiceClient:()=>({from:()=>{calls.profile++;const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:state.profile,error:state.profileError})};return chain;}})};
      if(request.startsWith('@/'))return load(path.join('src',request.slice(2)+'.ts'));
      return requireTools(request);
    };
    const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
    new Function('require','module','exports',compiled.outputText)(localRequire,mod,mod.exports);cache.set(filename,mod.exports);return mod.exports;
  }
  return{state,calls,POST:load('src/app/api/stripe/checkout/route.ts').POST,request:(body={interval:'monthly'})=>new Request('https://fixture.invalid/api/stripe/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})};
}
test('actual checkout code puts the authenticated profile in both metadata objects',async()=>{
  const h=harness();const response=await h.POST(h.request({interval:'monthly',profile_id:'forged',customerEmail:'forged@example.invalid',referral_code:'REFTEST'}));assert.equal(response.status,200);
  const [session,options]=h.calls.create[0];assert.equal(session.metadata.profile_id,ids.profile);assert.equal(session.subscription_data.metadata.profile_id,ids.profile);assert.equal(session.customer_email,'payer@example.invalid');assert.equal(session.metadata.referral_code,'REFTEST');assert.equal(session.line_items[0].price_data.unit_amount,999);assert.equal(session.subscription_data.trial_period_days,14);assert.match(options.idempotencyKey,new RegExp('^checkout:'+ids.profile+':premium:monthly:'));
});
test('yearly price and existing customer are preserved',async()=>{
  const h=harness();h.state.profile.stripe_customer_id='cus_existing';assert.equal((await h.POST(h.request({interval:'yearly'}))).status,200);const [session]=h.calls.create[0];assert.equal(session.customer,'cus_existing');assert.equal(session.customer_email,undefined);assert.equal(session.line_items[0].price_data.unit_amount,8390);assert.equal(session.line_items[0].price_data.recurring.interval,'year');
});
test('auth error takes precedence over a simultaneously returned user',async()=>{
  const h=harness();h.state.authError={message:'private_auth_detail'};assert.equal((await h.POST(h.request())).status,401);assert.equal(h.calls.profile,0);assert.equal(h.calls.create.length,0);
});
test('missing user cannot create a checkout',async()=>{
  const h=harness();h.state.user=null;assert.equal((await h.POST(h.request())).status,401);assert.equal(h.calls.create.length,0);
});
test('failed profile lookup is unavailable and never mistaken for missing account',async()=>{
  const h=harness();h.state.profileError={message:'private_database_detail'};const response=await h.POST(h.request());assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private_database_detail/);assert.equal(h.calls.create.length,0);
});
test('missing profile, invalid plan and existing administrative entitlement cause no provider write',async()=>{
  const h=harness();h.state.profile=null;assert.equal((await h.POST(h.request())).status,404);assert.equal(h.calls.create.length,0);
  const admin=harness();admin.state.profile.role='super_admin';assert.equal((await admin.POST(admin.request())).status,400);assert.equal(admin.calls.create.length,0);
  const invalid=harness();assert.equal((await invalid.POST(invalid.request({interval:'week'}))).status,400);assert.equal(invalid.calls.create.length,0);
});
test('provider exceptions never expose their private details',async()=>{
  const h=harness();h.state.providerError=new Error('private_stripe_detail');const response=await h.POST(h.request());assert.equal(response.status,502);assert.doesNotMatch(await response.text(),/private_stripe_detail/);
});
test('missing or unsafe redirect URL is not a successful checkout',async()=>{
  for(const url of [null,undefined,'javascript:alert(1)','http://checkout.stripe.com/plain','not-a-url']){const h=harness();h.state.session={url};assert.equal((await h.POST(h.request())).status,502);}
});
