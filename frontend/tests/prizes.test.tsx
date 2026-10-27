import {afterEach,expect,test,vi} from 'vitest';
import {render,screen,cleanup,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PrizeSettings from '../app/PrizeSettings';
afterEach(()=>{cleanup();vi.restoreAllMocks()});
test('后台保存奖品名称、库存、发放数量和调整原因，带上库存版本',async()=>{
 let settings={prizes:[{code:'GIFT',name:'冠军礼品',stock:null as number|null,version:5,enabled:true}],rules:[{key:'gto_champion_gift',prize_code:'GIFT',quantity:1}]};
 let submitted:any;
 const api=vi.fn(async(path:string,body?:Record<string,any>)=>{
  if(path==='/inventory-logs')return [];
  if(path==='/prize-settings'&&body){submitted=body;settings={prizes:body.prizes.map((p:any)=>({...p,version:6})),rules:body.rules};return settings;}
  if(path==='/prize-settings')return structuredClone(settings);
  throw Error(path);
 });
 const user=userEvent.setup();render(<PrizeSettings api={api} onSaved={vi.fn(async()=>{})}/>);
 const name=await screen.findByLabelText('GIFT奖品名称');
 expect(screen.queryByLabelText('GIFT兑换积分')).toBeNull();
 await user.clear(name);await user.type(name,'赛事纪念杯');
 await user.click(screen.getByRole('checkbox',{name:'不限库存'}));
 const stock=screen.getByLabelText('GIFT库存');await user.clear(stock);await user.type(stock,'10');
 const quantity=screen.getByLabelText('GTO · 冠军方案 B数量');await user.clear(quantity);await user.type(quantity,'2');
 await user.type(screen.getByLabelText('设置 / 库存调整原因 *'),'补货10份，每次发放2份');
 await user.click(screen.getByRole('button',{name:'保存奖品设置'}));
 await screen.findByText('奖品、发放数量和库存已保存');
 expect(submitted.prizes[0]).toMatchObject({name:'赛事纪念杯',stock:10,version:5});
 expect(submitted.rules[0].quantity).toBe(2);
 expect(submitted.reason).toBe('补货10份，每次发放2份');
 expect(submitted.prizes[0]).not.toHaveProperty('exchange_points');
});

test('删除奖品通过页面弹窗确认，保留其他尚未保存的修改',async()=>{
  const settings={prizes:[{code:'CUSTOM_A',name:'纪念杯',stock:10,version:4,enabled:true},{code:'CUSTOM_B',name:'纪念牌',stock:5,version:2,enabled:true}],rules:[]};
  const saved=vi.fn(async()=>{});
  const api=vi.fn(async(path:string,body?:Record<string,any>)=>{
    if(path==='/prize-settings')return structuredClone(settings);
    if(path==='/inventory-logs')return [];
    if(path==='/prizes/CUSTOM_A/delete'){
      expect(body).toEqual({version:4,reason:'不再提供'});
      return {ok:true};
    }
    throw Error(path);
  });
  const user=userEvent.setup();render(<PrizeSettings api={api} onSaved={saved}/>);
  await screen.findByLabelText('CUSTOM_A奖品名称');
  await user.clear(screen.getByLabelText('CUSTOM_B奖品名称'));
  await user.type(screen.getByLabelText('CUSTOM_B奖品名称'),'保留未保存修改');
  await user.click(screen.getByRole('button',{name:'删除纪念杯'}));
  let dialog=await screen.findByRole('dialog',{name:'删除奖品'});
  await user.click(within(dialog).getByRole('button',{name:'取消'}));
  expect(api.mock.calls.some(([path])=>path.includes('/delete'))).toBe(false);
  await user.click(screen.getByRole('button',{name:'删除纪念杯'}));
  dialog=await screen.findByRole('dialog',{name:'删除奖品'});
  await user.type(within(dialog).getByLabelText('删除原因'),' 不再提供 ');
  await user.click(within(dialog).getByRole('button',{name:'确认删除'}));
  await screen.findByText('奖品已删除');
  expect(screen.queryByLabelText('CUSTOM_A奖品名称')).toBeNull();
  expect((screen.getByLabelText('CUSTOM_B奖品名称') as HTMLInputElement).value).toBe('保留未保存修改');
  await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
});

test('比赛规则仍在使用时显示删除失败，奖品继续保留',async()=>{
  const api=vi.fn(async(path:string)=>{
    if(path==='/prize-settings')return {prizes:[{code:'GIFT',name:'冠军礼品',stock:null,version:0,enabled:true}],rules:[]};
    if(path==='/inventory-logs')return [];
    throw Error('该奖品仍用于比赛发奖，请先替换');
  });
  const user=userEvent.setup();render(<PrizeSettings api={api} onSaved={vi.fn()}/>);
  await user.click(await screen.findByRole('button',{name:'删除冠军礼品'}));
  const dialog=await screen.findByRole('dialog',{name:'删除奖品'});
  await user.type(within(dialog).getByLabelText('删除原因'),'不再提供');
  await user.click(within(dialog).getByRole('button',{name:'确认删除'}));
  expect((await within(dialog).findByRole('alert')).textContent).toBe('该奖品仍用于比赛发奖，请先替换');
  expect(screen.getByLabelText('GIFT奖品名称')).toBeTruthy();
});
