import {BRAND_BACKGROUND,Member,request,loggedIn,errorMessage,goLogin,avatarSource,saveAvatar} from '../../services/api';
Page({
 data:{background:BRAND_BACKGROUND,user:null as Member|null,nickname:'',avatarUrl:'',avatarPath:'',error:'',busy:false},
 onShow(){if(!this.data.avatarPath)this.load()},onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())},
 async load(){
  this.setData({user:null,error:''});if(!loggedIn())return;
  try{const user=await request<Member>('/me');this.setData({user,nickname:user.nickname,avatarUrl:avatarSource(user.avatar_url),avatarPath:''})}
  catch(error){this.setData({error:errorMessage(error)})}
 },
 nicknameInput(e:WechatMiniprogram.Input){this.setData({nickname:e.detail.value})},
 chooseAvatar(e:WechatMiniprogram.CustomEvent<{avatarUrl:string}>){
  if(!this.data.busy)this.setData({avatarPath:e.detail.avatarUrl,error:''});
 },
 async save(){
  if(this.data.busy)return;
  const nickname=this.data.nickname.trim();
  if(!nickname){this.setData({error:'请输入昵称'});return}
  this.setData({busy:true,error:''});
  try{
   if(this.data.avatarPath)await saveAvatar(nickname,this.data.avatarPath);
   else await request('/profile','POST',{nickname});
   await this.load();wx.showToast({title:'会员资料已更新',icon:'success'});
  }catch(error){this.setData({error:errorMessage(error)})}
  finally{this.setData({busy:false})}
 },
 login:goLogin,
 logout(){wx.showModal({title:'退出登录',content:'下次可通过微信重新登录，积分和奖励会保留。',success:r=>{
  if(r.confirm){wx.removeStorageSync('player_token');wx.reLaunch({url:'/pages/login/login'})}
 }})}
});
