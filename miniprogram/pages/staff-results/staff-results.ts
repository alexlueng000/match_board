import {staffRequest,staffLoggedIn,loggedIn,errorMessage,RequestError} from '../../services/api';

interface Player {id:number;nickname:string;member_code:string}
interface Match {id:number;name:string;type:'regular'|'gto';starts_at:string;status:string;competition_id:number|null}
interface Roster extends Match {roster:{user_id:number;nickname:string;member_code:string;status:string}[]}
interface PrizeConfig {prizes:{code:string;name:string}[];rules:{key:string;prize_code:string;quantity:number}[]}
interface Place {key:string;label:string;player:Player|null}
interface Payload {request_id:string;type:'regular'|'gto';date:string;champion:number;second:number;third:number;pool27:number|null;champion_reward?:'tickets'|'gift';session_id?:number}
interface Pending {body:Payload;summary:string}
const pendingKey='staff_competition_pending';
const emptyPlaces=():Place[]=>[
 {key:'champion',label:'冠军 · 第1名',player:null},
 {key:'second',label:'亚军 · 第2名',player:null},
 {key:'third',label:'季军 · 第3名',player:null},
 {key:'pool27',label:'27收池（选填）',player:null}
];
function today(){return new Date(Date.now()+8*3600000).toISOString().slice(0,10)}
Page({
 data:{date:today(),typeIndex:0,typeLabels:['常规赛','GTO 赛事'],sessionIndex:0,sessionLabels:['独立赛事 / 历史补录'],
  sessions:[] as Match[],players:[] as Player[],eligible:[] as Player[],places:emptyPlaces(),
  rewardIndex:0,rewardLabels:['冠军方案 A','冠军方案 B'],editing:'',search:'',filtered:[] as Player[],
  pending:null as Pending|null,loading:false,busy:false,error:'',notice:'',ready:false},
 submitting:false,
 onShow(){if(!this.data.busy)this.load()},
 async load(){
  if(!staffLoggedIn()&&!loggedIn()){wx.redirectTo({url:'/pages/staff/staff'});return}
  this.setData({loading:true,ready:false,error:'',pending:wx.getStorageSync(pendingKey)||null});
  try{
   const [players,sessions,config]=await Promise.all([
    staffRequest<Player[]>('/users'),staffRequest<Match[]>('/sessions?day='+this.data.date),staffRequest<PrizeConfig>('/prize-settings')
   ]);
   const running=sessions.filter(row=>row.status==='running'&&!row.competition_id);
   const rewardLabels=['tickets','gift'].map((mode,index)=>{
    const rule=config.rules.find(row=>row.key==='gto_champion_'+mode);
    const prize=config.prizes.find(row=>row.code===(rule?rule.prize_code:undefined));
    return rule&&prize?prize.name+' × '+rule.quantity:'冠军方案 '+(index===0?'A':'B');
   });
   this.setData({players,eligible:players,sessions:running,sessionIndex:0,places:emptyPlaces(),typeIndex:0,rewardIndex:0,
    sessionLabels:['独立赛事 / 历史补录',...running.map(row=>row.name+' · '+row.starts_at.slice(11,16))],rewardLabels,ready:true});
  }catch(error){this.setData({error:errorMessage(error)});if(error instanceof RequestError&&(error.statusCode===401||error.statusCode===403))wx.redirectTo({url:'/pages/staff/staff'})}
  finally{this.setData({loading:false})}
 },
 async dateChange(e:WechatMiniprogram.CustomEvent<{value:string}>){
  if(this.data.busy||this.data.pending||this.data.loading)return;
  this.setData({date:e.detail.value,places:emptyPlaces(),notice:''});await this.load();
 },
 async sessionChange(e:WechatMiniprogram.CustomEvent<{value:string}>){
  if(this.data.busy||this.data.pending||this.data.loading)return;
  const index=Number(e.detail.value);
  this.setData({sessionIndex:index,places:emptyPlaces(),error:'',notice:'',ready:false,loading:true});
  try{
   if(!index){this.setData({eligible:this.data.players,ready:true});return}
   const match=await staffRequest<Roster>('/sessions/'+this.data.sessions[index-1].id);
   if(match.status!=='running'||match.competition_id)throw Error('本场已结束，请刷新后选择其他场次');
   this.setData({typeIndex:match.type==='gto'?1:0,date:match.starts_at.slice(0,10),
    eligible:match.roster.filter(row=>row.status==='checked_in').map(row=>({id:row.user_id,nickname:row.nickname,member_code:row.member_code})),ready:true});
  }catch(error){this.setData({error:errorMessage(error)})}
  finally{this.setData({loading:false})}
 },
 typeChange(e:WechatMiniprogram.CustomEvent<{value:string}>){if(!this.data.busy&&!this.data.pending&&!this.data.sessionIndex)this.setData({typeIndex:Number(e.detail.value),notice:''})},
 rewardChange(e:WechatMiniprogram.CustomEvent<{value:string}>){if(!this.data.busy&&!this.data.pending)this.setData({rewardIndex:Number(e.detail.value)})},
 choose(e:WechatMiniprogram.TouchEvent){
  if(this.data.busy||this.data.pending||!this.data.ready)return;
  this.setData({editing:e.currentTarget.dataset.key,search:'',filtered:this.data.eligible.slice(0,80)});
 },
 searchInput(e:WechatMiniprogram.Input){
  const query=e.detail.value.trim().toLowerCase();
  this.setData({search:e.detail.value,filtered:this.data.eligible.filter(row=>(row.nickname+' '+row.member_code).toLowerCase().includes(query)).slice(0,80)});
 },
 select(e:WechatMiniprogram.TouchEvent){
  const player=this.data.eligible.find(row=>row.id===Number(e.currentTarget.dataset.id))||null;
  this.setData({places:this.data.places.map(row=>row.key===this.data.editing?{...row,player}:row),editing:'',error:'',notice:''});
 },
 close(){this.setData({editing:''})},stopTap(){},
 async confirm(){
  if(this.data.busy||this.data.loading||!this.data.ready||this.data.pending)return;
  const places=this.data.places;
  if(places.slice(0,3).some(row=>!row.player)){this.setData({error:'请选择冠军、亚军和季军'});return}
  if(new Set(places.slice(0,3).map(row=>row.player!.id)).size!==3){this.setData({error:'前三名必须是不同玩家'});return}
  const body:Payload={request_id:'mini-result-'+Date.now()+'-'+Math.random().toString(36).slice(2,14),
   type:this.data.typeIndex===1?'gto':'regular',date:this.data.date,
   champion:places[0].player!.id,second:places[1].player!.id,third:places[2].player!.id,pool27:places[3].player?places[3].player.id:null};
  if(body.type==='gto')body.champion_reward=this.data.rewardIndex===0?'tickets':'gift';
  if(this.data.sessionIndex)body.session_id=this.data.sessions[this.data.sessionIndex-1].id;
  const summary=[this.data.sessionLabels[this.data.sessionIndex],body.date+' · '+this.data.typeLabels[this.data.typeIndex],
   ...places.filter(row=>row.player).map(row=>row.label+'：'+row.player!.nickname+' · '+row.player!.member_code),
   ...(body.type==='gto'?['冠军奖励：'+this.data.rewardLabels[this.data.rewardIndex]]:[])].join('\n');
  this.setData({busy:true,error:'',notice:''});
  try{
   const result=await wx.showModal({title:'确认名次并发放奖励',content:summary+'\n提交后立即发放积分和奖励。'+(body.session_id?'本场比赛将结束。':''),confirmText:'确认提交'});
   if(result.confirm)await this.send({body,summary});
  }catch(error){this.setData({error:errorMessage(error)})}
  finally{this.setData({busy:false})}
 },
 async retry(){if(this.data.pending&&!this.data.busy)await this.send(this.data.pending)},
 async send(pending:Pending){
  if(this.submitting)return;
  this.submitting=true;this.setData({busy:true,error:'',notice:''});
  try{
   // Reuse the exact payload after a lost response, including across app restarts.
   wx.setStorageSync(pendingKey,pending);this.setData({pending});
   const result=await staffRequest<{id:number}>('/competitions','POST',pending.body);
   wx.removeStorageSync(pendingKey);
   this.setData({pending:null,places:emptyPlaces(),notice:'赛事 #'+result.id+' 已记录，积分与奖励已发放'});
   await this.load();
  }catch(error){
   if(error instanceof RequestError&&[400,403,404,409,422].includes(error.statusCode)){
    wx.removeStorageSync(pendingKey);this.setData({pending:null});
   }
   this.setData({error:errorMessage(error)});
   if(error instanceof RequestError&&(error.statusCode===401||error.statusCode===403))wx.redirectTo({url:'/pages/staff/staff'});
  }finally{this.submitting=false;this.setData({busy:false})}
 }
});
