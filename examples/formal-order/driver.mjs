export function createDriver(implementation){
 let state;
 return {
  dispatch(action){
   if(action==='init'){state=implementation.initialize();return 'allowed';}
   const names={Pay:'pay',Ship:'ship',TryShipUnpaid:'ship',Cancel:'cancel',Refund:'refund',Wait:'wait'};
   const name=Object.hasOwn(names,action)?names[action]:undefined;
   if(!name)throw Error('Unsupported model action: '+action);
   try{
    state=implementation[name](state);
    return 'allowed';
   }catch(error){
    if(name==='ship'&&error?.code==='SHIP_NOT_AVAILABLE')return 'rejected';
    throw error;
   }
  },
  observe(){return {...state,refunds:BigInt(state.refunds)};},
 };
}
