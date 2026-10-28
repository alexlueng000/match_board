import {afterEach,expect,test} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerSelect from '../app/PlayerSelect';

afterEach(cleanup);
const players=[
 {id:1,nickname:'泉',member_code:'46949403'},
 {id:2,nickname:'智泉',member_code:'A002'},
 {id:3,nickname:'越仔',member_code:'76D94EC9'},
];

test('输入泉直接展示所有匹配玩家，点选后提交玩家ID而不是搜索文字',async()=>{
 const user=userEvent.setup();
 const {container}=render(<form><PlayerSelect name="champion" label="冠军" players={players}/><button type="reset">重置</button></form>);
 const input=screen.getByRole('combobox',{name:'冠军 *'}) as HTMLInputElement;
 await user.type(input,'泉');
 expect(screen.getByRole('listbox')).toBeTruthy();
 expect(screen.getAllByRole('option')).toHaveLength(2);
 expect(screen.queryByRole('option',{name:/越仔/})).toBeNull();
 await user.click(screen.getByRole('option',{name:'泉 46949403'}));
 const form=container.querySelector('form')!;
 expect(input.value).toBe('泉 · 46949403');
 expect(new FormData(form).get('champion')).toBe('1');
 expect(form.checkValidity()).toBe(true);
 expect(screen.queryByRole('listbox')).toBeNull();
 await user.click(screen.getByRole('button',{name:'重置'}));
 expect(input.value).toBe('');expect(new FormData(form).get('champion')).toBe('');
});

test('会员ID搜索支持大小写和空格，键盘确认不会误提交表单',async()=>{
 const user=userEvent.setup();
 const {container}=render(<form><PlayerSelect name="second" label="亚军" players={players}/></form>);
 const input=screen.getByRole('combobox',{name:'亚军 *'}) as HTMLInputElement;
 await user.type(input,' a002 ');
 expect(screen.getAllByRole('option')).toHaveLength(1);
 await user.keyboard('{Enter}');
 expect(input.value).toBe('智泉 · A002');
 expect(new FormData(container.querySelector('form')!).get('second')).toBe('2');
});

test('更改搜索时清除旧的玩家ID，未匹配文字不能作为获奖玩家提交',async()=>{
 const user=userEvent.setup();
 const {container}=render(<form><PlayerSelect name="champion" label="冠军" players={players}/><PlayerSelect name="pool27" label="27收池" players={players} required={false}/></form>);
 const input=screen.getByRole('combobox',{name:'冠军 *'}) as HTMLInputElement;
 await user.type(input,'46949403');await user.click(screen.getByRole('option',{name:'泉 46949403'}));
 await user.clear(input);await user.type(input,'不存在');
 expect(screen.getByRole('status').textContent).toContain('未找到匹配玩家');
 const form=container.querySelector('form')!;
 expect(new FormData(form).get('champion')).toBe('');
 expect(input.checkValidity()).toBe(false);
 await user.clear(input);await user.type(input,'越仔');
 await user.click(screen.getByRole('option',{name:'越仔 76D94EC9'}));
 expect(form.checkValidity()).toBe(true);
 expect(new FormData(form).get('pool27')).toBe('');
});
