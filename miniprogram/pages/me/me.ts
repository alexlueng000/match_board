import {BRAND_BACKGROUND,Member,request,loggedIn,errorMessage,goLogin} from '../../services/api';
Page({data:{background:BRAND_BACKGROUND,user:null as Member|null,nickname:'',error:'',busy:false},onShow(){this.load()},onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())},
 async load(){this.setData({user:null,error:''});if(!loggedIn())return;try{const user=await request<Member>('/me');this.setData({user,nickname:user.nickname})}catch(e){this.setData({error:errorMessage(e)})}},nicknameInput(e:WechatMiniprogram.Input){this.setData({nickname:e.detail.value})},
 async save(){if(this.data.busy)return;this.setData({busy:true,error:''});try{await request('/profile','POST',{nickname:this.data.nickname});await this.load();wx.showToast({title:'昵称已更新',icon:'success'})}catch(e){this.setData({error:errorMessage(e)})}finally{this.setData({busy:false})}},login:goLogin,
 logout(){wx.showModal({title:'退出登录',content:'下次可通过微信重新登录，积分和奖励会保留。',success:r=>{if(r.confirm){wx.removeStorageSync('player_token');this.setData({user:null})}}})}
});
