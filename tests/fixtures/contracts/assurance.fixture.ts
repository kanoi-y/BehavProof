import { defineContract, contractTest } from '@behavproof/vitest';
const legacy = defineContract({id:'LEGACY',intent:'safe',risk:'critical',cases:[{id:'one',input:1,expected:2}]});
const adopted = defineContract({id:'ADOPTED',intent:'safe',risk:'critical',cases:[{id:'one',input:1,expected:2}],assurance:{feature:{id:'increment',entrypoints:['increment']},conditions:[{id:'increases',kind:'postcondition',statement:'Increments once',checks:['one'],requiredFaults:[]}],checks:[{id:'one',method:'example',targetRef:'increment.ts#run',cases:[{id:'one',input:1,expected:2}]}]}});
const formal = defineContract({id:'FORMAL',kind:'state_machine',intent:'safe',risk:'critical',cases:[{id:'one',input:1,expected:2}],formal:{modelId:'counter',modelHash:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',propertyIds:['increases']}});
const explicit = defineContract({id:'EXPLICIT',kind:'examples',intent:'safe',risk:'critical',cases:[{id:'one',input:1,expected:2}]});
contractTest.each(legacy, ({input}) => input + 1);
contractTest.each(adopted, ({input}) => input + 1);
contractTest.each(formal, ({input}) => input + 1);
contractTest.each(explicit, ({input}) => input + 1);
