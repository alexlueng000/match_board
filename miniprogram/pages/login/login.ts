import {BRAND_BACKGROUND,registerMember,login,request,Member,loggedIn,errorMessage} from '../../services/api';

Page({
 data:{background:BRAND_BACKGROUND,nickname:'',avatarPath:'',busy:false,error:'',agreed:false},
 onLoad(){
  if(loggedIn())request<Member>('/me').then(user=>{
   if(user.profile_complete)wx.switchTab({url:'/pages/index/index'});
   else this.setData({nickname:user.nickname});
  }).catch(error=>this.setData({error:errorMessage(error)}));
 },
 nicknameInput(e:WechatMiniprogram.Input){this.setData({nickname:e.detail.value})},
 chooseAvatar(e:WechatMiniprogram.CustomEvent<{avatarUrl:string}>){
  if(!this.data.busy)this.setData({avatarPath:e.detail.avatarUrl,error:''});
 },
 toggleAgree(){if(!this.data.busy)this.setData({agreed:!this.data.agreed,error:''})},
 openPrivacy(){wx.navigateTo({url:'/pages/privacy/privacy'})},
 async submit(){
  if(this.data.busy)return;
  if(!this.data.agreed){this.setData({error:'请先阅读并同意会员资料说明'});return}
  const nickname=this.data.nickname.trim();
  if(!nickname){this.setData({error:'请填写昵称'});return}
  if(!this.data.avatarPath){this.setData({error:'请点击头像按钮选择头像'});return}
  this.setData({busy:true,error:''});
  try{await registerMember(nickname,this.data.avatarPath);wx.switchTab({url:'/pages/index/index'})}
  catch(error){this.setData({error:errorMessage(error)})}
  finally{this.setData({busy:false})}
 },
 async existingLogin(){
  if(this.data.busy)return;
  if(!this.data.agreed){this.setData({error:'请先阅读并同意会员资料说明'});return}
  this.setData({busy:true,error:''});
  try{
   await login('');
   const user=await request<Member>('/me');
   if(user.profile_complete)wx.switchTab({url:'/pages/index/index'});
   else this.setData({nickname:user.nickname,error:'请选择头像并确认昵称，完成会员资料'});
  }catch(error){this.setData({error:errorMessage(error)})}
  finally{this.setData({busy:false})}
 }
});
