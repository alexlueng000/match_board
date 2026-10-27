"use client";
import {useRef, useState} from "react";
type Member = {id:number; nickname:string; member_code:string; is_admin?:boolean; has_wechat?:boolean};
export default function MemberAdminAccess({member,disabled,api,onSaved}: {
 member:Member; disabled:boolean; api:(path:string,body?:Record<string,any>)=>Promise<any>; onSaved:()=>Promise<void>;
}) {
 const [confirming,setConfirming]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const submitting=useRef(false);
 async function save(){
  if(submitting.current)return;
  submitting.current=true;setBusy(true);setError("");setNotice("");
  try{
   await api(`/users/${member.id}/admin`,{enabled:!member.is_admin});
   setConfirming(false);setNotice(member.is_admin?"管理员权限已取消":"已设为管理员，微信登录后即可扫码核销");
   try{await onSaved()}catch{setError("权限已更新，资料刷新失败，请重新打开玩家详情查看")}
  }catch(e){setError((e as Error).message)}finally{submitting.current=false;setBusy(false)}
 }
 return <section className="card" aria-label="微信管理员权限">
  <h3>微信管理员权限</h3><p>{member.is_admin?"管理员":"普通会员"} · {member.member_code}</p>
  {!member.has_wechat&&<p className="muted">该玩家尚未微信登录，暂不能授予微信管理员权限。</p>}
  {confirming?<div>
   <p>确认{member.is_admin?"取消":"授予"} {member.nickname}（{member.member_code}）的管理员权限？</p>
   <p className="muted">{member.is_admin?"取消后，该微信身份将无法继续管理或核销。":"管理员拥有完整管理权限，可管理玩家、赛事、积分和奖品，并在小程序直接扫码核销。"}</p>
   <button type="button" className="secondary" disabled={busy||disabled} onClick={()=>setConfirming(false)}>取消</button>{" "}
   <button type="button" disabled={busy||disabled} onClick={save}>{member.is_admin?"确认取消管理员":"确认设为管理员"}</button>
  </div>:<button type="button" disabled={disabled||busy||(!member.has_wechat&&!member.is_admin)} onClick={()=>{setConfirming(true);setError("");setNotice("")}}>{member.is_admin?"取消管理员":"设为管理员"}</button>}
  {notice&&<p role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
 </section>;
}
