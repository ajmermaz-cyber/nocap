const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Vercel provides raw body via req.body when bodyParser is disabled
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const relevantEvents = [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated'
  ];

  if (!relevantEvents.includes(event.type)) {
    return res.status(200).json({ received: true });
  }

  try {
    const obj = event.data.object;

    // Get customer email
    let email = obj.customer_email || obj.customer_details?.email;

    if (!email && obj.customer) {
      const customer = await stripe.customers.retrieve(obj.customer);
      email = customer.email;
    }

    if (!email) {
      console.error('No email found in event:', event.type);
      return res.status(200).json({ received: true });
    }

    // Determine pro status
    const isPro = !obj.status || obj.status === 'active' || obj.status === 'trialing';

    // Find user in Supabase by email
    const { data: usersData, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) {
      console.error('Error listing users:', listErr);
      return res.status(500).json({ error: 'Failed to find user' });
    }

    const user = usersData.users.find(u => u.email === email);
    if (!user) {
      console.error('User not found for email:', email);
      return res.status(200).json({ received: true });
    }

    // Update is_pro in nocap_users
    const { error: updateErr } = await supabase
      .from('nocap_users')
      .update({ is_pro: isPro })
      .eq('id', user.id);

    if (updateErr) {
      console.error('Error updating is_pro:', updateErr);
      return res.status(500).json({ error: 'Failed to update user' });
    }

    console.log(`✅ Set is_pro=${isPro} for ${email}`);
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
