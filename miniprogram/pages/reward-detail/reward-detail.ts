import {REWARDS_BACKGROUND,Reward,request,decorateReward,errorMessage,goLogin,loggedIn} from '../../services/api';
Page({data:{background:REWARDS_BACKGROUND,id:0,reward:null as Reward|null,error:'',hasLogin:loggedIn()},onLoad(options:{id?:string}){this.setData({id:Number(options.id)||0})},onShow(){this.load()},onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())},
 async load(){this.setData({error:'',hasLogin:loggedIn(),reward:null});if(!loggedIn())return;try{const reward=decorateReward(await request<Reward>('/rewards/'+this.data.id));this.setData({reward})}catch(e){this.setData({error:errorMessage(e),hasLogin:loggedIn()})}},login:goLogin
});
