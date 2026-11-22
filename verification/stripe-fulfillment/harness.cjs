// Real handlers, helper, NextResponse, Zod, SHA256 and Stripe signature verification.
// Only provider retrievals and the database boundary are replaced with fixtures.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const dependencyRoot = process.env.VIDA_AIDE_VERIFICATION_NODE_MODULES;
const requireTools = createRequire(path.join(dependencyRoot ? path.dirname(dependencyRoot) : root, 'package.json'));
const stripeRoot = process.env.VIDA_AIDE_STRIPE_NODE_MODULES;
const requireStripe = stripeRoot ? createRequire(path.join(path.dirname(stripeRoot), 'package.json')) : requireTools;
const Stripe = requireStripe('stripe');
const ts = requireTools('typescript');
const signer = new Stripe('sk_test_offline_fixture_only');
const secret = 'whsec_offline_fixture_only';
const internalSecret = 'offline_fixture_internal_secret';
const ids = { profile: '10000000-0000-4000-8000-000000000001', payment: '20000000-0000-4000-8000-000000000002', wallet: '30000000-0000-4000-8000-000000000003' };
function harness(options = {}) {
  const created = Math.floor(Date.now()/1000);
  const session = { id: 'cs_fixture', object: 'checkout.session', created, customer: 'cus_fixture', customer_email: 'payer@example.invalid', customer_details: null, subscription: 'sub_fixture', payment_intent: 'pi_fixture', mode: 'subscription', payment_status: 'paid', amount_total: 2000, currency: 'eur', metadata: { app_slug: 'vida-aide', profile_id: ids.profile, referral_code: 'REFTEST' } };
  const subscription = { id: 'sub_fixture', object: 'subscription', customer: 'cus_fixture', status: 'active', trial_end: null, items: { data: [{ price: { recurring: { interval: 'month' }, unit_amount: 2000, currency: 'eur' } }] }, metadata: { app_slug: 'vida-aide', profile_id: ids.profile } };
  const target = {id:ids.profile,stripe_customer_id:null,stripe_subscription_id:null,stripe_state_revision:0};
  const state = { session, subscription, target, event: { id: 'evt_fixture', object: 'event', type: 'checkout.session.completed', created, data: { object: structuredClone(session) } }, ...options };
  const calls = { target: [], order: [], signature: [], checkout: [], subscription: [], rpc: [] };
  const stripe = {
    webhooks: { constructEvent: (...args) => { calls.signature.push(args); return signer.webhooks.constructEvent(...args); } },
    checkout: { sessions: { retrieve: async (id) => { calls.checkout.push(id); calls.order.push('checkout'); if (state.providerError) throw state.providerError; return structuredClone(state.session); } } },
    subscriptions: { retrieve: async (id) => { calls.subscription.push(id); calls.order.push('subscription'); if (state.providerError) throw state.providerError; return structuredClone(state.previousSubscription?.id===id?state.previousSubscription:state.subscription); } },
  };
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(root, filename);
    if (cache.has(filename)) return cache.get(filename);
    const mod = {exports:{}};
    cache.set(filename, mod.exports);
    const localRequire = (request) => {
      if(request==='@/lib/stripe') return {getStripe:()=>stripe};
      if(request==='@/lib/supabase') return {createServiceClient:()=>({from:(table)=>{const query={table,filters:[]};const chain={select:()=>chain,eq:(...filter)=>{query.filters.push(filter);return chain;},maybeSingle:async()=>{calls.target.push(query);calls.order.push('target');return {data:structuredClone(state.target),error:state.targetError??null};}};return chain;},rpc:async(name,args)=>{
        calls.rpc.push({name,args}); calls.order.push('rpc');
        if(state.rpcThrow) throw state.rpcThrow;
        const deferred = args.p_checkout?.payment_status==='unpaid';
        const receipt = {version:1,event_id:args.p_event_id,event_type:args.p_event_type,object_id:args.p_object_id,payload_hash:args.p_payload_hash,status:deferred?'deferred':'applied',duplicate:false,profile_id:deferred?null:ids.profile,payment_id:(!deferred&&args.p_checkout?.payment_status==='paid'&&args.p_checkout.amount_total>0)?ids.payment:null,wallet_transaction_id:(!deferred&&args.p_checkout?.referral_code&&args.p_checkout.amount_total>0)?ids.wallet:null};
        return state.reply ? state.reply(receipt,args) : {data:receipt,error:null};
      }})};
      if(request.startsWith('@/')) return load(path.join('src',request.slice(2)+'.ts'));
      return requireTools(request);
    };
    const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
    new Function('require','module','exports',compiled.outputText)(localRequire,mod,mod.exports);
    cache.set(filename,mod.exports);
    return mod.exports;
  }
  const publicPost=load('src/app/api/stripe/webhook/route.ts').POST;
  const internalPost=load('src/app/api/internal/stripe-fulfillment/route.ts').POST;
  function request(internal=false, extras={}) {
    const body=extras.body ?? JSON.stringify(state.event);
    const signature=signer.webhooks.generateTestHeaderString({payload:body,secret});
    const headers={'content-type':'application/json',[internal?'x-stripe-signature':'stripe-signature']:signature,...(internal?{'x-internal-secret':internalSecret}:{}),...extras.headers};
    return new Request('https://fixture.invalid/api/stripe/webhook',{method:'POST',headers,body});
  }
  return {state,calls,request,publicPost,internalPost,load};
}
module.exports={harness,secret,internalSecret,ids,requireStripe,requireTools};
