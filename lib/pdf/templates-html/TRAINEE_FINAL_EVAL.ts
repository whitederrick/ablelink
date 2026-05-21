// lib/pdf/templates-html/TRAINEE_FINAL_EVAL.ts
// 지원고용 훈련생 종합 평가기록부 — jsreport 원본 1:1 이식
// adaptation-final-eval과 동일 구조이나 상단 기간 표시가 사전/현장 2행으로 다름
import { buildHcrFontFaceCss } from "../engine/fontEmbed";

const MASTER = [
  { code:"WORK_ATTITUDE",    label:"근무태도", items:["결근, 지각, 조퇴 등을 하지 않는다","결근, 지각, 조퇴 등을 할 때는 연락을 취한다","휴식시간과 근무시간을 잘 지킨다","주의사항을 잘 듣고 그대로 이행한다","외모를 깨끗하고 단정하게 유지한다"] },
  { code:"INTERPERSONAL",    label:"대인관계", items:["상황에 맞는 적절한 경어를 사용한다","주위동료와 협조를 잘한다","상사, 동료, 고객에게 인사를 잘한다","질문에 적절한 답변을 할 수 있다","다른 사람의 이야기를 잘 청취한다."] },
  { code:"WORK_STYLE",       label:"작업태도", items:["적극적으로 업무에 참여한다","지시 없이 스스로 자신의 일을 수행한다","열심히 작업에 몰두한다","목표량을 완수하면 다른 일거리를 찾는다","잘못을 지적할 때 호의적으로 반응한다"] },
  { code:"WORK_PERFORMANCE", label:"작업수행", items:["도구나 기계를 잘 다룬다.","지시한 방법대로 작업을 수행한다(정확성)","근무시간동안 산만하지 않고, 꾸준히 일한다.","주어진 작업량을 완수한다.","직무를 수행할수록, 속도와 정확성이 증가한다.(숙련성)"] },
];

function parseDate(v?: string): Date | null {
  if (!v) return null;
  const s = String(v).trim().replace(/\./g,"-");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
}
function fmtDot(dt: Date): string {
  return `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,"0")}.${String(dt.getDate()).padStart(2,"0")}`;
}
function rangeDot(a?: string, b?: string): string {
  const aa = a ? fmtDot(parseDate(a)!) : ""; const bb = b ? fmtDot(parseDate(b)!) : "";
  if (aa && bb) return `${aa}~${bb}`; return aa || bb;
}
function countWorkingDays(a: Date, b: Date): string {
  const s=a<=b?a:b, e=a<=b?b:a; let c=0;
  for (let dt=new Date(s.getFullYear(),s.getMonth(),s.getDate()); dt<=e; dt.setDate(dt.getDate()+1)) {
    const w=dt.getDay(); if(w!==0&&w!==6) c++;
  }
  return String(c);
}
function toVert(label: string): string { return label.split("").join("<br/>"); }

export type TraineeFinalEvalPayload = {
  traineeName: string;
  companyName: string;
  periodStart?: string; periodEnd?: string;
  preTrainingStart?: string; preTrainingEnd?: string;
  fieldTrainingStart?: string; fieldTrainingEnd?: string;
  workingDays?: string;
  scores?: Record<string, Array<{initial?:string|number; final?:string|number}>>;
  comments?: Record<string, string>;
  signatureNewPage?: boolean;
  signatureTopMarginMm?: number;
  signatures?: {
    coach?: { name?: string; imageUrl?: string };
    agencyAgent?: { name?: string; imageUrl?: string };
  };
};

function prepare(p: TraineeFinalEvalPayload) {
  const start = parseDate(p.periodStart ?? p.preTrainingStart);
  const end   = parseDate(p.periodEnd ?? p.fieldTrainingEnd);
  const workingDays = (start && end) ? countWorkingDays(start, end) : (p.workingDays ?? "");
  const prePeriod   = rangeDot(p.preTrainingStart, p.preTrainingEnd);
  const fieldPeriod = rangeDot(p.fieldTrainingStart, p.fieldTrainingEnd);

  const scores = p.scores ?? {}; const comments = p.comments ?? {};
  let totalI=0, totalF=0;
  const sections = MASTER.map(sec => {
    const arr = Array.isArray(scores[sec.code]) ? scores[sec.code] : [];
    const rows = sec.items.map((text,i) => {
      const s=arr[i]??{}; const ini=Number(s.initial??""); const fin=Number(s.final??"");
      if(!isNaN(ini)) totalI+=ini; if(!isNaN(fin)) totalF+=fin;
      return { text, initial: s.initial??"", final: s.final??"", isSkillRow: sec.code==="WORK_PERFORMANCE"&&i===4 };
    });
    return { vlabel: toVert(sec.label), rowspan: rows.length, comment: comments[sec.code]??"", rows };
  });

  const contentH=262, topBlock=10+36, headerH=4.87, qRowH=7.78, totalH=9.86, remarkH=4.87, signH=26;
  const tableH=headerH+20*qRowH+totalH+remarkH;
  const remaining=contentH-topBlock-tableH;
  const mt=p.signatureTopMarginMm??Math.min(2,Math.max(0,remaining-signH));

  return { ...p, workingDays, prePeriod, fieldPeriod, sections,
    totalInitial: String(totalI), totalFinal: String(totalF),
    signatureNewPage: p.signatureNewPage??false, signatureTopMarginMm: mt };
}

export function renderTRAINEE_FINAL_EVAL_HTML(raw: TraineeFinalEvalPayload): string {
  const p = prepare(raw);
  const fontCss = buildHcrFontFaceCss("20mm 26.7mm 15mm 23.5mm");
  const sigs = p.signatures ?? {};
  const sigImg = (url?: string) => url ? `<img class="sign-img" src="${url}" />` : "";

  const sectionsHtml = p.sections.flatMap(sec =>
    sec.rows.map((r,i) => `
    <tr class="qrow">
      ${i===0 ? `<td class="vlabel" rowspan="${sec.rowspan}">${sec.vlabel}</td>` : ""}
      <td class="item ${r.isSkillRow?"tight27":""}">${r.text}</td>
      <td class="score">${r.initial}</td>
      <td class="score">${r.final}</td>
      ${i===0 ? `<td class="comment" rowspan="${sec.rowspan}">${sec.comment}</td>` : ""}
    </tr>`)
  ).join("\n");

  const signBreak = p.signatureNewPage ? "sign-break" : "";

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" />
<style>
${fontCss}
body { font-family:"HCRDotum","Dotum",sans-serif; font-size:11pt; line-height:1.15; color:#000;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; letter-spacing:-0.2px; }
.sheet { width:100%; padding-top:10mm; }
.title { text-align:center; font-family:"HCRDotum",sans-serif; font-size:16pt; font-weight:600;
  font-stretch:100%; letter-spacing:0.05em; line-height:1.2; margin:0 0 4mm 0; }
table { width:100%; border-collapse:collapse; table-layout:fixed; }
th, td { padding:0; vertical-align:middle; font-size:11pt; border:0.08mm solid #000; }
.info col.i0{width:35.85mm;}.info col.i1{width:68.36mm;}.info col.i2{width:55.58mm;}
.info th { text-align:center; font-family:"HCRDotum","Dotum",sans-serif; font-size:11pt;
  font-stretch:97%; letter-spacing:-0.07em; line-height:1.0; font-weight:400; height:4.70mm; }
.info td { text-align:center; font-family:"HCRDotum","Dotum",sans-serif; font-size:11pt;
  font-stretch:97%; letter-spacing:-0.07em; line-height:1.0; height:8.50mm; }
.info td.periodCell { letter-spacing:-0.10em; padding:0; }
.periodSub { width:55.58mm; border-collapse:collapse; table-layout:fixed; }
.periodSub col.p0{width:8.17mm;}.periodSub col.p1{width:47.41mm;}
.periodSub td { height:4.25mm; border:0; padding:0 1.0mm; font-size:11pt; font-stretch:97%; }
.periodSub .pLabel { text-align:center; padding:0; border-right:0.06mm solid #000; letter-spacing:-0.07em; padding-top:0.1mm; }
.periodSub .pValue { text-align:center; white-space:nowrap; }
.periodSub tr:first-child td { border-bottom:0.06mm solid #000; }
.main col.c0{width:9.96mm;}.main col.c1{width:73.15mm;}.main col.c2{width:10.55mm;}.main col.c3{width:10.55mm;}.main col.c4{width:55.58mm;}
.main th { text-align:center; font-family:"HCRDotum","Dotum",sans-serif; font-size:11pt;
  font-stretch:97%; letter-spacing:-0.07em; line-height:1.0; font-weight:400; height:4.70mm; padding-top:0.35mm; padding-bottom:0.05mm; }
.main tr.qrow td { height:7.45mm; padding:0mm 0.8mm; }
.vlabel { text-align:center; font-family:"HCRDotum","Dotum",sans-serif; font-size:11pt;
  font-stretch:97%; letter-spacing:-0.07em; line-height:1.6; font-weight:400; }
.main td.item { padding-left:3mm; font-family:"HCRDotum","Dotum",sans-serif; font-size:11pt;
  font-stretch:97%; letter-spacing:-0.13em; line-height:1.0; white-space:nowrap; }
.main td.item.tight27 { letter-spacing:-0.24em; }
.score { text-align:center; font-family:"HCRDotum","Dotum",sans-serif; font-size:11pt;
  font-stretch:97%; letter-spacing:-0.07em; line-height:1.0; }
.comment { vertical-align:top; line-height:1.15; white-space:pre-wrap; padding:1.1mm 1.4mm; letter-spacing:-0.10em; }
.sumRow td { height:8.5mm; padding:0.7mm 1.1mm; }
.sumLabel { text-align:center; font-family:"HCRDotum","Dotum",sans-serif; font-size:11pt; font-stretch:97%; letter-spacing:-0.07em; line-height:1.3; font-weight:400; }
.sumValue { text-align:center; font-family:"HCRDotum","Dotum",sans-serif; font-size:11pt; font-stretch:97%; letter-spacing:-0.07em; line-height:1.3; }
.remarkOuter { padding:0 !important; box-sizing:border-box; }
.remarkFlex { display:grid; grid-template-columns:18.11mm 1fr; align-items:center; height:4.5mm; overflow:hidden; }
.remarkHeadCell { height:4.87mm; display:flex; align-items:center; justify-content:center;
  font-family:"HCRDotum","Dotum",sans-serif; font-size:11pt; font-stretch:97%; letter-spacing:-0.07em; line-height:1.0; font-weight:400;
  border:0; border-right:0.08mm solid #000; overflow:hidden; }
.remarkTextCell { height:4.87mm; display:flex; align-items:center;
  font-family:"HCRDotum","Dotum",sans-serif; font-size:11pt; font-stretch:97%; letter-spacing:-0.07em; line-height:1.0;
  text-align:left; padding-left:0.5em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.main tr:first-child th { border-top:0; }
.sign-area, .sign-block, .sign-row { page-break-inside:avoid; }
.sign-page { width:100%; }
.sign-break { page-break-before:always; }
.sign-area { width:100%; }
.sign-block { width:100%; font-family:"HCRDotum","Dotum",sans-serif; font-size:12pt; font-stretch:95%; letter-spacing:-0.05em; font-weight:400; margin:0; }
.sign-row { display:flex; align-items:center; }
.sign-left-spacer { width:18mm; }
.sign-label-wrap { width:86mm; text-align:right; white-space:nowrap; }
.sign-slot { flex:1; display:inline-block; text-align:right; padding-right:4mm; white-space:nowrap; position:relative; min-width:20mm; overflow:visible; }
.sign-name { min-width:28mm; text-align:left; padding-left:2mm; white-space:nowrap; font-size:12pt; font-stretch:95%; letter-spacing:-0.05em; flex-shrink:0; }
.sign-gap { height:4pt; }
.sign-img { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:28mm; height:20mm; object-fit:contain; opacity:0.6; pointer-events:none; z-index:1; }
.sign-row.coach  { line-height:1.8; }
.sign-row.agency { line-height:1.3; }
</style>
</head>
<body>
<div class="sheet">
  <div class="title">지원고용 훈련생 종합 평가기록부</div>
  <table class="info">
    <colgroup><col class="i0"><col class="i1"><col class="i2"></colgroup>
    <tr><th>대상자명</th><th>사업체명</th><th>훈련기간</th></tr>
    <tr>
      <td>${p.traineeName}</td>
      <td>${p.companyName}</td>
      <td class="periodCell">
        <table class="periodSub">
          <colgroup><col class="p0"><col class="p1"></colgroup>
          <tr><td class="pLabel">사<br/>전</td><td class="pValue">${p.prePeriod}</td></tr>
          <tr><td class="pLabel">현<br/>장</td><td class="pValue">${p.fieldPeriod}</td></tr>
        </table>
      </td>
    </tr>
  </table>
  <table class="main" style="margin-top:0;">
    <colgroup><col class="c0"><col class="c1"><col class="c2"><col class="c3"><col class="c4"></colgroup>
    <tr><th colspan="2">구&nbsp;&nbsp;분</th><th>사전</th><th>현장</th><th>평&nbsp;가&nbsp;소&nbsp;견</th></tr>
    ${sectionsHtml}
    <tr class="sumRow">
      <td class="sumLabel" colspan="2">총 점(만점 100점)</td>
      <td class="score sumValue">${p.totalInitial}</td>
      <td class="score sumValue">${p.totalFinal}</td>
      <td class="sumValue"></td>
    </tr>
    <tr class="remarkRow">
      <td colspan="5" class="remarkOuter">
        <div class="remarkFlex">
          <div class="remarkHeadCell">비고</div>
          <div class="remarkTextCell">※ 항목별 점수채점 : 우수 5점, 양호 4점, 보통 3점, 미흡 2점, 불량 1점</div>
        </div>
      </td>
    </tr>
  </table>
  <div class="sign-page ${signBreak}">
    <div class="sign-area" style="margin-top:${p.signatureTopMarginMm}mm;">
      <div class="sign-block">
        <div class="sign-row coach">
          <div class="sign-left-spacer"></div>
          <div class="sign-label-wrap">직무지도원:</div>
          <span class="sign-name">${sigs.coach?.name??""}</span>
          <div class="sign-slot">${sigImg(sigs.coach?.imageUrl)}(서명 또는 인)</div>
        </div>
        <div class="sign-gap"></div>
        <div class="sign-row agency">
          <div class="sign-left-spacer"></div>
          <div class="sign-label-wrap">(위탁기관) 담당자:</div>
          <span class="sign-name">${sigs.agencyAgent?.name??""}</span>
          <div class="sign-slot">${sigImg(sigs.agencyAgent?.imageUrl)}(서명 또는 인)</div>
        </div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}
