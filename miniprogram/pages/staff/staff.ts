import {staffRequest,staffLoggedIn,Reward,decorateReward,errorMessage,RequestError} from '../../services/api';
interface StaffReward extends Reward {nickname:string;member_code:string}
Page({
 data:{authenticated:false,username:'',password:'',busy:false,error:'',notice:'',reward:null as StaffReward|null},
 onShow(){if(!this.data.busy)this.checkAccess()},
 async checkAccess(){
  this.setData({busy:true,error:'',reward:null});
  try{
   for(let attempt=0;attempt<2;attempt++){
    const hadStaffToken=staffLoggedIn();
    try{
     await staffRequest('/mini/staff/me');this.setData({authenticated:true});return;
    }catch(error){
     if(attempt===0&&hadStaffToken&&!staffLoggedIn())continue;
     this.setData({authenticated:false,error:error instanceof RequestError&&(error.statusCode===401||error.statusCode===403)?'':errorMessage(error)});return;
    }
   }
  }finally{this.setData({busy:false})}
 },
 usernameInput(e:WechatMiniprogram.Input){this.setData({username:e.detail.value})},
 passwordInput(e:WechatMiniprogram.Input){this.setData({password:e.detail.value})},
 async login(){
  if(this.data.busy)return;
  if(!this.data.username.trim()||!this.data.password){this.setData({error:'请输入店员账号和密码'});return}
  this.setData({busy:true,error:'',notice:'',reward:null});
  try{
   const result=await staffRequest<{access_token:string}>('/auth/login','POST',{username:this.data.username.trim(),password:this.data.password});
   wx.setStorageSync('staff_token',result.access_token);this.setData({authenticated:true,password:''});
  }catch(error){this.setData({error:errorMessage(error)})}
  finally{this.setData({busy:false})}
 },
 scan(){
  if(this.data.busy)return;
  this.setData({busy:true,reward:null,error:'',notice:''});
  wx.scanCode({onlyFromCamera:true,scanType:['qrCode'],success:result=>{this.lookup(result.result)},fail:error=>{
   this.setData({busy:false,error:error.errMsg.includes('cancel')?'':'扫码失败，请允许使用摄像头后重试'});
  }});
 },
 async lookup(value:string){
  this.setData({reward:null});
  const match=/^NUTS:TICKET:([A-F0-9]{10})$/.exec(value);
  if(!match){this.setData({busy:false,error:'不是本店门票二维码，请扫描用户门票详情中的二维码'});return}
  try{
   const rows=await staffRequest<StaffReward[]>('/rewards?code='+encodeURIComponent(match[1]));
   if(!rows.length)throw new Error('门票不存在，请核对二维码');
   this.setData({reward:{...rows[0],...decorateReward(rows[0])}});
  }catch(error){this.setData({error:errorMessage(error),authenticated:error instanceof RequestError&&(error.statusCode===401||error.statusCode===403)?false:this.data.authenticated})}
  finally{this.setData({busy:false})}
 },
 async redeem(){
  const reward=this.data.reward;
  if(this.data.busy||!reward||reward.status!=='pending')return;
  this.setData({busy:true,error:'',notice:''});
  try{
   await staffRequest('/rewards/'+reward.id+'/redeem','POST',{});
   this.setData({reward:null,notice:'核销成功：'+reward.nickname+' · '+reward.reward_name});
  }catch(error){
   // A failed response may follow a committed request. Require a fresh scan.
   this.setData({reward:null,error:errorMessage(error)+'；请重新扫码确认门票最新状态',authenticated:error instanceof RequestError&&(error.statusCode===401||error.statusCode===403)?false:this.data.authenticated});
  }finally{this.setData({busy:false})}
 },
 goResults(){if(!this.data.busy)wx.navigateTo({url:'/pages/staff-results/staff-results'})},
 logout(){if(this.data.busy)return;wx.removeStorageSync('staff_token');this.setData({authenticated:false,password:'',reward:null,error:'',notice:''})}
});
