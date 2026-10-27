import {expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const source=readFileSync(resolve(process.cwd(),'../miniprogram/pages/staff-results/staff-results.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
class RequestError extends Error {constructor(message:string,public statusCode:number){super(message)}}
const players=[1,2,3,4].map(id=>({id,nickname:'玩家'+id,member_code:'A00'+id}));
function page(request:ReturnType<typeof vi.fn>,storage=new Map<string,any>(),loggedIn=true,memberLoggedIn=false){
 let config:Record<string,any>={};
 const modal=vi.fn(async()=>({confirm:true}));
 const redirect=vi.fn();
 runInNewContext(compiled,{exports:{},require:()=>({staffRequest:request,staffLoggedIn:()=>loggedIn,loggedIn:()=>memberLoggedIn,errorMessage:(e:Error)=>e.message,RequestError}),Page:(value:Record<string,any>)=>{config=value},wx:{
  getStorageSync:(key:string)=>storage.get(key),setStorageSync:(key:string,value:any)=>storage.set(key,structuredClone(value)),removeStorageSync:(key:string)=>storage.delete(key),showModal:modal,redirectTo:redirect
 }});
 const controller={...config,data:structuredClone(config.data),setData(value:Record<string,any>){Object.assign(this.data,value)}} as Record<string,any>;
 return {controller,modal,redirect};
}
function api(post=async(_body:any)=>({id:9}),sessions:any[]=[],roster:any[]=[]) {
 return vi.fn(async(path:string,method?:string,body?:any)=>{
  if(path==='/users')return players;
  if(path.startsWith('/sessions?'))return sessions;
  if(path==='/sessions/5')return {...sessions[0],roster};
  if(path==='/prize-settings')return {prizes:[{code:'TICKET',name:'赛事门票'}],rules:[{key:'gto_champion_tickets',prize_code:'TICKET',quantity:2}]};
  if(path==='/competitions'&&method==='POST')return post(body);
  throw Error(path);
 });
}
function fill(controller:Record<string,any>){
 controller.data.places=controller.data.places.map((place:any,index:number)=>({...place,player:index<3?players[index]:null}));
}

test('管理员选择前三名确认发奖，重复点击只提交一次，成功后清空表单',async()=>{
 let complete!:(value:{id:number})=>void;
 const request=api(()=>new Promise(resolve=>{complete=resolve}));
 const storage=new Map();const {controller,modal}=page(request,storage);
 await controller.load();fill(controller);
 controller.typeChange({detail:{value:'1'}});
 const submission=controller.confirm();await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));
 await controller.confirm();await controller.retry();
 const posts=request.mock.calls.filter(([,method])=>method==='POST');
 expect(posts).toHaveLength(1);
 expect(posts[0][2]).toMatchObject({champion:1,second:2,third:3,pool27:null,type:'gto',champion_reward:'tickets'});
 expect(modal.mock.calls).toHaveLength(1);
 expect(storage.size).toBe(1);
 complete({id:9});await submission;
 expect(controller.data.notice).toContain('积分与奖励已发放');
 expect(controller.data.places.every((place:any)=>place.player===null)).toBe(true);
 expect(storage.size).toBe(0);
});

test('昵称和会员 ID 可搜索，缺少名次或前三名重复时不提交',async()=>{
 const request=api();const {controller,modal}=page(request);await controller.load();
 controller.choose({currentTarget:{dataset:{key:'champion'}}});
 controller.searchInput({detail:{value:' a002 '}});
 expect(controller.data.filtered.map((row:any)=>row.id)).toEqual([2]);
 controller.select({currentTarget:{dataset:{id:2}}});
 expect(controller.data.places[0].player.id).toBe(2);
 await controller.confirm();expect(controller.data.error).toBe('请选择冠军、亚军和季军');
 fill(controller);controller.data.places[1].player=players[0];
 await controller.confirm();expect(controller.data.error).toBe('前三名必须是不同玩家');
 expect(modal).not.toHaveBeenCalled();expect(request.mock.calls.some(([,method])=>method==='POST')).toBe(false);
});

test('响应丢失后重开页面使用原请求重试，取消确认不会提交',async()=>{
 const storage=new Map();let first=true;
 const request=api(async()=>{if(first){first=false;throw Error('连接中断')}return {id:10}});
 const {controller,modal}=page(request,storage);await controller.load();fill(controller);
 modal.mockResolvedValueOnce({confirm:false});await controller.confirm();
 expect(storage.size).toBe(0);expect(request.mock.calls.some(([,method])=>method==='POST')).toBe(false);
 await controller.confirm();expect(controller.data.pending).toBeTruthy();
 const reopened=page(request,storage).controller;await reopened.load();
 expect(reopened.data.pending).toBeTruthy();
 await reopened.retry();
 const posts=request.mock.calls.filter(([,method])=>method==='POST');
 expect(posts).toHaveLength(2);expect(posts[1][2]).toEqual(posts[0][2]);expect(storage.size).toBe(0);
});

test('已有场次只可选到场玩家，提交关联场次并保留类型和日期',async()=>{
 const request=api(undefined,[{id:5,name:'晚场',type:'gto',starts_at:'2026-10-27T20:00:00',status:'running',competition_id:null}],
  players.map(p=>({user_id:p.id,nickname:p.nickname,member_code:p.member_code,status:p.id===4?'joined':'checked_in'})));
 const {controller}=page(request);await controller.load();await controller.sessionChange({detail:{value:'1'}});
 expect(controller.data.eligible.map((row:any)=>row.id)).toEqual([1,2,3]);
 controller.typeChange({detail:{value:'0'}});expect(controller.data.typeIndex).toBe(1);
 fill(controller);await controller.confirm();
 expect(request.mock.calls.find(([,method])=>method==='POST')?.[2]).toMatchObject({session_id:5,type:'gto',date:'2026-10-27'});
});

test('未登录跳转管理登录，服务端拒绝提交后允许修正',async()=>{
 const request=api(async()=>{throw new RequestError('库存不足',422)});
 const guest=page(request,new Map(),false);await guest.controller.load();
 expect(guest.redirect).toHaveBeenCalledWith({url:'/pages/staff/staff'});expect(request).not.toHaveBeenCalled();
 const storage=new Map();const {controller}=page(request,storage);await controller.load();fill(controller);await controller.confirm();
 expect(controller.data.error).toBe('库存不足');expect(controller.data.pending).toBeNull();expect(storage.size).toBe(0);
 expect(controller.data.places[0].player.id).toBe(1);
});

test('微信授权管理员无需密码凭证即可录入，撤销权限后跳回登录',async()=>{
 const request=api();const {controller,redirect}=page(request,new Map(),false,true);
 await controller.load();expect(controller.data.ready).toBe(true);expect(redirect).not.toHaveBeenCalled();
 request.mockRejectedValue(new RequestError('无管理员权限',401));
 await controller.load();expect(controller.data.ready).toBe(false);expect(redirect).toHaveBeenCalledWith({url:'/pages/staff/staff'});
});
