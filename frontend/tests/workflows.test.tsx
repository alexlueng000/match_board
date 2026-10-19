import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {render,screen,waitFor,cleanup,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Page from '../app/page';

let players:Record<string,any>[], rewards:Record<string,any>[], recorded:Record<string,any>|null;
const fetchMock=vi.fn(async(input: string,options?:RequestInit)=>{
  const url=new URL(input,'http://localhost:8000');
  const path=url.pathname;
  const body=options?.body?JSON.parse(String(options.body)):null;
  let result:any={};
  if(path==='/auth/login')result={access_token:'test-token',username:'admin'};
  else if(path==='/dashboard')result={current_month:'2026-10',users:3,competitions:recorded?1:0,month_points:recorded?18:0,pending_rewards:rewards.filter(r=>r.status==='pending').length};
  else if(path==='/users'&&body){
    const player={id:players.length+1,nickname:body.nickname,member_code:'A004',monthly_score:0,total_score:0,monthly_rank:4,total_rank:4};
    players.push(player);result=player;
  }
  else if(path==='/users')result=players;
  else if(path==='/prize-settings')result={prizes:[],rules:[]};
  else if(path==='/reward-types')result={GTO_TICKET:'GTO赛事门票',GIFT:'GTO冠军礼品'};
  else if(path==='/competitions'&&body){
    recorded=body;
    players[0]={...players[0],monthly_score:10,total_score:10};
    rewards=[1,2].map(id=>({id,user_id:1,nickname:'玩家甲',member_code:'A001',reward_name:'GTO赛事门票',status:'pending',redeem_code:'CODE00000'+id,issued_at:'2026-10-04T12:00:00'}));
    result={id:1,duplicate:false};
  }else if(path==='/competitions')result=[];
  else if(path==='/rewards')result=rewards;
  else if(path.match(/^\/rewards\/\d+\/redeem$/)){
    const id=Number(path.split('/')[2]);
    rewards=rewards.map(r=>r.id===id?{...r,status:'redeemed',redeemed_at:'2026-10-04T13:00:00'}:r);
    result={ok:true};
  }else throw Error('Unexpected API request: '+path);
  return {ok:true,status:200,json:async()=>result} as Response;
});
beforeEach(()=>{
  sessionStorage.clear();
  recorded=null;rewards=[];
  players=['玩家甲','玩家乙','玩家丙'].map((nickname,i)=>({id:i+1,nickname,member_code:'A00'+(i+1),monthly_score:0,total_score:0,monthly_rank:i+1,total_rank:i+1}));
  vi.stubGlobal('fetch',fetchMock);
  vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});

test('管理员登录后录入GTO赛事，核销一张门票时另一张保持待核销',async()=>{
  const user=userEvent.setup();
  render(<Page/>);
  await user.type(await screen.findByLabelText('管理员账号'),'admin');
  await user.type(screen.getByLabelText('密码'),'test-password');
  await user.click(screen.getByRole('button',{name:/登录管理后台/}));
  await screen.findByRole('button',{name:'赛事记分'});
  await user.click(screen.getByRole('button',{name:'赛事记分'}));
  await user.selectOptions(await screen.findByRole('combobox',{name:/赛事类型/}),'gto');
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'冠军 *'}).querySelectorAll('option')).toHaveLength(4));
  await user.selectOptions(screen.getByRole('combobox',{name:'冠军 *'}),'1');
  await user.selectOptions(screen.getByRole('combobox',{name:'亚军 *'}),'2');
  await user.selectOptions(screen.getByRole('combobox',{name:'季军 *'}),'3');
  await user.selectOptions(screen.getByRole('combobox',{name:'GTO 冠军奖励'}),'tickets');
  await user.click(screen.getByRole('button',{name:'确认发放'}));
  await screen.findByText('比赛结果已记录，积分与奖励已发放');
  expect(recorded).toMatchObject({type:'gto',champion:1,second:2,third:3,champion_reward:'tickets',pool27:null});
  expect(recorded?.request_id).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([url,init])=>url.endsWith('/competitions')&&init?.method==='POST')).toHaveLength(1);
  await user.click(screen.getByRole('button',{name:'奖励管理'}));
  await waitFor(()=>expect(screen.getAllByRole('button',{name:'核销'})).toHaveLength(2));
  await user.click(screen.getAllByRole('button',{name:'核销'})[0]);
  await screen.findByText('核销成功');
  await waitFor(()=>expect(screen.getAllByRole('button',{name:'核销'})).toHaveLength(1));
  expect(rewards.map(r=>r.status)).toEqual(['redeemed','pending']);
  expect(within(screen.getByRole('table')).getByText('已核销')).toBeTruthy();
});

test('接口登录失败时显示错误并保留登录界面',async()=>{
  fetchMock.mockResolvedValueOnce({ok:false,status:401,json:async()=>({detail:'账号或密码错误'})} as Response);
  const user=userEvent.setup();render(<Page/>);
  await user.type(await screen.findByLabelText('管理员账号'),'admin');
  await user.type(screen.getByLabelText('密码'),'wrong');
  await user.click(screen.getByRole('button',{name:/登录管理后台/}));
  expect(await screen.findByText('账号或密码错误')).toBeTruthy();
  expect(sessionStorage.getItem('nuts_token')).toBeNull();
});

test('新增玩家使用页面弹窗，取消不提交并校验昵称',async()=>{
  sessionStorage.setItem('nuts_token','test-token');
  const promptSpy=vi.spyOn(window,'prompt');
  const user=userEvent.setup();render(<Page/>);
  await user.click(await screen.findByRole('button',{name:'玩家管理'}));
  await user.click(await screen.findByRole('button',{name:'新增玩家'}));
  let modal=await screen.findByRole('dialog',{name:'新增玩家'});
  await user.click(within(modal).getByRole('button',{name:'取消'}));
  expect(screen.queryByRole('dialog',{name:'新增玩家'})).toBeNull();
  await user.click(screen.getByRole('button',{name:'新增玩家'}));
  modal=await screen.findByRole('dialog',{name:'新增玩家'});
  await user.click(within(modal).getByRole('button',{name:'确认创建'}));
  expect((await within(modal).findByRole('alert')).textContent).toBe('请填写玩家昵称');
  await user.type(within(modal).getByLabelText('玩家昵称'),' 新玩家 ');
  fetchMock.mockResolvedValueOnce({ok:false,status:500,json:async()=>({detail:'创建失败，请重试'})} as Response);
  await user.click(within(modal).getByRole('button',{name:'确认创建'}));
  expect((await within(modal).findByRole('alert')).textContent).toBe('创建失败，请重试');
  expect((within(modal).getByLabelText('玩家昵称') as HTMLInputElement).value).toBe(' 新玩家 ');
  await user.click(within(modal).getByRole('button',{name:'确认创建'}));
  await screen.findByText('玩家已创建');
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'新增玩家'})).toBeNull());
  expect(players.at(-1)?.nickname).toBe('新玩家');
  expect(promptSpy).not.toHaveBeenCalled();
});
