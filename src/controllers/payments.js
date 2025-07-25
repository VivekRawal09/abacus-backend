const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class PaymentsController {

  // 1. GET /api/payments/plans - Get subscription plans
  static async getSubscriptionPlans(req, res) {
    try {
      const { is_active = true } = req.query;

      let query = supabase
        .from('subscription_plans')
        .select('*');

      if (is_active !== undefined) {
        query = query.eq('is_active', is_active);
      }

      const { data: plans, error } = await query
        .order('display_order', { ascending: true })
        .order('price_amount', { ascending: true });

      if (error) throw error;

      // Format plans for display
      const formattedPlans = plans?.map(plan => ({
        id: plan.id,
        name: plan.name,
        description: plan.description,
        plan_type: plan.plan_type,
        pricing: {
          amount: parseFloat(plan.price_amount),
          currency: plan.currency,
          duration_months: plan.duration_months,
          monthly_equivalent: plan.duration_months > 0 
            ? (parseFloat(plan.price_amount) / plan.duration_months).toFixed(2)
            : plan.price_amount
        },
        features: plan.features,
        limits: {
          max_students: plan.max_students
        },
        is_active: plan.is_active,
        display_order: plan.display_order
      })) || [];

      res.json({
        success: true,
        data: {
          plans: formattedPlans,
          total_plans: formattedPlans.length,
          active_plans: formattedPlans.filter(p => p.is_active).length
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get subscription plans error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subscription plans'
      });
    }
  }

  // 2. POST /api/payments/plans - Create subscription plan (super admin only)
  static async createSubscriptionPlan(req, res) {
    try {
      const {
        name,
        description,
        plan_type,
        price_amount,
        currency = 'INR',
        duration_months = 1,
        features = [],
        max_students = 50,
        display_order = 1
      } = req.body;

      // Validation
      if (!name || !plan_type || !price_amount) {
        return res.status(400).json({
          success: false,
          message: 'Name, plan type, and price amount are required'
        });
      }

      if (parseFloat(price_amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Price amount must be greater than 0'
        });
      }

      const validPlanTypes = ['monthly', 'yearly', 'lifetime', 'trial'];
      if (!validPlanTypes.includes(plan_type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid plan type. Must be one of: ${validPlanTypes.join(', ')}`
        });
      }

      // Check if plan name already exists
      const { data: existingPlan } = await supabase
        .from('subscription_plans')
        .select('id')
        .eq('name', name.trim())
        .single();

      if (existingPlan) {
        return res.status(400).json({
          success: false,
          message: 'Plan with this name already exists'
        });
      }

      // Create subscription plan
      const { data: plan, error } = await supabase
        .from('subscription_plans')
        .insert([{
          name: name.trim(),
          description: description?.trim() || '',
          plan_type,
          price_amount: parseFloat(price_amount),
          currency,
          duration_months: parseInt(duration_months),
          features: Array.isArray(features) ? features : [],
          max_students: parseInt(max_students),
          display_order: parseInt(display_order),
          is_active: true
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        success: true,
        data: plan,
        message: 'Subscription plan created successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Create subscription plan error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create subscription plan'
      });
    }
  }

  // 3. GET /api/payments/subscriptions/:userId - Get user subscriptions
  static async getUserSubscriptions(req, res) {
    try {
      const { userId } = req.params;

      // Access control: users can only see their own subscriptions
      if (req.user.role === 'student' || req.user.role === 'parent') {
        if (req.user.id !== userId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      }

      // Get student ID for the user
      const { data: student, error: studentError } = await supabase
        .from('users').eq('role', 'student')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (studentError || !student) {
        return res.status(404).json({
          success: false,
          message: 'Student profile not found'
        });
      }

      // Get subscriptions
      const { data: subscriptions, error } = await supabase
        .from('student_subscriptions')
        .select(`
          *,
          subscription_plans:plan_id(name, plan_type, price_amount, currency, features)
        `)
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Format subscription data
      const formattedSubscriptions = subscriptions?.map(sub => ({
        id: sub.id,
        plan: {
          name: sub.subscription_plans?.name,
          type: sub.subscription_plans?.plan_type,
          price: sub.subscription_plans?.price_amount,
          currency: sub.subscription_plans?.currency,
          features: sub.subscription_plans?.features
        },
        status: sub.subscription_status,
        dates: {
          started_at: sub.started_at,
          expires_at: sub.expires_at,
          next_payment_due: sub.next_payment_due
        },
        payment: {
          method: sub.payment_method,
          auto_renew: sub.auto_renew,
          total_paid: parseFloat(sub.total_amount_paid) || 0
        },
        created_at: sub.created_at
      })) || [];

      const activeSubscription = formattedSubscriptions.find(s => s.status === 'active');

      res.json({
        success: true,
        data: {
          subscriptions: formattedSubscriptions,
          active_subscription: activeSubscription || null,
          total_subscriptions: formattedSubscriptions.length,
          subscription_history_summary: {
            total_spent: formattedSubscriptions.reduce((sum, s) => sum + s.payment.total_paid, 0).toFixed(2),
            active_since: activeSubscription?.dates.started_at || null
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get user subscriptions error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user subscriptions'
      });
    }
  }

  // 4. POST /api/payments/subscribe - Create new subscription
  static async createSubscription(req, res) {
    try {
      const {
        plan_id,
        student_id,
        payment_method = 'card',
        auto_renew = true
      } = req.body;

      // Validation
      if (!plan_id || !student_id) {
        return res.status(400).json({
          success: false,
          message: 'Plan ID and Student ID are required'
        });
      }

      // Check if plan exists and is active
      const { data: plan, error: planError } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('id', plan_id)
        .eq('is_active', true)
        .single();

      if (planError || !plan) {
        return res.status(404).json({
          success: false,
          message: 'Subscription plan not found or inactive'
        });
      }

      // Check if student exists
      const { data: student, error: studentError } = await supabase
        .from('users').eq('role', 'student')
        .select('id, user_id')
        .eq('id', student_id)
        .single();

      if (studentError || !student) {
        return res.status(404).json({
          success: false,
          message: 'Student not found'
        });
      }

      // Check for existing active subscription
      const { data: existingSubscription } = await supabase
        .from('student_subscriptions')
        .select('id')
        .eq('student_id', student_id)
        .eq('subscription_status', 'active')
        .single();

      if (existingSubscription) {
        return res.status(400).json({
          success: false,
          message: 'Student already has an active subscription'
        });
      }

      // Calculate expiry date
      const startDate = new Date();
      const expiryDate = new Date(startDate);
      expiryDate.setMonth(expiryDate.getMonth() + plan.duration_months);

      // Calculate next payment due date
      const nextPaymentDate = new Date(expiryDate);
      if (auto_renew) {
        // Set next payment 3 days before expiry
        nextPaymentDate.setDate(nextPaymentDate.getDate() - 3);
      }

      // Create subscription
      const { data: subscription, error } = await supabase
        .from('student_subscriptions')
        .insert([{
          student_id,
          plan_id,
          subscription_status: 'pending', // Will be activated after payment
          started_at: startDate.toISOString(),
          expires_at: expiryDate.toISOString(),
          auto_renew,
          payment_method,
          next_payment_due: auto_renew ? nextPaymentDate.toISOString() : null,
          total_amount_paid: 0
        }])
        .select()
        .single();

      if (error) throw error;

      // Log subscription creation
      await supabase
        .from('activity_logs')
        .insert([{
          user_id: req.user.id,
          action: 'subscription_created',
          entity_type: 'subscription',
          entity_id: subscription.id,
          details: {
            plan_name: plan.name,
            plan_type: plan.plan_type,
            amount: plan.price_amount,
            student_id,
            auto_renew
          }
        }]);

      res.status(201).json({
        success: true,
        data: {
          subscription_id: subscription.id,
          plan: {
            name: plan.name,
            type: plan.plan_type,
            price: plan.price_amount,
            currency: plan.currency
          },
          status: subscription.subscription_status,
          expires_at: subscription.expires_at,
          next_steps: {
            payment_required: true,
            payment_amount: plan.price_amount,
            payment_currency: plan.currency
          }
        },
        message: 'Subscription created. Please complete payment to activate.',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Create subscription error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create subscription'
      });
    }
  }

  // 5. PUT /api/payments/subscriptions/:id/cancel - Cancel subscription
  static async cancelSubscription(req, res) {
    try {
      const { id } = req.params;
      const { cancellation_reason = 'User requested' } = req.body;

      // Check if subscription exists and user has access
      let query = supabase
        .from('student_subscriptions')
        .select('*, students:student_id(user_id)')
        .eq('id', id);

      // Users can only cancel their own subscriptions
      if (req.user.role === 'student' || req.user.role === 'parent') {
        query = query.eq('students.user_id', req.user.id);
      }

      const { data: subscription, error: fetchError } = await query.single();

      if (fetchError || !subscription) {
        return res.status(404).json({
          success: false,
          message: 'Subscription not found or access denied'
        });
      }

      if (subscription.subscription_status === 'cancelled') {
        return res.status(400).json({
          success: false,
          message: 'Subscription is already cancelled'
        });
      }

      // Cancel subscription (immediate cancellation, but access until expiry)
      const { data: cancelledSubscription, error } = await supabase
        .from('student_subscriptions')
        .update({
          subscription_status: 'cancelled',
          auto_renew: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Log cancellation
      await supabase
        .from('activity_logs')
        .insert([{
          user_id: req.user.id,
          action: 'subscription_cancelled',
          entity_type: 'subscription',
          entity_id: id,
          details: {
            cancellation_reason,
            cancelled_by: req.user.id,
            expires_at: subscription.expires_at
          }
        }]);

      res.json({
        success: true,
        data: {
          subscription_id: id,
          status: 'cancelled',
          access_until: subscription.expires_at,
          cancellation_reason
        },
        message: 'Subscription cancelled successfully. Access will continue until expiry date.',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Cancel subscription error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cancel subscription'
      });
    }
  }

  // 6. GET /api/payments/transactions - Get payment transactions
  static async getPaymentTransactions(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        status, 
        payment_method,
        student_id,
        start_date,
        end_date
      } = req.query;

      const offset = (page - 1) * limit;

      let query = supabase
        .from('payment_transactions')
        .select(`
          *,
          student_subscriptions:subscription_id(
            student_id,
            subscription_plans:plan_id(name)
          )
        `, { count: 'exact' });

      // Apply filters
      if (status) query = query.eq('payment_status', status);
      if (payment_method) query = query.eq('payment_method', payment_method);
      if (student_id) query = query.eq('student_subscriptions.student_id', student_id);
      if (start_date) query = query.gte('processed_at', start_date);
      if (end_date) query = query.lte('processed_at', end_date);

      // Role-based filtering
      if (req.user.role === 'student' || req.user.role === 'parent') {
        // Users can only see their own transactions
        const { data: student } = await supabase
          .from('users').eq('role', 'student')
          .select('id')
          .eq('user_id', req.user.id)
          .single();
        
        if (student) {
          query = query.eq('student_subscriptions.student_id', student.id);
        } else {
          // No student profile found, return empty results
          return res.json({
            success: true,
            data: {
              transactions: [],
              pagination: { page: 1, limit, total: 0, pages: 0 }
            }
          });
        }
      }

      const { data: transactions, count, error } = await query
        .order('processed_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Format transactions
      const formattedTransactions = transactions?.map(transaction => ({
        id: transaction.id,
        transaction_id: transaction.transaction_id,
        amount: parseFloat(transaction.amount),
        currency: transaction.currency,
        payment_method: transaction.payment_method,
        payment_status: transaction.payment_status,
        plan_name: transaction.student_subscriptions?.subscription_plans?.name,
        processed_at: transaction.processed_at,
        gateway_response: transaction.gateway_response
      })) || [];

      res.json({
        success: true,
        data: {
          transactions: formattedTransactions,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count || 0,
            pages: Math.ceil((count || 0) / limit)
          },
          summary: {
            total_amount: formattedTransactions.reduce((sum, t) => sum + t.amount, 0).toFixed(2),
            successful_transactions: formattedTransactions.filter(t => t.payment_status === 'completed').length,
            failed_transactions: formattedTransactions.filter(t => t.payment_status === 'failed').length
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get payment transactions error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch payment transactions'
      });
    }
  }

  // 7. POST /api/payments/process - Process payment
  static async processPayment(req, res) {
    try {
      const {
        subscription_id,
        amount,
        currency = 'INR',
        payment_method = 'card',
        payment_gateway = 'test', // In production: 'stripe', 'razorpay', etc.
        payment_details = {}
      } = req.body;

      // Validation
      if (!subscription_id || !amount) {
        return res.status(400).json({
          success: false,
          message: 'Subscription ID and amount are required'
        });
      }

      if (parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be greater than 0'
        });
      }

      // Check if subscription exists
      const { data: subscription, error: subError } = await supabase
        .from('student_subscriptions')
        .select('*, subscription_plans:plan_id(price_amount)')
        .eq('id', subscription_id)
        .single();

      if (subError || !subscription) {
        return res.status(404).json({
          success: false,
          message: 'Subscription not found'
        });
      }

      // Verify amount matches plan price
      const expectedAmount = parseFloat(subscription.subscription_plans.price_amount);
      if (parseFloat(amount) !== expectedAmount) {
        return res.status(400).json({
          success: false,
          message: `Amount mismatch. Expected ${expectedAmount}, received ${amount}`
        });
      }

      // Generate transaction ID
      const transactionId = `TXN_${Date.now()}_${uuidv4().slice(0, 8)}`;

      // Simulate payment processing (in production, integrate with actual gateway)
      let paymentStatus = 'completed';
      let gatewayResponse = {
        gateway: payment_gateway,
        transaction_reference: `${payment_gateway}_${Date.now()}`,
        status: 'success',
        message: 'Payment processed successfully'
      };

      // Simulate occasional failures for testing
      if (payment_details.simulate_failure) {
        paymentStatus = 'failed';
        gatewayResponse.status = 'failed';
        gatewayResponse.message = 'Payment declined by bank';
      }

      // Create payment transaction record
      const { data: transaction, error: transactionError } = await supabase
        .from('payment_transactions')
        .insert([{
          subscription_id,
          transaction_id: transactionId,
          amount: parseFloat(amount),
          currency,
          payment_method,
          payment_status: paymentStatus,
          gateway_response: gatewayResponse,
          processed_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (transactionError) throw transactionError;

      // If payment successful, activate subscription and update amounts
      if (paymentStatus === 'completed') {
        const { error: updateError } = await supabase
          .from('student_subscriptions')
          .update({
            subscription_status: 'active',
            last_payment_at: new Date().toISOString(),
            total_amount_paid: supabase.raw('total_amount_paid + ?', [parseFloat(amount)]),
            updated_at: new Date().toISOString()
          })
          .eq('id', subscription_id);

        if (updateError) {
          console.error('Subscription update error:', updateError);
          // Don't fail the transaction, but log the error
        }
      }

      // Log payment activity
      await supabase
        .from('activity_logs')
        .insert([{
          user_id: req.user.id,
          action: 'payment_processed',
          entity_type: 'payment',
          entity_id: transaction.id,
          details: {
            subscription_id,
            amount: parseFloat(amount),
            currency,
            payment_method,
            status: paymentStatus,
            transaction_id: transactionId
          }
        }]);

      res.status(201).json({
        success: paymentStatus === 'completed',
        data: {
          transaction_id: transactionId,
          payment_id: transaction.id,
          amount: parseFloat(amount),
          currency,
          status: paymentStatus,
          subscription_status: paymentStatus === 'completed' ? 'active' : 'pending',
          processed_at: transaction.processed_at,
          receipt_url: `/api/payments/${transaction.id}/receipt`
        },
        message: paymentStatus === 'completed' 
          ? 'Payment processed successfully' 
          : 'Payment failed',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Process payment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process payment'
      });
    }
  }

  // 8. GET /api/payments/:id/receipt - Get payment receipt
  static async getPaymentReceipt(req, res) {
    try {
      const { id } = req.params;

      // Get payment transaction with related data
      let query = supabase
        .from('payment_transactions')
        .select(`
          *,
          student_subscriptions:subscription_id(
            student_id,
            subscription_plans:plan_id(name, plan_type),
            students:student_id(
              user_id,
              users:user_id(first_name, last_name, email)
            )
          )
        `)
        .eq('id', id);

      // Access control
      if (req.user.role === 'student' || req.user.role === 'parent') {
        const { data: student } = await supabase
          .from('users').eq('role', 'student')
          .select('id')
          .eq('user_id', req.user.id)
          .single();
        
        if (student) {
          query = query.eq('student_subscriptions.student_id', student.id);
        }
      }

      const { data: transaction, error } = await query.single();

      if (error || !transaction) {
        return res.status(404).json({
          success: false,
          message: 'Payment receipt not found or access denied'
        });
      }

      // Format receipt data
      const receipt = {
        receipt_details: {
          receipt_number: `RECEIPT_${transaction.transaction_id}`,
          transaction_id: transaction.transaction_id,
          payment_id: transaction.id,
          date: transaction.processed_at,
          status: transaction.payment_status
        },
        customer_details: {
          name: transaction.student_subscriptions?.students?.users 
            ? `${transaction.student_subscriptions.students.users.first_name} ${transaction.student_subscriptions.students.users.last_name}`.trim()
            : 'N/A',
          email: transaction.student_subscriptions?.students?.users?.email || 'N/A'
        },
        plan_details: {
          plan_name: transaction.student_subscriptions?.subscription_plans?.name || 'N/A',
          plan_type: transaction.student_subscriptions?.subscription_plans?.plan_type || 'N/A'
        },
        payment_details: {
          amount: parseFloat(transaction.amount),
          currency: transaction.currency,
          payment_method: transaction.payment_method,
          gateway_reference: transaction.gateway_response?.transaction_reference || 'N/A'
        },
        company_details: {
          name: 'ABACUS Learning Platform',
          address: 'Digital Learning Solutions',
          support_email: 'support@abacuslearn.com'
        }
      };

      res.json({
        success: true,
        data: receipt,
        message: 'Payment receipt retrieved successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get payment receipt error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch payment receipt'
      });
    }
  }
}

module.exports = PaymentsController;