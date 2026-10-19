import {loggedIn,Member,request} from './services/api';

App<IAppOption>({
 globalData:{},
 onLaunch(){
  if(!loggedIn()){wx.reLaunch({url:'/pages/login/login'});return}
  request<Member>('/me').then(user=>{
   if(!user.profile_complete)wx.reLaunch({url:'/pages/login/login'});
  }).catch(()=>{
   if(!loggedIn())wx.reLaunch({url:'/pages/login/login'});
  });
 }
});
