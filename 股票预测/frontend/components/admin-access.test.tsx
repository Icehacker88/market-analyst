import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api';
import type { AuthUser } from '@/lib/types';
import { AuthProvider, useAuth } from './auth-provider';
import { MonitorPage } from './monitor-page';
import { isAdminUser } from '@/lib/admin';
vi.mock('./providers', () => ({useApp:()=>({language:'en',t:(key:string)=>key})}));
vi.mock('@/lib/analytics',()=>({trackEvent:vi.fn()}));
const admin: AuthUser={id:'admin-a',email:'configured-test-admin@example.test',is_admin:true};
const bob: AuthUser={id:'bob',email:'bob@example.test',is_admin:false};
let current:AuthUser|null;let denyMetrics:boolean;let metricsFetches:number;
function Controls(){const a=useAuth();return <><span data-testid="role">{String(a.user?.is_admin===true)}</span><span data-testid="identity">{a.user?.id||'guest'}</span><button onClick={()=>void a.signOut()}>logout</button><button onClick={()=>void a.loginWithEmail(bob.email,'synthetic-password')}>login bob</button><button onClick={()=>void api.getUserState().catch(()=>{})}>private request</button></>;}
beforeEach(()=>{localStorage.clear();current={...admin};denyMetrics=false;metricsFetches=0;vi.stubGlobal('fetch',vi.fn(async(input,init)=>{const url=new URL(String(input), "https://test.example").pathname;let data:unknown;
 if(url==='/api/auth/config')data={googleEnabled:false,appleEnabled:false,signupEnabled:true};
 else if(url==='/api/auth/me')data=current;
 else if(url==='/api/auth/logout'){current=null;data=null;}
 else if(url==='/api/auth/login'){current={...bob};data={user:current};}
 else if(url==='/api/admin/metrics'){metricsFetches++;if(denyMetrics)return Response.json({error:{message:'denied'}},{status:403});data={provider:'private-monitor-provider',requests:[],web_vitals:{},event_counts:{}};}
 else if(url==='/api/user/state')return Response.json({error:{message:'expired'}},{status:401});
 else throw new Error('Unexpected test request');
 return Response.json({data});
}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function mount(){await act(async()=>{render(<AuthProvider><Controls/><MonitorPage/></AuthProvider>);});await waitFor(()=>expect(screen.getByTestId('role')).toHaveTextContent('true'));await waitFor(()=>expect(metricsFetches).toBe(1));await screen.findByText('Operations Monitor');}
describe('server-authoritative admin UI',()=>{
 it('uses only a strict server flag, never email or localStorage roles',()=>{expect(isAdminUser({is_admin:true})).toBe(true);expect(isAdminUser({is_admin:'true'} as never)).toBe(false);expect(isAdminUser({email:admin.email} as never)).toBe(false);});
 it('allows a configured test admin and clears permissions/metrics on logout and B login',async()=>{await mount();await screen.findByText('Cache performance');fireEvent.click(screen.getByText('logout'));await waitFor(()=>expect(screen.getByTestId('role')).toHaveTextContent('false'));expect(screen.queryByText('Cache performance')).toBeNull();fireEvent.click(screen.getByText('login bob'));await waitFor(()=>expect(screen.getByTestId('identity')).toHaveTextContent('bob'));expect(screen.queryByText('Cache performance')).toBeNull();expect(metricsFetches).toBe(1);});
 it('revokes admin state and monitoring data after API 403',async()=>{await mount();await screen.findByText('Cache performance');denyMetrics=true;fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await waitFor(()=>expect(screen.getByTestId('role')).toHaveTextContent('false'));expect(screen.queryByText('Cache performance')).toBeNull();});
 it('revalidates an expired session and removes administrator UI',async()=>{await mount();current=null;fireEvent.click(screen.getByText('private request'));await waitFor(()=>expect(screen.getByTestId('identity')).toHaveTextContent('guest'));expect(screen.queryByText('Cache performance')).toBeNull();expect(localStorage.getItem('orivane-auth-user-id')).toBeNull();});
 it('does not let a tampered local user marker prevent revocation on 403',async()=>{
  await mount();await screen.findByText('Cache performance');
  localStorage.setItem('orivane-auth-user-id','forged-owner');denyMetrics=true;
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  await waitFor(()=>expect(screen.getByTestId('role')).toHaveTextContent('false'));
  expect(screen.queryByText('Cache performance')).toBeNull();
 });
 it('discards a late successful monitoring response after logout',async()=>{
  await mount();await screen.findByText('Cache performance');
  let release!:(response:Response)=>void;
  vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  fireEvent.click(screen.getByText('logout'));
  await waitFor(()=>expect(screen.getByTestId('identity')).toHaveTextContent('guest'));
  await act(async()=>{release(Response.json({data:{provider:'late-private',requests:[],web_vitals:{}}}));});
  expect(screen.queryByText('Cache performance')).toBeNull();
 });
 it('ignores a previous account admin rejection after switching accounts',async()=>{await mount();fireEvent.click(screen.getByText('login bob'));await waitFor(()=>expect(screen.getByTestId('identity')).toHaveTextContent('bob'));act(()=>window.dispatchEvent(new CustomEvent('orivane-auth-rejected',{detail:{userId:admin.id,scope:'admin'}})));expect(screen.getByTestId('identity')).toHaveTextContent('bob');});
});
