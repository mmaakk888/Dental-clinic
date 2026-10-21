import test from 'node:test';
import assert from 'node:assert/strict';
import {patientReceiptTimeline,patientSessionTimeline} from './patientTimeline';
import {getPatientFinancialSummary,sumFinancialAmounts} from './financials';
import type {Patient,Session} from '../types';
const session=(id:string,date:string,extra:Partial<Session>={}):Session=>({id,date,type:'خدمة مصطنعة',amount:100,discount:0,paid:0,paymentsLog:[],...extra} as Session);
const patient=(sessions:Session[],payments:Patient['payments']=[]):Patient=>({id:'1',name:'مصطنع',sessions,payments} as Patient);
test('session numbers remain chronological across reversed input, search and display order',()=>{
 const a=session('a','2026-10-20'),b=session('b','2026-10-21'),c=session('c','2026-10-21',{createdAt:'2026-10-21T10:00:00Z'}),input=[c,a,b];
 const rows=patientSessionTimeline(input);assert.deepEqual(rows.map(r=>[r.session.id,r.number]),[['a',1],['b',2],['c',3]]);
 assert.deepEqual(patientSessionTimeline([...input].reverse()),rows);assert.equal(rows.filter(r=>r.session.id==='c')[0].number,3);assert.deepEqual(input,[c,a,b]);
});
test('all active cash appears once and general receipts are never relabelled as service cash',()=>{
 const s=session('s','2026-10-20',{amount:500,paymentsLog:[{id:'r1',date:'2026-10-20',amount:100,createdAt:'2026-10-20T10:00:00Z'},{id:'r2',date:'2026-10-21',amount:50,voidedAt:'2026-10-21T11:00:00Z'}],legacyOpeningPaid:25});
 const p=patient([s],[{id:'general',amount:40,date:'2026-10-21',createdAt:'2026-10-21T12:00:00Z'},{id:'r1',amount:100,date:'2026-10-20'},{id:'void-general',amount:20,date:'2026-10-21',voidedAt:'2026-10-21T12:30:00Z'}]);
 const rows=patientReceiptTimeline(p);assert.equal(rows.filter(r=>r.id==='r1').length,1);assert.equal(rows.find(r=>r.id==='general')?.scope,'account');assert.equal(rows.filter(r=>r.voided).length,2);
 assert.equal(sumFinancialAmounts(rows.filter(r=>!r.voided).map(r=>r.amount)),getPatientFinancialSummary(p).totalCollected);assert.equal(getPatientFinancialSummary(p).totalRemaining,335);
});
test('historical paid-only sessions and empty patient preserve exact zero and opening cash',()=>{
 const p=patient([session('old','2026-10-19',{paid:60,payDate:'2026-10-20'})]);const rows=patientReceiptTimeline(p);assert.equal(rows.length,1);assert.equal(rows[0].historical,true);assert.equal(rows[0].date,'2026-10-20');assert.equal(rows[0].amount,60);
 assert.deepEqual(patientReceiptTimeline(patient([])),[]);assert.deepEqual(patientSessionTimeline([]),[]);assert.equal(getPatientFinancialSummary(patient([])).totalCollected,0);
});
test('receipt list does not double count historical general mirrors',()=>{
 const p=patient([session('s','2026-10-20',{paymentsLog:[{id:'old-direct',date:'2026-10-20',amount:30}]})],[{id:'mirror',date:'2026-10-20',amount:30}]);
 assert.equal(patientReceiptTimeline(p).length,1);assert.equal(getPatientFinancialSummary(p).totalCollected,30);
});
