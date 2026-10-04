import {REWARDS_BACKGROUND,Reward,request,loggedIn,decorateReward,errorMessage,goLogin} from '../../services/api';
Page({data:{background:REWARDS_BACKGROUND,tab:'pending',all:[] as Reward[],rows:[] as Reward[],hasLogin:false,error:'',loading:false},onShow(){this.load()},onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())},
 async load(){this.setData({error:'',hasLogin:loggedIn(),loading:true,all:[],rows:[]});if(!loggedIn()){this.setData({loading:false});return}try{const all=(await request<Reward[]>('/rewards')).map(decorateReward);this.setData({all});this.filter()}catch(e){this.setData({error:errorMessage(e),hasLogin:loggedIn()})}finally{this.setData({loading:false})}},
 filter(){this.setData({rows:this.data.all.filter(r=>this.data.tab==='inactive'?['cancelled','expired'].includes(r.status):r.status===this.data.tab)})},
 changeTab(e:WechatMiniprogram.TouchEvent){this.setData({tab:e.currentTarget.dataset.tab});this.filter()},login:goLogin,
 openReward(e:WechatMiniprogram.TouchEvent){wx.navigateTo({url:'/pages/reward-detail/reward-detail?id='+e.currentTarget.dataset.id})}
});
