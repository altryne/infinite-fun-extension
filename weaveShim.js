// weaveShim.js - Browser-compatible Weave tracing via REST API
const WEAVE_API_URL = 'https://trace.wandb.ai';
let _apiKey = null;
let _projectId = null;

export function init(project, options) {
    _projectId = project;
    _apiKey = options.apiKey;
    console.log('[WeaveShim] Initialized', { project, apiKey: _apiKey ? '***' : 'missing' });
}

function generateId() {
    return crypto.randomUUID();
}

function toISODateTime(timestamp) {
    // Convert Unix timestamp (seconds) to ISO 8601 datetime string
    return new Date(timestamp * 1000).toISOString();
}

async function apiCall(endpoint, payload) {
    if (!_apiKey) {
        console.log('[WeaveShim] No API key, skipping trace');
        return null;
    }
    try {
        // W&B uses Basic auth with "api" as username and API key as password
        const basicAuth = btoa(`api:${_apiKey}`);
        
        const response = await fetch(`${WEAVE_API_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${basicAuth}`
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[WeaveShim] API Error ${endpoint}:`, response.status, errorText);
            return null;
        }
        return response.json();
    } catch (e) {
        console.error(`[WeaveShim] Network Error ${endpoint}:`, e);
        return null;
    }
}

/**
 * Create a traced operation wrapper
 * @param {Function|string} arg1 - Function to wrap, or operation name
 * @param {Function|object} arg2 - If arg1 is string, this is the function. Otherwise, options object with {name}
 */
export function op(arg1, arg2) {
    let func, name;
    
    if (typeof arg1 === 'function') {
        // op(func, { name: 'operation_name' })
        func = arg1;
        name = arg2?.name || func.name || 'anonymous';
    } else if (typeof arg1 === 'string') {
        // op('operation_name', func)
        name = arg1;
        func = arg2;
    } else {
        throw new Error('Invalid op() arguments');
    }

    return async function tracedOp(...args) {
        const callId = generateId();
        const traceId = generateId();
        const startTime = Date.now() / 1000;

        // Build inputs object from arguments
        const inputs = {};
        args.forEach((arg, i) => {
            // Sanitize inputs - remove sensitive data like API keys
            if (typeof arg === 'object' && arg !== null) {
                const sanitized = { ...arg };
                // Remove common sensitive field patterns
                Object.keys(sanitized).forEach(key => {
                    if (key.toLowerCase().includes('apikey') || 
                        key.toLowerCase().includes('api_key') ||
                        key.toLowerCase().includes('secret') ||
                        key.toLowerCase().includes('token') ||
                        key.toLowerCase().includes('password')) {
                        sanitized[key] = '[REDACTED]';
                    }
                });
                inputs[`arg${i}`] = sanitized;
            } else {
                inputs[`arg${i}`] = arg;
            }
        });

        // Call Start - wrapped in "start" object per API spec
        const startPayload = {
            start: {
                project_id: _projectId,
                id: callId,
                trace_id: traceId,
                op_name: name,
                started_at: toISODateTime(startTime),
                attributes: {
                    weave: { client_version: 'browser-shim-1.0' }
                },
                inputs: inputs
            }
        };
        
        // Fire and forget start call
        apiCall('/call/start', startPayload);

        try {
            const result = await func.apply(this, args);
            
            // Build summary with usage if available
            const summary = {};
            
            // Check if result contains LLM usage data
            if (result && result._weaveUsage) {
                summary.usage = result._weaveUsage;
                // Remove internal usage data from output
                delete result._weaveUsage;
            }
            
            // Call End (Success) - wrapped in "end" object per API spec
            const endPayload = {
                end: {
                    project_id: _projectId,
                    id: callId,
                    ended_at: toISODateTime(Date.now() / 1000),
                    output: result,
                    summary: summary
                }
            };
            apiCall('/call/end', endPayload);
            
            return result;
        } catch (error) {
            // Call End (Error)
            const endPayload = {
                end: {
                    project_id: _projectId,
                    id: callId,
                    ended_at: toISODateTime(Date.now() / 1000),
                    exception: error.toString(),
                    summary: {}
                }
            };
            apiCall('/call/end', endPayload);
            throw error;
        }
    };
}

/**
 * Create a Weave image reference object
 * For external URLs, we just store them as-is - Weave will display them in the UI
 */
export async function weaveImage(options) {
    // For external URLs (like from Replicate/FAL), just return the URL
    // Weave can display these directly without uploading
    if (options.url) {
        return {
            _type: 'image-file',
            path: options.url
        };
    }
    
    // For raw data, we'd need to upload to W&B storage
    // This is complex and requires presigned URLs, so we skip it
    if (options.data) {
        console.warn('[WeaveShim] Raw image data upload not supported in browser shim, use URL instead');
        return {
            _type: 'image-file',
            path: 'data:image/png;base64,...'  // Placeholder
        };
    }
    
    return null;
}

/**
 * Helper to create LLM usage data for summary
 * Call this to attach usage info to traced LLM calls
 */
export function createLLMUsage(modelName, promptTokens, completionTokens) {
    return {
        [modelName]: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
            requests: 1
        }
    };
}
