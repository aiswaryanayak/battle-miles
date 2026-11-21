import Razorpay from 'razorpay';

export type RazorpayClient = {
  orders: {
    create: (params: { amount: number; currency: string; receipt: string }) => Promise<any>;
    fetch: (orderId: string) => Promise<any>;
  };
  payments: {
    fetch: (paymentId: string) => Promise<any>;
  };
};

type RazorpayClientFactory = () => RazorpayClient;

let razorpayClientFactory: RazorpayClientFactory = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('Razorpay is not configured');
  return new Razorpay({ key_id: keyId, key_secret: keySecret }) as unknown as RazorpayClient;
};

export function getRazorpayClient(): RazorpayClient {
  return razorpayClientFactory();
}

export function setRazorpayClientFactoryForTests(factory: RazorpayClientFactory): void {
  razorpayClientFactory = factory;
}

export function resetRazorpayClientFactory(): void {
  razorpayClientFactory = () => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error('Razorpay is not configured');
    return new Razorpay({ key_id: keyId, key_secret: keySecret }) as unknown as RazorpayClient;
  };
}
