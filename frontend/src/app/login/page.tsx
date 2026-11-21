'use client';
import {useEffect,useState} from 'react';
import {getSafeReturnTo} from '../../lib/authRedirect.mjs';

const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api/v1';

export default function Login(){
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [msg,setMsg]=useState('');
 const [returnTo,setReturnTo]=useState('/');

 useEffect(()=>{
  const params=new URLSearchParams(location.search);
  setReturnTo(getSafeReturnTo(params.get('returnTo'), '/'));
 },[]);

 async function go(e:React.FormEvent){
  e.preventDefault();
  setMsg('');
  const r=await fetch(`${API}/auth/login`,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   credentials:'include',
   body:JSON.stringify({email,password})
  });
  const d=await r.json();
  if(!r.ok){setMsg(d.message||'Login failed');return}
  if(d.user.role==='admin'){location.href='/admin';return}
  location.href=returnTo;
 }

 return <main className="min-h-screen grid place-items-center p-5">
  <form onSubmit={go} className="card p-8 w-full max-w-md space-y-4">
   <a href="/" className="font-black">BATTLE MILES</a>
   <h1 className="text-4xl font-black tracking-tight mt-4">WELCOME BACK.</h1>
   <label className="block text-xs font-bold">Email<input className="field mt-2" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
   <label className="block text-xs font-bold">Password<input className="field mt-2" type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
   <button className="btn btn-dark w-full">Log in</button>
   {msg&&<p role="alert" className="text-sm">{msg}</p>}
   <p className="text-xs muted">New runner? <a className="underline" href={`/signup${returnTo!=='/'?`?returnTo=${encodeURIComponent(returnTo)}`:''}`}>Create account</a></p>
   <p className="text-xs muted"><a className="underline" href="/">Back to homepage</a></p>
  </form>
 </main>;
}
