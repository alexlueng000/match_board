import {afterEach, expect, test, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MemberAdminAccess from '../app/MemberAdminAccess';
afterEach(()=>cleanup());
const member={id:7,nickname:'越仔',member_code:'76D94EC9',has_wechat:true,is_admin:false};
test('核对会员并确认后才授予权限，刷新后可取消',async()=>{
 const api=vi.fn(async()=>({is_admin:true})),saved=vi.fn(async()=>{}),user=userEvent.setup();
 const view=render(<MemberAdminAccess member={member} disabled={false} api={api} onSaved={saved}/>);
 await user.click(screen.getByRole('button',{name:'设为管理员'}));
 expect(api).not.toHaveBeenCalled();expect(screen.getByText(/拥有完整管理权限/)).toBeTruthy();
 await user.click(screen.getByRole('button',{name:'取消'}));expect(api).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'设为管理员'}));await user.click(screen.getByRole('button',{name:'确认设为管理员'}));
 expect(api).toHaveBeenCalledWith('/users/7/admin',{enabled:true});expect(saved).toHaveBeenCalledTimes(1);
 view.rerender(<MemberAdminAccess member={{...member,is_admin:true}} disabled={false} api={api} onSaved={saved}/>);
 await user.click(screen.getByRole('button',{name:'取消管理员'}));await user.click(screen.getByRole('button',{name:'确认取消管理员'}));
 expect(api).toHaveBeenLastCalledWith('/users/7/admin',{enabled:false});
});
test('禁止为未绑定微信的玩家授权，提交失败保留确认并显示错误',async()=>{
 const api=vi.fn(async()=>{throw Error('无权限')}),user=userEvent.setup();
 const view=render(<MemberAdminAccess member={{...member,has_wechat:false}} disabled={false} api={api} onSaved={async()=>{}}/>);
 expect((screen.getByRole('button',{name:'设为管理员'}) as HTMLButtonElement).disabled).toBe(true);
 view.rerender(<MemberAdminAccess member={member} disabled={false} api={api} onSaved={async()=>{}}/>);
 await user.click(screen.getByRole('button',{name:'设为管理员'}));await user.click(screen.getByRole('button',{name:'确认设为管理员'}));
 expect((await screen.findByRole('alert')).textContent).toBe('无权限');expect(screen.getByRole('button',{name:'确认设为管理员'})).toBeTruthy();
});
