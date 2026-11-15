export function createDriver(implementation){
 let state;
 return {
  dispatch(action){
   if(action==='init'){state=implementation.initialize();return;}
   const names={Pay:'pay',Ship:'ship',Cancel:'cancel',Refund:'refund',Wait:'wait'};
   const name=Object.hasOwn(names,action)?names[action]:undefined;
   if(!name)throw Error('Unsupported model action: '+action);
   state=implementation[name](state);
  },
  observe(){return {...state,refunds:BigInt(state.refunds)};},
 };
}
