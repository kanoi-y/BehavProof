export function test(input,actual){return actual===(input.owner===true&&Number.isSafeInteger(input.amount)&&input.amount>0&&input.amount<=input.balance);}
