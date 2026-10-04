import {BRAND_BACKGROUND,Match,decorateMatch,Member,Rank,Reward,Board,request,loggedIn,decorateReward,errorMessage,goLogin} from '../../services/api';
Page({data:{background:BRAND_BACKGROUND,user:null as Member|null,sessions:[] as Match[],ranks:[] as Rank[],rewards:[] as Reward[],error:'',loading:false,hasLogin:false},
 onShow(){this.load()},onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())},
 async load(){this.setData({loading:true,error:'',hasLogin:loggedIn(),user:null,rewards:[]});try{
 const [board,sessions]=await Promise.all([request<Board>('/rankings'),request<Match[]>('/sessions')]);this.setData({sessions:sessions.slice(0,3).map(decorateMatch)});this.setData({ranks:board.rows.slice(0,5)});
 if(loggedIn()){const [user,rewards]=await Promise.all([request<Member>('/me'),request<Reward[]>('/rewards')]);this.setData({user,rewards:rewards.filter(r=>r.status==='pending').slice(0,3).map(decorateReward)})}
 }catch(e){this.setData({error:errorMessage(e)})}finally{this.setData({loading:false,hasLogin:loggedIn()})}},
 goSessions(){wx.navigateTo({url:'/pages/sessions/sessions'})},
 login:goLogin,goRanking(){wx.switchTab({url:'/pages/ranking/ranking'})},goRewards(){wx.switchTab({url:'/pages/rewards/rewards'})},
 openReward(e:WechatMiniprogram.TouchEvent){wx.navigateTo({url:'/pages/reward-detail/reward-detail?id='+e.currentTarget.dataset.id})}
});
