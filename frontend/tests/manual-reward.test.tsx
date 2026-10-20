import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManualRewardForm from '../app/ManualRewardForm';
afterEach(()=>cleanup());

test('手动发奖防止重复提交，库存不足时保留输入并允许重试',async()=>{
  let fail!:(error:Error)=>void;
  const issue=vi.fn().mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject})).mockResolvedValue(undefined);
  const user=userEvent.setup();render(<ManualRewardForm types={{GTO_TICKET:'GTO赛事门票'}} disabled={false} onIssue={issue}/>);
  await user.selectOptions(screen.getByLabelText('发放奖品'),'GTO_TICKET');
  await user.type(screen.getByLabelText('发放原因'),'补发门票');
  await user.dblClick(screen.getByRole('button',{name:'确认发放奖励'}));
  expect(issue).toHaveBeenCalledTimes(1);
  fail(new Error('库存不足，请先补货'));
  expect((await screen.findByRole('alert')).textContent).toBe('库存不足，请先补货');
  expect((screen.getByLabelText('发放原因') as HTMLInputElement).value).toBe('补发门票');
  await user.click(screen.getByRole('button',{name:'确认发放奖励'}));
  expect(issue).toHaveBeenCalledTimes(2);
  expect(issue).toHaveBeenLastCalledWith({reward_type:'GTO_TICKET',quantity:1,reason:'补发门票'});
});
