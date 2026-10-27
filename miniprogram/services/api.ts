const ONLINE_API_BASE = 'https://nuts.fateinsight.site/api';
// Develop builds in WeChat DevTools use the local API; trial/release stay online.
export const API_BASE = wx.getAccountInfoSync().miniProgram.envVersion === 'develop'
 ? 'http://127.0.0.1:8000'
 : ONLINE_API_BASE;
export const BRAND_BACKGROUND = API_BASE + '/assets/mini/brand.png';
export const REWARDS_BACKGROUND = API_BASE + '/assets/mini/rewards.png';
export interface Member {is_admin?:boolean;nickname:string;avatar_url:string|null;profile_complete:boolean;member_code:string;monthly_score:number;total_score:number;monthly_rank:number;total_rank:number;current_month:string;available_points:number;spent_points:number}
export interface Rank {nickname:string;member_code:string;rank:number;score:number;avatar_url?:string|null;avatarUrl?:string}
export interface Board {current_month:string;rows:Rank[]}
export interface Reward {qr_matrix?:boolean[][];id:number;reward_name:string;status:string;issued_at:string;redeemed_at:string|null;redeemedLabel?:string;competition_id:number|null;redeem_code:string|null;source_label?:string;member_code?:string;statusLabel?:string;dateLabel?:string}
export function loggedIn():boolean{return Boolean(wx.getStorageSync('player_token'))}
export class RequestError extends Error {constructor(message:string,public statusCode:number){super(message);this.name='RequestError'}}
export function request<T>(path:string,method:'GET'|'POST'='GET',data?:object):Promise<T>{
 return new Promise((resolve,reject)=>wx.request({url:API_BASE+'/mini'+path,method,data,header:{Authorization:'Bearer '+(wx.getStorageSync('player_token')||'')},success:r=>{
  if(r.statusCode>=200&&r.statusCode<300){resolve(r.data as T);return}
  if(r.statusCode===401)wx.removeStorageSync('player_token');
  const body=r.data as {detail?:string};reject(new RequestError(typeof body.detail==='string'?body.detail:'请求失败，请稍后重试',r.statusCode));
 },fail:()=>reject(new Error('无法连接服务，请检查网络后重试'))}));
}
export function login(nickname:string):Promise<void>{return new Promise((resolve,reject)=>wx.login({success:r=>{
 if(!r.code){reject(new Error('微信登录失败，请重试'));return}
 request<{access_token:string}>('/auth','POST',{code:r.code,nickname,existing_only:true}).then(result=>{wx.setStorageSync('player_token',result.access_token);resolve()},reject);
},fail:()=>reject(new Error('微信登录失败，请重试'))}));}
export function errorMessage(error:unknown):string{return error instanceof Error?error.message:'加载失败，请重试'}
export function avatarSource(url:string|null|undefined):string{return url ? API_BASE+url : ''}
function uploadFailure(detail:string):string{
 const reason=detail||'未知上传错误';
 if(/domain|url not in/i.test(reason))return '上传域名校验失败，请联系管理员检查微信后台配置（'+reason+'）';
 if(/ssl|tls|certificate|cert error/i.test(reason))return 'HTTPS 证书校验失败，请联系管理员检查证书（'+reason+'）';
 if(/timeout|timed out/i.test(reason))return '头像上传超时，请切换网络后重试（'+reason+'）';
 if(/no such file|file not found|file.*not exist|permission denied|read file/i.test(reason))return '无法读取头像，请重新选择头像后重试（'+reason+'）';
 return '头像上传失败（'+reason+'），请将此提示反馈给管理员';
}
function upload<T>(path:string,filePath:string,formData:{[key:string]:string}):Promise<T>{
 return new Promise((resolve,reject)=>wx.uploadFile({url:API_BASE+'/mini'+path,filePath,name:'avatar',formData,header:{Authorization:'Bearer '+(wx.getStorageSync('player_token')||'')},success:r=>{
  if(r.statusCode===413){reject(new Error('头像超过服务器上传限制，请联系管理员调整上传大小限制'));return}
  if(r.statusCode===502||r.statusCode===504){reject(new Error('上传服务暂时不可用（HTTP '+r.statusCode+'），请联系管理员检查接口代理'));return}
  let body:{detail?:string};try{body=JSON.parse(r.data)}catch(_){reject(new Error('头像上传响应异常（HTTP '+r.statusCode+'），请联系管理员检查接口代理'));return}
  if(r.statusCode>=200&&r.statusCode<300){resolve(body as T);return}
  if(r.statusCode===401)wx.removeStorageSync('player_token');
  reject(new Error(typeof body.detail==='string'?body.detail:'资料保存失败，请检查昵称和头像'));
 },fail:error=>{
  console.error('头像上传失败',{url:API_BASE+'/mini'+path,errMsg:error.errMsg});
  reject(new Error(uploadFailure(error.errMsg)));
 }}));
}
export function registerMember(nickname:string,avatarPath:string):Promise<void>{
 return new Promise((resolve,reject)=>wx.login({success:r=>{
  if(!r.code){reject(new Error('微信登录失败，请重试'));return}
  upload<{access_token:string}>('/auth/register',avatarPath,{code:r.code,nickname,agreed:'true'}).then(result=>{wx.setStorageSync('player_token',result.access_token);resolve()},reject);
 },fail:()=>reject(new Error('微信登录失败，请重试'))}));
}
export function saveAvatar(nickname:string,avatarPath:string):Promise<{avatar_url:string}>{return upload('/profile/avatar',avatarPath,{nickname})}
export function decorateReward(reward:Reward):Reward{const labels:{[key:string]:string}={pending:'待核销',redeemed:'已核销',cancelled:'已撤销',expired:'已失效'};return {...reward,statusLabel:labels[reward.status]||reward.status,dateLabel:reward.issued_at.slice(0,10),redeemedLabel:reward.redeemed_at?reward.redeemed_at.replace('T',' ').slice(0,16):''}}
export function goLogin(){wx.navigateTo({url:'/pages/login/login'})}

export interface Match {id:number;name:string;type:string;starts_at:string;capacity:number;status:string;enrolled_count:number;my_status:string|null;competition_id:number|null;statusLabel?:string;timeLabel?:string;typeLabel?:string}
export function decorateMatch(match:Match):Match{const labels:{[key:string]:string}={open:'报名中',running:'进行中',finished:'已结束',cancelled:'已取消'};return {...match,statusLabel:labels[match.status]||match.status,timeLabel:match.starts_at.replace('T',' ').slice(0,16),typeLabel:match.type==='gto'?'GTO 赛事':'常规赛'}}

// Staff credentials are kept separate from the member's WeChat session.
export function staffLoggedIn():boolean{return Boolean(wx.getStorageSync('staff_token'))}
export function staffRequest<T>(path:string,method:'GET'|'POST'='GET',data?:object):Promise<T>{
 return new Promise((resolve,reject)=>wx.request({url:API_BASE+path,method,data,header:{Authorization:'Bearer '+(wx.getStorageSync('staff_token')||wx.getStorageSync('player_token')||'')},success:r=>{
  if(r.statusCode>=200&&r.statusCode<300){resolve(r.data as T);return}
  if(r.statusCode===401||r.statusCode===403)wx.removeStorageSync('staff_token');
  const body=r.data as {detail?:string};reject(new RequestError(typeof body.detail==='string'?body.detail:'请求失败，请稍后重试',r.statusCode));
 },fail:()=>reject(new Error('无法连接服务，请检查网络后重试'))}));
}
