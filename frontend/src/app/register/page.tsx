'use client';
import {useSearchParams} from 'next/navigation';
import {Suspense,useEffect,useState} from 'react';

const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api/v1';

function makeIdempotencyKey(){
 if(typeof crypto!== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
 return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function RegisterForm(){
 const params=useSearchParams();
 const [distance,setDistance]=useState(params.get('distance')||'05');
 const [address,setAddress]=useState({line1:'',city:'',state:'',pincode:''});
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [idempotencyKey,setIdempotencyKey]=useState('');
 const [authChecked,setAuthChecked]=useState(false);
 useEffect(()=>setIdempotencyKey(makeIdempotencyKey()),[]);
 useEffect(()=>{
  fetch(`${API}/auth/me`,{credentials:'include'})
   .then(response=>{
    if(response.status===401){
     const destination=encodeURIComponent(`${location.pathname}${location.search}`);
     location.href=`/login?returnTo=${destination}`;
     return null;
    }
    return response.json();
   })
   .then(result=>{
    if(!result)return;
    if(result.user?.role==='participant')setAuthChecked(true);
    else location.href='/admin';
   })
   .catch(()=>{
    const destination=encodeURIComponent(`${location.pathname}${location.search}`);
    location.href=`/login?returnTo=${destination}`;
   });
 },[]);
 const prices:Record<string,number>={'05':800,'10':1200,'20':1500};

 async function submit(e:React.FormEvent){
  e.preventDefault();
  setBusy(true);
  setMessage('');
  try{
   const attemptKey=idempotencyKey||makeIdempotencyKey();
   if(!idempotencyKey) setIdempotencyKey(attemptKey);
   const r=await fetch(`${API}/registrations`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Idempotency-Key':attemptKey},
    credentials:'include',
    body:JSON.stringify({distancePackage:distance,address})
   });
   const d=await r.json();
   if(!r.ok) throw new Error(d.message||'Unable to register');
   setMessage(`Registration created. Amount: ₹${d.registration.amountPaise/100}. Payment status: pending.`);
  }catch(err){
   setMessage(err instanceof Error?err.message:'Something went wrong');
  }finally{
   setBusy(false);
  }
 }

 function startAnother(){
  setIdempotencyKey(makeIdempotencyKey());
  setAddress({line1:'',city:'',state:'',pincode:''});
  setMessage('');
 }

 if(!authChecked){
  return <main className="min-h-screen grid place-items-center"><p className="muted">Checking account…</p></main>;
 }

 return <main className="min-h-screen py-10"><div className="container max-w-3xl">
  <a href="/" className="font-black">← BUILDING MARATHON</a>
  <div className="mt-12 mb-8"><p className="eyebrow text-[#71852B]">Your next milestone</p><h1 className="section-title">REGISTER TO RUN.</h1><p className="muted">Choose a package and provide its delivery address.</p></div>
  <form onSubmit={submit} className="card p-6 md:p-9 space-y-5">
   <label className="block text-xs font-bold">Choose distance<select className="field mt-2" value={distance} onChange={e=>setDistance(e.target.value)}><option value="05">5 KM — ₹800</option><option value="10">10 KM — ₹1,200</option><option value="20">20 KM — ₹1,500</option></select></label>
   <div className="grid sm:grid-cols-2 gap-4">
    {([['line1','Address'],['city','City'],['state','State'],['pincode','PIN code']] as const).map(([key,label])=><label key={key} className="text-xs font-bold space-y-2">{label}<input className="field mt-2" required value={address[key]} onChange={e=>setAddress({...address,[key]:e.target.value})}/></label>)}
   </div>
   <div className="rounded-xl bg-[#eef2e7] p-4 flex justify-between"><span className="font-bold text-sm">Registration fee</span><strong className="text-xl">₹{prices[distance].toLocaleString('en-IN')}</strong></div>
   <p className="text-xs muted">All packages include a medal and runner badge. 10 KM also includes a refreshment pack. 20 KM also includes an event T-shirt.</p>
   <button disabled={busy} className="btn btn-dark w-full disabled:opacity-50">{busy?'Submitting…':'Create registration'}</button>
   {message&&<p role="status" className="text-sm p-3 rounded-lg bg-[#eef2e7]">{message}</p>}
   {message.startsWith('Registration created.')&&<button type="button" className="btn w-full" onClick={startAnother}>Start another registration</button>}
  </form>
 </div></main>;
}

export default function RegisterPage(){return <Suspense><RegisterForm/></Suspense>}
