import{it,expect}from'vitest';
import{parseConfig}from'../../packages/core/src/index.js';
import{testReportSelection}from'../../packages/cli/src/test-selection.js';
it('selects native Jest reports distinctly and leaves legacy Vitest defaults unchanged',()=>{
 expect(testReportSelection(parseConfig({schemaVersion:2,reports:{jest:'jest.json'}}))).toMatchObject({kind:'jest',reportRef:'jest.json',policyChanged:false,ambiguous:false});
 expect(testReportSelection(parseConfig({schemaVersion:2,reports:{vitest:'vitest.json'}}))).toMatchObject({kind:'vitest',reportRef:'vitest.json',policyChanged:false,ambiguous:false});
 expect(testReportSelection(parseConfig({schemaVersion:2,reports:{vitest:'v.json',jest:'j.json'}})).ambiguous).toBe(true);
});
it('retains host-captured paths instead of letting candidate reports redirect authority',()=>{
 const protectedConfig=parseConfig({schemaVersion:2,testRunner:'jest',reports:{jest:'.behavproof/collected/run/jest.json'}});
 const current=parseConfig({schemaVersion:2,testRunner:'jest',reports:{jest:'.behavproof/untrusted.json'}});
 expect(testReportSelection(current,protectedConfig,{kind:'jest'})).toMatchObject({kind:'jest',reportRef:protectedConfig.reports.jest,policyChanged:false});
 expect(testReportSelection(parseConfig({schemaVersion:2,testRunner:'vitest',reports:{vitest:'v.json'}}),protectedConfig,{kind:'jest'})).toMatchObject({kind:'jest',reportRef:protectedConfig.reports.jest,policyChanged:true});
 expect(testReportSelection(parseConfig({schemaVersion:2,reports:{jest:'j.json'}}),protectedConfig,{kind:'jest'}).policyChanged).toBe(true);
});
it('permits host publication paths to differ from the source configuration without weakening old flows',()=>{
 const current=parseConfig({schemaVersion:2,reports:{}}),protectedConfig=parseConfig({schemaVersion:2,reports:{vitest:'.behavproof/captured.json'}});
 expect(testReportSelection(current,protectedConfig)).toMatchObject({kind:'vitest',reportRef:'.behavproof/captured.json',policyChanged:false});
});
