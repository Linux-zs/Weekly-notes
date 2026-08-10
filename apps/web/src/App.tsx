import { useQuery } from '@tanstack/react-query';
import { BookOpenText,FolderKanban,LogOut,Menu,Search,Settings,StickyNote,X } from 'lucide-react';
import { NavLink,Navigate,Route,Routes,useLocation } from 'react-router';
import { useState } from 'react';
import { api,ApiError } from './api';
import { Loading } from './components';
import { ReportPage } from './pages/ReportPage';
import { SearchPage } from './pages/SearchPage';
import { MemosPage } from './pages/MemosPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';

type Me={user:{id:string;displayName:string;email:string|null;avatarUrl:string|null;workspaceId:string;role:string}};

export function App(){
  const location=useLocation();const [navOpen,setNavOpen]=useState(false);
  const me=useQuery({queryKey:['me'],queryFn:()=>api<Me>('/api/me'),retry:false});
  if(me.isLoading)return <div className="app-loader"><div className="brand-mark">周</div><Loading/></div>;
  if(me.error instanceof ApiError&&me.error.status===401)return location.pathname==='/login'?<LoginPage/>:<Navigate to="/login" replace/>;
  if(me.error)return <div className="login-shell"><div className="login-card"><h1>暂时无法连接</h1><p>{me.error.message}</p><button className="button" onClick={()=>me.refetch()}>重新尝试</button></div></div>;
  const user=me.data!.user;
  const links=[['/',BookOpenText,'本周周报'],['/search',Search,'搜索'],['/memos',StickyNote,'备忘卡片'],['/projects',FolderKanban,'项目'],['/settings',Settings,'设置']] as const;
  return <div className="app-shell">
    <header className="mobile-header"><button className="icon-button" onClick={()=>setNavOpen(true)} aria-label="打开导航"><Menu/></button><span className="mobile-brand">周笺</span><Avatar user={user}/></header>
    {navOpen&&<button className="nav-scrim" aria-label="关闭导航" onClick={()=>setNavOpen(false)}/>}
    <aside className={`sidebar ${navOpen?'sidebar-open':''}`}>
      <div className="brand"><div className="brand-mark">周</div><div><strong>周笺</strong><span>Weekly notes</span></div><button className="icon-button nav-close" onClick={()=>setNavOpen(false)}><X/></button></div>
      <nav>{links.map(([to,Icon,label])=><NavLink key={to} to={to} end={to==='/'} onClick={()=>setNavOpen(false)}><Icon size={19}/><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-foot"><div className="user-row"><Avatar user={user}/><div><strong>{user.displayName}</strong><span>{user.email??'个人空间'}</span></div></div><button className="icon-button" aria-label="退出登录" onClick={async()=>{await api('/auth/logout',{method:'POST'});window.location.href='/login';}}><LogOut size={18}/></button></div>
    </aside>
    <main className="main-content"><Routes><Route path="/" element={<ReportPage user={user}/>}/><Route path="/week/:year/:week" element={<ReportPage user={user}/>}/><Route path="/search" element={<SearchPage/>}/><Route path="/memos" element={<MemosPage/>}/><Route path="/projects" element={<ProjectsPage/>}/><Route path="/settings" element={<SettingsPage user={user}/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></main>
  </div>;
}

function Avatar({user}:{user:{displayName:string;avatarUrl:string|null}}){return user.avatarUrl?<img className="avatar" src={user.avatarUrl} alt=""/>:<span className="avatar avatar-fallback">{user.displayName.slice(0,1)}</span>;}

function LoginPage(){
  const providers=useQuery({queryKey:['providers'],queryFn:()=>api<{providers:Array<{provider:string;enabled:boolean}>}>('/api/auth/providers')});
  const labels:Record<string,string>={google:'Google',microsoft:'Microsoft',github:'GitHub',apple:'Apple'};
  const error=new URLSearchParams(location.search).get('error');
  return <div className="login-shell"><div className="login-atmosphere"><span/><span/><span/></div><section className="login-editorial"><div className="eyebrow">A quiet place for weekly work</div><h1>让一周的工作，<br/><em>留下清晰的纹理。</em></h1><p>记录完成、计划与阻塞。把散落的备忘，整理成可以回看的时间线。</p><div className="week-mini"><b>33</b><div><strong>本年度第 33 周</strong><span>MON 10 — SUN 16</span></div></div></section><section className="login-card"><div className="brand compact"><div className="brand-mark">周</div><div><strong>登录周笺</strong><span>进入你的个人工作空间</span></div></div>{error&&<div className="inline-alert">该账号未获授权，或登录流程已经过期。</div>}<div className="provider-list">{providers.isLoading?<Loading/>:providers.data?.providers.filter(p=>p.enabled).map(provider=><a className="provider-button" key={provider.provider} href={`/auth/${provider.provider}/start`}><ProviderIcon provider={provider.provider}/><span>使用 {labels[provider.provider]} 继续</span></a>)}</div>{providers.data?.providers.every(p=>!p.enabled)&&<><p className="muted center">尚未配置登录平台。本地开发可使用开发入口。</p><a className="button full" href="/auth/dev">进入本地开发环境</a></>}<p className="login-note">登录即表示仅在你的授权空间内保存周报数据。</p></section></div>;
}

function ProviderIcon({provider}:{provider:string}){return <span className={`provider-icon ${provider}`}>{provider==='google'?'G':provider==='microsoft'?'⊞':provider==='github'?'GH':'●'}</span>;}
