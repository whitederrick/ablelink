"use client";
// app/admin/signature/page.tsx
// 에이전시 관리자 서명 등록 — (위탁기관/공단) 담당자 서명 자동 삽입용

import { useEffect, useRef, useState } from "react";

export default function AdminSignaturePage() {
  const [savedUrl,    setSavedUrl]    = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [mode,    setMode]    = useState<"view"|"draw">("view");
  const [drawing, setDrawing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos   = useRef<{x:number;y:number}|null>(null);

  useEffect(() => {
    fetch("/api/admin/signature").then(r=>r.json()).then(d=>{
      if(d.success){ setSavedUrl(d.signatureUrl); setDisplayName(d.displayName); }
    });
  },[]);

  useEffect(()=>{
    if(mode!=="draw") return;
    const c=canvasRef.current; if(!c) return;
    const dpr=window.devicePixelRatio||1, w=c.offsetWidth, h=c.offsetHeight;
    c.width=w*dpr; c.height=h*dpr;
    const ctx=c.getContext("2d")!; ctx.scale(dpr,dpr);
    ctx.fillStyle="#fff"; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle="#111827"; ctx.lineWidth=2.5; ctx.lineCap="round"; ctx.lineJoin="round";
  },[mode]);

  function pos(e:React.MouseEvent|React.TouchEvent,c:HTMLCanvasElement){
    const r=c.getBoundingClientRect();
    if("touches" in e) return{x:e.touches[0].clientX-r.left,y:e.touches[0].clientY-r.top};
    return{x:(e as React.MouseEvent).clientX-r.left,y:(e as React.MouseEvent).clientY-r.top};
  }
  function onStart(e:React.MouseEvent|React.TouchEvent){ e.preventDefault(); setDrawing(true); lastPos.current=pos(e,canvasRef.current!); }
  function onMove(e:React.MouseEvent|React.TouchEvent){
    e.preventDefault(); if(!drawing) return;
    const c=canvasRef.current!, ctx=c.getContext("2d")!, p=pos(e,c);
    if(lastPos.current){ ctx.beginPath(); ctx.moveTo(lastPos.current.x,lastPos.current.y); ctx.lineTo(p.x,p.y); ctx.stroke(); }
    lastPos.current=p;
  }
  function onEnd(){ setDrawing(false); lastPos.current=null; }
  function clear(){
    const c=canvasRef.current!, ctx=c.getContext("2d")!;
    ctx.fillStyle="#fff"; ctx.fillRect(0,0,c.offsetWidth,c.offsetHeight);
  }

  async function save(){
    const c=canvasRef.current!; setSaving(true);
    c.toBlob(async blob=>{
      if(!blob){ setSaving(false); return; }
      const fd=new FormData(); fd.append("signature",blob,"sig.png");
      const d=await fetch("/api/admin/signature",{method:"POST",body:fd}).then(r=>r.json());
      setSaving(false);
      if(d.success){ setSavedUrl(d.signatureUrl); setMode("view"); flash("서명이 저장되었습니다."); }
      else flash(d.message||"저장 실패");
    },"image/png");
  }

  async function del(){
    if(!confirm("서명을 삭제하시겠습니까?")) return;
    await fetch("/api/admin/signature",{method:"DELETE"});
    setSavedUrl(null); flash("삭제되었습니다.");
  }

  function flash(msg:string){ setToast(msg); setTimeout(()=>setToast(""),3000); }

  return (
    <div>
      <div style={{marginBottom:24}}>
        <h1 style={{margin:0,fontSize:18,fontWeight:700,color:"#111827"}}>내 서명 관리</h1>
        <p style={{margin:"4px 0 0",fontSize:13,color:"#9ca3af"}}>
          {displayName&&`${displayName}님 · `}등록 서명은 문서의 <strong>(위탁기관/공단) 담당자</strong> 서명란에 자동 삽입됩니다.
        </p>
      </div>

      {/* 현재 서명 */}
      <div style={card}>
        <p style={sectionTitle}>등록된 서명</p>
        {mode==="view" && (savedUrl ? (
          <>
            <div style={previewBox}>
              <img src={savedUrl} alt="서명" style={{maxHeight:100,maxWidth:"100%",objectFit:"contain"}}/>
            </div>
            <div style={{display:"flex",gap:10,marginTop:14}}>
              <button onClick={()=>setMode("draw")} style={btnPrimary}>다시 등록</button>
              <button onClick={del} style={btnDanger}>삭제</button>
            </div>
          </>
        ):(
          <div style={{textAlign:"center",padding:"28px 0"}}>
            <p style={{fontSize:40,margin:"0 0 10px"}}>✍️</p>
            <p style={{color:"#9ca3af",fontSize:14,marginBottom:18}}>등록된 서명이 없습니다.</p>
            <button onClick={()=>setMode("draw")} style={btnPrimary}>서명 등록하기</button>
          </div>
        ))}

        {mode==="draw" && (
          <>
            <div style={canvasWrap}>
              <canvas ref={canvasRef} style={canvasStyle}
                onMouseDown={onStart} onMouseMove={onMove} onMouseUp={onEnd} onMouseLeave={onEnd}
                onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}/>
              <p style={hint}>마우스 또는 터치로 서명하세요</p>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={clear} style={btnSecondary}>지우기</button>
              <button onClick={save} disabled={saving} style={{...btnPrimary,opacity:saving?0.7:1}}>
                {saving?"저장 중...":"저장"}
              </button>
              <button onClick={()=>setMode("view")} style={btnSecondary}>취소</button>
            </div>
          </>
        )}
      </div>

      {/* 안내 */}
      <div style={{...card,marginTop:12}}>
        <p style={sectionTitle}>서명 사용 안내</p>
        <ul style={{margin:0,padding:"0 0 0 18px",fontSize:13,color:"#6b7280",lineHeight:2.0}}>
          <li><strong>(위탁기관/공단) 담당자</strong> → 현재 로그인한 에이전시 관리자 서명 자동 삽입</li>
          <li><strong>직무지도원</strong> → 직무지도원이 앱에서 등록한 서명 자동 삽입</li>
          <li><strong>사업체 담당자</strong> → 문서 생성 화면에서 QR코드/링크로 현장 즉석 서명</li>
        </ul>
      </div>

      {toast && (
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#111827",color:"#fff",padding:"11px 20px",borderRadius:10,fontSize:14,fontWeight:600,zIndex:2000}}>
          {toast}
        </div>
      )}
    </div>
  );
}

const card:React.CSSProperties         = {background:"#fff",border:"1px solid #f0f0f0",borderRadius:12,padding:"18px 20px"};
const sectionTitle:React.CSSProperties = {fontSize:14,fontWeight:700,color:"#111827",margin:"0 0 12px"};
const previewBox:React.CSSProperties   = {backgroundColor:"#f9fafb",borderRadius:12,padding:20,border:"2px dashed #e5e7eb",minHeight:120,display:"flex",alignItems:"center",justifyContent:"center"};
const canvasWrap:React.CSSProperties   = {position:"relative",backgroundColor:"#fff",borderRadius:12,border:"1.5px solid #e5e7eb",overflow:"hidden",marginBottom:12};
const canvasStyle:React.CSSProperties  = {display:"block",width:"100%",height:180,touchAction:"none",cursor:"crosshair"};
const hint:React.CSSProperties         = {position:"absolute",bottom:8,right:12,fontSize:11,color:"#d1d5db",margin:0,pointerEvents:"none"};
const btnPrimary:React.CSSProperties   = {padding:"9px 18px",background:"#111827",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"};
const btnSecondary:React.CSSProperties = {padding:"9px 14px",background:"#fff",color:"#374151",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,cursor:"pointer"};
const btnDanger:React.CSSProperties    = {padding:"9px 14px",background:"#fff",color:"#dc2626",border:"1px solid #fecaca",borderRadius:8,fontSize:13,cursor:"pointer"};
