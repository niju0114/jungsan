// ═══════════════════════════════════════════════════════════
// 순수 함수 (정산 계산·파싱·상태) — 사이드이펙트 없음, 테스트 대상
// main.jsx에서 import. 빌드는 vite가 단일 번들로 묶으므로 배포 산출물 동일.
// ※ 동작 변경 금지: 여기 로직 수정 시 calc.test.js BEFORE/AFTER 회귀 필수.
// ═══════════════════════════════════════════════════════════

export const getUserAmount = (form, subName, subSid) => {
  if(!form.amountPaid) return form.amount;
  const memberList=form.memberList||[];
  if(subSid){
    const exact=memberList.find(m=>m.name===subName&&m.sid===subSid);
    if(exact) return exact.isPaidFee?form.amountPaid:form.amount;
  }
  const matches=memberList.filter(m=>m.name===subName);
  if(!matches.length) return form.amount;
  if(matches.every(m=>m.isPaidFee)) return form.amountPaid;
  return form.amount;
};

// 명단 파싱
export const parseMembers = text => {
  const lines=text.split(/\n/).map(l=>l.trim()).filter(Boolean);
  const result=[]; const seen=new Set();
  const isSid=t=>/^\d{4,12}$/.test(t);
  lines.forEach(line=>{
    const tokens=line.split(/[\t,，\s]+/).map(t=>t.trim()).filter(Boolean);
    const names=tokens.filter(t=>!isSid(t));
    const sids=tokens.filter(t=>isSid(t));
    // 이름 1개일 때만 sid 매핑, 이름 2개 이상이면 sid 무시
    names.forEach((name,i)=>{
      const sid=names.length===1?(sids[0]||''):'';
      if(sid){
        const key=name+`_${sid}`;
        if(!seen.has(key)){seen.add(key);result.push({name,sid});}
      } else {
        result.push({name,sid:''}); // 학번 없는 동명이인 허용
      }
    });
  });
  return result;
};

// ── 학생회비 차등 (방향 C: 차수별 feeMode + 전역 feeConfig 폴백) ──
// fc 활성 = 전역 학생회비 금액이 의미있게 설정됨
export const fcActive = fc => fc?.paidFeeAmount!=null && (fc.paidFeeAmount||fc.unpaidFeeAmount);
// 차수가 학생회비 차등인지. 레거시 폴백: feeMode 미설정 + round_1 + 전역 feeConfig 활성.
// (feeMode==='split'은 명시적 1/N 옵트아웃 — round_1도 1/N 가능. 레거시엔 feeMode 없어 영향 없음)
export const roundIsFeeTier = (r, fc) =>
  r.feeMode==='feeTier' || (r.feeMode==null && r.id==='round_1' && fcActive(fc));
// 그 차수의 납부자/미납자 금액 — 차수 override 우선, 없으면 전역 feeConfig 폴백
export const roundFeeAmounts = (r, fc) => ({
  paid:   (r.feeMode==='feeTier' && r.paidFeeAmount!=null)   ? r.paidFeeAmount   : (fc?.paidFeeAmount||0),
  unpaid: (r.feeMode==='feeTier' && r.unpaidFeeAmount!=null) ? r.unpaidFeeAmount : (fc?.unpaidFeeAmount||0),
});

export const calcAmounts = ev => {
  const presentMembers=(ev.members||[]).filter(k=>ev.attendance[k]!==false);
  const a={};
  presentMembers.forEach(k=>a[k]=0);
  const fc=ev.feeConfig;
  (ev.rounds||[]).forEach(r=>{
    const feeR=roundIsFeeTier(r,fc);
    if(!feeR&&!r.amount) return;
    const totalCount=(r.members?.length||0)+(r.extraMembers?.length||0)+(r.includeOrganizer===true?1:0);
    if(!totalCount) return;
    if(feeR){
      const {paid:pAmt,unpaid:uAmt}=roundFeeAmounts(r,fc);
      (r.members||[]).forEach(k=>{
        if(a[k]!==undefined)
          a[k]+=(ev.paidFeeKeys||[]).includes(k)?pAmt:uAmt;
      });
    } else {
      const share=Math.ceil(r.amount/totalCount);
      (r.members||[]).forEach(k=>{if(a[k]!==undefined)a[k]+=share;});
    }
  });
  return a;
};
export const calcSurplus = ev => {
  const fc=ev.feeConfig;
  let s=0;
  (ev.rounds||[]).forEach(r=>{
    // 학생회비 차등 차수는 1/N 반올림 잉여가 없으므로 집계 제외(다차수 차등 정확도 보정)
    if(roundIsFeeTier(r,fc)||!r.amount) return;
    const n=(r.members?.length||0)+(r.extraMembers?.length||0)+(r.includeOrganizer===true?1:0);
    if(!n) return;
    s+=Math.ceil(r.amount/n)*n-r.amount;
  });
  return s;
};

// 하위 호환 결제 상태 읽기 (payStatus 신규 / paid+requested 레거시)
export const getPayStatus = (p) => {
  if(!p) return 'none';
  if(p.payStatus) return p.payStatus;
  if(p.paid) return 'paid';
  if(p.requested) return 'requested';
  return 'none';
};
export const isEventDone = ev => {
  const presentMembers=(ev.members||[]).filter(k=>ev.attendance[k]!==false);
  if(presentMembers.length===0) return false;
  return presentMembers.every(k=>getPayStatus(ev.payments?.[k])==='paid');
};
