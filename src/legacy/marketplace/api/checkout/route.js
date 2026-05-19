import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getStripe } from '@/app/lib/stripe';
import { adminDb, adminAuth, FieldValue } from '@/app/lib/firebaseAdmin';

const stripe = getStripe();
const APP_NAMESPACE = process.env.RIGX_APP_NAMESPACE || process.env.NEXT_PUBLIC_RIGX_APP_ID || 'rigmarket-app';

const getProductRef = (id) =>
  adminDb
    .collection('artifacts')
    .doc(APP_NAMESPACE)
    .collection('public')
    .doc('data')
    .collection('products')
    .doc(id);

const getOrdersCollection = () =>
  adminDb.collection('artifacts').doc(APP_NAMESPACE).collection('orders');

const getPaymentsCollection = () =>
  adminDb.collection('artifacts').doc(APP_NAMESPACE).collection('payments');

const sanitizeCart = (cart) => {
  if (!Array.isArray(cart)) return [];
  return cart
    .map((item) => ({
      id: typeof item?.id === 'string' ? item.id : null,
      qty: Number(item?.qty) > 0 ? Number(item.qty) : 0,
    }))
    .filter((item) => item.id && item.qty > 0);
};

export async function POST(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const idToken = authHeader.replace('Bearer ', '').trim();
  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(idToken);
  } catch (error) {
    console.error('Failed to verify Firebase ID token', error);
    return NextResponse.json({ error: 'Invalid authentication token' }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const cart = sanitizeCart(payload?.cart);
  const address = typeof payload?.address === 'string' ? payload.address.trim() : '';
  const paymentMethod = payload?.paymentMethod === 'card' ? 'card' : 'fpx';

  if (!cart.length) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
  }

  const buyerId = decodedToken.uid;
  const buyerEmail = decodedToken.email || payload?.buyerEmail || null;
  const buyerName = decodedToken.name || payload?.buyerName || 'RigX Buyer';

  try {
    const productDocs = await Promise.all(cart.map((item) => getProductRef(item.id).get()));
    const validatedItems = productDocs
      .map((docSnap, index) => {
        const qty = cart[index].qty;
        if (!docSnap.exists) return null;
        const data = docSnap.data();
        const price = Number(data?.price);
        if (!price || price <= 0) return null;
        return {
          productId: docSnap.id,
          title: data.title || 'RigX Item',
          price,
          priceCents: Math.round(price * 100),
          qty,
          sellerId: data.sellerId || null,
          images: Array.isArray(data.images) ? data.images : [],
        };
      })
      .filter(Boolean);

    if (!validatedItems.length) {
      return NextResponse.json({ error: 'No valid products found in cart' }, { status: 400 });
    }

    const amountTotal = validatedItems.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
    if (amountTotal <= 0) {
      return NextResponse.json({ error: 'Invalid order total' }, { status: 400 });
    }

    const ordersCollection = getOrdersCollection();
    const paymentsCollection = getPaymentsCollection();

    const orderRef = ordersCollection.doc();
    const paymentRef = paymentsCollection.doc();

    const orderPayload = {
      buyerId,
      buyerEmail,
      buyerName,
      status: 'awaiting_payment',
      amountTotal,
      currency: 'myr',
      paymentMethod,
      paymentId: paymentRef.id,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      address,
      items: validatedItems.map((item) => ({
        productId: item.productId,
        title: item.title,
        price: item.price,
        priceCents: item.priceCents,
        qty: item.qty,
        sellerId: item.sellerId,
        images: item.images,
      })),
      total: validatedItems.reduce((sum, item) => sum + item.price * item.qty, 0),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const paymentPayload = {
      orderId: orderRef.id,
      buyerId,
      status: 'created',
      provider: 'stripe',
      amountTotal,
      currency: 'myr',
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await Promise.all([orderRef.set(orderPayload), paymentRef.set(paymentPayload)]);

    const originHeader = headers().get('origin') || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: buyerEmail || undefined,
      client_reference_id: orderRef.id,
      metadata: {
        orderId: orderRef.id,
        paymentId: paymentRef.id,
        buyerId,
      },
      success_url: `${originHeader}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${originHeader}/payment/cancelled?order_id=${orderRef.id}`,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'always',
      },
      line_items: validatedItems.map((item) => ({
        quantity: item.qty,
        price_data: {
          currency: 'myr',
          unit_amount: item.priceCents,
          product_data: {
            name: item.title,
            metadata: {
              productId: item.productId,
              sellerId: item.sellerId || 'unknown',
            },
          },
        },
      })),
    });

    await Promise.all([
      orderRef.set({ stripeCheckoutSessionId: session.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      paymentRef.set({ stripeCheckoutSessionId: session.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    ]);

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Checkout session creation failed', error);
    return NextResponse.json({ error: 'Unable to start checkout. Please try again later.' }, { status: 500 });
  }
}
