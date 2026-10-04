import {afterEach,expect,test,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
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
});
