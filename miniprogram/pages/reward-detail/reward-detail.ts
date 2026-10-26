import {REWARDS_BACKGROUND,Reward,request,decorateReward,errorMessage,goLogin,loggedIn} from '../../services/api';
Page({data:{background:REWARDS_BACKGROUND,qrSize:Math.min(280,wx.getSystemInfoSync().windowWidth-64),id:0,reward:null as Reward|null,error:'',hasLogin:loggedIn()},onLoad(options:{id?:string}){this.setData({id:Number(options.id)||0})},onShow(){this.load()},onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())},
 async load(){this.setData({error:'',hasLogin:loggedIn(),reward:null});if(!loggedIn())return;try{const reward=decorateReward(await request<Reward>('/rewards/'+this.data.id));this.setData({reward,error:reward.status==='pending'&&!reward.qr_matrix?'二维码暂不可用，请刷新重试或联系店员':''},()=>this.drawQr())}catch(e){this.setData({error:errorMessage(e),hasLogin:loggedIn()})}},
 drawQr(){
  const reward=this.data.reward;
  if(!reward||!reward.qr_matrix)return;
  const matrix=reward.qr_matrix;
  const context=wx.createCanvasContext('ticket-qr',this);
  const size=this.data.qrSize,cell=Math.floor(size/matrix.length),offset=Math.floor((size-cell*matrix.length)/2);
  context.setFillStyle('#ffffff');context.fillRect(0,0,size,size);
  context.setFillStyle('#000000');
  matrix.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)context.fillRect(offset+x*cell,offset+y*cell,cell,cell)}));
  context.draw();
 },login:goLogin
});
