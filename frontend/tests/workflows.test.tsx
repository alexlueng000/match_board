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
  else if(path==='/rankings')result=[...players].sort((a,b)=>b[url.searchParams.get('scope')==='total'?'total_score':'monthly_score']-a[url.searchParams.get('scope')==='total'?'total_score':'monthly_score']);
  else if(/^\/users\/\d+$/.test(path))result={user:players.find(p=>p.id===Number(path.split('/')[2])),points:[],rewards:[]};
  else if(/^\/users\/\d+\/points$/.test(path)&&body){
    players=players.map(p=>p.id===Number(path.split('/')[2])?{...p,monthly_score:p.monthly_score+body.points,total_score:p.total_score+body.points}:p);
    result={ok:true};
  }
  else if(path==='/prize-settings')result={prizes:[],rules:[]};
  else if(path==='/reward-types')result={GTO_TICKET:'GTO赛事门票',GIFT:'GTO冠军礼品'};
  else if(path==='/competitions'&&body){
    recorded=body;
    players[0]={...players[0],monthly_score:10,total_score:10};
    rewards=[1,2].map(id=>({id,user_id:1,nickname:'玩家甲',member_code:'A001',reward_name:'GTO赛事门票',status:'pending',redeem_code:'CODE00000'+id,issued_at:'2026-10-04T12:00:00'}));
    result={id:1,duplicate:false};
  }else if(path==='/competitions')result=[];
  else if(path==='/rewards'&&body){
    const player=players.find(p=>p.id===body.user_id)!;
    const firstId=rewards.length+1;
    rewards.push(...Array.from({length:body.quantity},(_,i)=>({id:firstId+i,user_id:body.user_id,nickname:player.nickname,member_code:player.member_code,reward_name:'GTO赛事门票',status:'pending',issued_at:'2026-10-20T12:00:00'})));
    result={ok:true};
  }
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
  await user.type(screen.getByRole('searchbox',{name:'搜索冠军玩家'}),'玩家甲');
  expect(within(screen.getByRole('combobox',{name:'冠军 *'})).queryByRole('option',{name:/玩家乙/})).toBeNull();
  expect(screen.getByRole('combobox',{name:'亚军 *'}).querySelectorAll('option')).toHaveLength(4);
  await user.selectOptions(screen.getByRole('combobox',{name:'冠军 *'}),'1');
  await user.clear(screen.getByRole('searchbox',{name:'搜索冠军玩家'}));
  await user.type(screen.getByRole('searchbox',{name:'搜索冠军玩家'}),'不存在');
  expect(await screen.findByRole('status')).toHaveProperty('textContent','未找到匹配玩家，请更换昵称或会员 ID');
  expect((screen.getByRole('combobox',{name:'冠军 *'}) as HTMLSelectElement).value).toBe('1');
  await user.type(screen.getByRole('searchbox',{name:'搜索亚军玩家'}),' a002 ');
  expect(screen.getByRole('combobox',{name:'亚军 *'}).querySelectorAll('option')).toHaveLength(2);
  await user.selectOptions(screen.getByRole('combobox',{name:'亚军 *'}),'2');
  await user.selectOptions(screen.getByRole('combobox',{name:'季军 *'}),'3');
  await user.selectOptions(screen.getByRole('combobox',{name:'GTO 冠军奖励'}),'tickets');
  await user.click(screen.getByRole('button',{name:'确认发放'}));
  await screen.findByText('比赛结果已记录，积分与奖励已发放');
  expect((screen.getByRole('searchbox',{name:'搜索冠军玩家'}) as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('combobox',{name:'冠军 *'}) as HTMLSelectElement).value).toBe('');
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

test.each(['月赛榜','总榜'])('从%s直接打开积分调整并刷新榜单',async(scopeLabel)=>{
  sessionStorage.setItem('nuts_token','test-token');
  const user=userEvent.setup();render(<Page/>);
  await user.click(await screen.findByRole('button',{name:'积分排行榜'}));
  await user.click(await screen.findByRole('button',{name:scopeLabel}));
  const buttons=await screen.findAllByRole('button',{name:'调整积分'});
  await user.click(buttons[0]);
  const modal=await screen.findByRole('dialog',{name:'玩家详情与积分调整'});
  await user.type(within(modal).getByLabelText('积分变动'),'-3');
  await user.type(within(modal).getByLabelText('原因'),'积分修正');
  await user.click(within(modal).getByRole('button',{name:'确认调整'}));
  await screen.findByText('积分已调整');
  expect(players[0].monthly_score).toBe(-3);
  expect(players[0].total_score).toBe(-3);
  expect(fetchMock.mock.calls.some(([url,init])=>url.endsWith('/users/1/points')&&init?.body===JSON.stringify({points:-3,month:'2026-10',reason:'积分修正'}))).toBe(true);
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'玩家详情与积分调整'})).toBeNull());
  expect(fetchMock.mock.calls.filter(([url,init])=>url.endsWith('/users/1/points')&&init?.method==='POST')).toHaveLength(1);
  await waitFor(()=>expect(within(screen.getByRole('table')).getByText('-3')).toBeTruthy());
});

test('积分调整提交中防止双击，失败保留弹窗，重试成功后关闭',async()=>{
  sessionStorage.setItem('nuts_token','test-token');
  const user=userEvent.setup();render(<Page/>);
  await user.click(await screen.findByRole('button',{name:'玩家管理'}));
  await user.click((await screen.findAllByRole('button',{name:'查看详情'}))[0]);
  const modal=await screen.findByRole('dialog',{name:'玩家详情与积分调整'});
  await user.type(within(modal).getByLabelText('积分变动'),'5');
  await user.type(within(modal).getByLabelText('原因'),'补录积分');
  let finish!:(response:Response)=>void;
  fetchMock.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve}));
  await user.dblClick(within(modal).getByRole('button',{name:'确认调整'}));
  expect(fetchMock.mock.calls.filter(([url,init])=>url.endsWith('/users/1/points')&&init?.method==='POST')).toHaveLength(1);
  expect((within(modal).getByRole('button',{name:'确认调整'}) as HTMLButtonElement).disabled).toBe(true);
  finish({ok:false,status:500,json:async()=>({detail:'提交失败，请重试'})} as Response);
  expect((await within(modal).findByRole('alert')).textContent).toBe('提交失败，请重试');
  expect((within(modal).getByLabelText('积分变动') as HTMLInputElement).value).toBe('5');
  await user.click(within(modal).getByRole('button',{name:'确认调整'}));
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'玩家详情与积分调整'})).toBeNull());
  expect(players[0].total_score).toBe(5);
});

test('玩家详情给当前玩家发放多份奖励，成功后关闭弹窗且不调整积分',async()=>{
  sessionStorage.setItem('nuts_token','test-token');
  const user=userEvent.setup();render(<Page/>);
  await user.click(await screen.findByRole('button',{name:'玩家管理'}));
  await user.click((await screen.findAllByRole('button',{name:'查看详情'}))[0]);
  const modal=await screen.findByRole('dialog',{name:'玩家详情与积分调整'});
  await user.selectOptions(within(modal).getByLabelText('发放奖品'),'GTO_TICKET');
  await user.clear(within(modal).getByLabelText('发放份数'));
  await user.type(within(modal).getByLabelText('发放份数'),'2');
  await user.type(within(modal).getByLabelText('发放原因'),' 活动补发 ');
  await user.click(within(modal).getByRole('button',{name:'确认发放奖励'}));
  await screen.findByText('奖励已发放');
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'玩家详情与积分调整'})).toBeNull());
  const posts=fetchMock.mock.calls.filter(([url,init])=>url.endsWith('/rewards')&&init?.method==='POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(String(posts[0][1]?.body))).toEqual({user_id:1,reward_type:'GTO_TICKET',quantity:2,reason:'活动补发'});
  expect(rewards).toHaveLength(2);
  expect(rewards.every(r=>r.user_id===1)).toBe(true);
  expect(players[0].total_score).toBe(0);
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
