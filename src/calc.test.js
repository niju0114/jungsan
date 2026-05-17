import { describe, it, expect } from 'vitest';
import {
  getUserAmount, parseMembers, fcActive, roundIsFeeTier, roundFeeAmounts,
  calcAmounts, calcSurplus, getPayStatus, isEventDone,
} from './calc.js';

// ── getPayStatus (명단 제거 모달 오판 7c3bf01 류) ──
describe('getPayStatus', () => {
  it('없으면 none', () => { expect(getPayStatus(undefined)).toBe('none'); expect(getPayStatus(null)).toBe('none'); });
  it('payStatus 우선', () => { expect(getPayStatus({payStatus:'paid'})).toBe('paid'); expect(getPayStatus({payStatus:'requested'})).toBe('requested'); expect(getPayStatus({payStatus:'rejected'})).toBe('rejected'); });
  it('레거시 paid/requested 플래그', () => { expect(getPayStatus({paid:true})).toBe('paid'); expect(getPayStatus({requested:true})).toBe('requested'); });
  it('payStatus:none 또는 빈 객체 → none', () => { expect(getPayStatus({payStatus:'none'})).toBe('none'); expect(getPayStatus({})).toBe('none'); });
});

// ── parseMembers ──
describe('parseMembers', () => {
  it('이름 학번', () => { expect(parseMembers('홍길동 20231234')).toEqual([{name:'홍길동',sid:'20231234'}]); });
  it('이름만(학번 없는 동명이인 허용)', () => { expect(parseMembers('홍길동\n홍길동')).toEqual([{name:'홍길동',sid:''},{name:'홍길동',sid:''}]); });
  it('탭/쉼표 구분', () => { expect(parseMembers('김철수\t20240001\n이영희,20240002')).toEqual([{name:'김철수',sid:'20240001'},{name:'이영희',sid:'20240002'}]); });
  it('한 줄 이름 2개면 sid 무시', () => { expect(parseMembers('홍길동 김철수 20231234')).toEqual([{name:'홍길동',sid:''},{name:'김철수',sid:''}]); });
  it('같은 이름_학번 키 중복 제거', () => { expect(parseMembers('홍길동 20231234\n홍길동 20231234')).toEqual([{name:'홍길동',sid:'20231234'}]); });
});

// ── getUserAmount (신청폼 학생회비 차등) ──
describe('getUserAmount', () => {
  const form = { amount:13000, amountPaid:8000, memberList:[
    {name:'납부자',sid:'1',isPaidFee:true}, {name:'미납자',sid:'2',isPaidFee:false}, {name:'동명',sid:'A',isPaidFee:true}, {name:'동명',sid:'B',isPaidFee:false},
  ]};
  it('amountPaid 없으면 항상 amount', () => { expect(getUserAmount({amount:5000,amountPaid:null},'x')).toBe(5000); });
  it('sid 정확 일치 납부자 → amountPaid', () => { expect(getUserAmount(form,'납부자','1')).toBe(8000); });
  it('sid 정확 일치 미납자 → amount', () => { expect(getUserAmount(form,'미납자','2')).toBe(13000); });
  it('이름만, 명단 없음 → amount', () => { expect(getUserAmount(form,'없는사람')).toBe(13000); });
  it('이름만, 전원 납부자 → amountPaid', () => { expect(getUserAmount({...form,memberList:[{name:'A',isPaidFee:true}]},'A')).toBe(8000); });
  it('동명이인 혼합(sid 없음) → 보수적으로 amount', () => { expect(getUserAmount(form,'동명')).toBe(13000); });
});

// ── 학생회비 차등 헬퍼 (방향 C) ──
describe('roundIsFeeTier / roundFeeAmounts / fcActive', () => {
  const fc = { mode:'manual', paidFeeAmount:8000, unpaidFeeAmount:13000 };
  it('fcActive', () => { expect(fcActive(fc)).toBeTruthy(); expect(fcActive(null)).toBeFalsy(); expect(fcActive({paidFeeAmount:0,unpaidFeeAmount:0})).toBeFalsy(); });
  // roundIsFeeTier는 truthy/falsy 반환(앱이 boolean 컨텍스트로 사용) — strict true 아님
  it('레거시 폴백: feeMode 없는 round_1 + fc활성 → feeTier', () => {
    expect(roundIsFeeTier({id:'round_1'}, fc)).toBeTruthy();
    expect(roundIsFeeTier({id:'round_1'}, null)).toBeFalsy();
    expect(roundIsFeeTier({id:'r2'}, fc)).toBeFalsy(); // 비-round_1 레거시 = 1/N
  });
  it('명시 opt-out/in', () => {
    expect(roundIsFeeTier({id:'round_1',feeMode:'split'}, fc)).toBeFalsy(); // round_1도 1/N 가능
    expect(roundIsFeeTier({id:'r2',feeMode:'feeTier'}, fc)).toBeTruthy();   // 2차+ 차등
    expect(roundIsFeeTier({id:'r2',feeMode:'feeTier'}, null)).toBeTruthy();
  });
  it('금액: override 우선, 없으면 전역 폴백', () => {
    expect(roundFeeAmounts({feeMode:'feeTier',paidFeeAmount:5000,unpaidFeeAmount:9000}, fc)).toEqual({paid:5000,unpaid:9000});
    expect(roundFeeAmounts({feeMode:'feeTier'}, fc)).toEqual({paid:8000,unpaid:13000}); // 폴백
    expect(roundFeeAmounts({id:'round_1'}, fc)).toEqual({paid:8000,unpaid:13000});       // 레거시
  });
});

// ── calcAmounts: 레거시 100% 동일 보장 + 다차수 차등 ──
describe('calcAmounts', () => {
  it('순수 1/N 멀티라운드 (feeConfig 없음, 레거시 불변)', () => {
    const ev = {
      members:['A','B','C'], attendance:{A:true,B:true,C:true}, feeConfig:null, paidFeeKeys:[],
      rounds:[ {id:'round_1',amount:30000,members:['A','B','C']}, {id:'r2',amount:10000,members:['A','B']} ],
    };
    // r1: ceil(30000/3)=10000 each; r2: ceil(10000/2)=5000 to A,B
    expect(calcAmounts(ev)).toEqual({A:15000,B:15000,C:10000});
  });
  it('레거시 학생회비(round_1 + feeConfig, feeMode 없음) — 기존 동작 동일', () => {
    const ev = {
      members:['p','u'], attendance:{p:true,u:true},
      feeConfig:{paidFeeAmount:8000,unpaidFeeAmount:13000}, paidFeeKeys:['p'],
      rounds:[ {id:'round_1',amount:0,members:['p','u']} ],
    };
    expect(calcAmounts(ev)).toEqual({p:8000,u:13000});
  });
  it('1차 학생회비 차등 + 2차 1/N', () => {
    const ev = {
      members:['p','u'], attendance:{p:true,u:true},
      feeConfig:{paidFeeAmount:8000,unpaidFeeAmount:13000}, paidFeeKeys:['p'],
      rounds:[ {id:'round_1',amount:0,members:['p','u']}, {id:'r2',amount:20000,members:['p','u']} ],
    };
    // r1 fee: p8000/u13000; r2 1/N: ceil(20000/2)=10000 each
    expect(calcAmounts(ev)).toEqual({p:18000,u:23000});
  });
  it('2차도 차등(전역 폴백) — 1차와 동일 금액', () => {
    const ev = {
      members:['p','u'], attendance:{p:true,u:true},
      feeConfig:{paidFeeAmount:8000,unpaidFeeAmount:13000}, paidFeeKeys:['p'],
      rounds:[ {id:'round_1',amount:0,members:['p','u']}, {id:'r2',feeMode:'feeTier',members:['p','u']} ],
    };
    expect(calcAmounts(ev)).toEqual({p:16000,u:26000});
  });
  it('2차 차등 override — 차수별 다른 금액', () => {
    const ev = {
      members:['p','u'], attendance:{p:true,u:true},
      feeConfig:{paidFeeAmount:8000,unpaidFeeAmount:13000}, paidFeeKeys:['p'],
      rounds:[ {id:'round_1',amount:0,members:['p','u']}, {id:'r2',feeMode:'feeTier',paidFeeAmount:3000,unpaidFeeAmount:5000,members:['p','u']} ],
    };
    expect(calcAmounts(ev)).toEqual({p:11000,u:18000});
  });
  it('불참자(attendance false)는 0/제외', () => {
    const ev = { members:['A','B'], attendance:{A:true,B:false}, feeConfig:null, paidFeeKeys:[],
      rounds:[ {id:'round_1',amount:10000,members:['A']} ] };
    expect(calcAmounts(ev)).toEqual({A:10000});
  });
});

// ── calcSurplus: 1/N 반올림만, fee 차수 제외(보정) ──
describe('calcSurplus', () => {
  it('1/N 반올림 잉여', () => {
    const ev = { members:['A','B','C'], attendance:{A:true,B:true,C:true}, feeConfig:null,
      rounds:[ {id:'round_1',amount:10000,members:['A','B','C']} ] }; // ceil(10000/3)=3334 *3 - 10000 = 2
    expect(calcSurplus(ev)).toBe(2);
  });
  it('학생회비 차등 차수는 잉여 집계 제외', () => {
    const ev = { members:['p','u'], attendance:{p:true,u:true},
      feeConfig:{paidFeeAmount:8000,unpaidFeeAmount:13000},
      rounds:[ {id:'round_1',amount:30000,members:['p','u']} ] }; // round_1 = fee → 제외
    expect(calcSurplus(ev)).toBe(0);
  });
});

// ── isEventDone ──
describe('isEventDone', () => {
  it('참석자 전원 paid면 true', () => {
    expect(isEventDone({members:['A','B'],attendance:{A:true,B:true},payments:{A:{payStatus:'paid'},B:{paid:true}}})).toBe(true);
  });
  it('일부 미납이면 false', () => {
    expect(isEventDone({members:['A','B'],attendance:{A:true,B:true},payments:{A:{payStatus:'paid'}}})).toBe(false);
  });
  it('참석자 0명이면 false', () => {
    expect(isEventDone({members:['A'],attendance:{A:false},payments:{}})).toBe(false);
  });
});
