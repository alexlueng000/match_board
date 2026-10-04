import {BRAND_BACKGROUND,login,errorMessage} from '../../services/api';
Page({data:{background:BRAND_BACKGROUND,nickname:'',busy:false,error:'',agreed:false},nicknameInput(e:WechatMiniprogram.Input){this.setData({nickname:e.detail.value})},toggleAgree(){this.setData({agreed:!this.data.agreed})},
 async submit(){if(this.data.busy)return;if(!this.data.agreed){this.setData({error:'请先确认登录说明'});return}this.setData({busy:true,error:''});try{await login(this.data.nickname);wx.switchTab({url:'/pages/index/index'})}catch(e){this.setData({error:errorMessage(e)})}finally{this.setData({busy:false})}}
});
