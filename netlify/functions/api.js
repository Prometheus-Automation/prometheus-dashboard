// netlify/functions/api.js - Complete API Backend for Prometheus Dashboard

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin (credentials from environment variables)
let db;
if (!db) {
  const app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
  db = getFirestore(app);
}

// Main handler for Netlify Functions
exports.handler = async (event, context) => {
  // Enable CORS for your dashboard
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Parse the API path
  const path = event.path.replace('/.netlify/functions/api', '');
  const segments = path.split('/').filter(Boolean);
  
  try {
    // Route to appropriate handler based on path
    switch (true) {
      // GET /api/agents
      case event.httpMethod === 'GET' && segments[0] === 'agents' && !segments[1]:
        return await handleGetAgents(headers);
      
      // POST /api/agents/:id/command
      case event.httpMethod === 'POST' && segments[0] === 'agents' && segments[2] === 'command':
        return await handleAgentCommand(segments[1], event.body, headers);
      
      // GET /api/leads/metrics
      case event.httpMethod === 'GET' && segments[0] === 'leads' && segments[1] === 'metrics':
        return await handleGetLeadMetrics(headers);
      
      // GET /api/alerts/active
      case event.httpMethod === 'GET' && segments[0] === 'alerts' && segments[1] === 'active':
        return await handleGetAlerts(headers);
      
      // POST /api/alerts/:id/resolve
      case event.httpMethod === 'POST' && segments[0] === 'alerts' && segments[2] === 'resolve':
        return await handleResolveAlert(segments[1], headers);
      
      // GET /api/workflows
      case event.httpMethod === 'GET' && segments[0] === 'workflows':
        return await handleGetWorkflows(headers);
      
      // POST /api/workflows
      case event.httpMethod === 'POST' && segments[0] === 'workflows':
        return await handleCreateWorkflow(event.body, headers);
      
      // POST /api/roi/calculate
      case event.httpMethod === 'POST' && segments[0] === 'roi' && segments[1] === 'calculate':
        return await handleCalculateROI(headers);
      
      default:
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Endpoint not found' })
        };
    }
  } catch (error) {
    console.error('API Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error', 
        message: error.message 
      })
    };
  }
};

// Get all agents status
async function handleGetAgents(headers) {
  try {
    const agents = {};
    const agentsSnapshot = await db.collection('prometheus_agents').get();
    
    const now = new Date();
    
    agentsSnapshot.forEach(doc => {
      const data = doc.data();
      const agentId = doc.id;
      
      // Calculate agent status based on last heartbeat
      const lastHeartbeat = data.last_heartbeat?.toDate() || now;
      const timeSinceHeartbeat = (now - lastHeartbeat) / 1000;
      
      let status = 'healthy';
      if (timeSinceHeartbeat > 300) status = 'offline';
      else if (timeSinceHeartbeat > 60) status = 'degraded';
      
      agents[agentId] = {
        id: agentId,
        name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
        version: data.version || '1.0.0',
        status,
        description: data.description || `${agentId} Agent`,
        uptime: `${(data.metrics?.uptime_hours || 0).toFixed(1)} hours`,
        tasksCompleted: data.metrics?.tasks_completed || 0,
        errorRate: data.metrics?.error_rate || 0,
        lastHeartbeat: lastHeartbeat.toISOString(),
        capabilities: data.capabilities || [],
        metrics: data.metrics || {}
      };
    });
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        agents,
        timestamp: now.toISOString()
      })
    };
  } catch (error) {
    console.error('Error getting agents:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Send command to agent
async function handleAgentCommand(agentId, body, headers) {
  try {
    const command = JSON.parse(body || '{}');
    
    // Log the command (in production, this would publish to Pub/Sub)
    console.log(`Command for ${agentId}:`, command);
    
    // For now, just acknowledge the command
    // In production, this would publish to agent-specific Pub/Sub topic
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Command sent to ${agentId}`,
        command: command.command
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Get lead metrics
async function handleGetLeadMetrics(headers) {
  try {
    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    
    // Get lead statistics
    const leadsRef = db.collection('leads');
    
    // Get total leads count
    const allLeadsSnapshot = await leadsRef.get();
    const totalLeads = allLeadsSnapshot.size;
    
    // Get today's leads
    const todayLeadsSnapshot = await leadsRef
      .where('created', '>=', todayStart)
      .get();
    const leadsToday = todayLeadsSnapshot.size;
    
    // Get pending leads
    const pendingSnapshot = await leadsRef
      .where('status', '==', 'PENDING_RESEARCH')
      .get();
    const pendingCount = pendingSnapshot.size;
    
    // Get hot leads (score > 0.8)
    let hotCount = 0;
    allLeadsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.score > 0.8) hotCount++;
    });
    
    // Calculate conversion rate
    const convertedSnapshot = await leadsRef
      .where('status', '==', 'CONVERTED')
      .get();
    const conversionRate = totalLeads > 0 
      ? (convertedSnapshot.size / totalLeads * 100) 
      : 0;
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        metrics: {
          total: totalLeads,
          today: leadsToday,
          pending: pendingCount,
          hot: hotCount,
          conversionRate: conversionRate.toFixed(1)
        },
        timestamp: now.toISOString()
      })
    };
  } catch (error) {
    console.error('Error getting lead metrics:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Get active alerts
async function handleGetAlerts(headers) {
  try {
    const alertsSnapshot = await db.collection('system_alerts')
      .where('resolved', '==', false)
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
    
    const alerts = [];
    alertsSnapshot.forEach(doc => {
      const data = doc.data();
      alerts.push({
        id: doc.id,
        severity: data.severity || 'info',
        message: data.message,
        agent: data.agent_id || 'system',
        timestamp: data.timestamp?.toDate()?.toISOString() || new Date().toISOString()
      });
    });
    
    const summary = {
      total: alerts.length,
      critical: alerts.filter(a => a.severity === 'critical').length,
      warning: alerts.filter(a => a.severity === 'warning').length,
      info: alerts.filter(a => a.severity === 'info').length
    };
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        alerts,
        summary
      })
    };
  } catch (error) {
    console.error('Error getting alerts:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Resolve alert
async function handleResolveAlert(alertId, headers) {
  try {
    const alertRef = db.collection('system_alerts').doc(alertId);
    await alertRef.update({
      resolved: true,
      resolved_at: new Date(),
      resolved_by: 'dashboard_user'
    });
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Alert ${alertId} resolved`
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Get workflows
async function handleGetWorkflows(headers) {
  try {
    const workflowsSnapshot = await db.collection('workflows').get();
    const workflows = [];
    
    workflowsSnapshot.forEach(doc => {
      const data = doc.data();
      workflows.push({
        id: doc.id,
        name: data.name || 'Unnamed Workflow',
        status: data.status || 'inactive',
        steps: data.steps?.length || 0,
        completedToday: data.completed_today || 0,
        created: data.created?.toDate()?.toISOString() || null
      });
    });
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        workflows
      })
    };
  } catch (error) {
    console.error('Error getting workflows:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Create workflow
async function handleCreateWorkflow(body, headers) {
  try {
    const workflowData = JSON.parse(body || '{}');
    
    const workflow = {
      name: workflowData.name || 'New Workflow',
      description: workflowData.description || '',
      trigger: workflowData.trigger || 'manual',
      steps: workflowData.steps || [],
      status: 'active',
      created: new Date(),
      created_by: 'dashboard_user',
      completed_today: 0
    };
    
    const docRef = await db.collection('workflows').add(workflow);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        workflow_id: docRef.id,
        message: 'Workflow created successfully'
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}

// Calculate ROI
async function handleCalculateROI(headers) {
  try {
    // Get actual metrics from database
    const agentsSnapshot = await db.collection('prometheus_agents').get();
    const agentsCount = agentsSnapshot.size;
    
    // Get lead statistics
    const leadsRef = db.collection('leads');
    const totalLeadsSnapshot = await leadsRef.get();
    const totalLeads = totalLeadsSnapshot.size;
    
    const convertedSnapshot = await leadsRef
      .where('status', '==', 'CONVERTED')
      .get();
    const convertedLeads = convertedSnapshot.size;
    
    // Calculate metrics
    const tasksCompleted = 50000; // Placeholder - would sum from all agents
    const timesSavedHours = tasksCompleted * 0.083; // 5 min per task
    const annualTimeSavings = timesSavedHours * 75 * 12; // $75/hour
    
    const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) : 0.15;
    const annualLeadRevenue = convertedLeads * 5000 * 12; // $5k average deal
    
    const totalROI = annualTimeSavings + annualLeadRevenue;
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        roi: {
          agents_deployed: agentsCount,
          total_leads_processed: totalLeads,
          leads_converted: convertedLeads,
          conversion_rate: (conversionRate * 100).toFixed(1),
          time_saved_hours_annual: Math.round(timesSavedHours * 12),
          cost_savings_annual: Math.round(annualTimeSavings),
          revenue_from_leads_annual: Math.round(annualLeadRevenue),
          total_roi_annual: Math.round(totalROI),
          roi_multiple: (totalROI / 50000).toFixed(1) // Assuming $50k investment
        }
      })
    };
  } catch (error) {
    console.error('Error calculating ROI:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
}
