export function advance(state,action){return action==='Refund'&&state.refunds===0?{refunds:1}:state;}
export function run(input,env){env.dependencies.state=advance(env.dependencies.state,input.action);return env.dependencies.state;}
export function observe(deps){return deps.state;}
