import {afterEach, expect, test, vi} from 'vitest';
import {cleanup, render, screen, within, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RedemptionDesk from '../app/RedemptionDesk';

afterEach(()=>cleanup());

test('按会员查找，勾选奖励，确认后批量核销并保留其他奖励',async()=>{
  let rewards=[1,2,3].map(id=>({id,reward_name:'GTO赛事门票',issued_at:'2026-10-20T12:00:00'}));
  const saved=vi.fn(async()=>{});
  const api=vi.fn(async(path:string,body?:Record<string,any>)=>{
    if(path==='/users?q=A001')return [{id:1,nickname:'玩家甲',member_code:'A001'}];
    if(path==='/rewards?status=pending&user_id=1')return structuredClone(rewards);
    if(path==='/rewards/redeem-batch'){
      expect(body).toEqual({user_id:1,reward_ids:[1,2]});
      rewards=rewards.filter(r=>!body!.reward_ids.includes(r.id));
      return {ok:true,count:2};
    }
    throw Error(path);
  });
  const user=userEvent.setup();render(<RedemptionDesk api={api} onSaved={saved}/>);
  await user.type(screen.getByLabelText('昵称 / 会员 ID'),'A001');
  await user.click(await screen.findByRole('button',{name:/玩家甲.*A001/}));
  const boxes=await screen.findAllByRole('checkbox');
  await user.click(boxes[1]);await user.click(boxes[2]);
  await user.click(screen.getByRole('button',{name:'核销选中 2 份奖励'}));
  let dialog=await screen.findByRole('dialog',{name:'确认核销奖励'});
  await user.click(within(dialog).getByRole('button',{name:'取消'}));
  expect(api.mock.calls.some(([path])=>path==='/rewards/redeem-batch')).toBe(false);
  await user.click(screen.getByRole('button',{name:'核销选中 2 份奖励'}));
  dialog=await screen.findByRole('dialog',{name:'确认核销奖励'});
  await user.click(within(dialog).getByRole('button',{name:'确认使用'}));
  expect((await screen.findByRole('status')).textContent).toContain('已核销 2 份奖励');
  await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
  expect(rewards.map(r=>r.id)).toEqual([3]);
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
});

test('批量核销失败在确认弹窗内提示且不显示成功',async()=>{
  const api=vi.fn(async(path:string)=>{
    if(path.startsWith('/users?q='))return [{id:2,nickname:'玩家乙',member_code:'B002'}];
    if(path.startsWith('/rewards?'))return [{id:7,reward_name:'常规赛门票',issued_at:'2026-10-20T12:00:00'}];
    throw Error('奖励状态已变化，请刷新');
  });
  const user=userEvent.setup();render(<RedemptionDesk api={api} onSaved={vi.fn()}/>);
  await user.type(screen.getByLabelText('昵称 / 会员 ID'),'玩家乙');
  await user.click(await screen.findByRole('button',{name:/玩家乙.*B002/}));
  await user.click((await screen.findAllByRole('checkbox'))[1]);
  await user.click(screen.getByRole('button',{name:'核销选中 1 份奖励'}));
  const dialog=await screen.findByRole('dialog',{name:'确认核销奖励'});
  await user.click(within(dialog).getByRole('button',{name:'确认使用'}));
  expect((await within(dialog).findByRole('alert')).textContent).toBe('奖励状态已变化，请刷新');
  expect(screen.queryByRole('status')).toBeNull();
});
