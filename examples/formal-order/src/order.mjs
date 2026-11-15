export function initialize(){return {paid:false,shipped:false,cancelled:false,refunds:0};}
export function pay(state){
 if(state.paid||state.cancelled)throw Error('Payment transition unavailable');
 return {...state,paid:true};
}
export function ship(state){
 if(!state.paid||state.shipped||state.cancelled||state.refunds!==0)throw Error('Shipping transition unavailable');
 return {...state,shipped:true};
}
export function cancel(state){
 if(state.shipped||state.cancelled)throw Error('Cancellation transition unavailable');
 return {...state,cancelled:true,refunds:state.paid?1:0};
}
export function refund(state){
 if(!state.paid||state.shipped||state.cancelled||state.refunds!==0)throw Error('Refund transition unavailable');
 return {...state,refunds:1};
}
export function wait(state){return {...state};}
