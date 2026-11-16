export function initial(){return {refunds:0};}export function next(state,action){return action.action==='Refund'?{refunds:1}:state;}
