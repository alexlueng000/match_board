import {BRAND_BACKGROUND,Board,Rank,Member,request,loggedIn,errorMessage,avatarSource} from '../../services/api';
Page({data:{background:BRAND_BACKGROUND,scope:'monthly',month:'',rows:[] as Rank[],podium:[] as Rank[],user:null as Member|null,error:'',loading:false},onShow(){this.load()},onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())},
 async load(){this.setData({error:'',loading:true,user:null});try{const board=await request<Board>('/rankings?scope='+this.data.scope);const ranked=board.rows.map(row=>({...row,avatarUrl:avatarSource(row.avatar_url)}));const top=ranked.slice(0,3);const podium=top.length===3?[top[1],top[0],top[2]]:top;this.setData({month:board.current_month,rows:ranked.slice(3),podium});if(loggedIn())this.setData({user:await request<Member>('/me')})}catch(e){this.setData({error:errorMessage(e)})}finally{this.setData({loading:false})}},
 changeScope(e:WechatMiniprogram.TouchEvent){this.setData({scope:e.currentTarget.dataset.scope});this.load()}
});
