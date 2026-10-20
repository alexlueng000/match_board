import {expect, test, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Exercise the actual mini-program controller with WeChat APIs replaced in memory.
const source=readFileSync(resolve(process.cwd(),'../miniprogram/pages/exchange/exchange.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
class RequestError extends Error {constructor(message:string,public statusCode:number){super(message)}}
function page(request:ReturnType<typeof vi.fn>,storage=new Map<string,any>()){
  let config:Record<string,any>={};
  runInNewContext(compiled,{exports:{},require:()=>({BRAND_BACKGROUND:'background',request,loggedIn:()=>true,errorMessage:(e:Error)=>e.message,RequestError}),Page:(value:Record<string,any>)=>{config=value},wx:{getStorageSync:(key:string)=>storage.get(key),setStorageSync:(key:string,value:any)=>storage.set(key,value),removeStorageSync:(key:string)=>storage.delete(key)}});
  const controller={...config,data:structuredClone(config.data),setData(value:Record<string,any>){Object.assign(this.data,value)}};
  return controller as Record<string,any>;
}
const catalog={available_points:10,spent_points:0,member_code:'A001',items:[{code:'REGULAR_TICKET',name:'常规赛门票',points:5,stock:null}],history:[]};

test('兑换网络失败后重开页面沿用请求标识，避免重复扣分',async()=>{
  const storage=new Map<string,any>();
  let failed=false;
  const request=vi.fn(async(_path:string,method?:string,_body?:Record<string,any>)=>{
    if(method!=='POST')return structuredClone(catalog);
    if(!failed){failed=true;throw Error('网络连接中断')}
    return {reward_id:9};
  });
  const first=page(request,storage);await first.load();
  first.choose({currentTarget:{dataset:{code:'REGULAR_TICKET'}}});
  await first.confirm();
  const pending=structuredClone(storage.get('exchange_pending_A001'));
  expect(pending.request_id).toBeTruthy();
  expect(first.data.error).toBe('网络连接中断');
  const reopened=page(request,storage);await reopened.load();await reopened.confirm();
  const posts=request.mock.calls.filter(([,method])=>method==='POST');
  expect(posts).toHaveLength(2);
  expect(posts[0][2]).toEqual(posts[1][2]);
  expect(storage.has('exchange_pending_A001')).toBe(false);
  expect(reopened.data.notice).toContain('兑换成功');
});

test('确定失败的兑换解除待确认状态，可修改价格后重新选择',async()=>{
  const request=vi.fn(async(_path:string,method?:string)=>{
    if(method==='POST')throw new RequestError('兑换价格已调整',409);
    return structuredClone(catalog);
  });
  const storage=new Map<string,any>();const controller=page(request,storage);await controller.load();
  controller.choose({currentTarget:{dataset:{code:'REGULAR_TICKET'}}});await controller.confirm();
  expect(controller.data.error).toBe('兑换价格已调整');
  expect(controller.data.pending).toBeNull();
  expect(storage.size).toBe(0);
});

test('兑换成功但响应丢失时，通过历史记录清除待确认请求',async()=>{
  const pending={request_id:'already-purchased-1',prize_code:'REGULAR_TICKET',expected_points:5};
  const storage=new Map([['exchange_pending_A001',pending]]);
  const request=vi.fn(async()=>({...catalog,history:[{request_id:pending.request_id,reward_id:9,reward_name:'常规赛门票',points:5,status:'pending',created_at:'2026-10-20T12:00:00',refunded_at:null}]}));
  const controller=page(request,storage);await controller.load();
  expect(storage.size).toBe(0);expect(controller.data.pending).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});

test.each([408,502])('HTTP %s结果不明确时保留原兑换请求以便安全重试',async(status)=>{
  const request=vi.fn(async(_path:string,method?:string)=>{
    if(method==='POST')throw new RequestError('请求超时或代理异常',status);
    return structuredClone(catalog);
  });
  const storage=new Map<string,any>();const controller=page(request,storage);await controller.load();
  controller.choose({currentTarget:{dataset:{code:'REGULAR_TICKET'}}});await controller.confirm();
  expect(controller.data.pending?.request_id).toBeTruthy();
  expect(storage.get('exchange_pending_A001').request_id).toBe(controller.data.pending.request_id);
});
