import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated'
    ) {
      const obj = event.data.object;

      // Get the customer email from Stripe
      let email = obj.customer_email || obj.customer_details?.email;

      // If no email on the object, look up the customer
      if (!email && obj.customer) {
        const customer = await stripe.customers.retrieve(obj.customer);
        email = customer.email;
      }

      if (!email) {
        console.error('No email found for event:', event.type);
        return res.status(200).json({ received: true });
      }

      // Check subscription status
      let isPro = true;
      if (obj.status && obj.status !== 'active' && obj.status !== 'trialing') {
        isPro = false;
      }

      // Update the user's is_pro status in Supabase
      // First find the user by email
      const { data: users, error: userError } = await supabase.auth.admin.listUsers();
      if (userError) {
        console.error('Error listing users:', userError);
        return res.status(500).json({ error: 'Failed to list users' });
      }

      const user = users.users.find(u => u.email === email);
      if (!user) {
        console.error('No user found for email:', email);
        return res.status(200).json({ received: true });
      }

      const { error: updateError } = await supabase
        .from('nocap_users')
        .update({ is_pro: isPro })
        .eq('id', user.id);

      if (updateError) {
        console.error('Error updating is_pro:', updateError);
        return res.status(500).json({ error: 'Failed to update user' });
      }

      console.log(`Updated is_pro=${isPro} for user ${email}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
