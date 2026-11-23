import {expect,test} from 'vitest';
import {createOrderGetHandler} from '../src/order-route.js';
const cases=[
  {id:'no-session',input:{session:null,order:{id:'o1',ownerId:'alice',total:120}},expected:{status:401,body:{error:'unauthorized'}}},
  {id:'other-owner',input:{session:{userId:'bob'},order:{id:'o1',ownerId:'alice',total:120}},expected:{status:403,body:{error:'forbidden'}}},
  {id:'owner',input:{session:{userId:'alice'},order:{id:'o1',ownerId:'alice',total:120}},expected:{status:200,body:{id:'o1',total:120}}},
  {id:'missing-order',input:{session:{userId:'alice'},order:null},expected:{status:404,body:{error:'not_found'}}},
 ];
test.each(cases)('$id',async({input,expected})=>{
 const GET=createOrderGetHandler({session:async()=>input.session,findOrder:async()=>{if(!input.session)throw Error('Unauthenticated requests must not read the order store');return input.order??undefined;}});
 const response=await GET(new Request('https://example.test/api/orders/o1'),{params:Promise.resolve({id:'o1'})});
 expect({status:response.status,body:await response.json()}).toEqual(expected);
});
