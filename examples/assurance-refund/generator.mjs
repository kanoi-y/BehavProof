export function generate({index,random}){return {owner:index%2===1,amount:index===0?0:1+Math.floor(random()*110),balance:100};}
export function classify(input){return [input.owner?'owner':'non-owner',input.amount===0?'zero':input.amount>input.balance?'over-limit':'in-range'];}
export function generateTrace(){return {initial:{refunds:0},actions:[{action:'Refund',input:null},{action:'Refund',input:null},{action:'Wait',input:null}]};}
