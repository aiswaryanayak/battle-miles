'use client';
import {useEffect,useState} from 'react';
import {getSafeReturnTo} from '../../lib/authRedirect.mjs';

const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api/v1';

export default function Signup(){
 const [form,setForm]=useState({name:'',email:'',password:'',phone:''});
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [returnTo,setReturnTo]=useState('/');

 useEffect(()=>{
  const params=new URLSearchParams(location.search);
  setReturnTo(getSafeReturnTo(params.get('returnTo'), '/'));
 },[]);

 async function submit(e:React.FormEvent){
  e.preventDefault();
  setMessage('');
  if(form.name.trim().length<2){setMessage('Full name must be at least 2 characters.');return}
  if(form.password.length<10){setMessage('Password must be at least 10 characters.');return}
  if(form.phone.trim().length<8||form.phone.trim().length>20){setMessage('Phone number must contain 8 to 20 characters.');return}
  setBusy(true);
  try{
   const response=await fetch(`${API}/auth/register`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    credentials:'include',
    body:JSON.stringify({name:form.name.trim(),email:form.email.trim(),password:form.password,phone:form.phone.trim()})
   });
   const data=await response.json();
   if(!response.ok) throw new Error(data.message||'Could not create account');
   if(returnTo==='/' ){
    location.href='/?welcome=1';
   }else{
    location.href=returnTo;
   }
  }catch(error){
   setMessage(error instanceof Error?error.message:'Could not create account');
  }finally{
   setBusy(false);
  }
 }

 return <main className="min-h-screen grid place-items-center p-5">
  <form onSubmit={submit} className="card p-8 w-full max-w-md space-y-4">
   <a href="/" className="font-black">BATTLE MILES</a>
   <h1 className="text-4xl font-black tracking-tight mt-4">CREATE ACCOUNT.</h1>
   <label className="block text-xs font-bold">Full name
    <input className="field mt-2" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} minLength={2} maxLength={100} required/>
   </label>
   <label className="block text-xs font-bold">Email
    <input className="field mt-2" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} maxLength={254} required/>
   </label>
   <label className="block text-xs font-bold">Password
    <input className="field mt-2" type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} minLength={10} maxLength={128} required/>
   </label>
   <label className="block text-xs font-bold">Phone number
    <input className="field mt-2" type="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} minLength={8} maxLength={20} required/>
   </label>
   <button disabled={busy} className="btn btn-dark w-full disabled:opacity-50">{busy?'Creating account…':'Create account'}</button>
   {message&&<p role="alert" className="text-sm">{message}</p>}
   <p className="text-xs muted">Already have an account? <a className="underline" href="/login">Log in</a></p>
   <p className="text-xs muted"><a className="underline" href="/">Back to homepage</a></p>
  </form>
 </main>;
}
