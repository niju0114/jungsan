import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import posthog from 'posthog-js';

if (typeof window !== 'undefined' && import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
  });
}


// ═══════════════════════════════════════════════════════════
// 1. CONFIG — 설정값 (수정 시 여기만 변경)
// ═══════════════════════════════════════════════════════════

// Supabase anon key — 클라이언트 전용, RLS로 보호됨
const SUPA_URL = 'https://jetxfddjunfpykgyurnf.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpldHhmZGRqdW5mcHlrZ3l1cm5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTAwNzMsImV4cCI6MjA5MDg4NjA3M30.Jg9cxDZw_aQ9EDy5bpheT7TEzUo8QZDIk9z5WNHwa1w';
const sb = supabase.createClient(SUPA_URL, SUPA_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' }
});
const ID_DOMAIN = '@jungsan.app';
const DECRYPT_API_URL = import.meta.env.VITE_DECRYPT_API_URL || '';

const C = {
  pageBg:'#F2F3F5', cardBg:'#FFFFFF', inputBg:'#F7F8FA',
  accent:'#6366F1', accentBg:'#EEF0FF', accentDark:'#4F46E5',
  green:'#00C072', greenBg:'#E8FAF0',
  red:'#F04452', redBg:'#FFF0F0',
  orange:'#FF6B2B', orangeBg:'#FFF4EE',
  yellow:'#C57700', yellowBg:'#FFF8DD',
  text:'#191F28', textMid:'#4E5968', textDim:'#8B95A1',
  border:'#E8ECF0', borderStrong:'#E5E8EB',
  shadow:'0 1px 4px rgba(0,0,0,0.06)',
  purple:'#8B5CF6', disabled:'#D1D5DB',
};

// ═══════════════════════════════════════════════════════════
// 2. API LAYER — 모든 DB 호출을 여기서 관리
//    컴포넌트에서 sb.from() 직접 호출하지 않음
// ═══════════════════════════════════════════════════════════

const api = {
  // Auth
  getSession: () => sb.auth.getSession(),
  getUser: () => sb.auth.getUser(),
  signIn: (email, pw) => sb.auth.signInWithPassword({email, password:pw}),
  signUp: (email, pw) => sb.auth.signUp({email, password:pw}),
  signOut: () => sb.auth.signOut(),
  signInWithOAuth: () => sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin}}),
  exchangeCode: (code) => sb.auth.exchangeCodeForSession(code),
  onAuthChange: (cb) => sb.auth.onAuthStateChange(cb),

  // Events
  getEvents: (uid) => sb.from('events').select('*').eq('user_id',uid).order('created_at',{ascending:false}),
  getEventByCode: (code) => sb.from('events').select('*').eq('code',code).single(),
  insertEvent: (row) => sb.from('events').insert(row),
  updateEvent: (code, row) => sb.from('events').update(row).eq('code',code),
  deleteEvent: (code) => sb.from('events').delete().eq('code',code),
  deleteEventsByUser: (uid) => sb.from('events').delete().eq('user_id',uid),

  // Forms
  getForms: async(uid) => {
    try { const r=await sb.from('forms').select('*').eq('user_id',uid).order('created_at',{ascending:false}); return r; }
    catch { return {data:null,error:true}; }
  },
  getFormByCode: (code) => sb.from('forms').select('*').eq('code',code).single(),
  insertForm: (row) => sb.from('forms').insert(row),
  updateForm: (code, row) => sb.from('forms').update(row).eq('code',code),
  deleteForm: (code) => sb.from('forms').delete().eq('code',code),

  // Profiles
  getProfile: (uid) => sb.from('profiles').select('*').eq('id',uid).single(),
  getProfileFields: (uid, fields) => sb.from('profiles').select(fields).eq('id',uid).single(),
  upsertProfile: (data) => sb.from('profiles').upsert(data),
  updateProfile: (uid, data) => sb.from('profiles').update(data).eq('id',uid),
  checkUsername: (username) => sb.from('profiles').select('id').eq('username',username).maybeSingle(),

  // 참여자 전용 RPC (RLS 우회, 지정 필드만 업데이트)
  markEventAttendance: (code, memberKey, present) => sb.rpc('mark_event_attendance',{p_code:code,p_member_key:memberKey,p_present:present}),
  markEventPaid: (code, memberKey, paid) => sb.rpc('mark_event_paid',{p_code:code,p_member_key:memberKey,p_paid:paid}),
  markEventRequested: (code, memberKey) => sb.rpc('mark_event_requested',{p_code:code,p_member_key:memberKey}),
  appendFormSubmission: (code, submission) => sb.rpc('append_form_submission',{p_code:code,p_submission:submission}),
  requestFormPayment: (code, createdAt) => sb.rpc('request_form_payment',{p_code:code,p_created_at:createdAt}),

  // Views (조회수 추적)
  trackView: async(eventCode, formCode, viewerKey) => {
    const sessionKey=`view_tracked_${eventCode||formCode}`;
    if(sessionStorage.getItem(sessionKey)) return;
    try {
      await sb.from('views').insert({event_code:eventCode||null, form_code:formCode||null, viewer_key:viewerKey||null});
      sessionStorage.setItem(sessionKey,'1');
    } catch(e) {}
  },
  getViewCount: async(eventCode, formCode) => {
    try {
      const col = eventCode ? 'event_code' : 'form_code';
      const val = eventCode || formCode;
      const {count} = await sb.from('views').select('*',{count:'exact',head:true}).eq(col,val);
      return count || 0;
    } catch { return 0; }
  },
  getViewers: async(eventCode, formCode) => {
    try {
      const col = eventCode ? 'event_code' : 'form_code';
      const val = eventCode || formCode;
      const {data} = await sb.from('views').select('viewer_key,viewed_at').eq(col,val).order('viewed_at',{ascending:false});
      return data || [];
    } catch { return []; }
  },

  // 회원 탈퇴 (본인 데이터 직접 삭제)
  deleteUserEvents: (uid) => sb.from('events').delete().eq('user_id', uid),
  deleteUserForms: (uid) => sb.from('forms').delete().eq('user_id', uid),
  deleteAuthUser: () => sb.functions.invoke('delete-user'),

  // Realtime
  subscribeEvent: (code, cb) => {
    const ch = sb.channel(`event:${code}`)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'events',filter:`code=eq.${code}`},
        p=>{ if(p.new) cb(p.new); })
      .subscribe();
    return () => sb.removeChannel(ch);
  },
  subscribeForm: (code, cb) => {
    const ch = sb.channel(`form:${code}`)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'forms',filter:`code=eq.${code}`},
        p=>{ if(p.new) cb(p.new); })
      .subscribe();
    return () => sb.removeChannel(ch);
  },
};

// ═══════════════════════════════════════════════════════════
// 3. UTILITIES — 순수 함수 (입력 → 출력, 부작용 없음)
//    테스트 가능, 어디서든 안전하게 호출
// ═══════════════════════════════════════════════════════════

// DB row ↔ App object 변환
const rowToEv = r => ({
  code:r.code, name:r.name, date:r.date, pin:r.pin,
  account:r.account||{}, members:r.members||[],
  memberMap:r.member_map||{}, rounds:r.rounds||[],
  payments:r.payments||{}, attendance:r.attendance||{},
  attendanceOpen:r.attendance_open||false, createdAt:r.created_at,
  time:r.time||null,
  sourceFormCode:r.source_form_code||null,
  feeConfig:r.fee_config||null,
  paidFeeKeys:Array.isArray(r.member_meta?.paidFeeKeys)?r.member_meta.paidFeeKeys:[],
  lastMatchSummary:r.member_meta?.lastMatchSummary||null,
});
const evToRow = (ev, uid) => ({
  code:ev.code, name:ev.name, date:ev.date, time:ev.time||null, pin:ev.pin,
  account:ev.account, members:ev.members, member_map:ev.memberMap,
  rounds:ev.rounds, payments:ev.payments, attendance:ev.attendance,
  attendance_open:ev.attendanceOpen,
  source_form_code:ev.sourceFormCode||null,
  fee_config:ev.feeConfig||null,
  member_meta:{paidFeeKeys:ev.paidFeeKeys||[],lastMatchSummary:ev.lastMatchSummary||null},
  ...(uid?{user_id:uid}:{}),
});
const rowToForm = r => ({
  code:r.code, name:r.name, date:r.date, amount:r.amount||0,
  amountPaid:r.amount_paid||null,
  memberList:r.member_list||[],
  maxPeople:r.max_people||null, account:r.account||{},
  fields:r.fields||[], submissions:r.submissions||[],
  status:r.status||'open', createdAt:r.created_at,
  time:r.time||null, place:r.place||null,
  lastMatchSummary:r.last_match_summary||null,
  noFee:r.no_fee||r.amount===0||false,
});
const formToRow = (f, uid) => ({
  code:f.code, name:f.name, date:f.date, amount:f.amount,
  amount_paid:f.amountPaid||null,
  member_list:f.memberList||null,
  max_people:f.maxPeople, account:f.account, fields:f.fields,
  submissions:f.submissions, status:f.status,
  time:f.time||null, place:f.place||null,
  last_match_summary:f.lastMatchSummary||null,
  no_fee:f.noFee||false,
  ...(uid?{user_id:uid}:{}),
});

// 포매팅
const genCode = () => { const ch='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({length:6},()=>ch[Math.floor(Math.random()*ch.length)]).join(''); };
const fmtTime = iso => { const d=new Date(iso); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
const fmtRelTime = iso => {
  const now=new Date(),d=new Date(iso),diff=now-d;
  if(diff<60000) return '방금 전';
  if(diff<3600000) return `${Math.floor(diff/60000)}분 전`;
  if(diff<86400000) return `${Math.floor(diff/3600000)}시간 전`;
  const ampm=d.getHours()<12?'오전':'오후';
  const h=d.getHours()%12||12;
  return `${d.getMonth()+1}/${d.getDate()} ${ampm} ${h}:${String(d.getMinutes()).padStart(2,'0')}`;
};
const fmtKRW = n => (n||0).toLocaleString('ko-KR')+'원';
const getUserAmount = (form, subName, subSid) => {
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
const buildMemberList = (profile) => {
  const allPaidKeys=new Set((profile?.groups||[]).flatMap(g=>g.paidFeeMembers||[]));
  return (profile?.groups||[]).flatMap(g=>g.members||[]).map(m=>({
    name:m.name, sid:m.sid||'',
    isPaidFee:allPaidKeys.has(m.name+(m.sid?'_'+m.sid:''))
  }));
};
const buildDunningMsg = ({name, eventName, amount, account, link}) =>
  `안녕하세요 ${name}님,\n${eventName} 참가비 ${fmtKRW(amount)} 확인이 안 됐어요.\n${link}`;
const getLink = (params) => `${window.location.origin}${window.location.pathname}?${params}`;

// 클립보드 복사 (11곳 중복 → 1곳으로 통합)
const copyText = async (text) => {
  try { await navigator.clipboard.writeText(text); }
  catch { const el=document.createElement('textarea'); el.value=text; el.style.cssText='position:fixed;opacity:0'; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el); }
};

// 명단 파싱
const parseMembers = text => {
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
const displayName = m => m.sid?`${m.name} (${m.sid})`:m.name;
const FIELD_LABELS={name:'이름',phone:'연락처',grade:'학년',studentId:'학번'};
const fieldLabel = key => FIELD_LABELS[key]||key;

// 송금 딥링크
const BANK_CODES={'카카오뱅크':'090','카카오':'090','국민':'004','국민은행':'004','KB국민':'004','신한':'088','신한은행':'088','우리':'020','우리은행':'020','하나':'081','하나은행':'081','농협':'011','NH농협':'011','기업':'003','IBK기업':'003','SC제일':'023','씨티':'027','대구':'031','부산':'032','경남':'039','광주':'034','전북':'037','제주':'035','수협':'007','새마을금고':'045','새마을':'045','신협':'048','우체국':'071','토스뱅크':'092','토스':'092','케이뱅크':'089','K뱅크':'089'};
const getBankCode = (bank) => BANK_CODES[bank] || BANK_CODES[Object.keys(BANK_CODES).find(k=>bank?.includes(k))] || '';
const getTossLink = (bank, accountNo, amount) => {
  const code = getBankCode(bank);
  if(!code||!accountNo) return null;
  return `supertoss://send?bank=${code}&accountNo=${accountNo.replace(/[^0-9]/g,'')}&amount=${amount||0}`;
};
const getKakaoBankLink = (bank, accountNo, amount) => {
  const code = getBankCode(bank);
  if(!code||!accountNo) return null;
  return `kakaotalk://kakaopay/money/to/bank?bank=${code}&accountNo=${accountNo.replace(/[^0-9]/g,'')}&amount=${amount||0}`;
};

// 카카오톡/시스템 공유 (모바일 Web Share API)
const shareText = async (text) => {
  if(navigator.share){
    try{ await navigator.share({text}); return true; }catch{ return false; }
  }
  return false;
};

// 정산 계산 (순수 함수)
const calcAmounts = ev => {
  const presentMembers=(ev.members||[]).filter(k=>ev.attendance[k]!==false);
  const a={};
  presentMembers.forEach(k=>a[k]=0);
  const fc=ev.feeConfig;
  (ev.rounds||[]).forEach(r=>{
    const isFeeRound=r.id==='round_1'&&fc?.paidFeeAmount!=null&&(fc.paidFeeAmount||fc.unpaidFeeAmount);
    if(!isFeeRound&&!r.amount) return;
    const totalCount=(r.members?.length||0)+(r.extraMembers?.length||0)+(r.includeOrganizer===true?1:0);
    if(!totalCount) return;
    if(isFeeRound){
      (r.members||[]).forEach(k=>{
        if(a[k]!==undefined)
          a[k]+=(ev.paidFeeKeys||[]).includes(k)?(fc.paidFeeAmount||0):(fc.unpaidFeeAmount||0);
      });
    } else {
      const share=Math.ceil(r.amount/totalCount);
      (r.members||[]).forEach(k=>{if(a[k]!==undefined)a[k]+=share;});
    }
  });
  return a;
};
const calcSurplus = ev => {
  let s=0;
  (ev.rounds||[]).forEach(r=>{
    if(!r.amount) return;
    const n=(r.members?.length||0)+(r.extraMembers?.length||0)+(r.includeOrganizer===true?1:0);
    if(!n) return;
    s+=Math.ceil(r.amount/n)*n-r.amount;
  });
  return s;
};
const isEventDone = ev => {
  const presentMembers=(ev.members||[]).filter(k=>ev.attendance[k]!==false);
  if(presentMembers.length===0) return false;
  return presentMembers.every(k=>getPayStatus(ev.payments?.[k])==='paid');
};

const translateAuthError = err => {
  const m=err?.message||'';
  if(m.includes('User already registered')||m.includes('already_registered')) return 'ALREADY_REGISTERED';
  if(m.includes('Invalid login credentials')) return '아이디 또는 비밀번호가 맞지 않아요.';
  if(m.includes('Password should be at least')||m.includes('weak_password')) return '비밀번호는 6자 이상으로 설정해주세요.';
  if(m.includes('rate_limit')||m.includes('too many')) return '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.';
  if(m.includes('signup_disabled')) return '현재 가입이 제한됐어요. 잠시 후 다시 시도해주세요.';
  return '문제가 생겼어요. 잠시 후 다시 시도해주세요.';
};

// P2: 하위 호환 결제 상태 읽기 (payStatus 신규 / paid+requested 레거시)
const getPayStatus = (p) => {
  if(!p) return 'none';
  if(p.payStatus) return p.payStatus;
  if(p.paid) return 'paid';
  if(p.requested) return 'requested';
  return 'none';
};

// 시간순 정렬: paid 내림차순, unpaid는 requestedAt 내림차순 → 이름순
const sortByRequested = (keys, payments, nameOf=k=>k) => {
  const paid=keys.filter(k=>getPayStatus(payments?.[k])==='paid').sort((a,b)=>new Date(payments[b]?.time||0)-new Date(payments[a]?.time||0));
  const unpaid=keys.filter(k=>getPayStatus(payments?.[k])!=='paid').sort((a,b)=>{
    const aT=payments?.[a]?.requestedAt, bT=payments?.[b]?.requestedAt;
    if(aT&&bT) return new Date(bT)-new Date(aT);
    if(aT) return -1;
    if(bT) return 1;
    return nameOf(a).localeCompare(nameOf(b),'ko');
  });
  return[...paid,...unpaid];
};

// 임시 인원 key (roundId + em.id 조합, legacy는 index fallback)
const extraKey = (roundId, em, ei) =>
  `__extra__${roundId}__${em.id || 'legacyidx_'+ei}`;

const decryptExcel = async (data, password) => {
  if(!DECRYPT_API_URL) throw new Error('복호화 서버 설정이 없어요. 비밀번호 없는 파일로 시도하거나 잠시 후 다시 시도해주세요.');
  // 복호화 백엔드(Render)는 유휴 시 콜드스타트로 첫 요청이 실패/지연될 수 있어
  // 타임아웃 + 1회 자동 재시도 (재시도는 더 길게 대기)
  const attempt = async (timeoutMs) => {
    const fd = new FormData();
    fd.append('file', new Blob([data], {type:'application/octet-stream'}), 'file.xlsx');
    fd.append('password', password);
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${DECRYPT_API_URL}/decrypt`, {method:'POST', body:fd, signal:ctrl.signal});
      if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        const e = new Error(err.detail || 'DECRYPT_FAILED');
        e.status = res.status;
        throw e;
      }
      return await res.arrayBuffer();
    } finally { clearTimeout(timer); }
  };
  try {
    return await attempt(20000);
  } catch (e) {
    // 비밀번호 오류는 재시도 무의미 — 즉시 전파
    if (e.status === 400 || e.message === 'WRONG_PASSWORD') throw e;
    return await attempt(45000);
  }
};

// 입금 대조 매칭 엔진 (순수 함수)
const matchEngine = {
  NAME_COLS: ['의뢰인','수취인','입금자','입금자명','보내는분','받는분','거래상대','거래자','보낸이','받는이','이름','거래내용','기재내용','통장표시','비고','내용','메모','적요'],
  AMT_COLS: ['입금','입금액','입금금액','거래금액','금액'],

  normalize: s => (s||'').replace(/[（(][^)）]*[)）]/g,'').replace(/[\s·\-]/g,''),

  compareName(depositor, applicant) {
    const d=this.normalize(depositor), a=this.normalize(applicant);
    if(!d||!a) return 'none';
    if(d===a) return 'exact';
    if(d.includes(a)||a.includes(d)) return 'partial';
    return 'none';
  },

  findCol(headers, candidates) {
    for(const c of candidates){const i=headers.findIndex(h=>h.includes(c));if(i>=0)return i;}return -1;
  },

  parseExcel(arrayBuffer) {
    let wb;
    try {
      wb=XLSX.read(arrayBuffer,{type:'array'});
    } catch(e) {
      if(/password|encrypt|crypt|protected/i.test(e?.message||'')) return {error:'NEEDS_PASSWORD'};
      return {error:'파일을 읽을 수 없어요. .xlsx 또는 .xls 파일인지 확인해주세요.'};
    }
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});

    let headerIdx=-1;
    for(let i=0;i<Math.min(rows.length,15);i++){
      const row=rows[i].map(c=>String(c));
      if(row.some(c=>this.NAME_COLS.some(n=>c.includes(n)))||row.some(c=>this.AMT_COLS.some(n=>c.includes(n)))){headerIdx=i;break;}
    }
    if(headerIdx===-1) return {error:'컬럼 인식 실패'};

    const headers=rows[headerIdx].map(c=>String(c).trim());
    const nameIdx=this.findCol(headers,this.NAME_COLS);
    const amtIdx=this.findCol(headers,this.AMT_COLS);
    if(nameIdx===-1) return {error:'입금자명 컬럼 없음'};

    const deposits=[];
    for(let i=headerIdx+1;i<rows.length;i++){
      const row=rows[i];
      const name=String(row[nameIdx]||'').trim();
      const amt=amtIdx>=0?Number(String(row[amtIdx]).replace(/[^0-9.-]/g,''))||0:0;
      if(name&&amt>0) deposits.push({name,amount:amt,row:i+1,matched:false});
    }
    return {deposits};
  },

  match(deposits, subs, getExpectedAmount) {
    const getAmt=typeof getExpectedAmount==='function'?getExpectedAmount:()=>getExpectedAmount;

    // 이름별 합산: 분할 송금 대응
    const groupMap={};
    deposits.forEach(dep=>{
      const key=this.normalize(dep.name);
      if(!key) return;
      if(!groupMap[key]) groupMap[key]={name:dep.name,totalAmount:0,deposits:[]};
      groupMap[key].totalAmount+=dep.amount;
      groupMap[key].deposits.push(dep);
    });
    const groups=Object.values(groupMap).map(g=>({...g,_matched:false}));

    const dupMap={};
    subs.forEach(s=>{const n=this.normalize(s.name||'');if(!dupMap[n])dupMap[n]=[];dupMap[n].push({name:s.name,studentId:s.studentId||''});});
    const getDups=s=>{const arr=dupMap[this.normalize(s.name||'')];return arr&&arr.length>1?arr:null;};

    const matched=[], partial=[], overpaid=[], unpaid=[], refund=[];
    const subsCopy=subs.map(s=>({...s,_matched:false}));

    const classify=(grp,sub,type)=>{
      const ea=getAmt(sub);
      const diff=grp.totalAmount-ea;
      const entry={sub,deposits:grp.deposits,totalAmount:grp.totalAmount,diff,duplicates:getDups(sub),type};
      if(diff===0) matched.push(entry);
      else if(diff<0) partial.push(entry);
      else overpaid.push(entry);
    };

    // 1차: 이름 정확 매칭
    groups.forEach(grp=>{
      const idx=subsCopy.findIndex(s=>!s._matched&&this.compareName(grp.name,s.name)==='exact');
      if(idx<0) return;
      classify(grp,subsCopy[idx],'exact');
      subsCopy[idx]._matched=true; grp._matched=true;
    });
    // 2차: 이름 부분 매칭
    groups.forEach(grp=>{
      if(grp._matched) return;
      const idx=subsCopy.findIndex(s=>!s._matched&&this.compareName(grp.name,s.name)==='partial');
      if(idx<0) return;
      classify(grp,subsCopy[idx],'partial');
      subsCopy[idx]._matched=true; grp._matched=true;
    });

    subsCopy.filter(s=>!s._matched).forEach(s=>unpaid.push(s));
    groups.filter(g=>!g._matched).forEach(g=>refund.push(...g.deposits));
    // amountMismatch는 partial+overpaid 합산 (하위호환 — VerifyTab)
    const amountMismatch=[...partial,...overpaid].map(e=>({...e,deposit:e.deposits[0]}));
    return {matched,partial,overpaid,amountMismatch,unpaid,refund,totalDeposits:deposits.length};
  },
};

// 법률 텍스트 (AuthScreen 인라인에서 분리)
const LEGAL_TEXTS = {
  terms: (<div>
    <p style={{fontWeight:700,color:'#191F28',marginBottom:8}}>제1조 (목적)</p>
    <p>본 약관은 정산해(이하 "서비스")가 제공하는 모임 정산 관련 서비스의 이용 조건 및 절차, 이용자와 서비스 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>제2조 (서비스의 내용)</p>
    <p>서비스는 모임 참여자 명단 관리, 정산 금액 계산, 입금 현황 확인 등의 기능을 제공합니다. 서비스의 구체적인 내용은 운영 상황에 따라 변경될 수 있습니다.</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>제3조 (이용자의 의무)</p>
    <p>이용자는 서비스 이용 시 타인의 권리를 침해하거나 관련 법령을 위반하는 행위를 해서는 안 됩니다. 허위 정보 입력, 서비스 악용, 부정 접근 시도 등은 금지됩니다.</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>제4조 (서비스의 중단)</p>
    <p>서비스는 시스템 점검, 장비 교체 등 운영상 필요한 경우 서비스의 전부 또는 일부를 제한하거나 중단할 수 있습니다.</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>제5조 (면책)</p>
    <p>서비스는 이용자 간 정산 과정에서 발생하는 금전적 분쟁에 대해 책임을 지지 않습니다. 서비스는 정산 편의 도구를 제공할 뿐, 금전 거래의 당사자가 아닙니다.</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>제6조 (계정 해지)</p>
    <p>이용자는 언제든지 회원 탈퇴를 통해 계정을 해지할 수 있으며, 탈퇴 시 관련 데이터는 즉시 삭제됩니다.</p>
  </div>),
  privacy: (<div>
    <p style={{fontWeight:700,color:'#191F28',marginBottom:8}}>1. 수집하는 개인정보 항목</p>
    <p>필수: 아이디, 비밀번호, 이름, 소속(학교·단체)</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>2. 수집 목적</p>
    <p>서비스 제공 및 운영, 본인 확인, 서비스 개선, 고객 지원</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>3. 보유 및 이용 기간</p>
    <p>회원 탈퇴 시까지 보유하며, 탈퇴 즉시 파기합니다. 단, 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>4. 개인정보의 안전성 확보</p>
    <p>모든 데이터는 암호화된 전송(HTTPS) 및 저장이 적용되며, 접근 권한을 최소화하여 관리합니다.</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>5. 이용자의 권리</p>
    <p>이용자는 언제든 본인의 개인정보를 조회, 수정, 삭제할 수 있으며, 회원 탈퇴를 통해 처리 정지를 요청할 수 있습니다.</p>
  </div>),
  thirdParty: (<div>
    <p style={{fontWeight:700,color:'#191F28',marginBottom:8}}>제3자 정보 제공 안내</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>1. 제공 대상</p>
    <p>Supabase Inc. (데이터베이스 및 인증 서비스 제공)</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>2. 제공 항목</p>
    <p>아이디(이메일 형식), 비밀번호(암호화), 서비스 이용 데이터</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>3. 제공 목적</p>
    <p>회원 인증, 데이터 저장 및 실시간 동기화 서비스 운영</p>
    <p style={{fontWeight:700,color:'#191F28',margin:'12px 0 8px'}}>4. 보유 기간</p>
    <p>회원 탈퇴 시까지이며, 탈퇴 시 즉시 삭제 요청합니다.</p>
  </div>),
  marketing: (<div>
    <p>정산해의 새로운 기능, 유용한 팁, 이벤트 안내 등을 받아보실 수 있습니다. 수신 동의는 언제든지 철회할 수 있습니다.</p>
  </div>),
};

// ═══════════════════════════════════════════════════════════
// 4. UI PRIMITIVES — 공통 컴포넌트
// ═══════════════════════════════════════════════════════════

const Spinner = ({size=20,color='#fff'}) => (
  <div style={{width:size,height:size,border:`2.5px solid ${color}40`,borderTopColor:color,borderRadius:'50%',animation:'spin 0.7s linear infinite',flexShrink:0}}/>
);

const ICONS={
  check:'<path d="M20 6 9 17l-5-5"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  'circle-check':'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-x':'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  'triangle-alert':'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  sparkles:'<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
  'credit-card':'<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  mail:'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  lock:'<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  megaphone:'<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  'message-circle':'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  lightbulb:'<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  wallet:'<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  inbox:'<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'help-circle':'<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  'clipboard-list':'<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  'bar-chart':'<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  calculator:'<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
  'chevron-up':'<path d="m18 15-6-6-6 6"/>',
  'chevron-down':'<path d="m6 9 6 6 6-6"/>',
  frown:'<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
  'book-open':'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  smartphone:'<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  calendar:'<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
  'refresh-cw':'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  pencil:'<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  zap:'<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  'party-popper':'<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
  eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  'list-checks':'<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="m3 12 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  'file-spreadsheet':'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
  'share-2':'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
  receipt:'<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v1.25m0-10v1.25"/>',
  'file-search':'<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><circle cx="5" cy="17" r="3"/><path d="m9 21-1.5-1.5"/>',
  'bell-ring':'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M20 2c1.2 1.7 2 3.7 2 6"/>',
};
const Icon=({n,size=18,color='currentColor',style={}})=>(
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'inline-block',verticalAlign:'middle',flexShrink:0,...style}} dangerouslySetInnerHTML={{__html:ICONS[n]}}/>
);

const Btn = ({children,onClick,variant='primary',style={},disabled=false,small=false,loading=false}) => {
  const v = {
    primary:{background:`linear-gradient(135deg,#6366F1,#4F46E5)`,color:'#fff'},
    secondary:{background:C.cardBg,color:C.textMid,border:`1px solid ${C.borderStrong}`},
    ghost:{background:'transparent',color:C.textDim,border:`1px solid ${C.borderStrong}`},
    green:{background:C.green,color:'#fff'},
    danger:{background:C.red,color:'#fff'},
    orange:{background:C.orange,color:'#fff'},
  };
  return(
    <button className="press" onClick={!disabled&&!loading?onClick:undefined} style={{
      display:'flex',alignItems:'center',justifyContent:'center',gap:8,
      padding:small?'12px 20px':'16px 24px',borderRadius:16,border:'none',
      cursor:disabled||loading?'not-allowed':'pointer',fontSize:small?14:16,fontWeight:700,
      width:'100%',opacity:disabled?0.45:1,transition:'all 0.15s',letterSpacing:-0.3,
      ...v[variant],...style,
    }}>
      {loading?<Spinner/>:children}
    </button>
  );
};

const Field = ({label,value,onChange,placeholder,type='text',maxLength,inputMode,multiline,rows=3,hint,onEnter}) => (
  <div style={{marginBottom:14}}>
    {label&&<div style={{fontSize:12,color:C.textMid,marginBottom:7,fontWeight:700,letterSpacing:0.3}}>{label}</div>}
    {multiline?(
      <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows}
        style={{width:'100%',padding:'12px 14px',background:C.inputBg,border:`1.5px solid ${C.border}`,borderRadius:12,color:C.text,fontSize:14,outline:'none',resize:'vertical',lineHeight:1.75,transition:'border 0.15s'}}
        onFocus={e=>e.target.style.border=`1.5px solid ${C.accent}`}
        onBlur={e=>e.target.style.border=`1.5px solid ${C.border}`}
      />
    ):(
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        maxLength={maxLength} inputMode={inputMode}
        onKeyDown={e=>e.key==='Enter'&&onEnter&&onEnter()}
        style={{width:'100%',padding:'12px 14px',background:C.inputBg,border:`1.5px solid ${C.border}`,borderRadius:12,color:C.text,fontSize:15,outline:'none',transition:'border 0.15s'}}
        onFocus={e=>e.target.style.border=`1.5px solid ${C.accent}`}
        onBlur={e=>e.target.style.border=`1.5px solid ${C.border}`}
      />
    )}
    {hint&&<div style={{fontSize:11,color:C.textDim,marginTop:5}}>{hint}</div>}
  </div>
);

const Header = ({title,onBack,right}) => (
  <div style={{display:'flex',alignItems:'center',padding:'16px 20px',gap:12,position:'sticky',top:0,background:C.pageBg,zIndex:10}}>
    {onBack&&<button onClick={onBack} style={{background:'transparent',border:'none',color:C.text,cursor:'pointer',width:40,height:40,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,padding:0,margin:'-8px'}}><span className="ms" style={{fontSize:24}}>arrow_back</span></button>}
    <div style={{flex:1,fontSize:18,fontWeight:800,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',letterSpacing:-0.5}}>{title}</div>
    {right}
  </div>
);

const Card = ({children,style={}}) => (
  <div style={{background:C.cardBg,borderRadius:20,padding:'20px 20px',marginBottom:12,...style}}>{children}</div>
);

const Badge = ({children,color=C.accent}) => (
  <span style={{display:'inline-flex',alignItems:'center',padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:700,background:color+'18',color,border:`1px solid ${color}30`}}>{children}</span>
);

const Toast = ({msg,color=C.green}) => msg?(
  <div style={{position:'fixed',bottom:32,left:'50%',transform:'translateX(-50%)',background:color,color:'#fff',padding:'11px 22px',borderRadius:40,fontSize:13,fontWeight:700,zIndex:999,boxShadow:'0 4px 20px rgba(0,0,0,0.2)',whiteSpace:'nowrap',animation:'fadeUp 0.2s ease'}}>
    {msg}
  </div>
):null;

const SelectGrid = ({options,value,onChange}) => (
  <div style={{display:'flex',flexWrap:'wrap',gap:7,marginBottom:4}}>
    {options.map(o=>(
      <button key={o} onClick={()=>onChange(o)} className="press" style={{
        padding:'9px 14px',borderRadius:20,border:`2px solid ${value===o?C.accent:C.border}`,
        background:value===o?C.accentBg:C.cardBg,color:value===o?C.accent:C.textMid,
        fontSize:12,fontWeight:600,cursor:'pointer',transition:'all 0.12s',
      }}>{o}</button>
    ))}
  </div>
);

const FlowStepper = ({steps, current, done=[], onStepClick}) => (
  <div style={{background:C.cardBg,padding:'14px 18px 0',borderBottom:`1px solid ${C.border}`}}>
    <div style={{display:'flex',alignItems:'flex-start',gap:0}}>
      {steps.map((label,i)=>{
        const isActive=current===i;
        const isDone=done[i];
        return(
          <React.Fragment key={i}>
            <button onClick={onStepClick?()=>onStepClick(i):undefined} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:5,flex:1,background:'none',border:'none',cursor:onStepClick?'pointer':'default',paddingBottom:12}}>
              <div style={{width:26,height:26,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',background:isDone?C.green:isActive?C.accent:C.border,color:'#fff',fontSize:11,fontWeight:900,transition:'all 0.3s'}}>
                {isDone?<Icon n="check" size={11} color="#fff"/>:i+1}
              </div>
              <div style={{fontSize:10,fontWeight:isActive?700:400,color:isDone?C.green:isActive?C.accent:C.textDim,transition:'all 0.3s',whiteSpace:'nowrap'}}>{label}</div>
            </button>
            {i<steps.length-1&&<div style={{height:2,flex:2,background:isDone?C.green:C.border,marginTop:12,transition:'all 0.3s'}}/>}
          </React.Fragment>
        );
      })}
    </div>
  </div>
);

const Modal = ({isOpen, onClose, title, maxWidth=440, closeOnBackdrop=true, showCloseButton=true, zIndex=200, footer, children}) => {
  useEffect(()=>{
    if(!isOpen) return;
    const h=e=>{if(e.key==='Escape')onClose?.();};
    document.addEventListener('keydown',h);
    return()=>document.removeEventListener('keydown',h);
  },[isOpen,onClose]);
  useEffect(()=>{
    document.body.style.overflow=isOpen?'hidden':'';
    return()=>{document.body.style.overflow='';};
  },[isOpen]);
  if(!isOpen) return null;
  const hasHeader=title||showCloseButton;
  return createPortal(
    <div onClick={closeOnBackdrop?onClose:undefined} style={{position:'fixed',inset:0,background:'rgba(17,24,39,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex,backdropFilter:'blur(4px)',padding:'0 20px'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.cardBg,borderRadius:24,width:'100%',maxWidth,maxHeight:'calc(100dvh - 64px)',display:'flex',flexDirection:'column',animation:'scaleIn 0.18s ease',boxShadow:'0 4px 24px rgba(0,0,0,0.12)'}}>
        {hasHeader&&(
          <div style={{padding:'18px 20px 14px',display:'flex',alignItems:'center',justifyContent:title?'space-between':'flex-end',borderBottom:title?`1px solid ${C.border}`:'none',flexShrink:0}}>
            {title&&<div style={{fontWeight:900,color:C.text,fontSize:17}}>{title}</div>}
            {showCloseButton&&<button onClick={onClose} style={{background:C.inputBg,border:'none',borderRadius:10,width:32,height:32,cursor:'pointer',color:C.textMid,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon n="x" size={14} color={C.textMid}/></button>}
          </div>
        )}
        <div style={{overflowY:'auto',flex:1,padding:'20px 24px'}}>
          {children}
        </div>
        {footer&&<div style={{padding:'0 24px 20px',flexShrink:0}}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
};

const ConfirmBulkModal = ({isOpen, onClose, count, onConfirm}) => (
  <Modal isOpen={isOpen} onClose={onClose} showCloseButton={false} maxWidth={360}>
    <div style={{textAlign:'center',marginBottom:20}}>
      <div style={{width:56,height:56,borderRadius:28,background:C.green+'20',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px'}}><Icon n="circle-check" size={28} color={C.green}/></div>
      <div style={{fontWeight:900,color:C.text,fontSize:17,marginBottom:4}}>입금 확인 필요 {count}명,{'\n'}모두 확인 처리할까요?</div>
      <div style={{fontSize:12,color:C.textDim}}>거래내역 대조 후 일괄 확인에 사용하세요</div>
    </div>
    <div style={{display:'flex',gap:10}}>
      <Btn variant="ghost" onClick={onClose} style={{flex:1}}>취소</Btn>
      <Btn variant="green" onClick={()=>{onConfirm();onClose();}} style={{flex:2}}>확인 완료 처리</Btn>
    </div>
  </Modal>
);

const ExcelPasswordModal = ({isOpen, onClose, onSubmit, loading}) => {
  const [pwd, setPwd] = useState('');
  useEffect(()=>{if(!isOpen) setPwd('');},[isOpen]);
  const submit = () => { if(pwd) onSubmit(pwd); };
  return (
    <Modal isOpen={isOpen} onClose={loading?undefined:onClose} showCloseButton={!loading} maxWidth={360} closeOnBackdrop={!loading}>
      <div style={{textAlign:'center',marginBottom:20}}>
        <div style={{width:56,height:56,borderRadius:28,background:C.accent+'20',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px'}}><Icon n="lock" size={28} color={C.accent}/></div>
        <div style={{fontWeight:900,color:C.text,fontSize:17,marginBottom:4}}>거래내역서 비밀번호 입력</div>
        <div style={{fontSize:12,color:C.textDim,marginBottom:14}}>보통 생년월일 6자리예요<br/><span style={{fontSize:11}}>예) 990101</span></div>
        <div style={{fontSize:11,color:C.textMid,background:C.accentBg,borderRadius:8,padding:'6px 10px',display:'flex',alignItems:'center',gap:4}}><Icon n="lock" size={11} color={C.accent}/><span>비밀번호는 복호화 후 즉시 삭제됩니다</span></div>
      </div>
      <input
        type="password" value={pwd} onChange={e=>setPwd(e.target.value)}
        onKeyDown={e=>e.key==='Enter'&&submit()} placeholder="비밀번호" autoFocus
        style={{width:'100%',padding:'14px',background:C.inputBg,border:`1.5px solid ${C.border}`,borderRadius:12,fontSize:15,color:C.text,outline:'none',boxSizing:'border-box',marginBottom:14}}
        onFocus={e=>e.target.style.border=`1.5px solid ${C.accent}`}
        onBlur={e=>e.target.style.border=`1.5px solid ${C.border}`}
      />
      <div style={{display:'flex',gap:10}}>
        <Btn variant="ghost" onClick={onClose} disabled={loading} style={{flex:1}}>취소</Btn>
        <Btn onClick={submit} loading={loading} disabled={!pwd} style={{flex:2}}>확인</Btn>
      </div>
    </Modal>
  );
};

// Realtime hook
function useRealtimeEvent(code, onUpdate) {
  useEffect(()=>{
    if(!code) return;
    return api.subscribeEvent(code, raw => onUpdate(rowToEv(raw)));
  },[code]);
}

function useRealtimeForm(code, onUpdate, enabled=true) {
  useEffect(()=>{
    if(!code||!enabled) return;
    return api.subscribeForm(code, raw => onUpdate(rowToForm(raw)));
  },[code,enabled]);
}

// ═══════════════════════════════════════════════════════════
// 7. SCREENS — 화면 컴포넌트
// ═══════════════════════════════════════════════════════════

// ── ErrorBoundary ──────────────────────────────────────────
// 렌더 예외가 전체 트리를 빈 화면으로 만들지 않도록 차단 + 운영 로깅
class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state={error:null}; }
  static getDerivedStateFromError(error){ return {error}; }
  componentDidCatch(error, info){
    try {
      console.error('[ErrorBoundary]', error, info?.componentStack);
      posthog.capture('error_boundary', {
        message:String(error?.message||error),
        stack:String(error?.stack||'').slice(0,2000),
        componentStack:String(info?.componentStack||'').slice(0,2000),
      });
    } catch(_){}
  }
  render(){
    if(this.state.error){
      return (
        <div className="screen" style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#fff',padding:'40px 28px',textAlign:'center',gap:14}}>
          <div style={{width:64,height:64,borderRadius:32,background:'#FFF0F0',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Icon n="triangle-alert" size={32} color="#F04452"/>
          </div>
          <div style={{fontSize:20,fontWeight:900,color:'#191F28'}}>일시적인 문제가 발생했어요</div>
          <div style={{fontSize:14,color:'#4E5968',lineHeight:1.7}}>입력하신 내용은 대부분 자동 저장돼요.<br/>새로고침하면 이어서 사용할 수 있어요.</div>
          <button onClick={()=>window.location.reload()} style={{marginTop:8,padding:'14px 28px',borderRadius:14,border:'none',background:'linear-gradient(135deg,#6366F1,#4F46E5)',color:'#fff',fontWeight:700,fontSize:15,cursor:'pointer'}}>새로고침</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── App ────────────────────────────────────────────────────
function App() {
  const [ready,setReady]=useState(false);
  const [user,setUser]=useState(null);
  const [profile,setProfile]=useState({id:null,account:{bank:'',number:'',holder:''},groups:[],name:''});
  const [events,setEvents]=useState([]);
  const [forms,setForms]=useState([]);
  const [view,setView]=useState('home');
  const [currentCode,setCurrentCode]=useState('');
  const [currentFormCode,setCurrentFormCode]=useState('');
  const [participantKey,setParticipantKey]=useState('');
  const [toast,setToast]=useState(null);
  const [showGuide,setShowGuide]=useState(false);
  const [showOnboarding,setShowOnboarding]=useState(false);
  const [showFeedback,setShowFeedback]=useState(false);

  const showToast=(msg,color=C.green)=>{setToast({msg,color});setTimeout(()=>setToast(null),2500);};

  useEffect(()=>{
    const urlParams=new URLSearchParams(window.location.search);
    const urlCode=urlParams.get('code');
    const urlForm=urlParams.get('form');
    // PKCE 콜백 code는 UUID(하이픈 포함), 이벤트 코드는 6자 대문자 영숫자 — 하이픈 유무로 구별
    const isOAuthCallback=!!urlCode&&urlCode.includes('-');
    console.log('[Auth] init | code:',urlCode,'isOAuth:',isOAuthCallback);
    // OAuth 콜백 URL 즉시 정리
    if(isOAuthCallback) window.history.replaceState({},'',window.location.pathname);
    // 참여자 경로에서는 form/event 로딩 완료 전까지 setReady 차단 (로그인 화면 깜빡임 방지)
    const isParticipantPath=!!(!isOAuthCallback&&urlCode||urlForm);

    const {data:{subscription}}=api.onAuthChange((_evt,session)=>{
      console.log('[Auth] event:',_evt,'uid:',session?.user?.id,'isOAuth:',isOAuthCallback);
      if(!session){
        // OAuth 콜백 중 INITIAL_SESSION null은 PKCE 교환 대기 상태 — ready 설정 보류
        if(isOAuthCallback&&_evt==='INITIAL_SESSION') return;
        setUser(null);setEvents([]);setForms([]);
        setProfile({id:null,account:{bank:'',number:'',holder:''},groups:[],name:''});
        // 참여자 화면이면 유지
        setView(v=>['participantEvent','formSubmit'].includes(v)?v:'home');
        // 참여자 경로면 form/event 로딩이 setReady 담당
        if(!isParticipantPath) setReady(true);
        return;
      }
      // onboarding 체크 — 참여자 화면이면 표시 안 함
      if(_evt==='SIGNED_IN'||_evt==='INITIAL_SESSION'){
        const isParticipantView=['participantEvent','formSubmit'];
        if(!isParticipantView.some(v2=>view===v2||urlCode||urlForm)){
          api.getProfileFields(session.user.id,'onboarding_done').then(({data})=>{
            if(localStorage.getItem('onboarding_done_'+session.user.id)==='true') return;
            if(data?.onboarding_done===true) return;
            setShowOnboarding(true);
          });
        }
      }
      loadUserData(session.user.id);
    });

    // 신청폼 URL 처리
    if(urlForm){
      const code=urlForm.toUpperCase();
      window.history.replaceState({},'',window.location.pathname);
      api.getFormByCode(code).then(({data,error})=>{
        if(data&&!error){setForms([rowToForm(data)]);setCurrentFormCode(code);setView('formSubmit');}
        else setView('notFound');
        setReady(true);
      }).catch(()=>{setView('notFound');setReady(true);});
      return()=>subscription.unsubscribe();
    }

    if(urlCode&&!isOAuthCallback){
      const code=urlCode.toUpperCase();
      const urlKey=urlParams.get('k')||'';
      window.history.replaceState({},'',window.location.pathname);
      api.getEventByCode(code).then(({data})=>{
        if(data){
          setEvents([rowToEv(data)]);setCurrentCode(code);
          if(urlKey) setParticipantKey(decodeURIComponent(urlKey));
          setView('participantEvent');
        } else setView('notFound');
        setReady(true);
      }).catch(()=>{setView('notFound');setReady(true);});
      return()=>subscription.unsubscribe();
    }

    if(isOAuthCallback){
      // SIGNED_IN이 자동으로 loadUserData를 호출하므로 여기선 교환만 트리거
      api.exchangeCode(urlCode).then(({error})=>{
        if(error){console.error('[OAuth] exchange failed:',error?.message);setUser(null);setReady(true);}
      }).catch(e=>{console.error('[OAuth] exchange threw:',e);setUser(null);setReady(true);});
      return()=>subscription.unsubscribe();
    }

    api.getSession().then(({data:{session}})=>{
      if(!session&&!isParticipantPath){setUser(null);setReady(true);}
    });

    return()=>subscription.unsubscribe();
  },[]);

  const loadUserData=async(uid)=>{
    console.log('[loadUserData] uid:',uid);
    const [{data:evData},{data:profData}]=await Promise.all([
      api.getEvents(uid),
      api.getProfile(uid),
    ]);
    // 탈퇴 계정 차단 (email 로그인뿐 아니라 Google OAuth도 동일하게 적용)
    if(profData?.deleted){
      await api.signOut();
      setUser(null);setEvents([]);setForms([]);
      setProfile({id:null,account:{bank:'',number:'',holder:''},groups:[],name:''});
      setReady(true);
      return;
    }
    const formRes=await api.getForms(uid);
    const formData=formRes.data;
    const {data:{user:u}}=await api.getUser();
    setUser(u||null);
    if(evData) setEvents(evData.map(rowToEv));
    if(formData) setForms(formData.map(rowToForm));
    const googleName=u?.user_metadata?.full_name||'';
    let resolvedProf=profData;
    if(!profData&&u?.id){
      // 최초 Google OAuth 로그인 — profiles 행 자동 생성
      try{await api.upsertProfile({id:u.id,name:googleName,updated_at:new Date().toISOString()});}catch(e){}
      const {data:newProf}=await api.getProfile(u.id);
      if(!newProf){
        // upsert 후에도 프로필을 읽을 수 없음 → RLS가 탈퇴 계정을 차단 중
        await api.signOut();
        setUser(null);setEvents([]);setForms([]);
        setProfile({id:null,account:{bank:'',number:'',holder:''},groups:[],name:''});
        setReady(true);
        return;
      }
      resolvedProf=newProf;
    } else if(profData&&!profData.name&&googleName&&u?.id){
      try{await api.updateProfile(u.id,{name:googleName});}catch(e){}
    }
    if(resolvedProf) setProfile({
      id:resolvedProf.id,
      account:resolvedProf.account||{bank:'',number:'',holder:''},
      groups:resolvedProf.groups||[],
      name:resolvedProf.name||googleName||'',
      school:resolvedProf.school||'',
      department:resolvedProf.department||'',
      role:resolvedProf.role||'',
      phone:resolvedProf.phone||'',
      username:resolvedProf.username||'',
    });
    if(resolvedProf&&u){
      posthog.identify(u.id,{email:u.email,name:resolvedProf.name||googleName||'',school:resolvedProf.school||''});
    }
    console.log('[loadUserData] done | user:',u?.id,'prof:',resolvedProf?.id);
    setReady(true);
    // 참여자/신청폼 화면이면 유지, 나머지는 홈으로 (로그인 후 빈 화면 방지)
    setView(v=>['participantEvent','formSubmit'].includes(v)?v:(!v||v==='auth'||v==='home')?'home':v);
  };

  const saveProfile=async(prof)=>{
    const allPaidKeys=new Set((prof.groups||[]).flatMap(g=>g.paidFeeMembers||[]));
    const syncedEvents=events.map(ev=>({...ev,paidFeeKeys:ev.members.filter(k=>allPaidKeys.has(k))}));
    setEvents(syncedEvents);
    setProfile(prof);
    if(user?.id){
      const {error}=await api.upsertProfile({id:user.id,name:prof.name||'',account:prof.account,groups:prof.groups,school:prof.school||'',updated_at:new Date().toISOString()});
      if(error){showToast('저장 실패',C.red);return;}
      await Promise.all(syncedEvents.map(ev=>api.updateEvent(ev.code,evToRow(ev))));
    }
  };

  const createEvent=async(ev)=>{
    const {error}=await api.insertEvent(evToRow(ev,user.id));
    if(error){showToast('저장 실패: '+error.message,C.red);return false;}
    setEvents(evs=>[ev,...evs]);
    return true;
  };

  const updateEvent=async(ev)=>{
    // 운영 디버깅: 전체행 write가 데이터를 손실시키는지 감지 → PostHog 추적.
    // lost-update/stale 덮어쓰기 의심 신호. (정상 차수삭제·정상 토글은 캡쳐 X)
    try{
      const prev=events.find(e=>e.code===ev.code);
      if(prev){
        const prevRounds=prev.rounds||[], nextRounds=ev.rounds||[];
        const nextIds=new Set(nextRounds.map(r=>r.id));
        // 살아있는(prev·next 모두 존재) 차수만 비교 → 정상 차수삭제는 제외(false positive 가드).
        // 금액 손실: 같은 차수가 before>0 인데 after===0 (삭제가 아니라 "값이 0으로 덮임").
        const lost_amount_rounds=prevRounds
          .filter(p=>nextIds.has(p.id))
          .filter(p=>(p.amount||0)>0 && (nextRounds.find(n=>n.id===p.id)?.amount||0)===0)
          .map(p=>p.id);
        // 키 손실: 정상 토글/확정은 키를 추가/수정만 함 → 키가 사라지면 stale 덮어쓰기 신호.
        const lost_payment_keys=Object.keys(prev.payments||{}).filter(k=>!(k in (ev.payments||{})));
        const lost_attendance_keys=Object.keys(prev.attendance||{}).filter(k=>!(k in (ev.attendance||{})));
        // 트리거: 살아있는 차수의 금액 0 덮임 / 입금키 소실 / 출석키 소실.
        // (차수 개수 감소 단독은 정상 삭제이므로 트리거 아님 — 단 forensics용으로 payload엔 기록)
        if(lost_amount_rounds.length>0||lost_payment_keys.length>0||lost_attendance_keys.length>0){
          const payload={
            code:ev.code,
            user_id:user?.id||null,
            diff:{
              rounds_count_before:prevRounds.length,
              rounds_count_after:nextRounds.length,
              lost_amount_rounds,
              lost_payment_keys,
              lost_attendance_keys,
            },
            trigger:'event_write_anomaly',
          };
          console.warn('[event_write_anomaly]',payload);
          try{posthog.capture('event_write_anomaly',payload);}catch(_){}
        }
      }
    }catch(_){}
    const {error}=await api.updateEvent(ev.code,evToRow(ev));
    if(error){showToast('업데이트 실패',C.red);return;}
    setEvents(evs=>evs.map(e=>e.code===ev.code?ev:e));
  };

  const deleteEvent=async(code)=>{
    const {error}=await api.deleteEvent(code);
    if(error){showToast('삭제 실패',C.red);return;}
    setEvents(evs=>evs.filter(e=>e.code!==code));
  };

  // Form CRUD
  const createForm=async(form)=>{
    const {error}=await api.insertForm(formToRow(form,user.id));
    if(error){
      if(error.message?.includes('schema cache')||error.message?.includes('does not exist'))
        showToast('forms 테이블이 없어요. Supabase에서 SQL을 먼저 실행해주세요.',C.red);
      else showToast('저장 실패: '+error.message,C.red);
      return false;
    }
    setForms(fs=>[form,...fs]);
    return true;
  };

  const updateForm=async(form)=>{
    const {error}=await api.updateForm(form.code,formToRow(form));
    if(error){showToast('업데이트 실패: '+error.message,C.red);return;}
    setForms(fs=>fs.map(f=>f.code===form.code?form:f));
  };

  const deleteForm=async(code)=>{
    const {error}=await api.deleteForm(code);
    if(error){showToast('삭제 실패',C.red);return;}
    setForms(fs=>fs.filter(f=>f.code!==code));
  };

  const nav={setView,setCurrentCode,setCurrentFormCode,setParticipantKey,showToast,loadUserData};
  const currentEvent=events.find(e=>e.code===currentCode);

  if(!ready) return(
    <div className="screen" style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#fff',gap:12}}>
      <svg viewBox="0 0 200 200" style={{width:48,height:48,marginBottom:4}}>
        <defs><clipPath id="f1-load"><circle cx="100" cy="100" r="100"/></clipPath></defs>
        <g clipPath="url(#f1-load)">
          <rect width="200" height="200" fill="#6366F1"/>
          <polygon points="0,200 200,0 200,200" fill="#A5A6F6"/>
        </g>
      </svg>
      <div style={{fontSize:22,fontWeight:900,color:C.text,letterSpacing:-0.5}}>정산해</div>
      <div style={{marginTop:8}}><Spinner size={24} color={C.accent}/></div>
    </div>
  );

  const currentForm=forms.find(f=>f.code===currentFormCode);

  return(
    <div className="screen" style={{fontFamily:"'Pretendard',-apple-system,sans-serif",background:C.pageBg,maxWidth:480,margin:'0 auto',color:C.text,paddingBottom:60}}>
      <ErrorBoundary>
      {!user&&!['participantEvent','formSubmit','notFound'].includes(view)&&<AuthScreen nav={nav} showToast={showToast} setShowOnboarding={setShowOnboarding}/>}
      {view==='notFound'&&<NotFoundScreen/>}
      {view==='participantEvent'&&currentEvent&&<ParticipantScreen nav={nav} event={currentEvent} updateEvent={updateEvent} participantKey={participantKey} showToast={showToast}/>}
      {view==='formSubmit'&&currentForm&&<FormSubmitScreen nav={nav} form={currentForm} updateForm={updateForm} showToast={showToast}/>}
      {user&&view==='home'&&<HomeScreen nav={nav} user={user} profile={profile} events={events} forms={forms} showToast={showToast} onGuide={()=>setShowGuide(true)} showFeedback={showFeedback} onFeedbackDone={()=>setShowFeedback(false)}/>}
      {user&&view==='setup'&&<SetupScreen nav={nav} profile={profile} saveProfile={saveProfile} showToast={showToast}/>}
      {user&&view==='create'&&<CreateScreen nav={nav} profile={profile} events={events} createEvent={createEvent} showToast={showToast}/>}
      {user&&view==='formCreate'&&<FormCreateScreen nav={nav} profile={profile} createForm={createForm}/>}
      {user&&view==='adminEvent'&&currentEvent&&<AdminEventScreen nav={nav} event={currentEvent} updateEvent={updateEvent} showToast={showToast} profile={profile}/>}
      {user&&view==='formAdmin'&&currentForm&&<FormAdminScreen nav={nav} form={currentForm} updateForm={updateForm} showToast={showToast} profile={profile} saveProfile={saveProfile} createEvent={createEvent}/>}
      {user&&view==='history'&&<HistoryScreen nav={nav} events={events} forms={forms} deleteEvent={deleteEvent} deleteForm={deleteForm}/>}
      {user&&view==='help'&&<HelpScreen nav={nav}/>}
      {user&&view==='usage-guide'&&<UsageGuideScreen nav={nav}/>}
      {showGuide&&<GuideModal onClose={()=>setShowGuide(false)} onFeedback={()=>{setShowGuide(false);setShowFeedback(true);}}/>}
      {showOnboarding&&<OnboardingModal nav={nav} onClose={()=>setShowOnboarding(false)}/>}
      </ErrorBoundary>
      <Toast msg={toast?.msg} color={toast?.color}/>
    </div>
  );
}


// ── AuthScreen ─────────────────────────────────────────────
function AuthScreen({nav,showToast,setShowOnboarding=()=>{}}){
  const [mode,setMode]=useState('login');
  const [userId,setUserId]=useState('');
  const [pw,setPw]=useState('');
  const [name,setName]=useState('');
  const [loading,setLoading]=useState(false);
  const [idChecked,setIdChecked]=useState(false);
  const [idAvail,setIdAvail]=useState(null);
  const [err,setErr]=useState('');
  const [idChecking,setIdChecking]=useState(false);

  const toEmail = id => id.trim().toLowerCase()+ID_DOMAIN;

  const checkId = async(val)=>{
    const v=(val||userId).trim();
    if(!v||v.length<3) return;
    if(!/^[a-zA-Z0-9_]{3,20}$/.test(v)){setIdAvail(false);setIdChecked(true);setErr('영문, 숫자, _ 3~20자');return;}
    setIdChecking(true);
    const {data}=await api.checkUsername(v.toLowerCase());
    if(data){
      setIdAvail(false);setIdChecked(true);setErr('이미 사용 중인 아이디예요');
    } else {
      setIdAvail(true);setIdChecked(true);setErr('');
    }
    setIdChecking(false);
  };

  const submit=async()=>{
    setErr('');
    if(!userId.trim()||!pw){setErr('아이디와 비밀번호를 입력해주세요');return;}
    if(mode==='signup'){
      if(!idChecked||!idAvail){
        if(!idChecked&&userId.trim().length>=3){await checkId();return;}
        setErr('사용 가능한 아이디를 입력해주세요');return;
      }
      if(pw.length<6){setErr('비밀번호는 6자 이상이어야 해요');return;}
      if(!name.trim()){setErr('이름을 입력해주세요');return;}
    }
    setLoading(true);
    const email=toEmail(userId);
    if(mode==='login'){
      const {error}=await api.signIn(email,pw);
      if(error){setErr('아이디 또는 비밀번호가 틀렸어요');setLoading(false);return;}
      // 탈퇴 여부 확인
      const {data:{user:u}}=await api.getUser();
      if(u){
        const {data:prof}=await api.getProfileFields(u.id,'deleted');
        if(prof?.deleted){
          await api.signOut();
          setErr('탈퇴된 계정이에요. 새 아이디로 가입해주세요.');
          setLoading(false);return;
        }
      }
    } else {
      const {data,error}=await api.signUp(email,pw);
      if(error){
        const msg=translateAuthError(error);
        if(msg==='ALREADY_REGISTERED'){
          setErr('이미 가입된 계정이에요. 로그인을 시도해보세요.');
          setMode('login');
        } else {
          setErr(msg);
        }
        setLoading(false);return;
      }
      const uid=data?.user?.id;
      if(uid){
        // profile 저장
        const {error:profErr}=await api.upsertProfile({
          id:uid,
          name:name.trim(),
          username:userId.trim().toLowerCase(),
          updated_at:new Date().toISOString(),
        });
        if(profErr){console.error('Profile save error:',profErr);}
        // profile 저장 후 data reload (race condition 방지)
        await nav.loadUserData(uid);
        posthog.capture('회원가입_완료');
        // 신규가입 온보딩 표시
        setShowOnboarding(true);
      }
    }
    setLoading(false);
  };

  const signInWithGoogle=async()=>{
    setLoading(true);
    const {error}=await api.signInWithOAuth();
    if(error){showToast('Google 로그인에 실패했어요',C.red);setLoading(false);}
  };

  const iStyle={width:'100%',padding:'15px 16px',background:'#F2F4F6',border:'1.5px solid transparent',borderRadius:14,color:C.text,fontSize:15,outline:'none',display:'block'};
  const gSvg=(
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );

  return(
    <div className="fade-up screen" style={{background:'#fff',overflowY:'auto'}}>
      <div style={{padding:'56px 24px calc(48px + env(safe-area-inset-bottom)) 24px'}}>

        {/* 인사말 */}
        <div style={{marginBottom:36}}>
          <div style={{fontSize:30,fontWeight:900,color:C.text,lineHeight:1.35,letterSpacing:-0.5,marginBottom:8,display:'flex',alignItems:'center',gap:12}}>
            <svg viewBox="0 0 200 200" style={{width:40,height:40,borderRadius:12,flexShrink:0}}>
              <defs><clipPath id="auth-logo"><circle cx="100" cy="100" r="100"/></clipPath></defs>
              <g clipPath="url(#auth-logo)">
                <rect width="200" height="200" fill="#6366F1"/>
                <polygon points="0,200 200,0 200,200" fill="#A5A6F6"/>
              </g>
            </svg>
            {mode==='login'?<>환영해요</>:<>환영해요</>}
          </div>
          <div style={{fontSize:15,color:C.textMid,fontWeight:500}}>
            {mode==='login'?'로그인하고 정산을 이어가세요':'총무의 부담을 1/10로'}
          </div>
        </div>

        {/* Google 버튼 */}
        <button onClick={signInWithGoogle} disabled={loading} className="press" style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:10,padding:'15px 16px',background:'#fff',border:`1.5px solid ${C.border}`,borderRadius:14,fontSize:15,fontWeight:600,color:C.text,cursor:'pointer',marginBottom:16}}>
          {gSvg}{mode==='login'?'Google로 계속하기':'Google로 시작하기'}
        </button>

        {/* 구분선 */}
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
          <div style={{flex:1,height:1,background:C.border}}/>
          <span style={{color:C.textDim,fontSize:13,whiteSpace:'nowrap'}}>또는 아이디로</span>
          <div style={{flex:1,height:1,background:C.border}}/>
        </div>

        {/* 이름 (signup, 맨 위) */}
        {mode==='signup'&&(
          <input value={name} onChange={e=>setName(e.target.value)}
            onFocus={e=>e.target.style.borderColor=C.accent}
            onBlur={e=>e.target.style.borderColor='transparent'}
            placeholder="이름"
            style={{...iStyle,marginBottom:10}}
          />
        )}

        {/* 아이디 */}
        <input value={userId}
          onChange={e=>{setUserId(e.target.value.replace(/[^a-zA-Z0-9_]/g,''));setIdChecked(false);setIdAvail(null);setErr('');}}
          onFocus={e=>!idChecked&&(e.target.style.borderColor=C.accent)}
          onBlur={e=>{e.target.style.borderColor=idChecked?(idAvail?C.green:C.red):'transparent';mode==='signup'&&userId.trim().length>=3&&checkId();}}
          placeholder="아이디"
          maxLength={20}
          style={{...iStyle,borderColor:idChecked?(idAvail?C.green:C.red):'transparent',marginBottom:(idChecking||idChecked)?4:10}}
        />
        {idChecking&&<div style={{fontSize:12,color:C.textDim,paddingLeft:4,marginBottom:10}}>확인 중...</div>}
        {!idChecking&&idChecked&&idAvail&&<div style={{fontSize:12,color:C.green,paddingLeft:4,marginBottom:10,display:'flex',alignItems:'center',gap:4}}><Icon n="check" size={12} color={C.green}/>사용 가능한 아이디예요</div>}
        {!idChecking&&idChecked&&!idAvail&&<div style={{fontSize:12,color:C.red,paddingLeft:4,marginBottom:10,display:'flex',alignItems:'center',gap:4}}><Icon n="x" size={12} color={C.red}/>사용 불가능한 아이디예요</div>}

        {/* 비밀번호 */}
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
          onFocus={e=>e.target.style.borderColor=C.accent}
          onBlur={e=>e.target.style.borderColor='transparent'}
          onKeyDown={e=>e.key==='Enter'&&mode==='login'&&submit()}
          placeholder={mode==='login'?'비밀번호':'비밀번호 (6자 이상)'}
          style={{...iStyle,marginBottom:10}}
        />

        {/* 에러 */}
        {err&&<div style={{color:C.red,fontSize:13,marginBottom:12,padding:'11px 14px',background:C.redBg,borderRadius:10,display:'flex',alignItems:'center',gap:6}}><Icon n="triangle-alert" size={14} color={C.red}/>{err}</div>}

        {/* 제출 버튼 */}
        <Btn onClick={submit} loading={loading}>{mode==='login'?'로그인':'가입하기'}</Btn>

        {/* 약관 (signup only) */}
        {mode==='signup'&&(
          <div style={{textAlign:'center',marginTop:14}}>
            <span style={{fontSize:11,color:C.textDim,lineHeight:1.6}}>가입 시 이용약관 및 개인정보처리방침에 동의한 것으로 간주됩니다</span>
          </div>
        )}

        {/* 모드 전환 */}
        <div style={{textAlign:'center',marginTop:28}}>
          <span style={{color:C.textDim,fontSize:14}}>{mode==='login'?'계정이 없으신가요? ':'이미 계정이 있으신가요? '}</span>
          <button onClick={()=>{setMode(m=>m==='login'?'signup':'login');setErr('');setIdChecked(false);setIdAvail(null);}} style={{color:C.accent,fontWeight:700,fontSize:14,background:'none',border:'none',cursor:'pointer',padding:0}}>
            {mode==='login'?'회원가입':'로그인'}
          </button>
        </div>

      </div>
    </div>
  );
}


// ── HomeScreen ─────────────────────────────────────────────
function HomeScreen({nav,user,profile,events,forms,showToast,onGuide,showFeedback,onFeedbackDone}){
  const [loggingOut,setLoggingOut]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false);
  const [feedbackOpen,setFeedbackOpen]=useState(false);
  const [feedbackText,setFeedbackText]=useState('');
  const [feedbackLoading,setFeedbackLoading]=useState(false);
  const [modeSelect,setModeSelect]=useState(false);
  const prevActiveCodesRef=useRef(null);

  // FAQ에서 건의 버튼 눌렀을 때
  useEffect(()=>{
    if(showFeedback){setFeedbackOpen(true);onFeedbackDone&&onFeedbackDone();}
  },[showFeedback]);

  const logout=async()=>{setLoggingOut(true);await api.signOut();nav.setView('home');};

  // 진행 중인 정산만 (완료 안 된 것)
  const activeEventsRaw=events.filter(ev=>!isEventDone(ev));
  const activeEvents=[...activeEventsRaw].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));

  // 정산 완료 감지 (active → done 전환)
  useEffect(()=>{
    if(prevActiveCodesRef.current===null){
      prevActiveCodesRef.current=new Set(activeEventsRaw.map(e=>e.code));
      return;
    }
    const prevCodes=prevActiveCodesRef.current;
    const currentActiveCodes=new Set(activeEventsRaw.map(e=>e.code));
    const newlyDone=events.filter(ev=>prevCodes.has(ev.code)&&!currentActiveCodes.has(ev.code)&&isEventDone(ev));
    if(newlyDone.length>0) showToast('🎉 '+newlyDone[0].name+' 전원 입금 완료!',C.green);
    prevActiveCodesRef.current=currentActiveCodes;
  },[events]);
  const activeForms=(forms||[]).filter(f=>f.status==='open');

  const submitFeedback=async()=>{
    if(!feedbackText.trim()) return;
    setFeedbackLoading(true);
    await api.updateProfile(user.id,{feedback:feedbackText.trim(),updated_at:new Date().toISOString()});
    setFeedbackLoading(false);
    setFeedbackText('');setFeedbackOpen(false);
    showToast('건의사항이 전달됐어요');
  };

  return(
    <div className="fade-up screen" style={{background:C.pageBg}}>
      {/* 프로필 영역 */}
      <div style={{background:'#FFFFFF',borderRadius:'0 0 24px 24px',padding:'24px 24px 20px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <div>
            <div style={{fontSize:14,color:C.textDim,marginBottom:4}}>안녕하세요</div>
            <div style={{fontSize:22,fontWeight:900,color:C.text,letterSpacing:-0.5}}>{profile?.name||profile?.username||'총무'}님</div>
          </div>
          <div style={{position:'relative'}}>
            <button onClick={()=>setMenuOpen(o=>!o)} style={{background:C.inputBg,border:'none',borderRadius:12,color:C.textMid,cursor:'pointer',width:40,height:40,display:'flex',alignItems:'center',justifyContent:'center'}}><span className="ms" style={{fontSize:22}}>more_horiz</span></button>
            {menuOpen&&(
              <div style={{position:'absolute',right:0,top:48,background:'#fff',borderRadius:16,boxShadow:'0 8px 32px rgba(0,0,0,0.12)',zIndex:50,minWidth:160,overflow:'hidden'}}>
                <button onClick={logout} style={{width:'100%',padding:'15px 18px',background:'none',border:'none',cursor:'pointer',fontSize:15,color:C.red,textAlign:'left',fontWeight:600,display:'flex',alignItems:'center',gap:10}}><span className="ms ms-sm">logout</span>{loggingOut?'..':'로그아웃'}</button>
              </div>
            )}
          </div>
        </div>
        <div style={{display:'flex',gap:10,marginBottom:16}}>
          {[[events.length,'총 정산',C.accent],[activeEvents.length,'진행 중',C.green]].map(([v,l,c])=>(
            <div key={l} onClick={()=>nav.setView('history')} className="press" style={{background:C.inputBg,borderRadius:16,padding:'14px 18px',flex:1,cursor:'pointer'}}>
              <div style={{fontSize:24,fontWeight:900,color:c,letterSpacing:-0.5}}>{v}</div>
              <div style={{fontSize:12,color:C.textDim,marginTop:4,fontWeight:600}}>{l}</div>
            </div>
          ))}
        </div>
        {/* 새 정산 CTA — 프로필 영역 하단, 스크롤 없이 항상 보이도록 */}
        <Btn onClick={()=>setModeSelect(true)} style={{padding:'18px',fontSize:17,borderRadius:20}}>＋ 새로 만들기</Btn>
      </div>

      <div style={{padding:'16px 16px 32px'}}>
        {/* 메뉴 그리드 */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginBottom:20}}>
          {[
            {icon:'manage_accounts',label:'명단·계좌',action:()=>nav.setView('setup')},
            {icon:'help',label:'도움말',action:()=>nav.setView('help')},
          ].map(({icon,label,action})=>(
            <button key={label} onClick={action} className="press" style={{
              padding:'18px 8px',borderRadius:16,background:'#fff',
              border:'none',cursor:'pointer',
              display:'flex',flexDirection:'column',alignItems:'center',gap:8,
            }}>
              <span className="ms" style={{fontSize:24,color:C.textMid}}>{icon}</span>
              <span style={{fontSize:12,fontWeight:700,color:C.textMid,textAlign:'center',lineHeight:1.3}}>{label}</span>
            </button>
          ))}
        </div>

        {/* 대규모 신청폼 있으면 표시 */}
        {activeForms.length>0&&(
          <>
            <div style={{fontSize:11,color:C.textDim,fontWeight:700,marginBottom:10,letterSpacing:1.2,textTransform:'uppercase'}}>신청폼</div>
            {activeForms.map(form=>(
              <div key={form.code} onClick={()=>{nav.setCurrentFormCode(form.code);nav.setView('formAdmin');}} className="press"
                style={{background:C.cardBg,borderRadius:16,padding:'16px 20px',marginBottom:8,cursor:'pointer'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:800,color:C.text,fontSize:16}}>{form.name}</div>
                    <div style={{fontSize:13,color:C.textDim,marginTop:4}}>{form.date} · {form.amountPaid?`${fmtKRW(form.amount)} / ${fmtKRW(form.amountPaid)}`:fmtKRW(form.amount)} · <span style={{color:C.orange,fontWeight:700}}>{form.submissions?.length||0}/{form.maxPeople||'∞'}명</span></div>
                  </div>
                  <span className="ms" style={{color:C.textDim,fontSize:20,flexShrink:0,marginLeft:8}}>chevron_right</span>
                </div>
              </div>
            ))}
          </>
        )}

        {activeEvents.length===0&&activeForms.length===0?(
          <div style={{textAlign:'center',padding:'40px 0'}}>
            <div style={{width:64,height:64,borderRadius:32,background:C.textDim+'18',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px'}}><Icon n="clipboard-list" size={32} color={C.textDim}/></div>
            <div style={{color:C.textMid,fontSize:14,fontWeight:600,marginBottom:6}}>진행 중인 정산이 없어요</div>
            <div style={{color:C.textDim,fontSize:13}}>위 버튼으로 새 정산을 만들어보세요</div>
          </div>
        ):(
          <>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,color:C.textDim,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase'}}>진행 중</div>
            </div>
            {activeEvents.map(ev=>{
              const presentMembers=ev.members.filter(k=>ev.attendance[k]!==false);
              const pc=presentMembers.filter(k=>getPayStatus(ev.payments?.[k])==='paid').length;
              return(
                <div key={ev.code} onClick={()=>{nav.setCurrentCode(ev.code);nav.setView('adminEvent');}} className="press"
                  style={{background:C.cardBg,borderRadius:16,padding:'16px 20px',marginBottom:8,cursor:'pointer'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:800,color:C.text,fontSize:16}}>{ev.name}</div>
                      <div style={{color:C.textDim,fontSize:13,marginTop:4}}>
                        {ev.date} · <span style={{color:pc===presentMembers.length&&presentMembers.length>0?C.green:C.accent,fontWeight:700}}>{pc}/{presentMembers.length}명 입금</span>
                      </div>
                    </div>
                    <span className="ms" style={{color:C.textDim,fontSize:20,flexShrink:0,marginLeft:8}}>chevron_right</span>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* 피드백 버튼 */}
        <button onClick={()=>setFeedbackOpen(true)} style={{
          width:'100%',marginTop:16,padding:'14px',borderRadius:16,
          border:`2px dashed ${C.accent}50`,background:C.accentBg,
          color:C.accent,fontWeight:700,fontSize:14,cursor:'pointer',
          display:'flex',alignItems:'center',justifyContent:'center',gap:8,
        }}>
          <Icon n="message-circle" size={16} color={C.accent}/>건의사항 · 불편한 점 알려주세요
        </button>
      </div>

      {feedbackOpen&&(
        <FeedbackModal
          user={user} feedbackText={feedbackText} setFeedbackText={setFeedbackText}
          feedbackLoading={feedbackLoading} onSubmit={submitFeedback} onClose={()=>setFeedbackOpen(false)}
        />
      )}
      {modeSelect&&(
        <ModeSelectModal profile={profile} nav={nav} onClose={()=>setModeSelect(false)}/>
      )}
    </div>
  );
}

// ── FeedbackModal ──────────────────────────────────────────
function FeedbackModal({feedbackText,setFeedbackText,feedbackLoading,onSubmit,onClose}){
  return(
    <Modal isOpen={true} onClose={onClose} title="건의사항 · 질문">
      <div style={{color:C.textMid,fontSize:13,marginBottom:18,lineHeight:1.9}}>
        남들이 지기 싫어하는 책임을 지지만<br/>그만큼 모두에게 신뢰받는 사람이 총무라는 것을<br/>알고 있습니다.<br/>
        <strong style={{color:C.accent}}>그런 여러분의 진짜 고민과 문제를 들려주세요.</strong>
      </div>
      <textarea value={feedbackText} onChange={e=>setFeedbackText(e.target.value)}
        placeholder="예) 진짜 총무 문제는 엑셀파일로 정리하는 거에요 너무 힘들어요" rows={5}
        style={{width:'100%',padding:'14px',background:C.inputBg,border:`1.5px solid ${C.border}`,borderRadius:14,fontSize:14,color:C.text,outline:'none',resize:'none',lineHeight:1.75,marginBottom:16}}
        onFocus={e=>e.target.style.border=`1.5px solid ${C.accent}`}
        onBlur={e=>e.target.style.border=`1.5px solid ${C.border}`}
      />
      <div style={{display:'flex',gap:10}}>
        <Btn variant="ghost" onClick={onClose} style={{flex:1}}>취소</Btn>
        <Btn onClick={onSubmit} loading={feedbackLoading} disabled={!feedbackText.trim()} style={{flex:2}}>전달하기 →</Btn>
      </div>
    </Modal>
  );
}

// ── ModeSelectModal ─────────────────────────────────────────
function ModeSelectModal({profile,nav,onClose}){
  return(
    <Modal isOpen={true} onClose={onClose} showCloseButton={false} maxWidth={440}>
      <div style={{display:'flex',justifyContent:'flex-end',marginTop:-4,marginBottom:8}}>
        <button onClick={onClose} style={{background:C.inputBg,border:'none',borderRadius:10,width:32,height:32,cursor:'pointer',color:C.textMid,display:'flex',alignItems:'center',justifyContent:'center'}}><Icon n="x" size={14} color={C.textMid}/></button>
      </div>
      {(!profile.account?.bank||!(profile.groups||[]).some(g=>(g.members||[]).length>0))&&(
        <div style={{background:C.greenBg,borderRadius:16,padding:'18px 20px',marginBottom:20,border:`1px solid ${C.green}30`}}>
          <div style={{fontWeight:800,color:C.text,fontSize:15,marginBottom:6,display:'flex',alignItems:'center',gap:6}}><Icon n="zap" size={15} color={C.green}/>먼저 설정을 완료해주세요</div>
          <div style={{fontSize:13,color:C.textMid,lineHeight:1.7,marginBottom:14,whiteSpace:'pre-line'}}>
            {!profile.account?.bank&&'입금 계좌가 아직 등록되지 않았어요.\n'}
            {!(profile.groups||[]).some(g=>(g.members||[]).length>0)&&'명단을 등록하면 매번 이름 입력 없이 바로 선택할 수 있어요.'}
          </div>
          <Btn onClick={()=>{onClose();nav.setView('setup');}} small>명단·계좌 설정하러 가기</Btn>
        </div>
      )}
      <div style={{fontWeight:900,color:C.text,fontSize:20,marginBottom:6,textAlign:'center'}}>어떤 상황이세요?</div>
      <div style={{color:C.textMid,fontSize:13,marginBottom:24,textAlign:'center'}}>상황에 맞게 선택하세요</div>
      <button onClick={()=>{posthog.capture('신청폼_만들기_시작');onClose();nav.setView('formCreate');}} className="press" style={{width:'100%',padding:'20px',borderRadius:16,marginBottom:12,background:C.orangeBg,border:`1px solid ${C.orange}20`,cursor:'pointer',textAlign:'left'}}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:48,height:48,borderRadius:14,background:C.orange,display:'flex',alignItems:'center',justifyContent:'center'}}><Icon n="mail" size={24} color="#fff"/></div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,color:C.text,fontSize:16,marginBottom:4}}>신청 받을 일이 있어요</div>
            <div style={{fontSize:11,color:C.orange,fontWeight:600}}>MT, 회비, 야식마차</div>
          </div>
          <span className="ms" style={{color:C.orange}}>chevron_right</span>
        </div>
      </button>
      <button onClick={()=>{posthog.capture('정산_만들기_시작');onClose();nav.setView('create');}} className="press" style={{width:'100%',padding:'20px',borderRadius:16,background:C.accentBg,border:`1px solid ${C.accent}20`,cursor:'pointer',textAlign:'left'}}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:48,height:48,borderRadius:14,background:C.accent,display:'flex',alignItems:'center',justifyContent:'center'}}><Icon n="users" size={24} color="#fff"/></div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,color:C.text,fontSize:16,marginBottom:4}}>그냥 바로 정산하면 돼요</div>
            <div style={{fontSize:11,color:C.accent,fontWeight:600}}>뒷풀이, 공지 후 술자리(회식)</div>
          </div>
          <span className="ms" style={{color:C.accent}}>chevron_right</span>
        </div>
      </button>
    </Modal>
  );
}

// ── FnQ Modal ─────────────────────────────────────────────
const FAQS=[
  {q:'정산해는 어떤 서비스인가요?',a:'정산해는 모임·회식·MT 등에서 총무가 정산을 쉽게 할 수 있도록 도와주는 서비스예요. 명단 등록 → 금액 입력 → 링크 공유 → 실시간 입금 현황 확인, 그리고 거래내역 자동 대조까지, 총무의 정산 업무를 1/10로 줄여줘요.'},
  {q:'정산과 신청폼의 차이는?',a:'정산은 이미 모인 우리끼리 1/N 정산이에요. 출석 체크 → 차수별 금액 입력 → 입금 현황 관리 방식이에요.\n신청폼은 참여자가 신청서를 작성하고 총무가 명단을 관리하는 방식이에요. 선착순·정원 관리, 거래내역 엑셀 자동 대조로 참가비도 관리할 수 있어요.'},
  {q:'거래내역 자동 대조는 어떻게 작동하나요?',a:'은행 앱에서 거래내역 엑셀을 내려받아 업로드하면, 신청자 이름과 자동으로 대조해줘요. 이름이 일치하면 \'입금 확인 필요\' 상태로 표시되고, 총무가 최종 확정만 하면 돼요. 토스뱅크·카카오뱅크·신한·국민·우리은행 등 주요 은행을 지원해요.'},
  {q:'참여자는 앱 설치나 로그인이 필요한가요?',a:'전혀 필요 없어요. 총무가 공유한 링크만 누르면 바로 본인 금액 화면이 열려요. 앱 설치도, 회원가입도 필요 없이 바로 확인하고 완료 버튼만 누르면 돼요.'},
  {q:'데이터는 안전한가요?',a:'모든 데이터는 Supabase(AWS 인프라)와 Cloudflare에서 암호화 저장·전송돼요. 본인의 데이터는 본인만 접근할 수 있고, 회원 탈퇴 시 모든 데이터가 즉시 삭제됩니다.'},
];
function GuideModal({onClose,onFeedback}){
  const faqs=FAQS;
  const [open,setOpen]=useState(null);
  return(
    <Modal isOpen={true} onClose={onClose} title="자주 묻는 질문">
      {faqs.map((f,i)=>(
        <div key={i} style={{borderBottom:`1px solid ${C.pageBg}`,paddingBottom:12,marginBottom:12}}>
          <button onClick={()=>setOpen(open===i?null:i)} style={{width:'100%',background:'none',border:'none',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,padding:'6px 0',textAlign:'left'}}>
            <div style={{fontWeight:700,color:C.text,fontSize:14,lineHeight:1.6}}>{f.q}</div>
            <div style={{color:C.textDim,flexShrink:0,marginTop:2}}><Icon n={open===i?'chevron-up':'chevron-down'} size={16} color={C.textDim}/></div>
          </button>
          {open===i&&<div style={{fontSize:13,color:C.textMid,lineHeight:1.85,marginTop:6,paddingLeft:4,whiteSpace:'pre-wrap'}}>{f.a}</div>}
        </div>
      ))}
      <button onClick={()=>{onClose();onFeedback&&onFeedback();}} style={{
        width:'100%',marginTop:8,padding:'16px 20px',borderRadius:16,
        background:C.accentBg,border:'none',cursor:'pointer',textAlign:'left',
        display:'flex',alignItems:'center',gap:12,
      }}>
        <Icon n="message-circle" size={24} color={C.accent}/>
        <div>
          <div style={{fontWeight:800,color:C.text,fontSize:14}}>불편한 점이 있으신가요?</div>
          <div style={{fontSize:12,color:C.textMid,marginTop:2}}>언제든지 건의해 주세요</div>
        </div>
        <span className="ms" style={{color:C.accent,marginLeft:'auto'}}>chevron_right</span>
      </button>
    </Modal>
  );
}

// ── SetupScreen ────────────────────────────────────────────
function SetupScreen({nav,profile,saveProfile,showToast}){
  const [name,setName]=useState(profile.name||'');
  const [bank,setBank]=useState(profile.account?.bank||'');
  const [number,setNumber]=useState(profile.account?.number||'');
  const [holder,setHolder]=useState(profile.account?.holder||'');
  const _rawGroups=(()=>{
    const base=profile.groups?.length
      ?profile.groups.map(g=>g.name==='전체'?{...g,name:'기본'}:g)
      :[];
    if(!base.some(g=>g.name==='기본'))
      return [{id:'g1',name:'기본',rawText:'',members:[]},...base];
    return base;
  })();
  const [groups,setGroups]=useState(_rawGroups);
  const [activeG,setActiveG]=useState(0);
  const [activeTab,setActiveTab]=useState('members');
  const [school,setSchool]=useState(profile.school||'');
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [savingProf,setSavingProf]=useState(false);
  const [savedProf,setSavedProf]=useState(false);
  const [addingGroup,setAddingGroup]=useState(false);
  const [newGName,setNewGName]=useState('');
  const [pfmOpen,setPfmOpen]=useState(false);
  const [searchQ,setSearchQ]=useState('');
  const [sortBy,setSortBy]=useState('default');

  const updateRaw=(idx,text)=>{
    const members=parseMembers(text);
    const validKeys=new Set(members.map(m=>m.name+(m.sid?'_'+m.sid:'')));
    setGroups(gs=>gs.map((g,i)=>i===idx?{...g,rawText:text,members,paidFeeMembers:(g.paidFeeMembers||[]).filter(k=>validKeys.has(k))}:g));
  };
  const updatePaidFeeMembers=(idx,keys)=>{
    setGroups(gs=>gs.map((g,i)=>i===idx?{...g,paidFeeMembers:keys}:g));
  };
  const togglePaidFee=(idx,key)=>{
    const realIdx=idx===-1?groups.findIndex(g=>g.members.some(m=>m.name+(m.sid?'_'+m.sid:'')=== key)):idx;
    if(realIdx===-1) return;
    setGroups(gs=>gs.map((g,i)=>i===realIdx?{...g,paidFeeMembers:(g.paidFeeMembers||[]).includes(key)?(g.paidFeeMembers||[]).filter(k=>k!==key):[...(g.paidFeeMembers||[]),key]}:g));
  };
  const textareaRef=useRef(null);
  const addGroup=()=>{
    if(!newGName.trim()) return;
    setGroups(gs=>[...gs,{id:'g'+Date.now(),name:newGName.trim(),rawText:'',members:[]}]);
    setActiveG(groups.length);setAddingGroup(false);setNewGName('');
    setTimeout(()=>textareaRef.current?.focus(),100);
  };
  const delGroup=idx=>{
    if(groups.length<=1) return;
    setGroups(gs=>gs.filter((_,i)=>i!==idx));
    setActiveG(Math.max(0,idx-1));
  };
  const save=async()=>{
    setSaving(true);
    await saveProfile({...profile,account:{bank,number,holder},groups});
    setSaving(false);setSaved(true);setTimeout(()=>setSaved(false),2200);
  };
  const saveProfileData=async()=>{
    setSavingProf(true);
    await saveProfile({...profile,name,school,account:{bank,number,holder},groups});
    setSavingProf(false);setSavedProf(true);setTimeout(()=>setSavedProf(false),2200);
  };
  const cur=activeG===-1?null:(groups[activeG]??null);
  const displayMembers=activeG===-1?groups.flatMap(g=>g.members||[]):(cur?.members||[]);
  const filteredMembers=searchQ?displayMembers.filter(m=>m.name.includes(searchQ)||(m.sid||'').includes(searchQ)):displayMembers;
  const sortedMembers=sortBy==='default'?filteredMembers:[...filteredMembers].sort((a,b)=>{
    if(sortBy==='name') return a.name.localeCompare(b.name,'ko');
    if(sortBy==='sid') return (a.sid||'').localeCompare(b.sid||'');
    if(sortBy==='paid'){
      const ka=a.name+(a.sid?'_'+a.sid:''); const kb=b.name+(b.sid?'_'+b.sid:'');
      const aP=groups.some(g=>(g.paidFeeMembers||[]).includes(ka));
      const bP=groups.some(g=>(g.paidFeeMembers||[]).includes(kb));
      return (bP?1:0)-(aP?1:0);
    }
    return 0;
  });
  useEffect(()=>{setSearchQ('');setSortBy('default');},[activeG]);

  return(
    <div className="fade-up screen" style={{background:C.pageBg}}>
      <Header title="명단·계좌 설정" onBack={()=>nav.setView('home')}/>
      <div style={{padding:'16px 16px 24px'}}>
        <div style={{display:'flex',background:C.inputBg,borderRadius:12,padding:4,marginBottom:16}}>
          <button onClick={()=>setActiveTab('members')} style={{flex:1,padding:'8px 0',borderRadius:8,border:'none',background:activeTab==='members'?C.cardBg:'transparent',color:activeTab==='members'?C.text:C.textDim,fontSize:14,fontWeight:activeTab==='members'?700:500,cursor:'pointer',transition:'all 0.15s'}}>명단·계좌</button>
          <button onClick={()=>setActiveTab('profile')} style={{flex:1,padding:'8px 0',borderRadius:8,border:'none',background:activeTab==='profile'?C.cardBg:'transparent',color:activeTab==='profile'?C.text:C.textDim,fontSize:14,fontWeight:activeTab==='profile'?700:500,cursor:'pointer',transition:'all 0.15s'}}>프로필</button>
        </div>
        {activeTab==='members'&&<>
        <Card>
          <div style={{fontWeight:800,color:C.text,marginBottom:4,fontSize:15,display:'flex',alignItems:'center',gap:6}}><Icon n="credit-card" size={15} color={C.accent}/>입금 계좌</div>
          <div style={{color:C.textDim,fontSize:12,marginBottom:14}}>한 번 저장하면 모든 정산에 자동 적용돼요</div>
          <Field label="은행" value={bank} onChange={setBank} placeholder="카카오뱅크, 국민은행…"/>
          <Field label="계좌번호" value={number} onChange={setNumber} placeholder="숫자만" inputMode="numeric"/>
          <Field label="예금주" value={holder} onChange={setHolder} placeholder="홍길동"/>
        </Card>
        <Card>
          <div style={{fontWeight:800,color:C.text,marginBottom:4,fontSize:15,display:'flex',alignItems:'center',gap:6}}><Icon n="users" size={15} color={C.accent}/>명단 관리</div>
          <div style={{color:C.textDim,fontSize:12,marginBottom:14}}>
            학년·기수·팀 등 그룹별로 관리해요.
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
            {groups.length>1&&(
              <button key="__all" onClick={()=>setActiveG(-1)} className="press" style={{
                padding:'7px 14px',borderRadius:20,border:`2px solid ${activeG===-1?C.accent:C.border}`,
                background:activeG===-1?C.accent:C.cardBg,color:activeG===-1?'#fff':C.textMid,
                fontSize:13,fontWeight:700,cursor:'pointer',transition:'all 0.12s',display:'flex',alignItems:'center',gap:6,
              }}>
                전체
                <span style={{background:activeG===-1?'rgba(255,255,255,0.3)':C.inputBg,borderRadius:10,padding:'1px 7px',fontSize:11}}>
                  {groups.reduce((s,g)=>s+(g.members||[]).length,0)}
                </span>
              </button>
            )}
            {groups.map((g,i)=>(
              <button key={g.id} onClick={()=>setActiveG(i)} className="press" style={{
                padding:'7px 14px',borderRadius:20,border:`2px solid ${activeG===i?C.accent:C.border}`,
                background:activeG===i?C.accent:C.cardBg,color:activeG===i?'#fff':C.textMid,
                fontSize:13,fontWeight:700,cursor:'pointer',transition:'all 0.12s',display:'flex',alignItems:'center',gap:6,
              }}>
                {g.name}
                <span style={{background:activeG===i?'rgba(255,255,255,0.3)':C.inputBg,borderRadius:10,padding:'1px 7px',fontSize:11,color:g.members.length===0?(activeG===i?'rgba(255,255,255,0.6)':C.textDim):'inherit'}}>{g.members.length}</span>
              </button>
            ))}
            {addingGroup?(
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <input value={newGName} onChange={e=>setNewGName(e.target.value)} placeholder="그룹 이름" maxLength={12} autoFocus
                  onKeyDown={e=>e.key==='Enter'&&addGroup()}
                  style={{padding:'7px 12px',borderRadius:20,border:`2px solid ${C.accent}`,fontSize:13,fontWeight:600,outline:'none',width:100,background:C.accentBg,color:C.accent}}/>
                <button onClick={addGroup} style={{background:C.green,color:'#fff',border:'none',borderRadius:20,padding:'7px 12px',fontSize:12,fontWeight:700,cursor:'pointer'}}>저장</button>
                <button onClick={()=>{setAddingGroup(false);setNewGName('');}} style={{background:C.inputBg,border:`1.5px solid ${C.border}`,borderRadius:20,padding:'7px 10px',cursor:'pointer',color:C.textDim,display:'flex',alignItems:'center'}}><Icon n="x" size={12} color={C.textDim}/></button>
              </div>
            ):(
              <button onClick={()=>setAddingGroup(true)} className="press" style={{padding:'7px 14px',borderRadius:20,border:`2px dashed ${C.border}`,background:'transparent',color:C.textDim,fontSize:13,cursor:'pointer'}}>＋ 그룹 추가</button>
            )}
          </div>
          {(activeG===-1||cur)&&(
            <div key={activeG===-1?'__all':cur.id}>
              {activeG!==-1&&cur&&(
                <>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.textMid}}>{cur.name} 명단</div>
                    {groups.length>1&&activeG!==0&&<button onClick={()=>delGroup(activeG)} style={{color:C.red,background:'none',border:'none',fontSize:12,cursor:'pointer',fontWeight:600}}>그룹 삭제</button>}
                  </div>
                  {activeG!==0&&(
                    <div style={{fontSize:12,fontWeight:700,color:C.accent,marginBottom:6,display:'flex',alignItems:'center',gap:4}}>
                      <Icon n="users" size={12} color={C.accent}/>여기에 붙여넣으면 <span style={{textDecoration:'underline'}}>{cur.name}</span>에 추가됩니다
                    </div>
                  )}
                  <textarea ref={textareaRef} value={cur.rawText} onChange={e=>updateRaw(activeG,e.target.value)}
                    placeholder={`예시:\n김민준  202312345\n박지호  202412346\n이재훈\n\n이름·학번, 탭·쉼표·공백 모두 인식`} rows={6}
                    style={{width:'100%',padding:'12px 14px',background:C.inputBg,border:`1.5px solid ${C.border}`,borderRadius:12,color:C.text,fontSize:14,outline:'none',resize:'vertical',lineHeight:1.75,marginBottom:10}}
                    onFocus={e=>e.target.style.border=`1.5px solid ${C.accent}`}
                    onBlur={e=>e.target.style.border=`1.5px solid ${C.border}`}
                  />
                  <div style={{fontSize:11,color:C.textDim,marginBottom:8,lineHeight:1.6}}>학번 없어도 됩니다. 동명이인은 이름을 다르게 적어주세요 (예: 민준2)</div>
                  {displayMembers.length>0&&(
                    <div>
                      <div style={{display:'flex',gap:6,marginBottom:8}}>
                        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="이름·학번 검색"
                          style={{flex:1,padding:'7px 12px',borderRadius:10,border:`1.5px solid ${searchQ?C.accent:C.border}`,background:C.inputBg,fontSize:13,color:C.text,outline:'none'}}/>
                        <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
                          style={{padding:'7px 10px',borderRadius:10,border:`1.5px solid ${C.border}`,background:C.inputBg,fontSize:13,color:C.textMid,outline:'none',cursor:'pointer'}}>
                          <option value="default">기본순</option>
                          <option value="name">가나다</option>
                          <option value="sid">학번순</option>
                          <option value="paid">납부순</option>
                        </select>
                      </div>
                      <div style={{fontSize:12,color:C.green,fontWeight:700,marginBottom:6,display:'flex',alignItems:'center',gap:4}}>
                        <Icon n="check" size={12} color={C.green}/>{searchQ?`${sortedMembers.length}/${displayMembers.length}명 검색됨`:`${displayMembers.length}명 인식됐어요`}
                      </div>
                      <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',maxHeight:200,overflowY:'auto'}}>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',background:C.inputBg,padding:'6px 12px',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,zIndex:1}}>
                          <span style={{fontSize:11,fontWeight:700,color:C.textDim}}>이름</span>
                          <span style={{fontSize:11,fontWeight:700,color:C.textDim}}>학번</span>
                          <span style={{fontSize:11,fontWeight:700,color:C.textDim}}>학생회비</span>
                        </div>
                        {sortedMembers.length>0?sortedMembers.map((m,i)=>{
                          const k=m.name+(m.sid?'_'+m.sid:'');
                          const isPaid=groups.some(g=>(g.paidFeeMembers||[]).includes(k));
                          return(
                            <div key={m.name+(m.sid||'')+i} style={{
                              display:'grid',gridTemplateColumns:'1fr 1fr auto',padding:'7px 12px',
                              borderBottom:i<sortedMembers.length-1?`1px solid ${C.border}`:'none',
                              background:C.cardBg,alignItems:'center',
                            }}>
                              <span style={{fontSize:13,fontWeight:600,color:C.text}}>{m.name}</span>
                              <span style={{fontSize:13,color:m.sid?C.textMid:C.textDim}}>{m.sid||'—'}</span>
                              <div onClick={()=>togglePaidFee(activeG,k)} style={{
                                width:20,height:20,borderRadius:6,
                                border:`2px solid ${isPaid?C.accent:C.textDim}`,
                                background:isPaid?C.accent:'transparent',
                                display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',
                              }}>
                                {isPaid&&<Icon n="check" size={11} color="#fff"/>}
                              </div>
                            </div>
                          );
                        }):(
                          <div style={{padding:'16px',textAlign:'center',color:C.textDim,fontSize:13}}>검색 결과가 없어요</div>
                        )}
                      </div>
                      <button onClick={()=>setPfmOpen(true)}
                        style={{width:'100%',marginTop:8,padding:'8px',borderRadius:10,border:`1.5px solid ${C.accent}40`,background:C.accentBg,color:C.accent,fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
                        <Icon n="clipboard-list" size={12} color={C.accent}/>학생회비 일괄 붙여넣기
                      </button>
                    </div>
                  )}
                </>
              )}
              {activeG===-1&&displayMembers.length>0&&(
                <div style={{marginTop:12}}>
                  <div style={{display:'flex',gap:6,marginBottom:8}}>
                    <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="이름·학번 검색"
                      style={{flex:1,padding:'7px 12px',borderRadius:10,border:`1.5px solid ${searchQ?C.accent:C.border}`,background:C.inputBg,fontSize:13,color:C.text,outline:'none'}}/>
                    <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
                      style={{padding:'7px 10px',borderRadius:10,border:`1.5px solid ${C.border}`,background:C.inputBg,fontSize:13,color:C.textMid,outline:'none',cursor:'pointer'}}>
                      <option value="default">기본순</option>
                      <option value="name">가나다</option>
                      <option value="sid">학번순</option>
                      <option value="paid">납부순</option>
                    </select>
                  </div>
                  <div style={{fontSize:12,color:C.green,fontWeight:700,marginBottom:8}}>
                    ✓ {searchQ?`${sortedMembers.length}/${displayMembers.length}명 검색됨`:`${displayMembers.length}명 인식됐어요`}
                  </div>
                  <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',maxHeight:200,overflowY:'auto'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',background:C.inputBg,padding:'6px 12px',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,zIndex:1}}>
                      <span style={{fontSize:11,fontWeight:700,color:C.textDim}}>이름</span>
                      <span style={{fontSize:11,fontWeight:700,color:C.textDim}}>학번</span>
                      <span style={{fontSize:11,fontWeight:700,color:C.textDim}}>학생회비</span>
                    </div>
                    {sortedMembers.length>0?sortedMembers.map((m,i)=>{
                      const k=m.name+(m.sid?'_'+m.sid:'');
                      const isPaid=groups.some(g=>(g.paidFeeMembers||[]).includes(k));
                      return(
                        <div key={m.name+(m.sid||'')+i} style={{
                          display:'grid',gridTemplateColumns:'1fr 1fr auto',padding:'7px 12px',
                          borderBottom:i<sortedMembers.length-1?`1px solid ${C.border}`:'none',
                          background:C.cardBg,alignItems:'center',
                        }}>
                          <span style={{fontSize:13,fontWeight:600,color:C.text}}>{m.name}</span>
                          <span style={{fontSize:13,color:m.sid?C.textMid:C.textDim}}>{m.sid||'—'}</span>
                          <div onClick={()=>togglePaidFee(activeG,k)} style={{
                            width:20,height:20,borderRadius:6,
                            border:`2px solid ${isPaid?C.accent:C.textDim}`,
                            background:isPaid?C.accent:'transparent',
                            display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',
                          }}>
                            {isPaid&&<Icon n="check" size={11} color="#fff"/>}
                          </div>
                        </div>
                      );
                    }):(
                      <div style={{padding:'16px',textAlign:'center',color:C.textDim,fontSize:13}}>검색 결과가 없어요</div>
                    )}
                  </div>
                </div>
              )}
              {activeG===-1&&groups.some(g=>g.members.length>0)&&(
                <div style={{marginTop:14,padding:'12px 14px',background:C.inputBg,borderRadius:10,border:`1px solid ${C.border}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.text,display:'flex',alignItems:'center',gap:4}}><Icon n="wallet" size={14} color={C.text}/>학생회비 납부자</div>
                    <div style={{fontSize:12,color:C.textDim}}>납부자 {groups.reduce((s,g)=>s+(g.paidFeeMembers||[]).length,0)}/{groups.reduce((s,g)=>s+g.members.length,0)}명</div>
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={()=>setPfmOpen(true)}
                      style={{flex:1,padding:'7px',borderRadius:10,border:`1.5px solid ${C.accent}40`,background:C.accentBg,color:C.accent,fontSize:12,fontWeight:700,cursor:'pointer'}}>명단 붙여넣기</button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div style={{marginTop:14,padding:'11px 14px',background:C.inputBg,borderRadius:10,border:`1px solid ${C.border}`,fontSize:12,color:C.textMid}}>
            전체 {groups.reduce((s,g)=>s+g.members.length,0)}명
            {groups.length>1&&<span style={{marginLeft:8}}>{groups.map(g=>`${g.name} ${g.members.length}명`).join(' · ')}</span>}
          </div>
        </Card>
        {pfmOpen&&<PasteFeeModal
          members={groups.flatMap(g=>g.members.map(m=>m.name+(m.sid?'_'+m.sid:'')))}
          currentPaidKeys={groups.flatMap(g=>g.paidFeeMembers||[])}
          onApply={matched=>{
            setGroups(gs=>gs.map(g=>{
              const gKeys=new Set(g.members.map(m=>m.name+(m.sid?'_'+m.sid:'')));
              const newPaid=[...matched].filter(k=>gKeys.has(k));
              return {...g,paidFeeMembers:newPaid};
            }));
            setPfmOpen(false);
          }}
          showToast={showToast}
          onClose={()=>setPfmOpen(false)}
        />}
        <Btn onClick={save} loading={saving} variant={saved?'green':'primary'}>{saved?<><Icon n="check" size={16} color="#fff" style={{marginRight:4}}/>저장됐어요!</>:'저장하기'}</Btn>
        
        <div style={{marginTop:32,paddingTop:20,borderTop:`1px solid ${C.border}`}}>
          <DeleteAccountBtn showToast={showToast} nav={nav}/>
        </div>
        </>}
        {activeTab==='profile'&&<>
        <Card>
          <div style={{fontWeight:800,color:C.text,marginBottom:14,fontSize:15,display:'flex',alignItems:'center',gap:6}}><Icon n="user" size={15} color={C.accent}/>프로필</div>
          <Field label="이름" value={name} onChange={setName} placeholder="홍길동"/>
          <Field label="학교·단체" value={school} onChange={setSchool} placeholder="00대학교 / 00동아리"/>
        </Card>
        <Btn onClick={saveProfileData} loading={savingProf} variant={savedProf?'green':'primary'}>{savedProf?<><Icon n="check" size={16} color="#fff" style={{marginRight:4}}/>저장됐어요!</>:'저장하기'}</Btn>
        </>}
      </div>
    </div>
  );
}

function DeleteAccountBtn({showToast,nav}){
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [confirmText,setConfirmText]=useState('');
  const [counts,setCounts]=useState(null);

  const openCard=async()=>{
    setOpen(true);
    setConfirmText('');
    const {data:{user}}=await api.getUser();
    if(!user) return;
    const [{data:evs},{data:fms}]=await Promise.all([api.getEvents(user.id),api.getForms(user.id)]);
    setCounts({events:(evs||[]).length,forms:(fms||[]).length});
  };

  const deleteAccount=async()=>{
    setLoading(true);
    try{
      const {data:{user}}=await api.getUser();
      if(!user) throw new Error('no user');
      await Promise.all([api.deleteUserEvents(user.id),api.deleteUserForms(user.id)]);
      await api.updateProfile(user.id,{deleted:true,name:'',school:'',groups:[],account:{},username:null});
      try{await api.deleteAuthUser();}catch(e){}
      posthog.capture('탈퇴_완료');
      posthog.reset();
      await api.signOut();
    }catch(e){
      showToast('탈퇴 처리 중 오류가 발생했어요',C.red);
      setLoading(false);
      return;
    }
    localStorage.clear();
    nav.setView('home');
  };

  if(!open) return(
    <button onClick={openCard} style={{color:C.textDim,background:'none',border:'none',fontSize:13,cursor:'pointer',textDecoration:'underline',width:'100%',textAlign:'center'}}>
      회원 탈퇴
    </button>
  );

  return(
    <Card style={{border:`2px solid ${C.red}30`,background:C.redBg}}>
      <div style={{fontWeight:800,color:C.red,marginBottom:10,fontSize:15}}>정말 탈퇴하시겠어요?</div>
      <div style={{fontSize:13,color:C.textMid,marginBottom:14,lineHeight:1.9}}>
        다음 데이터가 모두 삭제됩니다:<br/>
        {counts?(
          <>
            · 정산 {counts.events}건<br/>
            · 신청폼 {counts.forms}건<br/>
          </>
        ):<span style={{color:C.textDim}}>· 불러오는 중…<br/></span>}
        · 명단·계좌 정보<br/>
        · 신청자 데이터<br/>
        <br/>
        <span style={{color:C.red,fontWeight:700}}>이 작업은 되돌릴 수 없습니다.</span>
      </div>
      <input
        value={confirmText} onChange={e=>setConfirmText(e.target.value)}
        placeholder="탈퇴"
        style={{width:'100%',padding:'10px 14px',borderRadius:10,border:`1.5px solid ${confirmText==='탈퇴'?C.red:C.border}`,background:'#fff',fontSize:14,color:C.text,outline:'none',marginBottom:10}}
      />
      <div style={{fontSize:12,color:C.textDim,marginBottom:12,textAlign:'center'}}>확인을 위해 <strong>탈퇴</strong>를 입력해주세요</div>
      <div style={{display:'flex',gap:8}}>
        <Btn variant="ghost" onClick={()=>{setOpen(false);setCounts(null);}} style={{flex:1}}>취소</Btn>
        <Btn variant="danger" onClick={deleteAccount} loading={loading} disabled={confirmText!=='탈퇴'} style={{flex:1}}>탈퇴하기</Btn>
      </div>
    </Card>
  );
}

// ── CreateScreen ───────────────────────────────────────────
function CreateScreen({nav,profile,events,createEvent,showToast}){
  const [showOnboarding,setShowOnboarding]=useState(false);
  useEffect(()=>{
    if(!profile?.id) return;
    if(localStorage.getItem('small_onb_done_'+profile.id)) return;
    api.getProfileFields(profile.id,'small_event_onboarding_done')
      .then(({data})=>{if(!data?.small_event_onboarding_done) setShowOnboarding(true);})
      .catch(()=>setShowOnboarding(true));
  },[profile?.id]);
  const [name,setName]=useState('');
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [time,setTime]=useState('');

  const [bank,setBank]=useState(profile.account?.bank||'');
  const [number,setNumber]=useState(profile.account?.number||'');
  const [holder,setHolder]=useState(profile.account?.holder||'');
  const [selected,setSelected]=useState([]);
  const [extraText,setExtraText]=useState('');
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(false);
  const [activeG,setActiveG]=useState(-1);
  const [extraMemberMap,setExtraMemberMap]=useState({});
  const groups=profile.groups||[];
  const allFromGroups=groups.flatMap(g=>g.members||[]);
  const extraMembers=parseMembers(extraText).filter(m=>!allFromGroups.find(x=>x.name===m.name&&x.sid===m.sid));
  const allMembers=[...allFromGroups,...extraMembers];
  const memberMap={};
  allMembers.forEach(m=>{memberMap[m.name+(m.sid?`_${m.sid}`:'')] = m.name;});
  const visibleMembers=activeG===-1?allMembers:(groups[activeG]?.members||[]);

  const dupBaseKeys=React.useMemo(()=>{
    const kc={};
    allMembers.forEach(m=>{const k=m.name+(m.sid?`_${m.sid}`:'');kc[k]=(kc[k]||0)+1;});
    return new Set(Object.keys(kc).filter(k=>kc[k]>1));
  },[allMembers.length]);

  const toggle=m=>{
    const k=m.name+(m.sid?`_${m.sid}`:'');
    if(dupBaseKeys.has(k)){showToast('동명이인이에요. 명단 화면에서 이름을 다르게 적어주세요 (예: 민준2)',C.orange);return;}
    setSelected(s=>s.includes(k)?s.filter(x=>x!==k):[...s,k]);
  };
  const selectGroup=gIdx=>{
    const gm=gIdx===-1?allMembers:(groups[gIdx]?.members||[]);
    const keys=gm.map(m=>m.name+(m.sid?`_${m.sid}`:''));
    const allSel=keys.every(k=>selected.includes(k));
    setSelected(s=>allSel?s.filter(k=>!keys.includes(k)):[...new Set([...s,...keys])]);
  };

  const create=async()=>{
    setErr('');
    if(!name.trim()){setErr('정산 이름을 입력해주세요');return;}

    if(selected.length===0){setErr('참여자를 1명 이상 선택해주세요');return;}
    setLoading(true);
    const code=genCode();
    const paidFeeKeys=selected.filter(k=>groups.some(g=>(g.paidFeeMembers||[]).includes(k)));
    const fullMemberMap={...memberMap,...extraMemberMap};
    // 선택한 참여자 = 1차 명단(전원 출석). 금액·정산방식은 만든 뒤 '행사 진행'에서 입력/수정.
    const ev={code,name:name.trim(),date,time:time||null,pin:'',account:{bank,number,holder},members:selected,memberMap:fullMemberMap,rounds:[{id:'round_1',label:'1차',amount:0,members:[...selected],extraMembers:[]}],payments:{},attendance:Object.fromEntries(selected.map(k=>[k,true])),attendanceOpen:false,createdAt:new Date().toISOString(),paidFeeKeys,feeConfig:null,sourceFormCode:null};
    const ok=await createEvent(ev);
    setLoading(false);
    if(ok){
      posthog.capture('정산_만들기_완료',{차수_수:ev.rounds.length,명단_수:ev.members.length});
      nav.setCurrentCode(ev.code);nav.setView('adminEvent');
    }
  };

  const hasAccount=profile.account?.bank&&profile.account?.number;

  return(
    <div className="fade-up screen" style={{background:C.pageBg}}>
      {showOnboarding&&<SmallEventOnboardingModal onClose={()=>setShowOnboarding(false)} userId={profile.id}/>}
      <Header title="새 정산 만들기" onBack={()=>nav.setView('home')}/>
      <div style={{padding:'6px 16px 0',fontSize:12,color:C.textDim,fontWeight:500}}>친구·동아리 모임에 적합. 명단 직접 입력</div>
      <div style={{padding:'16px 16px 24px'}}>
        <Card>
          <Field label="정산 이름" value={name} onChange={setName} placeholder="5월 MT, 종강 회식…"/>
          <Field label="행사 날짜·시간" value={date+'T'+(time||'00:00')} onChange={v=>{setDate(v.slice(0,10));setTime(v.slice(11,16));}} type="datetime-local"/>
          <div style={{fontSize:11,color:C.textDim,lineHeight:1.6}}>선택한 참여자가 1차 명단이 돼요. 금액·차수·정산방식·명단은 만든 뒤 '행사 진행'에서 자유롭게 바꿀 수 있어요.</div>
        </Card>
        <Card>
          <div style={{fontWeight:800,color:C.text,marginBottom:12,fontSize:14,display:'flex',alignItems:'center',gap:6}}><Icon n="credit-card" size={14} color={C.text}/>입금 계좌</div>
          {hasAccount?(
            <div style={{fontSize:13,color:C.textMid,padding:'11px 14px',background:C.inputBg,borderRadius:10,display:'flex',justifyContent:'space-between',alignItems:'center',border:`1.5px solid ${C.border}`}}>
              <span>{bank} {number} ({holder})</span>
              <Badge color={C.green}>자동 적용</Badge>
            </div>
          ):(
            <>
              <Field label="은행" value={bank} onChange={setBank} placeholder="카카오뱅크"/>
              <Field label="계좌번호" value={number} onChange={setNumber} placeholder="계좌번호" inputMode="numeric"/>
              <Field label="예금주" value={holder} onChange={setHolder} placeholder="이름"/>
            </>
          )}
        </Card>
        <Card>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{fontWeight:800,color:C.text,fontSize:14,display:'flex',alignItems:'center',gap:6}}><Icon n="users" size={14} color={C.text}/>참여자 선택 <span style={{color:C.accent}}>({selected.length}명)</span></div>
          </div>
          {groups.length>0&&(
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
              <button onClick={()=>{
                const allKeys=allMembers.map(m=>m.name+(m.sid?`_${m.sid}`:''));
                const allSelected=allKeys.length>0&&allKeys.every(k=>selected.includes(k));
                setSelected(allSelected?[]:allKeys);
                setActiveG(-1);
              }} className="press" style={{padding:'6px 13px',borderRadius:16,border:`1.5px solid ${selected.length===allMembers.length&&allMembers.length>0?C.accent:C.border}`,background:selected.length===allMembers.length&&allMembers.length>0?C.accent:C.cardBg,color:selected.length===allMembers.length&&allMembers.length>0?'#fff':C.textMid,fontSize:12,fontWeight:700,cursor:'pointer'}}>
                전체 {selected.length===allMembers.length&&allMembers.length>0?<Icon n="check" size={11} color="#fff"/>:''}
              </button>
              {groups.map((g,i)=>({g,i})).filter(({g})=>(g.members||[]).length>0).map(({g,i})=>{
                const keys=(g.members||[]).map(m=>m.name+(m.sid?`_${m.sid}`:''));
                const allSel=keys.length>0&&keys.every(k=>selected.includes(k));
                return(
                  <button key={g.id} onClick={()=>{setActiveG(i);selectGroup(i);}} className="press" style={{padding:'6px 13px',borderRadius:16,border:`1.5px solid ${allSel?C.accent:C.border}`,background:allSel?C.accentBg:C.cardBg,color:allSel?C.accent:C.textMid,fontSize:12,fontWeight:700,cursor:'pointer',transition:'all 0.12s'}}>
                    {g.name} {allSel?<Icon n="check" size={11} color={C.accent}/>:''}
                  </button>
                );
              })}
            </div>
          )}
          <div style={{display:'flex',flexWrap:'wrap',gap:7,marginBottom:allMembers.length>0?14:0}}>
            {visibleMembers.map((m,mi)=>{
              const k=m.name+(m.sid?`_${m.sid}`:'');
              const isDup=dupBaseKeys.has(k);
              const dupCount=isDup?selected.filter(sk=>sk.startsWith(k+'__')).length:0;
              const sel=isDup?dupCount>0:selected.includes(k);
              return(
                <button key={`${k}_${mi}`} onClick={()=>toggle(m)} className="press" style={{padding:'8px 14px',borderRadius:20,border:`2px solid ${sel?C.accent:C.border}`,cursor:'pointer',fontSize:13,fontWeight:600,background:sel?C.accentBg:C.cardBg,color:sel?C.accent:C.textMid,transition:'all 0.12s'}}>
                  {displayName(m)}{isDup&&dupCount>0?` ✓${dupCount}`:''}
                </button>
              );
            })}
          </div>
          {Object.entries(extraMemberMap).filter(([k])=>selected.includes(k)).length>0&&(
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
              {Object.entries(extraMemberMap).filter(([k])=>selected.includes(k)).map(([k,label])=>(
                <span key={k} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'4px 10px 4px 12px',borderRadius:16,background:C.accentBg,border:`1.5px solid ${C.accent}40`,fontSize:12,color:C.accent,fontWeight:600}}>
                  {label}
                  <button onClick={()=>setSelected(s=>s.filter(x=>x!==k))} style={{background:'none',border:'none',cursor:'pointer',color:C.accent,fontSize:16,lineHeight:1,padding:'0 2px'}}>×</button>
                </span>
              ))}
            </div>
          )}
          {allMembers.length===0&&(
            <div style={{background:C.accentBg,borderRadius:14,padding:'14px 16px',marginBottom:10,border:`1px solid ${C.accent}20`}}>
              <div style={{fontWeight:700,color:C.text,fontSize:14,marginBottom:4}}>등록된 명단이 없네요</div>
              <div style={{fontSize:13,color:C.textMid,lineHeight:1.7,marginBottom:10}}>명단을 먼저 등록하면 매번 이름 없이 바로 선택할 수 있어요.</div>
              <button onClick={()=>nav.setView('setup')} style={{background:C.accent,color:'#fff',border:'none',borderRadius:10,padding:'8px 16px',fontSize:13,fontWeight:700,cursor:'pointer'}}>명단 등록하러 가기 →</button>
            </div>
          )}
          <div style={{marginTop:6}}>
            <div style={{fontSize:12,color:C.textDim,fontWeight:600,marginBottom:6}}>추가 참여자</div>
            <Field value={extraText} onChange={setExtraText} placeholder="홍길동&#10;김철수" multiline rows={2}/>
          </div>
        </Card>
        {err&&<div style={{color:C.red,fontSize:13,marginBottom:12,padding:'11px 14px',background:C.redBg,borderRadius:10,display:'flex',alignItems:'center',gap:6}}><Icon n="triangle-alert" size={14} color={C.red}/>{err}</div>}
        <Btn onClick={create} loading={loading}>정산 생성하기 →</Btn>
      </div>
    </div>
  );
}

// ── AdminEventScreen (플로우 구조) ───────────────────────
function AdminEventScreen({nav,event:initEvent,updateEvent,showToast,profile}){
  const [event,setEvent]=useState(initEvent);
  const [viewCount,setViewCount]=useState(0);
  const slideKey=`jungsan_slide_${initEvent.code}`;
  const [slide,setSlide]=useState(()=>parseInt(sessionStorage.getItem(slideKey)||'0',10));
  useEffect(()=>{sessionStorage.setItem(slideKey,String(slide));},[slide]);
  const [attDirty,setAttDirty]=useState(false);
  const saveAttRef=useRef(null);
  const [savePrompt,setSavePrompt]=useState(null);
  const [archiveConfirm,setArchiveConfirm]=useState(false);

  // 같은 정산을 보는 동안 App.events의 stale 사본이 realtime 최신 로컬 state를
  // 되살려 덮어쓰지 않도록, 다른 정산으로 이동(code 변경) 시에만 재동기화.
  useEffect(()=>setEvent(initEvent),[initEvent.code]);
  useRealtimeEvent(event.code,ev=>setEvent(ev));
  useEffect(()=>{api.getViewCount(event.code,null).then(c=>setViewCount(c));},[event.code]);

  const update=async ev=>{setEvent(ev);if(updateEvent) await updateEvent(ev);};

  const steps=['행사 진행','공유','정산 현황'];
  const stepDone=steps.map((_,i)=>i<slide);

  const safeNavigate=fn=>{
    if(slide===0&&attDirty){setSavePrompt({navigateFn:fn});}
    else fn();
  };

  const archiveEvent=async()=>{
    const payments={...event.payments};
    event.members.forEach(k=>{if(getPayStatus(payments[k])!=='paid') payments[k]={payStatus:'paid',hasBeenConfirmed:true,time:new Date().toISOString(),by:'archive'};});
    await update({...event,payments});
    nav.setView('home');
  };

  return(
    <div className="screen" style={{background:C.pageBg,display:'flex',flexDirection:'column'}}>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'center',padding:'16px 20px',background:C.cardBg,position:'sticky',top:0,zIndex:10,gap:12}}>
        <button onClick={()=>safeNavigate(()=>nav.setView('home'))} style={{background:'transparent',border:'none',color:C.text,cursor:'pointer',width:40,height:40,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,padding:0,margin:'-8px'}}><span className="ms" style={{fontSize:24}}>arrow_back</span></button>
        <div style={{flex:1}}>
          <div style={{fontSize:18,fontWeight:800,color:C.text,letterSpacing:-0.5}}>{event.name}</div>
          <div style={{fontSize:12,color:C.textDim,marginTop:2,display:'flex',alignItems:'center',gap:8}}>
            {steps[slide]}
            {viewCount>0&&<span style={{color:C.accent,display:'inline-flex',alignItems:'center',gap:3}}><Icon n="eye" size={12} color={C.accent}/>{viewCount}</span>}
          </div>
        </div>
        <button onClick={()=>setArchiveConfirm(true)} style={{background:C.inputBg,border:'none',borderRadius:12,color:C.textMid,cursor:'pointer',padding:'8px 14px',fontSize:13,fontWeight:700}}>종료</button>
      </div>

      <FlowStepper steps={steps} current={slide} done={stepDone} onStepClick={i=>safeNavigate(()=>setSlide(i))}/>

      {/* 슬라이드 콘텐츠 */}
      <div style={{flex:1,overflow:'auto'}}>
        <div style={{padding:'16px 18px'}}>
          {slide===0&&(
            <div className="fade-up">
              <RoundsSection event={event} updateEvent={update} onRoundAdded={()=>setSlide(1)} groups={profile?.groups} onAttDirtyChange={setAttDirty} saveAttFnRef={saveAttRef} profile={profile}/>
            </div>
          )}
          {slide===1&&(
            <div className="fade-up">
              <ShareSection event={event} showToast={showToast}/>
            </div>
          )}
          {slide===2&&(
            <div className="fade-up">
              <StatusSection event={event} updateEvent={update} groups={profile?.groups} showToast={showToast}/>
            </div>
          )}
        </div>
      </div>

      {/* 하단 네비게이션 */}
      <div style={{padding:'12px 20px 24px',background:C.cardBg,borderTop:`1px solid ${C.pageBg}`,display:'flex',gap:10}}>
        {slide>0&&<Btn variant="secondary" onClick={()=>safeNavigate(()=>setSlide(s=>s-1))} style={{flex:1}}>이전</Btn>}
        {slide<steps.length-1&&(
          <Btn onClick={()=>safeNavigate(()=>setSlide(s=>s+1))} style={{flex:2}}>다음</Btn>
        )}
        {slide===steps.length-1&&<Btn variant="green" onClick={()=>nav.setView('home')} style={{flex:2}}>홈으로</Btn>}
      </div>

      {savePrompt&&(
        <Modal isOpen={true} onClose={()=>setSavePrompt(null)} title="출석 미저장" closeOnBackdrop={false} showCloseButton={false}>
          <div style={{fontSize:14,color:C.textMid,marginBottom:20}}>출석이 저장되지 않았어요. 어떻게 할까요?</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <Btn onClick={async()=>{await saveAttRef.current?.();savePrompt.navigateFn();setSavePrompt(null);}}>저장 후 닫기</Btn>
            <Btn variant="secondary" onClick={()=>{savePrompt.navigateFn();setSavePrompt(null);}}>저장 안 하고 닫기</Btn>
            <Btn variant="ghost" onClick={()=>setSavePrompt(null)}>취소</Btn>
          </div>
        </Modal>
      )}
      {archiveConfirm&&(
        <Modal isOpen={true} onClose={()=>setArchiveConfirm(false)} title="정산 종료" closeOnBackdrop={false} showCloseButton={false}>
          <div style={{fontSize:14,color:C.textMid,marginBottom:20,lineHeight:1.7}}>미입금 인원을 모두 입금 처리하고 내역으로 이동해요. 계속할까요?</div>
          <div style={{display:'flex',gap:10}}>
            <Btn variant="ghost" onClick={()=>setArchiveConfirm(false)} style={{flex:1}}>취소</Btn>
            <Btn onClick={()=>{setArchiveConfirm(false);archiveEvent();}} style={{flex:2}}>종료하기</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ── AttendanceSection ──────────────────────────────────────
function AttendanceSection({event,updateEvent,onDone,groups}){
  const [search,setSearch]=useState('');
  const mm=event.memberMap||{};

  const toggleAtt=(k)=>{
    const isAbsent=event.attendance[k]===false;
    updateEvent({...event,attendance:{...event.attendance,[k]:isAbsent?true:false}});
  };
  const allPresent=event.members.every(k=>event.attendance[k]!==false);
  const filtered=event.members.filter(k=>!search||(mm[k]||k).includes(search));

  // groups가 2개 이상일 때만 그룹 묶음 표시
  const useGroupView=(groups||[]).length>1&&!search;
  const groupSections=React.useMemo(()=>{
    if(!useGroupView) return null;
    const assigned=new Set();
    const sections=(groups||[]).map(g=>{
      const gKeys=new Set((g.members||[]).map(m=>m.name+(m.sid?`_${m.sid}`:'')));
      const keys=event.members.filter(k=>gKeys.has(k));
      keys.forEach(k=>assigned.add(k));
      return {name:g.name,keys};
    }).filter(s=>s.keys.length>0);
    const unassigned=event.members.filter(k=>!assigned.has(k));
    if(unassigned.length>0) sections.push({name:'미분류',keys:unassigned});
    return sections;
  },[useGroupView,groups,event.members]);

  const MemberRow=({k})=>{
    const att=event.attendance[k];
    const isAbsent=att===false;
    return(
      <div key={k} onClick={()=>toggleAtt(k)} className="press" style={{
        background:isAbsent?C.inputBg:C.cardBg,borderRadius:12,padding:'10px 14px',marginBottom:6,
        display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',
        border:`1.5px solid ${isAbsent?C.red+'40':C.green+'40'}`,
        opacity:isAbsent?0.6:1,transition:'all 0.15s',
      }}>
        <div style={{fontWeight:600,color:isAbsent?C.textDim:C.text,fontSize:14,textDecoration:isAbsent?'line-through':'none'}}>{mm[k]||k}</div>
        <div style={{
          width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
          background:isAbsent?C.redBg:C.green,
          color:isAbsent?C.red:'#fff',transition:'all 0.15s',
        }}>{isAbsent?<Icon n="x" size={14} color={C.red}/>:<Icon n="check" size={14} color="#fff"/>}</div>
      </div>
    );
  };

  return(
    <div>
      {/* 전원 참석 버튼 */}
      <button onClick={()=>{
        const a={};
        event.members.forEach(k=>a[k]=true);
        updateEvent({...event,attendance:a});
      }} style={{
        width:'100%',marginBottom:8,padding:'11px',borderRadius:12,
        border:`2px solid ${allPresent?C.green:C.border}`,
        background:allPresent?C.green:C.cardBg,
        color:allPresent?'#fff':C.textMid,
        fontWeight:700,fontSize:14,cursor:'pointer',transition:'all 0.2s',
      }}>
        {allPresent?<><Icon n="check" size={14} color="#fff" style={{marginRight:4}}/>전원 참석</>:'전원 참석'}
      </button>

      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="이름 검색..."
        style={{width:'100%',padding:'10px 14px',background:C.inputBg,border:`1.5px solid ${C.border}`,borderRadius:12,fontSize:13,outline:'none',marginBottom:10}}
      />

      <div style={{maxHeight:380,overflowY:'auto'}}>
        {useGroupView?(
          groupSections.map(section=>(
            <div key={section.name} style={{marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:700,color:C.textDim,padding:'4px 4px 6px',letterSpacing:0.5}}>
                {section.name} ({section.keys.filter(k=>event.attendance[k]!==false).length}/{section.keys.length})
              </div>
              {section.keys.map(k=><MemberRow key={k} k={k}/>)}
            </div>
          ))
        ):(
          filtered.map(k=><MemberRow key={k} k={k}/>)
        )}
      </div>

      <div style={{marginTop:4,fontSize:11,color:C.textDim,textAlign:'center'}}>탭하면 불참 처리돼요</div>
    </div>
  );
}

// ── FeeConfigSection ───────────────────────────────────────
function FeeConfigSection({event,updateEvent}){
  const fc=event.feeConfig;
  const presentMembers=event.members.filter(k=>event.attendance[k]!==false);
  const totalMembers=presentMembers.length||1;

  const [totalCostInput,setTotalCostInput]=useState(String(fc?.totalCost||''));
  const [subsidyInput,setSubsidyInput]=useState(String(fc?.subsidyPerPaid||''));
  const [paidInput,setPaidInput]=useState(String(fc?.paidFeeAmount||''));
  const [unpaidInput,setUnpaidInput]=useState(String(fc?.unpaidFeeAmount||''));
  const [saved,setSaved]=useState(false);
  const saveTimerRef=useRef(null);
  const autoSaveTimerRef=useRef(null);
  const didMountRef=useRef(false);
  // 디바운스 대기 중(아직 저장 안 된) 입력이 있는지. 언마운트 flush용
  // (RoundsSection의 pendingRoundsRef 패턴과 동일).
  const pendingFeeRef=useRef(false);
  const saveFeeConfigRef=useRef(null);
  const fcModeRef=useRef(fc?.mode);
  fcModeRef.current=fc?.mode;

  useEffect(()=>{
    if(fc){
      setTotalCostInput(String(fc.totalCost||''));
      setSubsidyInput(String(fc.subsidyPerPaid||''));
      setPaidInput(String(fc.paidFeeAmount||''));
      setUnpaidInput(String(fc.unpaidFeeAmount||''));
    }
  },[event.code]);

  useEffect(()=>{
    if(!didMountRef.current){didMountRef.current=true;return;}
    if(!fc) return;
    pendingFeeRef.current=true;
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current=setTimeout(()=>saveFeeConfig(fc.mode),700);
    return()=>clearTimeout(autoSaveTimerRef.current);
  },[totalCostInput,subsidyInput,paidInput,unpaidInput]);

  // 언마운트 시: 디바운스 대기 중인 입력을 즉시 저장.
  // 700ms 안에 슬라이드 이동(언마운트)하면 위 cleanup이 clearTimeout만 해서
  // round_1.amount가 0으로 남던 버그 방지. feeConfig 해제됐으면(fcMode 없음) skip.
  useEffect(()=>()=>{
    clearTimeout(autoSaveTimerRef.current);
    if(pendingFeeRef.current&&fcModeRef.current&&saveFeeConfigRef.current){
      saveFeeConfigRef.current(fcModeRef.current);
    }
  },[]);

  const previewAuto=()=>{
    const total=Number(totalCostInput)||0;
    const sub=Number(subsidyInput)||0;
    const unpaid=total?Math.ceil(total/totalMembers):0;
    return {unpaid,paid:Math.max(0,unpaid-sub)};
  };

  const saveFeeConfig=(mode)=>{
    pendingFeeRef.current=false;
    if(mode==='auto'){
      const {unpaid,paid}=previewAuto();
      const newFc={mode:'auto',totalCost:Number(totalCostInput)||0,subsidyPerPaid:Number(subsidyInput)||0,paidFeeAmount:paid,unpaidFeeAmount:unpaid};
      const rounds=event.rounds.map(r=>r.id==='round_1'?{...r,amount:Number(totalCostInput)||0}:r);
      updateEvent({...event,feeConfig:newFc,rounds});
    } else {
      const newFc={mode:'manual',totalCost:null,subsidyPerPaid:null,paidFeeAmount:Number(paidInput)||0,unpaidFeeAmount:Number(unpaidInput)||0};
      updateEvent({...event,feeConfig:newFc});
    }
    if(saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaved(true);
    saveTimerRef.current=setTimeout(()=>setSaved(false),1500);
  };
  saveFeeConfigRef.current=saveFeeConfig; // 언마운트 flush가 최신 클로저 사용

  const switchMode=(newMode)=>{
    if(fc?.mode===newMode) return;
    if(newMode==='auto'&&fc?.mode==='manual'){
      if(!window.confirm('자동 계산 값으로 변경됩니다. 직접 입력한 금액은 초기화됩니다.')) return;
    }
    if(newMode==='manual'&&fc?.mode==='auto'){
      const {unpaid,paid}=previewAuto();
      setPaidInput(String(paid||''));
      setUnpaidInput(String(unpaid||''));
    }
    saveFeeConfig(newMode);
  };

  const activate=()=>updateEvent({...event,feeConfig:{mode:'auto',totalCost:0,subsidyPerPaid:0,paidFeeAmount:0,unpaidFeeAmount:0}});
  const deactivate=()=>{
    if(!window.confirm('정산 방식 설정을 해제할까요? 기본 1/n 계산으로 돌아갑니다.')) return;
    updateEvent({...event,feeConfig:null});
  };

  const {unpaid:pvUnpaid,paid:pvPaid}=previewAuto();

  return(
    <div style={{background:C.cardBg,borderRadius:14,padding:'14px',marginBottom:12,border:`1.5px solid ${C.accent}30`,boxShadow:C.shadow}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:fc?12:6}}>
        <div style={{fontWeight:800,fontSize:14,color:C.text}}>정산 방식{saved&&<span style={{fontSize:11,color:C.textDim,fontWeight:400,marginLeft:6}}>방금 저장됨</span>}</div>
        {fc?(
          <button onClick={deactivate} style={{fontSize:11,color:C.textMid,background:'none',border:'none',cursor:'pointer',padding:'2px 4px'}}>해제</button>
        ):(
          <button onClick={activate} style={{fontSize:12,color:C.accent,fontWeight:700,background:C.accentBg,border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>설정하기</button>
        )}
      </div>
      {!fc&&<div style={{fontSize:12,color:C.textDim,lineHeight:1.5}}>학생회비 납부 여부에 따라 금액을 다르게 설정할 수 있어요</div>}
      {fc&&(
        <>
          <div style={{display:'flex',gap:6,marginBottom:14}}>
            {[['auto','자동 계산'],['manual','직접 입력']].map(([m,label])=>(
              <button key={m} onClick={()=>switchMode(m)} style={{flex:1,padding:'9px',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer',border:'none',background:fc.mode===m?C.accent:C.inputBg,color:fc.mode===m?'#fff':C.textMid}}>{label}</button>
            ))}
          </div>
          {fc.mode==='auto'&&(
            <div className="fade-up">
              <Field label="총 행사비 (원)" value={totalCostInput} onChange={v=>setTotalCostInput(v.replace(/[^0-9]/g,''))} inputMode="numeric" placeholder="300000"/>
              <Field label="학생회비 지원 단가 (납부자당)" value={subsidyInput} onChange={v=>setSubsidyInput(v.replace(/[^0-9]/g,''))} inputMode="numeric" placeholder="5000"/>
              <div style={{background:C.accentBg,borderRadius:10,padding:'10px 14px',marginBottom:12}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                  <span style={{fontSize:13,color:C.textMid}}>학생회비 납부자</span>
                  <span style={{fontSize:15,fontWeight:900,color:C.accent}}>{fmtKRW(pvPaid)}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <span style={{fontSize:13,color:C.textMid}}>학생회비 미납자</span>
                  <span style={{fontSize:15,fontWeight:900,color:C.red}}>{fmtKRW(pvUnpaid)}</span>
                </div>
              </div>
            </div>
          )}
          {fc.mode==='manual'&&(
            <div className="fade-up">
              <Field label="납부자 공지 금액 (원)" value={paidInput} onChange={v=>setPaidInput(v.replace(/[^0-9]/g,''))} inputMode="numeric" placeholder="8000"/>
              <Field label="미납자 공지 금액 (원)" value={unpaidInput} onChange={v=>setUnpaidInput(v.replace(/[^0-9]/g,''))} inputMode="numeric" placeholder="13000"/>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── RoundsSection ──────────────────────────────────────────
function RoundsSection({event,updateEvent,onRoundAdded,groups,onAttDirtyChange,saveAttFnRef,profile}){
  const mm=event.memberMap||{};
  const presentMembers=event.members.filter(k=>event.attendance[k]!==false);

  // 닫힌 차수 ID 세트 (기본: 빈 세트 = 모두 열림)
  const [closedRoundIds,setClosedRoundIds]=useState(()=>new Set());

  // 차수별 편집 상태 맵
  const [roundAmounts,setRoundAmounts]=useState(()=>{
    const m={};event.rounds.forEach(r=>{m[r.id]=r.amount>0?String(r.amount):'';});return m;
  });
  const [roundExtras,setRoundExtras]=useState(()=>{
    const m={};event.rounds.forEach(r=>{m[r.id]=[...(r.extraMembers||[])];});return m;
  });
  const [extraInputs,setExtraInputs]=useState({});
  const [roundSavedId,setRoundSavedId]=useState(null);
  const roundSavedTimerRef=useRef(null);
  const [deleteRoundConfirm,setDeleteRoundConfirm]=useState(null);
  const [showRoster,setShowRoster]=useState(false);
  const [newMemberName,setNewMemberName]=useState('');
  const [newMemberSid,setNewMemberSid]=useState('');
  const [rosterErr,setRosterErr]=useState('');
  const [removeConfirm,setRemoveConfirm]=useState(null);

  const roundTimersRef=useRef({});
  const roundAmountsRef=useRef(roundAmounts);
  const roundExtrasRef=useRef(roundExtras);
  const eventRef=useRef(event);
  const updateEventRef=useRef(updateEvent);
  // 아직 DB에 저장 안 된(디바운스 대기 중) 차수 id 집합.
  // 언마운트 flush가 "건드리지도 않은 차수"를 stale 로컬값으로 0원 덮어쓰던 버그 방지용.
  const pendingRoundsRef=useRef(new Set());
  roundAmountsRef.current=roundAmounts;
  roundExtrasRef.current=roundExtras;
  eventRef.current=event;
  updateEventRef.current=updateEvent;
  // 기존 정산 보존: includeOrganizer 키가 한 번이라도 저장된(구 모델 생성) 정산만 '본인' 유지.
  // 신규 정산은 이 키를 만들지 않아 총무 자동 추가/본인 표시/정산 포함이 없음.
  const eventHasLegacyOrganizer=(event.rounds||[]).some(r=>'includeOrganizer' in r);

  useEffect(()=>{
    if(!event.rounds.some(r=>r.label==='1차')){
      const r0={id:'round_1',label:'1차',amount:0,members:[...presentMembers]};
      updateEvent({...event,rounds:[r0]});
      setRoundAmounts({'round_1':''});
      setRoundExtras({'round_1':[]});
    }
  },[]);

  // 새 차수 추가 시 상태 맵 확장
  useEffect(()=>{
    setRoundAmounts(prev=>{
      const next={...prev};
      event.rounds.forEach(r=>{if(!(r.id in next))next[r.id]=r.amount>0?String(r.amount):'';});
      return next;
    });
    setRoundExtras(prev=>{
      const next={...prev};
      event.rounds.forEach(r=>{if(!(r.id in next))next[r.id]=[...(r.extraMembers||[])];});
      return next;
    });
  },[event.rounds.length]);

  // 언마운트 시: 디바운스 대기 중인(아직 저장 안 된) 차수만 최신 event에 patch.
  // 과거엔 모든 차수를 stale 로컬맵으로 재작성 → 이 클라이언트가 입력한 적 없는
  // 차수의 금액/임시인원이 0/빈값으로 덮어써지는 데이터 손실([A][B])이 있었음.
  useEffect(()=>()=>{
    Object.values(roundTimersRef.current).forEach(t=>clearTimeout(t));
    const pending=[...pendingRoundsRef.current];
    if(pending.length===0) return;
    const ev=eventRef.current;
    const fc=ev.feeConfig;
    const newRounds=ev.rounds.map(r=>{
      if(!pendingRoundsRef.current.has(r.id)) return r; // 건드린 적 없는 차수는 그대로 보존
      const roundAmt=roundAmountsRef.current[r.id]||'';
      const extra=roundExtrasRef.current[r.id]||[];
      const isFirst=ev.rounds[0]?.id===r.id;
      const useFc=isFirst&&fc?.paidFeeAmount!=null&&(fc.paidFeeAmount||fc.unpaidFeeAmount);
      const amtNum=Number(roundAmt.replace(/[^0-9]/g,''))||0;
      return useFc?{...r,extraMembers:[...extra]}:{...r,amount:amtNum,extraMembers:[...extra]};
    });
    pendingRoundsRef.current.clear();
    updateEventRef.current({...ev,rounds:newRounds});
  },[]);

  const saveRoundNow=(rid,amt,extra,ev)=>{
    const fc=ev.feeConfig;
    const isFirstRound=ev.rounds[0]?.id===rid;
    const useFc=isFirstRound&&fc?.paidFeeAmount!=null&&(fc.paidFeeAmount||fc.unpaidFeeAmount);
    const amtNum=Number((amt||'').replace(/[^0-9]/g,''))||0;
    const roundPatch=useFc?{extraMembers:[...extra]}:{amount:amtNum,extraMembers:[...extra]};
    const newRounds=ev.rounds.map(r=>r.id===rid?{...r,...roundPatch}:r);
    pendingRoundsRef.current.delete(rid); // 저장 완료 → pending 해제
    updateEventRef.current({...ev,rounds:newRounds});
    if(roundSavedTimerRef.current) clearTimeout(roundSavedTimerRef.current);
    setRoundSavedId(rid);
    roundSavedTimerRef.current=setTimeout(()=>setRoundSavedId(null),1500);
  };

  const setRoundAmount=(rid,val)=>{
    setRoundAmounts(p=>({...p,[rid]:val}));
    pendingRoundsRef.current.add(rid);
    clearTimeout(roundTimersRef.current[rid]);
    roundTimersRef.current[rid]=setTimeout(()=>{
      saveRoundNow(rid,val,roundExtrasRef.current[rid]||[],eventRef.current);
    },700);
  };

  const setRoundExtra=(rid,updater)=>{
    setRoundExtras(p=>{
      const next={...p,[rid]:updater(p[rid]||[])};
      pendingRoundsRef.current.add(rid);
      clearTimeout(roundTimersRef.current[rid]);
      roundTimersRef.current[rid]=setTimeout(()=>{
        saveRoundNow(rid,roundAmountsRef.current[rid]||'',next[rid]||[],eventRef.current);
      },700);
      return next;
    });
  };


  const doAddRound=()=>{
    const newRound={id:Date.now().toString(),label:`${event.rounds.length+1}차`,amount:0,members:[...presentMembers],extraMembers:[],...(eventHasLegacyOrganizer?{includeOrganizer:true}:{})};
    updateEvent({...event,rounds:[...event.rounds,newRound]});
    setRoundAmounts(p=>({...p,[newRound.id]:''}));
    setRoundExtras(p=>({...p,[newRound.id]:[]}));
    setClosedRoundIds(s=>{const n=new Set(s);n.delete(newRound.id);return n;});
  };

  const confirmDeleteRound=rid=>{
    const newRounds=event.rounds.filter(r=>r.id!==rid);
    updateEvent({...event,rounds:newRounds});
    setClosedRoundIds(s=>{const n=new Set(s);n.delete(rid);return n;});
    setDeleteRoundConfirm(null);
  };

  const toggleOrganizer=rid=>{
    const newRounds=event.rounds.map(r=>r.id===rid?{...r,includeOrganizer:r.includeOrganizer!==true}:r);
    updateEvent({...event,rounds:newRounds});
  };

  // 차수별 멤버 출석 토글 (rounds[i].members 직접 수정, 1차는 attendance 동기화)
  const toggleMemberInRound=(rid,key)=>{
    const r=event.rounds.find(r=>r.id===rid);
    if(!r) return;
    const members=r.members||[];
    const newMembers=members.includes(key)?members.filter(k=>k!==key):[...members,key];
    const newRounds=event.rounds.map(r=>r.id===rid?{...r,members:newMembers}:r);
    if(event.rounds[0]?.id===rid){
      const newAtt={...event.attendance};
      event.members.forEach(k=>{newAtt[k]=newMembers.includes(k);});
      updateEvent({...event,rounds:newRounds,attendance:newAtt});
    } else {
      updateEvent({...event,rounds:newRounds});
    }
  };

  // 출석 화면에서 명단 인라인 편집 (추가/제거). 이름 수정은 미지원 → 제거 후 재추가.
  const addMemberToRoster=()=>{
    const nm=newMemberName.trim();
    if(!nm) return;
    const sid=newMemberSid.trim().replace(/\s/g,'');
    const key=nm+(sid?`_${sid}`:'');
    if((event.members||[]).includes(key)){
      setRosterErr('이미 있는 이름이에요. 동명이인이면 이름을 다르게 적어주세요 (예: 민준2)');
      return;
    }
    // 신규 멤버는 1차(rounds[0])에 즉시 포함 + 출석 true → 그 자리에서 체크 가능
    const newRounds=event.rounds.map((r,i)=>i===0?{...r,members:[...new Set([...(r.members||[]),key])]}:r);
    updateEvent({
      ...event,
      members:[...(event.members||[]),key],
      memberMap:{...(event.memberMap||{}),[key]:sid?`${nm} (${sid})`:nm},
      attendance:{...(event.attendance||{}),[key]:true},
      rounds:newRounds,
    });
    setNewMemberName('');setNewMemberSid('');setRosterErr('');
  };
  const doRemoveMember=key=>{
    const memberMap={...(event.memberMap||{})};delete memberMap[key];
    const attendance={...(event.attendance||{})};delete attendance[key];
    const payments={...(event.payments||{})};delete payments[key];
    updateEvent({
      ...event,
      members:(event.members||[]).filter(k=>k!==key),
      memberMap,attendance,payments,
      paidFeeKeys:(event.paidFeeKeys||[]).filter(k=>k!==key),
      rounds:event.rounds.map(r=>({...r,members:(r.members||[]).filter(k=>k!==key)})),
    });
    setRemoveConfirm(null);
  };
  const requestRemoveMember=key=>{
    // 앱 표준 getPayStatus 기준 — none이 아니면(paid/requested/rejected) 입금·요청 흔적 있음
    const hasRecord=getPayStatus(event.payments?.[key])!=='none';
    if(hasRecord) setRemoveConfirm({key,name:mm[key]||key});
    else doRemoveMember(key);
  };

  // onAttDirtyChange는 더 이상 dirty 상태 없으므로 false 전달
  useEffect(()=>{onAttDirtyChange?.(false);},[]);

  const fc=event.feeConfig;

  const groupSections=React.useMemo(()=>{
    const validGroups=(groups||[]).filter(g=>(g.members||[]).length>0);
    if(validGroups.length<2) return null;
    const assigned=new Set();
    const sections=validGroups.map(g=>{
      const gKeys=new Set((g.members||[]).map(m=>m.name+(m.sid?`_${m.sid}`:'')));
      const keys=event.members.filter(k=>gKeys.has(k));
      keys.forEach(k=>assigned.add(k));
      return {name:g.name,keys};
    }).filter(s=>s.keys.length>0);
    const unassigned=event.members.filter(k=>!assigned.has(k));
    if(unassigned.length>0) sections.push({name:'미분류',keys:unassigned});
    return sections;
  },[groups,event.members]);

  if(event.rounds.length===0) return null;

  return(
    <div>
      {event.rounds.length===1&&(event.rounds[0]?.amount||0)<=0&&!event.feeConfig&&(
        <div style={{background:C.accentBg,borderRadius:12,padding:'12px 14px',marginBottom:10,fontSize:13,color:C.textMid,lineHeight:1.7,border:`1px solid ${C.accent}20`}}>
          <strong style={{color:C.text}}>출석 체크부터 시작하세요.</strong><br/>행사 끝나고 금액을 입력하면 1/N이 자동 계산돼요. 금액·정산방식·명단은 언제든 바꿀 수 있어요.
        </div>
      )}
      <FeeConfigSection event={event} updateEvent={updateEvent}/>

      {/* 명단 관리 (출석 화면에서 인라인 추가/제거) */}
      <div style={{background:C.cardBg,borderRadius:14,padding:'12px 14px',marginBottom:10,boxShadow:C.shadow,border:`1.5px solid ${C.border}`}}>
        <div onClick={()=>setShowRoster(s=>!s)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
          <div style={{fontWeight:800,fontSize:14,color:C.text}}>명단 관리 <span style={{fontSize:12,fontWeight:600,color:C.textDim}}>{(event.members||[]).length}명</span></div>
          <span className="ms" style={{fontSize:20,color:C.textDim}}>{showRoster?'expand_less':'expand_more'}</span>
        </div>
        {showRoster&&(
          <div style={{marginTop:12}}>
            <div style={{display:'flex',gap:6,marginBottom:rosterErr?6:10}}>
              <input value={newMemberName} onChange={e=>{setNewMemberName(e.target.value);setRosterErr('');}}
                onKeyDown={e=>{if(e.key==='Enter')addMemberToRoster();}} placeholder="이름"
                style={{flex:2,padding:'9px 12px',borderRadius:10,border:`1.5px solid ${C.border}`,background:C.inputBg,fontSize:13,color:C.text,outline:'none',boxSizing:'border-box'}}/>
              <input value={newMemberSid} onChange={e=>setNewMemberSid(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter')addMemberToRoster();}} placeholder="학번(선택)" inputMode="numeric"
                style={{flex:2,padding:'9px 12px',borderRadius:10,border:`1.5px solid ${C.border}`,background:C.inputBg,fontSize:13,color:C.text,outline:'none',boxSizing:'border-box'}}/>
              <button onClick={addMemberToRoster} disabled={!newMemberName.trim()} style={{flex:1,padding:'9px 0',borderRadius:10,border:'none',background:newMemberName.trim()?C.accent:C.disabled,color:'#fff',fontSize:13,fontWeight:700,cursor:newMemberName.trim()?'pointer':'default'}}>추가</button>
            </div>
            {rosterErr&&<div style={{fontSize:12,color:C.orange,fontWeight:600,marginBottom:10,lineHeight:1.5}}>{rosterErr}</div>}
            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              {(event.members||[]).map(k=>(
                <span key={k} style={{display:'inline-flex',alignItems:'center',gap:5,padding:'5px 8px 5px 12px',borderRadius:20,background:C.inputBg,border:`1px solid ${C.border}`,fontSize:13,color:C.textMid,fontWeight:600}}>
                  {mm[k]||k}
                  <button onClick={()=>requestRemoveMember(k)} style={{background:'none',border:'none',cursor:'pointer',color:C.textDim,fontSize:15,lineHeight:1,padding:'0 2px'}}>×</button>
                </span>
              ))}
              {(event.members||[]).length===0&&<span style={{fontSize:12,color:C.textDim}}>명단이 비어 있어요. 위에서 추가하세요.</span>}
            </div>
            <div style={{fontSize:11,color:C.textDim,marginTop:8,lineHeight:1.6}}>잘못 추가했으면 ×로 제거하세요. 이름을 바꾸려면 제거 후 다시 추가해주세요.</div>
          </div>
        )}
      </div>

      {/* 차수 카드들 */}
      {event.rounds.map((r,ridx)=>{
        const isClosed=closedRoundIds.has(r.id);
        const isFirst=ridx===0;
        const useFc=isFirst&&fc?.paidFeeAmount!=null&&(fc.paidFeeAmount||fc.unpaidFeeAmount);
        const amt=roundAmounts[r.id]||'';
        const amtNum=Number(amt.replace(/[^0-9]/g,''))||0;
        const extraList=roundExtras[r.id]||[];
        const rMembers=r.members||presentMembers;
        const includeOrg=r.includeOrganizer===true;
        const totalCount=rMembers.length+extraList.length+(includeOrg?1:0);
        const perPerson=amtNum>0&&totalCount>0?Math.ceil(amtNum/totalCount):0;

        return(
          <div key={r.id} style={{background:C.cardBg,borderRadius:14,padding:'14px',marginBottom:10,boxShadow:C.shadow,border:`1.5px solid ${!isClosed?C.accent+'50':C.border}`}}>
            {/* 차수 헤더 (클릭으로 접기/펼치기) */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',marginBottom:isClosed?0:12}}
              onClick={()=>setClosedRoundIds(s=>{const n=new Set(s);isClosed?n.delete(r.id):n.add(r.id);return n;})}>
              <div style={{fontWeight:800,fontSize:15,color:C.text}}>
                {r.label}
                {!isClosed&&(roundSavedId===r.id
                  ?<span style={{fontSize:11,color:C.textDim,fontWeight:400,marginLeft:6}}>방금 저장됨</span>
                  :<span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:11,color:C.textDim,fontWeight:400,marginLeft:6}}><span style={{width:5,height:5,borderRadius:'50%',background:C.green,display:'inline-block',flexShrink:0}}/>자동 저장</span>
                )}
              </div>
              <span className="ms" style={{fontSize:20,color:C.textDim}}>{isClosed?'expand_more':'expand_less'}</span>
            </div>

            {/* 차수 상태 한 줄 (접힘/펼침 공통) */}
            <div style={{display:'flex',flexWrap:'wrap',gap:'4px 12px',fontSize:11,color:C.textDim,marginBottom:isClosed?0:12}}>
              <span>출석 {rMembers.length+(includeOrg?1:0)}/{(event.members||[]).length+(includeOrg?1:0)}</span>
              <span>금액 {r.amount>0?fmtKRW(r.amount):(useFc?'학생회비':'미입력')}</span>
              <span>공유 {(useFc||r.amount>0)?'가능':'금액 입력 후'}</span>
              <span>입금 {rMembers.filter(k=>getPayStatus(event.payments?.[k])==='paid').length}/{rMembers.length}</span>
            </div>

            {!isClosed&&(
              <>
                {/* 금액 입력 */}
                {useFc?(
                  <div style={{fontSize:12,color:C.textMid,background:C.accentBg,borderRadius:10,padding:'10px 14px',marginBottom:12}}>
                    금액은 위 정산 방식 설정에서 관리됩니다<br/>
                    <span style={{color:C.accent,fontWeight:700}}>납부자 {fmtKRW(fc.paidFeeAmount)} · 미납자 {fmtKRW(fc.unpaidFeeAmount)}</span>
                  </div>
                ):(
                  <>
                    <Field label="총 금액 (원)" value={amt} onChange={v=>setRoundAmount(r.id,v.replace(/[^0-9]/g,''))} inputMode="numeric" placeholder="150000"/>
                    {!(amtNum>0)&&<div style={{fontSize:12,color:C.textDim,lineHeight:1.6,marginTop:-4,marginBottom:12}}>행사 끝나고 금액을 입력하세요. 먼저 출석부터 체크해도 좋아요.</div>}
                    {perPerson>0&&(
                      <div style={{background:C.accentBg,borderRadius:10,padding:'10px 14px',marginBottom:12}}>
                        <div style={{display:'flex',justifyContent:'space-between'}}>
                          <span style={{fontSize:13,color:C.textMid}}>1인당 ({totalCount}명)</span>
                          <span style={{fontSize:15,fontWeight:900,color:C.accent}}>{fmtKRW(perPerson)}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* 출석 체크 (차수별) */}
                <div style={{marginBottom:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div style={{fontSize:12,color:C.textMid,fontWeight:700}}>
                      출석 <span style={{fontWeight:400,color:C.textDim}}>{rMembers.length+(includeOrg?1:0)}명</span>
                    </div>
                    <div style={{display:'flex',gap:8}}>
                      <button onClick={()=>{const newM=[...event.members];const newRounds=event.rounds.map(r2=>r2.id===r.id?{...r2,members:newM,...(eventHasLegacyOrganizer?{includeOrganizer:true}:{})}:r2);const newAtt=isFirst?Object.fromEntries(event.members.map(k=>[k,true])):event.attendance;updateEvent({...event,rounds:newRounds,...(isFirst?{attendance:newAtt}:{})});}} style={{fontSize:11,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:0,fontWeight:600}}>전원 참석</button>
                      <button onClick={()=>{const newRounds=event.rounds.map(r2=>r2.id===r.id?{...r2,members:[],...(eventHasLegacyOrganizer?{includeOrganizer:false}:{})}:r2);const newAtt=isFirst?Object.fromEntries(event.members.map(k=>[k,false])):event.attendance;updateEvent({...event,rounds:newRounds,...(isFirst?{attendance:newAtt}:{})});}} style={{fontSize:11,color:C.textDim,background:'none',border:'none',cursor:'pointer',padding:0,fontWeight:600}}>전원 불참</button>
                    </div>
                  </div>
                  {groupSections?(
                    <>
                      {groupSections.map(sec=>{
                        const secIn=sec.keys.filter(k=>rMembers.includes(k)).length;
                        return(
                          <div key={sec.name} style={{marginBottom:10}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
                              <span style={{fontSize:11,fontWeight:700,color:C.textDim,letterSpacing:0.3}}>{sec.name} {secIn}/{sec.keys.length}명</span>
                              <button onClick={()=>{const newM=[...new Set([...rMembers,...sec.keys])];const newRounds=event.rounds.map(r2=>r2.id===r.id?{...r2,members:newM}:r2);const newAtt=isFirst?{...event.attendance,...Object.fromEntries(sec.keys.map(k=>[k,true]))}:event.attendance;updateEvent({...event,rounds:newRounds,...(isFirst?{attendance:newAtt}:{})});}} style={{fontSize:11,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:0,fontWeight:600}}>전체 선택</button>
                            </div>
                            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                              {sec.keys.map(k=>{
                                const isIn=rMembers.includes(k);
                                return(
                                  <div key={k} onClick={()=>toggleMemberInRound(r.id,k)} className="press"
                                    style={{display:'flex',alignItems:'center',gap:3,padding:'5px 10px',borderRadius:20,cursor:'pointer',background:isIn?'#EEEDFE':'#F1EFE8',border:`1px solid ${isIn?'#D4D1F5':'#E0DDD5'}`,transition:'all 0.15s'}}>
                                    {isIn&&<Icon n="check" size={11} color="#3C3489"/>}
                                    <span style={{fontSize:13,fontWeight:600,color:isIn?'#3C3489':'#888780'}}>{mm[k]||k}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      {/* 본인 그룹 (구 모델 정산만) */}
                      {eventHasLegacyOrganizer&&(
                      <div>
                        <div style={{marginBottom:5}}>
                          <span style={{fontSize:11,fontWeight:700,color:C.textDim,letterSpacing:0.3}}>본인</span>
                        </div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                          <div onClick={()=>toggleOrganizer(r.id)} className="press"
                            style={{display:'flex',alignItems:'center',gap:3,padding:'5px 10px',borderRadius:20,cursor:'pointer',background:includeOrg?'#EEEDFE':'#F1EFE8',border:`1px solid ${includeOrg?'#D4D1F5':'#E0DDD5'}`,transition:'all 0.15s'}}>
                            {includeOrg&&<Icon n="check" size={11} color="#3C3489"/>}
                            <span style={{fontSize:13,fontWeight:600,color:includeOrg?'#3C3489':'#888780'}}>{profile?.name||'이름'} <span style={{fontSize:11,fontWeight:400,opacity:0.7}}>(본인)</span></span>
                          </div>
                        </div>
                      </div>
                      )}
                    </>
                  ):(
                    <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                      {event.members.map(k=>{
                        const isIn=rMembers.includes(k);
                        return(
                          <div key={k} onClick={()=>toggleMemberInRound(r.id,k)} className="press"
                            style={{display:'flex',alignItems:'center',gap:3,padding:'5px 10px',borderRadius:20,cursor:'pointer',background:isIn?'#EEEDFE':'#F1EFE8',border:`1px solid ${isIn?'#D4D1F5':'#E0DDD5'}`,transition:'all 0.15s'}}>
                            {isIn&&<Icon n="check" size={11} color="#3C3489"/>}
                            <span style={{fontSize:13,fontWeight:600,color:isIn?'#3C3489':'#888780'}}>{mm[k]||k}</span>
                          </div>
                        );
                      })}
                      {/* 총무 칩 (구 모델 정산만) */}
                      {eventHasLegacyOrganizer&&(
                      <div onClick={()=>toggleOrganizer(r.id)} className="press"
                        style={{display:'flex',alignItems:'center',gap:3,padding:'5px 10px',borderRadius:20,cursor:'pointer',background:includeOrg?'#EEEDFE':'#F1EFE8',border:`1px solid ${includeOrg?'#D4D1F5':'#E0DDD5'}`,transition:'all 0.15s'}}>
                        {includeOrg&&<Icon n="check" size={11} color="#3C3489"/>}
                        <span style={{fontSize:13,fontWeight:600,color:includeOrg?'#3C3489':'#888780'}}>{profile?.name||'이름'} <span style={{fontSize:11,fontWeight:400,opacity:0.7}}>(본인)</span></span>
                      </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 임시 인원 */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:12,color:C.textMid,fontWeight:700,marginBottom:6}}>임시 인원 ({extraList.length}명) <span style={{fontWeight:400,color:C.orange,fontSize:11}}>링크 공유 제외</span></div>
                  {extraList.length>0&&(
                    <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8}}>
                      {extraList.map((em,ei)=>(
                        <div key={ei} style={{display:'flex',alignItems:'center',gap:4,padding:'4px 9px',borderRadius:12,background:C.orange+'20',border:`1.5px solid ${C.orange}50`}}>
                          <span style={{fontSize:10,fontWeight:800,color:C.orange}}>임시</span>
                          <span style={{fontSize:12,color:C.text,fontWeight:600}}>{em.name}</span>
                          <button onClick={()=>setRoundExtra(r.id,s=>s.filter((_,j)=>j!==ei))} style={{background:'none',border:'none',cursor:'pointer',color:C.textMid,fontSize:14,lineHeight:1,padding:'0 0 0 2px'}}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{display:'flex',gap:6}}>
                    <input value={extraInputs[r.id]||''} onChange={e=>setExtraInputs(p=>({...p,[r.id]:e.target.value}))} placeholder="이름 입력"
                      onKeyDown={e=>{if(e.key==='Enter'&&(extraInputs[r.id]||'').trim()){const name=(extraInputs[r.id]||'').trim();setRoundExtra(r.id,s=>[...s,{id:'em_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),name}]);setExtraInputs(p=>({...p,[r.id]:''}));}}}
                      style={{flex:1,padding:'7px 10px',borderRadius:8,border:`1.5px solid ${C.border}`,background:C.inputBg,fontSize:13,color:C.text,outline:'none'}}
                    />
                    <button onClick={()=>{const name=(extraInputs[r.id]||'').trim();if(name){setRoundExtra(r.id,s=>[...s,{id:'em_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),name}]);setExtraInputs(p=>({...p,[r.id]:''}));}}} style={{padding:'7px 12px',borderRadius:8,background:C.orange+'20',border:`1.5px solid ${C.orange}50`,color:C.orange,fontWeight:700,fontSize:13,cursor:'pointer'}}>추가</button>
                  </div>
                </div>

                {/* 차수 삭제 */}
                {!isFirst&&(
                  <div style={{marginBottom:10,textAlign:'right'}}>
                    <button onClick={()=>setDeleteRoundConfirm(r.id)} style={{fontSize:12,color:C.red,background:'none',border:'none',cursor:'pointer'}}>이 차수 삭제</button>
                  </div>
                )}

              </>
            )}
          </div>
        );
      })}

      <button onClick={doAddRound} style={{width:'100%',padding:'12px',borderRadius:14,border:`2px dashed ${C.border}`,background:'none',color:C.textMid,fontWeight:700,fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
        <Icon n="add" size={16} color={C.textMid}/>차수 추가
      </button>

      {event.rounds.length>1&&event.rounds.some(r=>r.amount>0)&&(
        <div style={{textAlign:'right',fontSize:13,color:C.textMid,marginTop:10}}>
          합계 <span style={{color:C.text,fontWeight:900}}>{fmtKRW(event.rounds.reduce((s,r)=>s+r.amount,0))}</span>
        </div>
      )}

      {deleteRoundConfirm&&(()=>{
        const r=event.rounds.find(r=>r.id===deleteRoundConfirm);
        return(
          <Modal isOpen={true} onClose={()=>setDeleteRoundConfirm(null)} title="차수 삭제" closeOnBackdrop={false} showCloseButton={false}>
            <div style={{fontSize:14,color:C.textMid,marginBottom:20}}><strong style={{color:C.text}}>{r?.label||'이 차수'}</strong>를 삭제할까요? 되돌릴 수 없어요.</div>
            <div style={{display:'flex',gap:10}}>
              <Btn variant="ghost" onClick={()=>setDeleteRoundConfirm(null)} style={{flex:1}}>취소</Btn>
              <Btn onClick={()=>confirmDeleteRound(deleteRoundConfirm)} style={{flex:2,background:C.red}}>삭제</Btn>
            </div>
          </Modal>
        );
      })()}

      {removeConfirm&&(
        <Modal isOpen={true} onClose={()=>setRemoveConfirm(null)} title="명단에서 제거" closeOnBackdrop={false} showCloseButton={false}>
          <div style={{fontSize:14,color:C.textMid,marginBottom:20,lineHeight:1.7}}><strong style={{color:C.text}}>{removeConfirm.name}</strong>님은 입금/요청 기록이 있어요.<br/>제거하면 이 정산의 입금 기록도 함께 삭제돼요. 계속할까요?</div>
          <div style={{display:'flex',gap:10}}>
            <Btn variant="ghost" onClick={()=>setRemoveConfirm(null)} style={{flex:1}}>취소</Btn>
            <Btn onClick={()=>doRemoveMember(removeConfirm.key)} style={{flex:2,background:C.red}}>제거</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── ShareSection ───────────────────────────────────────────
function ShareSection({event,showToast}){
  const directLink=getLink(`code=${event.code}`);
  const fc=event.feeConfig;
  const copy=async(text,label)=>{await copyText(text);showToast(`${label} 복사됐어요`);};
  const isFcRound=i=>i===0&&fc?.paidFeeAmount!=null&&(fc.paidFeeAmount||fc.unpaidFeeAmount);
  const canShare=(r,i)=>!!isFcRound(i)||r.amount>0;
  const roundMsg=(r,i)=>{
    const head=`[${event.date} ${event.name}] ${r.label} 정산 안내`;
    if(isFcRound(i)){
      return [head,'',
        ...(fc.paidFeeAmount>0?[`📌 학생회비 납부자: ${fmtKRW(fc.paidFeeAmount)}`]:[]),
        ...(fc.unpaidFeeAmount>0?[`📌 학생회비 미납자: ${fmtKRW(fc.unpaidFeeAmount)}`]:[]),
        '','아래 링크에서 내가 낼 돈을 확인하고 입금해주세요.','','(정산해 · 간편한 모임 정산 서비스)',
        directLink].join('\n');
    }
    const totalCount=(r.members?.length||0)+(r.extraMembers?.length||0)+(r.includeOrganizer===true?1:0);
    const perPerson=r.amount>0&&totalCount>0?Math.ceil(r.amount/totalCount):0;
    return `${head}\n\n1인당 ${fmtKRW(perPerson)} (${totalCount}명)\n아래 링크에서 내가 낼 돈을 확인하고 입금해주세요.\n\n(정산해 · 간편한 모임 정산 서비스)\n${directLink}`;
  };
  return(
    <div>
      <div style={{fontSize:12,color:C.textDim,fontWeight:600,marginBottom:10,lineHeight:1.6}}>차수별로 따로 공유할 수 있어요. 금액을 입력한 차수만 공유돼요.</div>
      {event.rounds.map((r,i)=>{
        const ok=canShare(r,i);
        const fcR=isFcRound(i);
        const msg=roundMsg(r,i);
        return(
          <div key={r.id} style={{background:C.cardBg,borderRadius:14,padding:'14px',marginBottom:10,boxShadow:C.shadow,border:`1.5px solid ${ok?C.accent+'40':C.border}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:ok?10:0}}>
              <div style={{fontWeight:800,fontSize:15,color:C.text}}>{r.label}</div>
              <div style={{fontSize:13,fontWeight:700,color:ok?C.accent:C.textDim}}>{r.amount>0?fmtKRW(r.amount):(fcR?'학생회비 정산':'금액 미입력')}</div>
            </div>
            {ok?(
              <>
                <div style={{background:C.inputBg,borderRadius:10,padding:'10px 12px',fontSize:12,color:C.textMid,lineHeight:1.8,marginBottom:8,whiteSpace:'pre-wrap',border:`1px solid ${C.border}`}}>{msg}</div>
                <div style={{display:'flex',gap:8}}>
                  <Btn onClick={async()=>{posthog.capture('정산_링크_공유',{차수:r.label});const shared=await shareText(msg);if(!shared){await copy(msg,'메시지');}else showToast('공유 완료');}} small style={{flex:2}}><Icon n="message-circle" size={14} color="#fff" style={{marginRight:4}}/>카톡 공유</Btn>
                  <Btn onClick={()=>copy(directLink,'링크')} variant="secondary" small style={{flex:1}}><Icon n="link" size={14} color={C.textMid} style={{marginRight:4}}/>링크</Btn>
                </div>
              </>
            ):(
              <div style={{fontSize:12,color:C.textDim,marginTop:6,lineHeight:1.6}}>금액 입력 후 공유 가능 — '행사 진행' 탭에서 {r.label} 금액을 입력하세요.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── ExcelUploadModal ───────────────────────────────────────
function ExcelUploadModal({uploading,fileRef,onClose}){
  const [bankOpen,setBankOpen]=useState(new Set());
  const toggle=id=>setBankOpen(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  useEffect(()=>{if(DECRYPT_API_URL) fetch(`${DECRYPT_API_URL}/health`).catch(()=>{});},[]);
  return(
    <Modal isOpen={true} onClose={onClose} title={<><Icon n="bar-chart" size={15} color={C.text} style={{marginRight:4}}/>자동 대조</>}>
      <div style={{textAlign:'center',marginBottom:16}}>
        <div style={{width:64,height:64,borderRadius:32,background:C.accent+'20',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px'}}><Icon n="bar-chart" size={32} color={C.accent}/></div>
        <div style={{color:C.textMid,fontSize:13,lineHeight:1.7}}>은행 거래내역(엑셀파일) 업로드 후 자동 대조해요</div>
      </div>
      <div style={{marginBottom:14,padding:'9px 14px',background:C.accentBg,borderRadius:10,fontSize:12,color:C.textMid,display:'flex',alignItems:'center',gap:6}}>
        <Icon n="lock" size={13} color={C.accent}/><span>거래내역은 브라우저에서만 처리되며 서버에 저장되지 않아요.</span>
      </div>
      <div style={{textAlign:'center',marginBottom:12}}>
        <Btn onClick={()=>fileRef.current?.click()} loading={uploading}>파일 선택하기</Btn>
        <div style={{marginTop:8,fontSize:12,color:C.textDim}}>지원: .xlsx, .xls, .csv</div>
      </div>
      <Card style={{padding:'16px'}}>
        <div style={{fontWeight:800,color:C.text,fontSize:14,marginBottom:12,display:'flex',alignItems:'center',gap:6}}><Icon n="smartphone" size={14} color={C.text}/>은행별 다운로드 방법</div>
        <div style={{borderRadius:12,overflow:'hidden',marginBottom:8,border:`1.5px solid ${bankOpen.has('toss')?C.accent+'40':C.pageBg}`}}>
          <button onClick={()=>toggle('toss')} style={{width:'100%',padding:'12px 14px',background:bankOpen.has('toss')?C.accentBg:C.inputBg,border:'none',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',textAlign:'left'}}>
            <span style={{fontWeight:700,color:C.text,fontSize:14}}>토스뱅크</span>
            <Icon n={bankOpen.has('toss')?'chevron-up':'chevron-down'} size={14} color={C.textDim}/>
          </button>
          {bankOpen.has('toss')&&(
            <div style={{padding:'12px 14px',background:'#fff',fontSize:13,color:C.textMid,lineHeight:2}}>
              <div style={{fontWeight:700,color:C.text,marginBottom:6}}>토스 앱에서:</div>
              1. <strong>토스뱅크</strong> 클릭<br/>2. <strong>관리</strong> 메뉴<br/>3. <strong>증명서 발급</strong><br/>4. <strong>거래내역서</strong> 선택<br/>5. 기간 설정 → <strong>엑셀(xlsx) 다운로드</strong>
              <div style={{marginTop:8,padding:'8px 10px',background:C.accentBg,borderRadius:8,fontSize:12,display:'flex',alignItems:'center',gap:4}}><Icon n="lightbulb" size={12} color={C.accent}/>이메일로 받기도 가능해요</div>
            </div>
          )}
        </div>
        {[{id:'kakao',bank:'카카오뱅크',steps:'더보기 → 입출금 내역 → 우측 상단 ··· → 엑셀 다운로드'},{id:'kb',bank:'국민은행',steps:'KB Star 앱 → 조회 → 계좌조회 → 거래내역조회 → 하단 "엑셀저장"'},{id:'shinhan',bank:'신한은행',steps:'SOL 앱 → 계좌관리 → 거래내역조회 → 우측 상단 내보내기 → 파일 저장'},{id:'woori',bank:'우리은행',steps:'확인 중 — 은행 앱에서 거래내역 조회 후 엑셀 내보내기를 찾아주세요'},{id:'hana',bank:'하나은행',steps:'확인 중 — 은행 앱에서 거래내역 조회 후 엑셀 내보내기를 찾아주세요'},{id:'nh',bank:'농협',steps:'NH올원뱅크 → 계좌 → 거래내역조회 → 하단 "파일저장" → 엑셀'},].map(({id,bank,steps})=>(
          <div key={id} style={{borderRadius:12,overflow:'hidden',marginBottom:4}}>
            <button onClick={()=>toggle(id)} style={{width:'100%',padding:'10px 14px',background:C.inputBg,border:'none',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',textAlign:'left',borderRadius:12}}>
              <span style={{fontWeight:600,color:C.text,fontSize:13}}>{bank}</span>
              <Icon n={bankOpen.has(id)?'chevron-up':'chevron-down'} size={12} color={C.textDim}/>
            </button>
            {bankOpen.has(id)&&<div style={{padding:'10px 14px',fontSize:12,color:C.textMid,lineHeight:1.8,background:'#fff'}}>{steps}</div>}
          </div>
        ))}
        <div style={{fontSize:11,color:C.textDim,marginTop:10,lineHeight:1.6}}>* 앱 버전에 따라 메뉴가 다를 수 있어요</div>
      </Card>
    </Modal>
  );
}

// ── StatusSection ──────────────────────────────────────────
function StatusSection({event,updateEvent,groups,showToast}){
  const [sortByTime,setSortByTime]=useState(true);
  const mm=event.memberMap||{};
  const amounts=calcAmounts(event);
  const surplus=calcSurplus(event);
  const attendingMembers=event.members.filter(k=>event.attendance[k]!==false);
  const presentMembers=attendingMembers.filter(k=>(amounts[k]||0)>0);

  // 임시 인원 합산
  const extraAmounts={};
  const allExtraEntries=[]; // {key, name}
  (event.rounds||[]).forEach(r=>{
    if(!r.amount) return;
    const totalCount=(r.members?.length||0)+(r.extraMembers?.length||0)+(r.includeOrganizer===true?1:0);
    if(!totalCount) return;
    const share=Math.ceil(r.amount/totalCount);
    (r.extraMembers||[]).forEach((em,ei)=>{
      const k=extraKey(r.id,em,ei);
      extraAmounts[k]=(extraAmounts[k]||0)+share;
      if(!allExtraEntries.find(e=>e.key===k))
        allExtraEntries.push({key:k,name:em.name});
    });
  });

  const pc=presentMembers.filter(k=>getPayStatus(event.payments?.[k])==='paid').length
           +allExtraEntries.filter(e=>getPayStatus(event.payments?.[e.key])==='paid').length;
  const unpaidList=presentMembers.filter(k=>getPayStatus(event.payments?.[k])!=='paid');
  const directLink=getLink(`code=${event.code}`);

  const setStatus=(k,newStatus)=>{
    const p=event.payments?.[k]||{};
    const now=new Date().toISOString();
    let next;
    if(newStatus==='paid') next={payStatus:'paid',hasBeenConfirmed:true,requestedAt:p.requestedAt||null,time:now,by:'admin'};
    else if(newStatus==='requested') next={payStatus:'requested',hasBeenConfirmed:false,requestedAt:p.requestedAt||now,time:null,by:null};
    else if(newStatus==='rejected') next={payStatus:'rejected',hasBeenConfirmed:true,requestedAt:p.requestedAt||null,time:null,by:null};
    else next={payStatus:'none',hasBeenConfirmed:false,requestedAt:null,time:null,by:null};
    updateEvent({...event,payments:{...event.payments,[k]:next}});
  };

  const [showGroups,setShowGroups]=useState(false);
  const groupSections=React.useMemo(()=>{
    if(!showGroups) return null;
    const pMembers=event.members.filter(k=>event.attendance[k]!==false).filter(k=>(amounts[k]||0)>0);
    const assigned=new Set();
    const sortSection=(keys,nameOf=k=>k)=>sortByTime
      ? sortByRequested(keys,event.payments,nameOf)
      : keys;
    const sections=(groups||[]).map(g=>{
      const gKeys=new Set((g.members||[]).map(m=>m.name+(m.sid?`_${m.sid}`:'')));
      const keys=pMembers.filter(k=>gKeys.has(k));
      keys.forEach(k=>assigned.add(k));
      return {name:g.name,keys:sortSection(keys,k=>mm[k]||k)};
    }).filter(s=>s.keys.length>0);
    const unassigned=pMembers.filter(k=>!assigned.has(k));
    if(unassigned.length>0) sections.push({name:'미분류',keys:sortSection(unassigned,k=>mm[k]||k)});
    // 임시 인원 섹션 추가 (useMemo 내부에서 직접 계산)
    const localExtraEntries=[];
    (event.rounds||[]).forEach(r=>{
      if(!r.amount) return;
      const totalCount=(r.members?.length||0)+(r.extraMembers?.length||0)+(r.includeOrganizer===true?1:0);
      if(!totalCount) return;
      (r.extraMembers||[]).forEach((em,ei)=>{
        const k=extraKey(r.id,em,ei);
        if(!localExtraEntries.find(e=>e.key===k)) localExtraEntries.push({key:k,name:em.name});
      });
    });
    if(localExtraEntries.length>0){
      const extraKeys=sortSection(localExtraEntries.map(e=>e.key),k=>localExtraEntries.find(e=>e.key===k)?.name||k);
      sections.push({name:'임시 인원',keys:extraKeys,isExtra:true});
    }
    return sections;
  },[showGroups,groups,event.members,event.attendance,event.payments,event.rounds,sortByTime]);

  const sortList=(keys,nameOf=k=>k)=>sortByTime
    ? sortByRequested(keys,event.payments,nameOf)
    : keys;
  const sortedMain=sortList(presentMembers,k=>mm[k]||k);
  const sortedExtra=sortList(allExtraEntries.map(e=>e.key),k=>allExtraEntries.find(e=>e.key===k)?.name||k);

  const normMemberName=(raw,k)=>{if(!k.includes('_'))return raw;const sfx=k.split('_').slice(1).join('_');return raw.endsWith(` (${sfx})`)?raw.slice(0,-(sfx.length+3)):raw;};
  const nameCount={};
  presentMembers.forEach(k=>{const n=normMemberName(mm[k]||k,k);nameCount[n]=(nameCount[n]||0)+1;});
  allExtraEntries.forEach(e=>{nameCount[e.name]=(nameCount[e.name]||0)+1;});

  const MemberCard=({k,isExtra=false})=>{
    const p=event.payments?.[k];
    const status=getPayStatus(p);
    const paid=status==='paid';
    const requested=status==='requested';
    const rejected=status==='rejected';
    const isAnimPaid=animatingPaidKeys.has(k);
    const effectivePaid=paid||isAnimPaid;
    const matchInfo=matchSummary?.byKey[k];
    const displayName=isExtra
      ? (allExtraEntries.find(e=>e.key===k)?.name || k)
      : (mm[k]||k);
    const displayAmount=isExtra ? (extraAmounts[k]||0) : (amounts[k]||0);
    const canDunning=status==='none'&&!matchInfo&&!!event.account?.bank&&!animating;
    const dunning=async e=>{
      e.stopPropagation();
      posthog.capture('정산_콕_찌르기_사용',{미입금_수:1});
      const msg=buildDunningMsg({name:baseDisplay,eventName:event.name,amount:displayAmount,account:event.account,link:directLink});
      const shared=await shareText(msg);
      if(!shared){await copyText(msg);showToast('콕 찌르기 복사됐어요');}
      else showToast('공유 완료');
    };
    const effectiveStatus=effectivePaid?'paid':(matchInfo?'requested':status);
    const menuOpen=openMenuKey===k;
    const keySuffix=!isExtra&&k.includes('_')?k.split('_').slice(1).join('_'):null;
    const baseDisplay=keySuffix&&displayName.endsWith(` (${keySuffix})`)?displayName.slice(0,-(keySuffix.length+3)):displayName;
    const showId=nameCount[baseDisplay]>=2&&keySuffix?keySuffix:null;
    return(
      <div style={{background:C.cardBg,borderRadius:12,marginBottom:6,boxShadow:C.shadow,overflow:'hidden',opacity:rejected&&!effectivePaid?0.5:1,pointerEvents:animating?'none':'auto'}}
        onClick={()=>menuOpen&&setOpenMenuKey(null)}>
        <div style={{padding:'11px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{flex:1,minWidth:0,cursor:'pointer'}} onClick={e=>{e.stopPropagation();setOpenMenuKey(null);setDetailKey(k);}}>
            <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
              <span style={{fontWeight:600,color:C.text,fontSize:13}}>{baseDisplay}</span>
              {showId&&<span style={{fontSize:11,color:C.textDim}}>({showId})</span>}
              {isExtra&&<span style={{fontSize:10,fontWeight:800,color:C.orange,background:C.orange+'20',borderRadius:6,padding:'1px 5px'}}>임시</span>}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
            <div style={{color:C.accent,fontWeight:900,fontSize:13}}>{fmtKRW(displayAmount)}</div>
            <PaySegCtrl status={effectiveStatus} onChange={newSt=>setStatus(k,newSt)} disabled={rejected&&!effectivePaid}/>
            <button onClick={e=>{e.stopPropagation();setOpenMenuKey(v=>v===k?null:k);}}
              style={{background:'none',border:'none',cursor:'pointer',padding:'2px 4px',color:C.textDim,fontSize:18,lineHeight:1}}>⋯</button>
          </div>
        </div>
        {menuOpen&&(
          <div style={{borderTop:`1px solid ${C.border}`,padding:'6px 14px'}}>
            {rejected&&!effectivePaid
              ?<button onClick={e=>{e.stopPropagation();setStatus(k,'none');setOpenMenuKey(null);}}
                  style={{fontSize:12,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:700,padding:'4px 0'}}>정산 재포함</button>
              :<button onClick={e=>{e.stopPropagation();setStatus(k,'rejected');setOpenMenuKey(null);}}
                  style={{fontSize:12,color:C.red,background:'none',border:'none',cursor:'pointer',fontWeight:700,padding:'4px 0'}}>정산 대상에서 제외</button>
            }
          </div>
        )}
        {matchInfo?.type==='partial'&&!effectivePaid&&(
          <div style={{padding:'0 14px 10px'}}>
            <div style={{height:3,borderRadius:2,background:C.border,overflow:'hidden',marginBottom:3}}>
              <div style={{height:'100%',width:`${Math.min(100,Math.round(matchInfo.totalAmount/matchInfo.expected*100))}%`,background:C.yellow,borderRadius:2}}/>
            </div>
            <span style={{fontSize:11,color:C.yellow,fontWeight:600}}>{fmtKRW(matchInfo.totalAmount)} / {fmtKRW(matchInfo.expected)}{matchInfo.depositCount>1?` · ${matchInfo.depositCount}회 합산`:''}</span>
          </div>
        )}
        {matchInfo?.type==='overpaid'&&!effectivePaid&&(
          <div style={{padding:'0 14px 10px',fontSize:11,color:C.yellow,fontWeight:600}}>
            {fmtKRW(matchInfo.totalAmount)} 입금 ({fmtKRW(matchInfo.totalAmount-matchInfo.expected)} 초과)
          </div>
        )}
        {canDunning&&(
          <div style={{borderTop:`1px solid ${C.border}`,padding:'6px 14px',display:'flex',justifyContent:'flex-end'}}>
            <button onClick={dunning} style={{fontSize:12,color:C.orange,background:C.orange+'18',border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer',fontWeight:700,display:'flex',alignItems:'center',gap:4}}><Icon n="message-circle" size={12} color={C.orange}/>콕 찌르기</button>
          </div>
        )}
      </div>
    );
  };

  const totalCount=presentMembers.length+allExtraEntries.length;
  const allKeys=[...presentMembers,...allExtraEntries.map(e=>e.key)];
  const requestedKeys=allKeys.filter(k=>getPayStatus(event.payments?.[k])==='requested');
  const unpaidXKeys=allKeys.filter(k=>getPayStatus(event.payments?.[k])==='none');
  const unpaidXList=unpaidXKeys.map(k=>{
    const isExtra=allExtraEntries.some(e=>e.key===k);
    return {name:isExtra?(allExtraEntries.find(e=>e.key===k)?.name||k):(mm[k]||k),amount:isExtra?(extraAmounts[k]||0):(amounts[k]||0)};
  });
  const [confirmBulk,setConfirmBulk]=useState(false);
  const [dunningOpen,setDunningOpen]=useState(false);
  const [openMenuKey,setOpenMenuKey]=useState(null);
  const [detailKey,setDetailKey]=useState(null);
  const [matchTipSeen,setMatchTipSeen]=useState(()=>!!localStorage.getItem('matchResultTipSeen'));
  const [matchSummary,setMatchSummary]=useState(()=>{
    const byKey={};
    Object.entries(event.payments||{}).forEach(([k,p])=>{
      if(p?.matchType==='partial') byKey[k]={type:'partial',totalAmount:p.matchedAmount,expected:p.expectedAmount,depositCount:1};
      if(p?.matchType==='overpaid') byKey[k]={type:'overpaid',totalAmount:p.matchedAmount,expected:p.expectedAmount};
    });
    const s=event.lastMatchSummary;
    if(!s&&Object.keys(byKey).length===0) return null;
    return {byKey,refund:s?.refund||[],stats:{matched:s?.matchedCount||0,needsCheck:s?.needsCheck||0}};
  });
  const [animatingPaidKeys,setAnimatingPaidKeys]=useState(new Set());
  const [animating,setAnimating]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [showExcelModal,setShowExcelModal]=useState(false);
  const [excelPwdOpen,setExcelPwdOpen]=useState(false);
  const [pendingExcelData,setPendingExcelData]=useState(null);
  const [reMatchPrompt,setReMatchPrompt]=useState(null); // {parsed,autoCount} | null
  const excelFileRef=useRef(null);
  const animTimers=useRef([]);
  const eventRef=useRef(event);
  useEffect(()=>{eventRef.current=event;},[event]);

  const applyBulkConfirm=()=>{
    const now=new Date().toISOString();
    const newPayments={...event.payments};
    requestedKeys.forEach(k=>{newPayments[k]={payStatus:'paid',hasBeenConfirmed:true,requestedAt:event.payments[k]?.requestedAt||null,time:now,by:'admin'};});
    updateEvent({...event,payments:newPayments});
    setConfirmBulk(false);
  };

  const _applyExcelParsed=async(parsed,mode)=>{
    if(parsed.deposits.length===0){showToast('입금 내역이 없어요',C.red);return;}
    // [수정1] 매칭 입력을 렌더 클로저가 아닌 매칭 실행 시점의 live ref(eventRef.current)로
    //         일원화. FormAdmin의 formRef 패턴과 동일. decrypt 대기/슬라이드 이동/realtime
    //         사이에 바뀐 event를 stale 캡쳐하던 비결정성 제거.
    const evNow=eventRef.current;
    // 재업로드 게이트: 이전 자동매칭 결과가 있으면 모드 선택 모달 표시(증분 업로드 보호).
    // mode 미지정 + auto 결과 존재 시에만. 첫 업로드(auto 없음)는 모달 없이 바로 진행.
    if(!mode){
      const autoCount=Object.values(evNow.payments||{}).filter(p=>p?.by==='auto'||p?.matchedBy==='auto').length;
      if(autoCount>0){ setReMatchPrompt({parsed,autoCount}); return; }
    }
    const amounts=calcAmounts(evNow);
    const mmNow=evNow.memberMap||{};
    const attendingNow=(evNow.members||[]).filter(k=>evNow.attendance?.[k]!==false);
    // [수정2] amount>0 필터 제거 — 0원도 매칭 후보에 포함(stale/0원으로 인한 매칭 누락 방지).
    //         동명이인 시 실제 청구자가 먼저 매칭되도록 nonzero를 앞에 배치.
    const withAmt=attendingNow.filter(k=>(amounts[k]||0)>0);
    const zeroAmt=attendingNow.filter(k=>(amounts[k]||0)===0);
    const esubs=[...withAmt,...zeroAmt].map(k=>({name:mmNow[k]||k,key:k}));
    posthog.capture('정산_거래내역_업로드',{명단_수:esubs.length});
    const results=matchEngine.match(parsed.deposits,esubs,s=>amounts[s.key]||0);
    const byKey={};
    (results.partial||[]).forEach(m=>{byKey[m.sub.key]={type:'partial',totalAmount:m.totalAmount,expected:amounts[m.sub.key]||0,depositCount:m.deposits.length};});
    (results.overpaid||[]).forEach(m=>{byKey[m.sub.key]={type:'overpaid',totalAmount:m.totalAmount,expected:amounts[m.sub.key]||0};});
    const needsCheck=(results.partial||[]).length+(results.overpaid||[]).length;
    const isEmpty=results.matched.length===0&&needsCheck===0&&(results.refund||[]).length===0;
    const newSummary={byKey,refund:results.refund||[],stats:{matched:results.matched.length,needsCheck},emptyResult:isEmpty};
    posthog.capture('정산_자동_대조_완료',{매칭_수:results.matched.length,확인_필요_수:needsCheck,미입금_수:esubs.length-results.matched.length-needsCheck,명단에_없는_입금_수:(results.refund||[]).length});
    setMatchSummary(newSummary);
    const now=new Date().toISOString();
    const prevPayments=evNow.payments||{};
    const newPayments={...prevPayments};
    // 수동 변경 카드 skip (by:'admin')
    const skipKeys=new Set(Object.entries(prevPayments).filter(([,p])=>p?.by==='admin').map(([k])=>k));
    // [수정3] mode!=='append'일 때만 이전 자동매칭(by:'auto'/matchedBy:'auto') 무효화 →
    //         이번 매칭이 권위. 'append'(추가하기)면 이전 auto 유지하고 새 결과만 덮어씀.
    //         수동(admin)은 skipKeys로 보존, 참여자 요청 흔적(requestedAt)은 '요청됨' 보존.
    if(mode!=='append'){
      Object.entries(prevPayments).forEach(([k,p])=>{
        if(skipKeys.has(k)) return;
        if(p?.by==='auto'||p?.matchedBy==='auto'){
          if(p.requestedAt) newPayments[k]={payStatus:'requested',hasBeenConfirmed:false,requestedAt:p.requestedAt,time:null,by:null};
          else delete newPayments[k];
        }
      });
    }
    results.matched.forEach(m=>{
      if(skipKeys.has(m.sub.key)) return;
      newPayments[m.sub.key]={payStatus:'paid',hasBeenConfirmed:true,requestedAt:eventRef.current.payments[m.sub.key]?.requestedAt||null,time:now,by:'auto'};
    });
    (results.partial||[]).forEach(m=>{
      if(skipKeys.has(m.sub.key)) return;
      newPayments[m.sub.key]={payStatus:'requested',hasBeenConfirmed:false,requestedAt:eventRef.current.payments[m.sub.key]?.requestedAt||now,time:null,by:null,matchType:'partial',matchedAmount:m.totalAmount,expectedAmount:amounts[m.sub.key]||0,matchedBy:'auto'};
    });
    (results.overpaid||[]).forEach(m=>{
      if(skipKeys.has(m.sub.key)) return;
      newPayments[m.sub.key]={payStatus:'requested',hasBeenConfirmed:false,requestedAt:eventRef.current.payments[m.sub.key]?.requestedAt||now,time:null,by:null,matchType:'overpaid',matchedAmount:m.totalAmount,expectedAmount:amounts[m.sub.key]||0,matchedBy:'auto'};
    });
    const matchedKeys=results.matched.filter(m=>!skipKeys.has(m.sub.key)).map(m=>m.sub.key);
    animTimers.current.forEach(t=>clearTimeout(t));
    animTimers.current=[];
    const lms={matchedCount:newSummary.stats.matched,needsCheck,refund:newSummary.refund.map(d=>({name:d.name,amount:d.amount})),matchedAt:now};
    if(matchedKeys.length>0){
      setAnimating(true);
      const interval=matchedKeys.length<=50?30:Math.floor(1500/matchedKeys.length);
      matchedKeys.forEach((key,i)=>{
        const t=setTimeout(()=>setAnimatingPaidKeys(prev=>new Set([...prev,key])),i*interval);
        animTimers.current.push(t);
      });
      const finalT=setTimeout(async()=>{
        await updateEvent({...eventRef.current,payments:newPayments,refundList:newSummary.refund.map(d=>({name:d.name,amount:d.amount})),lastMatchSummary:lms});
        setAnimating(false);
        setAnimatingPaidKeys(new Set());
      },matchedKeys.length*interval+100);
      animTimers.current.push(finalT);
    } else if(!isEmpty){
      await updateEvent({...eventRef.current,payments:newPayments,refundList:newSummary.refund.map(d=>({name:d.name,amount:d.amount})),lastMatchSummary:lms});
    }
    const parts=[];
    if(results.matched.length>0) parts.push(`${results.matched.length}명 처리`);
    if(needsCheck>0) parts.push(`확인 필요 ${needsCheck}명`);
    if(isEmpty) showToast('매칭 결과 없음 — 거래내역서 형식 확인',C.yellow);
    else showToast(parts.length?parts.join(', '):`${results.totalDeposits}건 분석`);
  };

  const handleExcel=async e=>{
    const file=e.target.files?.[0];
    if(!file) return;
    setUploading(true);
    setShowExcelModal(false);
    try{
      const data=await file.arrayBuffer();
      const parsed=matchEngine.parseExcel(data);
      if(parsed.error==='NEEDS_PASSWORD'){setPendingExcelData(data);setExcelPwdOpen(true);setUploading(false);return;}
      if(parsed.error){showToast(parsed.error,C.red);setUploading(false);return;}
      await _applyExcelParsed(parsed);
    }catch(err){
      console.error(err);
      showToast('파일을 읽을 수 없어요',C.red);
      setAnimating(false);
    }
    setUploading(false);
    if(excelFileRef.current) excelFileRef.current.value='';
  };

  const submitExcelPassword=async password=>{
    setUploading(true);
    try{
      const decrypted=await decryptExcel(pendingExcelData,password);
      const parsed=matchEngine.parseExcel(decrypted);
      if(parsed.error){showToast(parsed.error,C.red);setUploading(false);return;}
      setExcelPwdOpen(false);
      setPendingExcelData(null);
      await _applyExcelParsed(parsed);
    }catch(err){
      if(err.message==='WRONG_PASSWORD') showToast('비밀번호가 틀려요. 다시 입력해주세요.',C.red);
      else showToast('파일 복호화에 실패했어요.',C.red);
    }
    setUploading(false);
    if(excelFileRef.current) excelFileRef.current.value='';
  };

  return(
    <div>
      <input ref={excelFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcel} style={{display:'none'}}/>
      {event.account?.bank&&(
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <button onClick={()=>setShowExcelModal(true)} disabled={uploading||animating} className="press" style={{flex:1,padding:'10px 4px',borderRadius:10,background:C.cardBg,border:`1px solid ${C.border}`,color:(uploading||animating)?C.textDim:C.textMid,fontWeight:700,fontSize:12,cursor:(uploading||animating)?'default':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
            {uploading?<><Spinner size={12} color={C.textDim}/>&nbsp;분석 중...</>:animating?<><Spinner size={12} color={C.textDim}/>&nbsp;처리 중...</>:<><Icon n="bar-chart" size={12} color={C.textMid}/>자동 대조</>}
          </button>
          {unpaidXKeys.length>0&&!animating&&(
            <button onClick={()=>{posthog.capture('정산_콕_찌르기_사용',{미입금_수:unpaidXKeys.length});setDunningOpen(true);}} className="press" style={{flex:1,padding:'10px 4px',borderRadius:10,background:C.cardBg,border:`1px solid ${C.border}`,color:C.textMid,fontWeight:700,fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
              <Icon n="message-circle" size={12} color={C.textMid}/>미입금자 {unpaidXKeys.length}명 콕 찌르기
            </button>
          )}
        </div>
      )}
      {requestedKeys.length>0&&(
        <div style={{marginBottom:12}}>
          <button onClick={()=>setConfirmBulk(true)} className="press" style={{width:'100%',padding:'9px',borderRadius:10,background:C.yellowBg,border:`1.5px solid ${C.yellow}40`,color:C.yellow,fontWeight:700,fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
            <Icon n="check" size={12} color={C.yellow}/>{requestedKeys.length}명 확인 완료
          </button>
        </div>
      )}
      <ConfirmBulkModal isOpen={confirmBulk} onClose={()=>setConfirmBulk(false)} count={requestedKeys.length} onConfirm={applyBulkConfirm}/>
      {surplus>0&&<div style={{fontSize:11,color:C.textDim,textAlign:'center',marginBottom:12}}>소수점을 올림해서 총액보다 <span style={{fontWeight:700,color:C.textMid}}>{fmtKRW(surplus)}</span> 더 걷혀요</div>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:matchSummary?4:8}}>
        <div style={{fontSize:12,fontWeight:600}}>
          <span style={{color:C.red,display:'inline-flex',alignItems:'center',gap:3}}><span style={{width:8,height:8,borderRadius:'50%',background:C.red,display:'inline-block',flexShrink:0}}/>미입금 {totalCount-pc}</span>
          <span style={{color:C.textDim,margin:'0 5px'}}>·</span>
          <span style={{color:C.green,display:'inline-flex',alignItems:'center',gap:3}}><span style={{width:8,height:8,borderRadius:'50%',background:C.green,display:'inline-block',flexShrink:0}}/>입금확인 {pc}</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {(groups||[]).length>1&&(
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              <span style={{fontSize:11,color:C.textDim}}>그룹 묶기</span>
              <button onClick={()=>setShowGroups(v=>!v)} style={{
                width:36,height:20,borderRadius:10,border:'none',cursor:'pointer',padding:0,
                background:showGroups?C.accent:C.disabled,position:'relative',transition:'background 0.2s',flexShrink:0,
              }}>
                <div style={{width:16,height:16,borderRadius:8,background:'#fff',position:'absolute',top:2,
                  left:showGroups?18:2,transition:'left 0.2s',boxShadow:'0 1px 2px rgba(0,0,0,0.2)'}}/>
              </button>
            </div>
          )}
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            {sortByTime&&<span style={{fontSize:11,color:C.textDim}}>시간순</span>}
            <button onClick={()=>setSortByTime(v=>!v)} style={{
              width:36,height:20,borderRadius:10,border:'none',cursor:'pointer',padding:0,
              background:sortByTime?C.accent:C.disabled,position:'relative',transition:'background 0.2s',flexShrink:0,
            }}>
              <div style={{width:16,height:16,borderRadius:8,background:'#fff',position:'absolute',top:2,
                left:sortByTime?18:2,transition:'left 0.2s',boxShadow:'0 1px 2px rgba(0,0,0,0.2)'}}/>
            </button>
          </div>
        </div>
      </div>
      {matchSummary&&(
        <div style={{marginBottom:8,padding:'7px 10px',background:matchSummary.emptyResult?C.yellowBg:C.greenBg,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',gap:6,alignItems:'center',fontSize:11,flexWrap:'wrap'}}>
            <Icon n="bar-chart" size={12} color={matchSummary.emptyResult?C.yellow:'#5DCAA5'}/>
            <span style={{color:C.textDim,fontWeight:700}}>자동 대조</span>
            {matchSummary.emptyResult?(
              <span style={{color:C.yellow}}>매칭 결과 없어요. 거래내역서 형식 확인하세요.</span>
            ):(
              <>
                {pc>0&&<><span style={{color:C.textDim}}>·</span><span style={{color:'#5DCAA5',fontWeight:700}}>매칭 {pc}</span></>}
                {requestedKeys.length>0&&<><span style={{color:C.textDim}}>·</span><span style={{color:'#EF9F27',fontWeight:700}}>확인 필요 {requestedKeys.length}</span></>}
                {matchSummary.refund?.length>0&&<><span style={{color:C.textDim}}>·</span><span style={{color:'#888780',fontWeight:700}}>명단에 없는 입금 {matchSummary.refund.length}건</span></>}
              </>
            )}
          </div>
          <button onClick={()=>{setMatchSummary(null);updateEvent({...eventRef.current,lastMatchSummary:null});}} style={{fontSize:11,color:C.textDim,background:'none',border:`1px solid ${C.border}`,cursor:'pointer',padding:'2px 8px',borderRadius:6,fontFamily:'inherit',flexShrink:0}}>초기화</button>
        </div>
      )}
      {matchSummary&&!matchSummary.emptyResult&&!matchTipSeen&&(
        <div style={{marginBottom:8,padding:'7px 12px',background:C.inputBg,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <span style={{fontSize:11,color:C.textMid,lineHeight:1.6}}><span style={{color:'#EF9F27',fontWeight:700}}>노랑 카드</span>는 금액이 달라요. 카드 탭하면 부족·초과 금액 확인 가능.</span>
          <button onClick={()=>{setMatchTipSeen(true);localStorage.setItem('matchResultTipSeen','true');}} style={{fontSize:11,color:C.textDim,background:'none',border:'none',cursor:'pointer',flexShrink:0,padding:'2px 0'}}>✕</button>
        </div>
      )}
      {showGroups&&groupSections?(
        groupSections.map(section=>(
          <div key={section.name} style={{marginBottom:4}}>
            <div style={{fontSize:11,fontWeight:700,color:C.textDim,padding:'8px 4px 4px',letterSpacing:0.5}}>
              {section.name} ({section.keys.filter(k=>getPayStatus(event.payments?.[k])==='paid').length}/{section.keys.length})
            </div>
            {section.isExtra&&<div style={{fontSize:11,color:C.textMid,marginBottom:6,paddingLeft:4}}>카톡 공유가 안 되니 여기서 직접 체크해주세요</div>}
            {section.keys.map(k=><MemberCard key={k} k={k} isExtra={!!section.isExtra}/>)}
          </div>
        ))
      ):(
        <>
          {sortedMain.map(k=><MemberCard key={k} k={k}/>)}
          {allExtraEntries.length>0&&(
            <div style={{marginTop:8}}>
              <div style={{fontSize:11,fontWeight:700,color:C.textDim,padding:'8px 4px 4px',letterSpacing:0.5}}>
                임시 인원 ({allExtraEntries.filter(e=>getPayStatus(event.payments?.[e.key])==='paid').length}/{allExtraEntries.length})
              </div>
              <div style={{fontSize:11,color:C.textMid,marginBottom:6,paddingLeft:4}}>카톡 공유가 안 되니 여기서 직접 체크해주세요</div>
              {sortedExtra.map(k=><MemberCard key={k} k={k} isExtra={true}/>)}
            </div>
          )}
        </>
      )}
      {unpaidList.length===0&&pc>0&&<div style={{textAlign:'center',color:C.green,fontWeight:900,fontSize:15,padding:'16px 0',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Icon n="sparkles" size={16} color={C.green}/>전원 완료!</div>}
      {matchSummary?.refund?.length>0&&(
        <div style={{marginTop:8,padding:'12px 14px',background:C.inputBg,borderRadius:12,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:12,fontWeight:700,color:C.textMid,marginBottom:6,display:'flex',alignItems:'center',gap:4}}>
            <Icon n="circle-alert" size={13} color={C.textMid}/>명단에 없는 입금 {matchSummary.refund.length}건이 있어요
          </div>
          <div style={{fontSize:11,color:C.textDim,marginBottom:8}}>다른 정산이거나 실수 송금일 수 있어요. 직접 확인해주세요.</div>
          {matchSummary.refund.map((d,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderTop:i>0?`1px solid ${C.border}`:''}}>
              <span style={{fontSize:13,fontWeight:600,color:C.text}}>{d.name}</span>
              <span style={{fontSize:13,fontWeight:700,color:C.textMid}}>{fmtKRW(d.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {dunningOpen&&event.account?.bank&&(
        <DunningModal eventName={event.name} account={event.account} link={directLink}
          unpaidList={unpaidXList} showToast={showToast} onClose={()=>setDunningOpen(false)}/>
      )}
      {showExcelModal&&<ExcelUploadModal uploading={uploading} fileRef={excelFileRef} onClose={()=>setShowExcelModal(false)}/>}
      {excelPwdOpen&&<ExcelPasswordModal isOpen={excelPwdOpen} onClose={()=>{setExcelPwdOpen(false);setPendingExcelData(null);}} onSubmit={submitExcelPassword} loading={uploading}/>}
      {reMatchPrompt&&(
        <Modal isOpen={true} onClose={()=>setReMatchPrompt(null)} title="이전 자동매칭이 있어요" closeOnBackdrop={false} showCloseButton={false} maxWidth={360}>
          <div style={{fontSize:14,color:C.textMid,marginBottom:8,lineHeight:1.7}}>
            이전 자동매칭 결과 <strong style={{color:C.text}}>{reMatchPrompt.autoCount}개</strong>가 있어요.<br/>새 거래내역으로 어떻게 처리할까요?
          </div>
          <div style={{fontSize:12,color:C.textDim,marginBottom:18,lineHeight:1.6}}>
            · <strong>다시 매칭</strong>: 이전 자동매칭을 지우고 이번 결과로 새로 맞춰요<br/>
            · <strong>추가</strong>: 이전 자동매칭을 그대로 두고 새로 매칭된 것만 더해요 (여러 번 나눠 업로드할 때)
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <Btn onClick={()=>{const p=reMatchPrompt.parsed;setReMatchPrompt(null);_applyExcelParsed(p,'rematch');}}>다시 매칭하기</Btn>
            <Btn variant="secondary" onClick={()=>{const p=reMatchPrompt.parsed;setReMatchPrompt(null);_applyExcelParsed(p,'append');}}>추가하기</Btn>
            <Btn variant="ghost" onClick={()=>setReMatchPrompt(null)}>취소</Btn>
          </div>
        </Modal>
      )}
      {detailKey&&(()=>{
        const dp=event.payments?.[detailKey];
        const dSt=getPayStatus(dp);
        const dIsExtra=allExtraEntries.some(e=>e.key===detailKey);
        const dName=dIsExtra?(allExtraEntries.find(e=>e.key===detailKey)?.name||detailKey):(mm[detailKey]||detailKey);
        const dGroup=(groups||[]).find(g=>{const gKeys=new Set((g.members||[]).map(m=>m.name+(m.sid?`_${m.sid}`:'')));return gKeys.has(detailKey);})?.name||null;
        const dPaidFee=event.feeConfig?(event.paidFeeKeys||[]).includes(detailKey):null;
        const dPayTime=dSt==='paid'?dp?.time:dSt==='requested'?dp?.requestedAt:null;
        const dPayBy=dSt==='paid'?dp?.by:dSt==='requested'?'requested':null;
        return <MemberDetailModal
          name={dName} onClose={()=>setDetailKey(null)}
          studentId={!dIsExtra&&detailKey.includes('_')?detailKey.split('_').slice(1).join('_'):null}
          group={dGroup}
          unregistered={!dGroup&&!dIsExtra&&(groups||[]).length>0}
          paidFee={dPaidFee}
          payTime={dPayTime} payBy={dPayBy}
          matchInfo={matchSummary?.byKey[detailKey]}
        />;
      })()}
    </div>
  );
}

// ── ParticipantSplashScreen ────────────────────────────────
function NotFoundScreen(){
  return(
    <div className="fade-up screen" style={{background:C.pageBg,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'40px 28px',textAlign:'center'}}>
      <div style={{width:72,height:72,borderRadius:36,background:C.textDim+'18',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:20}}>
        <Icon n="file-search" size={36} color={C.textDim}/>
      </div>
      <div style={{fontSize:22,fontWeight:900,color:C.text,marginBottom:8,letterSpacing:-0.5}}>찾을 수 없는 링크예요</div>
      <div style={{fontSize:14,color:C.textMid,lineHeight:1.7,marginBottom:28}}>
        정산이 종료됐거나 삭제됐을 수 있어요.<br/>총무에게 링크를 다시 받아주세요.
      </div>
      <a href="https://jungsan-hae.com" style={{fontSize:13,color:C.accent,fontWeight:700,textDecoration:'none'}}>정산해 알아보기 →</a>
    </div>
  );
}

function ParticipantSplashScreen({onDone}){
  const [fading,setFading]=useState(false);
  useEffect(()=>{
    const t1=setTimeout(()=>setFading(true),1000);
    const t2=setTimeout(onDone,1200);
    return()=>{clearTimeout(t1);clearTimeout(t2);};
  },[]);
  return(
    <div className="screen" style={{background:`linear-gradient(145deg,#6366F1 0%,${C.purple} 100%)`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',transition:'opacity 0.2s',opacity:fading?0:1,position:'relative'}}>
      <button onClick={onDone} style={{position:'absolute',top:20,right:20,background:'rgba(255,255,255,0.2)',border:'none',borderRadius:20,padding:'6px 14px',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>건너뛰기</button>
      <svg viewBox="0 0 200 200" style={{width:64,height:64,marginBottom:16}}>
        <defs><clipPath id="f1-onb"><circle cx="100" cy="100" r="100"/></clipPath></defs>
        <g clipPath="url(#f1-onb)">
          <rect width="200" height="200" fill="rgba(255,255,255,0.9)"/>
          <polygon points="0,200 200,0 200,200" fill="rgba(255,255,255,0.45)"/>
        </g>
      </svg>
      <div style={{fontSize:28,fontWeight:900,color:'#fff',letterSpacing:-1,marginBottom:8}}>정산해</div>
      <div style={{fontSize:14,color:'rgba(255,255,255,0.8)',fontWeight:500}}>간편한 모임 정산</div>
    </div>
  );
}

// ── ParticipantScreen ──────────────────────────────────────
function ParticipantScreen({nav,event:initEvent,updateEvent,participantKey,showToast}){
  // participantKey(이름 또는 전체 키)를 실제 member key로 해석
  const getBaseName=k=>{const di=k.indexOf('__');if(di>=0)return k.substring(0,di);return k.includes('_')?k.substring(0,k.lastIndexOf('_')):k;};
  const resolveKey=()=>{
    const pk=participantKey;
    if(!pk) return {key:'',isDup:false};
    if((initEvent.members||[]).includes(pk)) return {key:pk,isDup:false};
    const allM=initEvent.members||[];
    const matches=allM.filter(k=>getBaseName(k)===pk);
    if(matches.length===1) return {key:matches[0],isDup:false};
    if(matches.length>1) return {key:'',isDup:true};
    return {key:'',isDup:false};
  };
  const resolved=resolveKey();

  const [event,setEvent]=useState(initEvent);
  const [selectedKey,setSelectedKey]=useState(resolved.key);
  const [dupWarning,setDupWarning]=useState(resolved.isDup);
  const [searchQ,setSearchQ]=useState(resolved.isDup?participantKey:'');
  const lsGet=k=>{try{return localStorage.getItem(k);}catch{return null;}};
  const lsSet=(k,v)=>{try{localStorage.setItem(k,v);}catch{}};
  const [splashDone,setSplashDone]=useState(()=>!!lsGet('splash_event_'+initEvent.code));

  useEffect(()=>setEvent(initEvent),[initEvent]);
  useRealtimeEvent(event.code,ev=>setEvent(ev));
  useEffect(()=>{api.trackView(event.code,null,participantKey||'anonymous');},[]);

  if(!splashDone) return <ParticipantSplashScreen onDone={()=>{lsSet('splash_event_'+initEvent.code,'1');setSplashDone(true);}}/>;


  const mm=event.memberMap||{};
  const amounts=calcAmounts(event);
  const myPayStatus=getPayStatus(event.payments?.[selectedKey]);
  const isPaid=myPayStatus==='paid';
  const isRequested=myPayStatus==='requested';
  const isRejected=myPayStatus==='rejected';
  const myAmount=amounts[selectedKey]||0;
  const myRounds=(event.rounds||[]).filter(r=>(r.members||[]).includes(selectedKey));

  const markRequested=async()=>{
    if(!selectedKey||myPayStatus==='paid'||myPayStatus==='requested'||myPayStatus==='rejected') return;
    await api.markEventRequested(event.code,selectedKey);
    setEvent(ev=>({...ev,payments:{...ev.payments,[selectedKey]:{...(ev.payments?.[selectedKey]||{}),payStatus:'requested',requested:true,requestedAt:new Date().toISOString()}}}));
  };

  if(!selectedKey){
    const allMembers=event.members||[];
    // 동명이인 감지: 이름 → [키] 맵 (전체 멤버 기준)
    const nameToKeys={};
    allMembers.forEach(k=>{
      const name=getBaseName(k);
      if(!nameToKeys[name]) nameToKeys[name]=[];
      nameToKeys[name].push(k);
    });
    const getChipLabel=k=>{
      const name=getBaseName(k);
      const dupes=nameToKeys[name]||[];
      if(dupes.length<=1) return name;
      const sid=k.includes('_')?k.substring(k.lastIndexOf('_')+1):'';
      if(sid) return `${name} (${sid.slice(-4)})`;
      const noSidKeys=dupes.filter(d=>!d.includes('_'));
      if(noSidKeys.length>1) return `${name} (${noSidKeys.indexOf(k)+1}번째)`;
      return `${name} (학번 없음)`;
    };

    const filtered=allMembers.filter(k=>{
      if(!searchQ) return false; // 입력 없으면 전체 숨김
      return getChipLabel(k).includes(searchQ)||getBaseName(k).includes(searchQ);
    });

    return(
      <div className="fade-up screen" style={{background:C.pageBg}}>
        <Header title={event.name} onBack={()=>nav.setView('home')}/>
        <div style={{fontSize:12,color:C.textMid,textAlign:'center',padding:'5px 0 3px',fontWeight:600}}>정산해로 진행 중인 정산</div>
        <div style={{padding:20}}>
          {dupWarning&&(
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,padding:'10px 14px',background:C.orangeBg,borderRadius:12,border:`1px solid ${C.orange}30`}}>
              <Icon n="triangle-alert" size={15} color={C.orange}/>
              <span style={{fontSize:13,color:C.orange,fontWeight:700}}>동명이인이 있어요. 이름을 검색하고 선택해주세요</span>
            </div>
          )}
          {!dupWarning&&(
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,padding:'10px 14px',background:C.accentBg,borderRadius:12,border:`1px solid ${C.accent}20`}}>
              <span className="ms ms-sm" style={{color:C.accent}}>info</span>
              <span style={{fontSize:13,color:C.accent,fontWeight:700}}>본인 이름 검색 후 입금해주세요</span>
            </div>
          )}
          <div style={{fontWeight:800,color:C.text,fontSize:16,marginBottom:12}}>이름을 검색해주세요</div>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="내 이름 검색"
            autoFocus
            style={{width:'100%',padding:'13px 14px',background:C.cardBg,border:`1.5px solid ${C.border}`,borderRadius:12,color:C.text,fontSize:15,outline:'none',marginBottom:8,boxShadow:C.shadow}}
            onFocus={e=>e.target.style.border=`1.5px solid ${C.accent}`}
            onBlur={e=>e.target.style.border=`1.5px solid ${C.border}`}
          />
          {!searchQ&&<div style={{fontSize:12,color:C.textDim,textAlign:'center',marginBottom:14}}>이름을 검색해서 본인을 선택해주세요</div>}

          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {filtered.map(k=>{
              const ps=getPayStatus(event.payments?.[k]);
              const isAbsent=event.attendance[k]===false;
              return(
                <button key={k} onClick={async()=>{
                  if(!isAbsent&&(event.attendance[k]===undefined||event.attendance[k]===null)){
                    await api.markEventAttendance(event.code,k,true);
                    setEvent(ev=>({...ev,attendance:{...ev.attendance,[k]:true}}));
                  }
                  setSelectedKey(k);
                }} className="press" style={{
                  padding:'14px 16px',background:C.cardBg,border:`1.5px solid ${isAbsent?C.border:ps==='paid'?C.green+'50':C.border}`,
                  borderRadius:14,color:isAbsent?C.textDim:C.text,fontSize:14,fontWeight:600,cursor:'pointer',
                  textAlign:'left',fontFamily:'inherit',display:'flex',justifyContent:'space-between',alignItems:'center',
                  boxShadow:C.shadow,opacity:isAbsent?0.6:1,
                }}>
                  <span>{getChipLabel(k)}</span>
                  {isAbsent&&<span style={{color:C.textDim,fontSize:12,fontWeight:700,background:C.inputBg,padding:'3px 8px',borderRadius:8}}>결석</span>}
                </button>
              );
            })}
            {searchQ&&filtered.length===0&&<div style={{color:C.textDim,fontSize:13,textAlign:'center',padding:'20px 0'}}>일치하는 이름이 없어요</div>}
          </div>
        </div>
      </div>
    );
  }

  return(
    <div className="fade-up screen" style={{background:C.pageBg}}>
      <Header title={event.name} onBack={()=>setSelectedKey('')}/>
      <div style={{fontSize:12,color:C.textMid,textAlign:'center',padding:'5px 0 3px',fontWeight:600}}>정산해로 진행 중인 정산</div>
      <div style={{padding:'16px 16px 24px'}}>
        <Card style={{background:isPaid?C.greenBg:C.cardBg,border:`1.5px solid ${isPaid?C.green+'40':C.border}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
            <div>
              <div style={{fontSize:22,fontWeight:900,color:C.text}}>{mm[selectedKey]||selectedKey}</div>
              <div style={{color:C.textDim,fontSize:12,marginTop:3}}>{event.date}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:28,fontWeight:900,color:C.accent}}>{fmtKRW(myAmount)}</div>
              <div style={{fontSize:11,color:C.textDim,marginTop:2}}>납부 금액</div>
            </div>
          </div>
          {myRounds.length>0&&(
            <div style={{borderTop:`1.5px solid ${C.border}`,paddingTop:12,marginBottom:14}}>
              {myRounds.map(r=>{
                const totalCount=((r.members?.length||0)+(r.extraMembers?.length||0)+(r.includeOrganizer===true?1:0))||1;
                const share=Math.ceil(r.amount/totalCount);
                const roundSurplus=share*totalCount-r.amount;
                return(
                  <div key={r.id} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:7}}>
                    <div>
                      <div style={{fontSize:13,color:C.textMid}}>{r.label} ({totalCount}명 균등)</div>
                      {roundSurplus>0&&<div style={{fontSize:11,color:C.textDim,marginTop:2}}>올림 +{roundSurplus}원</div>}
                    </div>
                    <span style={{fontSize:13,color:C.text,fontWeight:800}}>{fmtKRW(share)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {isRejected?(
            <div style={{background:C.redBg,borderRadius:10,padding:'12px 14px',display:'flex',alignItems:'center',gap:8}}>
              <Icon n="circle-x" size={16} color={C.red}/>
              <div style={{fontSize:13,color:C.red,fontWeight:700,lineHeight:1.5}}>처리에서 제외됐어요. 총무에게 문의해주세요.</div>
            </div>
          ):event.account?.bank&&!isPaid?(()=>{
            const tl=getTossLink(event.account.bank,event.account.number,myAmount);
            const kl=getKakaoBankLink(event.account.bank,event.account.number,myAmount);
            return(
              <div style={{marginBottom:14}}>
                <div style={{background:C.inputBg,borderRadius:12,padding:'12px 14px',border:`1.5px solid ${C.border}`,marginBottom:10}}>
                  <div style={{fontSize:11,color:C.textDim,marginBottom:6,fontWeight:600}}>입금 계좌</div>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div>
                      <div style={{fontSize:13,color:C.textMid}}>{event.account.bank} · {event.account.holder}</div>
                      <div style={{fontSize:16,fontWeight:900,color:C.text,marginTop:2,letterSpacing:0.5}}>{event.account.number}</div>
                    </div>
                    <button onClick={async(e)=>{
                      e.stopPropagation();
                      await copyText(event.account.number);
                      showToast('계좌번호 복사됐어요');
                      markRequested();
                    }} style={{background:C.accentBg,border:`1.5px solid ${C.accent}30`,borderRadius:10,padding:'8px 14px',color:C.accent,fontSize:13,fontWeight:700,cursor:'pointer',flexShrink:0}}>복사</button>
                  </div>
                </div>
                {(tl||kl)&&(
                  <div style={{display:'flex',gap:8}}>
                    {tl&&<a href={tl} onClick={markRequested} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'12px',borderRadius:12,background:'#0050FF',color:'#fff',fontWeight:700,fontSize:13,textDecoration:'none'}}>토스 송금</a>}
                    {kl&&<a href={kl} onClick={markRequested} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'12px',borderRadius:12,background:'#FEE500',color:'#191919',fontWeight:700,fontSize:13,textDecoration:'none'}}>카뱅 송금</a>}
                  </div>
                )}
              </div>
            );
          })():null}
          {isPaid?(
            <div>
              <div style={{textAlign:'center',color:C.green,fontWeight:900,fontSize:15,padding:'8px 0 12px',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                ⏳ 확인 대기 {event.payments[selectedKey]?.time?'· '+fmtTime(event.payments[selectedKey].time):''}
              </div>
            </div>
          ):!isRejected?(
            <div style={{background:C.orangeBg,borderRadius:10,padding:'10px 14px',display:'flex',alignItems:'center',gap:8}}>
              <Icon n="triangle-alert" size={14} color={C.orange}/>
              <div style={{fontSize:12,color:C.orange,fontWeight:700,lineHeight:1.5}}>반드시 본인 이름으로 입금해주세요</div>
            </div>
          ):null}
        </Card>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div style={{fontWeight:800,color:C.text,fontSize:14}}>전체 입금 현황</div>
          <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:C.green,fontWeight:600}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:C.green}}/>실시간
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
          {event.members.filter(k=>event.attendance[k]!==false).map(k=>{
            const p=event.payments?.[k];
            const ps=getPayStatus(p);
            const paid=ps==='paid';
            const req=ps==='requested';
            const isMe=k===selectedKey;
            const oxColor=paid?C.green:req?C.yellow:C.red;
            const oxBg=paid?C.greenBg:req?C.yellowBg:C.cardBg;
            return(
              <div key={k} style={{background:oxBg,borderRadius:14,padding:'14px 6px',textAlign:'center',border:`2px solid ${isMe?C.accent+'80':paid?C.green+'40':req?C.yellow+'40':C.red+'30'}`,animation:(!paid&&!req)?'borderPulse 1.8s ease infinite':'none',transition:'background 0.3s'}}>
                <div style={{display:'flex',justifyContent:'center',alignItems:'center',height:24}}>
                  <div style={{width:isMe&&!paid?14:12,height:isMe&&!paid?14:12,borderRadius:'50%',background:oxColor,animation:(!paid&&!req)?'pulse 1.2s ease infinite':'none',transition:'all 0.2s'}}/>
                </div>
                <div style={{fontSize:11,color:isMe?C.accent:C.text,fontWeight:isMe?900:600,marginTop:6,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',padding:'0 4px'}}>{mm[k]||k}</div>
                <div style={{fontSize:10,color:C.textDim,marginTop:3,minHeight:14}}></div>
              </div>
            );
          })}
        </div>
        <div style={{textAlign:'center',paddingTop:4,paddingBottom:8}}>
          <button onClick={()=>setSelectedKey('')} style={{background:'none',border:'none',color:C.textDim,fontSize:12,cursor:'pointer',textDecoration:'underline',padding:'4px 8px'}}>다른 이름으로 검색</button>
        </div>
      </div>

    </div>
  );
}

// ── HelpScreen ─────────────────────────────────────────────
function HelpScreen({nav}){
  const [faqOpen,setFaqOpen]=useState(false);
  const [openIdx,setOpenIdx]=useState(null);
  const [showSmallOnboarding,setShowSmallOnboarding]=useState(false);
  const [showFormOnboarding,setShowFormOnboarding]=useState(false);
  const faqs=FAQS;
  return(
    <div className="fade-up screen" style={{background:C.pageBg}}>
      {showSmallOnboarding&&<SmallEventOnboardingModal onClose={()=>setShowSmallOnboarding(false)} showNeverShow={false}/>}
      {showFormOnboarding&&<FormOnboardingModal onClose={()=>setShowFormOnboarding(false)} showNeverShow={false}/>}
      <Header title="도움말" onBack={()=>nav.setView('home')}/>
      <div style={{padding:'16px 16px 48px'}}>
        <button onClick={()=>nav.setView('usage-guide')} className="press"
          style={{width:'100%',padding:'20px',borderRadius:16,marginBottom:10,background:C.cardBg,border:`1px solid ${C.border}`,cursor:'pointer',textAlign:'left',display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:44,height:44,borderRadius:12,background:C.accentBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon n="book-open" size={22} color={C.accent}/></div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,color:C.text,fontSize:15}}>사용방법</div>
            <div style={{fontSize:12,color:C.textMid,marginTop:3}}>정산해 사용 흐름 안내</div>
          </div>
          <span className="ms" style={{color:C.textDim}}>chevron_right</span>
        </button>
        <div style={{borderRadius:16,background:C.cardBg,border:`1px solid ${C.border}`,overflow:'hidden',marginBottom:10}}>
          <div style={{padding:'14px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:44,height:44,borderRadius:12,background:C.greenBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon n="play-circle" size={22} color={C.green}/></div>
            <div>
              <div style={{fontWeight:800,color:C.text,fontSize:15}}>사용법 다시 보기</div>
              <div style={{fontSize:12,color:C.textMid,marginTop:3}}>기능별 튜토리얼</div>
            </div>
          </div>
          <button onClick={()=>setShowSmallOnboarding(true)} className="press" style={{width:'100%',padding:'14px 20px',background:'none',border:'none',borderBottom:`1px solid ${C.pageBg}`,cursor:'pointer',textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:14,fontWeight:600,color:C.text}}>소규모 정산 사용법</span>
            <span className="ms" style={{color:C.textDim}}>chevron_right</span>
          </button>
          <button onClick={()=>setShowFormOnboarding(true)} className="press" style={{width:'100%',padding:'14px 20px',background:'none',border:'none',cursor:'pointer',textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:14,fontWeight:600,color:C.text}}>신청폼 사용법</span>
            <span className="ms" style={{color:C.textDim}}>chevron_right</span>
          </button>
        </div>
        <div style={{borderRadius:16,background:C.cardBg,border:`1px solid ${C.border}`,overflow:'hidden'}}>
          <button onClick={()=>{setFaqOpen(v=>!v);setOpenIdx(null);}} className="press"
            style={{width:'100%',padding:'20px',background:'none',border:'none',cursor:'pointer',textAlign:'left',display:'flex',alignItems:'center',gap:14}}>
            <div style={{width:44,height:44,borderRadius:12,background:C.yellowBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon n="help-circle" size={22} color={C.yellow}/></div>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,color:C.text,fontSize:15}}>자주 묻는 질문</div>
              <div style={{fontSize:12,color:C.textMid,marginTop:3}}>FAQ</div>
            </div>
            <span className="ms" style={{color:C.textDim}}>{faqOpen?'expand_less':'expand_more'}</span>
          </button>
          {faqOpen&&(
            <div style={{borderTop:`1px solid ${C.border}`,padding:'8px 0'}}>
              {faqs.map((f,i)=>(
                <div key={i} style={{borderBottom:i<faqs.length-1?`1px solid ${C.pageBg}`:'none'}}>
                  <button onClick={()=>setOpenIdx(openIdx===i?null:i)} style={{width:'100%',background:'none',border:'none',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,padding:'14px 20px',textAlign:'left'}}>
                    <div style={{fontWeight:700,color:C.text,fontSize:14,lineHeight:1.5}}>{f.q}</div>
                    <span className="ms" style={{color:C.textDim,fontSize:18,flexShrink:0,marginTop:2}}>{openIdx===i?'expand_less':'expand_more'}</span>
                  </button>
                  {openIdx===i&&<div style={{fontSize:13,color:C.textMid,lineHeight:1.85,padding:'0 20px 16px',whiteSpace:'pre-wrap'}}>{f.a}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── UsageGuideScreen ────────────────────────────────────────
function UsageGuideScreen({nav}){
  const Sep=()=><div style={{height:1,background:C.border,margin:'14px 0'}}/>;
  return(
    <div className="fade-up screen" style={{background:C.pageBg}}>
      <Header title="사용방법" onBack={()=>nav.setView('help')}/>
      <div style={{padding:'20px 20px 56px'}}>
        <div>
          <div style={{fontWeight:800,color:C.text,fontSize:15,marginBottom:8}}>시작 전</div>
          <div style={{fontSize:14,color:C.textMid,lineHeight:1.8}}>명단과 받을 계좌를 등록해두세요.</div>
        </div>
        <Sep/>
        <div>
          <div style={{fontWeight:800,color:C.text,fontSize:15,marginBottom:4,display:'flex',alignItems:'center',gap:6}}><Icon n="inbox" size={15} color={C.orange}/>신청 받고 정산하기</div>
          <div style={{fontSize:12,color:C.orange,fontWeight:600,marginBottom:10}}>MT, 학생회비, 야식 등</div>
          <div style={{fontSize:14,color:C.textMid,lineHeight:1.8}}>신청폼을 만들어 공유하면 사용자가 직접 신청하고 송금해요. 거래내역 Excel을 올리면 입금이 자동 확인되고, 미입금자에게 콕 찌르기 메시지를 보낼 수 있어요.</div>
        </div>
        <Sep/>
        <div>
          <div style={{fontWeight:800,color:C.text,fontSize:15,marginBottom:4,display:'flex',alignItems:'center',gap:6}}><Icon n="users" size={15} color={C.accent}/>바로 정산하기</div>
          <div style={{fontSize:12,color:C.accent,fontWeight:600,marginBottom:10}}>술자리, 뒷풀이, 회식</div>
          <div style={{fontSize:14,color:C.textMid,lineHeight:1.8}}>모인 사람들로 즉석 정산. 출석 체크하고 금액 입력하면 멤버별 본인 금액이 자동 계산돼요. 1차·2차·3차 차수도 추가 가능. 거래내역 Excel로 입금 자동 확인.</div>
        </div>
        <Sep/>
        <div>
          <div style={{fontWeight:800,color:C.text,fontSize:15,marginBottom:10}}>학생회비 차등 정산</div>
          <div style={{fontSize:14,color:C.textMid,lineHeight:1.8}}>정산 만들 때 <strong style={{color:C.text}}>"두 갈래 금액"</strong>을 선택하면 학생회비 납부자/미납자에게 다른 금액이 자동 적용돼요.</div>
        </div>
        <Sep/>
        <div>
          <div style={{fontWeight:800,color:C.text,fontSize:15,marginBottom:10}}>행사 후 추가 정산</div>
          <div style={{fontSize:14,color:C.textMid,lineHeight:1.8}}>신청폼 마감 후 뒷풀이가 생기면 <strong style={{color:C.text}}>"이어서 정산하기"</strong>로 같은 멤버를 그대로 가져와 정산할 수 있어요.</div>
        </div>
      </div>
    </div>
  );
}

// ── HistoryScreen ──────────────────────────────────────────
function HistoryScreen({nav,events,forms,deleteEvent,deleteForm}){
  const [sel,setSel]=useState(null);
  const [tab,setTab]=useState('events'); // events, forms
  // 완료된 정산만
  const doneEvents=events.filter(ev=>isEventDone(ev));
  const closedForms=(forms||[]).filter(f=>f.status==='closed');

  const del=async code=>{
    if(!window.confirm('이 정산 기록을 삭제할까요?')) return;
    await deleteEvent(code);
    if(sel===code) setSel(null);
  };

  const delForm=async code=>{
    if(!window.confirm('이 신청폼을 삭제할까요?')) return;
    await deleteForm(code);
  };

  if(sel){
    const ev=events.find(e=>e.code===sel);
    if(!ev){setSel(null);return null;}
    const mm=ev.memberMap||{};
    const amounts=calcAmounts(ev);
    const surplus=calcSurplus(ev);
    const presentMembers=ev.members.filter(k=>ev.attendance[k]!==false);
    const pc=presentMembers.filter(k=>getPayStatus(ev.payments?.[k])==='paid').length;
    const totalAmt=ev.rounds.reduce((s,r)=>s+r.amount,0);
    return(
      <div className="fade-up screen" style={{background:C.pageBg}}>
        <Header title={ev.name} onBack={()=>setSel(null)}/>
        <div style={{padding:'16px 16px 24px'}}>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:surplus>0?8:16}}>
            {[[ev.date,C.textMid],[`${pc}/${presentMembers.length} 완료`,C.green],[fmtKRW(totalAmt),C.text]].map(([t,c])=>(
              <Badge key={t} color={c}>{t}</Badge>
            ))}
          </div>
          {surplus>0&&<div style={{fontSize:11,color:C.textMid,marginBottom:14}}>소수점을 올림해서 총액보다 <span style={{color:C.text,fontWeight:700}}>{fmtKRW(surplus)}</span> 더 걷혀요 <span style={{color:C.textDim}}>(총무 손해 방지)</span></div>}
          {ev.rounds.map(r=>(
            <Card key={r.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px'}}>
              <div>
                <div style={{fontWeight:800,color:C.text}}>{r.label}</div>
                <div style={{fontSize:11,color:C.textMid,marginTop:2}}>{r.members.length}명 · 1인 {fmtKRW(Math.ceil(r.amount/r.members.length))}</div>
              </div>
              <div style={{color:C.accent,fontWeight:900}}>{fmtKRW(r.amount)}</div>
            </Card>
          ))}
          <div style={{fontWeight:800,color:C.text,marginTop:12,marginBottom:10,fontSize:14}}>입금 현황</div>
          {presentMembers.map(k=>{
            const paid=getPayStatus(ev.payments?.[k])==='paid';
            return(
              <div key={k} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 0',borderBottom:`1px solid ${C.border}`}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:10,height:10,borderRadius:'50%',background:paid?'#5DCAA5':'#E24B4A',flexShrink:0}}/>
                  <span style={{color:C.text,fontSize:14}}>{mm[k]||k}</span>
                </div>
                <span style={{color:C.accent,fontSize:13,fontWeight:800}}>{fmtKRW(amounts[k]||0)}</span>
              </div>
            );
          })}
          <div style={{marginTop:24}}><Btn variant="danger" onClick={()=>del(ev.code)} small>이 정산 삭제</Btn></div>
        </div>
      </div>
    );
  }

  return(
    <div className="fade-up screen" style={{background:C.pageBg}}>
      <Header title="정산 내역" onBack={()=>nav.setView('home')}/>
      
      {/* 탭 */}
      <div style={{display:'flex',padding:'12px 18px 0',gap:8}}>
        {[['events','정산'],['forms','신청폼']].map(([key,label])=>(
          <button key={key} onClick={()=>setTab(key)} style={{
            flex:1,padding:'10px',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer',
            background:tab===key?C.accent:'#fff',color:tab===key?'#fff':C.textMid,
            border:`1px solid ${tab===key?C.accent:C.border}`,
          }}>{label}</button>
        ))}
      </div>

      <div style={{padding:'16px 16px 24px'}}>
        {tab==='events'&&(
          doneEvents.length===0?(
            <div style={{textAlign:'center',padding:'64px 0'}}>
              <div style={{width:56,height:56,borderRadius:28,background:C.textDim+'18',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px'}}><Icon n="inbox" size={28} color={C.textDim}/></div>
              <div style={{color:C.textDim,fontSize:14}}>완료된 정산이 없어요</div>
            </div>
          ):doneEvents.map(ev=>{
            const presentMembers=ev.members.filter(k=>ev.attendance[k]!==false);
            const totalAmt=ev.rounds.reduce((s,r)=>s+r.amount,0);
            return(
              <div key={ev.code} onClick={()=>setSel(ev.code)} className="press" style={{background:C.cardBg,borderRadius:16,padding:'16px 18px',marginBottom:10,boxShadow:C.shadow,cursor:'pointer',border:`1.5px solid ${C.green}30`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontWeight:800,color:C.text,fontSize:15}}>{ev.name}</div>
                    <div style={{color:C.textDim,fontSize:12,marginTop:3}}>{ev.date} · {presentMembers.length}명 · {ev.rounds.length}차</div>
                  </div>
                  <Badge color={C.green}>완료</Badge>
                </div>
                {totalAmt>0&&<div style={{marginTop:8,fontSize:12,color:C.textMid}}>총 <span style={{color:C.text,fontWeight:800}}>{fmtKRW(totalAmt)}</span></div>}
              </div>
            );
          })
        )}

        {tab==='forms'&&(
          closedForms.length===0?(
            <div style={{textAlign:'center',padding:'64px 0'}}>
              <div style={{width:56,height:56,borderRadius:28,background:C.textDim+'18',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px'}}><Icon n="inbox" size={28} color={C.textDim}/></div>
              <div style={{color:C.textDim,fontSize:14}}>마감된 신청폼이 없어요</div>
            </div>
          ):closedForms.map(f=>{
            const paidCount=(f.submissions||[]).filter(s=>s.paid).length;
            return(
              <div key={f.code} className="press" style={{background:C.cardBg,borderRadius:16,padding:'16px 18px',marginBottom:10,boxShadow:C.shadow,border:`1.5px solid ${C.orange}30`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontWeight:800,color:C.text,fontSize:15}}>{f.name}</div>
                    <div style={{color:C.textDim,fontSize:12,marginTop:3}}>{f.date} · {f.submissions?.length||0}명 신청 · {paidCount}명 입금</div>
                  </div>
                  <Badge color={C.orange}>마감</Badge>
                </div>
                <div style={{marginTop:8,fontSize:12,color:C.textMid}}>총 <span style={{color:C.text,fontWeight:800}}>{fmtKRW((f.submissions||[]).reduce((sum,s)=>sum+getUserAmount(f,s.name,s.data?.studentId),0))}</span></div>
                <button onClick={()=>delForm(f.code)} style={{marginTop:10,padding:'6px 12px',borderRadius:8,background:C.redBg,color:C.red,border:'none',fontSize:12,fontWeight:600,cursor:'pointer'}}>삭제</button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}


// ── OnboardingModal (가입 후 1회) ─────────────────────────
function OnboardingModal({nav,onClose}){
  const [neverShow,setNeverShow]=useState(false);
  const finish=async()=>{
    if(neverShow){
      try{
        const {data:{user}}=await api.getUser();
        if(user){
          await api.updateProfile(user.id,{onboarding_done:true,updated_at:new Date().toISOString()});
          localStorage.setItem('onboarding_done_'+user.id,'true');
        }
      }catch(e){console.error(e);}
    }
    posthog.capture('온보딩_환영_완료',{다시_보지_않기:neverShow});
    onClose();
    nav.setView('setup');
  };

  return(
    <Modal isOpen={true} onClose={finish} closeOnBackdrop={false} showCloseButton={false} maxWidth={400}>
      <div className="fade-up">
        <div style={{textAlign:'center',marginBottom:24}}>
          <div style={{fontSize:40,marginBottom:10}}>👋</div>
          <div style={{fontWeight:900,color:C.text,fontSize:21,marginBottom:8,letterSpacing:-0.5,lineHeight:1.3}}>총무 일, 이제 자동으로.</div>
          <div style={{fontSize:13,color:C.textMid,lineHeight:1.8}}>먼저 명단·계좌부터 설정해주세요.</div>
        </div>
        <Btn onClick={finish}>시작하기 →</Btn>
        <div onClick={()=>setNeverShow(v=>!v)} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:16,cursor:'pointer'}}>
          <div style={{width:18,height:18,borderRadius:5,border:`2px solid ${neverShow?C.accent:C.border}`,background:neverShow?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.12s'}}>
            {neverShow&&<Icon n="check" size={11} color="#fff"/>}
          </div>
          <span style={{fontSize:13,color:C.textMid}}>다시 보지 않기</span>
        </div>
      </div>
    </Modal>
  );
}

// ── SmallEventOnboardingModal (소규모 첫 진입 1회) ──────────
function SmallEventOnboardingModal({onClose,showNeverShow=true,userId=null}){
  const [slide,setSlide]=useState(0);
  const [neverShow,setNeverShow]=useState(false);
  useEffect(()=>{posthog.capture('온보딩_정산_표시');},[]);
  const finish=()=>{
    if(neverShow&&showNeverShow&&userId){
      localStorage.setItem('small_onb_done_'+userId,'1');
      api.updateProfile(userId,{small_event_onboarding_done:true});
    }
    posthog.capture('온보딩_정산_완료',{다시_보지_않기:neverShow});
    onClose();
  };
  const SLIDES=[
    {msIcon:'checklist',color:C.green,body:'참가자 출석 체크 후\n1차·2차 금액을 입력하면\n인당 분담금이 자동으로 계산돼요.'},
    {msIcon:'upload_file',color:'#3B82F6',body:'은행 앱에서 거래내역서를 엑셀로 받아\n업로드하면 입금자를 자동으로 매칭해요.\n미입금자에게 콕 찌르기로 알림도 보낼 수 있어요.'},
    {msIcon:'hourglass_empty',color:'#F59E0B',body:'여유 있게 진행해도 괜찮아요.\n\n정산은 사람들이 모일 시간이 필요해요.\n콕 찌르기는 충분한 시간이 지난 후 사용하세요.'},
  ];
  const s=SLIDES[slide];
  const isLast=slide===SLIDES.length-1;
  return(
    <Modal isOpen={true} onClose={onClose} closeOnBackdrop={false} showCloseButton={false} maxWidth={400}>
      <div className="fade-up" style={{padding:'8px 4px 4px'}}>
        <div style={{textAlign:'center',marginBottom:24}}>
          <div style={{marginBottom:14}}><span style={{fontFamily:'Material Symbols Rounded',fontSize:72,lineHeight:1,color:s.color,fontVariationSettings:"'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 48",display:'block'}}>{s.msIcon}</span></div>
          <div style={{fontSize:14,color:C.textMid,lineHeight:1.9,whiteSpace:'pre-line'}}>{s.body}</div>
        </div>
        <div style={{display:'flex',justifyContent:'center',gap:6,marginBottom:20}}>
          {SLIDES.map((_,i)=><div key={i} style={{width:i===slide?18:6,height:6,borderRadius:3,background:slide===i?C.accent:C.border,transition:'all 0.25s'}}/>)}
        </div>
        {isLast?(
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {showNeverShow&&(
              <button onClick={()=>setNeverShow(v=>!v)} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',cursor:'pointer',padding:'8px 4px',flexShrink:0}}>
                <div style={{width:18,height:18,borderRadius:4,border:`2px solid ${neverShow?C.accent:C.border}`,background:neverShow?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}}>
                  {neverShow&&<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
                <span style={{fontSize:12,fontWeight:600,color:neverShow?C.accent:C.textDim,whiteSpace:'nowrap',transition:'color 0.15s'}}>다시 안 보기</span>
              </button>
            )}
            <Btn style={{flex:1,width:'auto'}} onClick={finish}>확인</Btn>
          </div>
        ):<Btn onClick={()=>setSlide(v=>v+1)}>다음</Btn>}
      </div>
    </Modal>
  );
}

// ── FormOnboardingModal (신청폼 첫 진입 1회) ──────────────────
function FormOnboardingModal({onClose,showNeverShow=true,userId=null}){
  const [slide,setSlide]=useState(0);
  const [neverShow,setNeverShow]=useState(false);
  useEffect(()=>{posthog.capture('온보딩_신청폼_표시');},[]);
  const finish=()=>{
    if(neverShow&&showNeverShow&&userId){
      localStorage.setItem('form_onb_done_'+userId,'1');
      api.updateProfile(userId,{form_onboarding_done:true});
    }
    posthog.capture('온보딩_신청폼_완료',{다시_보지_않기:neverShow});
    onClose();
  };
  const SLIDES=[
    {msIcon:'share',color:C.orange,body:'신청폼을 만들고 링크를 공유하면\n신청자 명단이 실시간으로 쌓여요.\n이름·학번·연락처 등 원하는 항목을 받을 수 있어요.'},
    {msIcon:'receipt_long',color:'#F59E0B',body:'거래내역서를 업로드하면\n정산과 동일하게 자동 매칭됩니다.\n행사 끝나면 신청자 명단 그대로 뒷풀이 정산도 이어갈 수 있어요.'},
    {msIcon:'hourglass_empty',color:'#F59E0B',body:'여유 있게 진행해도 괜찮아요.\n\n신청과 입금은 사람들이 결정할 시간이 필요해요.\n콕 찌르기는 충분한 시간이 지난 후 사용하세요.'},
  ];
  const s=SLIDES[slide];
  const isLast=slide===SLIDES.length-1;
  return(
    <Modal isOpen={true} onClose={onClose} closeOnBackdrop={false} showCloseButton={false} maxWidth={400}>
      <div className="fade-up" style={{padding:'8px 4px 4px'}}>
        <div style={{textAlign:'center',marginBottom:24}}>
          <div style={{marginBottom:14}}><span style={{fontFamily:'Material Symbols Rounded',fontSize:72,lineHeight:1,color:s.color,fontVariationSettings:"'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 48",display:'block'}}>{s.msIcon}</span></div>
          <div style={{fontSize:14,color:C.textMid,lineHeight:1.9,whiteSpace:'pre-line'}}>{s.body}</div>
        </div>
        <div style={{display:'flex',justifyContent:'center',gap:6,marginBottom:20}}>
          {SLIDES.map((_,i)=><div key={i} style={{width:i===slide?18:6,height:6,borderRadius:3,background:slide===i?C.accent:C.border,transition:'all 0.25s'}}/>)}
        </div>
        {isLast?(
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {showNeverShow&&(
              <button onClick={()=>setNeverShow(v=>!v)} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',cursor:'pointer',padding:'8px 4px',flexShrink:0}}>
                <div style={{width:18,height:18,borderRadius:4,border:`2px solid ${neverShow?C.accent:C.border}`,background:neverShow?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}}>
                  {neverShow&&<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
                <span style={{fontSize:12,fontWeight:600,color:neverShow?C.accent:C.textDim,whiteSpace:'nowrap',transition:'color 0.15s'}}>다시 안 보기</span>
              </button>
            )}
            <Btn style={{flex:1,width:'auto'}} onClick={finish}>확인</Btn>
          </div>
        ):<Btn onClick={()=>setSlide(v=>v+1)}>다음</Btn>}
      </div>
    </Modal>
  );
}

// ── FormCreateScreen (대규모 신청폼 생성) ──────────────────
function FormCreateScreen({nav,profile,createForm}){
  const [showOnboarding,setShowOnboarding]=useState(false);
  useEffect(()=>{
    if(!profile?.id) return;
    if(localStorage.getItem('form_onb_done_'+profile.id)) return;
    api.getProfileFields(profile.id,'form_onboarding_done')
      .then(({data})=>{if(!data?.form_onboarding_done) setShowOnboarding(true);})
      .catch(()=>setShowOnboarding(true));
  },[profile?.id]);
  const [name,setName]=useState('');
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [amount,setAmount]=useState('');
  const [amountPaid,setAmountPaid]=useState('');
  const [feeMode,setFeeMode]=useState('single');
  const [useLimit,setUseLimit]=useState(false);
  const [maxPeople,setMaxPeople]=useState('');
  const [bank,setBank]=useState(profile.account?.bank||'');
  const [number,setNumber]=useState(profile.account?.number||'');
  const [holder,setHolder]=useState(profile.account?.holder||'');
  const [fields,setFields]=useState([
    {id:'name',type:'text',label:'이름',required:true},
    {id:'studentId',type:'text',label:'학번',required:false},
  ]);
  const [time,setTime]=useState('');
  const [place,setPlace]=useState('');
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(false);
  const [customLabel,setCustomLabel]=useState('');
  const [customType,setCustomType]=useState('text');
  const [showCustom,setShowCustom]=useState(false);
  const [showPreview,setShowPreview]=useState(false);
  const noFee=amount!==''&&Number(amount)===0;

  const hasAccount=profile.account?.bank&&profile.account?.number;

  // 빠른 추가용 프리셋
  const presets=[
    {id:'phone',label:'연락처',type:'text'},
    {id:'ssn',label:'주민번호',type:'text'},
    {id:'generation',label:'기수',type:'text'},
    {id:'f_extra',label:'자유 입력',type:'textarea'},
  ];
  const usedLabels=fields.map(f=>f.label);
  const availPresets=presets.filter(p=>!usedLabels.includes(p.label));

  const addPreset=p=>{
    setFields(fs=>[...fs,{id:p.id||'f'+Date.now(),type:p.type,label:p.label,required:false,options:p.options||[]}]);
  };
  const addCustom=()=>{
    if(!customLabel.trim()) return;
    const opts=customType==='select'?['옵션 1','옵션 2']:[];
    setFields(fs=>[...fs,{id:'f'+Date.now(),type:customType,label:customLabel.trim(),required:false,options:opts}]);
    setCustomLabel('');setCustomType('text');setShowCustom(false);
  };
  const removeField=id=>setFields(fs=>fs.filter(f=>f.id!==id));
  const updateField=(id,key,val)=>setFields(fs=>fs.map(f=>f.id===id?{...f,[key]:val}:f));
  const addOption=(id)=>setFields(fs=>fs.map(f=>f.id===id?{...f,options:[...(f.options||[]),'']}:f));
  const removeOption=(id,idx)=>setFields(fs=>fs.map(f=>f.id===id?{...f,options:(f.options||[]).filter((_,i)=>i!==idx)}:f));
  const updateOption=(id,idx,val)=>setFields(fs=>fs.map(f=>f.id===id?{...f,options:(f.options||[]).map((o,i)=>i===idx?val:o)}:f));

  const create=async()=>{
    setErr('');
    if(!name.trim()){setErr('행사명을 입력해주세요');return;}
    if(!amount||isNaN(Number(amount))){setErr('참가비를 입력해주세요');return;}
    if(!noFee&&feeMode==='twoTier'&&(!amountPaid||isNaN(Number(amountPaid)))){setErr('납부자 가격을 입력해주세요');return;}
    const b=bank.trim()||profile.account?.bank||'';
    const n=number.trim()||profile.account?.number||'';
    const h=holder.trim()||profile.account?.holder||'';
    if(!noFee&&(!b||!n||!h)){setErr('계좌 정보를 입력해주세요');return;}

    setLoading(true);
    const code=genCode();
    const cleanFields=fields.map(f=>({...f,options:(f.options||[]).map(o=>o.trim()).filter(Boolean)}));
    const finalFields=cleanFields;
    const memberList=(noFee||feeMode==='twoTier')?buildMemberList(profile):[];
    const form={
      code,name:name.trim(),date,amount:Number(amount),
      amountPaid:!noFee&&feeMode==='twoTier'?Number(amountPaid):null,
      memberList,noFee,
      maxPeople:useLimit&&maxPeople?Number(maxPeople):null,
      account:noFee?{}:{bank:b,number:n,holder:h},fields:finalFields,
      submissions:[],status:'open',createdAt:new Date().toISOString(),
      time:time||null,place:place.trim()||null,
    };
    const ok=await createForm(form);
    setLoading(false);
    if(ok){
      posthog.capture('신청폼_만들기_완료',{참가비:form.amount,정원:form.maxPeople});
      nav.setCurrentFormCode(code);nav.setView('formAdmin');
    }
  };

  return(
    <div className="fade-up screen" style={{background:C.pageBg,display:'flex',flexDirection:'column'}}>
      {showOnboarding&&<FormOnboardingModal onClose={()=>setShowOnboarding(false)} userId={profile.id}/>}
      <Header title="신청폼 만들기" onBack={()=>nav.setView('home')}/>
      <FlowStepper steps={['폼 생성+공유','대조']} current={0} done={[]}/>
      <div style={{flex:1,padding:'8px 16px 16px',overflow:'auto'}}>
        <div style={{fontSize:12,color:C.textDim,fontWeight:500,marginBottom:8,padding:'4px 2px'}}>신청자가 보게 될 메시지를 작성해주세요</div>
        {/* 기본 정보 */}
        <Card>
          <Field label="행사명" value={name} onChange={setName} placeholder="5월 MT, 개강총회…"/>
          <Field label="행사 날짜·시간" value={date+'T'+(time||'00:00')} onChange={v=>{setDate(v.slice(0,10));setTime(v.slice(11,16));}} type="datetime-local"/>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:noFee?4:10}}>금액 설정</div>
            {noFee&&<div style={{fontSize:12,color:C.textDim,marginBottom:10}}>출석 체크 모드 (입금 추적 없음)</div>}
            {!noFee&&<div style={{display:'flex',background:C.inputBg,borderRadius:10,padding:3,marginBottom:10}}>
              {[['single','단일 금액'],['twoTier','두 갈래 금액']].map(([mode,label])=>(
                <button key={mode} onClick={()=>{
                  if(mode==='twoTier'&&feeMode==='single') setFeeMode('twoTier');
                  else if(mode==='single'&&feeMode==='twoTier'){setAmountPaid('');setFeeMode('single');}
                }} style={{flex:1,padding:'7px 0',borderRadius:8,fontSize:13,
                  fontWeight:feeMode===mode?700:500,cursor:'pointer',border:'none',
                  background:feeMode===mode?'#fff':'transparent',
                  color:feeMode===mode?C.accent:C.textDim,
                  boxShadow:feeMode===mode?'0 1px 3px rgba(0,0,0,0.12)':'none',transition:'all 0.15s'}}>
                  {label}
                </button>
              ))}
            </div>}
            {!noFee&&feeMode==='twoTier'?(
              <>
                <Field label="학생회비 미납자 가격 (원)" value={amount} onChange={v=>setAmount(v.replace(/[^0-9]/g,''))} placeholder="5,000" inputMode="numeric"/>
                <Field label="학생회비 납부자 가격 (원)" value={amountPaid} onChange={v=>setAmountPaid(v.replace(/[^0-9]/g,''))} placeholder="4,000" inputMode="numeric"/>
                <div style={{fontSize:12,color:C.textDim,marginTop:4}}>명단 등록 시 자동으로 학생회비 납부자/미납자 구분됩니다</div>
              </>
            ):(
              <Field label="참가비 (원)" value={amount} onChange={v=>setAmount(v.replace(/[^0-9]/g,''))} placeholder="0 입력 시 참가비 없음" inputMode="numeric"/>
            )}
          </div>
          <Field label="장소 (선택)" value={place} onChange={setPlace} placeholder="강남 OO식당, 동아리방…"/>
          <div style={{marginBottom:14}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:useLimit?10:0}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:C.text}}>선착순 마감</div>
                <div style={{fontSize:12,color:C.textDim,marginTop:2}}>정원이 차면 자동 마감돼요</div>
              </div>
              <button onClick={()=>{setUseLimit(v=>!v);if(useLimit)setMaxPeople('');}} style={{
                width:52,height:30,borderRadius:15,border:'none',cursor:'pointer',
                background:useLimit?C.accent:C.disabled,position:'relative',transition:'background 0.2s',
              }}>
                <div style={{width:24,height:24,borderRadius:12,background:'#fff',position:'absolute',top:3,
                  left:useLimit?25:3,transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}}/>
              </button>
            </div>
            {useLimit&&(
              <input value={maxPeople} onChange={e=>setMaxPeople(e.target.value.replace(/[^0-9]/g,''))}
                placeholder="최대 인원 입력" inputMode="numeric"
                style={{width:'100%',padding:'12px 14px',background:C.inputBg,border:`1.5px solid ${C.border}`,borderRadius:12,color:C.text,fontSize:15,outline:'none'}}
              />
            )}
          </div>
        </Card>

        {/* 계좌 - 프로필에 있으면 자동 적용, 참가비 없음이면 숨김 */}
        {!noFee&&<Card>
          <div style={{fontWeight:800,color:C.text,marginBottom:12,fontSize:15,display:'flex',alignItems:'center',gap:6}}><Icon n="credit-card" size={15} color={C.accent}/>입금 계좌</div>
          {hasAccount?(
            <div style={{background:C.inputBg,borderRadius:14,padding:'14px 16px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:C.text}}>{profile.account.bank} {profile.account.number}</div>
                  <div style={{fontSize:13,color:C.textMid,marginTop:2}}>예금주: {profile.account.holder}</div>
                </div>
                <Badge color={C.green}>자동 적용</Badge>
              </div>
            </div>
          ):(
            <>
              <Field label="은행" value={bank} onChange={setBank} placeholder="카카오뱅크"/>
              <Field label="계좌번호" value={number} onChange={setNumber} placeholder="계좌번호" inputMode="numeric"/>
              <Field label="예금주" value={holder} onChange={setHolder} placeholder="홍길동"/>
            </>
          )}
        </Card>}

        {/* 신청폼 항목 */}
        <Card>
          <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:14}}>
            <div style={{fontWeight:800,color:C.text,fontSize:15,display:'flex',alignItems:'center',gap:6}}><Icon n="clipboard-list" size={15} color={C.accent}/>신청 항목</div>
            <div style={{fontSize:12,color:C.textDim,fontWeight:500}}>참여자에게 받고 싶은 정보를 설정하세요</div>
          </div>

          {/* 현재 항목 리스트 */}
          {fields.map(f=>(
            <div key={f.id} style={{padding:'12px 14px',background:C.inputBg,borderRadius:12,marginBottom:6}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{flex:1}}>
                  <span style={{fontWeight:700,color:C.text,fontSize:14}}>{f.label}</span>
                  {f.required&&<span style={{fontSize:11,color:C.red,marginLeft:4}}>*</span>}
                  {f.type==='textarea'&&<span style={{fontSize:11,color:C.accent,marginLeft:6}}>서술형</span>}
                  {f.id==='studentId'&&(noFee||feeMode==='twoTier')&&<span style={{fontSize:10,color:C.textDim,marginLeft:4}}>(없으면 이름으로 대조)</span>}
                </div>
                <button onClick={()=>updateField(f.id,'required',!f.required)} style={{background:f.required?C.redBg:'none',border:`1px solid ${f.required?C.red+'30':C.border}`,borderRadius:8,padding:'3px 8px',fontSize:10,fontWeight:700,color:f.required?C.red:C.textDim,cursor:'pointer'}}>
                  {f.required?'필수':'선택'}
                </button>
                <button onClick={()=>removeField(f.id)} style={{background:'none',border:'none',cursor:'pointer',padding:4,display:'flex'}}>
                  <span className="ms ms-sm" style={{color:C.textDim}}>close</span>
                </button>
              </div>
              {['select','multiselect'].includes(f.type)&&(f.options||[]).length>0&&(
                <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:8}}>
                  {(f.options||[]).map(opt=>(
                    <span key={opt} style={{padding:'4px 12px',borderRadius:16,fontSize:12,fontWeight:600,background:C.accentBg,color:C.accent,border:`1px solid ${C.accent}30`}}>{opt}</span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* 빠른 추가 칩 */}
          {availPresets.length>0&&(
            <div style={{marginTop:12}}>
              <div style={{fontSize:12,color:C.textDim,fontWeight:600,marginBottom:2}}>탭해서 항목 추가</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {availPresets.map(p=>(
                  <button key={p.label} onClick={()=>addPreset(p)} className="press" style={{
                    padding:'8px 14px',borderRadius:20,border:`1.5px dashed ${C.accent}40`,
                    background:'#fff',color:C.accent,fontSize:13,fontWeight:600,cursor:'pointer',
                    display:'flex',alignItems:'center',gap:4,
                  }}>
                    <span style={{fontSize:16,lineHeight:1}}>+</span>
                    <span style={{display:'flex',flexDirection:'column',alignItems:'flex-start'}}>
                      <span>{p.label}</span>
                      {p.hint&&<span style={{fontSize:10,color:C.textDim,fontWeight:500}}>{p.hint}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 직접 입력 */}
          <div style={{marginTop:12}}>
            {showCustom?(
              <div style={{background:C.accentBg,borderRadius:14,padding:'14px 16px',border:`1.5px solid ${C.accent}30`}}>
                <input value={customLabel} onChange={e=>setCustomLabel(e.target.value)} placeholder="항목 이름 입력" autoFocus
                  onKeyDown={e=>e.key==='Enter'&&addCustom()}
                  style={{width:'100%',padding:'10px 14px',border:`1.5px solid ${C.accent}`,borderRadius:12,fontSize:14,outline:'none',background:'#fff',color:C.text,marginBottom:10}}/>
                <div style={{display:'flex',gap:6,marginBottom:12}}>
                  {[['text','텍스트'],['select','선택형'],['textarea','서술형']].map(([val,label])=>(
                    <button key={val} onClick={()=>setCustomType(val)} style={{
                      padding:'7px 14px',borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer',
                      background:customType===val?C.accent:'#fff',
                      color:customType===val?'#fff':C.textMid,
                      border:`1.5px solid ${customType===val?C.accent:C.borderStrong}`,
                    }}>{label}</button>
                  ))}
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>{setShowCustom(false);setCustomLabel('');setCustomType('text');}} style={{flex:1,padding:'10px',borderRadius:12,background:'#fff',color:C.textDim,border:'none',fontSize:14,fontWeight:600,cursor:'pointer'}}>취소</button>
                  <button onClick={addCustom} disabled={!customLabel.trim()} style={{flex:2,padding:'10px',borderRadius:12,background:C.accent,color:'#fff',border:'none',fontSize:14,fontWeight:700,cursor:'pointer',opacity:customLabel.trim()?1:0.4}}>추가</button>
                </div>
              </div>
            ):(
              <button onClick={()=>setShowCustom(true)} style={{
                width:'100%',padding:'12px',borderRadius:12,border:`1.5px dashed ${C.textDim}40`,
                background:'transparent',color:C.textMid,fontSize:14,fontWeight:600,cursor:'pointer',
              }}>
                + 직접 항목 추가
              </button>
            )}
          </div>
        </Card>
      </div>

      {/* 하단 고정 CTA */}
      <div style={{padding:'12px 16px 24px',background:C.cardBg}}>
        {err&&<div style={{color:C.red,fontSize:13,textAlign:'center',marginBottom:10,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:4}}><Icon n="triangle-alert" size={13} color={C.red}/>{err}</div>}
        <Btn onClick={create} loading={loading}>신청폼 만들기</Btn>
      </div>

      {/* 플로팅 미리보기 버튼 */}
      <button onClick={()=>setShowPreview(true)} className="press" style={{
        position:'fixed',bottom:88,right:20,
        display:'flex',alignItems:'center',gap:6,
        padding:'12px 18px',borderRadius:40,border:'none',cursor:'pointer',
        background:`linear-gradient(135deg,${C.accent},${C.accentDark})`,
        color:'#fff',fontSize:14,fontWeight:700,
        boxShadow:`0 4px 16px ${C.accent}55`,zIndex:50,
      }}><Icon n="eye" size={14} color="#fff" style={{marginRight:4}}/>미리보기</button>

      {/* 프리뷰 오버레이 */}
      {showPreview&&(
        <div style={{position:'fixed',inset:0,background:'rgba(17,24,39,0.5)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'}}
          onClick={()=>setShowPreview(false)}>
          <div style={{width:'100%',maxWidth:480,height:'90dvh',background:C.pageBg,borderRadius:'20px 20px 0 0',overflowY:'auto',animation:'slideUp 0.22s ease',display:'flex',flexDirection:'column'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 16px',background:C.cardBg,borderRadius:'20px 20px 0 0',position:'sticky',top:0,zIndex:10,borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
              <button onClick={()=>setShowPreview(false)} style={{background:C.inputBg,border:`1.5px solid ${C.border}`,borderRadius:10,color:C.textMid,cursor:'pointer',width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>‹</button>
              <div style={{flex:1,fontSize:14,fontWeight:800,color:C.text,letterSpacing:-0.3,display:'flex',alignItems:'center',gap:6}}><Icon n="eye" size={14} color={C.text}/>참여자에게는 이렇게 보여요</div>
            </div>
            <div style={{flex:1,overflowY:'auto'}}>
              <FormSubmitScreen
                form={{
                  code:'PREVIEW',
                  name:name.trim()||'행사명',
                  date,
                  amount:Number(amount)||0,
                  account:{
                    bank:bank||profile.account?.bank||'',
                    number:number||profile.account?.number||'',
                    holder:holder||profile.account?.holder||'',
                  },
                  fields,
                  submissions:[],
                  status:'open',
                  maxPeople:useLimit&&maxPeople?Number(maxPeople):null,
                  time:time||null,place:place.trim()||null,
                }}
                isPreview={true}
                showToast={()=>{}}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 5. HOOKS — 로직만, UI 없음
// ═══════════════════════════════════════════════════════════

function useFormAdmin(form, updateForm, profile, saveProfile, showToast){
  const [searchQ,setSearchQ]=useState('');
  const [groupFilter,setGroupFilter]=useState('all');
  const subs=form.submissions||[];
  const groups=profile?.groups||[];

  const findGroup=(name)=>{
    for(const g of groups){
      if((g.members||[]).some(m=>m.name===name)) return g.name;
    }
    return null;
  };

  const filteredSubs=subs.map((s,i)=>({...s,_idx:i,_group:findGroup(s.name)})).filter(s=>{
    if(searchQ&&!s.name.includes(searchQ)&&!(s.phone||'').includes(searchQ)) return false;
    if(groupFilter!=='all'){
      if(groupFilter==='unregistered') return !s._group;
      return s._group===groupFilter;
    }
    return true;
  }).sort((a,b)=>{
    const aX=a.paymentStatus==='unpaid_confirmed';
    const bX=b.paymentStatus==='unpaid_confirmed';
    if(aX&&!bX) return -1;
    if(!aX&&bX) return 1;
    return new Date(b.createdAt||0)-new Date(a.createdAt||0);
  });

  const groupCounts={};
  let unregisteredCount=0;
  subs.forEach(s=>{
    const g=findGroup(s.name);
    if(g){groupCounts[g]=(groupCounts[g]||0)+1;}
    else unregisteredCount++;
  });

  const setSubStatus=async(idx,status)=>{
    const newSubs=[...subs];
    const s=newSubs[idx];
    const now=new Date().toISOString();
    if(status==='paid'){
      newSubs[idx]={...s,paid:true,paymentStatus:'matched',matchedBy:'manual',matchedAt:now};
    } else if(status==='requested'){
      newSubs[idx]={...s,paid:false,paymentStatus:'requested',matchedBy:null,matchedAt:null,requestedAt:s.requestedAt||now};
    } else if(status==='unpaid_confirmed'){
      newSubs[idx]={...s,paid:false,paymentStatus:'unpaid_confirmed',matchedBy:null,matchedAt:null};
    } else {
      newSubs[idx]={...s,paid:false,paymentStatus:'none',matchedBy:null,matchedAt:null};
    }
    await updateForm({...form,submissions:newSubs});
  };

  const manualConfirm=async(idx)=>{
    const newSubs=[...subs];
    const s=newSubs[idx];
    newSubs[idx]={...s,paid:true,paymentStatus:'matched',matchedBy:'manual',matchedAt:new Date().toISOString()};
    await updateForm({...form,submissions:newSubs});
  };

  const unpaidNames=subs.filter(s=>!s.paid&&s.paymentStatus!=='matched');
  const nudgeMsg=unpaidNames.length>0?[
    `[${form.name}] 입금 안내`,'',
    ...unpaidNames.map(s=>`• ${s.name}  ${fmtKRW(getUserAmount(form,s.name,s.data?.studentId))}`),
    '',`💳 ${form.account.bank} ${form.account.number}`,`예금주: ${form.account.holder}`,
  ].join('\n'):'';

  const copyNudge=()=>{if(!nudgeMsg) return; copyText(nudgeMsg); showToast('콕 찌르기 메시지 복사됨');};

  const handleDunning=async(s)=>{
    if(!form.account?.bank) return;
    const link=getLink(`form=${form.code}`);
    const msg=buildDunningMsg({name:s.name,eventName:form.name,amount:getUserAmount(form,s.name,s.data?.studentId),account:form.account,link});
    const shared=await shareText(msg);
    if(!shared){await copyText(msg);showToast('콕 찌르기 복사됐어요');}
    else showToast('공유 완료');
  };

  const toggleAttended=async(idx)=>{
    const newSubs=[...subs];
    newSubs[idx]={...newSubs[idx],attended:!newSubs[idx].attended};
    await updateForm({...form,submissions:newSubs});
  };
  const checkAllAttended=async()=>{
    const newSubs=subs.map(s=>({...s,attended:true}));
    await updateForm({...form,submissions:newSubs});
  };

  return {
    subs, filteredSubs, groupCounts, unregisteredCount,
    searchQ, setSearchQ, groupFilter, setGroupFilter,
    handlers:{setSubStatus, manualConfirm, copyNudge, handleDunning, toggleAttended, checkAllAttended,
      closeForm:async()=>{await updateForm({...form,status:'closed'}); showToast('신청이 마감됐어요');},
      copyLink:()=>{copyText(getLink(`form=${form.code}`)); showToast('링크가 복사됐어요!');},
    },
  };
}

const PaySegCtrl=({status,onChange,disabled=false})=>{
  const opts=[
    {v:'none',label:'미입금',bg:'#E24B4A'},
    {v:'requested',label:'확인 필요',bg:'#EF9F27'},
    {v:'paid',label:'완료',bg:'#5DCAA5'},
  ];
  return(
    <div onClick={e=>e.stopPropagation()}
      style={{display:'flex',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',flexShrink:0,opacity:disabled?0.4:1,pointerEvents:disabled?'none':'auto'}}>
      {opts.map((o,i)=>(
        <button key={o.v} onClick={()=>onChange(o.v)}
          style={{padding:'4px 7px',fontSize:11,fontWeight:700,border:'none',
            borderRight:i<2?`1px solid ${C.border}`:'none',
            cursor:status===o.v?'default':'pointer',
            background:status===o.v?o.bg:'transparent',
            color:status===o.v?'#fff':C.textDim,
            transition:'background 0.15s,color 0.15s'}}
        >{o.label}</button>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// 6. SUB COMPONENTS — UI만, 비즈니스 로직 없음
// ═══════════════════════════════════════════════════════════

function MemberDetailModal({name,onClose,studentId,group,unregistered,phone,paidFee,formFields,createdAt,payTime,payBy,matchInfo}){
  const rows=[];
  if(studentId) rows.push({label:'학번',value:studentId});
  if(group) rows.push({label:'그룹',value:group});
  else if(unregistered) rows.push({label:'그룹',value:'명단 미등록',color:C.orange});
  if(phone) rows.push({label:'연락처',value:phone});
  if(paidFee!=null) rows.push({label:'학생회비',value:paidFee?'납부':'미납',color:paidFee?C.green:C.red});
  (formFields||[]).forEach(f=>{if(f.value)rows.push({label:f.label,value:String(f.value)});});
  if(createdAt) rows.push({label:'신청 시간',value:fmtRelTime(createdAt)});
  if(payTime){
    const src=payBy==='admin'?' · 관리자':payBy==='archive'?' · 종료처리':payBy==='manual'?' · 수동 처리':payBy==='auto'?' · 자동 대조':payBy==='requested'?' · 확인 대기':'';
    rows.push({label:'처리 시간',value:fmtTime(payTime)+src});
  }
  if(matchInfo?.type==='partial') rows.push({label:'입금 현황',value:`${fmtKRW(matchInfo.totalAmount)} / ${fmtKRW(matchInfo.expected)} (${fmtKRW(matchInfo.expected-matchInfo.totalAmount)} 부족)`,color:C.yellow});
  if(matchInfo?.type==='overpaid') rows.push({label:'입금 현황',value:`${fmtKRW(matchInfo.totalAmount)} / ${fmtKRW(matchInfo.expected)} (${fmtKRW(matchInfo.totalAmount-matchInfo.expected)} 초과)`,color:C.yellow});
  return(
    <Modal isOpen={true} onClose={onClose} title={name}>
      {rows.length>0?rows.map((r,i)=>(
        <div key={i} style={{display:'flex',gap:10,padding:'9px 0',borderBottom:i<rows.length-1?`1px solid ${C.border}`:'none'}}>
          <div style={{color:C.textDim,fontSize:13,width:72,flexShrink:0}}>{r.label}</div>
          <div style={{color:r.color||C.text,fontSize:13,flex:1,wordBreak:'break-word'}}>{r.value}</div>
        </div>
      )):(
        <div style={{textAlign:'center',color:C.textDim,fontSize:13,padding:'20px 0'}}>추가 정보가 없어요</div>
      )}
    </Modal>
  );
}

function SubmissionsTab({form, filteredSubs, subs, groupCounts, unregisteredCount, groups,
                         searchQ, setSearchQ, groupFilter, setGroupFilter,
                         onSetSubStatus, onCardDunning,
                         animatingPaidCrAts, formMatchSummary, formAnimating,
                         onToggleAttended, onCheckAllAttended}){
  const [sortByTime,setSortByTime]=useState(true);
  const [showGroups,setShowGroups]=useState(false);
  const [menuIdx,setMenuIdx]=useState(null);
  const [detailCrAt,setDetailCrAt]=useState(null);
  const [checkMode,setCheckMode]=useState(false);

  const nameCount={};
  subs.forEach(s=>{nameCount[s.name]=(nameCount[s.name]||0)+1;});

  if(subs.length===0) return(
    <div style={{textAlign:'center',padding:'40px 0'}}>
      <div style={{width:64,height:64,borderRadius:32,background:C.textDim+'18',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 12px'}}><Icon n="inbox" size={32} color={C.textDim}/></div>
      <div style={{color:C.textMid,fontSize:14}}>아직 신청이 없어요</div>
      <div style={{color:C.textDim,fontSize:13,marginTop:4}}>링크를 공유해보세요</div>
    </div>
  );

  const getSubStatus=(s)=>{
    if(s.paid||s.paymentStatus==='matched') return 'paid';
    if(s.paymentStatus==='requested') return 'requested';
    return 'none';
  };

  const sortedSubs=form.noFee?filteredSubs:sortByTime
    ?[...[...filteredSubs].filter(s=>getSubStatus(s)==='paid').sort((a,b)=>new Date(b.matchedAt||0)-new Date(a.matchedAt||0)),
       ...[...filteredSubs].filter(s=>getSubStatus(s)!=='paid').sort((a,b)=>{
         const aR=a.requestedAt,bR=b.requestedAt;
         if(aR&&bR) return new Date(bR)-new Date(aR);
         if(aR) return -1; if(bR) return 1;
         return (a.name||'').localeCompare(b.name||'','ko');
       })]
    :filteredSubs;
  const groupedSections=showGroups&&(groups||[]).length>1?(()=>{
    const byGroup={};
    sortedSubs.forEach(s=>{const g=s._group||'__none__';if(!byGroup[g])byGroup[g]=[];byGroup[g].push(s);});
    const sections=[];
    (groups||[]).forEach(g=>{if(byGroup[g.name]?.length>0)sections.push({name:g.name,items:byGroup[g.name]});});
    if(byGroup['__none__']?.length>0)sections.push({name:'미등록',items:byGroup['__none__']});
    return sections;
  })():null;

  const hasFee=(form.amount||0)>0;

  const getCouncilFeePaid=name=>{
    if(!form.noFee||!form.memberList?.length) return null;
    const m=form.memberList.find(m=>matchEngine.compareName(m.name,name)!=='none');
    return m!=null?m.isPaidFee:null;
  };

  const renderCard=(s)=>{
    const amt=getUserAmount(form,s.name,s.data?.studentId);
    const subStatus=getSubStatus(s);
    const isMenuOpen=menuIdx===s._idx;
    const isAnimPaid=animatingPaidCrAts?.has(s.createdAt);
    const matchInfo=formMatchSummary?.byKey[s.createdAt];
    const effectiveSubStatus=isAnimPaid?'paid':(matchInfo?'requested':subStatus);
    return(
      <div key={s._idx} style={{background:C.cardBg,borderRadius:12,marginBottom:6,boxShadow:C.shadow,overflow:'hidden',pointerEvents:formAnimating?'none':'auto'}}
        onClick={()=>isMenuOpen&&setMenuIdx(null)}>
        <div style={{padding:'11px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{flex:1,minWidth:0,cursor:'pointer'}} onClick={e=>{e.stopPropagation();setMenuIdx(null);setDetailCrAt(s.createdAt);}}>
            <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
              {!s._group&&groups.length>0&&<Icon n="triangle-alert" size={13} color={C.orange}/>}
              <span style={{fontWeight:600,color:C.text,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</span>
              {nameCount[s.name]>=2&&(s.data?.studentId||s.data?.학번)&&<span style={{fontSize:11,color:C.textDim}}>({s.data?.studentId||s.data?.학번})</span>}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
            {hasFee&&amt>0&&<span style={{fontSize:13,fontWeight:700,color:C.textMid}}>{fmtKRW(amt)}</span>}
            {hasFee
              ?<PaySegCtrl status={effectiveSubStatus} onChange={newSt=>onSetSubStatus(s._idx,newSt)}/>
              :form.noFee
                ?<div style={{display:'flex',alignItems:'center',gap:6}} onClick={e=>e.stopPropagation()}>
                  {(()=>{const fp=getCouncilFeePaid(s.name);return fp!=null?<span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,fontWeight:600,color:fp?C.green:C.red}}><span style={{width:7,height:7,borderRadius:'50%',background:fp?C.green:C.red,flexShrink:0,display:'inline-block'}}/>{ fp?'납부':'미납'}</span>:null;})()}
                  {checkMode&&<div onClick={()=>onToggleAttended(s._idx)} style={{width:28,height:28,borderRadius:14,border:`2px solid ${s.attended?C.accent:C.border}`,background:s.attended?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0,transition:'background 0.15s, border-color 0.15s'}}>
                    {s.attended&&<svg width="14" height="11" viewBox="0 0 14 11" fill="none"><path d="M1.5 5.5L5.5 9.5L12.5 1.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>}
                </div>
                :<span style={{fontSize:11,color:C.textDim}}>{fmtRelTime(s.createdAt)||''}</span>
            }
            {hasFee&&(
              <button onClick={e=>{e.stopPropagation();setMenuIdx(v=>v===s._idx?null:s._idx);}}
                style={{background:'none',border:'none',cursor:'pointer',padding:'2px 4px',color:C.textDim,fontSize:18,lineHeight:1}}>⋯</button>
            )}
          </div>
        </div>
        {hasFee&&matchInfo?.type==='partial'&&!isAnimPaid&&(
          <div style={{padding:'0 14px 10px'}}>
            <div style={{height:3,borderRadius:2,background:C.border,overflow:'hidden',marginBottom:3}}>
              <div style={{height:'100%',width:`${Math.min(100,Math.round(matchInfo.totalAmount/matchInfo.expected*100))}%`,background:C.yellow,borderRadius:2}}/>
            </div>
            <span style={{fontSize:11,color:C.yellow,fontWeight:600}}>{fmtKRW(matchInfo.totalAmount)} / {fmtKRW(matchInfo.expected)}{matchInfo.depositCount>1?` · ${matchInfo.depositCount}회 합산`:''}</span>
          </div>
        )}
        {hasFee&&matchInfo?.type==='overpaid'&&!isAnimPaid&&(
          <div style={{padding:'0 14px 10px',fontSize:11,color:C.yellow,fontWeight:600}}>
            {fmtKRW(matchInfo.totalAmount)} 입금 ({fmtKRW(matchInfo.totalAmount-matchInfo.expected)} 초과)
          </div>
        )}
        {isMenuOpen&&hasFee&&(
          <div style={{borderTop:`1px solid ${C.border}`,padding:'6px 14px'}}>
            <button onClick={e=>{e.stopPropagation();onSetSubStatus(s._idx,'unpaid_confirmed');setMenuIdx(null);}}
              style={{fontSize:12,color:C.red,background:'none',border:'none',cursor:'pointer',fontWeight:700,padding:'4px 0'}}>정산 대상에서 제외</button>
          </div>
        )}
        {hasFee&&onCardDunning&&effectiveSubStatus==='none'&&(
          <div style={{borderTop:`1px solid ${C.border}`,padding:'6px 14px',display:'flex',justifyContent:'flex-end'}}>
            <button onClick={e=>{e.stopPropagation();onCardDunning(s);}} style={{fontSize:12,color:C.orange,background:C.orange+'18',border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer',fontWeight:700,display:'flex',alignItems:'center',gap:4}}><Icon n="message-circle" size={12} color={C.orange}/>콕 찌르기</button>
          </div>
        )}
      </div>
    );
  };

  const paidCount=hasFee?subs.filter(s=>getSubStatus(s)==='paid').length:0;

  return(
    <div>
      {subs.length>=5&&(
        <>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="이름 또는 연락처 검색"
            style={{width:'100%',padding:'10px 14px',background:'#fff',border:'none',borderRadius:12,fontSize:14,outline:'none',marginBottom:8,color:C.text}}
            onFocus={e=>e.target.style.boxShadow=`0 0 0 2px ${C.accent}40`}
            onBlur={e=>e.target.style.boxShadow='none'}
          />
          {groups.length>0&&(
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
              <button onClick={()=>setGroupFilter('all')} style={{padding:'5px 12px',borderRadius:16,fontSize:12,fontWeight:600,cursor:'pointer',background:groupFilter==='all'?C.accent:'#fff',color:groupFilter==='all'?'#fff':C.textMid,border:'none'}}>
                전체 {subs.length}
              </button>
              {groups.map(g=>groupCounts[g.name]?(
                <button key={g.name} onClick={()=>setGroupFilter(f=>f===g.name?'all':g.name)} style={{padding:'5px 12px',borderRadius:16,fontSize:12,fontWeight:600,cursor:'pointer',background:groupFilter===g.name?C.accent:'#fff',color:groupFilter===g.name?'#fff':C.textMid,border:'none'}}>
                  {g.name} {groupCounts[g.name]}
                </button>
              ):null)}
              {unregisteredCount>0&&(
                <button onClick={()=>setGroupFilter(f=>f==='unregistered'?'all':'unregistered')} style={{padding:'5px 12px',borderRadius:16,fontSize:12,fontWeight:600,cursor:'pointer',background:groupFilter==='unregistered'?C.red:'#fff',color:groupFilter==='unregistered'?'#fff':C.textDim,border:'none'}}>
                  미등록 {unregisteredCount}
                </button>
              )}
            </div>
          )}
        </>
      )}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        {hasFee?(
          <div style={{fontSize:12,fontWeight:600}}>
            <span style={{color:C.red,display:'inline-flex',alignItems:'center',gap:3}}><span style={{width:8,height:8,borderRadius:'50%',background:C.red,display:'inline-block',flexShrink:0}}/>미입금 {subs.length-paidCount}</span>
            <span style={{color:C.textDim,margin:'0 5px'}}>·</span>
            <span style={{color:C.green,display:'inline-flex',alignItems:'center',gap:3}}><span style={{width:8,height:8,borderRadius:'50%',background:C.green,display:'inline-block',flexShrink:0}}/>입금확인 {paidCount}</span>
          </div>
        ):form.noFee?(
          <div style={{display:'flex',flexDirection:'column',gap:4}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:12,fontWeight:600,color:C.textMid}}>출석 {subs.filter(s=>s.attended).length}/{subs.length}</span>
              {checkMode&&<button onClick={onCheckAllAttended} style={{fontSize:11,fontWeight:700,color:C.accent,background:C.accent+'18',border:'none',borderRadius:8,padding:'4px 10px',cursor:'pointer'}}>전체 체크</button>}
            </div>
            {(form.memberList||[]).length>0&&<span style={{fontSize:11,color:C.textDim}}>초록·빨강 배지는 학생회비 납부 여부예요</span>}
          </div>
        ):<div/>}
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {(groups||[]).length>1&&(
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              <span style={{fontSize:11,color:C.textDim}}>그룹 묶기</span>
              <button onClick={()=>setShowGroups(v=>!v)} style={{
                width:36,height:20,borderRadius:10,border:'none',cursor:'pointer',padding:0,
                background:showGroups?C.accent:C.disabled,position:'relative',transition:'background 0.2s',flexShrink:0,
              }}>
                <div style={{width:16,height:16,borderRadius:8,background:'#fff',position:'absolute',top:2,
                  left:showGroups?18:2,transition:'left 0.2s',boxShadow:'0 1px 2px rgba(0,0,0,0.2)'}}/>
              </button>
            </div>
          )}
          {form.noFee?(
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              <span style={{fontSize:11,color:C.textDim}}>출석 체크</span>
              <button onClick={()=>setCheckMode(v=>!v)} style={{
                width:36,height:20,borderRadius:10,border:'none',cursor:'pointer',padding:0,
                background:checkMode?C.accent:C.disabled,position:'relative',transition:'background 0.2s',flexShrink:0,
              }}>
                <div style={{width:16,height:16,borderRadius:8,background:'#fff',position:'absolute',top:2,
                  left:checkMode?18:2,transition:'left 0.2s',boxShadow:'0 1px 2px rgba(0,0,0,0.2)'}}/>
              </button>
            </div>
          ):(
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              {sortByTime&&<span style={{fontSize:11,color:C.textDim}}>시간순</span>}
              <button onClick={()=>setSortByTime(v=>!v)} style={{
                width:36,height:20,borderRadius:10,border:'none',cursor:'pointer',padding:0,
                background:sortByTime?C.accent:C.disabled,position:'relative',transition:'background 0.2s',flexShrink:0,
              }}>
                <div style={{width:16,height:16,borderRadius:8,background:'#fff',position:'absolute',top:2,
                  left:sortByTime?18:2,transition:'left 0.2s',boxShadow:'0 1px 2px rgba(0,0,0,0.2)'}}/>
              </button>
            </div>
          )}
        </div>
      </div>
      {groupedSections?groupedSections.map(sec=>(
        <div key={sec.name} style={{marginBottom:4}}>
          <div style={{fontSize:11,fontWeight:700,color:C.textDim,padding:'8px 4px 4px',letterSpacing:0.5}}>
            {sec.name} ({form.noFee?sec.items.filter(s=>s.attended).length:sec.items.filter(s=>getSubStatus(s)==='paid').length}/{sec.items.length})
          </div>
          {sec.items.map(s=>renderCard(s))}
        </div>
      )):sortedSubs.map(s=>renderCard(s))}
      {hasFee&&paidCount===subs.length&&subs.length>0&&<div style={{textAlign:'center',color:C.green,fontWeight:900,fontSize:15,padding:'16px 0',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Icon n="sparkles" size={16} color={C.green}/>전원 완료!</div>}
    {detailCrAt&&(()=>{
      const ds=filteredSubs.find(s=>s.createdAt===detailCrAt);
      if(!ds) return null;
      const dSubStatus=getSubStatus(ds);
      const dPayTime=dSubStatus==='paid'?(ds.matchedAt||null):dSubStatus==='requested'?ds.requestedAt:null;
      const fields=hasFee?(form.fields||[]).map(f=>({label:f.label,value:String(ds.data?.[f.id]||'')})).filter(f=>f.value):[];
      return <MemberDetailModal
        name={ds.name} onClose={()=>setDetailCrAt(null)}
        studentId={ds.data?.studentId||ds.data?.학번||null}
        group={ds._group||null}
        unregistered={!ds._group&&groups.length>0}
        phone={ds.phone||ds.data?.phone||null}
        formFields={fields}
        createdAt={ds.createdAt}
        payTime={dPayTime} payBy={ds.matchedBy||null}
        matchInfo={formMatchSummary?.byKey[ds.createdAt]}
      />;
    })()}
    </div>
  );
}

function VerifyTab({form, uploading, bankGuideOpen, setBankGuideOpen, fileRef, onUpload}){
  const toggleBankGuide=(id)=>setBankGuideOpen(prev=>{const n=new Set(prev);if(n.has(id))n.delete(id);else n.add(id);return n;});

  return(
    <div style={{padding:'16px 0'}}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onUpload} style={{display:'none'}}/>
      <div style={{textAlign:'center',marginBottom:20}}>
        <div style={{width:72,height:72,borderRadius:36,background:C.accent+'20',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 12px'}}><Icon n="bar-chart" size={36} color={C.accent}/></div>
        <div style={{fontWeight:800,color:C.text,fontSize:18,marginBottom:4}}>거래내역 대조</div>
        <div style={{color:C.textMid,fontSize:13,lineHeight:1.7}}>은행 거래내역(엑셀파일) 업로드 후 자동 대조해요</div>
      </div>
      <div style={{marginBottom:14,padding:'9px 14px',background:C.accentBg,borderRadius:10,fontSize:12,color:C.textMid,display:'flex',alignItems:'center',gap:6}}>
        <Icon n="lock" size={13} color={C.accent}/><span>거래내역은 브라우저에서만 처리되며 서버에 저장되지 않아요.</span>
      </div>
      <div style={{textAlign:'center',marginBottom:20}}>
        <Btn onClick={()=>fileRef.current?.click()} loading={uploading}>파일 선택하기</Btn>
        <div style={{marginTop:10,fontSize:12,color:C.textDim}}>지원: .xlsx, .xls, .csv</div>
      </div>
      <Card style={{padding:'16px'}}>
        <div style={{fontWeight:800,color:C.text,fontSize:14,marginBottom:12,display:'flex',alignItems:'center',gap:6}}><Icon n="smartphone" size={14} color={C.text}/>은행별 다운로드 방법</div>
        <div style={{borderRadius:12,overflow:'hidden',marginBottom:8,border:`1.5px solid ${bankGuideOpen.has('toss')?C.accent+'40':C.pageBg}`}}>
          <button onClick={()=>toggleBankGuide('toss')} style={{width:'100%',padding:'12px 14px',background:bankGuideOpen.has('toss')?C.accentBg:C.inputBg,border:'none',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',textAlign:'left'}}>
            <span style={{fontWeight:700,color:C.text,fontSize:14}}>토스뱅크</span>
            <Icon n={bankGuideOpen.has('toss')?'chevron-up':'chevron-down'} size={14} color={C.textDim}/>
          </button>
          {bankGuideOpen.has('toss')&&(
            <div style={{padding:'12px 14px',background:'#fff',fontSize:13,color:C.textMid,lineHeight:2}}>
              <div style={{fontWeight:700,color:C.text,marginBottom:6}}>토스 앱에서:</div>
              1. <strong>토스뱅크</strong> 클릭<br/>2. <strong>관리</strong> 메뉴<br/>3. <strong>증명서 발급</strong><br/>4. <strong>거래내역서</strong> 선택<br/>5. 기간 설정 → <strong>엑셀(xlsx) 다운로드</strong>
              <div style={{marginTop:8,padding:'8px 10px',background:C.accentBg,borderRadius:8,fontSize:12,display:'flex',alignItems:'center',gap:4}}><Icon n="lightbulb" size={12} color={C.accent}/>이메일로 받기도 가능해요</div>
            </div>
          )}
        </div>
        {[{id:'kakao',bank:'카카오뱅크',steps:'더보기 → 입출금 내역 → 우측 상단 ··· → 엑셀 다운로드'},{id:'kb',bank:'국민은행',steps:'KB Star 앱 → 조회 → 계좌조회 → 거래내역조회 → 하단 "엑셀저장"'},{id:'shinhan',bank:'신한은행',steps:'SOL 앱 → 계좌관리 → 거래내역조회 → 우측 상단 내보내기 → 파일 저장'},{id:'woori',bank:'우리은행',steps:'확인 중 — 은행 앱에서 거래내역 조회 후 엑셀 내보내기를 찾아주세요'},{id:'hana',bank:'하나은행',steps:'확인 중 — 은행 앱에서 거래내역 조회 후 엑셀 내보내기를 찾아주세요'},{id:'nh',bank:'농협',steps:'NH올원뱅크 → 계좌 → 거래내역조회 → 하단 "파일저장" → 엑셀'},].map(({id,bank,steps})=>(
          <div key={id} style={{borderRadius:12,overflow:'hidden',marginBottom:4}}>
            <button onClick={()=>toggleBankGuide(id)} style={{width:'100%',padding:'10px 14px',background:C.inputBg,border:'none',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',textAlign:'left',borderRadius:12}}>
              <span style={{fontWeight:600,color:C.text,fontSize:13}}>{bank}</span>
              <Icon n={bankGuideOpen.has(id)?'chevron-up':'chevron-down'} size={12} color={C.textDim}/>
            </button>
            {bankGuideOpen.has(id)&&<div style={{padding:'10px 14px',fontSize:12,color:C.textMid,lineHeight:1.8,background:'#fff'}}>{steps}</div>}
          </div>
        ))}
        <div style={{fontSize:11,color:C.textDim,marginTop:10,lineHeight:1.6}}>* 앱 버전에 따라 메뉴가 다를 수 있어요</div>
      </Card>
    </div>
  );
}

function FormShareTab({form, showToast, onShared}){
  const formLink=getLink(`form=${form.code}`);
  const autoMsg=[
    `[${form.name}] 신청 안내`,
    '',
    (form.date||form.time)?`📅 ${(form.date||'').replace(/^\d{4}-(\d{2})-(\d{2})$/,(_,m,d)=>`${+m}월 ${+d}일`)}${form.time?` ${form.time}`:''}`:null,
    form.place?`📍 ${form.place}`:null,
    form.amount>0?(form.amountPaid?`💰 참가비\n학생회비 미납자: ${fmtKRW(form.amount)}\n학생회비 납부자: ${fmtKRW(form.amountPaid)}`:`💰 참가비 ${fmtKRW(form.amount)}`):`💰 참가비 없음`,
    form.maxPeople?`👥 선착순 ${form.maxPeople}명`:null,
    '',
    '아래 링크에서 신청해주세요!',
    '(정산해 · 간편한 모임 정산 서비스)',
  ].filter(l=>l!==null).join('\n');

  const [editMode,setEditMode]=useState(false);
  const [editText,setEditText]=useState('');

  const startEdit=()=>{if(!editText)setEditText(autoMsg);setEditMode(true);};
  const getMsg=()=>`${editMode?editText:autoMsg}\n${formLink}`;

  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <div style={{fontSize:12,color:C.textDim,fontWeight:600}}>공유 메시지</div>
        {!editMode?(
          <button onClick={startEdit} style={{background:'none',border:'none',padding:'4px 8px',fontSize:12,color:C.accent,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:3}}><Icon n="pencil" size={11} color={C.accent}/>편집</button>
        ):(
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setEditText(autoMsg)} style={{background:'none',border:'none',padding:'4px 8px',fontSize:12,color:C.textMid,fontWeight:700,cursor:'pointer'}}>원래대로</button>
            <button onClick={()=>setEditMode(false)} style={{background:C.accentBg,border:'none',padding:'4px 10px',borderRadius:8,fontSize:12,color:C.accent,fontWeight:700,cursor:'pointer'}}>완료</button>
          </div>
        )}
      </div>
      {editMode?(
        <textarea value={editText} onChange={e=>setEditText(e.target.value)} rows={8}
          style={{width:'100%',padding:'14px',background:C.inputBg,border:`1.5px solid ${C.accent}`,borderRadius:12,fontSize:13,color:C.text,outline:'none',resize:'vertical',lineHeight:1.75,marginBottom:12,boxSizing:'border-box'}}
        />
      ):(
        <div style={{background:C.inputBg,borderRadius:12,padding:'14px 16px',fontSize:13,color:C.textMid,lineHeight:1.85,marginBottom:12,whiteSpace:'pre-wrap'}}>{autoMsg}</div>
      )}
      <div style={{display:'flex',gap:8}}>
        <Btn onClick={async()=>{posthog.capture('신청폼_링크_공유');const msg=getMsg();const shared=await shareText(msg);if(!shared){await copyText(msg);showToast('메시지 복사됨');}else showToast('공유 완료');onShared&&onShared();}} small style={{flex:2}}><Icon n="message-circle" size={14} color="#fff" style={{marginRight:4}}/>카톡 공유</Btn>
        <Btn onClick={async()=>{await copyText(getMsg());showToast('메시지 복사됨');onShared&&onShared();}} variant="ghost" small style={{flex:1}}><Icon n="clipboard-list" size={14} color={C.textDim} style={{marginRight:4}}/>복사</Btn>
      </div>
    </div>
  );
}

function FormShareModal({form, showToast, onClose, onShared}){
  return(
    <Modal isOpen={true} onClose={onClose} title="공유하기">
      <FormShareTab form={form} showToast={showToast} onShared={onShared}/>
    </Modal>
  );
}

function PasteFeeModal({members, currentPaidKeys, onApply, showToast, onClose}){
  const initialText=React.useMemo(()=>{
    const set=new Set(currentPaidKeys||[]);
    return members.filter(k=>set.has(k)).map(k=>{
      const idx=k.lastIndexOf('_');
      return idx===-1?k:k.slice(0,idx)+'\t'+k.slice(idx+1);
    }).join('\n');
  },[]);// eslint-disable-line
  const [pasteText,setPasteText]=useState(initialText);
  const [ambig,setAmbig]=useState([]);
  const [notFound,setNotFound]=useState([]);
  // 멤버 키(이름 / 이름_학번 / 이름__구분자)에서 기준 이름 추출
  const baseName=k=>{
    const di=k.indexOf('__');
    if(di>=0) return k.slice(0,di);
    const ui=k.lastIndexOf('_');
    return ui>=0?k.slice(0,ui):k;
  };

  const parseLine=raw=>{
    const s=raw.trim();
    if(!s) return null;
    const tabParts=s.split('\t');
    if(tabParts.length>=2){
      const name=tabParts[0].trim();
      const sid=tabParts.slice(1).map(p=>p.trim()).find(p=>/^\d{8,10}$/.test(p));
      return {name,sid:sid||null};
    }
    const spaceParts=s.split(/\s+/);
    if(spaceParts.length>=2){
      const last=spaceParts[spaceParts.length-1];
      if(/^\d{8,10}$/.test(last)) return {name:spaceParts.slice(0,-1).join(' '),sid:last};
    }
    return {name:s,sid:null};
  };

  const apply=()=>{
    const lines=pasteText.split('\n').map(s=>s.trim()).filter(Boolean);
    if(!lines.length) return;
    const memberSet=new Set(members);
    const matchedKeys=new Set();
    const missAmbig=[];
    const missNotFound=[];
    lines.forEach(line=>{
      const p=parseLine(line);
      if(!p) return;
      // 학번 있고 학번키가 명단에 있으면 정확 매칭
      if(p.sid&&memberSet.has(p.name+'_'+p.sid)){matchedKeys.add(p.name+'_'+p.sid);return;}
      // 학번 없거나 학번키 불일치 → 이름으로 매칭
      const cands=members.filter(k=>baseName(k)===p.name);
      if(cands.length===1) matchedKeys.add(cands[0]);
      else if(cands.length===0) missNotFound.push(p.name+(p.sid?' '+p.sid:''));
      else missAmbig.push(p.name);
    });
    setAmbig(missAmbig);
    setNotFound(missNotFound);
    if(missAmbig.length) return;
    showToast(`납부자 ${matchedKeys.size}명 적용됐어요${missNotFound.length?` (미매칭 ${missNotFound.length}명)`:''}`);
    onApply(matchedKeys);
  };

  return(
    <Modal isOpen={true} onClose={onClose} title={<><Icon n="clipboard-list" size={15} color={C.text} style={{marginRight:4}}/>납부자 명단 붙여넣기</>}>
      <div style={{fontSize:12,color:C.textDim,marginBottom:8}}>이름만 붙여넣어도 돼요. 학번이 있으면 함께 넣으면 더 정확해요 (탭·공백 구분).</div>
      <div style={{background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 10px',fontSize:11,color:C.textDim,fontFamily:'monospace',marginBottom:10,lineHeight:1.9}}>
        홍길동{'\t'}20210001<br/>김철수{'\t'}20210002
      </div>
      <textarea
        value={pasteText}
        onChange={e=>{setPasteText(e.target.value);setAmbig([]);setNotFound([]);}}
        placeholder={'홍길동\t20210001\n김철수\t20210002'}
        rows={6}
        style={{width:'100%',padding:'10px 12px',borderRadius:10,border:`1.5px solid ${C.border}`,background:C.inputBg,fontSize:13,color:C.text,lineHeight:1.8,resize:'vertical',outline:'none',boxSizing:'border-box',marginBottom:10}}
      />
      {ambig.length>0&&(
        <div style={{background:C.orangeBg,borderRadius:10,padding:'10px 12px',marginBottom:10}}>
          <div style={{fontSize:12,color:C.orange,fontWeight:700,marginBottom:4}}>동명이인이 있어요. 명단에서 이름을 다르게 적어주세요 (예: 민준2)</div>
          {ambig.map((n,i)=><div key={i} style={{fontSize:12,color:C.orange}}>• {n}</div>)}
        </div>
      )}
      {notFound.length>0&&(
        <div style={{background:C.orangeBg,borderRadius:10,padding:'10px 12px',marginBottom:10}}>
          <div style={{fontSize:12,color:C.orange,fontWeight:700,marginBottom:4}}>명단에 없는 사람</div>
          {notFound.map((n,i)=><div key={i} style={{fontSize:12,color:C.orange}}>• {n}</div>)}
        </div>
      )}
      <div style={{display:'flex',gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:'12px',borderRadius:12,border:`1.5px solid ${C.border}`,background:C.inputBg,color:C.textMid,fontSize:14,fontWeight:700,cursor:'pointer'}}>취소</button>
        <button onClick={apply} disabled={!pasteText.trim()} style={{flex:2,padding:'12px',borderRadius:12,border:'none',background:pasteText.trim()?C.accent:C.disabled,color:'#fff',fontSize:14,fontWeight:700,cursor:pasteText.trim()?'pointer':'default'}}>적용</button>
      </div>
    </Modal>
  );
}

function DunningModal({eventName, account, link, unpaidList, showToast, onClose}){
  const [withNames,setWithNames]=useState(false);
  const [editMode,setEditMode]=useState(false);
  const [editText,setEditText]=useState('');

  const acctLine=account?.bank?`\n\n입금 계좌: ${account.bank} ${account.number}${account.holder?` (${account.holder})`:''}`:''
  const autoMsg=React.useMemo(()=>{
    if(withNames) return [
      `[${eventName}] 입금 안내`,'',
      '아직 입금 확인이 안 된 분들이에요:',
      ...unpaidList.map(u=>`• ${u.name}  ${fmtKRW(u.amount)}`),
    ].join('\n')+acctLine;
    return [
      `[${eventName}] 입금 안내`,'',
      `아직 ${unpaidList.length}명의 입금 확인이 안 됐어요.`,
    ].join('\n')+acctLine;
  },[withNames,unpaidList,eventName,acctLine]);

  React.useEffect(()=>{setEditText('');setEditMode(false);},[autoMsg]);

  const startEdit=()=>{if(!editText)setEditText(autoMsg);setEditMode(true);};
  const getMsg=()=>`${editMode?editText:autoMsg}\n${link}`;

  const share=async()=>{
    const msg=getMsg();
    const shared=await shareText(msg);
    if(!shared){await copyText(msg);showToast('콕 찌르기 복사됐어요');}
    else showToast('공유 완료');
  };

  return(
    <Modal isOpen={true} onClose={onClose} title={<><Icon n="megaphone" size={15} color={C.text} style={{marginRight:4}}/>콕 찌르기</>}>
      <div style={{display:'flex',gap:6,marginBottom:14}}>
        {[['이름 제외',false],['이름 포함',true]].map(([label,val])=>(
          <button key={label} onClick={()=>setWithNames(val)} style={{flex:1,padding:'8px',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer',border:'none',background:withNames===val?C.accent:C.inputBg,color:withNames===val?'#fff':C.textMid}}>{label}</button>
        ))}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <div style={{fontSize:12,color:C.textDim,fontWeight:600}}>미납자 {unpaidList.length}명</div>
        {!editMode?(
          <button onClick={startEdit} style={{fontSize:11,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:'2px 4px',fontWeight:600,display:'flex',alignItems:'center',gap:3}}><Icon n="pencil" size={11} color={C.accent}/>편집</button>
        ):(
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setEditText(autoMsg)} style={{fontSize:11,color:C.textMid,background:'none',border:'none',cursor:'pointer',padding:'2px 4px',fontWeight:600}}>원래대로</button>
            <button onClick={()=>setEditMode(false)} style={{fontSize:11,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:'2px 4px',fontWeight:600}}>완료</button>
          </div>
        )}
      </div>
      {unpaidList.length===0?(
        <div style={{textAlign:'center',padding:'16px 0',color:C.textMid,fontSize:14}}>미입금자가 없어요</div>
      ):(editMode?(
        <textarea value={editText} onChange={e=>setEditText(e.target.value)} rows={7}
          style={{width:'100%',padding:'10px 12px',borderRadius:10,border:`1.5px solid ${C.accent}`,background:C.inputBg,fontSize:12,color:C.text,lineHeight:1.85,resize:'vertical',outline:'none',boxSizing:'border-box',marginBottom:6}}/>
      ):(
        <div style={{background:C.inputBg,borderRadius:12,padding:'12px 14px',fontSize:12,color:C.textMid,lineHeight:1.85,marginBottom:6,whiteSpace:'pre-wrap',border:`1.5px solid ${C.border}`}}>{autoMsg}{'\n'}{link}</div>
      ))}
      <div style={{display:'flex',gap:8,marginTop:8}}>
        <Btn variant="ghost" onClick={onClose} style={{flex:1}}>취소</Btn>
        {unpaidList.length>0&&<Btn onClick={share} style={{flex:2}}><Icon n="message-circle" size={14} color="#fff" style={{marginRight:4}}/>카카오톡 공유</Btn>}
      </div>
    </Modal>
  );
}

function CloseFormModal({onConfirm,onClose}){
  return(
    <Modal isOpen={true} onClose={onClose} title="신청 마감">
      <div style={{fontSize:14,color:C.textMid,marginBottom:20,lineHeight:1.7}}>이 신청폼을 종료할까요?<br/>종료 후 되돌릴 수 없습니다.</div>
      <div style={{display:'flex',gap:8}}>
        <Btn variant="ghost" onClick={onClose} style={{flex:1}}>취소</Btn>
        <Btn variant="danger" onClick={onConfirm} style={{flex:2}}><Icon n="lock" size={14} color="#fff" style={{marginRight:4}}/>종료하기</Btn>
      </div>
    </Modal>
  );
}

function BridgeNameModal({form, subsCount, onConfirm, onClose}){
  const [name,setName]=useState(form.name);
  return(
    <Modal isOpen={true} onClose={onClose} title="정산 시작하기">
      <div style={{fontSize:13,color:C.textMid,marginBottom:16}}>신청자 {subsCount}명으로 정산 그룹을 만들어요. 원본 신청폼은 유지돼요.</div>
      <Field label="정산 이름" value={name} onChange={setName} placeholder="5월 MT 정산"/>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        <Btn variant="ghost" onClick={onClose} style={{flex:1}}>취소</Btn>
        <Btn variant="green" onClick={()=>onConfirm(name.trim()||form.name)} disabled={!name.trim()} style={{flex:2}}>정산 시작</Btn>
      </div>
    </Modal>
  );
}

// ── FormAdminScreen (대규모 관리자 대시보드) ──────────────────
function FormAdminScreen({nav,form,updateForm,showToast,profile,saveProfile,createEvent}){
  const [showExcelModal,setShowExcelModal]=useState(false);
  const [shareOpen,setShareOpen]=useState(false);
  const [dunningOpen,setDunningOpen]=useState(false);
  const [closeConfirmOpen,setCloseConfirmOpen]=useState(false);
  const [bridging,setBridging]=useState(false);
  const [bridgeNameOpen,setBridgeNameOpen]=useState(false);
  const [bankGuideOpen,setBankGuideOpen]=useState(()=>new Set());
  const toggleBankGuide=(id)=>setBankGuideOpen(prev=>{const n=new Set(prev);if(n.has(id))n.delete(id);else n.add(id);return n;});
  const [uploadMode,setUploadMode]=useState('file');
  const fileRef=useRef(null);
  const [formMatchTipSeen,setFormMatchTipSeen]=useState(()=>!!localStorage.getItem('matchResultTipSeen'));
  const [formMatchSummary,setFormMatchSummary]=useState(()=>{
    const byKey={};
    (form.submissions||[]).forEach(s=>{
      if(s.matchType==='partial') byKey[s.createdAt]={type:'partial',totalAmount:s.matchedAmount,expected:getUserAmount(form,s.name,s.data?.studentId),depositCount:1};
      if(s.matchType==='overpaid') byKey[s.createdAt]={type:'overpaid',totalAmount:s.matchedAmount,expected:getUserAmount(form,s.name,s.data?.studentId)};
    });
    const sv=form.lastMatchSummary;
    if(!sv&&Object.keys(byKey).length===0) return null;
    return {byKey,refund:sv?.refund||[],stats:{matched:sv?.matchedCount||0,needsCheck:sv?.needsCheck||0}};
  });
  const [animatingPaidCrAts,setAnimatingPaidCrAts]=useState(new Set());
  const [formAnimating,setFormAnimating]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [excelPwdOpen,setExcelPwdOpen]=useState(false);
  const [pendingExcelData,setPendingExcelData]=useState(null);
  const formAnimTimers=useRef([]);
  const formRef=useRef(form);
  useEffect(()=>{formRef.current=form;},[form]);
  const isClosed=form.status==='closed';
  const subs=form.submissions||[];
  const groups=profile?.groups||[];
  const unpaidConfirmedCount=subs.filter(s=>s.paymentStatus==='unpaid_confirmed').length;

  const downloadExcel=()=>{
    const headers=['이름',...form.fields.map(f=>f.label)];
    const rows=subs.map(s=>[s.name,...form.fields.map(f=>s.data?.[f.id]??'')]);
    const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'신청 명단');
    XLSX.writeFile(wb,`${form.name}_신청명단.xlsx`);
  };
  const hasFee=(form.amount||0)>0;
  const fmPaid=hasFee?subs.filter(s=>s.paid||s.paymentStatus==='matched').length:0;
  const fmRequested=hasFee?subs.filter(s=>!s.paid&&s.paymentStatus==='requested').length:0;
  const unpaidXList=subs.filter(s=>!s.paid&&!['matched','requested','unpaid_confirmed'].includes(s.paymentStatus)).map(s=>({name:s.name,amount:getUserAmount(form,s.name,s.data?.studentId)}));
  const [slide,setSlide]=useState(()=>subs.length===0?0:1);
  const stepDone=[true,subs.length>0];

  const {filteredSubs,groupCounts,unregisteredCount,
         searchQ,setSearchQ,groupFilter,setGroupFilter,handlers}=useFormAdmin(form,updateForm,profile,saveProfile,showToast);
  useEffect(()=>{if(slide!==1)setShowExcelModal(false);},[slide]);

  const startBridge=async(name)=>{
    setBridging(true);
    const usedKeys=new Set();
    const members=[],memberMap={};
    subs.filter(s=>s.paymentStatus!=='unpaid_confirmed').forEach(s=>{
      const sid=s.data?.학번||s.data?.studentId||'';
      let key=s.name+(sid?`_${sid}`:'');
      if(usedKeys.has(key)){let n=2;while(usedKeys.has(key+'_'+n))n++;key=key+'_'+n;}
      usedKeys.add(key);members.push(key);memberMap[key]=s.name;
    });
    const code=genCode();
    const ev={
      code,name,date:form.date,pin:'',
      account:form.account||{},members,memberMap,
      rounds:[],payments:{},attendance:Object.fromEntries(members.map(k=>[k,false])),attendanceOpen:false,
      createdAt:new Date().toISOString(),
      sourceFormCode:form.code,feeConfig:null,paidFeeKeys:[],
    };
    const ok=await createEvent(ev);
    setBridging(false);
    if(ok){nav.setCurrentCode(ev.code);nav.setView('adminEvent');}
  };

  const handleCardDunning=async(s)=>{
    if(!form.account?.bank) return;
    const acct=form.account;
    const msg=`[${form.name}] 입금 안내\n\n${s.name}님 아직 입금 확인이 안 됐어요.\n\n${acct.bank} ${acct.number} (${acct.holder})\n${fmtKRW(getUserAmount(form,s.name,s.data?.studentId))}\n\n${getLink(`form=${form.code}`)}`;
    const shared=await shareText(msg);
    if(!shared){await copyText(msg);showToast('콕 찌르기 복사됐어요');}
    else showToast('공유 완료');
  };

  const _applyFormExcelParsed=async parsed=>{
    if(parsed.deposits.length===0){showToast('입금 내역이 없어요',C.red);return;}
    const curSubs=formRef.current.submissions||[];
    const results=matchEngine.match(parsed.deposits,curSubs,s=>getUserAmount(formRef.current,s.name,s.data?.studentId));
    const byKey={};
    (results.partial||[]).forEach(m=>{byKey[m.sub.createdAt]={type:'partial',totalAmount:m.totalAmount,expected:getUserAmount(formRef.current,m.sub.name,m.sub.data?.studentId),depositCount:m.deposits.length};});
    (results.overpaid||[]).forEach(m=>{byKey[m.sub.createdAt]={type:'overpaid',totalAmount:m.totalAmount,expected:getUserAmount(formRef.current,m.sub.name,m.sub.data?.studentId)};});
    const needsCheck=(results.partial||[]).length+(results.overpaid||[]).length;
    const isEmpty=results.matched.length===0&&needsCheck===0&&(results.refund||[]).length===0;
    // 수동 변경 카드 skip (matchedBy:'manual')
    const matchedCrAts=results.matched.filter(m=>curSubs.find(s=>s.createdAt===m.sub.createdAt)?.matchedBy!=='manual').map(m=>m.sub.createdAt);
    const newSummary={byKey,refund:results.refund||[],stats:{matched:matchedCrAts.length,needsCheck},emptyResult:isEmpty};
    setFormMatchSummary(newSummary);
    setShowExcelModal(false);
    const newSubs=[...curSubs];
    const now=new Date().toISOString();
    results.matched.forEach(m=>{
      const idx=newSubs.findIndex(s=>s.createdAt===m.sub.createdAt);
      if(idx>=0&&newSubs[idx].matchedBy!=='manual') newSubs[idx]={...newSubs[idx],paid:true,paymentStatus:'matched',matchedAmount:m.totalAmount,matchedAt:now,matchedBy:'auto'};
    });
    (results.partial||[]).forEach(m=>{
      const idx=newSubs.findIndex(s=>s.createdAt===m.sub.createdAt);
      if(idx>=0&&!(newSubs[idx].paid||newSubs[idx].paymentStatus==='matched')&&newSubs[idx].matchedBy!=='manual')
        newSubs[idx]={...newSubs[idx],paymentStatus:'requested',requestedAt:newSubs[idx].requestedAt||now,matchType:'partial',matchedAmount:m.totalAmount};
    });
    (results.overpaid||[]).forEach(m=>{
      const idx=newSubs.findIndex(s=>s.createdAt===m.sub.createdAt);
      if(idx>=0&&!(newSubs[idx].paid||newSubs[idx].paymentStatus==='matched')&&newSubs[idx].matchedBy!=='manual')
        newSubs[idx]={...newSubs[idx],paymentStatus:'requested',requestedAt:newSubs[idx].requestedAt||now,matchType:'overpaid',matchedAmount:m.totalAmount};
    });
    formAnimTimers.current.forEach(t=>clearTimeout(t));
    formAnimTimers.current=[];
    if(matchedCrAts.length>0){
      setFormAnimating(true);
      const interval=matchedCrAts.length<=50?30:Math.floor(1500/matchedCrAts.length);
      matchedCrAts.forEach((crAt,i)=>{
        const t=setTimeout(()=>setAnimatingPaidCrAts(prev=>new Set([...prev,crAt])),i*interval);
        formAnimTimers.current.push(t);
      });
      const finalT=setTimeout(async()=>{
        await updateForm({...formRef.current,submissions:newSubs,lastMatchSummary:{matchedCount:matchedCrAts.length,needsCheck,refund:results.refund.map(d=>({name:d.name,amount:d.amount})),matchedAt:new Date().toISOString()}});
        setFormAnimating(false);
        setAnimatingPaidCrAts(new Set());
      },matchedCrAts.length*interval+100);
      formAnimTimers.current.push(finalT);
    } else {
      await updateForm({...formRef.current,submissions:newSubs,lastMatchSummary:{matchedCount:matchedCrAts.length,needsCheck,refund:results.refund.map(d=>({name:d.name,amount:d.amount})),matchedAt:new Date().toISOString()}});
    }
    const parts=[];
    if(matchedCrAts.length>0) parts.push(`${matchedCrAts.length}명 처리`);
    if(needsCheck>0) parts.push(`확인 필요 ${needsCheck}명`);
    if(isEmpty) showToast('매칭 결과 없음 — 거래내역서 형식 확인',C.yellow);
    else showToast(parts.length?parts.join(', '):`${results.totalDeposits}건 분석`);
  };

  const handleFormExcel=async e=>{
    const file=e.target.files?.[0];
    if(!file) return;
    setUploading(true);
    try{
      const data=await file.arrayBuffer();
      const parsed=matchEngine.parseExcel(data);
      if(parsed.error==='NEEDS_PASSWORD'){setPendingExcelData(data);setExcelPwdOpen(true);setUploading(false);return;}
      if(parsed.error){showToast(parsed.error,C.red);setUploading(false);return;}
      await _applyFormExcelParsed(parsed);
    }catch(err){
      console.error(err);
      showToast('파일을 읽을 수 없어요',C.red);
      setFormAnimating(false);
    }
    setUploading(false);
    if(e.target) e.target.value='';
  };

  const submitFormExcelPassword=async password=>{
    setUploading(true);
    try{
      const decrypted=await decryptExcel(pendingExcelData,password);
      const parsed=matchEngine.parseExcel(decrypted);
      if(parsed.error){showToast(parsed.error,C.red);setUploading(false);return;}
      setExcelPwdOpen(false);
      setPendingExcelData(null);
      await _applyFormExcelParsed(parsed);
    }catch(err){
      if(err.message==='WRONG_PASSWORD') showToast('비밀번호가 틀려요. 다시 입력해주세요.',C.red);
      else showToast('파일 복호화에 실패했어요.',C.red);
    }
    setUploading(false);
    if(fileRef.current) fileRef.current.value='';
  };

  return(
    <div className="fade-up screen" style={{background:C.pageBg}}>
      <Header title={form.name} onBack={()=>nav.setView('home')}/>

      <FlowStepper
        steps={['폼 생성+공유','대조']}
        current={slide}
        done={stepDone}
        onStepClick={setSlide}
      />

      {slide===0&&(
        <div style={{padding:'12px 16px 24px'}}>
          <Card>
            {[
              ['이름', form.name],
              ['행사 날짜·시간', form.date+(form.time?` ${form.time}`:'')],
              ['참가비', form.amount?(form.amountPaid?`${fmtKRW(form.amount)} / ${fmtKRW(form.amountPaid)} (납부자)`:fmtKRW(form.amount)):'없음'],
              form.place?['장소', form.place]:null,
              form.maxPeople?['정원', `${form.maxPeople}명`]:null,
              form.account?.bank?['계좌', `${form.account.bank} ${form.account.number}${form.account.holder?` (${form.account.holder})`:''}`]:null,
              (form.fields?.length)?['추가 항목', form.fields.map(f=>f.label).join(', ')]:null,
            ].filter(Boolean).map(([label,value])=>(
              <div key={label} style={{display:'flex',gap:8,padding:'7px 0',borderBottom:`1px solid ${C.border}`}}>
                <div style={{color:C.textDim,fontSize:13,width:68,flexShrink:0}}>{label}</div>
                <div style={{color:C.text,fontSize:13,wordBreak:'break-all'}}>{value}</div>
              </div>
            ))}
          </Card>
          <div style={{marginTop:12}}>
            <Btn onClick={()=>setShareOpen(true)} style={{background:C.purple}}><Icon n="users" size={14} color="#fff" style={{marginRight:4}}/>공유하기</Btn>
          </div>
          {form.amountPaid&&(
            <div style={{marginTop:10}}>
              <button onClick={async()=>{const newList=buildMemberList(profile);await updateForm({...form,memberList:newList});showToast(`명단 업데이트 완료 (${newList.length}명)`);}} style={{width:'100%',padding:'11px',borderRadius:12,background:C.inputBg,border:`1px solid ${C.border}`,color:C.textMid,fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Icon n="refresh-cw" size={13} color={C.textMid}/>명단 업데이트</button>
              <div style={{fontSize:11,color:C.textDim,textAlign:'center',marginTop:5}}>이미 신청한 분들의 학생회비 정보는 그대로 유지됩니다</div>
            </div>
          )}
        </div>
      )}

      {slide===1&&(
        <div style={{padding:'10px 16px 24px'}}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFormExcel} style={{display:'none'}}/>
          <>
            <div style={{display:'flex',marginBottom:8,gap:6}}>
              {hasFee&&<button onClick={()=>setShowExcelModal(true)} disabled={formAnimating||uploading} style={{flex:1,padding:'6px 4px',borderRadius:12,fontSize:12,fontWeight:700,cursor:(formAnimating||uploading)?'default':'pointer',background:C.cardBg,color:(formAnimating||uploading)?C.textDim:C.textMid,border:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>{formAnimating?<><Spinner size={11} color={C.textDim}/>&nbsp;처리 중...</>:uploading?<><Spinner size={11} color={C.textDim}/>&nbsp;분석 중...</>:<><Icon n="download" size={12} color={C.textMid}/>자동 대조</>}</button>}
              {subs.length>0&&<button onClick={downloadExcel} style={{flex:1,padding:'6px 4px',borderRadius:12,fontSize:12,fontWeight:700,cursor:'pointer',background:C.cardBg,color:C.textMid,border:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'center',gap:4}}><Icon n="table" size={12} color={C.textMid}/>엑셀 추출</button>}
              {hasFee&&unpaidXList.length>0&&<button onClick={()=>setDunningOpen(true)} style={{flex:1,padding:'6px 4px',borderRadius:12,fontSize:12,fontWeight:700,cursor:'pointer',background:C.cardBg,color:C.textMid,border:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'center',gap:4}}><Icon n="megaphone" size={12} color={C.textMid}/>미입금자 {unpaidXList.length}명 콕 찌르기</button>}
            </div>
            {hasFee&&formMatchSummary&&(
              <div style={{marginBottom:8,padding:'7px 10px',background:formMatchSummary.emptyResult?C.yellowBg:C.greenBg,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{display:'flex',gap:6,alignItems:'center',fontSize:11,flexWrap:'wrap'}}>
                  <Icon n="bar-chart" size={12} color={formMatchSummary.emptyResult?C.yellow:'#5DCAA5'}/>
                  <span style={{color:C.textDim,fontWeight:700}}>자동 대조</span>
                  {formMatchSummary.emptyResult?(
                    <span style={{color:C.yellow}}>매칭 결과 없어요. 거래내역서 형식 확인하세요.</span>
                  ):(
                    <>
                      {fmPaid>0&&<><span style={{color:C.textDim}}>·</span><span style={{color:'#5DCAA5',fontWeight:700}}>매칭 {fmPaid}</span></>}
                      {fmRequested>0&&<><span style={{color:C.textDim}}>·</span><span style={{color:'#EF9F27',fontWeight:700}}>확인 필요 {fmRequested}</span></>}
                      {formMatchSummary.refund?.length>0&&<><span style={{color:C.textDim}}>·</span><span style={{color:'#888780',fontWeight:700}}>명단에 없는 입금 {formMatchSummary.refund.length}건</span></>}
                    </>
                  )}
                </div>
                <button onClick={()=>{setFormMatchSummary(null);updateForm({...formRef.current,lastMatchSummary:null});}} style={{fontSize:11,color:C.textDim,background:'none',border:`1px solid ${C.border}`,cursor:'pointer',padding:'2px 8px',borderRadius:6,fontFamily:'inherit',flexShrink:0}}>초기화</button>
              </div>
            )}
            {hasFee&&formMatchSummary&&!formMatchSummary.emptyResult&&!formMatchTipSeen&&(
              <div style={{marginBottom:8,padding:'7px 12px',background:C.inputBg,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <span style={{fontSize:11,color:C.textMid,lineHeight:1.6}}><span style={{color:'#EF9F27',fontWeight:700}}>노랑 카드</span>는 금액이 달라요. 카드 탭하면 부족·초과 금액 확인 가능.</span>
                <button onClick={()=>{setFormMatchTipSeen(true);localStorage.setItem('matchResultTipSeen','true');}} style={{fontSize:11,color:C.textDim,background:'none',border:'none',cursor:'pointer',flexShrink:0,padding:'2px 0'}}>✕</button>
              </div>
            )}
            <SubmissionsTab form={form} filteredSubs={filteredSubs} subs={subs} groupCounts={groupCounts}
                unregisteredCount={unregisteredCount} groups={groups}
                searchQ={searchQ} setSearchQ={setSearchQ} groupFilter={groupFilter} setGroupFilter={setGroupFilter}
                onSetSubStatus={handlers.setSubStatus}
                onCardDunning={form.account?.bank?handleCardDunning:null}
                animatingPaidCrAts={animatingPaidCrAts} formMatchSummary={formMatchSummary} formAnimating={formAnimating}
                onToggleAttended={handlers.toggleAttended} onCheckAllAttended={handlers.checkAllAttended}/>
            {hasFee&&formMatchSummary?.refund?.length>0&&(
              <div style={{marginTop:8,padding:'12px 14px',background:C.inputBg,borderRadius:12,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:12,fontWeight:700,color:C.textMid,marginBottom:6,display:'flex',alignItems:'center',gap:4}}>
                  <Icon n="circle-alert" size={13} color={C.textMid}/>명단에 없는 입금 {formMatchSummary.refund.length}건이 있어요
                </div>
                <div style={{fontSize:11,color:C.textDim,marginBottom:8}}>다른 정산이거나 실수 송금일 수 있어요. 직접 확인해주세요.</div>
                {formMatchSummary.refund.map((d,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderTop:i>0?`1px solid ${C.border}`:''}}>
                    <span style={{fontSize:13,fontWeight:600,color:C.text}}>{d.name}</span>
                    <span style={{fontSize:13,fontWeight:700,color:C.textMid}}>{fmtKRW(d.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {createEvent&&subs.length>0&&(
              <div style={{marginTop:16,paddingTop:14,borderTop:'2px solid #D1D5DB',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontSize:12,color:C.textMid}}>행사 후 추가 정산이 필요하면</span>
                <button onClick={()=>setBridgeNameOpen(true)} style={{background:'none',border:'none',cursor:'pointer',fontSize:12,color:C.accent,fontWeight:700,padding:'4px 0',display:'flex',alignItems:'center',gap:3}}><Icon n="clipboard-list" size={12} color={C.accent}/>이어서 정산하기 →</button>
              </div>
            )}
            {!isClosed&&subs.length>0&&(
              <Btn variant="danger" onClick={()=>setCloseConfirmOpen(true)} style={{marginTop:16}}><Icon n="lock" size={14} color="#fff" style={{marginRight:4}}/>마감하기</Btn>
            )}
          </>
        </div>
      )}

      {showExcelModal&&<ExcelUploadModal uploading={uploading} fileRef={fileRef} onClose={()=>setShowExcelModal(false)}/>}
      {excelPwdOpen&&<ExcelPasswordModal isOpen={excelPwdOpen} onClose={()=>{setExcelPwdOpen(false);setPendingExcelData(null);}} onSubmit={submitFormExcelPassword} loading={uploading}/>}
      {shareOpen&&<FormShareModal form={form} showToast={showToast} onClose={()=>setShareOpen(false)} onShared={()=>{setShareOpen(false);setSlide(1);}}/>}
      {dunningOpen&&(
        form.account?.bank
          ?<DunningModal eventName={form.name} account={form.account} link={getLink(`form=${form.code}`)}
              unpaidList={unpaidXList} showToast={showToast} onClose={()=>setDunningOpen(false)}/>
          :<Modal isOpen={true} onClose={()=>setDunningOpen(false)} title="콕 찌르기">
              <div style={{textAlign:'center',padding:'8px 0 16px'}}>
                <div style={{fontSize:13,color:C.textMid,lineHeight:1.8,marginBottom:20}}>콕 찌르기 메시지에 입금 계좌를 포함하려면<br/>먼저 계좌 정보를 등록해주세요.</div>
                <div style={{display:'flex',gap:8}}>
                  <Btn variant="ghost" onClick={()=>setDunningOpen(false)} style={{flex:1}}>취소</Btn>
                  <Btn onClick={()=>{setDunningOpen(false);nav.setView('setup');}} style={{flex:2}}>명단·계좌 설정하러 가기 →</Btn>
                </div>
              </div>
            </Modal>
      )}
      {closeConfirmOpen&&(
        <CloseFormModal onConfirm={async()=>{setCloseConfirmOpen(false);await handlers.closeForm();nav.setView('home');}} onClose={()=>setCloseConfirmOpen(false)}/>
      )}
      {bridgeNameOpen&&(
        <BridgeNameModal form={form} subsCount={subs.length} onConfirm={name=>{setBridgeNameOpen(false);startBridge(name);}} onClose={()=>setBridgeNameOpen(false)}/>
      )}
    </div>
  );
}

// ── FormSubmitScreen (참여자용 신청폼) ──────────────────
function FormSubmitScreen({nav,form:initForm,updateForm,showToast,isPreview=false}){
  const lsGet=k=>{try{return localStorage.getItem(k);}catch{return null;}};
  const lsSet=(k,v)=>{try{localStorage.setItem(k,v);}catch{}};
  const lsDel=k=>{try{localStorage.removeItem(k);}catch{}};
  const [form,setForm]=useState(initForm);
  const [values,setValues]=useState({});
  const [loading,setLoading]=useState(false);
  const [submitted,setSubmitted]=useState(false);
  const [mySubmission,setMySubmission]=useState(null);
  const [showLookup,setShowLookup]=useState(false);
  const [lookupName,setLookupName]=useState('');
  const [lookupId,setLookupId]=useState('');
  const [lookupErr,setLookupErr]=useState('');
  const [splashDone,setSplashDone]=useState(()=>!!lsGet('splash_form_'+initForm.code));
  const isClosed=form.status==='closed';
  const isFull=form.maxPeople&&(form.submissions||[]).length>=form.maxPeople;

  useEffect(()=>setForm(initForm),[initForm]);
  useRealtimeForm(form.code, f=>setForm(f), !isPreview);

  // 조회수 추적
  useEffect(()=>{if(!isPreview)api.trackView(null,form.code,'anonymous');},[]);

  // 재방문 시 이전 신청 확인 (localStorage)
  useEffect(()=>{
    const savedKey=lsGet('form_sub_'+form.code);
    if(savedKey){
      const existing=(form.submissions||[]).find(s=>s.createdAt===savedKey);
      if(existing){setMySubmission(existing);setSubmitted(true);}
      else lsDel('form_sub_'+form.code); // 삭제된 신청
    }
  },[form.code]);

  // form이 업데이트되면 mySubmission도 갱신 (실시간 상태 반영)
  useEffect(()=>{
    if(mySubmission){
      const updated=(form.submissions||[]).find(s=>s.createdAt===mySubmission.createdAt);
      if(updated&&(updated.paid!==mySubmission.paid||updated.paymentStatus!==mySubmission.paymentStatus)){
        setMySubmission(updated);
      }
    }
  },[form.submissions]);

  if(!splashDone&&!isPreview) return <ParticipantSplashScreen onDone={()=>{lsSet('splash_form_'+form.code,'1');setSplashDone(true);}}/>;


  const setValue=(id,val)=>setValues(v=>({...v,[id]:val}));

  const submit=async()=>{
    if(isPreview) return;
    for(const f of form.fields){
      if(!f.required) continue;
      const v=values[f.id];
      const empty = v==null
        || (typeof v==='string' && v.trim()==='')
        || (Array.isArray(v) && v.length===0);
      if(empty){
        showToast(`${f.label}을(를) 입력해주세요`,C.red);return;
      }
    }
    // 중복 신청 방지 (이름 + 전화번호, 폰 없으면 이름 + 학번)
    const existingSubs=form.submissions||[];
    const name=(values.name||'').trim();
    const phone=(values.phone||'').replace(/[^0-9]/g,'');
    const sid=(values.studentId||'').replace(/\s/g,'');
    if(name&&(phone||sid)){
      const dup=existingSubs.find(s=>s.name.trim()===name&&(
        phone
          ? (s.phone||'').replace(/[^0-9]/g,'')===phone
          : (s.data?.studentId||'').replace(/\s/g,'')===sid
      ));
      if(dup){
        showToast('이미 신청한 내역이 있어요',C.orange);
        setMySubmission(dup);setSubmitted(true);
        lsSet('form_sub_'+form.code,dup.createdAt);
        return;
      }
    }

    setLoading(true);
    const now=new Date().toISOString();
    const submission={
      name:name,
      phone:values.phone||'',
      data:values,
      paid:form.noFee?true:false,
      paymentStatus:form.noFee?'matched':'pending',
      ...(form.noFee?{matchedAt:now,matchedBy:'auto'}:{}),
      createdAt:now,
    };
    try{
      const {data,error}=await api.appendFormSubmission(form.code,submission);
      if(error||data?.error){
        if(data?.error==='full') showToast('정원이 마감됐어요',C.orange);
        else if(data?.error==='closed') showToast('신청이 마감됐어요',C.orange);
        else if(data?.error==='duplicate'){
          const d=(form.submissions||[]).find(s=>s.name.trim()===name&&(
            phone
              ? (s.phone||'').replace(/[^0-9]/g,'')===phone
              : (s.data?.studentId||'').replace(/\s/g,'')===sid
          ));
          showToast('이미 신청한 내역이 있어요',C.orange);
          if(d){setMySubmission(d);setSubmitted(true);lsSet('form_sub_'+form.code,d.createdAt);}
        }
        else showToast('신청 실패: 다시 시도해주세요',C.red);
        setLoading(false);return;
      }
      posthog.capture('신청자_제출');
      setMySubmission(submission);
      setSubmitted(true);
      lsSet('form_sub_'+form.code,submission.createdAt);
    }catch(e){
      showToast('신청 실패: 다시 시도해주세요',C.red);
    }
    setLoading(false);
  };

  const markFormRequested=async()=>{
    if(!mySubmission||mySubmission.paid||mySubmission.paymentStatus==='matched'||mySubmission.paymentStatus==='requested') return;
    await api.requestFormPayment(form.code,mySubmission.createdAt);
    setMySubmission(s=>({...s,paymentStatus:'requested',requestedAt:new Date().toISOString()}));
  };

  if(submitted&&mySubmission&&form.noFee){
    return(
      <div className="fade-up screen" style={{background:C.pageBg,padding:'48px 20px',textAlign:'center'}}>
        <div style={{width:72,height:72,borderRadius:36,background:C.green+'20',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 20px'}}>
          <Icon n="circle-check" size={36} color={C.green}/>
        </div>
        <div style={{fontSize:24,fontWeight:900,color:C.text,marginBottom:6}}>신청이 완료됐어요!</div>
        <div style={{fontSize:14,color:C.textMid,marginBottom:28,lineHeight:1.7}}>현장에서 이름을 말씀해주세요</div>
        <Card style={{textAlign:'left'}}>
          <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:8}}>{form.name}</div>
          {(form.date||form.place)&&(
            <div style={{fontSize:13,color:C.textMid,marginBottom:12,display:'flex',flexDirection:'column',gap:4}}>
              {form.date&&<span style={{display:'inline-flex',alignItems:'center',gap:4}}><Icon n="calendar" size={13} color={C.textDim}/>{(form.date||'').replace(/^\d{4}-(\d{2})-(\d{2})$/,(_,m,d)=>`${+m}월 ${+d}일`)}{form.time?` ${form.time}`:''}</span>}
              {form.place&&<span style={{display:'inline-flex',alignItems:'center',gap:4}}><Icon n="map-pin" size={13} color={C.textDim}/>{form.place}</span>}
            </div>
          )}
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'12px 14px',background:C.greenBg,borderRadius:12}}>
            <Icon n="user" size={16} color={C.green}/>
            <span style={{fontSize:16,fontWeight:800,color:C.text}}>{mySubmission.name}</span>
          </div>
          <div style={{fontSize:11,color:C.textDim,marginTop:10,textAlign:'center'}}>{fmtRelTime(mySubmission.createdAt)} 신청</div>
        </Card>
        <div style={{fontSize:12,color:C.textDim,marginTop:20}}>이 탭을 닫아도 돼요</div>
      </div>
    );
  }

  if(submitted&&mySubmission){
    const isConfirmed=mySubmission.paid||mySubmission.paymentStatus==='matched';
    const isRequested=mySubmission.paymentStatus==='requested';
    const myAmount=getUserAmount(form,mySubmission.name,mySubmission.data?.studentId);
    const tossLink=getTossLink(form.account.bank,form.account.number,myAmount);
    const kakaoLink=getKakaoBankLink(form.account.bank,form.account.number,myAmount);
    const accountText=`${form.account.bank} ${form.account.number}`;
    const subIdx=(form.submissions||[]).findIndex(s=>s.createdAt===mySubmission.createdAt);
    const myNumber=subIdx>=0?subIdx+1:(form.submissions||[]).length;

    return(
      <div className="fade-up screen" style={{background:C.pageBg,padding:'48px 20px',textAlign:'center'}}>
        <div style={{width:72,height:72,borderRadius:36,background:isConfirmed?C.green+'20':C.accent+'20',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'}}><Icon n={isConfirmed?'circle-check':'sparkles'} size={36} color={isConfirmed?C.green:C.accent}/></div>
        <div style={{fontSize:24,fontWeight:900,color:C.text,marginBottom:6}}>
          {isConfirmed?'입금 확정!':'신청 완료!'}
        </div>
        {form.maxPeople&&(
          <div style={{display:'inline-flex',alignItems:'center',gap:6,background:C.accentBg,borderRadius:20,padding:'6px 16px',marginBottom:8}}>
            <span style={{fontSize:13,color:C.accent,fontWeight:700}}>{myNumber}/{form.maxPeople}번째 신청</span>
          </div>
        )}
        <div style={{fontSize:14,color:C.textMid,marginBottom:28,lineHeight:1.7}}>
          {isConfirmed?'총무가 입금을 확인했어요':isRequested?(
            <>입금 확인 필요 상태예요<br/><span style={{color:C.green,fontWeight:700}}>총무 확인 대기 중</span></>
          ):(
            <>아래 계좌로 입금해주세요<br/><span style={{color:C.orange,fontWeight:700}}>미입금</span></>
          )}
        </div>
        
        {!isConfirmed&&(
          <Card style={{textAlign:'left',marginBottom:16}}>
            <div style={{fontWeight:800,color:C.text,marginBottom:14,fontSize:15,display:'flex',alignItems:'center',gap:6}}><Icon n="credit-card" size={15} color={C.accent}/>입금 정보</div>
            <div style={{background:C.inputBg,borderRadius:14,padding:'14px 16px',marginBottom:10}}>
              <div style={{fontSize:12,color:C.textDim,marginBottom:4}}>납부 금액</div>
              <div style={{fontSize:24,fontWeight:900,color:C.accent}}>{fmtKRW(myAmount)}</div>
            </div>
            <div style={{background:C.inputBg,borderRadius:14,padding:'14px 16px',marginBottom:14}}>
              <div style={{fontSize:12,color:C.textDim,marginBottom:6}}>입금 계좌</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:C.text}}>{accountText}</div>
                  <div style={{fontSize:13,color:C.textMid,marginTop:2}}>예금주: {form.account.holder}</div>
                </div>
                <button onClick={async()=>{await copyText(accountText);showToast('계좌번호 복사됨');markFormRequested();}} style={{background:C.accentBg,border:'none',borderRadius:10,padding:'8px 14px',color:C.accent,fontSize:13,fontWeight:700,cursor:'pointer',flexShrink:0}}>복사</button>
              </div>
            </div>

            {/* 본인 명의 안내 */}
            <div style={{background:C.orangeBg,borderRadius:10,padding:'10px 14px',marginBottom:12,display:'flex',alignItems:'center',gap:8}}>
              <Icon n="triangle-alert" size={16} color={C.orange}/>
              <div style={{fontSize:12,color:C.orange,fontWeight:700,lineHeight:1.5}}>반드시 본인 이름으로 입금해주세요<br/><span style={{fontWeight:500,color:C.textMid}}>다른 이름으로 입금하면 확인이 어려워요</span></div>
            </div>

            {/* 송금 딥링크 */}
            {(tossLink||kakaoLink)&&(
              <div style={{display:'flex',gap:8,marginBottom:10}}>
                {tossLink&&(
                  <a href={tossLink} onClick={markFormRequested} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'14px',borderRadius:14,background:'#0050FF',color:'#fff',fontWeight:700,fontSize:14,textDecoration:'none',cursor:'pointer'}}>
                    토스 송금
                  </a>
                )}
                {kakaoLink&&(
                  <a href={kakaoLink} onClick={markFormRequested} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'14px',borderRadius:14,background:'#FEE500',color:'#191919',fontWeight:700,fontSize:14,textDecoration:'none',cursor:'pointer'}}>
                    카뱅 송금
                  </a>
                )}
              </div>
            )}

            {isRequested&&(
              <div style={{textAlign:'center',padding:'14px',background:C.greenBg,borderRadius:14}}>
                <div style={{fontWeight:700,color:C.green,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',gap:4}}><Icon n="check" size={14} color={C.green}/>입금 확인 필요</div>
                <div style={{fontSize:12,color:C.textMid,marginTop:4}}>총무가 확인하면 확정돼요</div>
              </div>
            )}
          </Card>
        )}

        {isConfirmed&&(
          <Card style={{textAlign:'center',background:C.greenBg}}>
            <div style={{fontSize:18,fontWeight:900,color:C.green,marginBottom:4,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Icon n="check" size={18} color={C.green}/>입금 확정</div>
            <div style={{fontSize:13,color:C.textMid}}>총무가 입금을 확인했어요</div>
          </Card>
        )}

        <div style={{fontSize:12,color:C.textDim,marginTop:16}}>이 탭을 닫아도 돼요</div>
      </div>
    );
  }

  // 마감/정원 초과
  if(isClosed||isFull){
    return(
      <div className="fade-up screen" style={{background:C.pageBg,padding:'60px 20px',textAlign:'center'}}>
        <div style={{width:80,height:80,borderRadius:40,background:isClosed?C.textDim+'18':C.red+'18',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 20px'}}><Icon n={isClosed?'lock':'frown'} size={40} color={isClosed?C.textDim:C.red}/></div>
        <div style={{fontSize:24,fontWeight:900,color:C.text,marginBottom:8}}>{isClosed?'신청이 마감됐어요':'정원이 마감됐어요'}</div>
        <div style={{fontSize:14,color:C.textMid,lineHeight:1.7}}>
          {isClosed?'총무님이 신청을 마감했어요':'선착순 마감됐어요. 다음 기회에!'}
        </div>
      </div>
    );
  }

  return(
    <div className="fade-up screen" style={{background:C.pageBg}}>
      {/* 헤더 */}
      <div style={{background:C.orange,padding:'32px 20px 24px',textAlign:'center'}}>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.6)',marginBottom:12}}>정산해로 진행 중인 신청</div>
        <div style={{width:56,height:56,borderRadius:28,background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px'}}><Icon n="clipboard-list" size={28} color="#fff"/></div>
        <div style={{fontSize:22,fontWeight:900,color:'#fff',marginBottom:6}}>{form.name}</div>
        <div style={{display:'flex',justifyContent:'center',gap:12,fontSize:13,color:'rgba(255,255,255,0.9)'}}>
          <span style={{display:'inline-flex',alignItems:'center',gap:4}}><Icon n="calendar" size={13} color="rgba(255,255,255,0.8)"/>{(form.date||'').replace(/^\d{4}-(\d{2})-(\d{2})$/,(_,m,d)=>`${+m}월 ${+d}일`)}{form.time?` ${form.time}`:''}</span>
          {!form.noFee&&<span style={{display:'inline-flex',alignItems:'center',gap:4}}><Icon n="wallet" size={13} color="rgba(255,255,255,0.8)"/>{form.amountPaid?`${fmtKRW(form.amount)} / ${fmtKRW(form.amountPaid)}`:fmtKRW(form.amount)}</span>}
        </div>
        {form.maxPeople&&(
          <div style={{marginTop:10,display:'inline-flex',alignItems:'center',gap:6,background:'rgba(255,255,255,0.2)',borderRadius:20,padding:'4px 14px'}}>
            <span style={{fontSize:12,color:'#fff',display:'inline-flex',alignItems:'center',gap:4}}><Icon n="users" size={12} color="#fff"/>{form.submissions?.length||0}/{form.maxPeople}명 신청</span>
          </div>
        )}
      </div>

      <div style={{padding:'20px 16px'}}>
        <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:16}}>
          {form.fields.map(f=>(
            <div key={f.id} style={{background:'#fff',borderRadius:16,padding:'20px',boxShadow:C.shadow}}>
              <label style={{display:'block',fontSize:14,fontWeight:700,color:C.text,marginBottom:f.hint?2:12}}>
                {f.label}{f.required&&<span style={{color:C.red}}> *</span>}
              </label>
              {f.hint&&<div style={{fontSize:12,color:C.textMid,marginBottom:10}}>{f.hint}</div>}
              {f.type==='text'&&(
                <input
                  value={values[f.id]||''}
                  onChange={e=>setValue(f.id,e.target.value)}
                  maxLength={f.id==='name'?50:f.id==='phone'?20:f.id==='studentId'||f.id==='generation'?20:200}
                  style={{width:'100%',padding:'12px 14px',border:`1.5px solid ${C.border}`,borderRadius:12,fontSize:15,background:C.inputBg,outline:'none'}}
                  placeholder={f.id==='name'?'홍길동':f.id==='phone'?'01012345678':f.label}
                />
              )}
              {f.type==='textarea'&&(
                <textarea
                  value={values[f.id]||''}
                  onChange={e=>setValue(f.id,e.target.value)}
                  rows={3}
                  maxLength={500}
                  style={{width:'100%',padding:'12px 14px',border:`1.5px solid ${C.border}`,borderRadius:12,fontSize:15,background:C.inputBg,resize:'vertical',outline:'none'}}
                  placeholder={f.label}
                />
              )}
              {f.type==='number'&&(
                <input
                  type="number"
                  value={values[f.id]||''}
                  onChange={e=>setValue(f.id,e.target.value)}
                  maxLength={10}
                  style={{width:'100%',padding:'12px 14px',border:`1.5px solid ${C.border}`,borderRadius:12,fontSize:15,background:C.inputBg,outline:'none'}}
                  placeholder="0"
                />
              )}
              {f.type==='select'&&(
                <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                  {(f.options||[]).map(opt=>(
                    <button key={opt} onClick={()=>setValue(f.id,opt)} style={{
                      padding:'10px 16px',borderRadius:10,fontSize:14,fontWeight:600,cursor:'pointer',
                      background:values[f.id]===opt?C.accent:'#fff',
                      color:values[f.id]===opt?'#fff':C.textMid,
                      border:`1.5px solid ${values[f.id]===opt?C.accent:C.border}`,
                    }}>{opt}</button>
                  ))}
                </div>
              )}
              {f.type==='multiselect'&&(
                <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                  {(f.options||[]).map(opt=>{
                    const selected=(values[f.id]||[]).includes(opt);
                    return(
                      <button key={opt} onClick={()=>{
                        const cur=values[f.id]||[];
                        setValue(f.id,selected?cur.filter(v=>v!==opt):[...cur,opt]);
                      }} style={{
                        padding:'10px 16px',borderRadius:10,fontSize:14,fontWeight:600,cursor:'pointer',
                        background:selected?C.accent:'#fff',
                        color:selected?'#fff':C.textMid,
                        border:`1.5px solid ${selected?C.accent:C.border}`,
                      }}>{opt}</button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <Btn onClick={submit} loading={loading} variant="orange">신청하기 →</Btn>

        {/* 재방문 신청 확인 */}
        {!isPreview&&(()=>{
          const hasStudentId=form.fields.some(f=>f.id==='studentId');
          const hasPhone=form.fields.some(f=>f.id==='phone');
          const idLabel=hasStudentId?'학번':hasPhone?'전화번호 뒤 4자리':null;

          const doLookup=()=>{
            setLookupErr('');
            const name=lookupName.trim();
            if(!name){setLookupErr('이름을 입력해주세요');return;}
            const subs=form.submissions||[];
            let match=null;
            if(hasStudentId&&lookupId.trim()){
              match=subs.find(s=>s.name.trim()===name&&(s.data?.studentId||'').replace(/\s/g,'')===lookupId.trim().replace(/\s/g,''));
            } else if(hasPhone&&lookupId.trim()){
              const last4=lookupId.replace(/[^0-9]/g,'').slice(-4);
              match=subs.find(s=>s.name.trim()===name&&(s.phone||'').replace(/[^0-9]/g,'').endsWith(last4));
            } else {
              const matches=subs.filter(s=>s.name.trim()===name);
              if(matches.length===1) match=matches[0];
              else if(matches.length>1){setLookupErr('동명이인이 있어요. '+idLabel+'도 입력해주세요');return;}
            }
            if(match){
              setMySubmission(match);setSubmitted(true);
              lsSet('form_sub_'+form.code,match.createdAt);
            } else {
              setLookupErr('신청 내역을 찾을 수 없어요');
            }
          };

          return(
            <div style={{marginTop:20,textAlign:'center'}}>
              {!showLookup?(
                <button onClick={()=>setShowLookup(true)} style={{background:'none',border:'none',color:C.textDim,fontSize:13,cursor:'pointer',textDecoration:'underline'}}>이미 신청했어요</button>
              ):(
                <div style={{background:'#fff',borderRadius:16,padding:'20px',boxShadow:C.shadow,textAlign:'left'}}>
                  <div style={{fontWeight:700,color:C.text,fontSize:14,marginBottom:14}}>내 신청 확인</div>
                  <input value={lookupName} onChange={e=>{setLookupName(e.target.value);setLookupErr('');}}
                    placeholder="신청 시 입력한 이름"
                    style={{width:'100%',padding:'12px 14px',border:`1.5px solid ${C.border}`,borderRadius:12,fontSize:15,background:C.inputBg,outline:'none',marginBottom:8}}
                  />
                  {idLabel&&(
                    <input value={lookupId} onChange={e=>{setLookupId(e.target.value);setLookupErr('');}}
                      placeholder={idLabel}
                      style={{width:'100%',padding:'12px 14px',border:`1.5px solid ${C.border}`,borderRadius:12,fontSize:15,background:C.inputBg,outline:'none',marginBottom:8}}
                    />
                  )}
                  {lookupErr&&<div style={{color:C.red,fontSize:12,marginBottom:8}}>{lookupErr}</div>}
                  <Btn onClick={doLookup} variant="orange">확인하기</Btn>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

const root=createRoot(document.getElementById('root'));
root.render(<App/>);
