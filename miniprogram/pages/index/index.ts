import {BRAND_BACKGROUND,Member,Rank,Reward,Board,request,loggedIn,decorateReward,errorMessage,goLogin,avatarSource} from '../../services/api';
Page({data:{background:BRAND_BACKGROUND,user:null as Member|null,avatarUrl:'',ranks:[] as Rank[],rewards:[] as Reward[],error:'',loading:false,hasLogin:false},
 onShow(){this.load()},onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())},
 async load(){this.setData({loading:true,error:'',hasLogin:loggedIn(),user:null,rewards:[]});try{
 const board=await request<Board>('/rankings');this.setData({ranks:board.rows.slice(0,5)});
 if(loggedIn()){const [user,rewards]=await Promise.all([request<Member>('/me'),request<Reward[]>('/rewards')]);this.setData({user,avatarUrl:avatarSource(user.avatar_url),rewards:rewards.filter(r=>r.status==='pending').slice(0,3).map(decorateReward)})}
 }catch(e){this.setData({error:errorMessage(e)})}finally{this.setData({loading:false,hasLogin:loggedIn()})}},
 login:goLogin,goRanking(){wx.switchTab({url:'/pages/ranking/ranking'})},goRewards(){wx.switchTab({url:'/pages/rewards/rewards'})},
 openReward(e:WechatMiniprogram.TouchEvent){wx.navigateTo({url:'/pages/reward-detail/reward-detail?id='+e.currentTarget.dataset.id})}
});
