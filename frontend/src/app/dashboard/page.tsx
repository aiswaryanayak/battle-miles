'use client';
import {useEffect,useState} from 'react';

const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api/v1';

type Registration={
 id:string;
 distancePackage:'05'|'10'|'20';
 distanceKm:number;
 amountPaise:number;
 address:{line1:string;city:string;state:string;pincode:string};
 paymentStatus:'pending'|'paid'|'failed';
 status:string;
 createdAt:string;
};

export default function Dashboard(){
 const [registrations,setRegistrations]=useState<Registration[]>([]);
 const [error,setError]=useState('');
 useEffect(()=>{
  fetch(`${API}/registrations/me`,{credentials:'include'})
   .then(r=>{
    if(r.status===401){location.href='/login';return null}
    if(!r.ok) throw new Error('Could not load registrations');
    return r.json();
   })
   .then(result=>result&&setRegistrations(result.registrations||[]))
   .catch(()=>setError('Could not load registrations'));
 },[]);

 return <main className="min-h-screen py-12"><div className="container max-w-4xl">
  <div className="flex items-center justify-between gap-4"><a href="/" className="font-black">BUILDING MARATHON</a><div className="flex gap-3"><a href="/register" className="btn btn-dark">New registration</a><a href="/login" className="btn" onClick={async e=>{e.preventDefault();await fetch(`${API}/auth/logout`,{method:'POST',credentials:'include'});location.href='/login'}}>Log out</a></div></div>
  <h1 className="section-title mt-12">YOUR RUNNER<br/>DASHBOARD.</h1>
  {error&&<p>{error}</p>}
  {!error&&!registrations.length&&<div className="card p-7 mt-8"><p>No registrations yet.</p><a href="/register" className="btn btn-dark mt-5">Register for a distance</a></div>}
  {!!registrations.length&&<div className="space-y-4 mt-8">{registrations.map(registration=><div className="card p-7" key={registration.id}>
   <p className="eyebrow text-[#71852B]">{registration.distanceKm} KM registration</p>
   <h2 className="text-2xl font-bold mt-2">₹{(registration.amountPaise/100).toLocaleString('en-IN')}</h2>
   <p className="muted mt-2">{registration.address.line1}, {registration.address.city}, {registration.address.state} — {registration.address.pincode}</p>
   <p className="text-sm mt-4">Payment: {registration.paymentStatus}</p>
   <p className="text-sm">Status: {registration.status}</p>
  </div>)}</div>}
 </div></main>;
}
