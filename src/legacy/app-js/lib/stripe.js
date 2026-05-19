import Stripe from 'stripe';

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  throw new Error('STRIPE_SECRET_KEY is not set. Add it to .env.local (server-side only).');
}

const stripe = new Stripe(secretKey, {
  apiVersion: '2024-06-20',
  appInfo: {
    name: 'RigX Marketplace',
  },
});

export const getStripe = () => stripe;
