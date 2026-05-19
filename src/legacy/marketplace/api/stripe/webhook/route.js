import { NextResponse } from 'next/server';
import { getStripe } from '@/app/lib/stripe';
import { adminDb, FieldValue } from '@/app/lib/firebaseAdmin';

const stripe = getStripe();
const APP_NAMESPACE = process.env.RIGX_APP_NAMESPACE || process.env.NEXT_PUBLIC_RIGX_APP_ID || 'rigmarket-app';

const getOrdersCollection = () =>
  adminDb.collection('artifacts').doc(APP_NAMESPACE).collection('orders');

const getPaymentsCollection = () =>
  adminDb.collection('artifacts').doc(APP_NAMESPACE).collection('payments');

const getSellerSalesCollection = (sellerId) =>
  adminDb.collection('artifacts').doc(APP_NAMESPACE).collection('users').doc(sellerId).collection('sales');

async function markOrderStatus(orderId, paymentId, stripeSessionId, paymentIntentId, status, failureReason) {
  if (!orderId) return;

  const updates = {
    status,
    stripeCheckoutSessionId: stripeSessionId,
    stripePaymentIntentId: paymentIntentId || null,
    failureReason: failureReason || null,
    updatedAt: FieldValue.serverTimestamp(),
  };

  const ordersCollection = getOrdersCollection();
  const paymentsCollection = getPaymentsCollection();

  await Promise.all([
    ordersCollection.doc(orderId).set(updates, { merge: true }),
    paymentId
      ? paymentsCollection.doc(paymentId).set({ ...updates, provider: 'stripe' }, { merge: true })
      : Promise.resolve(),
  ]);
}

async function fulfillPaidOrder(session) {
  const metadata = session.metadata || {};
  const orderId = metadata.orderId;
  const paymentId = metadata.paymentId;
  if (!orderId) {
    console.warn('Stripe session missing orderId metadata');
    return;
  }

  const ordersCollection = getOrdersCollection();
  const orderSnap = await ordersCollection.doc(orderId).get();
  if (!orderSnap.exists) {
    console.warn('Order not found for Stripe session', orderId);
    return;
  }

  const orderData = orderSnap.data();
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;

  await markOrderStatus(orderId, paymentId, session.id, paymentIntentId, 'paid');

  const buyerName = orderData?.buyerName || session.customer_details?.name || 'RigX Buyer';
  const buyerId = orderData?.buyerId || metadata.buyerId || null;

  const sellerWrites = (orderData?.items || [])
    .filter((item) => item?.sellerId)
    .map((item) => {
      const saleRef = getSellerSalesCollection(item.sellerId).doc(`${orderId}_${item.productId}`);
      return saleRef.set(
        {
          orderId,
          itemId: item.productId,
          title: item.title,
          price: item.price,
          priceCents: item.priceCents,
          qty: item.qty,
          buyerName,
          buyerId,
          sellerId: item.sellerId,
          status: 'To Ship',
          courier: 'Pending Assignment',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          stripePaymentIntentId: paymentIntentId || null,
        },
        { merge: true }
      );
    });

  await Promise.all(sellerWrites);
}

export async function POST(request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature header' }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error('Stripe webhook verification failed', error);
    return NextResponse.json({ error: `Webhook Error: ${error.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await fulfillPaidOrder(event.data.object);
        break;
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        const metadata = session.metadata || {};
        if (metadata.orderId) {
          await markOrderStatus(
            metadata.orderId,
            metadata.paymentId,
            session.id,
            null,
            'failed',
            'async_payment_failed'
          );
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        const metadata = intent.metadata || {};
        if (metadata.orderId) {
          await markOrderStatus(
            metadata.orderId,
            metadata.paymentId,
            null,
            intent.id,
            'failed',
            intent.last_payment_error?.message || 'payment_failed'
          );
        }
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error('Error handling Stripe webhook event', event.type, error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
