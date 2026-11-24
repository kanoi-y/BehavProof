import {expect,test} from 'vitest';
import {readOrder} from '../src/orders.js';

const order={id:'order-1',ownerId:'alice',total:120};
test('the owner can read the order',()=>expect(readOrder('alice',order)).toEqual(order));
test('another user cannot read the order',()=>expect(readOrder('bob',order)).toBeNull());
