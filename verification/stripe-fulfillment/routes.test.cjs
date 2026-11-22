const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {harness,secret,internalSecret}=require('./harness.cjs');
const previous={webhook:process.env.STRIPE_WEBHOOK_SECRET,internal:process.env.INTERNAL_WEBHOOK_SECRET};
before(()=>{process.env.STRIPE_WEBHOOK_SECRET=secret;process.env.INTERNAL_WEBHOOK_SECRET=internalSecret;});
after(()=>{for(const [key,value] of [['STRIPE_WEBHOOK_SECRET',previous.webhook],['INTERNAL_WEBHOOK_SECRET',previous.internal]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
for(const internal of [false,true]){
  const label=internal?'internal':'public';
  const post=(h,request)=>internal?h.internalPost(request):h.publicPost(request);
  test(`${label}: authentic signed event reaches one transactional RPC and checked receipt`,async()=>{
    const h=harness();const response=await post(h,h.request(internal));
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{received:true,duplicate:false,deferred:false});
    assert.equal(h.calls.rpc.length,1);assert.equal(h.calls.rpc[0].name,'apply_stripe_fulfillment');
    assert.equal(h.calls.rpc[0].args.p_payload_hash,createHash('sha256').update(JSON.stringify(h.state.event)).digest('hex'));
    assert.equal(h.calls.rpc[0].args.p_checkout.amount_total,2000);assert.equal(h.calls.subscription.length,1);
  });
  test(`${label}: altered signature never reaches provider or persistence`,async()=>{
    const h=harness();const response=await post(h,h.request(internal,{headers:{[internal?'x-stripe-signature':'stripe-signature']:'t=1,v1=invalid'}}));
    assert.equal(response.status,400);assert.equal(h.calls.checkout.length,0);assert.equal(h.calls.rpc.length,0);
  });
  test(`${label}: database errors are retryable and redacted`,async()=>{
    const h=harness({reply:()=>({data:null,error:{message:'private_database_detail'}})});const response=await post(h,h.request(internal));
    assert.equal(response.status,500);assert.doesNotMatch(await response.text(),/private_database_detail/);
  });
  test(`${label}: ambiguous transport error is never a successful acknowledgement`,async()=>{
    const h=harness({rpcThrow:new Error('secret_provider_detail')});const response=await post(h,h.request(internal));
    assert.equal(response.status,500);assert.doesNotMatch(await response.text(),/secret_provider_detail/);
  });
  test(`${label}: confirmed duplicate is acknowledged without claiming a new effect`,async()=>{
    const h=harness({reply:receipt=>({data:{...receipt,duplicate:true},error:null})});const response=await post(h,h.request(internal));
    assert.equal(response.status,200);assert.equal((await response.json()).duplicate,true);
  });
}
test('public and dispatcher transports use identical event, session and payload keys',async()=>{
  const h=harness();assert.equal((await h.publicPost(h.request())).status,200);assert.equal((await h.internalPost(h.request(true))).status,200);
  assert.deepEqual(h.calls.rpc[0],h.calls.rpc[1]);
});
for(const mutate of [()=>null,r=>({...r,event_id:'evt_wrong'}),r=>({...r,event_type:'wrong'}),r=>({...r,object_id:'cs_wrong'}),r=>({...r,payload_hash:'0'.repeat(64)}),r=>({...r,profile_id:null}),r=>({...r,payment_id:null}),r=>({...r,profile_id:'invalid'}),r=>({...r,status:'deferred',profile_id:null,payment_id:null,wallet_transaction_id:null})]){
  test(`missing/mismatched receipt ${String(mutate)} returns 500`,async()=>{
    const h=harness({reply:r=>({data:mutate(r),error:null})});assert.equal((await h.publicPost(h.request())).status,500);
  });
}
test('internal auth fails closed when the configured secret is missing or empty',async()=>{
  const h=harness();delete process.env.INTERNAL_WEBHOOK_SECRET;
  try{assert.equal((await h.internalPost(h.request(true,{headers:{'x-internal-secret':''}}))).status,401);assert.equal(h.calls.signature.length,0);}finally{process.env.INTERNAL_WEBHOOK_SECRET=internalSecret;}
});
test('wrong internal secret is rejected before parsing a signed event',async()=>{
  const h=harness();assert.equal((await h.internalPost(h.request(true,{headers:{'x-internal-secret':'wrong'}}))).status,401);assert.equal(h.calls.signature.length,0);
});
test('foreign application and unmarked events cause no mutation or provider call',async()=>{
  for(const metadata of [{app_slug:'another-app'},{}]){const h=harness();h.state.event.data.object.metadata=metadata;const response=await h.publicPost(h.request());assert.equal(response.status,200);assert.equal((await response.json()).ignored,true);assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.checkout.length,0);}
});
test('unhandled signed event is acknowledged without calling the database',async()=>{
  const h=harness();h.state.event.type='customer.created';assert.equal((await h.publicPost(h.request())).status,200);assert.equal(h.calls.rpc.length,0);
});
test('unpaid completed checkout is deferred without fetching a subscription',async()=>{
  const h=harness();h.state.session.payment_status='unpaid';const response=await h.publicPost(h.request());assert.equal(response.status,200);assert.equal((await response.json()).deferred,true);assert.equal(h.calls.subscription.length,0);assert.equal(h.calls.rpc[0].args.p_subscription,null);
});
test('later asynchronous payment retains the checkout id and requires paid status',async()=>{
  const h=harness();h.state.event.type='checkout.session.async_payment_succeeded';assert.equal((await h.publicPost(h.request())).status,200);assert.equal(h.calls.rpc[0].args.p_object_id,'cs_fixture');
  h.state.session.payment_status='unpaid';assert.equal((await h.publicPost(h.request())).status,500);assert.equal(h.calls.rpc.length,1);
});
test('a trial is represented without a fabricated payment receipt',async()=>{
  const h=harness();h.state.session.payment_status='no_payment_required';h.state.session.amount_total=0;h.state.subscription.status='trialing';const response=await h.publicPost(h.request());assert.equal(response.status,200);assert.equal(h.calls.rpc[0].args.p_checkout.amount_total,0);assert.equal(h.calls.rpc[0].args.p_subscription.status,'trialing');
});
test('subscription update retrieves current state and does not invent a payment from a list price',async()=>{
  const h=harness();h.state.event.type='customer.subscription.updated';h.state.event.data.object={...structuredClone(h.state.subscription),status:'active'};h.state.subscription.status='canceled';assert.equal((await h.publicPost(h.request())).status,200);assert.equal(h.calls.rpc[0].args.p_subscription.status,'canceled');assert.equal(h.calls.rpc[0].args.p_checkout,null);
});
test('provider failure and mismatched checkout/subscription/customer abort before writes',async()=>{
  for(const change of [h=>{h.state.providerError=new Error('private_provider_detail');},h=>{h.state.session.id='cs_other';},h=>{h.state.session.metadata.app_slug='other';},h=>{h.state.subscription.id='sub_other';},h=>{h.state.subscription.customer='cus_other';},h=>{h.state.subscription.metadata.app_slug='other';}]){const h=harness();change(h);const response=await h.publicPost(h.request());assert.equal(response.status,500);assert.equal(h.calls.rpc.length,0);assert.doesNotMatch(await response.text(),/private_provider_detail/);}
});
test('invalid money, missing customer and unknown billing interval are rejected before writes',async()=>{
  for(const change of [h=>{h.state.session.amount_total=-1;},h=>{h.state.session.amount_total=2.3;},h=>{h.state.session.amount_total=null;},h=>{h.state.session.customer=null;},h=>{h.state.subscription.items.data[0].price.recurring.interval='week';}]){const h=harness();change(h);assert.equal((await h.publicPost(h.request())).status,500);assert.equal(h.calls.rpc.length,0);}
});
test('profile revision is read before provider data and passed unchanged to the transaction',async()=>{
  const h=harness();h.state.target.stripe_state_revision=42;assert.equal((await h.publicPost(h.request())).status,200);
  assert.deepEqual(h.calls.order,['target','checkout','subscription','rpc']);assert.equal(h.calls.rpc[0].args.p_expected_revision,42);assert.equal(h.calls.rpc[0].args.p_profile_id,h.state.target.id);
});
test('unavailable, foreign or unbound legacy target cannot reach provider or writes',async()=>{
  for(const change of [h=>{h.state.targetError={message:'private_target_detail'};},h=>{h.state.target=null;},h=>{h.state.target.stripe_customer_id='cus_other';},h=>{delete h.state.event.data.object.metadata.profile_id;},h=>{h.state.event.data.object.metadata.profile_id='invalid';}]){const h=harness();change(h);const response=await h.publicPost(h.request());assert.equal(response.status,500);assert.equal(h.calls.checkout.length,0);assert.equal(h.calls.rpc.length,0);assert.doesNotMatch(await response.text(),/private_target_detail/);}
});
test('a historical subscription can resolve its already verified customer binding',async()=>{
  const h=harness();h.state.target.stripe_customer_id='cus_fixture';h.state.event.type='customer.subscription.updated';h.state.event.data.object=structuredClone(h.state.subscription);delete h.state.event.data.object.metadata.profile_id;
  assert.equal((await h.publicPost(h.request())).status,200);assert.deepEqual(h.calls.target[0].filters,[['stripe_customer_id','cus_fixture']]);
});
test('replacement of a prior subscription requires a current terminal-state retrieval',async()=>{
  const h=harness();h.state.target.stripe_subscription_id='sub_previous';h.state.previousSubscription={...structuredClone(h.state.subscription),id:'sub_previous',status:'active'};
  assert.equal((await h.publicPost(h.request())).status,500);assert.equal(h.calls.rpc.length,0);
  h.state.previousSubscription.status='canceled';assert.equal((await h.publicPost(h.request())).status,200);
  assert.equal(h.calls.rpc[0].args.p_subscription.previous_id,'sub_previous');assert.equal(h.calls.rpc[0].args.p_subscription.previous_status,'canceled');
});
test('receipt belonging to a different valid profile is rejected',async()=>{
  const h=harness({reply:r=>({data:{...r,profile_id:'90000000-0000-4000-8000-000000000009'},error:null})});assert.equal((await h.publicPost(h.request())).status,500);
});
test('a superseded subscription is acknowledged only with an explicit ignored receipt',async()=>{
  const h=harness({reply:r=>({data:{...r,status:'ignored'},error:null})});h.state.event.type='customer.subscription.deleted';h.state.event.data.object=structuredClone(h.state.subscription);
  const response=await h.publicPost(h.request());assert.equal(response.status,200);assert.equal((await response.json()).ignored,true);
});
