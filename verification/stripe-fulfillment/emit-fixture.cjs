const {harness,secret,internalSecret}=require('./harness.cjs');
process.env.STRIPE_WEBHOOK_SECRET=secret;
process.env.INTERNAL_WEBHOOK_SECRET=internalSecret;
(async()=>{const h=harness();const response=await h.publicPost(h.request());if(response.status!==200||h.calls.rpc.length!==1)throw new Error('Real handler did not produce a confirmed RPC fixture');process.stdout.write(JSON.stringify(h.calls.rpc[0].args));})().catch(error=>{process.stderr.write(error.message);process.exitCode=1;});
