import {BRAND_BACKGROUND,request,loggedIn,goLogin,errorMessage,RequestError} from '../../services/api';
interface Ticket {code:string;name:string;points:number;stock:number|null}
interface Order {request_id:string;reward_id:number;reward_name:string;points:number;status:string;created_at:string;refunded_at:string|null;dateLabel?:string}
interface Pending {request_id:string;prize_code:string;expected_points:number}
interface Catalog {available_points:number;spent_points:number;earned_points:number;member_code:string;items:Ticket[];history:Order[]}
Page({
 data:{background:BRAND_BACKGROUND,hasLogin:false,available:0,spent:0,items:[] as Ticket[],history:[] as Order[],memberCode:'',selected:null as Ticket|null,pending:null as Pending|null,error:'',notice:'',loading:false,busy:false},
 submitting:false,
 onShow(){this.load()},
 onPullDownRefresh(){if(this.submitting){wx.stopPullDownRefresh();return}this.load().finally(()=>wx.stopPullDownRefresh())},
 async load(){
  this.setData({hasLogin:loggedIn(),loading:true,error:''});
  if(!loggedIn()){this.setData({loading:false,memberCode:'',items:[],history:[],selected:null,pending:null,available:0,spent:0});return}
  try{
   const data=await request<Catalog>('/exchange');
   const key='exchange_pending_'+data.member_code;
   let pending=(wx.getStorageSync(key)||null) as Pending|null;
   if(pending&&data.history.some(row=>row.request_id===pending!.request_id)){wx.removeStorageSync(key);pending=null}
   this.setData({available:data.available_points,spent:data.spent_points,memberCode:data.member_code,items:data.items,history:data.history.map(row=>({...row,dateLabel:row.created_at.replace('T',' ').slice(0,16)})),pending});
  }catch(e){this.setData({error:errorMessage(e),hasLogin:loggedIn()})}
  finally{this.setData({loading:false})}
 },
 choose(e:WechatMiniprogram.TouchEvent){
  if(this.data.busy)return;
  if(this.data.pending){this.setData({error:'上一笔兑换结果待确认，请先点击“确认上一笔兑换结果”'});return}
  const ticket=this.data.items.find(row=>row.code===e.currentTarget.dataset.code);
  if(!ticket||ticket.stock===0||ticket.points>this.data.available)return;
  this.setData({selected:ticket,error:'',notice:''});
 },
 close(){if(!this.data.busy)this.setData({selected:null})},
 stopTap(){},
 async confirm(){
  if(this.submitting||!this.data.memberCode)return;
  const ticket=this.data.selected;
  let pending=this.data.pending;
  if(!pending){
   if(!ticket)return;
   pending={request_id:'exchange-'+Date.now()+'-'+Math.random().toString(36).slice(2,14),prize_code:ticket.code,expected_points:ticket.points};
  }
  const key='exchange_pending_'+this.data.memberCode;
  this.submitting=true;
  this.setData({busy:true,error:'',notice:'',pending});
  try{
   // Keep the request ID across network failures and app restarts.
   wx.setStorageSync(key,pending);
   await request<{reward_id:number}>('/exchange','POST',pending);
   wx.removeStorageSync(key);
   this.setData({selected:null,pending:null,notice:'兑换成功，门票已放入待使用奖励'});
   await this.load();
  }catch(e){
   if(e instanceof RequestError&&[401,403,404,409,422].includes(e.statusCode)){wx.removeStorageSync(key);this.setData({pending:null})}
   this.setData({selected:null,error:errorMessage(e)});
  }
  finally{this.submitting=false;this.setData({busy:false})}
 },
 login:goLogin,
 goRewards(){wx.switchTab({url:'/pages/rewards/rewards'})}
});
