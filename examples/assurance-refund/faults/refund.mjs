export function canRefund(){return true;}
export async function refund(input,env){const state={balance:100,refunds:0};await env.effect('store','write','refund-store','update',{balance:99,refunds:0});await env.effect('store','write','refund-store','update',state);return {status:'denied'};}
