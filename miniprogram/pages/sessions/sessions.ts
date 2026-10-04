import {BRAND_BACKGROUND, Match, request, loggedIn, errorMessage, goLogin, decorateMatch} from '../../services/api';
Page({
 data:{background:BRAND_BACKGROUND,rows:[] as Match[],hasLogin:false,loading:false,busy:false,error:''},
 onShow(){this.load()},
 onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())},
 async load(){
  this.setData({loading:true,error:'',hasLogin:loggedIn()});
  try{const rows=await request<Match[]>(loggedIn()?'/my-sessions':'/sessions');this.setData({rows:rows.map(decorateMatch)})}
  catch(e){this.setData({error:errorMessage(e)})}
  finally{this.setData({loading:false,hasLogin:loggedIn()})}
 },
 login:goLogin,
 async change(e:WechatMiniprogram.TouchEvent){
  if(this.data.busy)return;
  if(!loggedIn()){goLogin();return}
  const {id,action}=e.currentTarget.dataset;
  if(action==='leave'){
   const answer=await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>(resolve=>wx.showModal({title:'退出比赛',content:'确认退出本场比赛？报名中可重新加入。',success:resolve}));
   if(!answer.confirm)return;
  }
  this.setData({busy:true,error:''});
  try{await request('/sessions/'+id+'/'+action,'POST',{});await this.load();wx.showToast({title:action==='join'?'已加入比赛':'已退出比赛',icon:'success'})}
  catch(e){this.setData({error:errorMessage(e)});const rows=await request<Match[]>(loggedIn()?'/my-sessions':'/sessions').catch(()=>null);if(rows)this.setData({rows:rows.map(decorateMatch)})}
  finally{this.setData({busy:false,hasLogin:loggedIn()})}
 }
});
