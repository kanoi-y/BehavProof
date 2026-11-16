import {read} from '../boundaries/store.mjs';
export function canRefund(input){return input.owner===true&&Number.isSafeInteger(input.amount)&&input.amount>0&&input.amount<=input.balance;}
export async function refund(input,env){if(!canRefund(input))return {status:'denied'};const state=read(null,env.dependencies);await env.effect('store','write','refund-store','update',{...state,balance:state.balance-input.amount});return {status:'allowed'};}
