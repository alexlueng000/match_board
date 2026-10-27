// Run with node --test scripts/test-staff.cjs (uses the frontend TypeScript dependency).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('../frontend/node_modules/typescript');
function setup(){
 const storage=new Map([['player_token','member-session']]);let page,scan,handler=()=>{};const calls=[];
 const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),request:options=>{calls.push(options);handler(options)},scanCode:options=>{scan=options}};
 function load(path,require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require,wx,Page:options=>{page=options},console});return exports}
 const api=load('miniprogram/services/api.ts');load('miniprogram/pages/staff/staff.ts',()=>api);
 page.data={...page.data};page.setData=patch=>Object.assign(page.data,patch);
 return {page,storage,calls,api,setHandler:fn=>{handler=fn},getScan:()=>scan};
}
test('staff login uses separate session and clears password',async()=>{
 const t=setup();t.page.data.username=' clerk ';t.page.data.password='secret';
 t.setHandler(o=>o.success({statusCode:200,data:{access_token:'staff-session'}}));await t.page.login();
 assert.equal(t.calls[0].url,'http://127.0.0.1:8000/auth/login');assert.equal(t.calls[0].data.username,'clerk');
 assert.equal(t.storage.get('staff_token'),'staff-session');assert.equal(t.storage.get('player_token'),'member-session');assert.equal(t.page.data.password,'');
 t.page.logout();assert.equal(t.storage.has('staff_token'),false);assert.equal(t.storage.get('player_token'),'member-session');
});
test('cancel and invalid QR never submit a redemption',async()=>{
 const t=setup();t.page.scan();t.getScan().fail({errMsg:'scanCode:fail cancel'});
 assert.equal(t.page.data.busy,false);assert.equal(t.page.data.error,'');
 await t.page.lookup('https://example.com');assert.equal(t.calls.length,0);assert.ok(t.page.data.error);
});
test('scan previews ticket; explicit confirmation submits once',async()=>{
 const t=setup();t.storage.set('staff_token','staff-session');
 t.setHandler(o=>o.success({statusCode:200,data:[{id:7,reward_name:'门票',nickname:'玩家',member_code:'A001',status:'pending',issued_at:'2026-10-26T12:00:00'}]}));
 await t.page.lookup('NUTS:TICKET:012345ABCD');assert.equal(t.page.data.reward.id,7);assert.equal(t.calls.length,1);assert.equal(t.calls[0].method,'GET');
 let pending;t.setHandler(o=>{pending=o});const first=t.page.redeem();await t.page.redeem();assert.equal(t.calls.length,2);
 assert.equal(pending.url,'http://127.0.0.1:8000/rewards/7/redeem');assert.equal(pending.header.Authorization,'Bearer staff-session');
 pending.success({statusCode:200,data:{ok:true}});await first;assert.equal(t.page.data.reward,null);assert.match(t.page.data.notice,/核销成功/);
});
test('used tickets cannot submit; expired staff session preserves member session',async()=>{
 const t=setup();t.page.data.reward={id:7,status:'redeemed'};await t.page.redeem();assert.equal(t.calls.length,0);
 t.storage.set('staff_token','expired');t.setHandler(o=>o.success({statusCode:401,data:{detail:'登录已过期'}}));
 await t.page.lookup('NUTS:TICKET:012345ABCD');assert.equal(t.page.data.authenticated,false);assert.equal(t.storage.has('staff_token'),false);assert.equal(t.storage.get('player_token'),'member-session');assert.equal(t.page.data.reward,null);
});
test('uncertain redemption requires rescan and never shows success',async()=>{
 const t=setup();t.storage.set('staff_token','staff');t.page.data.reward={id:7,status:'pending'};t.setHandler(o=>o.fail());
 await t.page.redeem();assert.equal(t.page.data.reward,null);assert.equal(t.page.data.notice,'');assert.match(t.page.data.error,/重新扫码/);
});
test('member ticket renders QR matrix and removes it after redemption',async()=>{
 let page;const drawn=[];let callback,used=false,missing=false;
 const wx={getSystemInfoSync:()=>({windowWidth:320}),stopPullDownRefresh(){},createCanvasContext:()=>({setFillStyle:color=>drawn.push(color),fillRect:(...rect)=>drawn.push(rect),draw:()=>drawn.push('draw')})};
 const api={REWARDS_BACKGROUND:'',loggedIn:()=>true,request:async()=>used?{id:7,status:'redeemed'}:{id:7,status:'pending',qr_matrix:missing?undefined:[[true,false],[false,true]]},decorateReward:r=>r,errorMessage:e=>e.message};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('miniprogram/pages/reward-detail/reward-detail.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:()=>api,wx,Page:p=>{page=p}});
 page.setData=(patch,cb)=>{Object.assign(page.data,patch);callback=cb};
 await page.load();callback();assert.equal(page.data.qrSize,256);assert.equal(drawn.at(-1),'draw');assert.equal(drawn.filter(Array.isArray).length,3);
 missing=true;drawn.length=0;await page.load();callback();assert.match(page.data.error,/二维码暂不可用/);assert.equal(drawn.length,0);
 used=true;drawn.length=0;await page.load();callback();assert.equal(page.data.error,'');assert.equal(page.data.reward.qr_matrix,undefined);assert.equal(drawn.length,0);
});
test('authorized WeChat member enters scanner without a backend password',async()=>{
 const t=setup();t.setHandler(o=>o.success({statusCode:200,data:{username:'wx_admin'}}));
 await t.page.checkAccess();assert.equal(t.page.data.authenticated,true);assert.equal(t.page.data.busy,false);
 assert.equal(t.calls[0].url,'http://127.0.0.1:8000/mini/staff/me');assert.equal(t.calls[0].header.Authorization,'Bearer member-session');
});
test('revoked member cannot enter scanner and keeps member login',async()=>{
 const t=setup();t.setHandler(o=>o.success({statusCode:401,data:{detail:'无管理员权限'}}));
 await t.page.checkAccess();assert.equal(t.page.data.authenticated,false);assert.equal(t.page.data.error,'');assert.equal(t.storage.get('player_token'),'member-session');
});
test('expired password session falls back to the authorized WeChat identity',async()=>{
 const t=setup();t.storage.set('staff_token','expired');t.setHandler(o=>o.success(o.header.Authorization==='Bearer expired'?{statusCode:401,data:{detail:'过期'}}:{statusCode:200,data:{username:'wx_admin'}}));
 await t.page.checkAccess();assert.equal(t.page.data.authenticated,true);assert.equal(t.calls.length,2);assert.equal(t.storage.has('staff_token'),false);
});
