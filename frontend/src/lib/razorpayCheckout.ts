const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api/v1';
const SCRIPT_URL='https://checkout.razorpay.com/v1/checkout.js';

let scriptPromise:Promise<void>|null=null;

export type CreateOrderResponse={
 orderId:string;
 amount:number;
 currency:string;
 keyId:string;
};

export type VerifyPaymentResponse={
 verified:boolean;
 registrationStatus:string;
 paymentStatus:'pending'|'paid'|'failed';
 message?:string;
};

export type ParticipantPrefill={
 name?:string;
 email?:string;
 phone?:string;
};

export type CheckoutResult={
 kind:'paid'|'pending'|'failed'|'cancelled'|'script_error'|'network_error';
 message:string;
 paymentStatus?:'pending'|'paid'|'failed';
 registrationStatus?:string;
};

export function loadRazorpayCheckout():Promise<void>{
 if(typeof window==='undefined') return Promise.reject(new Error('Razorpay Checkout requires a browser'));
 if(window.Razorpay) return Promise.resolve();
 if(scriptPromise) return scriptPromise;

 scriptPromise=new Promise<void>((resolve,reject)=>{
  const existing=document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
  const script=existing||document.createElement('script');
  if(!existing){
   script.src=SCRIPT_URL;
   script.async=true;
   document.head.appendChild(script);
  }
  script.addEventListener('load',()=>window.Razorpay?resolve():reject(new Error('Razorpay Checkout did not initialize')), {once:true});
  script.addEventListener('error',()=>reject(new Error('Unable to load Razorpay Checkout')), {once:true});
  if(existing && window.Razorpay) resolve();
 });
  scriptPromise=scriptPromise.catch(error=>{
   scriptPromise=null;
   throw error;
  });
  return scriptPromise;
}

export async function startRazorpayPayment(
 registrationId:string,
 distanceLabel:string,
 participant:ParticipantPrefill={},
 onState?: (kind:'checkout'|'verifying',message:string)=>void
):Promise<CheckoutResult>{
 try{
  await loadRazorpayCheckout();
 }catch(error){
  return {kind:'script_error',message:error instanceof Error?error.message:'Unable to load Razorpay Checkout'};
 }
 if(!window.Razorpay) return {kind:'script_error',message:'Razorpay Checkout is unavailable'};

 let orderResponse:Response;
 try{
  orderResponse=await fetch(`${API}/payments/create-order`,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   credentials:'include',
   body:JSON.stringify({registrationId})
  });
 }catch{
  return {kind:'network_error',message:'Could not reach the payment service'};
 }

 const orderData=await orderResponse.json().catch(()=>({message:'Invalid payment response'}));
 if(!orderResponse.ok){
  return {kind:'failed',paymentStatus:'pending',message:orderData.message||'Could not create payment order'};
 }
 const order=orderData as CreateOrderResponse;
 if(!order.orderId||!order.keyId||order.currency!=='INR'||typeof order.amount!=='number'){
  return {kind:'failed',paymentStatus:'pending',message:'Payment gateway returned invalid order details'};
 }

 return new Promise<CheckoutResult>(resolve=>{
  const checkout=new window.Razorpay!({
   key:order.keyId,
   amount:order.amount,
   currency:order.currency,
   name:'BATTLE MILES',
   description:`${distanceLabel} marathon registration`,
   order_id:order.orderId,
   prefill:{
    name:participant.name,
    email:participant.email,
    contact:participant.phone
   },
   theme:{color:'#D9F36A'},
   modal:{ondismiss:()=>resolve({kind:'cancelled',message:'Payment checkout was cancelled'})},
   handler:async payment=>{
    onState?.('verifying','Verifying payment with the server…');
    let verifyResponse:Response;
    try{
     verifyResponse=await fetch(`${API}/payments/verify`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body:JSON.stringify({
       registrationId,
       razorpay_order_id:payment.razorpay_order_id,
       razorpay_payment_id:payment.razorpay_payment_id,
       razorpay_signature:payment.razorpay_signature
      })
     });
    }catch{
     resolve({kind:'network_error',message:'Payment could not be verified because the network request failed'});
     return;
    }
    const verifyData=await verifyResponse.json().catch(()=>({message:'Invalid verification response'}));
    if(!verifyResponse.ok){
     resolve({kind:'failed',paymentStatus:'pending',message:verifyData.message||'Payment verification failed'});
     return;
    }
    const verification=verifyData as VerifyPaymentResponse;
    if(verification.verified===true && verification.paymentStatus==='paid'){
     resolve({
      kind:'paid',
      message:'Payment verified successfully',
      paymentStatus:'paid',
      registrationStatus:verification.registrationStatus
     });
    }else if(verification.paymentStatus==='failed'){
     resolve({
      kind:'failed',
      message:verification.message||'Payment failed',
      paymentStatus:'failed',
      registrationStatus:verification.registrationStatus
     });
    }else{
     resolve({
      kind:'pending',
      message:verification.message||'Payment is processing',
      paymentStatus:'pending',
      registrationStatus:verification.registrationStatus
     });
    }
   }
  });
  checkout.on('payment.failed',response=>{
   resolve({kind:'failed',paymentStatus:'pending',message:response.error?.description||'Payment failed'});
  });
  onState?.('checkout','Opening secure checkout…');
  checkout.open();
 });
}
