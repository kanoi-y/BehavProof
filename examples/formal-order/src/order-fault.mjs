// Negative control only: the model and ordinary implementation stay correct.
export {initialize,pay,ship,refund,wait} from './order.mjs';
export function cancel(state){
 if(state.shipped||state.cancelled)throw Error('Cancellation transition unavailable');
 return {...state,cancelled:true,refunds:state.paid?state.refunds+1:0};
}
