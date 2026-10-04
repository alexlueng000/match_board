import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MatchSessions from '../app/MatchSessions';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('管理员确认到场并开赛，只能从本场到场名单选人记分', async () => {
  const user = userEvent.setup();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  let match: Record<string, any> = { id: 7, name: '晚间常规赛', type: 'regular', starts_at: '2026-10-05T19:30:00', capacity: 27, status: 'open', enrolled_count: 4, competition_id: null, roster: [1,2,3,4].map(id => ({ user_id:id, nickname:'玩家'+id, member_code:'P00'+id, status:id===4?'withdrawn':id===3?'joined':'checked_in', joined_at:'2026-10-05T18:00:00' })) };
  let result: any;
  const api = vi.fn(async (path:string, body?:Record<string,any>) => {
    if(path.startsWith('/sessions?day=')) return [{...match}];
    if(path === '/sessions/7') return structuredClone(match);
    if(path === '/sessions/7/participants/3/check-in') { match.roster[2].status = body?.checked_in ? 'checked_in' : 'joined'; return {status:match.roster[2].status}; }
    if(path === '/sessions/7/status') { match.status = body?.status; return {...match}; }
    if(path === '/competitions') { result = body; match = {...match,status:'finished',competition_id:11}; return {id:11}; }
    throw Error('Unexpected '+path);
  });
  render(<MatchSessions api={api} onSaved={vi.fn(async()=>{})} sessionId={7} />);
  await screen.findByRole('link', {name:'← 返回场次列表'});
  await screen.findByRole('button', {name:'确认到场'});
  expect(screen.queryByRole('button', {name:'创建场次'})).toBeNull();
  expect(screen.queryByRole('combobox', {name:'冠军 *'})).toBeNull();
  await user.click(screen.getByRole('button', {name:'确认到场'}));
  await screen.findByText('到场状态已更新');
  await user.click(screen.getByRole('button', {name:'开始比赛'}));
  const champion = await screen.findByRole('combobox', {name:'冠军 *'});
  expect(champion.querySelectorAll('option')).toHaveLength(4);
  expect(champion.textContent).not.toContain('玩家4');
  await user.selectOptions(champion, '1');
  await user.selectOptions(screen.getByRole('combobox', {name:'亚军 *'}), '2');
  await user.selectOptions(screen.getByRole('combobox', {name:'季军 *'}), '3');
  await user.click(screen.getByRole('button', {name:'确认结果并结束比赛'}));
  await screen.findByText('比赛已结束，积分与奖励已发放');
  expect(result).toMatchObject({session_id:7,type:'regular',date:'2026-10-05',champion:1,second:2,third:3,pool27:null});
  expect(result.request_id).toBeTruthy();
  await waitFor(()=>expect(screen.queryByRole('button', {name:'确认结果并结束比赛'})).toBeNull());
});


test('场次列表链接跳转独立详情地址，不在列表展开名单', async () => {
  const api = vi.fn(async () => [{id:7,name:'晚间常规赛',type:'regular',starts_at:'2026-10-05T19:30:00',capacity:27,status:'open',enrolled_count:0}]);
  render(<MatchSessions api={api} onSaved={vi.fn(async()=>{})} />);
  const link = await screen.findByRole('link', {name:'参赛名单 / 记分'});
  expect(link.getAttribute('href')).toBe('/sessions/7');
  expect(screen.queryByRole('button', {name:'开始比赛'})).toBeNull();
});
